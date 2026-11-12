import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Palette } from "../city/kit";
import { AUTHORED_EYE_MASK, AUTHORED_GEOMETRIES, AUTHORED_RIG } from "./authoredAssets";
import { createFigurePose, poseFigure, type FigurePose } from "./figure";
import { createHumanGait, humanPose, updateHumanGait } from "./humanGait";
import { createCourierModel } from "./models";
import { COURIER_HEIGHT } from "./size";
import { WALK } from "./walker";

const build = () => createCourierModel(new Palette(() => "#ffffff"), true).figure!;
const referenced = (mesh: THREE.SkinnedMesh) => [...new Set(Array.from(mesh.geometry.getIndex()!.array))];

function updateSkin(mesh: THREE.SkinnedMesh): void {
  mesh.updateWorldMatrix(true, true);
  mesh.skeleton.update();
}

function worldPoint(mesh: THREE.SkinnedMesh, index: number): THREE.Vector3 {
  const point = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), index);
  mesh.applyBoneTransform(index, point);
  return point.applyMatrix4(mesh.matrixWorld);
}

/** The same weighted normal transform used by Three.js's skinning shader. */
function worldNormal(mesh: THREE.SkinnedMesh, index: number): THREE.Vector3 {
  const indices = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
  const skin = new THREE.Matrix4();
  skin.elements.fill(0);
  const bone = new THREE.Matrix4();
  for (let component = 0; component < 4; component += 1) {
    bone.fromArray(mesh.skeleton.boneMatrices!, indices.getComponent(index, component) * 16);
    const weight = weights.getComponent(index, component);
    for (let at = 0; at < 16; at += 1) skin.elements[at]! += bone.elements[at]! * weight;
  }
  skin.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
  return new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute("normal"), index)
    .applyMatrix3(new THREE.Matrix3().setFromMatrix4(skin))
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
}

describe("authored courier geometry", () => {
  it("uses the full 22-bone reference hierarchy with valid normalized influences", () => {
    const figure = build(), mesh = figure.mesh;
    expect(mesh.name).toBe("authoredCourier");
    expect(figure.applyAuthoredPose).toBeTypeOf("function");
    expect(mesh.skeleton.bones).toHaveLength(22);
    for (const source of AUTHORED_RIG.bones) {
      const actual = mesh.skeleton.bones[source.index]!;
      expect(actual.parent).toBe(source.parent < 0 ? mesh : mesh.skeleton.bones[source.parent]);
    }
    const indices = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
    for (let i = 0; i < weights.count; i += 1) {
      let sum = 0;
      for (let j = 0; j < 4; j += 1) {
        const bone = indices.getComponent(i, j), weight = weights.getComponent(i, j);
        expect(Number.isInteger(bone)).toBe(true);
        expect(bone).toBeGreaterThanOrEqual(0);
        expect(bone).toBeLessThan(22);
        expect(Number.isFinite(weight)).toBe(true);
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(1);
        sum += weight;
      }
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it("preserves source UVs and both authored eye patches facing runtime forward", () => {
    const figure = build(), mesh = figure.mesh, uv = mesh.geometry.getAttribute("uv");
    const sourceUV = ["base", "hair3", "top2", "bottom2", "shoes3"].flatMap((name) => AUTHORED_GEOMETRIES[name as keyof typeof AUTHORED_GEOMETRIES].attributes.uv.array);
    expect(Array.from(uv.array)).toEqual(sourceUV);
    const eyes = referenced(mesh).filter((i) => uv.getY(i) > 1);
    expect(eyes).toHaveLength(22);
    const slots = mesh.geometry.getAttribute("partSlot");
    for (const i of eyes) expect(slots.getX(i)).toBe(0);
    const edges = new Map(eyes.map((i) => [i, new Set<number>()]));
    const index = mesh.geometry.getIndex()!;
    for (let at = 0; at < index.count; at += 3) {
      const triangle = [index.getX(at), index.getX(at + 1), index.getX(at + 2)].filter((i) => edges.has(i));
      for (const a of triangle) for (const b of triangle) if (a !== b) edges.get(a)!.add(b);
    }
    const remaining = new Set(eyes), patchSizes: number[] = [];
    while (remaining.size) {
      const queue = [remaining.values().next().value!];
      remaining.delete(queue[0]!);
      for (let at = 0; at < queue.length; at += 1) for (const next of edges.get(queue[at]!)!) {
        if (remaining.delete(next)) queue.push(next);
      }
      patchSizes.push(queue.length);
    }
    expect(patchSizes.sort((a, b) => a - b)).toEqual([11, 11]);
    updateSkin(mesh);
    const forward = eyes.reduce((normal, i) => normal.add(worldNormal(mesh, i)), new THREE.Vector3()).normalize();
    expect(forward.dot(new THREE.Vector3(0, 0, -1))).toBeGreaterThan(0.85);
    expect(AUTHORED_EYE_MASK.width).toBe(256);
    expect(AUTHORED_EYE_MASK.height).toBe(64);
    expect(AUTHORED_EYE_MASK.data).toHaveLength(256 * 64);
  });

  it("fits the actual indexed rest surface to the target height and shoe floor", () => {
    const figure = build(), mesh = figure.mesh;
    updateSkin(mesh);
    const points = referenced(mesh).map((i) => worldPoint(mesh, i));
    const bounds = new THREE.Box3().setFromPoints(points);
    expect(Math.abs(bounds.max.y - bounds.min.y - COURIER_HEIGHT)).toBeLessThan(0.03);
    expect(Math.abs(bounds.min.y)).toBeLessThan(0.02);
    const slots = mesh.geometry.getAttribute("partSlot");
    const soles = [-1, 1].map((side) => Math.min(...referenced(mesh)
      .filter((i) => slots.getX(i) === 4 && Math.sign(mesh.geometry.getAttribute("position").getX(i)) === side)
      .map((i) => worldPoint(mesh, i).y)));
    for (const sole of soles) expect(Math.abs(sole)).toBeLessThan(0.02);
    const sourceThigh = new THREE.Vector3().fromArray(AUTHORED_RIG.bones[14]!.worldPosition);
    const sourceKnee = new THREE.Vector3().fromArray(AUTHORED_RIG.bones[15]!.worldPosition);
    const sourceAnkle = new THREE.Vector3().fromArray(AUTHORED_RIG.bones[16]!.worldPosition);
    const thigh = figure.bones.thigh[0].getWorldPosition(new THREE.Vector3());
    const knee = figure.bones.shin[0].getWorldPosition(new THREE.Vector3());
    const ankle = figure.bones.foot[0].getWorldPosition(new THREE.Vector3());
    expect(thigh.distanceTo(knee) / figure.scale).toBeCloseTo(sourceThigh.distanceTo(sourceKnee), 4);
    expect(knee.distanceTo(ankle) / figure.scale).toBeCloseTo(sourceKnee.distanceTo(sourceAnkle), 4);
  });

  it("keeps every indexed surface and normal finite through gait and extreme joint poses", () => {
    const figure = build(), mesh = figure.mesh, poses: FigurePose[] = [createFigurePose()];
    for (const speed of [2.2, WALK.walkSpeed, WALK.runSpeed]) {
      const gait = createHumanGait();
      for (let frame = 0; frame < 180; frame += 1) updateHumanGait(gait, { dt: 1 / 60, distance: speed / 60, speed, heading: 0, y: 0, reduced: false, scale: figure.scale, pace: figure.pace, leg: figure.leg });
      for (const phase of [0, 0.25, 0.5, 0.75]) {
        gait.phase = phase;
        poses.push(humanPose(gait, createFigurePose(), figure.leg));
      }
    }
    const extreme = createFigurePose();
    Object.assign(extreme.hips, { y: -0.1, yaw: 0.4, roll: -0.2 });
    Object.assign(extreme.spine, { pitch: -0.3, yaw: -0.2 });
    Object.assign(extreme.head, { pitch: 0.3, yaw: 0.8, roll: 0.2 });
    Object.assign(extreme.legs[0], { hip: 1.2, knee: 2, ankle: -0.4, hipOut: 0.3 });
    Object.assign(extreme.legs[1], { hip: -0.8, knee: 1.1, ankle: 0.3 });
    Object.assign(extreme.arms[0], { swing: 1.2, elbow: 2.1, out: 0.6 });
    Object.assign(extreme.arms[1], { swing: -1, elbow: 0.4, out: 0.4 });
    extreme.eyes = 0;
    poses.push(extreme);
    const vertices = referenced(mesh);
    for (const [poseIndex, pose] of poses.entries()) {
      poseFigure(figure, pose);
      updateSkin(mesh);
      const points: THREE.Vector3[] = [];
      for (const index of vertices) {
        const point = worldPoint(mesh, index), normal = worldNormal(mesh, index);
        expect([...point.toArray(), ...normal.toArray()].every(Number.isFinite), `pose ${poseIndex}, vertex ${index}`).toBe(true);
        expect(normal.length(), `pose ${poseIndex}, vertex ${index}`).toBeCloseTo(1, 5);
        points.push(point);
      }
      expect(new THREE.Box3().setFromPoints(points).getSize(new THREE.Vector3()).length()).toBeLessThan(COURIER_HEIGHT * 3);
    }
  });
});
