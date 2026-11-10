import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildCity } from "../city/buildCity";
import { Palette } from "../city/kit";
import { animateBeacon, animateCourier, createBeacon, createCourierModel, disposeModel } from "./models";
import { createGait, createPose, gaitPose, updateGait } from "./gait";
import { COURIER_LOOK, createFigure, createFigureMaterial, createFigurePose, poseFigure, type FigureLook } from "./figure";
import { createResidentAgents, residentLook } from "../city/residents";
import { createHumanGait, gaitTables, humanPose, updateHumanGait } from "./humanGait";
import { COURIER_HEIGHT } from "./size";
import { WALK } from "./walker";

const ALLOWED = ["wall0", "copper", "ink", "water", "brass"] as const;

function setup() {
  const palette = new Palette((i) => ["#c45f45", "#e1a74f", "#4f9184"][i]);
  const requested: string[] = [];
  const spy = {
    get: (key: Parameters<Palette["get"]>[0]) => {
      requested.push(key);
      return palette.get(key);
    },
  };
  return { palette, spy, requested };
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  return meshes;
}

function snapshot(root: THREE.Object3D): string[] {
  const out: string[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => out.push(o.matrixWorld.elements.join(",")));
  return out;
}

describe("createCourierModel", () => {
  it("uses only shared illustrated materials from the palette", () => {
    const { palette, spy, requested } = setup();
    const { group } = createCourierModel(spy);
    expect(requested.length).toBeGreaterThan(0);
    for (const key of requested) expect(ALLOWED).toContain(key);
    const shared = new Set<THREE.Material>(ALLOWED.map((k) => palette.get(k)));
    const meshes = meshesOf(group);
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      const material = mesh.material;
      expect(material).toBeInstanceOf(THREE.ShaderMaterial);
      expect((material as THREE.ShaderMaterial).fragmentShader).toContain("location = 1");
      expect(shared.has(material as THREE.Material)).toBe(true);
    }
  });

  it("stays within 16 meshes and exposes every joint of the rig", () => {
    const { spy } = setup();
    const model = createCourierModel(spy);
    expect(meshesOf(model.group).length).toBeLessThanOrEqual(16);
    const { rig } = model;
    const joints = [rig.body, rig.torso, rig.head, rig.key, ...rig.arms, ...rig.legs.flatMap((leg) => [leg.thigh, leg.shin, leg.foot])];
    expect(new Set(joints).size).toBe(joints.length);
    for (const joint of joints) {
      let node: THREE.Object3D | null = joint;
      while (node && node !== model.group) node = node.parent;
      expect(node).toBe(model.group);
    }
    expect(model.leftLeg).toBe(rig.legs[0].thigh);
    expect(model.rightLeg).toBe(rig.legs[1].thigh);
    expect(model.key).toBe(rig.key);
    // The shins hang from the thighs and the boots from the shins, so a bent knee carries the foot with it.
    expect(rig.legs[0].shin.parent).toBe(rig.legs[0].thigh);
    expect(rig.legs[0].foot.parent).toBe(rig.legs[0].shin);
  });

  it("is 4 to 5.5 units tall with feet at y = 0", () => {
    const { spy } = setup();
    const { group } = createCourierModel(spy);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const height = box.max.y - box.min.y;
    expect(height).toBeGreaterThanOrEqual(4);
    expect(height).toBeLessThanOrEqual(5.5);
    expect(box.min.y).toBeCloseTo(0, 1);
  });

  it("puts the visor on the -Z side and the key on the +Z back", () => {
    const { spy } = setup();
    const model = createCourierModel(spy);
    model.group.updateMatrixWorld(true);
    const visor = model.group.getObjectByName("visor");
    expect(visor).toBeInstanceOf(THREE.Mesh);
    const visorBox = new THREE.Box3().setFromObject(visor!);
    expect(visorBox.min.z).toBeLessThan(-0.6);
    expect(visorBox.getCenter(new THREE.Vector3()).z).toBeLessThan(0);
    const keyPos = new THREE.Vector3().setFromMatrixPosition(model.key.matrixWorld);
    expect(keyPos.z).toBeGreaterThan(1);
  });

  it("names limbs by the character's own sides: left is at -X when facing -Z", () => {
    const { spy } = setup();
    const { rig } = createCourierModel(spy);
    expect(rig.legs[0].thigh.position.x).toBeLessThan(0);
    expect(rig.legs[1].thigh.position.x).toBeGreaterThan(0);
    expect(rig.arms[0].position.x).toBeLessThan(0);
    expect(rig.arms[1].position.x).toBeGreaterThan(0);
  });
});

describe("human London courier", () => {
  const model = () => createCourierModel(setup().spy, true);
  /** The figure's vertices where its bones put them now (skinned, in the model's space). */
  const skinned = (mesh: THREE.SkinnedMesh, filter: (i: number) => boolean = () => true) => {
    mesh.updateMatrixWorld(true);
    mesh.skeleton.update();
    const position = mesh.geometry.getAttribute("position");
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < position.count; i += 1) {
      if (!filter(i)) continue;
      const v = new THREE.Vector3().fromBufferAttribute(position, i);
      mesh.applyBoneTransform(i, v);
      out.push(v.applyMatrix4(mesh.matrixWorld));
    }
    return out;
  };
  const garment = (mesh: THREE.SkinnedMesh) => {
    const shift = mesh.geometry.getAttribute("idShift");
    const base = Math.min(...Array.from(shift.array as Float32Array));
    const step = 0.0062;
    return (i: number) => Math.round((shift.getX(i) - base) / step);
  };
  const HAIR = 1, SHOES = 7, STRAP = 9;

  it("is one skinned, cozy anime courier at the fitted height with expressive proportions", () => {
    const { group, figure, key } = model();
    expect(figure).toBeDefined();
    const meshes = meshesOf(group);
    expect(meshes).toHaveLength(1);
    const mesh = meshes[0] as THREE.SkinnedMesh;
    expect(mesh).toBeInstanceOf(THREE.SkinnedMesh);
    const material = mesh.material as THREE.ShaderMaterial;
    expect(Object.keys(material.defines ?? {})).toEqual(expect.arrayContaining(["ILLUSTRATED_CHARACTER", "ILLUSTRATED_VERTEX_COLORS", "ILLUSTRATED_WORLD"]));
    expect(material.fragmentShader).toContain("location = 1");
    const points = skinned(mesh);
    const bounds = new THREE.Box3().setFromPoints(points);
    const height = bounds.max.y - bounds.min.y;
    // Short: about 1.5 m against a 6-unit (2.8 m) storey, the height the camera and pace are scaled to (size.ts).
    expect(Math.abs(height - COURIER_HEIGHT)).toBeLessThan(0.03);
    expect(Math.abs(figure!.height - COURIER_HEIGHT)).toBeLessThan(0.001);
    expect(height).toBeLessThan(3.4);
    expect(Math.abs(bounds.min.y)).toBeLessThan(0.02);
    // The supplied illustration has natural youthful proportions: about 5.5–6 heads tall, with a slim body.
    // The approved leg rig and camera size stay put; this checks the drawn head, not its hidden bone anchor.
    const isSkin = garment(mesh);
    const position = mesh.geometry.getAttribute("position");
    let chin = Infinity;
    points.forEach((p, i) => {
      if (isSkin(i) === 0 && position.getZ(i) < -0.12 && p.y > 0.6 * height) chin = Math.min(chin, p.y);
    });
    const heads = height / (bounds.max.y - chin);
    expect(heads).toBeGreaterThan(5.5);
    expect(heads).toBeLessThan(6.2);
    expect((bounds.max.x - bounds.min.x) / height).toBeLessThan(0.36);
    const legs = figure!.bones.thigh[0].getWorldPosition(new THREE.Vector3()).y / height;
    expect(legs).toBeGreaterThan(0.38);
    expect(legs).toBeLessThan(0.46);
    // Each garment is its own outlined surface; the whole person stays a modest mesh.
    expect(new Set(Array.from(mesh.geometry.getAttribute("idShift").array as Float32Array)).size).toBeGreaterThanOrEqual(8);
    expect((mesh.geometry.getIndex()?.count ?? 0) / 3).toBeLessThan(20000);
    expect(key.visible).toBe(false);
    expect(group.getObjectByName("boiler")).toBeUndefined();
  });

  it("bends smoothly at the joints: weights sum to one and blend across knees and elbows", () => {
    const mesh = meshesOf(model().group)[0] as THREE.SkinnedMesh;
    const weights = mesh.geometry.getAttribute("skinWeight");
    let blended = 0;
    for (let i = 0; i < weights.count; i += 1) {
      const sum = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
      expect(sum).toBeCloseTo(1, 5);
      if (weights.getX(i) > 0.05 && weights.getY(i) > 0.05) blended += 1;
    }
    expect(blended).toBeGreaterThan(150);
  });

  it("keeps its soles on the ground through walking, jogging and running, and lifts them in the swing", () => {
    const { group, figure } = model();
    const mesh = figure!.mesh;
    const isShoe = garment(mesh);
    for (const speed of [2.2, WALK.walkSpeed, WALK.runSpeed]) {
      const gait = createHumanGait();
      let lowestEver = Infinity, highestSupport = -Infinity, highestSwing = -Infinity;
      for (let frame = 0; frame < 180; frame += 1) {
        updateHumanGait(gait, { dt: 1 / 60, distance: speed / 60, speed, heading: 0, y: 0, reduced: false, pace: figure!.pace, leg: figure!.leg });
        poseFigure(figure!, humanPose(gait, createFigurePose(), figure!.leg));
        if (frame < 120 || frame % 4) continue;
        group.updateMatrixWorld(true);
        const soles = [0, 1].map((side) => {
          const points = skinned(mesh, (i) => isShoe(i) === SHOES && Math.sign(mesh.geometry.getAttribute("position").getX(i)) === (side ? 1 : -1));
          return Math.min(...points.map((p) => p.y));
        });
        lowestEver = Math.min(lowestEver, ...soles);
        highestSupport = Math.max(highestSupport, Math.min(...soles));
        highestSwing = Math.max(highestSwing, Math.max(...soles));
      }
      expect(lowestEver, `speed ${speed}`).toBeGreaterThan(-0.06);
      // Walking, a foot is always down; jogging and running float only briefly, a hand's breadth at most.
      expect(highestSupport, `speed ${speed}`).toBeLessThan(speed < 3 ? 0.06 : 0.3);
      // The swing lifts the foot clear, a hand's breadth or more (scaled to her size when jogging and running).
      expect(highestSwing, `speed ${speed}`).toBeGreaterThan(speed < 3 ? 0.15 : 0.3 * figure!.pace);
    }
  });

  it("matches the reference's measured full-cycle lean, thigh lift, elbow flex and rhythm", () => {
    // Source-bound Abeto run/sprint clips, evaluated at 120 phases on 2026-11-10. See movement-reference/
    // 2026-11-10/stride-comparison.json: neck-to-pelvis lean medians 14.29° / 19.43°, cycle 0.8712 s.
    const { figure } = model();
    const f = figure!;
    const radians = 180 / Math.PI;
    const at = (bone: THREE.Object3D) => bone.getWorldPosition(new THREE.Vector3());
    const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.floor(values.length * fraction)]!;
    for (const [speed, key, targetLean, maximumLift] of [[WALK.walkSpeed, "jog", 14.29, 40], [WALK.runSpeed, "run", 19.43, 49]] as const) {
      const gait = createHumanGait();
      for (let i = 0; i < 600; i += 1) updateHumanGait(gait, { dt: 1 / 120, distance: speed / 120, speed, heading: 0, y: 0, reduced: false, scale: f.scale, pace: f.pace, leg: f.leg });
      const lean: number[] = [], lift: number[] = [], elbows: number[] = [];
      for (let frame = 0; frame < 120; frame += 1) {
        gait.phase = frame / 120;
        poseFigure(f, humanPose(gait, createFigurePose(), f.leg));
        f.group.updateMatrixWorld(true);
        const trunk = at(f.bones.neck).sub(at(f.bones.hips));
        lean.push(Math.atan2(Math.abs(trunk.z), trunk.y) * radians);
        for (const side of [0, 1] as const) {
          const thigh = at(f.bones.shin[side]).sub(at(f.bones.thigh[side]));
          lift.push(Math.atan2(Math.abs(thigh.z), -thigh.y) * radians);
          const elbow = at(f.bones.foreArm[side]);
          elbows.push((Math.PI - at(f.bones.upperArm[side]).sub(elbow).angleTo(at(f.bones.hand[side]).sub(elbow))) * radians);
        }
      }
      expect(Math.abs(percentile(lean, 0.5) - targetLean)).toBeLessThan(2);
      expect(percentile(lift, 0.95)).toBeLessThan(maximumLift);
      expect(percentile(elbows, 0.95) - percentile(elbows, 0.05)).toBeGreaterThan(15);
      expect(Math.abs(gaitTables(f.leg)[key].stride * f.scale / speed - 0.871212)).toBeLessThan(0.01);
    }
  });

  it("swings each arm forward with the opposite leg", () => {
    const { figure } = model();
    const gait = createHumanGait();
    for (let i = 0; i < 120; i += 1) updateHumanGait(gait, { dt: 1 / 60, distance: WALK.walkSpeed / 60, speed: WALK.walkSpeed, heading: 0, y: 0, reduced: false, pace: figure!.pace, leg: figure!.leg });
    const z = (bone: THREE.Object3D) => bone.getWorldPosition(new THREE.Vector3()).z;
    // Evaluate the actual skinned rig across a full cycle. Knee flexion can put a toe behind its thigh during
    // recovery, so a single hard-coded toe frame does not establish opposite-arm carriage.
    let opposite = 0, kneeRange = 0, handRange = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      gait.phase = frame / 120;
      poseFigure(figure!, humanPose(gait, createFigurePose(), figure!.leg));
      figure!.group.updateMatrixWorld(true);
      const knees = z(figure!.bones.shin[0]) - z(figure!.bones.shin[1]);
      const hands = z(figure!.bones.hand[0]) - z(figure!.bones.hand[1]);
      opposite += knees * hands;
      kneeRange = Math.max(kneeRange, Math.abs(knees));
      handRange = Math.max(handRange, Math.abs(hands));
    }
    expect(opposite / 120).toBeLessThan(-0.02);
    expect(kneeRange).toBeGreaterThan(0.3);
    expect(handRange).toBeGreaterThan(0.3);
  });

  it("wears the dispatch strap outside the oversized jacket across both chest and back", () => {
    // Optional working-jacket variant remains supported; the reference hoodie player has no dispatch bag.
    const figure = createFigure({ ...COURIER_LOOK, garment: "jacket", fit: 1.13, bag: { body: "#303a3c", flap: "#3b4647", strap: "#273132" } }, createFigureMaterial());
    const mesh = figure!.mesh;
    mesh.updateMatrixWorld(true);
    const isGarment = garment(mesh);
    const index = mesh.geometry.getIndex()!;
    // Across the chest and the back of her short trunk.
    for (const side of [-1, 1]) for (const [x, y] of [[0.05, 2.22], [-0.18, 1.91]]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, y, side * 3), new THREE.Vector3(0, 0, -side));
      const hits = ray.intersectObject(mesh);
      expect(hits[0], `${side} ${x},${y}`).toBeDefined();
      const worn = hits.map((hit) => isGarment(index.getX(hit.faceIndex! * 3)));
      // The new short layered haircut leaves the dispatch strap visible on both sides of the working jacket.
      expect(worn[0], `${side} ${x},${y}`).toBe(STRAP);
    }
  });

  it("keeps the slim long top over its upper trousers through standing, jogging and running", () => {
    const { figure } = model();
    const mesh = figure!.mesh, positions = mesh.geometry.getAttribute("position"), ids = garment(mesh), index = mesh.geometry.getIndex()!;
    const candidates: number[] = [];
    for (let i = 0; i < positions.count; i += 1) if (ids(i) === 4 && positions.getY(i) > figure!.hipsRest.y + 0.02
      && positions.getY(i) < figure!.hipsRest.y + 0.25 && positions.getZ(i) < -0.1) candidates.push(i);
    expect(candidates.length).toBeGreaterThan(12);
    const samples = Array.from({ length: 12 }, (_, i) => candidates[Math.floor(i * (candidates.length - 1) / 11)]!);
    const exposed = () => {
      mesh.updateMatrixWorld(true);
      let seen = 0;
      for (const vertex of samples) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, vertex);
        mesh.applyBoneTransform(vertex, point);
        const hit = new THREE.Raycaster(new THREE.Vector3(point.x, point.y, -3), new THREE.Vector3(0, 0, 1)).intersectObject(mesh)[0];
        if (hit && ids(index.getX(hit.faceIndex! * 3)) === 4) seen += 1;
      }
      return seen;
    };
    for (const speed of [0, 6.8, 9]) for (const phase of [0.1, 0.4, 0.7]) {
      const gait = createHumanGait();
      for (let i = 0; i < 120; i += 1) updateHumanGait(gait, { dt: 1 / 60, distance: speed / 60, speed, heading: 0, y: 0, reduced: false, scale: figure!.scale, pace: figure!.pace, leg: figure!.leg });
      gait.phase = phase;
      poseFigure(figure!, humanPose(gait, createFigurePose(), figure!.leg));
      expect(exposed(), `speed ${speed}, phase ${phase}`).toBe(0);
    }
    // Positive control: physically contracting the covering cloth must reveal the trousers to these same rays.
    for (let i = 0; i < positions.count; i += 1) if ([2, 3].includes(ids(i))) positions.setZ(i, positions.getZ(i) * 0.65);
    expect(exposed()).toBeGreaterThan(0);
  });

  it("holds one calm pose under reduced motion", () => {
    const { figure } = model();
    const gait = createHumanGait();
    const bones = () => {
      figure!.group.updateMatrixWorld(true);
      return figure!.mesh.skeleton.bones.map((bone) => bone.matrixWorld.elements.map((e) => e.toFixed(6)).join(","));
    };
    updateHumanGait(gait, { dt: 1 / 60, distance: 0.2, speed: 12, heading: 0, y: 0, reduced: true });
    poseFigure(figure!, humanPose(gait, createFigurePose(), figure!.leg));
    const before = bones();
    for (let i = 0; i < 90; i += 1) updateHumanGait(gait, { dt: 1 / 60, distance: 0.2, speed: 12, heading: i * 0.01, y: 0, reduced: true });
    poseFigure(figure!, humanPose(gait, createFigurePose(), figure!.leg));
    expect(bones()).toEqual(before);
  });

  it("disposes its own figure material and bones, never the shared palette", () => {
    const { palette, spy } = setup();
    const { group, figure } = createCourierModel(spy, true);
    const material = figure!.mesh.material as THREE.Material;
    let disposed = 0;
    material.addEventListener("dispose", () => { disposed += 1; });
    disposeModel(group);
    expect(disposed).toBe(1);
    expect(palette.get("ink").userData.ownedByModel).toBeUndefined();
  });
});

describe("animateCourier", () => {
  it("puts each pose value on its joint", () => {
    const { spy } = setup();
    const model = createCourierModel(spy);
    const pose = createPose();
    Object.assign(pose, { hipsY: -0.2, hipsRoll: 0.05, squash: -0.1, torsoPitch: -0.15, torsoRoll: 0.08, headPitch: 0.07, headYaw: 0.3 });
    pose.legs[0].hip = 0.5; pose.legs[0].knee = -0.6;
    pose.legs[1].hip = -0.5; pose.legs[1].knee = -0.1;
    pose.arms[0].swing = -0.4; pose.arms[1].swing = 0.4;
    pose.arms[0].spread = 0.2; pose.arms[1].spread = 0.2;
    const restBody = model.rig.body.position.y;
    animateCourier(model, pose, 0);
    const { rig } = model;
    expect(rig.body.position.y).toBeCloseTo(restBody - 0.2, 9);
    expect(rig.body.rotation.z).toBeCloseTo(0.05, 9);
    expect(rig.body.scale.y).toBeCloseTo(0.9, 9);
    expect(rig.body.scale.x).toBeCloseTo(1.05, 9);
    expect(rig.torso.rotation.x).toBeCloseTo(-0.15, 9);
    expect(rig.torso.rotation.z).toBeCloseTo(0.08, 9);
    expect(rig.head.rotation.x).toBeCloseTo(0.07, 9);
    expect(rig.head.rotation.y).toBeCloseTo(0.3, 9);
    expect(rig.legs[0].thigh.rotation.x).toBeCloseTo(0.5, 9);
    expect(rig.legs[0].shin.rotation.x).toBeCloseTo(-0.6, 9);
    expect(rig.legs[1].thigh.rotation.x).toBeCloseTo(-0.5, 9);
    // The ankle takes back most of the leg's tilt, so the boot stays nearly level.
    expect(rig.legs[0].foot.rotation.x).toBeCloseTo(-(0.5 - 0.6) * 0.85, 9);
    expect(rig.arms[0].rotation.x).toBeCloseTo(-0.4, 9);
    // Spread swings each arm outward: the left (at -X) by a negative z turn, the right by a positive one.
    expect(rig.arms[0].rotation.z).toBeCloseTo(-0.2, 9);
    expect(rig.arms[1].rotation.z).toBeCloseTo(0.2, 9);
  });

  it("swings a leg forward (toward -Z) with a positive hip angle and folds the foot back with a bent knee", () => {
    const { spy } = setup();
    const model = createCourierModel(spy);
    const foot = (pose: ReturnType<typeof createPose>) => {
      animateCourier(model, pose, 0);
      model.group.updateMatrixWorld(true);
      const shin = model.rig.legs[0].shin;
      return new THREE.Box3().setFromObject(shin).getCenter(new THREE.Vector3());
    };
    const rest = foot(createPose());
    const forward = createPose();
    forward.legs[0].hip = 0.6;
    expect(foot(forward).z).toBeLessThan(rest.z - 0.3);
    const bent = createPose();
    bent.legs[0].knee = -1;
    expect(foot(bent).z).toBeGreaterThan(rest.z + 0.2);
  });

  it("keeps the feet out of the ground through a running stride", () => {
    const { spy } = setup();
    const model = createCourierModel(spy);
    const gait = createGait();
    const pose = createPose();
    let lowest = Infinity;
    for (let i = 0; i < 240; i += 1) {
      updateGait(gait, { dt: 1 / 60, distance: 18 / 60, speed: 18, heading: 0, y: 0, reduced: false });
      animateCourier(model, gaitPose(gait, pose), 0);
      model.group.updateMatrixWorld(true);
      for (const leg of model.rig.legs) lowest = Math.min(lowest, new THREE.Box3().setFromObject(leg.thigh, true).min.y);
    }
    expect(lowest).toBeGreaterThan(-0.05);
  });

  it("turns the key a quarter turn per tick, in whole ticks under reduced motion", () => {
    const { spy } = setup();
    const model = createCourierModel(spy);
    animateCourier(model, createPose(), 0);
    expect(model.key.rotation.z).toBeCloseTo(0, 9);
    animateCourier(model, createPose(), 1);
    expect(model.key.rotation.z).toBeCloseTo(Math.PI / 2, 9);
    animateCourier(model, createPose(), 2.5);
    expect(model.key.rotation.z).toBeCloseTo(2.5 * Math.PI / 2, 9);
    animateCourier(model, createPose(), 2.5, true);
    expect(model.key.rotation.z).toBeCloseTo(Math.PI, 9);
  });
});

describe("courier rig", () => {
  it("centres the key on its turning axis", () => {
    const { spy } = setup();
    const { key } = createCourierModel(spy);
    const geometry = (key as THREE.Mesh).geometry;
    geometry.computeBoundingBox();
    const center = (geometry.boundingBox as THREE.Box3).getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
  });

  it("disposes geometries but never materials", () => {
    const { palette, spy } = setup();
    const { group } = createCourierModel(spy);
    const geometries = meshesOf(group).map((m) => m.geometry);
    let geometryDisposed = 0;
    let materialDisposed = 0;
    geometries.forEach((g) => g.addEventListener("dispose", () => { geometryDisposed++; }));
    for (const key of ALLOWED) palette.get(key).addEventListener("dispose", () => { materialDisposed++; });
    disposeModel(group);
    expect(geometryDisposed).toBe(geometries.length);
    expect(materialDisposed).toBe(0);
  });

  it("builds after a fully populated town palette without creating materials or running out of ids", () => {
    const city = buildCity();
    const created = () => (city.palette as unknown as { created: number }).created;
    const before = created();
    expect(() => {
      createCourierModel(city.palette);
      createBeacon(city.palette);
    }).not.toThrow();
    expect(created()).toBe(before);
  });
});

describe("diamond", () => {
  it("has flat normals matching each face's cross product", () => {
    const { spy } = setup();
    const beacon = createBeacon(spy);
    const diamond = beacon.getObjectByName("diamond") as THREE.Mesh;
    const geometry = diamond.geometry;
    const pos = geometry.getAttribute("position");
    const nor = geometry.getAttribute("normal");
    expect(pos.count % 3).toBe(0);
    const [a, b, c, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      const face = b.sub(a).cross(c.sub(a)).normalize();
      for (let v = 0; v < 3; v++) {
        n.fromBufferAttribute(nor, i + v);
        expect(n.dot(face)).toBeGreaterThan(0.999);
      }
    }
  });
});

describe("beacon", () => {
  it("uses at most 2 shared illustrated meshes and a ring of about radius 7", () => {
    const { palette, spy, requested } = setup();
    const beacon = createBeacon(spy);
    for (const key of requested) expect(ALLOWED).toContain(key);
    const meshes = meshesOf(beacon);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThanOrEqual(2);
    const shared = new Set<THREE.Material>(ALLOWED.map((k) => palette.get(k)));
    for (const mesh of meshes) {
      expect(mesh.material).toBeInstanceOf(THREE.ShaderMaterial);
      expect((mesh.material as THREE.ShaderMaterial).fragmentShader).toContain("location = 1");
      expect(shared.has(mesh.material as THREE.Material)).toBe(true);
    }
    beacon.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(beacon);
    expect(box.max.x).toBeGreaterThan(6.5);
    expect(box.max.x).toBeLessThan(7.5);
    expect(box.min.x).toBeLessThan(-6.5);
  });

  it("hovers and spins when motion is allowed", () => {
    const { spy } = setup();
    const beacon = createBeacon(spy);
    const before = snapshot(beacon);
    animateBeacon(beacon, 1.3, false);
    expect(snapshot(beacon)).not.toEqual(before);
  });

  it("leaves every transform untouched when reducedMotion is true", () => {
    const { spy } = setup();
    const beacon = createBeacon(spy);
    const before = snapshot(beacon);
    animateBeacon(beacon, 1.3, true);
    animateBeacon(beacon, 99, true);
    expect(snapshot(beacon)).toEqual(before);
  });

  it("throws a clear error when the float child is missing", () => {
    expect(() => animateBeacon(new THREE.Group(), 1, false)).toThrow(/beaconFloat/);
  });

  it("does not move the position the caller placed the beacon at", () => {
    const { spy } = setup();
    const beacon = createBeacon(spy);
    beacon.position.set(10, 20, 30);
    animateBeacon(beacon, 2.1, false);
    expect(beacon.position.toArray()).toEqual([10, 20, 30]);
  });
});

describe("drawn faces, the reference's way", () => {
  const material = createFigureMaterial();
  const SKIN = 0, HAIR = 1, EYES = 10, CAP = 11;
  const build = (look: FigureLook) => {
    const figure = createFigure({ ...look, scale: 1 }, material);
    const geometry = figure.mesh.geometry;
    const position = geometry.getAttribute("position");
    const shift = geometry.getAttribute("idShift");
    const base = Math.min(...Array.from(shift.array as Float32Array));
    const garment = (i: number) => Math.round((shift.getX(i) - base) / 0.0062);
    return { figure, position, garment };
  };
  const residents = createResidentAgents().map((agent, index) => residentLook(agent, index));

  it("keeps every resident's painted eyes on their own cheek surface across differing faces", () => {
    expect(residents.length).toBeGreaterThan(10);
    for (const [resident, look] of residents.entries()) {
      const { figure, position, garment } = build(look);
      figure.group.updateMatrixWorld(true);
      const index = figure.mesh.geometry.getIndex()!;
      let tested = 0;
      for (let i = 0; i < position.count; i += 17) {
        if (garment(i) !== EYES) continue;
        const hits = new THREE.Raycaster(new THREE.Vector3(position.getX(i), position.getY(i), -3), new THREE.Vector3(0, 0, 1)).intersectObject(figure.mesh);
        const skin = hits.find((hit) => garment(index.getX(hit.faceIndex! * 3)) === SKIN);
        if (!skin) continue;
        const gap = skin.point.z - position.getZ(i);
        expect(gap, `resident ${resident}`).toBeGreaterThan(-0.025);
        expect(gap, `resident ${resident}`).toBeLessThan(0.05);
        tested += 1;
      }
      expect(tested, `resident ${resident}`).toBeGreaterThan(3);
    }
  }, 30000); // All 32 detailed skinned heads are raycast; this is a geometry check, not a frame-rate benchmark.

  it("covers every crown: hair (or a cap) down to a hairline above the brow, never a bare scalp", () => {
    for (const [index, look] of residents.entries()) {
      const { figure, garment } = build(look);
      figure.group.updateMatrixWorld(true);
      const hits = new THREE.Raycaster(new THREE.Vector3(0, 3.68, -3), new THREE.Vector3(0, 0, 1)).intersectObject(figure.mesh);
      expect(hits[0], `resident ${index}`).toBeDefined();
      const first = garment(figure.mesh.geometry.getIndex()!.getX(hits[0]!.faceIndex! * 3));
      expect([HAIR, CAP], `resident ${index} (${look.hairStyle})`).toContain(first);
    }
  });

  it("covers the rear scalp beneath staggered shag roots while leaving the lower ends free", () => {
    const check = (look: FigureLook, control = false) => {
      const { figure, position, garment } = build(look);
      figure.group.updateMatrixWorld(true);
      const skin = figure.mesh.geometry.getAttribute("skinIndex"), head = figure.mesh.skeleton.bones.indexOf(figure.bones.head);
      const candidates: number[] = [];
      for (let i = 0; i < position.count; i += 1) if (garment(i) === SKIN && skin.getX(i) === head && position.getZ(i) > 0.06
        && Math.abs(position.getX(i)) < 0.13 && position.getY(i) > figure.height * 0.87 && position.getY(i) < figure.height * 0.97) candidates.push(i);
      expect(candidates.length).toBeGreaterThan(6);
      const samples = Array.from({ length: 8 }, (_, i) => candidates[Math.floor(i * (candidates.length - 1) / 7)]!);
      const rearSurface = (vertex: number) => {
        const hits = new THREE.Raycaster(new THREE.Vector3(position.getX(vertex), position.getY(vertex), 3), new THREE.Vector3(0, 0, -1)).intersectObject(figure.mesh);
        expect(hits[0]).toBeDefined();
        return garment(figure.mesh.geometry.getIndex()!.getX(hits[0]!.faceIndex! * 3));
      };
      for (const vertex of samples) expect([HAIR, CAP]).toContain(rearSurface(vertex));
      if (control) {
        // Recess the actual backing and locks into the skull: the same rear-view rays must detect exposed skin.
        for (let i = 0; i < position.count; i += 1) if (garment(i) === HAIR) position.setZ(i, position.getZ(i) * 0.1);
        expect(samples.some((vertex) => rearSurface(vertex) === SKIN)).toBe(true);
      }
    };
    check(COURIER_LOOK, true);
    for (const look of residents) check(look);
  }, 15000);

  it("gives the courier open painted anime eyes attached to the broader cheek planes", () => {
    const { figure, position, garment } = build(COURIER_LOOK);
    figure.group.updateMatrixWorld(true);
    const index = figure.mesh.geometry.getIndex()!;
    let checked = 0;
    const eyeY: number[] = [];
    for (let i = 0; i < position.count; i += 1) {
      if (garment(i) !== EYES) continue;
      eyeY.push(position.getY(i));
      if (i % 11) continue;
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const hits = new THREE.Raycaster(new THREE.Vector3(x, y, -3), new THREE.Vector3(0, 0, 1)).intersectObject(figure.mesh);
      const skin = hits.find((hit) => garment(index.getX(hit.faceIndex! * 3)) === SKIN);
      if (!skin) continue;
      expect(skin.point.z - z).toBeGreaterThan(-0.02);
      expect(skin.point.z - z).toBeLessThan(0.045);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(15);
    // Open almond lids: livelier than the old half-lid, wider than tall instead of round toy eyes.
    const eyeToHead = (Math.max(...eyeY) - Math.min(...eyeY)) / (0.625 * COURIER_LOOK.head! * 0.86);
    expect(eyeToHead).toBeGreaterThan(0.07);
    expect(eyeToHead).toBeLessThan(0.12);
    expect(COURIER_LOOK).toMatchObject({ garment: "hoodie", hairStyle: "layered", expression: "bright", legs: "trousers", longTop: true });
    expect(COURIER_LOOK.bag).toBeUndefined();
    expect(COURIER_LOOK.cap).toBeUndefined();
    expect(COURIER_LOOK.ribbon).toBeUndefined();
  });
});

