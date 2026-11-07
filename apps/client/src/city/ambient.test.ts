import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createHillTownWalkWorld } from "../courier/walkWorld";
import { PUFFS_PER_CHIMNEY, buildAmbient } from "./ambient";
import { Palette, addHouse } from "./kit";
import { STREET, TERRACES, createCityLayout } from "./layout";

const layout = createCityLayout();
const world = createHillTownWalkWorld(layout);
const ambient = buildAmbient(new Palette(), world, layout);

const instancePosition = (mesh: THREE.InstancedMesh, index: number) => {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
};
const instanceScale = (mesh: THREE.InstancedMesh, index: number) => {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixScale(matrix);
};

describe("buildAmbient", () => {
  it("costs four draw calls, all drawn into both illustration buffers", () => {
    const meshes: THREE.Mesh[] = [];
    ambient.group.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
    expect(meshes).toHaveLength(4);
    for (const mesh of meshes) {
      const material = mesh.material as THREE.ShaderMaterial;
      expect(material.fragmentShader).toContain("location = 1");
    }
  });

  it("grows grass only on lawns: never on a ring street or inside a house", () => {
    expect(ambient.grass.count).toBeGreaterThan(800);
    for (let i = 0; i < ambient.grass.count; i += 1) {
      const p = instancePosition(ambient.grass, i);
      const r = Math.hypot(p.x, p.z);
      for (const terrace of TERRACES) {
        expect(r > terrace.radius - STREET.inset && r < terrace.radius - STREET.inset + STREET.width).toBe(false);
      }
      expect(world.blocked(p.x, p.z, 1)).toBe(false);
      expect(p.y).toBeCloseTo(world.surfaceAt(p.x, p.z).height, 6);
    }
  });

  it("keeps the wind weights on grass tips and pennant ends (roots and poles stay still)", () => {
    const tuftSway = ambient.grass.geometry.getAttribute("sway");
    const tuftY = ambient.grass.geometry.getAttribute("position");
    for (let i = 0; i < tuftSway.count; i += 1) if (tuftY.getY(i) < 1e-6) expect(tuftSway.getX(i)).toBeCloseTo(0, 6);
    expect(Math.max(...Array.from(tuftSway.array as Float32Array))).toBeGreaterThan(0.4);
    const pennantSway = ambient.pennants.geometry.getAttribute("sway");
    expect(pennantSway).toBeDefined();
    const weights = Array.from(pennantSway.array as Float32Array);
    expect(weights.filter((weight) => weight === 0).length).toBeGreaterThan(0);
    expect(Math.max(...weights)).toBeGreaterThan(0.5);
  });

  it("flies the birds well above the town, flapping", () => {
    ambient.update(3, 3, false);
    const first = instanceScale(ambient.birds, 0).y;
    for (let i = 0; i < ambient.birds.count; i += 1) expect(instancePosition(ambient.birds, i).y).toBeGreaterThan(100);
    const before = instancePosition(ambient.birds, 0);
    ambient.update(3.4, 3.4, false);
    expect(instancePosition(ambient.birds, 0).distanceTo(before)).toBeGreaterThan(1);
    expect(instanceScale(ambient.birds, 0).y).not.toBeCloseTo(first, 3);
  });

  it("never mirrors a bird mid-flap (a mirrored instance would draw inside out)", () => {
    for (let t = 0; t < 2; t += 0.05) {
      ambient.update(t, t, false);
      for (let i = 0; i < ambient.birds.count; i += 1) {
        const matrix = new THREE.Matrix4();
        ambient.birds.getMatrixAt(i, matrix);
        expect(matrix.determinant()).toBeGreaterThan(0);
      }
    }
  });

  it("puts the puffs over the chimneys addHouse actually builds", () => {
    // The chimney pots are the clay ("roof2") cylinders addHouse puts highest; the puffs rise from between them.
    const batch = { parts: [] as THREE.BufferGeometry[], add(key: string, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4) {
      if (key === "roof2" && matrix && geometry.type === "CylinderGeometry") this.parts.push(geometry.applyMatrix4(matrix));
    } };
    const house = layout.houses.find((candidate) => candidate.chimney)!;
    addHouse(batch as never, house);
    expect(batch.parts).toHaveLength(2);
    const pots = batch.parts.map((part) => { part.computeBoundingBox(); return part.boundingBox!; });
    const pair = pots[0]!.clone().union(pots[1]!);
    const top = ambient.chimneys[layout.houses.filter((candidate) => candidate.chimney).indexOf(house)]!;
    expect(top.y).toBeCloseTo(pair.max.y, 3);
    expect(top.x).toBeCloseTo((pair.min.x + pair.max.x) / 2, 3);
    expect(top.z).toBeCloseTo((pair.min.z + pair.max.z) / 2, 3);
  });

  it("puffs smoke from every chimney top, rising as the town ticks", () => {
    expect(ambient.chimneys.length).toBe(layout.houses.filter((house) => house.chimney).length);
    expect(ambient.puffs.count).toBe(ambient.chimneys.length * PUFFS_PER_CHIMNEY);
    ambient.update(0, 0.5, false);
    const low = instancePosition(ambient.puffs, 0);
    ambient.update(0, 1.5, false);
    const high = instancePosition(ambient.puffs, 0);
    expect(high.y).toBeGreaterThan(low.y + 1);
    const top = ambient.chimneys[0]!;
    expect(Math.hypot(low.x - top.x, low.z - top.z)).toBeLessThan(6);
    expect(low.y).toBeGreaterThan(top.y);
  });

  it("holds a still frame under reduced motion", () => {
    ambient.update(10, 10, true);
    const birds = Array.from({ length: ambient.birds.count }, (_, i) => instancePosition(ambient.birds, i));
    const puff = instancePosition(ambient.puffs, 0);
    ambient.update(55, 55, true);
    birds.forEach((p, i) => expect(instancePosition(ambient.birds, i).distanceTo(p)).toBeLessThan(1e-9));
    expect(instancePosition(ambient.puffs, 0).distanceTo(puff)).toBeLessThan(1e-9);
  });
});
