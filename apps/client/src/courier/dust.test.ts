import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Palette } from "../city/kit";
import { DUST_POOL, createDust } from "./dust";

const matrixOf = (mesh: THREE.InstancedMesh, index: number) => {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix;
};
const shown = (mesh: THREE.InstancedMesh) =>
  Array.from({ length: mesh.count }, (_, i) => i).filter((i) => new THREE.Vector3().setFromMatrixScale(matrixOf(mesh, i)).x > 1e-3);

describe("createDust", () => {
  it("is one instanced draw call in the mid-grey dust material, drawn into both illustration buffers", () => {
    const palette = new Palette();
    const dust = createDust(palette);
    expect(dust.mesh.count).toBe(DUST_POOL);
    expect(dust.mesh.material).toBe(palette.get("dust"));
    expect((dust.mesh.material as THREE.ShaderMaterial).fragmentShader).toContain("location = 1");
    expect(shown(dust.mesh)).toHaveLength(0);
    dust.dispose();
  });

  it("puffs around the spot, drifts out and up, then fades away", () => {
    const dust = createDust(new Palette());
    dust.spawn(10, 5, -20, 6, 2);
    expect(dust.alive).toBe(6);
    dust.update(0.1);
    const early = shown(dust.mesh).map((i) => new THREE.Vector3().setFromMatrixPosition(matrixOf(dust.mesh, i)));
    expect(early).toHaveLength(6);
    for (const p of early) {
      expect(Math.hypot(p.x - 10, p.z + 20)).toBeLessThan(2.5);
      expect(p.y).toBeGreaterThan(5);
    }
    dust.update(0.2);
    const later = shown(dust.mesh).map((i) => new THREE.Vector3().setFromMatrixPosition(matrixOf(dust.mesh, i)));
    later.forEach((p, i) => {
      expect(p.y).toBeGreaterThan(early[i]!.y);
      expect(Math.hypot(p.x - 10, p.z + 20)).toBeGreaterThan(Math.hypot(early[i]!.x - 10, early[i]!.z + 20));
    });
    dust.update(1);
    expect(dust.alive).toBe(0);
    expect(shown(dust.mesh)).toHaveLength(0);
    dust.dispose();
  });

  it("swells to about a ninth of the courier's height across and shows for about 0.4 s, as the reference's particles", () => {
    const dust = createDust(new Palette());
    dust.spawn(0, 0, 0, 1, 0.25);
    let widest = 0, shownFor = 0;
    for (let i = 0; i < 60; i += 1) {
      dust.update(1 / 60);
      const s = shown(dust.mesh).map((k) => new THREE.Vector3().setFromMatrixScale(matrixOf(dust.mesh, k)).x);
      if (s.length) { shownFor += 1 / 60; widest = Math.max(widest, ...s); }
    }
    // Radius 1 geometry: the scale is the radius. The courier is 3.79 tall (figure.ts BASE.height).
    expect(2 * widest).toBeGreaterThan(3.79 / 12);
    expect(2 * widest).toBeLessThan(3.79 / 7);
    expect(shownFor).toBeGreaterThan(0.3);
    expect(shownFor).toBeLessThan(0.55);
    dust.dispose();
  });

  it("spreads each burst all the way round (no lopsided clumps)", () => {
    const dust = createDust(new Palette());
    dust.spawn(0, 0, 0, 7, 2);
    dust.update(0.3);
    const centre = new THREE.Vector3();
    for (const i of shown(dust.mesh)) centre.add(new THREE.Vector3().setFromMatrixPosition(matrixOf(dust.mesh, i)));
    centre.divideScalar(7);
    expect(Math.hypot(centre.x, centre.z)).toBeLessThan(0.6);
    dust.dispose();
  });

  it("reuses the oldest puffs once the pool is full", () => {
    const dust = createDust(new Palette());
    for (let i = 0; i < 5; i += 1) dust.spawn(i * 50, 0, 0, 7, 1);
    expect(dust.alive).toBe(DUST_POOL);
    dust.update(0.05);
    // The newest burst (at x = 200) is all there.
    const xs = shown(dust.mesh).map((i) => new THREE.Vector3().setFromMatrixPosition(matrixOf(dust.mesh, i)).x);
    expect(xs.filter((x) => Math.abs(x - 200) < 3)).toHaveLength(7);
    dust.dispose();
  });

  it("ignores bad input and holds still on bad time", () => {
    const dust = createDust(new Palette());
    dust.spawn(Number.NaN, 0, 0, 4, 1);
    dust.spawn(0, 0, 0, Number.POSITIVE_INFINITY, 1);
    dust.spawn(0, 0, 0, -2, 1);
    expect(dust.alive).toBe(0);
    dust.spawn(0, 0, 0, 3, 1);
    const before = matrixOf(dust.mesh, 0).clone();
    dust.update(Number.NaN);
    dust.update(-1);
    expect(matrixOf(dust.mesh, 0).equals(before)).toBe(true);
    dust.clear();
    expect(dust.alive).toBe(0);
    expect(shown(dust.mesh)).toHaveLength(0);
    dust.dispose();
  });
});

describe("dust shape", () => {
  it("has a ragged outline, like the reference's noise-broken particles, not a clean ball", () => {
    const dust = createDust(new Palette());
    const position = dust.mesh.geometry.getAttribute("position");
    const radii = Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i).length());
    expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(1.3);
    // A corner shared by several faces sits in the same place in each, so the puff stays closed.
    const seen = new Map<string, number>();
    for (let i = 0; i < position.count; i += 1) {
      const p = new THREE.Vector3().fromBufferAttribute(position, i);
      const key = p.clone().normalize().toArray().map((v) => v.toFixed(4)).join(",");
      const radius = seen.get(key);
      if (radius === undefined) seen.set(key, p.length());
      else expect(Math.abs(radius - p.length())).toBeLessThan(1e-6);
    }
    dust.dispose();
  });

  it("uses smooth normals, so the line pass inks each puff's outline and not its facets", () => {
    const dust = createDust(new Palette());
    const geometry = dust.mesh.geometry;
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
      p.fromBufferAttribute(position, i).normalize();
      n.fromBufferAttribute(normal, i);
      expect(n.dot(p)).toBeGreaterThan(0.999);
    }
    dust.dispose();
  });
});
