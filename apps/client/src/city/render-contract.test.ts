import { expect, it } from "vitest";
import * as THREE from "three";
import { buildCity, handsGeometry } from "./buildCity";

const city = buildCity();

function materialsOf(object: THREE.Object3D): THREE.Material[] {
  const material = (object as THREE.Mesh).material;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

it("draws every city surface into both illustration buffers", () => {
  const incompatible: string[] = [];
  city.group.traverse((object) => {
    for (const material of materialsOf(object)) {
      if (!(material instanceof THREE.ShaderMaterial) || !material.fragmentShader.includes("location = 1")) incompatible.push(object.name || object.type);
    }
  });
  expect(incompatible).toEqual([]);
});

it("stays within the draw-call budget", () => {
  let meshes = 0;
  city.group.traverse((object) => { if (object instanceof THREE.Mesh) meshes += 1; });
  expect(meshes).toBeLessThanOrEqual(60);
});

it("gives every material its own surface id so the ink pass outlines where they meet", () => {
  const materials = new Set<THREE.ShaderMaterial>();
  city.group.traverse((object) => materialsOf(object).forEach((material) => materials.add(material as THREE.ShaderMaterial)));
  const ids = [...materials].map((material) => material.uniforms.uSurfaceId?.value as number);
  expect(new Set(ids).size).toBe(materials.size);
  expect(Math.max(...ids)).toBeLessThan(1);
});

it("builds four clock faces, a focus point per district and the ticking parts", () => {
  expect(city.faces).toHaveLength(4);
  expect(city.focusPoints).toHaveLength(8);
  expect(city.spinners.length).toBeGreaterThanOrEqual(7);
  expect(city.anchor.parent).toBe(city.group);
  const hands = handsGeometry(city.faces, Math.PI / 2, Math.PI);
  expect(hands.getAttribute("position").count).toBeGreaterThan(0);
});
