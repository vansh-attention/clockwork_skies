import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SETT_LIFT, buildCity, handsGeometry } from "./buildCity";
import { STAIR_BEARINGS, SUMMIT, polarToXZ } from "./layout";
import { LANTERNFALL_CENTER, buildLanternfall, buildLaunchersAndGates } from "../courier/outpost";
import { createBeacon, createCourierModel } from "../courier/models";
import { createPlaneModel } from "../planeModel";
import { buildAmbient } from "./ambient";
import { Sky } from "./sky";
import { createHillTownWalkWorld } from "../courier/walkWorld";

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

it("lays granite setts on the summit: a frame round the plinth and a path to every stairway head", () => {
  const setts: THREE.Vector3[] = [];
  city.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.name !== "roof0") return;
    const position = object.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i += 1) {
      const point = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      if (Math.abs(point.y - (SUMMIT.top + SETT_LIFT)) < 1e-4) setts.push(point);
    }
  });
  expect(setts.length).toBeGreaterThanOrEqual(12 * 4);
  // Every stairway gets a path reaching the summit's edge.
  for (const bearing of STAIR_BEARINGS) {
    const out = polarToXZ(bearing, SUMMIT.radius - 0.5);
    expect(setts.some((point) => Math.hypot(point.x - out.x, point.z - out.z) < 3.5)).toBe(true);
  }
  // None under the tower plinth (it would only fight the stone).
  for (const point of setts) expect(Math.max(Math.abs(point.x), Math.abs(point.z))).toBeGreaterThanOrEqual(18 - 1e-6);
});

it("builds four clock faces, a focus point per district and the ticking parts", () => {
  expect(city.faces).toHaveLength(4);
  expect(city.focusPoints).toHaveLength(8);
  expect(city.spinners.length).toBeGreaterThanOrEqual(7);
  expect(city.anchor.parent).toBe(city.group);
  const hands = handsGeometry(city.faces, Math.PI / 2, Math.PI);
  expect(hands.getAttribute("position").count).toBeGreaterThan(0);
});

describe("the whole playable world", () => {
  // The same assembly CityScene and CourierController make: one palette for the town, both outposts, the courier and beacon.
  const lanternfall = buildLanternfall(city.palette);
  const launchers = buildLaunchersAndGates(city.palette);
  const courier = createCourierModel(city.palette);
  const beacon = createBeacon(city.palette);
  const plane = createPlaneModel("brass", "world");
  const ambient = buildAmbient(city.palette, createHillTownWalkWorld());
  const sky = new Sky();
  const parts = [city.group, lanternfall.group, launchers.group, courier.group, beacon, plane.group, ambient.group, sky.dome];

  const meshesOf = (root: THREE.Object3D) => {
    const meshes: THREE.Mesh[] = [];
    root.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
    return meshes;
  };

  it("draws Lanternfall, the launchers, the gates, the courier and the plane into both illustration buffers", () => {
    const incompatible = parts.flatMap(meshesOf).flatMap((mesh) => materialsOf(mesh)
      .filter((material) => !(material instanceof THREE.ShaderMaterial) || !material.fragmentShader.includes("location = 1"))
      .map(() => mesh.name || mesh.type));
    expect(incompatible).toEqual([]);
  });

  it("stays within the 110 draw-call world budget (sky, grass, pennants, birds and smoke included)", () => {
    expect(parts.reduce((total, part) => total + meshesOf(part).length, 0)).toBeLessThanOrEqual(110);
  });

  it("builds Lanternfall with its lighthouse lamp and rim gear ticking, and puts it where the flight world expects", () => {
    expect(lanternfall.group.name).toBe("Lanternfall Isle");
    expect(lanternfall.group.position.toArray()).toEqual([LANTERNFALL_CENTER.x, LANTERNFALL_CENTER.y, LANTERNFALL_CENTER.z]);
    expect(lanternfall.spinners.length).toBeGreaterThanOrEqual(2);
    expect(meshesOf(lanternfall.group).length).toBeGreaterThan(5);
    expect(meshesOf(launchers.group).length).toBeGreaterThan(2);
  });

  it("keeps every palette surface id below 1 after the whole world is built", () => {
    const ids = new Set<number>();
    for (const part of [city.group, lanternfall.group, launchers.group, courier.group, beacon, ambient.group]) {
      for (const mesh of meshesOf(part)) for (const material of materialsOf(mesh)) ids.add((material as THREE.ShaderMaterial).uniforms.uSurfaceId?.value as number);
    }
    expect(Math.max(...ids)).toBeLessThan(1);
  });
});
