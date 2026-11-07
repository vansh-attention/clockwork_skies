import { expect, it } from "vitest";
import * as THREE from "three";
import { PAINTS } from "@clockwork/content";
import { createPlaneModel } from "./planeModel";

function meshes(root: THREE.Object3D) {
  const found: THREE.Mesh[] = [];
  root.traverse((object) => { if (object instanceof THREE.Mesh) found.push(object); });
  return found;
}

it("builds 8 meshes that all use the illustrated shader", () => {
  const { group } = createPlaneModel(PAINTS[0]!.id);
  const all = meshes(group);
  expect(all).toHaveLength(8);
  for (const mesh of all) {
    const material = mesh.material as THREE.ShaderMaterial;
    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.fragmentShader).toContain("location = 1");
  }
});

it("exposes the propeller as a 3-blade child of the group", () => {
  const { group, propeller } = createPlaneModel(PAINTS[0]!.id);
  expect(propeller.parent).toBe(group);
  expect(propeller.children).toHaveLength(3);
  expect(group.userData.propeller).toBe(propeller);
});

it("points the nose toward -Z", () => {
  const { group, propeller } = createPlaneModel(PAINTS[0]!.id);
  const bounds = new THREE.Box3().setFromObject(group);
  // The nose (and propeller) reach well forward; the tail stops short behind.
  expect(bounds.min.z).toBeLessThan(-6.9);
  expect(bounds.max.z).toBeLessThan(5);
  expect(propeller.position.z).toBe(-7);
});

it("falls back to the first paint for an unknown id", () => {
  const { group } = createPlaneModel("no-such-paint");
  const body = meshes(group)[0]!.material as THREE.ShaderMaterial;
  expect((body.uniforms.uColor!.value as THREE.Color).getHex()).toBe(new THREE.Color(PAINTS[0]!.body).getHex());
});

it("creates fresh materials per call", () => {
  const a = meshes(createPlaneModel(PAINTS[0]!.id).group)[0]!.material;
  const b = meshes(createPlaneModel(PAINTS[0]!.id).group)[0]!.material;
  expect(a).not.toBe(b);
});
