import { describe, expect, it } from "vitest";
import { Scene, PerspectiveCamera, type WebGLRenderer, type ShaderMaterial, type Mesh } from "three";
import { BOIL_FPS, IllustratedComposer } from "./IllustratedComposer";

it("retains visible outlines when thickness is set before first resize", () => {
  let outline: ShaderMaterial | undefined;
  const renderer = { autoClear: true, setRenderTarget: () => {}, clear: () => {}, render: (scene: Scene) => {
    const mesh = scene.children[0] as Mesh;
    if (mesh?.material && "uniforms" in mesh.material) outline = mesh.material as ShaderMaterial;
  } } as unknown as WebGLRenderer;
  const composer = new IllustratedComposer(renderer);
  composer.setThickness(1.15);
  composer.resize(1600, 900, 1);
  composer.render(new Scene(), new PerspectiveCamera());
  expect(outline?.uniforms.uThickness?.value).toBeCloseTo(1.15);
  composer.dispose();
});

it("starts with flat ink, no fade and no grade, and clamps the style it is given", () => {
  const composer = new IllustratedComposer({ setRenderTarget() {}, clear() {}, render() {} } as never);
  expect(composer.style).toEqual({ lines: "classic", fadeNear: 1e6, fadeFar: 2e6, fadeMin: 1, inkTint: 0, grade: 0, lut: 0, boil: 0 });
  composer.setStyle({ fadeNear: 300, fadeFar: 100, fadeMin: -1, inkTint: 3, grade: 0.5 });
  const style = composer.style;
  expect(style.fadeNear).toBe(300);
  expect(style.fadeFar).toBeGreaterThan(300);
  expect(style.fadeMin).toBe(0);
  expect(style.inkTint).toBe(1);
  expect(style.grade).toBe(0.5);
});

it("puts the shared world environment back as it started", async () => {
  const { illustratedEnvironment, resetIllustratedEnvironment } = await import("./material");
  const density = illustratedEnvironment.uFogDensity.value;
  const sun = illustratedEnvironment.uSunDirection.value.clone();
  illustratedEnvironment.uFogDensity.value = 0.5;
  illustratedEnvironment.uSunDirection.value.set(0, 1, 0);
  illustratedEnvironment.uTime.value = 99;
  resetIllustratedEnvironment();
  expect(illustratedEnvironment.uFogDensity.value).toBe(density);
  expect(illustratedEnvironment.uSunDirection.value.equals(sun)).toBe(true);
  expect(illustratedEnvironment.uTime.value).toBe(0);
});

it("keeps the line fade running near to far whichever end moves, and ignores non-finite values", () => {
  const composer = new IllustratedComposer({ setRenderTarget() {}, clear() {}, render() {} } as never);
  composer.setStyle({ fadeNear: 200, fadeFar: 900 });
  composer.setStyle({ fadeNear: 1500 });
  expect(composer.style.fadeFar).toBeGreaterThan(1500);
  composer.setStyle({ fadeNear: Number.NaN, fadeFar: Number.POSITIVE_INFINITY, fadeMin: Number.NaN, inkTint: Number.NaN, grade: Number.NaN });
  const style = composer.style;
  expect(style.fadeNear).toBe(1500);
  expect(Number.isFinite(style.fadeFar)).toBe(true);
  expect([style.fadeMin, style.inkTint, style.grade].every(Number.isFinite)).toBe(true);
  // At the default (far) fade distance the ends stay apart even in the shader's float32.
  const fresh = new IllustratedComposer({ setRenderTarget() {}, clear() {}, render() {} } as never);
  fresh.setStyle({ fadeFar: 100 });
  expect(Math.fround(fresh.style.fadeFar)).toBeGreaterThan(Math.fround(fresh.style.fadeNear));
  fresh.dispose();
  composer.dispose();
});

describe("line boil", () => {
  const make = () => new IllustratedComposer({ setRenderTarget() {}, clear() {}, render() {} } as never);

  it("is off by default and clamps the wobble to 0..3 pixels", () => {
    const composer = make();
    expect(composer.style.boil).toBe(0);
    composer.setStyle({ boil: 9 });
    expect(composer.style.boil).toBe(3);
    composer.setStyle({ boil: -1 });
    expect(composer.style.boil).toBe(0);
    composer.setStyle({ boil: 1.1 });
    composer.setStyle({ boil: Number.NaN });
    expect(composer.style.boil).toBeCloseTo(1.1);
    composer.dispose();
  });

  it("redraws BOIL_FPS times a second, holding each drawing in between", () => {
    const composer = make();
    expect(BOIL_FPS).toBe(8);
    composer.setTime(0);
    expect(composer.boilFrame).toBe(0);
    composer.setTime(0.1);
    expect(composer.boilFrame).toBe(0);
    composer.setTime(0.13);
    expect(composer.boilFrame).toBe(1);
    composer.setTime(10);
    expect(composer.boilFrame).toBe(80);
    composer.dispose();
  });

  it("holds still when time does (reduced motion) and ignores bad time", () => {
    const composer = make();
    composer.setTime(3.3);
    const frame = composer.boilFrame;
    composer.setTime(3.3);
    composer.setTime(Number.NaN);
    composer.setTime(Number.POSITIVE_INFINITY);
    expect(composer.boilFrame).toBe(frame);
    composer.setTime(-5);
    expect(composer.boilFrame).toBe(0);
    composer.dispose();
  });

  it("keeps the frame number small over a long session (exact float maths in the shader)", () => {
    const composer = make();
    composer.setTime(60 * 60 * 24);
    expect(composer.boilFrame).toBeGreaterThanOrEqual(0);
    expect(composer.boilFrame).toBeLessThan(1000);
    composer.dispose();
  });

  it("only moves where lines are looked for: fills and debug views are sampled where they are", () => {
    let outline: ShaderMaterial | undefined;
    const renderer = { autoClear: true, setRenderTarget: () => {}, clear: () => {}, render: (scene: Scene) => {
      const mesh = scene.children[0] as Mesh;
      if (mesh?.material && "uniforms" in mesh.material) outline = mesh.material as ShaderMaterial;
    } } as unknown as WebGLRenderer;
    const composer = new IllustratedComposer(renderer);
    composer.render(new Scene(), new PerspectiveCamera());
    const shader = outline!.fragmentShader;
    expect(shader).toContain("vec4 color = texture(tColor, vUv);");
    expect(shader).toContain("edgeAt(lineUv,");
    // The per-frame seed stays small, so the noise hash keeps its float precision on every boil frame.
    expect(shader).toMatch(/seed = fract\(/);
    expect(shader).not.toContain("`");
    composer.dispose();
  });
});

describe("see-through canopies", () => {
  it("cuts only materials that ask for it, and only with world lighting", async () => {
    const { createIllustratedMaterial, illustratedEnvironment } = await import("./material");
    const leaf = createIllustratedMaterial({ color: "#4c8a5c", lighting: "world", seeThrough: true });
    const wall = createIllustratedMaterial({ color: "#c39a68", lighting: "world" });
    const flat = createIllustratedMaterial({ color: "#4c8a5c", seeThrough: true });
    expect(leaf.defines).toHaveProperty("ILLUSTRATED_SEE_THROUGH");
    expect(wall.defines).not.toHaveProperty("ILLUSTRATED_SEE_THROUGH");
    expect(flat.defines).not.toHaveProperty("ILLUSTRATED_SEE_THROUGH");
    // The focus and radius are shared by reference, so a scene sets them once a frame for every canopy.
    expect(leaf.uniforms.uFocus).toBe(illustratedEnvironment.uFocus);
    expect(leaf.uniforms.uSeeThrough).toBe(illustratedEnvironment.uSeeThrough);
    expect(leaf.fragmentShader).toContain("#ifdef ILLUSTRATED_SEE_THROUGH");
    expect(leaf.fragmentShader).toContain("discard");
    for (const material of [leaf, wall, flat]) material.dispose();
  });

  it("is off until a scene turns it on, and resetIllustratedEnvironment turns it off again", async () => {
    const { illustratedEnvironment, resetIllustratedEnvironment } = await import("./material");
    expect(illustratedEnvironment.uSeeThrough.value).toBe(0);
    illustratedEnvironment.uSeeThrough.value = 3;
    illustratedEnvironment.uFocus.value.set(1, 2, 3);
    resetIllustratedEnvironment();
    expect(illustratedEnvironment.uSeeThrough.value).toBe(0);
    expect(illustratedEnvironment.uFocus.value.lengthSq()).toBe(0);
  });
});

describe("depth prepass and smoothing", () => {
  type Call = { scene: Scene; override: unknown; layers: number; shadowsDue: boolean; target: unknown };
  /** A renderer that only notes what it is asked to draw, with a shadow map waiting to be redrawn. */
  function recorder(outputColorSpace = "srgb") {
    const calls: Call[] = [];
    const shadowMap = { autoUpdate: false, needsUpdate: true };
    let target: unknown = null;
    const renderer = {
      autoClear: true, outputColorSpace, shadowMap,
      setRenderTarget: (next: unknown) => { target = next; },
      clear: () => {},
      render: (scene: Scene, camera: PerspectiveCamera) => {
        calls.push({ scene, override: scene.overrideMaterial, layers: camera.layers.mask, shadowsDue: shadowMap.needsUpdate, target });
      },
    };
    return { renderer: renderer as unknown as WebGLRenderer, calls, shadowMap };
  }

  it("draws the prepass layer depth-first with a bare material, and leaves the camera, the scene and the shadows as they were", async () => {
    const { DEPTH_PREPASS_LAYER } = await import("./material");
    const { renderer, calls, shadowMap } = recorder();
    const composer = new IllustratedComposer(renderer);
    const world = new Scene();
    const camera = new PerspectiveCamera();
    composer.render(world, camera);
    expect(calls.filter((call) => call.scene === world)).toHaveLength(1);
    calls.length = 0;

    composer.setDepthPrepass(true);
    expect(composer.depthPrepass).toBe(true);
    composer.render(world, camera);
    const [first, second] = calls;
    // First the prepass layer alone, colourless, with the shadow redraw held back...
    expect((first!.override as ShaderMaterial).name).toBe("ClockworkDepthPrepass");
    expect((first!.override as ShaderMaterial).colorWrite).toBe(false);
    expect(first!.layers).toBe(1 << DEPTH_PREPASS_LAYER);
    expect(first!.shadowsDue).toBe(false);
    // ...then everything, painted, with the shadows redrawn by the pass that sees every caster.
    expect(second!.scene).toBe(world);
    expect(second!.override).toBeNull();
    expect(second!.layers).toBe(1);
    expect(second!.shadowsDue).toBe(true);
    expect(first!.target).toBe(second!.target);
    expect(world.overrideMaterial).toBeNull();
    expect(camera.layers.mask).toBe(1);
    expect(shadowMap).toEqual({ autoUpdate: false, needsUpdate: true });
    expect(renderer.autoClear).toBe(true);
    composer.dispose();
  });

  it("smooths the finished picture through its own buffer, but never a debug view or a renderer that does not output sRGB", () => {
    const { renderer, calls } = recorder();
    const composer = new IllustratedComposer(renderer);
    composer.resize(800, 600, 1);
    const world = new Scene();
    const camera = new PerspectiveCamera();
    const passes = () => { calls.length = 0; composer.render(world, camera); return calls.map((call) => [call.scene === world ? "world" : (call.scene.children[0] as Mesh<never, ShaderMaterial>).material.name, call.target === null ? "screen" : "buffer"]); };
    expect(passes()).toEqual([["world", "buffer"], ["ClockworkOutlinePass", "screen"]]);

    composer.setSmoothing(true);
    expect(composer.smoothing).toBe(true);
    expect(passes()).toEqual([["world", "buffer"], ["ClockworkOutlinePass", "buffer"], ["ClockworkSmoothPass", "screen"]]);
    const smoothPass = (calls[2]!.scene.children[0] as Mesh<never, ShaderMaterial>).material;
    expect((smoothPass.uniforms.uTexel!.value as { x: number; y: number }).x).toBeCloseTo(1 / 800);
    expect(calls[1]!.target).not.toBe(calls[0]!.target);

    composer.setDebugView("depth");
    expect(passes()).toEqual([["world", "buffer"], ["ClockworkOutlinePass", "screen"]]);
    composer.setDebugView("final");
    composer.setSmoothing(false);
    expect(passes()).toEqual([["world", "buffer"], ["ClockworkOutlinePass", "screen"]]);
    composer.dispose();

    const linear = recorder("srgb-linear");
    const plain = new IllustratedComposer(linear.renderer);
    plain.setSmoothing(true);
    plain.render(world, camera);
    expect(linear.calls.map((call) => call.target === null)).toEqual([false, true]);
    plain.dispose();
  });

  it("finds scenery's line breaks itself, only where a line is drawn, from the world position behind each pixel", () => {
    const { renderer, calls } = recorder();
    const composer = new IllustratedComposer(renderer);
    const camera = new PerspectiveCamera(50, 2, 1, 500);
    camera.position.set(10, 20, 30);
    camera.updateMatrixWorld(true);
    composer.render(new Scene(), camera);
    const outline = (calls[1]!.scene.children[0] as Mesh<never, ShaderMaterial>).material;
    expect(outline.fragmentShader).toContain("if (amount > 0.0 && breaks[front] > 0.5) amount *= worldLineBreak(");
    // Clip space back to the world: the middle of the near plane lies one unit in front of the camera.
    const unproject = outline.uniforms.uUnproject!.value as import("three").Matrix4;
    const e = unproject.elements;
    const w = -e[11]! + e[15]!;
    expect([(-e[8]! + e[12]!) / w, (-e[9]! + e[13]!) / w, (-e[10]! + e[14]!) / w].map((v) => Number(v.toFixed(4)))).toEqual([10, 20, 29]);
    composer.dispose();
  });
});
