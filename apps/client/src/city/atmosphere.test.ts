import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GROUND_LIGHT, INK, londonGrade, SKY_LIGHT } from "./atmosphere";
import { Palette, type SwatchKey } from "./kit";
import { SKY_COLORS } from "./sky";

// Little London's colour against the reference's measured tones: pixel samples on matching surfaces and whole-frame
// means on its street frames (see .claude/abeto-messenger/look-analysis.md, third pass). These guard the calibration.

/** Hue (degrees), saturation and value of a display colour. */
function hsv(c: THREE.Color): { h: number; s: number; v: number } {
  const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b), d = max - min;
  let h = 0;
  if (d > 1e-9) h = max === c.r ? ((c.g - c.b) / d + 6) % 6 : max === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4;
  return { h: h * 60, s: max ? d / max : 0, v: max };
}

/** A display (sRGB) colour through the London grade. */
function graded(display: THREE.Color): THREE.Color {
  const [r, g, b] = londonGrade(display.r, display.g, display.b);
  return new THREE.Color(r, g, b);
}

/** A colour given as hex, in display terms (THREE.Color keeps it linear). */
const display = (hex: string) => new THREE.Color(hex).convertLinearToSRGB();

/**
 * How a swatch shows, lit or in shade, facing up (road, pavement) or sideways (walls): its shading colour plus the sky
 * and ground fill, in display colour through the grade (distance haze aside).
 */
function shown(key: SwatchKey, shade: boolean, up: boolean): THREE.Color {
  const material = new Palette().get(key);
  const linear = (shade ? material.uniforms.uShadow!.value : material.uniforms.uColor!.value).clone() as THREE.Color;
  material.dispose();
  linear.add(up ? SKY_LIGHT : GROUND_LIGHT.clone().lerp(SKY_LIGHT, 0.5));
  return graded(linear.convertLinearToSRGB());
}

const levels = (c: THREE.Color) => [c.r, c.g, c.b].map((v) => Math.round(v * 255));

describe("Little London's colour against the reference's measured tones", () => {
  it("draws the road in the reference's teal-green, lit and in shade, with its depth of shade", () => {
    const lit = levels(shown("road", false, true));
    const shade = levels(shown("road", true, true));
    // Reference: lit (130, 162, 158), shade (87, 115, 112).
    [130, 162, 158].forEach((v, i) => expect(Math.abs(lit[i]! - v), `lit ${lit}`).toBeLessThan(8));
    [87, 115, 112].forEach((v, i) => expect(Math.abs(shade[i]! - v), `shade ${shade}`).toBeLessThan(8));
    // How deep the shade is, in linear light: the reference's 0.41–0.47 of the lit value.
    const ratio = [0, 1, 2].reduce((sum, i) => sum + (shade[i]! / lit[i]!) ** 2.2, 0) / 3;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.49);
  });

  it("keeps London's whites green-leaning greys in the light, as the reference's lit greys are (hue 95–132°)", () => {
    for (const [key, up] of [["paving", true], ["wall0", false], ["face", false], ["paint", true]] as const) {
      const { h, s } = hsv(shown(key, false, up));
      expect(h, key).toBeGreaterThan(95);
      expect(h, key).toBeLessThan(132);
      expect(s, key).toBeLessThan(0.1);
    }
    // Portland stone stays the warmest of them, still on the green side of yellow.
    expect(hsv(shown("stone", false, false)).h).toBeGreaterThan(85);
  });

  it("inks in the reference's dark blue slate (its darkest pixels: hue 201–206°, value about 0.22)", () => {
    const { h, v } = hsv(graded(display(INK)));
    expect(h).toBeGreaterThan(198);
    expect(h).toBeLessThan(215);
    expect(v).toBeGreaterThan(0.17);
    expect(v).toBeLessThan(0.27);
  });

  it("kicks up dust in the reference's mid grey (its footstep particles are #7c7c7c), not a white cloud", () => {
    // Reference: #7c7c7c, value 0.49. Lit dust here, facing up or sideways, within a tenth of that and near neutral.
    for (const up of [true, false]) {
      const { s, v } = hsv(shown("dust", false, up));
      expect(v, `up ${up}`).toBeGreaterThan(0.39);
      expect(v, `up ${up}`).toBeLessThan(0.59);
      expect(s, `up ${up}`).toBeLessThan(0.12);
      // One flat tone, lit or in shade, as the reference draws its particles unlit.
      expect(levels(shown("dust", true, up))).toEqual(levels(shown("dust", false, up)));
    }
  });

  it("weathers white stucco in its own tones (damp and grime), as the reference stains its walls, not with bare brick", () => {
    const material = new Palette().get("wall0");
    const wall = hsv((material.uniforms.uColor!.value as THREE.Color).clone().convertLinearToSRGB());
    const stain = hsv((material.uniforms.uPatternColor!.value as THREE.Color).clone().convertLinearToSRGB());
    material.dispose();
    expect(stain.s).toBeLessThan(0.1);
    expect(Math.abs(stain.h - wall.h)).toBeLessThan(25);
    expect(stain.v).toBeLessThan(wall.v);
    expect(stain.v).toBeGreaterThan(wall.v * 0.75);
  });

  it("paints the reference's turquoise sky with mint cloud", () => {
    // Reference: sky (101, 193, 188), hue 177°, saturation 0.48; cloud (160, 230, 214), hue 166°, saturation 0.30.
    const sky = hsv(graded(display(SKY_COLORS.zenith)));
    expect(sky.h).toBeGreaterThan(170);
    expect(sky.h).toBeLessThan(184);
    expect(sky.s).toBeGreaterThan(0.4);
    const cloud = hsv(graded(display(SKY_COLORS.cloudLight)));
    expect(cloud.h).toBeGreaterThan(158);
    expect(cloud.h).toBeLessThan(174);
    expect(cloud.s).toBeLessThan(sky.s);
  });
});
