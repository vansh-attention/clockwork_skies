import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { animateFigureExpression, COURIER_LOOK, createFigure, createFigureMaterial, createFigurePose, poseFigure, type FigureLook } from "./figure";
import { COURIER_HEIGHT } from "./size";

const material = createFigureMaterial();
const create = (extra: Partial<FigureLook> = {}) => createFigure({ ...COURIER_LOOK, ...extra }, material);
const wardrobeBase = { stature: undefined, cap: undefined, ribbon: undefined, bow: undefined };
const geometryPoints = (figure: ReturnType<typeof create>) => figure.mesh.geometry.getAttribute("position");

function colouredBounds(figure: ReturnType<typeof create>, garment: number, fromY = -Infinity, toY = Infinity) {
  const points = geometryPoints(figure);
  const ids = figure.mesh.geometry.getAttribute("idShift");
  const list: THREE.Vector3[] = [];
  for (let i = 0; i < points.count; i += 1) if (Math.round(ids.getX(i) / 0.0062) === garment && points.getY(i) >= fromY && points.getY(i) <= toY) list.push(new THREE.Vector3().fromBufferAttribute(points, i));
  return new THREE.Box3().setFromPoints(list);
}

describe("cozy anime figures", () => {
  it("keeps the player fitted height and one skinned draw across the new streetwear options", () => {
    expect(create().height).toBeCloseTo(COURIER_HEIGHT, 3);
    for (const garment of ["jacket", "hoodie", "cardigan"] as const) {
      const figure = create({ ...wardrobeBase, garment, fit: 1.2 });
      expect(figure.group.children).toEqual([figure.mesh]);
      expect(figure.mesh).toBeInstanceOf(THREE.SkinnedMesh);
      expect((figure.mesh.geometry.getIndex()?.count ?? 0) / 3).toBeLessThan(20000);
      const weights = figure.mesh.geometry.getAttribute("skinWeight");
      for (let i = 0; i < weights.count; i += 1) expect(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)).toBeCloseTo(1, 5);
    }
  });

  it("authors a resting hood and open cardigan instead of recolouring the same jacket", () => {
    const jacket = create({ ...wardrobeBase, garment: "jacket", collar: "stand", pockets: false });
    const hoodie = create({ ...wardrobeBase, garment: "hoodie", collar: "stand", pockets: false });
    const cardigan = create({ ...wardrobeBase, garment: "cardigan", collar: "stand", pockets: false, shirt: "#f0e9da" });
    const jacketBack = colouredBounds(jacket, 2, 2.7, 3.2).max.z;
    const hoodBack = Math.max(colouredBounds(hoodie, 2, 2.7, 3.2).max.z, colouredBounds(hoodie, 3, 2.7, 3.2).max.z);
    expect(hoodBack).toBeGreaterThan(jacketBack + 0.05);
    expect(geometryPoints(hoodie).count).toBeGreaterThan(geometryPoints(jacket).count);
    expect(geometryPoints(cardigan).count).not.toBe(geometryPoints(hoodie).count);
    const color = cardigan.mesh.geometry.getAttribute("color");
    const shirt = new THREE.Color("#f0e9da");
    expect(Array.from({ length: color.count }, (_, i) => Math.abs(color.getX(i) - shirt.r) + Math.abs(color.getY(i) - shirt.g) + Math.abs(color.getZ(i) - shirt.b)).some((distance) => distance < 1e-5)).toBe(true);
  });

  it("makes relaxed jeans fuller at the calf without changing bones or the sole envelope", () => {
    const slim = create({ ...wardrobeBase, trouserFit: 1 });
    const relaxed = create({ ...wardrobeBase, trouserFit: 1.28 });
    expect(colouredBounds(relaxed, 4, 0.5, 0.85).max.x).toBeGreaterThan(colouredBounds(slim, 4, 0.5, 0.85).max.x + 0.03);
    expect(relaxed.leg).toEqual(slim.leg);
    expect(colouredBounds(relaxed, 7)).toEqual(colouredBounds(slim, 7));
  });

  it("keeps the cream spread collar above the convex jacket, including the middle of each folded panel", () => {
    const figure = create({ garment: "jacket", collar: "spread", trim: "#e4e1ce" });
    figure.group.updateMatrixWorld(true);
    const geometry = figure.mesh.geometry;
    const index = geometry.getIndex()!;
    const positions = geometry.getAttribute("position");
    const ids = geometry.getAttribute("idShift");
    const colors = geometry.getAttribute("color");
    const trim = new THREE.Color("#e4e1ce");
    const garment = (i: number) => Math.round(ids.getX(i) / 0.0062);
    let tested = 0;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      if (garment(a) !== 3 || Math.abs(colors.getX(a) - trim.r) > 0.001) continue;
      const centre = [a, b, c].reduce((sum, vertex) => sum.add(new THREE.Vector3().fromBufferAttribute(positions, vertex)), new THREE.Vector3()).multiplyScalar(1 / 3);
      if (centre.y < 2.23 || centre.z >= 0 || Math.abs(centre.x) < 0.06) continue;
      const hit = new THREE.Raycaster(new THREE.Vector3(centre.x, centre.y, -3), new THREE.Vector3(0, 0, 1)).intersectObject(figure.mesh)[0];
      expect(hit).toBeDefined();
      // The dispatch strap may cross the collar; the red body may never swallow its folded centre.
      expect([3, 9]).toContain(garment(index.getX(hit!.faceIndex! * 3)));
      tested += 1;
    }
    expect(tested).toBeGreaterThan(30);
  });

  it("closes each streetwear shoulder's first ring instead of leaving a visible cup rim", () => {
    for (const garment of ["jacket", "hoodie", "cardigan"] as const) {
      const figure = create({ garment });
      const geometry = figure.mesh.geometry;
      const ids = geometry.getAttribute("idShift");
      const index = geometry.getIndex()!;
      let start = 0;
      while (Math.round(ids.getX(start) / 0.0062) !== 2) start += 1;
      // The first jacket component is the left sleeve. Its sixteen-vertex shoulder ring must have a cap and side.
      const edges = new Map<string, number>();
      for (let i = 0; i < index.count; i += 3) for (let edge = 0; edge < 3; edge += 1) {
        const a = index.getX(i + edge), b = index.getX(i + (edge + 1) % 3);
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
      for (let i = 0; i < 16; i += 1) {
        const a = start + i, b = start + (i + 1) % 16;
        expect(edges.get(`${Math.min(a, b)}:${Math.max(a, b)}`), garment).toBe(2);
      }
    }
  });

  it("blinks visibly, makes small lively gaze shifts and does not synchronize different residents", () => {
    const figure = create();
    const pose = createFigurePose();
    poseFigure(figure, pose);
    animateFigureExpression(figure, 3.0, false, 0);
    expect(figure.bones.eyes.scale.y).toBe(1);
    const before = figure.bones.head.rotation.y;
    poseFigure(figure, pose);
    animateFigureExpression(figure, 3.2, false, 0);
    expect(figure.bones.eyes.scale.y).toBeCloseTo(0.08);
    expect(figure.bones.head.rotation.y).not.toBe(before);
    expect(Math.abs(figure.bones.eyes.position.x - figure.eyesRest.x)).toBeLessThan(0.004);
    poseFigure(figure, pose);
    animateFigureExpression(figure, 3.2, false, 2);
    expect(figure.bones.eyes.scale.y).toBe(1);
  });

  it("holds expressions still under reduced motion and restores the gaze centre each frame", () => {
    const figure = create();
    const pose = createFigurePose();
    const sample = (time: number) => {
      poseFigure(figure, pose);
      animateFigureExpression(figure, time, true);
      return [figure.bones.eyes.position.toArray(), figure.bones.head.rotation.toArray(), figure.bones.eyes.scale.toArray()];
    };
    expect(sample(0)).toEqual(sample(3.2));
    expect(sample(0)).toEqual(sample(100));
  });
});
