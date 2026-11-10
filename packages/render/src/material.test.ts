import { describe, expect, it } from "vitest";
import { Color, type ShaderMaterial } from "three";
import { createIllustratedMaterial, illustratedEnvironment, resetIllustratedEnvironment, shadeOf } from "./material";
import { createGradeLut, IllustratedComposer } from "./IllustratedComposer";

/** Hue (0..1), saturation and value of a linear colour. */
function hsv(color: Color): [number, number, number] {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === color.r) hue = ((color.g - color.b) / delta + 6) % 6;
    else if (max === color.g) hue = (color.b - color.r) / delta + 2;
    else hue = (color.r - color.g) / delta + 4;
    hue /= 6;
  }
  return [hue, max > 0 ? delta / max : 0, max];
}

describe("shade by rule", () => {
  it("keeps the saturation, halves the value and nudges the hue a fiftieth of a turn toward red-orange", () => {
    for (const hex of ["#b96d53", "#5aa9b9", "#7ea56c", "#ece6d5", "#283036"]) {
      const lit = new Color(hex);
      const [h, s, v] = hsv(lit);
      const [sh, ss, sv] = hsv(shadeOf(lit));
      expect(sv, hex).toBeCloseTo(v * 0.5, 5);
      expect(ss, hex).toBeCloseTo(s, 5);
      if (s > 0.02) expect(((sh - h + 1.5) % 1) - 0.5, hex).toBeCloseTo(-0.02, 4);
    }
    // Greys stay grey.
    const grey = shadeOf(new Color(0.4, 0.4, 0.4));
    expect(grey.r).toBeCloseTo(0.2, 6);
    expect(grey.g).toBeCloseTo(0.2, 6);
    expect(grey.b).toBeCloseTo(0.2, 6);
  });

  it("is the default shade of world materials, while explicit shades and the view look are left alone", () => {
    const derived = createIllustratedMaterial({ color: "#c7ab7b", lighting: "world" });
    expect((derived.uniforms.uShadow!.value as Color).equals(shadeOf("#c7ab7b"))).toBe(true);
    const explicit = createIllustratedMaterial({ color: "#c7ab7b", shadow: "#123456", lighting: "world" });
    expect((explicit.uniforms.uShadow!.value as Color).getHexString()).toBe("123456");
    const view = createIllustratedMaterial({ color: "#c7ab7b" });
    expect((view.uniforms.uShadow!.value as Color).equals(new Color("#c7ab7b").offsetHSL(-0.02, 0.04, -0.28))).toBe(true);
  });
});

describe("world materials", () => {
  const defines = (material: ShaderMaterial) => Object.keys(material.defines ?? {}).sort();

  it("turn on vertex colours and character shading only when lit by the world", () => {
    const figure = createIllustratedMaterial({ color: "#ffffff", lighting: "world", vertexColors: true, character: true });
    expect(defines(figure)).toEqual(["ILLUSTRATED_CHARACTER", "ILLUSTRATED_VERTEX_COLORS", "ILLUSTRATED_WORLD"]);
    expect(figure.vertexColors).toBe(true);
    const flat = createIllustratedMaterial({ color: "#ffffff", vertexColors: true, character: true });
    expect(defines(flat)).toEqual([]);
    expect(flat.vertexColors).toBe(false);
  });

  it("read 0 for geometry without per-vertex sway or surface-id shift", () => {
    const material = createIllustratedMaterial({ color: "#ffffff", lighting: "world" });
    const defaults = material.defaultAttributeValues as Record<string, number[]>;
    expect(defaults.sway).toEqual([0]);
    expect(defaults.idShift).toEqual([0]);
  });

  it("limits the soft ink wash to explicitly selected world characters", () => {
    const soft = createIllustratedMaterial({ color: "#ffffff", lighting: "world", character: true, softCharacter: true, vertexColors: true });
    expect(defines(soft)).toContain("ILLUSTRATED_SOFT_CHARACTER");
    expect(defines(createIllustratedMaterial({ color: "#ffffff", lighting: "world", softCharacter: true }))).not.toContain("ILLUSTRATED_SOFT_CHARACTER");
    expect(defines(createIllustratedMaterial({ color: "#ffffff", character: true, softCharacter: true }))).not.toContain("ILLUSTRATED_SOFT_CHARACTER");
  });

  it("share the sky light, cut and highlight, which reset with the rest of the environment", () => {
    const material = createIllustratedMaterial({ color: "#ffffff", lighting: "world", pattern: "render", inkPatches: true });
    expect(material.uniforms.uSkyLight).toBe(illustratedEnvironment.uSkyLight);
    expect(material.uniforms.uCut).toBe(illustratedEnvironment.uCut);
    expect(material.uniforms.uHighlight).toBe(illustratedEnvironment.uHighlight);
    expect(material.uniforms.uInkPatches!.value).toBe(1);
    const sky = illustratedEnvironment.uSkyLight.value.clone();
    illustratedEnvironment.uSkyLight.value.setRGB(1, 0, 0);
    illustratedEnvironment.uCut.value.set(0.5, 0.6);
    illustratedEnvironment.uHighlight.value = 0;
    resetIllustratedEnvironment();
    expect(illustratedEnvironment.uSkyLight.value.equals(sky)).toBe(true);
    expect(illustratedEnvironment.uCut.value.toArray()).toEqual([0.2, 0.4]);
    expect(illustratedEnvironment.uHighlight.value).toBeCloseTo(0.075);
  });

  it("never name a variable with a word GLSL ES 3.00 reserves (the shader would not compile)", () => {
    const material = createIllustratedMaterial({ color: "#ffffff", lighting: "world" });
    const reserved = ["half", "patch", "sample", "filter", "input", "output", "superp", "fixed", "unsigned", "active", "partition", "resource"];
    for (const source of [material.vertexShader, material.fragmentShader]) {
      const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const word of reserved) expect(code, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });
});

describe("colour look-up tables", () => {
  it("bake a grade over a size-cubed grid, red fastest, clamped to the 0..1 range", () => {
    const table = createGradeLut((r, g, b) => [r * 2, g, -b], 3);
    expect(table.image.width).toBe(3);
    expect(table.image.depth).toBe(3);
    const data = table.image.data as Uint8Array;
    // (r, g, b) = (0.5, 1, 1) sits at index ((2 * 3 + 2) * 3 + 1).
    const at = ((2 * 3 + 2) * 3 + 1) * 4;
    expect([data[at], data[at + 1], data[at + 2], data[at + 3]]).toEqual([255, 255, 0, 255]);
    table.dispose();
  });

  it("are blended in by the lut style, swapped in by setGradeLut, and the composer only disposes its own", () => {
    const composer = new IllustratedComposer({ setRenderTarget() {}, clear() {}, render() {} } as never);
    expect(composer.style.lut).toBe(0);
    composer.setStyle({ lut: 4, lines: "drawn" });
    expect(composer.style.lut).toBe(1);
    expect(composer.style.lines).toBe("drawn");
    composer.setStyle({ lut: Number.NaN, lines: "bogus" as never });
    expect(composer.style.lut).toBe(1);
    expect(composer.style.lines).toBe("drawn");
    const table = createGradeLut((r, g, b) => [r, g, b], 17);
    let disposed = 0;
    table.addEventListener("dispose", () => { disposed += 1; });
    composer.setGradeLut(table);
    composer.setGradeLut(null);
    composer.dispose();
    expect(disposed).toBe(0);
    table.dispose();
  });
});
