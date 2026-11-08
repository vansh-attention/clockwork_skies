import * as THREE from "three";
import { createIllustratedMaterial } from "@clockwork/render";

/**
 * Drawn people: one smoothly skinned mesh per person, in one shared illustrated material (character shading, colours
 * per vertex, an outlined surface per garment). Bodies are lofted from rings along a skeleton, so limbs bend at the
 * joints instead of hinging as separate parts. All figures face −Z with their feet at y = 0; their left is −X.
 *
 * The geometry is original and generated here; proportions follow an adult of about 5.8 heads (a touch of youth in the
 * head size, without a toy's short legs).
 */

export type FigureLook = Readonly<{
  /** Uniform size against the courier (1 = 3.79 units tall). */
  scale?: number;
  /** Width of shoulders, chest and hips (1 = the courier's build). */
  build?: number;
  skin: string;
  hair: string;
  hairStyle?: "short" | "bob" | "bun";
  jacket: string;
  /** Cuffs, hem and collar. */
  trim: string;
  trousers: string;
  /** The rolled-up hem; the trousers' colour when left out (plain hems). */
  turnup?: string;
  socks: string;
  shoes: string;
  /** A flat cap's colour, or none. */
  cap?: string;
  /** A leather satchel on a strap across the chest, or none. */
  bag?: Readonly<{ body: string; flap: string; strap: string }>;
}>;

/** The courier: a flat tweed cap, a mustard work jacket, dark teal trousers turned up over cream socks, a satchel. */
export const COURIER_LOOK: FigureLook = {
  skin: "#e1b597", hair: "#3a2b25", hairStyle: "short",
  jacket: "#c99a3c", trim: "#a77a2c", trousers: "#2f4b56", turnup: "#4a6a74", socks: "#ece4d1", shoes: "#3b2c27",
  cap: "#5b5d61", bag: { body: "#8c5737", flap: "#9b6340", strap: "#5a3a2a" },
};

/** Base proportions (scale 1). Joint positions are in the figure's own space. */
const BASE = {
  height: 3.79,
  hipJoint: { x: 0.19, y: 1.82 },
  knee: 0.97,
  ankle: 0.15,
  shoulder: { x: 0.43, y: 2.94 },
  elbow: { x: 0.47, y: 2.27 },
  wrist: { x: 0.49, y: 1.73 },
  hips: 1.86, spine: 2.16, chest: 2.56, neck: 3.04, head: 3.22,
} as const;

/** The leg's dimensions, which the gait needs to keep a planted foot on the ground. */
export type LegDimensions = Readonly<{
  hip: number; thigh: number; shin: number; ankle: number;
  /** Sole points relative to the ankle, along forward (+) and up (+): heel, ball, toe tip. */
  sole: readonly (readonly [forward: number, up: number])[];
}>;

export const BASE_LEG: LegDimensions = {
  hip: BASE.hipJoint.y, thigh: BASE.hipJoint.y - BASE.knee, shin: BASE.knee - BASE.ankle, ankle: BASE.ankle,
  sole: [[-0.13, -BASE.ankle], [0.3, -BASE.ankle], [0.5, -BASE.ankle + 0.03]],
};

const BONE_NAMES = [
  "hips", "spine", "chest", "neck", "head", "eyes", "bag",
  "clavicleL", "upperArmL", "foreArmL", "handL", "clavicleR", "upperArmR", "foreArmR", "handR",
  "thighL", "shinL", "footL", "thighR", "shinR", "footR",
] as const;
type BoneName = (typeof BONE_NAMES)[number];
const BONE = Object.fromEntries(BONE_NAMES.map((name, index) => [name, index])) as Record<BoneName, number>;

export type FigureBones = {
  hips: THREE.Bone; spine: THREE.Bone; chest: THREE.Bone; neck: THREE.Bone; head: THREE.Bone; eyes: THREE.Bone; bag: THREE.Bone;
  clavicle: [THREE.Bone, THREE.Bone]; upperArm: [THREE.Bone, THREE.Bone]; foreArm: [THREE.Bone, THREE.Bone]; hand: [THREE.Bone, THREE.Bone];
  thigh: [THREE.Bone, THREE.Bone]; shin: [THREE.Bone, THREE.Bone]; foot: [THREE.Bone, THREE.Bone];
};

export type Figure = {
  /** Place and turn this; the skinned mesh and its bones live inside. */
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: FigureBones;
  /** Rest position of the hips bone (the pose moves it from here). */
  hipsRest: THREE.Vector3;
  scale: number;
  height: number;
  leg: LegDimensions;
};

/** Where outlined garments start in surface-id space (each garment adds a step; scenery stays well below). */
const FIGURE_SURFACE_ID = 0.902;
const ID_STEP = 0.0062;
const GARMENT = { skin: 0, hair: 1, jacket: 2, trim: 3, trousers: 4, turnup: 5, socks: 6, shoes: 7, bag: 8, strap: 9, eyes: 10, cap: 11 } as const;

/** One shared material for every drawn person (colours and garments ride on the vertices). */
export function createFigureMaterial(): THREE.ShaderMaterial {
  const material = createIllustratedMaterial({
    color: "#ffffff", lighting: "world", vertexColors: true, character: true, surfaceId: FIGURE_SURFACE_ID, outline: 1, grain: 0,
  });
  material.name = "ClockworkFigureMaterial";
  return material;
}

type Skin = readonly [bone: number, other?: number, otherWeight?: number];
type Ring = Readonly<{ at: THREE.Vector3; rx: number; rz: number; skin: Skin }>;
type LoftOptions = Readonly<{
  segments: number;
  garment: keyof typeof GARMENT;
  color: string;
  capStart?: boolean;
  capEnd?: boolean;
  /** 0 round .. 1 boxy cross-sections (a superellipse), for bags and soles. */
  boxy?: number;
  /** Squash the front (−Z side) of each ring flat by this fraction: faces. */
  flatFront?: number;
  /** The direction a ring's z-radius points (default: the figure's front, −Z). */
  facing?: THREE.Vector3;
}>;

/** Collects the figure's vertices with their skin, colour and garment; merges into one skinned geometry. */
class FigureBuilder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  readonly ids: number[] = [];
  readonly skinIndex: number[] = [];
  readonly skinWeight: number[] = [];
  readonly indices: number[] = [];

  private vertex(p: THREE.Vector3, skin: Skin, color: THREE.Color, garment: number): number {
    const index = this.positions.length / 3;
    this.positions.push(p.x, p.y, p.z);
    this.colors.push(color.r, color.g, color.b);
    this.ids.push(garment * ID_STEP);
    const [bone, other = bone, weight = 0] = skin;
    this.skinIndex.push(bone, other, 0, 0);
    this.skinWeight.push(1 - weight, weight, 0, 0);
    return index;
  }

  /** Adds triangle (a, b, c), flipped if needed so it faces away from `inside`. */
  private face(a: number, b: number, c: number, inside: THREE.Vector3): void {
    const p = (i: number) => new THREE.Vector3(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
    const pa = p(a), pb = p(b), pc = p(c);
    const normal = pb.clone().sub(pa).cross(pc.clone().sub(pa));
    const centre = pa.clone().add(pb).add(pc).divideScalar(3);
    if (normal.dot(centre.sub(inside)) < 0) this.indices.push(a, c, b);
    else this.indices.push(a, b, c);
  }

  /** A tube through rings (elliptical cross-sections perpendicular to the path), optionally capped. */
  loft(rings: readonly Ring[], options: LoftOptions): void {
    const color = new THREE.Color(options.color);
    const garment = GARMENT[options.garment];
    const n = options.segments;
    const facing = options.facing ?? new THREE.Vector3(0, 0, -1);
    const boxy = options.boxy ?? 0;
    const start = this.positions.length / 3;
    const centres: THREE.Vector3[] = [];
    rings.forEach((ring, r) => {
      const previous = rings[Math.max(0, r - 1)]!.at;
      const next = rings[Math.min(rings.length - 1, r + 1)]!.at;
      const tangent = next.clone().sub(previous).normalize();
      let side = tangent.clone().cross(facing);
      if (side.lengthSq() < 1e-6) side = tangent.clone().cross(new THREE.Vector3(1, 0, 0));
      side.normalize();
      const front = side.clone().cross(tangent).normalize();
      // Keep "front" on the facing side, so flatFront squashes the face and not the back of the head.
      if (front.dot(facing) < 0) front.negate();
      centres.push(ring.at);
      for (let i = 0; i < n; i += 1) {
        const theta = (i / n) * Math.PI * 2;
        let c = Math.cos(theta), s = Math.sin(theta);
        if (boxy > 0) {
          const exponent = 2 / (2 + boxy * 6);
          c = Math.sign(c) * Math.abs(c) ** exponent;
          s = Math.sign(s) * Math.abs(s) ** exponent;
        }
        let along = s * ring.rz;
        if (options.flatFront && s > 0 && Math.abs(c) < 0.8) along = Math.min(along, ring.rz * (1 - options.flatFront * (1 - Math.abs(c) * 0.5)));
        const p = ring.at.clone().addScaledVector(side, c * ring.rx).addScaledVector(front, along);
        this.vertex(p, ring.skin, color, garment);
      }
    });
    for (let r = 0; r < rings.length - 1; r += 1) {
      const inside = centres[r]!.clone().add(centres[r + 1]!).multiplyScalar(0.5);
      for (let i = 0; i < n; i += 1) {
        const j = (i + 1) % n;
        const a = start + r * n + i, b = start + (r + 1) * n + i, c = start + (r + 1) * n + j, d = start + r * n + j;
        this.face(a, b, c, inside);
        this.face(a, c, d, inside);
      }
    }
    const cap = (ringIndex: number, inward: THREE.Vector3) => {
      const ring = rings[ringIndex]!;
      const centre = this.vertex(ring.at, ring.skin, color, garment);
      const inside = ring.at.clone().add(inward);
      for (let i = 0; i < n; i += 1) this.face(centre, start + ringIndex * n + i, start + ringIndex * n + (i + 1) % n, inside);
    };
    if (options.capStart) cap(0, rings[1]!.at.clone().sub(rings[0]!.at).normalize().multiplyScalar(0.01));
    if (options.capEnd) cap(rings.length - 1, rings[rings.length - 2]!.at.clone().sub(rings[rings.length - 1]!.at).normalize().multiplyScalar(0.01));
  }

  /** An ellipsoid (a sphere scaled by `radii`) bound to one bone: eyes, ears, buttons, a nose. */
  blob(centre: THREE.Vector3, radii: THREE.Vector3, skin: Skin, garment: keyof typeof GARMENT, colour: string, detail: [number, number] = [10, 7]): void {
    const sphere = new THREE.SphereGeometry(1, detail[0], detail[1]);
    const position = sphere.getAttribute("position");
    const index = sphere.getIndex()!;
    const color = new THREE.Color(colour);
    const offset = this.positions.length / 3;
    for (let i = 0; i < position.count; i += 1) {
      this.vertex(new THREE.Vector3(position.getX(i) * radii.x, position.getY(i) * radii.y, position.getZ(i) * radii.z).add(centre), skin, color, GARMENT[garment]);
    }
    for (let i = 0; i < index.count; i += 3) {
      const a = offset + index.getX(i), b = offset + index.getX(i + 1), c = offset + index.getX(i + 2);
      this.face(a, b, c, centre);
    }
    sphere.dispose();
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute("idShift", new THREE.Float32BufferAttribute(this.ids, 1));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((this.positions.length / 3) * 2), 2));
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.skinIndex, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.skinWeight, 4));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    return geometry;
  }
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const mix = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);

/** A leg in trousers (one side), the turned-up hem, an ankle in a sock, and a shoe. Side −1 is the left (−X). */
function addLeg(builder: FigureBuilder, look: FigureLook, side: -1 | 1, w: number): void {
  const L = side < 0 ? "L" : "R";
  const thigh = BONE[`thigh${L}`], shin = BONE[`shin${L}`], foot = BONE[`foot${L}`];
  const x = side * BASE.hipJoint.x * w;
  const legRings: [number, number, number, Skin][] = [
    [2.04, 0.2 * w, 0.215, [BONE.hips, thigh, 0.25]],
    [1.86, 0.205 * w, 0.22, [BONE.hips, thigh, 0.6]],
    [1.68, 0.2 * w, 0.212, [BONE.hips, thigh, 0.92]],
    [1.42, 0.186 * w, 0.198, [thigh]],
    [1.18, 0.164, 0.176, [thigh]],
    [1.03, 0.152, 0.16, [thigh, shin, 0.25]],
    [0.94, 0.15, 0.156, [thigh, shin, 0.75]],
    [0.82, 0.152, 0.16, [shin]],
    [0.68, 0.156, 0.162, [shin]],
    [0.54, 0.142, 0.148, [shin]],
    [0.44, 0.14, 0.146, [shin]],
  ];
  builder.loft(legRings.map(([y, rx, rz, skin]) => ({ at: v(x, y, 0.01), rx, rz, skin })), { segments: 14, garment: "trousers", color: look.trousers });
  if (look.turnup) {
    builder.loft([
      { at: v(x, 0.53, 0.01), rx: 0.152, rz: 0.158, skin: [shin] },
      { at: v(x, 0.47, 0.01), rx: 0.158, rz: 0.164, skin: [shin] },
      { at: v(x, 0.41, 0.01), rx: 0.152, rz: 0.158, skin: [shin] },
    ], { segments: 14, garment: "turnup", color: look.turnup, capEnd: true });
  }
  builder.loft([
    { at: v(x, 0.46, 0.02), rx: 0.098, rz: 0.1, skin: [shin] },
    { at: v(x, 0.3, 0.025), rx: 0.092, rz: 0.094, skin: [shin, foot, 0.2] },
    { at: v(x, 0.19, 0.03), rx: 0.09, rz: 0.094, skin: [shin, foot, 0.7] },
  ], { segments: 12, garment: "socks", color: look.socks });
  // The shoe, lofted heel to toe along −Z, its sole on the ground at rest.
  const ankleZ = 0.04;
  const shoe: [z: number, halfWidth: number, halfHeight: number, centreY: number][] = [
    [0.18, 0.06, 0.06, 0.08], [0.15, 0.1, 0.095, 0.095], [0.06, 0.115, 0.115, 0.115], [-0.06, 0.12, 0.1, 0.1],
    [-0.2, 0.125, 0.085, 0.085], [-0.33, 0.118, 0.072, 0.072], [-0.42, 0.092, 0.058, 0.06], [-0.47, 0.04, 0.03, 0.05],
  ];
  builder.loft(shoe.map(([z, hw, hh, cy]) => ({ at: v(x, cy, ankleZ + z), rx: hw, rz: hh, skin: [foot] as Skin })), {
    segments: 14, garment: "shoes", color: look.shoes, capStart: true, capEnd: true, boxy: 0.3, facing: v(0, 1, 0),
  });
}

/** An arm in a sleeve with a cuff, and a hand. Side −1 is the left (−X). */
function addArm(builder: FigureBuilder, look: FigureLook, side: -1 | 1, w: number): void {
  const L = side < 0 ? "L" : "R";
  const clavicle = BONE[`clavicle${L}`], upper = BONE[`upperArm${L}`], fore = BONE[`foreArm${L}`], hand = BONE[`hand${L}`];
  const shoulder = v(side * BASE.shoulder.x * w, BASE.shoulder.y, 0.02);
  const elbow = v(side * (BASE.elbow.x * w + 0.02), BASE.elbow.y, 0.04);
  const wrist = v(side * (BASE.wrist.x * w + 0.03), BASE.wrist.y, 0.0);
  // The sleeve starts just inside the jacket's sloping shoulder, so no peak shows above the arm.
  const up = mix(shoulder, elbow, -0.04).add(v(-side * 0.03, 0, 0));
  builder.loft([
    { at: up, rx: 0.125, rz: 0.15, skin: [BONE.chest, clavicle, 0.6] },
    { at: shoulder, rx: 0.152, rz: 0.165, skin: [clavicle, upper, 0.65] },
    { at: mix(shoulder, elbow, 0.22), rx: 0.152, rz: 0.158, skin: [upper] },
    { at: mix(shoulder, elbow, 0.55), rx: 0.138, rz: 0.142, skin: [upper] },
    { at: mix(shoulder, elbow, 0.86), rx: 0.126, rz: 0.13, skin: [upper, fore, 0.3] },
    { at: elbow, rx: 0.122, rz: 0.126, skin: [upper, fore, 0.55] },
    { at: mix(elbow, wrist, 0.14), rx: 0.124, rz: 0.128, skin: [upper, fore, 0.85] },
    { at: mix(elbow, wrist, 0.5), rx: 0.122, rz: 0.124, skin: [fore] },
    { at: mix(elbow, wrist, 0.8), rx: 0.11, rz: 0.112, skin: [fore] },
  ], { segments: 12, garment: "jacket", color: look.jacket });
  builder.loft([
    { at: mix(elbow, wrist, 0.78), rx: 0.118, rz: 0.12, skin: [fore] },
    { at: mix(elbow, wrist, 0.9), rx: 0.12, rz: 0.122, skin: [fore] },
    { at: mix(elbow, wrist, 0.97), rx: 0.112, rz: 0.114, skin: [fore] },
  ], { segments: 12, garment: "trim", color: look.trim, capEnd: true });
  // A relaxed hand: wrist, palm and loosely closed fingers in one mitten, with a thumb toward the front.
  const down = wrist.clone().sub(elbow).normalize();
  const along = (d: number) => wrist.clone().addScaledVector(down, d);
  builder.loft([
    { at: along(-0.06), rx: 0.07, rz: 0.066, skin: [fore, hand, 0.5] },
    { at: along(0.03), rx: 0.074, rz: 0.06, skin: [hand] },
    { at: along(0.13), rx: 0.092, rz: 0.058, skin: [hand] },
    { at: along(0.22), rx: 0.094, rz: 0.054, skin: [hand] },
    { at: along(0.3), rx: 0.08, rz: 0.05, skin: [hand] },
    { at: along(0.355), rx: 0.04, rz: 0.03, skin: [hand] },
  ], { segments: 10, garment: "skin", color: look.skin, capEnd: true, facing: v(-side, 0, 0) });
  builder.blob(along(0.12).add(v(-side * 0.04, 0, -0.065)), v(0.032, 0.075, 0.032), [hand], "skin", look.skin, [8, 6]);
}

/** The side a strap path faces (its middle point's z sign), so its flat side lies on the jacket. */
function strapFacing(path: readonly [number, number, number, Skin][]): number {
  return Math.sign(path[Math.floor(path.length / 2)]![2]) || -1;
}

/** The torso (jacket over a waistband), neck, head, face and hair; the cap and the satchel when the look has them. */
function addBody(builder: FigureBuilder, look: FigureLook, w: number): void {
  const { hips, spine, chest, neck, head, eyes, bag } = BONE;
  // Seat and waist of the trousers, inside the jacket's hem.
  builder.loft([
    { at: v(0, 1.64, 0.02), rx: 0.3 * w, rz: 0.2, skin: [hips] },
    { at: v(0, 1.78, 0.02), rx: 0.36 * w, rz: 0.235, skin: [hips] },
    { at: v(0, 1.94, 0.01), rx: 0.37 * w, rz: 0.24, skin: [hips] },
    { at: v(0, 2.06, 0.0), rx: 0.355 * w, rz: 0.232, skin: [hips, spine, 0.3] },
  ], { segments: 18, garment: "trousers", color: look.trousers, capStart: true });
  // The jacket: a short work jacket ending at the waist, fuller over the chest, with sloped shoulders.
  builder.loft([
    { at: v(0, 1.9, 0.02), rx: 0.405 * w, rz: 0.29, skin: [hips] },
    { at: v(0, 2.06, 0.015), rx: 0.395 * w, rz: 0.278, skin: [hips, spine, 0.45] },
    { at: v(0, 2.26, 0.01), rx: 0.38 * w, rz: 0.265, skin: [spine] },
    { at: v(0, 2.5, 0.0), rx: 0.41 * w, rz: 0.278, skin: [spine, chest, 0.55] },
    { at: v(0, 2.72, 0.0), rx: 0.44 * w, rz: 0.288, skin: [chest] },
    { at: v(0, 2.88, 0.01), rx: 0.46 * w, rz: 0.27, skin: [chest] },
    { at: v(0, 2.97, 0.02), rx: 0.41 * w, rz: 0.235, skin: [chest] },
    { at: v(0, 3.05, 0.025), rx: 0.235, rz: 0.19, skin: [chest, neck, 0.3] },
  ], { segments: 20, garment: "jacket", color: look.jacket, capStart: true, capEnd: true });
  // The hem band and a stand-up collar in the trim colour.
  builder.loft([
    { at: v(0, 1.95, 0.02), rx: 0.412 * w, rz: 0.296, skin: [hips] },
    { at: v(0, 1.87, 0.02), rx: 0.414 * w, rz: 0.298, skin: [hips] },
  ], { segments: 20, garment: "trim", color: look.trim, capEnd: true });
  builder.loft([
    { at: v(0, 3.0, 0.03), rx: 0.215, rz: 0.2, skin: [chest] },
    { at: v(0, 3.1, 0.035), rx: 0.2, rz: 0.19, skin: [chest, neck, 0.5] },
    { at: v(0, 3.15, 0.04), rx: 0.19, rz: 0.18, skin: [neck] },
  ], { segments: 16, garment: "trim", color: look.trim });
  // Neck.
  builder.loft([
    { at: v(0, 3.0, 0.03), rx: 0.105, rz: 0.11, skin: [chest, neck, 0.5] },
    { at: v(0, 3.14, 0.025), rx: 0.098, rz: 0.104, skin: [neck] },
    { at: v(0, 3.26, 0.02), rx: 0.1, rz: 0.106, skin: [neck, head, 0.7] },
  ], { segments: 12, garment: "skin", color: look.skin });
  // Head: chin to crown, with a flatter face.
  const headRings: [y: number, rx: number, rz: number, z: number][] = [
    [3.16, 0.07, 0.06, -0.135], [3.2, 0.13, 0.13, -0.085], [3.27, 0.185, 0.2, -0.04], [3.36, 0.218, 0.236, -0.012],
    [3.47, 0.232, 0.25, 0.0], [3.58, 0.232, 0.252, 0.008], [3.67, 0.205, 0.228, 0.012], [3.74, 0.14, 0.16, 0.014], [3.785, 0.03, 0.035, 0.014],
  ];
  builder.loft(headRings.map(([y, rx, rz, z]) => ({ at: v(0, y, z), rx, rz, skin: [head] as Skin })), {
    segments: 20, garment: "skin", color: look.skin, capStart: true, capEnd: true, flatFront: 0.22,
  });
  // Ears, nose, eyes and brows.
  for (const side of [-1, 1]) builder.blob(v(side * 0.232, 3.44, 0.02), v(0.035, 0.07, 0.05), [head], "skin", look.skin, [8, 6]);
  builder.blob(v(0, 3.4, -0.218), v(0.036, 0.05, 0.04), [head], "skin", look.skin, [8, 6]);
  for (const side of [-1, 1]) {
    builder.blob(v(side * 0.086, 3.46, -0.205), v(0.025, 0.037, 0.018), [eyes], "eyes", look.hair, [10, 8]);
    builder.blob(v(side * 0.092, 3.535, -0.206), v(0.055, 0.012, 0.02), [head], "hair", look.hair, [8, 4]);
  }
  // Hair: a shell over the back and sides of the skull, with the hairline above the brow.
  const hairRings: [y: number, rx: number, rz: number, z: number][] = look.hairStyle === "bob"
    ? [[3.24, 0.25, 0.26, 0.05], [3.36, 0.262, 0.272, 0.03], [3.5, 0.255, 0.27, 0.015], [3.62, 0.245, 0.262, 0.012], [3.71, 0.2, 0.22, 0.015], [3.775, 0.1, 0.12, 0.016], [3.8, 0.02, 0.02, 0.016]]
    : [[3.3, 0.21, 0.22, 0.06], [3.42, 0.245, 0.262, 0.03], [3.54, 0.248, 0.268, 0.015], [3.64, 0.226, 0.246, 0.014], [3.72, 0.17, 0.19, 0.016], [3.775, 0.08, 0.1, 0.016], [3.795, 0.02, 0.02, 0.016]];
  const hair = hairRings.map(([y, rx, rz, z]) => ({ at: v(0, y, z), rx, rz, skin: [head] as Skin }));
  builder.loft(hair, { segments: 20, garment: "hair", color: look.hair, capEnd: true, flatFront: 0.5 });
  if (look.hairStyle === "bun") builder.blob(v(0, 3.66, 0.24), v(0.11, 0.1, 0.1), [head], "hair", look.hair);
  if (look.cap) {
    // A flat cap: a soft crown pulled forward, and a short stiff peak.
    builder.loft([
      { at: v(0, 3.6, 0.0), rx: 0.255, rz: 0.27, skin: [head] },
      { at: v(0, 3.7, -0.025), rx: 0.268, rz: 0.292, skin: [head] },
      { at: v(0, 3.77, -0.04), rx: 0.24, rz: 0.268, skin: [head] },
      { at: v(0, 3.82, -0.045), rx: 0.14, rz: 0.16, skin: [head] },
      { at: v(0, 3.835, -0.045), rx: 0.03, rz: 0.03, skin: [head] },
    ], { segments: 20, garment: "cap", color: look.cap, capStart: true, capEnd: true });
    builder.loft([
      { at: v(0, 3.625, -0.2), rx: 0.2, rz: 0.035, skin: [head] },
      { at: v(0, 3.6, -0.3), rx: 0.19, rz: 0.03, skin: [head] },
      { at: v(0, 3.585, -0.345), rx: 0.14, rz: 0.022, skin: [head] },
    ], { segments: 12, garment: "cap", color: look.cap, capStart: true, capEnd: true, boxy: 0.6, facing: v(0, 1, 0) });
  }
  if (look.bag) {
    // A satchel at the left hip, slightly behind, on a strap from the right shoulder across the chest and back.
    const centre = v(-0.43 * w, 1.98, 0.12);
    builder.loft([
      { at: centre.clone().add(v(0, -0.2, 0)), rx: 0.07, rz: 0.23, skin: [bag] },
      { at: centre.clone().add(v(0, -0.17, 0)), rx: 0.085, rz: 0.25, skin: [bag] },
      { at: centre.clone().add(v(0, 0.12, 0)), rx: 0.088, rz: 0.255, skin: [bag] },
      { at: centre.clone().add(v(0, 0.17, 0)), rx: 0.075, rz: 0.24, skin: [bag] },
    ], { segments: 16, garment: "bag", color: look.bag.body, capStart: true, capEnd: true, boxy: 0.75 });
    builder.loft([
      { at: centre.clone().add(v(-0.07, 0.18, 0)), rx: 0.022, rz: 0.262, skin: [bag] },
      { at: centre.clone().add(v(-0.1, 0.05, 0)), rx: 0.02, rz: 0.262, skin: [bag] },
      { at: centre.clone().add(v(-0.1, -0.05, 0)), rx: 0.018, rz: 0.25, skin: [bag] },
    ], { segments: 12, garment: "bag", color: look.bag.flap, capStart: true, capEnd: true, boxy: 0.8 });
    const strapFront: [number, number, number, Skin][] = [
      [0.3 * w, 3.0, -0.12, [chest]], [0.12 * w, 2.84, -0.31, [chest]], [-0.12 * w, 2.5, -0.305, [chest, spine, 0.5]],
      [-0.33 * w, 2.18, -0.27, [spine, hips, 0.6]], [-0.44 * w, 2.12, -0.06, [hips, bag, 0.5]],
    ];
    const strapBack: [number, number, number, Skin][] = [
      [0.3 * w, 3.0, 0.1, [chest]], [0.12 * w, 2.86, 0.29, [chest]], [-0.14 * w, 2.5, 0.3, [chest, spine, 0.5]],
      [-0.34 * w, 2.2, 0.28, [spine, hips, 0.6]], [-0.44 * w, 2.12, 0.2, [hips, bag, 0.5]],
    ];
    for (const path of [strapFront, strapBack]) {
      builder.loft(path.map(([x, y, z, skin]) => ({ at: v(x, y, z), rx: 0.058, rz: 0.022, skin })), {
        segments: 8, garment: "strap", color: look.bag.strap, boxy: 0.5, facing: v(0, 0, strapFacing(path)),
      });
    }
    builder.loft([
      { at: v(0.36 * w, 3.02, -0.12), rx: 0.06, rz: 0.024, skin: [chest] },
      { at: v(0.39 * w, 3.06, 0.0), rx: 0.06, rz: 0.024, skin: [chest] },
      { at: v(0.36 * w, 3.02, 0.12), rx: 0.06, rz: 0.024, skin: [chest] },
    ], { segments: 8, garment: "strap", color: look.bag.strap, boxy: 0.5, facing: v(0, 1, 0) });
  }
}

/** Rest positions of every bone, in figure space (scale 1, build w). */
function bonePositions(w: number): Record<BoneName, THREE.Vector3> {
  const sx = (x: number) => x * w;
  return {
    hips: v(0, BASE.hips, 0.02), spine: v(0, BASE.spine, 0.01), chest: v(0, BASE.chest, 0), neck: v(0, BASE.neck, 0.025), head: v(0, BASE.head, 0.02),
    eyes: v(0, 3.46, -0.2), bag: v(-0.43 * w, 2.15, 0.1),
    clavicleL: v(sx(-0.08), 2.92, 0.02), upperArmL: v(-sx(BASE.shoulder.x), BASE.shoulder.y, 0.02),
    foreArmL: v(-(BASE.elbow.x * w + 0.02), BASE.elbow.y, 0.04), handL: v(-(BASE.wrist.x * w + 0.03), BASE.wrist.y, 0),
    clavicleR: v(sx(0.08), 2.92, 0.02), upperArmR: v(sx(BASE.shoulder.x), BASE.shoulder.y, 0.02),
    foreArmR: v(BASE.elbow.x * w + 0.02, BASE.elbow.y, 0.04), handR: v(BASE.wrist.x * w + 0.03, BASE.wrist.y, 0),
    thighL: v(-BASE.hipJoint.x * w, BASE.hipJoint.y, 0.01), shinL: v(-BASE.hipJoint.x * w, BASE.knee, 0.01), footL: v(-BASE.hipJoint.x * w, BASE.ankle, 0.04),
    thighR: v(BASE.hipJoint.x * w, BASE.hipJoint.y, 0.01), shinR: v(BASE.hipJoint.x * w, BASE.knee, 0.01), footR: v(BASE.hipJoint.x * w, BASE.ankle, 0.04),
  };
}

const PARENT: Record<BoneName, BoneName | null> = {
  hips: null, spine: "hips", chest: "spine", neck: "chest", head: "neck", eyes: "head", bag: "hips",
  clavicleL: "chest", upperArmL: "clavicleL", foreArmL: "upperArmL", handL: "foreArmL",
  clavicleR: "chest", upperArmR: "clavicleR", foreArmR: "upperArmR", handR: "foreArmR",
  thighL: "hips", shinL: "thighL", footL: "shinL", thighR: "hips", shinR: "thighR", footR: "shinR",
};

/** Build one person in `look`, drawn with `material` (see createFigureMaterial, shared by every figure). */
export function createFigure(look: FigureLook, material: THREE.Material): Figure {
  const scale = look.scale ?? 1;
  const w = look.build ?? 1;
  const builder = new FigureBuilder();
  addLeg(builder, look, -1, w);
  addLeg(builder, look, 1, w);
  addArm(builder, look, -1, w);
  addArm(builder, look, 1, w);
  addBody(builder, look, w);
  const geometry = builder.build();

  const rest = bonePositions(w);
  const bones = new Map<BoneName, THREE.Bone>();
  for (const name of BONE_NAMES) {
    const bone = new THREE.Bone();
    bone.name = name;
    bones.set(name, bone);
  }
  for (const name of BONE_NAMES) {
    const bone = bones.get(name)!;
    const parent = PARENT[name];
    const position = rest[name].clone();
    if (parent) {
      position.sub(rest[parent]);
      bones.get(parent)!.add(bone);
    }
    bone.position.copy(position);
  }
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = "figure";
  const root = bones.get("hips")!;
  mesh.add(root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(BONE_NAMES.map((name) => bones.get(name)!)));
  // Limbs swing beyond the bind-pose bounds; the figure is small, so culling it whole is not worth the risk.
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.name = "figureRoot";
  group.add(mesh);
  mesh.scale.setScalar(scale);
  const pick = (name: BoneName) => bones.get(name)!;
  const pair = (name: "clavicle" | "upperArm" | "foreArm" | "hand" | "thigh" | "shin" | "foot"): [THREE.Bone, THREE.Bone] =>
    [pick(`${name}L` as BoneName), pick(`${name}R` as BoneName)];
  return {
    group, mesh, scale,
    height: BASE.height * scale,
    hipsRest: root.position.clone(),
    leg: BASE_LEG,
    bones: {
      hips: pick("hips"), spine: pick("spine"), chest: pick("chest"), neck: pick("neck"), head: pick("head"), eyes: pick("eyes"), bag: pick("bag"),
      clavicle: pair("clavicle"), upperArm: pair("upperArm"), foreArm: pair("foreArm"), hand: pair("hand"),
      thigh: pair("thigh"), shin: pair("shin"), foot: pair("foot"),
    },
  };
}

/** Joint rotations (radians, see poseFigure for their sense) and the hips' offset from rest, in figure units. */
export type LegJointPose = { hip: number; hipOut: number; hipTwist: number; knee: number; ankle: number };
export type ArmJointPose = { swing: number; out: number; elbow: number; wrist: number };
export type FigurePose = {
  hips: { x: number; y: number; z: number; pitch: number; yaw: number; roll: number };
  spine: { pitch: number; yaw: number; roll: number };
  chest: { pitch: number; yaw: number; roll: number };
  neck: { pitch: number; yaw: number };
  head: { pitch: number; yaw: number; roll: number };
  /** 1 open .. 0 shut. */
  eyes: number;
  bag: { pitch: number; roll: number };
  legs: [LegJointPose, LegJointPose];
  arms: [ArmJointPose, ArmJointPose];
};

export function createFigurePose(): FigurePose {
  return {
    hips: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 },
    spine: { pitch: 0, yaw: 0, roll: 0 }, chest: { pitch: 0, yaw: 0, roll: 0 }, neck: { pitch: 0, yaw: 0 }, head: { pitch: 0, yaw: 0, roll: 0 },
    eyes: 1, bag: { pitch: 0, roll: 0 },
    legs: [{ hip: 0, hipOut: 0, hipTwist: 0, knee: 0, ankle: 0 }, { hip: 0, hipOut: 0, hipTwist: 0, knee: 0, ankle: 0 }],
    arms: [{ swing: 0, out: 0.08, elbow: 0.18, wrist: 0 }, { swing: 0, out: 0.08, elbow: 0.18, wrist: 0 }],
  };
}

/**
 * Put a pose on the figure's bones. Senses, in the figure's frame (facing −Z, left at −X): positive hip/swing moves
 * a limb forward; positive knee bends the shin back; positive ankle lifts the toes; positive elbow brings the forearm
 * forward and up; positive `out` raises a limb away from the body's midline. For hips, spine, chest, neck and head,
 * a negative pitch leans forward (three's x rotation of an upright bone), positive yaw turns toward the figure's
 * left, and positive roll lifts its right side.
 */
export function poseFigure(figure: Figure, pose: FigurePose): void {
  const b = figure.bones;
  b.hips.position.set(figure.hipsRest.x + pose.hips.x, figure.hipsRest.y + pose.hips.y, figure.hipsRest.z + pose.hips.z);
  b.hips.rotation.set(pose.hips.pitch, pose.hips.yaw, pose.hips.roll, "YXZ");
  b.spine.rotation.set(pose.spine.pitch, pose.spine.yaw, pose.spine.roll, "YXZ");
  b.chest.rotation.set(pose.chest.pitch, pose.chest.yaw, pose.chest.roll, "YXZ");
  b.neck.rotation.set(pose.neck.pitch, pose.neck.yaw, 0, "YXZ");
  b.head.rotation.set(pose.head.pitch, pose.head.yaw, pose.head.roll, "YXZ");
  b.eyes.scale.set(1, Math.max(0.08, Math.min(1, pose.eyes)), 1);
  b.bag.rotation.set(pose.bag.pitch, 0, pose.bag.roll);
  for (let i = 0; i < 2; i += 1) {
    const side = i === 0 ? -1 : 1;
    const leg = pose.legs[i]!;
    // Forward is −Z: a positive x rotation of a hanging bone swings it forward. Abduction moves a left limb toward −X.
    b.thigh[i]!.rotation.set(leg.hip, side * leg.hipTwist, side * leg.hipOut, "XZY");
    b.shin[i]!.rotation.set(-leg.knee, 0, 0);
    b.foot[i]!.rotation.set(leg.ankle, 0, 0);
    const arm = pose.arms[i]!;
    b.upperArm[i]!.rotation.set(arm.swing, 0, side * arm.out, "XZY");
    b.foreArm[i]!.rotation.set(arm.elbow, 0, 0);
    b.hand[i]!.rotation.set(arm.wrist, 0, 0);
  }
}

/** Dispose of a figure's geometry and bone texture (the material is shared and stays). */
export function disposeFigure(figure: Figure): void {
  figure.mesh.geometry.dispose();
  figure.mesh.skeleton.dispose();
}
