import * as THREE from "three";
import { merge, type MaterialKey, type MaterialSource } from "../city/kit";
import type { CourierPose } from "./gait";
import { COURIER_LOOK, createFigure, createFigureMaterial, createFigurePose, poseFigure, type Figure, type FigurePose } from "./figure";

/**
 * Two original couriers share the same gameplay pose API: the London human and the legacy wind-up courier.
 * Both use the illustrated palette, with static details merged per material and separate joints where they bend.
 */

/** The jointed courier. Legs hang from fixed hip pivots; everything above rides on `body`, which bobs and squashes. */
export type CourierRig = {
  body: THREE.Object3D;
  torso: THREE.Object3D;
  head: THREE.Object3D;
  /** Left (−X) then right (+X), by the character's own sides. */
  legs: [LegJoints, LegJoints];
  arms: [THREE.Object3D, THREE.Object3D];
  key: THREE.Object3D;
  /** Human-only secondary joints; the legacy wind-up rig keeps its original proportions. */
  human?: { hipY: number; elbows: [THREE.Object3D, THREE.Object3D]; satchel: THREE.Object3D };
};
export type LegJoints = { thigh: THREE.Object3D; shin: THREE.Object3D; foot: THREE.Object3D };
export type CourierModel = {
  group: THREE.Group; rig: CourierRig; leftLeg: THREE.Object3D; rightLeg: THREE.Object3D; key: THREE.Object3D;
  /** The London courier's skinned figure (absent on the legacy wind-up courier). */
  figure?: Figure;
};

type Parts = MaterialSource;
type CourierKey = Extract<MaterialKey, "wall0" | "copper" | "ink" | "brass" | "water" | "skin" | "coat" | "leather">;

/** Hip pivot height; thigh + shin (with the boot) reach exactly from here to the ground. */
const HIP_Y = 1.3;
const HIP_X = 0.5;
const THIGH = 0.65;
/** The torso sits a touch above the hips so the thighs disappear into it. */
const WAIST = 0.05;
/** The ankle sits this far below the knee; the boot hangs from it. */
const ANKLE = 0.36;
/** How much of the leg's tilt the ankle takes back, keeping the boot nearly level (1 = perfectly flat). */
const ANKLE_LEVEL = 0.85;
const NECK_Y = 1.85;
const SHOULDER = { x: 1.1, y: 1.45 } as const;
const KEY = { y: 1.15, z: 1.42 } as const;
const BEACON_RING_RADIUS = 6.7;
const BEACON_TUBE = 0.3;

/** A geometry moved into place: optional rotation (x, z) and scale are applied before the translation. */
function placed(
  geometry: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rotate: { x?: number; z?: number } = {},
  scale: readonly [number, number, number] = [1, 1, 1],
): THREE.BufferGeometry {
  geometry.scale(scale[0], scale[1], scale[2]);
  if (rotate.x) geometry.rotateX(rotate.x);
  if (rotate.z) geometry.rotateZ(rotate.z);
  geometry.translate(x, y, z);
  return geometry;
}

function meshOf(parts: Parts, key: CourierKey, geometries: THREE.BufferGeometry[], name: string = key): THREE.Mesh {
  const mesh = new THREE.Mesh(merge(geometries), parts.get(key));
  mesh.name = name;
  return mesh;
}

function joint(name: string, x: number, y: number, z: number): THREE.Object3D {
  const node = new THREE.Object3D();
  node.name = name;
  node.position.set(x, y, z);
  return node;
}

/**
 * A leg: the thigh pivots at the hip, the shin at the knee and the boot at the ankle (which keeps it nearly level, so
 * a bent knee never tips the toe into the ground). Side -1 is the courier's left (−X).
 */
function buildLeg(parts: Parts, side: -1 | 1): { thigh: THREE.Mesh; shin: THREE.Mesh; foot: THREE.Mesh } {
  const label = side < 0 ? "Left" : "Right";
  const thigh = meshOf(parts, "ink", [placed(new THREE.CapsuleGeometry(0.27, 0.42, 3, 10), 0, -0.3, 0)], `thigh${label}`);
  thigh.position.set(side * HIP_X, HIP_Y, 0);
  const shin = meshOf(parts, "ink", [placed(new THREE.CapsuleGeometry(0.23, 0.3, 3, 10), 0, -0.22, 0)], `shin${label}`);
  shin.position.set(0, -THIGH, 0);
  // A rounded boot, toe forward (−Z); its sole sits on the ground at rest.
  const foot = meshOf(parts, "ink", [placed(new THREE.SphereGeometry(0.36, 14, 8), 0, -0.07, -0.12, {}, [1, 0.6, 1.4])], `boot${label}`);
  foot.position.set(0, -ANKLE, 0);
  shin.add(foot);
  thigh.add(shin);
  return { thigh, shin, foot };
}

function buildArm(parts: Parts, side: -1 | 1): THREE.Mesh {
  const arm = meshOf(parts, "ink", [
    placed(new THREE.CapsuleGeometry(0.19, 0.6, 3, 8), 0, -0.45, 0),
    placed(new THREE.SphereGeometry(0.25, 12, 8), 0, -0.88, 0),
  ], side < 0 ? "armLeft" : "armRight");
  arm.position.set(side * SHOULDER.x, SHOULDER.y, 0);
  arm.rotation.z = side * 0.1;
  return arm;
}

function buildKey(parts: Parts): THREE.Mesh {
  // Built around the Z axis so a rotation.z spins it like a real wind-up key.
  // Small enough that, seen from the follow camera behind, the arms and body still read around it.
  const bar = placed(new THREE.BoxGeometry(0.95, 0.2, 0.14), 0, 0, 0);
  const lobeLeft = placed(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 16), -0.56, 0, 0, { x: Math.PI / 2 });
  const lobeRight = placed(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 16), 0.56, 0, 0, { x: Math.PI / 2 });
  const shaft = placed(new THREE.CylinderGeometry(0.1, 0.1, 0.45, 8), 0, 0, -0.25, { x: Math.PI / 2 });
  const key = meshOf(parts, "brass", [bar, lobeLeft, lobeRight, shaft], "key");
  key.position.set(0, KEY.y, KEY.z);
  return key;
}

/** A rounded boiler body from a lathe profile: narrow waist, round belly, sloped shoulders. */
function boilerGeometry(): THREE.BufferGeometry {
  const profile = [
    [0, 0], [0.72, 0.04], [1.02, 0.32], [1.18, 0.78], [1.16, 1.22], [0.98, 1.58], [0.6, 1.82], [0, 1.9],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(profile, 28);
}

/**
 * The London courier: one smoothly skinned figure (figure.ts) in its own illustrated material, posed by the human gait
 * (humanGait.ts). The legacy rig slots point at its bones, so callers can still find the hips, chest, head, legs and
 * arms; the wind-up key is kept, hidden, for the shared animation path.
 */
function createHumanCourier(): CourierModel {
  const material = createFigureMaterial();
  material.userData.ownedByModel = true;
  const figure = createFigure(COURIER_LOOK, material);
  const group = new THREE.Group();
  group.name = "courier";
  group.userData.character = "London courier";
  group.add(figure.group);
  const key = joint("key", 0, 0, 0);
  key.visible = false;
  figure.bones.chest.add(key);
  const b = figure.bones;
  const legs: CourierRig["legs"] = [
    { thigh: b.thigh[0], shin: b.shin[0], foot: b.foot[0] },
    { thigh: b.thigh[1], shin: b.shin[1], foot: b.foot[1] },
  ];
  const rig: CourierRig = {
    body: b.hips, torso: b.chest, head: b.head, legs, arms: [b.upperArm[0], b.upperArm[1]], key,
    human: { hipY: figure.hipsRest.y, elbows: [b.foreArm[0], b.foreArm[1]], satchel: b.bag },
  };
  return { group, rig, leftLeg: b.thigh[0], rightLeg: b.thigh[1], key, figure };
}

/**
 * About 4.9 units tall, feet at y = 0, facing −Z (same as the plane model): the visor is on the −Z side and the key
 * on the +Z back. An original wind-up courier: cream boiler body with a brass band and chest dial, a round head with
 * a dark visor and two lamp-eyes, a copper cap with a forward bill, a satchel on a strap, ink limbs and boots.
 */
export function createCourierModel(palette: Parts, human = false): CourierModel {
  if (human) return createHumanCourier();
  const group = new THREE.Group();
  group.name = "courier";

  const body = joint("body", 0, HIP_Y, 0);
  const torso = joint("torso", 0, WAIST, 0);
  body.add(torso);

  torso.add(
    meshOf(palette, "wall0", [boilerGeometry()], "boiler"),
    meshOf(palette, "brass", [
      placed(new THREE.TorusGeometry(1.17, 0.09, 6, 36), 0, 0.8, 0, { x: Math.PI / 2 }),
      // A little clock dial on the chest.
      placed(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 20), 0, 1.15, -1.1, { x: Math.PI / 2 }),
    ], "trim"),
    meshOf(palette, "water", [
      placed(new THREE.BoxGeometry(0.5, 0.7, 0.55), 1.12, 0.5, 0.3),
      // The strap: a thin band tilted across the chest.
      placed(new THREE.TorusGeometry(1.2, 0.07, 4, 36), 0, 1.0, 0, { x: Math.PI / 2, z: 0.55 }),
    ], "satchel"),
  );

  const head = joint("head", 0, NECK_Y, 0);
  torso.add(head);
  head.add(
    meshOf(palette, "wall0", [
      placed(new THREE.SphereGeometry(0.85, 24, 14), 0, 0.8, 0, {}, [1, 0.92, 1]),
      placed(new THREE.CylinderGeometry(0.34, 0.42, 0.3, 14), 0, 0.12, 0),
      // Two round lamp-eyes, cream against the dark visor (merged here to save a draw call).
      placed(new THREE.SphereGeometry(0.12, 10, 8), -0.27, 0.84, -0.86),
      placed(new THREE.SphereGeometry(0.12, 10, 8), 0.27, 0.84, -0.86),
    ], "headShell"),
    meshOf(palette, "ink", [placed(new THREE.BoxGeometry(1.15, 0.4, 0.3), 0, 0.82, -0.7)], "visor"),
    meshOf(palette, "copper", [
      placed(new THREE.SphereGeometry(0.9, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.02, 0, {}, [1, 0.72, 1]),
      // A forward bill, tipped down a touch.
      placed(new THREE.BoxGeometry(0.95, 0.08, 0.6), 0, 1.04, -0.92, { x: 0.12 }),
      placed(new THREE.SphereGeometry(0.12, 10, 8), 0, 1.66, 0),
    ], "cap"),
  );

  const arms: [THREE.Mesh, THREE.Mesh] = [buildArm(palette, -1), buildArm(palette, 1)];
  torso.add(...arms);
  const key = buildKey(palette);
  torso.add(key);

  const legs: CourierRig["legs"] = [buildLeg(palette, -1), buildLeg(palette, 1)];
  group.add(body, legs[0].thigh, legs[1].thigh);

  const rig: CourierRig = { body, torso, head, legs, arms, key };
  return { group, rig, leftLeg: legs[0].thigh, rightLeg: legs[1].thigh, key };
}

/**
 * Put a gait pose (gait.ts) on the rig. `ticks` is the town tick value (city/clockwork tickValue): the key turns a
 * quarter turn per tick, in whole ticks under reduced motion.
 */
export function animateCourier(model: CourierModel, pose: CourierPose, ticks: number, reducedMotion = false): void {
  if (model.figure) {
    animateHuman(model, figurePoseFrom(pose));
    return;
  }
  const { body, torso, head, legs, arms, key } = model.rig;
  body.position.y = HIP_Y + pose.hipsY;
  body.rotation.z = pose.hipsRoll;
  body.scale.set(1 - pose.squash / 2, 1 + pose.squash, 1 - pose.squash / 2);
  torso.rotation.set(pose.torsoPitch, 0, pose.torsoRoll);
  const breathe = pose.breathe;
  torso.scale.set(1 + breathe / 2, 1 + breathe, 1 + breathe / 2);
  head.rotation.set(pose.headPitch, pose.headYaw, -pose.torsoRoll * 0.4, "YXZ");
  for (let index = 0; index < 2; index += 1) {
    const leg = legs[index]!;
    const legPose = pose.legs[index]!;
    leg.thigh.rotation.x = legPose.hip;
    leg.shin.rotation.x = legPose.knee;
    leg.foot.rotation.x = -(legPose.hip + legPose.knee) * ANKLE_LEVEL;
    const arm = arms[index]!;
    const armPose = pose.arms[index]!;
    arm.rotation.x = armPose.swing;
    arm.rotation.z = (index === 0 ? -1 : 1) * armPose.spread;
  }
  key.rotation.z = (reducedMotion ? Math.floor(ticks) : ticks) * (Math.PI / 2);
}

/** Put a human pose (humanGait.ts) on the London courier's figure. A legacy model ignores it. */
export function animateHuman(model: CourierModel, pose: FigurePose): void {
  if (model.figure) poseFigure(model.figure, pose);
}

/** The nearest human pose to a legacy wind-up pose (for callers that still speak the old pose). */
function figurePoseFrom(pose: CourierPose): FigurePose {
  const out = createFigurePose();
  out.hips.y = pose.hipsY * 0.45;
  out.hips.roll = pose.hipsRoll * 0.6;
  out.spine.pitch = pose.torsoPitch * 0.5;
  out.chest.pitch = pose.torsoPitch * 0.25;
  out.spine.roll = pose.torsoRoll * 0.6;
  out.head.pitch = pose.headPitch;
  out.head.yaw = pose.headYaw;
  for (let i = 0; i < 2; i += 1) {
    const leg = out.legs[i]!;
    leg.hip = pose.legs[i]!.hip;
    leg.knee = -pose.legs[i]!.knee;
    leg.ankle = -(leg.hip - leg.knee) * 0.9;
    const arm = out.arms[i]!;
    arm.swing = pose.arms[i]!.swing;
    arm.out = pose.arms[i]!.spread;
    arm.elbow = 0.2 + Math.max(0, pose.arms[i]!.swing) * 0.6;
  }
  out.bag.pitch = -pose.arms[1].swing * 0.12;
  return out;
}

/**
 * Disposes the model's geometries (and a skinned figure's bones). Palette materials are shared across the town and are
 * never disposed per model; only a material the model made for itself (userData.ownedByModel) goes with it.
 */
export function disposeModel(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (material.userData.ownedByModel) material.dispose();
  });
}

/** A floating brass ring (outer radius about 7) with a small down-pointing diamond, centred at the origin for the caller to place. */
export function createBeacon(palette: Parts): THREE.Group {
  const beacon = new THREE.Group();
  beacon.name = "beacon";
  // Everything that hovers and spins lives in one child, so the caller's placement is never touched.
  const floating = new THREE.Group();
  floating.name = "beaconFloat";

  const ring = meshOf(palette, "brass", [
    placed(new THREE.TorusGeometry(BEACON_RING_RADIUS, BEACON_TUBE, 8, 48), 0, 0, 0, { x: Math.PI / 2 }),
  ]);
  ring.name = "ring";

  const diamondGeometry = new THREE.OctahedronGeometry(1, 0);
  const position = diamondGeometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (y < 0) position.setY(i, y * 1.8); // stretch the lower point so it aims down
  }
  diamondGeometry.computeVertexNormals(); // non-indexed, so these are flat per-face normals
  const diamond = meshOf(palette, "brass", [placed(diamondGeometry, 0, 2.2, 0, {}, [0.8, 1, 0.8])]);
  diamond.name = "diamond";

  floating.add(ring, diamond);
  beacon.add(floating);
  return beacon;
}

/** Gentle hover and spin; static when reducedMotion. */
export function animateBeacon(beacon: THREE.Group, seconds: number, reducedMotion: boolean): void {
  if (reducedMotion) return;
  const floating = beacon.getObjectByName("beaconFloat");
  if (!floating) throw new Error('animateBeacon: group has no "beaconFloat" child; build it with createBeacon');
  floating.position.y = Math.sin(seconds * 1.6) * 0.4;
  floating.rotation.y = seconds * 0.6;
}
