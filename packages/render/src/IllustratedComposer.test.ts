import { describe, expect, it } from "vitest";
import { Scene, PerspectiveCamera, type WebGLRenderer, type ShaderMaterial, type Mesh } from "three";
import { IllustratedComposer } from "./IllustratedComposer";

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
