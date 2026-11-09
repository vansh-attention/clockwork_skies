import * as THREE from "three";
import { createIllustratedMaterial } from "@clockwork/render";

/**
 * Drawn people: one smoothly skinned mesh per person, in one shared illustrated material (character shading, colours
 * per vertex, an outlined surface per garment). Bodies are lofted from rings along a skeleton, so limbs bend at the
 * joints instead of hinging as separate parts. All figures face −Z with their feet at y = 0; their left is −X.
 *
 * The geometry is original and generated here; proportions follow an adult of about 5.8 heads (a touch of youth in the
 * head size, without a toy's short legs). A look can make the figure shorter and stubbier (FigureLook.stature), as the
 * courier is.
 */

export type FigureLook = Readonly<{
  /** Uniform size against the courier (1 = 3.79 units tall). */
  scale?: number;
  /** Width of shoulders, chest and hips (1 = the courier's build). */
  build?: number;
  skin: string;
  hair: string;
  /** "long": a bob's shell with long hair down the back and locks framing the face. */
  hairStyle?: "short" | "bob" | "bun" | "long";
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
  /**
   * Head size against the default (1). The neck shortens to match, so the crown stays where it was and the figure's
   * height, legs and gait are unchanged: a bigger head on a short neck reads younger.
   */
  head?: number;
  /**
   * "plain" (default): drawn the reference's way, flush with the face: small dark eyes under a lid stroke, thin brows,
   * a thin mouth, no nose bump. "anime": a calm, half-lidded anime face like the reference's own character's: almond
   * eyes under a heavy lid line flicked out at the corner, a dark iris, a lid crease, thin brows, a small pointed
   * chin. "cute": larger round eyes with a highlight and a little blush.
   */
  face?: "plain" | "cute" | "anime";
  /** The lower, lit part of an anime iris. */
  iris?: string;
  /** A fringe across the forehead. */
  fringe?: boolean;
  /** A hair clip's colour, or none. */
  clip?: string;
  /** A ribbon bow tied at the back of the head, or none. */
  ribbon?: string;
  /** A small ribbon bow at the neckline, or none. */
  bow?: string;
  /** Arm and lower-leg thickness (1 = the default). */
  limbs?: number;
  /** Hand size (1 = the default); by default hands follow `limbs` halfway. */
  hands?: number;
  /**
   * "culottes": wide cropped trousers ending at the knee, over knee socks. "skirt": a flared, pleated skirt to
   * mid-thigh (its colour is `trousers`), bare knees and knee socks. Default: full-length trousers.
   */
  legs?: "trousers" | "culottes" | "skirt";
  /** Shoe width and height (1 = the default chunky shoe); the length stays, so the stride is unchanged. */
  feet?: number;
  /** A top hanging to the hips, as an oversized jumper does (default: a short jacket ending at the waist). */
  longTop?: boolean;
  /**
   * A shorter, stubbier figure: the legs (ankle to hip) and trunk (hip to chin) are drawn this much shorter, while
   * the head, hands, shoes and satchel keep their size. The arms shorten with the trunk. Default: full length.
   */
  stature?: Readonly<{ legs: number; trunk: number }>;
}>;

/**
 * The courier: a young London courier girl, drawn as a slim, easy-going kawaii anime girl in the reference's spirit
 * (short, about 1.5 m and 4.2 heads against a 2.8 m storey, with a big head) but her own design. Long chestnut hair
 * with blunt bangs, locks framing her face and a red ribbon bow at the back; a calm, half-lidded anime face; a cream jumper
 * with a red bow at the neck; a pleated navy skirt, cream knee socks and brown loafers; a leather satchel. Her
 * height is COURIER_HEIGHT (size.ts), which the camera and pace are scaled by.
 */
export const COURIER_LOOK: FigureLook = {
  head: 1.22, face: "anime", iris: "#5e3a2e", build: 0.84, limbs: 0.8, hands: 0.74, feet: 0.86, stature: { legs: 0.74, trunk: 0.9 },
  skin: "#f2cdb5", hair: "#4a2f2a", hairStyle: "long", fringe: true, ribbon: "#c4473a", bow: "#c4473a",
  jacket: "#ece4d0", trim: "#b65846", legs: "skirt", trousers: "#2e4859", socks: "#eee8dc", shoes: "#4a2e26",
  bag: { body: "#8c5737", flap: "#9b6340", strap: "#5a3a2a" },
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
/** The chin's height and the head's height from chin to crown, at the default head size. */
const CHIN = 3.16;
const HEAD_SPAN = 0.625;
/** How far a head of `size` (FigureLook.head) sits lower than the default, so its crown stays where it was. */
const headDrop = (size: number) => (size - 1) * HEAD_SPAN;

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
  /** The figure's height against the base figure's (BASE.height): what the gait's speed thresholds scale with. */
  pace: number;
  /** This figure's own leg (shorter for a stubby stature), in figure units before `scale`. */
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
/** `pleat`: how deep the ring's pleats fold in (0 none), for a pleated skirt (LoftOptions.pleats). */
type Ring = Readonly<{ at: THREE.Vector3; rx: number; rz: number; skin: Skin; pleat?: number }>;
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
  /** Pleats round each ring (folded in by Ring.pleat). */
  pleats?: number;
  /** Per-vertex skin, overriding the ring's: a skirt follows each thigh on its own side. */
  skinAt?: (ring: Ring, point: THREE.Vector3) => Skin;
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
        const fold = options.pleats && ring.pleat ? 1 - ring.pleat * Math.abs(Math.sin(theta * options.pleats * 0.5)) : 1;
        const p = ring.at.clone().addScaledVector(side, c * ring.rx * fold).addScaledVector(front, along * fold);
        this.vertex(p, options.skinAt ? options.skinAt(ring, p) : ring.skin, color, garment);
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
  const limb = look.limbs ?? 1;
  if (look.legs === "skirt") {
    // Slim bare legs under the skirt (the skirt itself is part of the body), then knee socks with a turned top.
    builder.loft([
      { at: v(x, 1.98, 0.01), rx: 0.16 * w, rz: 0.17, skin: [BONE.hips, thigh, 0.4] },
      { at: v(x, 1.72, 0.01), rx: 0.155 * limb, rz: 0.162 * limb, skin: [BONE.hips, thigh, 0.9] },
      { at: v(x, 1.42, 0.01), rx: 0.142 * limb, rz: 0.15 * limb, skin: [thigh] },
      { at: v(x, 1.14, 0.01), rx: 0.122 * limb, rz: 0.13 * limb, skin: [thigh] },
      { at: v(x, 0.97, 0.012), rx: 0.112 * limb, rz: 0.12 * limb, skin: [thigh, shin, 0.6] },
      { at: v(x, 0.86, 0.012), rx: 0.108 * limb, rz: 0.116 * limb, skin: [shin] },
    ], { segments: 12, garment: "skin", color: look.skin, capStart: true });
    builder.loft([
      { at: v(x, 0.91, 0.012), rx: 0.124 * limb, rz: 0.132 * limb, skin: [thigh, shin, 0.85] },
      { at: v(x, 0.85, 0.012), rx: 0.122 * limb, rz: 0.13 * limb, skin: [shin] },
      { at: v(x, 0.7, 0.014), rx: 0.122 * limb, rz: 0.128 * limb, skin: [shin] },
      { at: v(x, 0.52, 0.018), rx: 0.1 * limb, rz: 0.106 * limb, skin: [shin] },
      { at: v(x, 0.3, 0.025), rx: 0.08, rz: 0.084, skin: [shin, foot, 0.2] },
      { at: v(x, 0.19, 0.03), rx: 0.08, rz: 0.084, skin: [shin, foot, 0.7] },
    ], { segments: 12, garment: "socks", color: look.socks });
  } else if (look.legs === "culottes") {
    // Wide cropped trousers, flaring a little to a hem just below the knee, turned in so the open end never shows.
    const culotteRings: [number, number, number, Skin][] = [
      [2.04, 0.2 * w, 0.215, [BONE.hips, thigh, 0.25]],
      [1.86, 0.21 * w, 0.222, [BONE.hips, thigh, 0.6]],
      [1.68, 0.215 * w, 0.226, [BONE.hips, thigh, 0.92]],
      [1.42, 0.222, 0.232, [thigh]],
      [1.18, 0.232, 0.24, [thigh]],
      [1.0, 0.244, 0.25, [thigh, shin, 0.3]],
      [0.95, 0.24, 0.246, [thigh, shin, 0.45]],
    ];
    builder.loft(culotteRings.map(([y, rx, rz, skin]) => ({ at: v(x, y, 0.01), rx, rz, skin })), { segments: 14, garment: "trousers", color: look.trousers });
    builder.loft([
      { at: v(x, 0.95, 0.01), rx: 0.24, rz: 0.246, skin: [thigh, shin, 0.45] },
      { at: v(x, 0.975, 0.01), rx: 0.16 * limb, rz: 0.166 * limb, skin: [thigh, shin, 0.4] },
    ], { segments: 14, garment: "trousers", color: look.trousers });
    // The knee, showing a little between the hem and the socks.
    builder.loft([
      { at: v(x, 1.1, 0.01), rx: 0.15 * limb, rz: 0.156 * limb, skin: [thigh] },
      { at: v(x, 0.97, 0.01), rx: 0.138 * limb, rz: 0.144 * limb, skin: [thigh, shin, 0.6] },
      { at: v(x, 0.87, 0.012), rx: 0.13 * limb, rz: 0.136 * limb, skin: [shin] },
    ], { segments: 12, garment: "skin", color: look.skin });
    // Knee socks, with a turned top, down the calf to the ankle.
    builder.loft([
      { at: v(x, 0.9, 0.012), rx: 0.142 * limb, rz: 0.148 * limb, skin: [shin] },
      { at: v(x, 0.85, 0.012), rx: 0.14 * limb, rz: 0.146 * limb, skin: [shin] },
      { at: v(x, 0.7, 0.014), rx: 0.136 * limb, rz: 0.142 * limb, skin: [shin] },
      { at: v(x, 0.52, 0.018), rx: 0.112 * limb, rz: 0.118 * limb, skin: [shin] },
      { at: v(x, 0.3, 0.025), rx: 0.092, rz: 0.094, skin: [shin, foot, 0.2] },
      { at: v(x, 0.19, 0.03), rx: 0.09, rz: 0.094, skin: [shin, foot, 0.7] },
    ], { segments: 12, garment: "socks", color: look.socks });
  } else {
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
  }
  // The shoe, lofted heel to toe along −Z, its sole on the ground at rest.
  const ankleZ = 0.04;
  const shoe: [z: number, halfWidth: number, halfHeight: number, centreY: number][] = [
    [0.18, 0.06, 0.06, 0.08], [0.15, 0.1, 0.095, 0.095], [0.06, 0.115, 0.115, 0.115], [-0.06, 0.12, 0.1, 0.1],
    [-0.2, 0.125, 0.085, 0.085], [-0.33, 0.118, 0.072, 0.072], [-0.42, 0.092, 0.058, 0.06], [-0.47, 0.04, 0.03, 0.05],
  ];
  const k = look.feet ?? 1;
  builder.loft(shoe.map(([z, hw, hh, cy]) => ({ at: v(x, cy * k, ankleZ + z), rx: hw * k, rz: hh * k, skin: [foot] as Skin })), {
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
  const limb = look.limbs ?? 1;
  const handSize = look.hands ?? 0.5 + 0.5 * limb;
  // The sleeve starts just inside the jacket's sloping shoulder, so no peak shows above the arm.
  const up = mix(shoulder, elbow, -0.04).add(v(-side * 0.03, 0, 0));
  builder.loft([
    { at: up, rx: 0.125 * limb, rz: 0.15 * limb, skin: [BONE.chest, clavicle, 0.6] },
    { at: shoulder, rx: 0.152 * limb, rz: 0.165 * limb, skin: [clavicle, upper, 0.65] },
    { at: mix(shoulder, elbow, 0.22), rx: 0.152 * limb, rz: 0.158 * limb, skin: [upper] },
    { at: mix(shoulder, elbow, 0.55), rx: 0.138 * limb, rz: 0.142 * limb, skin: [upper] },
    { at: mix(shoulder, elbow, 0.86), rx: 0.126 * limb, rz: 0.13 * limb, skin: [upper, fore, 0.3] },
    { at: elbow, rx: 0.122 * limb, rz: 0.126 * limb, skin: [upper, fore, 0.55] },
    { at: mix(elbow, wrist, 0.14), rx: 0.124 * limb, rz: 0.128 * limb, skin: [upper, fore, 0.85] },
    { at: mix(elbow, wrist, 0.5), rx: 0.122 * limb, rz: 0.124 * limb, skin: [fore] },
    { at: mix(elbow, wrist, 0.8), rx: 0.11 * limb, rz: 0.112 * limb, skin: [fore] },
  ], { segments: 12, garment: "jacket", color: look.jacket });
  builder.loft([
    { at: mix(elbow, wrist, 0.78), rx: 0.118 * limb, rz: 0.12 * limb, skin: [fore] },
    { at: mix(elbow, wrist, 0.9), rx: 0.12 * limb, rz: 0.122 * limb, skin: [fore] },
    { at: mix(elbow, wrist, 0.97), rx: 0.112 * limb, rz: 0.114 * limb, skin: [fore] },
  ], { segments: 12, garment: "trim", color: look.trim, capEnd: true });
  // A relaxed hand: wrist, palm and loosely closed fingers in one mitten, with a thumb toward the front.
  const down = wrist.clone().sub(elbow).normalize();
  const along = (d: number) => wrist.clone().addScaledVector(down, d);
  builder.loft([
    { at: along(-0.06), rx: 0.07 * handSize, rz: 0.066 * handSize, skin: [fore, hand, 0.5] },
    { at: along(0.03), rx: 0.074 * handSize, rz: 0.06 * handSize, skin: [hand] },
    { at: along(0.13), rx: 0.092 * handSize, rz: 0.058 * handSize, skin: [hand] },
    { at: along(0.22), rx: 0.094 * handSize, rz: 0.054 * handSize, skin: [hand] },
    { at: along(0.3), rx: 0.08 * handSize, rz: 0.05 * handSize, skin: [hand] },
    { at: along(0.355), rx: 0.04 * handSize, rz: 0.03 * handSize, skin: [hand] },
  ], { segments: 10, garment: "skin", color: look.skin, capEnd: true, facing: v(-side, 0, 0) });
  builder.blob(along(0.12).add(v(-side * 0.04, 0, -0.065)), v(0.032 * handSize, 0.075 * handSize, 0.032 * handSize), [hand], "skin", look.skin, [8, 6]);
}

/** The side a strap path faces (its middle point's z sign), so its flat side lies on the jacket. */
function strapFacing(path: readonly [number, number, number, Skin][]): number {
  return Math.sign(path[Math.floor(path.length / 2)]![2]) || -1;
}

/** The torso (jacket over a waistband), neck, head, face and hair; the cap and the satchel when the look has them. */
function addBody(builder: FigureBuilder, look: FigureLook, w: number): void {
  const { hips, spine, chest, neck, head, eyes, bag } = BONE;
  // A bigger head sits lower on a shorter neck, so the crown stays put (FigureLook.head): every point of the head is
  // scaled about the chin and lowered by the head's extra height. At the default size this changes nothing.
  const s = look.head ?? 1;
  const drop = headDrop(s);
  const hp = (x: number, y: number, z: number) => v(x * s, CHIN + (y - CHIN) * s - drop, z * s);
  const sized = (x: number, y: number, z: number) => v(x, y, z).multiplyScalar(s);
  if (look.legs === "skirt") {
    // A flared, pleated skirt from the waist (inside the top's hem) to mid-thigh. Each side follows its own thigh,
    // more toward the hem, so a striding leg carries the skirt with it instead of pushing through.
    const top = 2.1, hem = 1.22;
    const skirt: Ring[] = [
      { at: v(0, top, 0.0), rx: 0.32 * w, rz: 0.23, skin: [hips] },
      { at: v(0, 1.95, 0.01), rx: 0.335 * w, rz: 0.245, skin: [hips], pleat: 0.03 },
      { at: v(0, 1.8, 0.015), rx: 0.37, rz: 0.29, skin: [hips], pleat: 0.06 },
      { at: v(0, 1.6, 0.02), rx: 0.42, rz: 0.34, skin: [hips], pleat: 0.08 },
      { at: v(0, 1.4, 0.02), rx: 0.46, rz: 0.375, skin: [hips], pleat: 0.09 },
      { at: v(0, hem, 0.02), rx: 0.49, rz: 0.4, skin: [hips], pleat: 0.09 },
      { at: v(0, hem + 0.03, 0.02), rx: 0.45, rz: 0.365, skin: [hips], pleat: 0.09 },
    ];
    const thighs = [BONE.thighL, BONE.thighR] as const;
    builder.loft(skirt, {
      segments: 32, garment: "trousers", color: look.trousers, capStart: true, pleats: 16,
      skinAt: (ring, p) => {
        const down = Math.min(1, Math.max(0, (top - ring.at.y) / (top - hem)));
        const across = Math.min(1, Math.abs(p.x) / 0.16);
        return [hips, thighs[p.x < 0 ? 0 : 1], 0.6 * down * down * across];
      },
    });
  } else {
    // Seat and waist of the trousers, inside the jacket's hem.
    builder.loft([
      { at: v(0, 1.64, 0.02), rx: 0.3 * w, rz: 0.2, skin: [hips] },
      { at: v(0, 1.78, 0.02), rx: 0.36 * w, rz: 0.235, skin: [hips] },
      { at: v(0, 1.94, 0.01), rx: 0.37 * w, rz: 0.24, skin: [hips] },
      { at: v(0, 2.06, 0.0), rx: 0.355 * w, rz: 0.232, skin: [hips, spine, 0.3] },
    ], { segments: 18, garment: "trousers", color: look.trousers, capStart: true });
  }
  // The top: a short work jacket ending at the waist, or an oversized jumper hanging to the hips. Fuller over the
  // chest, with sloped shoulders; its neckline sits lower under a bigger head.
  const hem: Ring[] = look.longTop
    ? [{ at: v(0, 1.72, 0.02), rx: 0.43 * w, rz: 0.305, skin: [hips] }, { at: v(0, 1.9, 0.02), rx: 0.415 * w, rz: 0.295, skin: [hips] }]
    : [{ at: v(0, 1.9, 0.02), rx: 0.405 * w, rz: 0.29, skin: [hips] }];
  builder.loft([
    ...hem,
    { at: v(0, 2.06, 0.015), rx: 0.395 * w, rz: 0.278, skin: [hips, spine, 0.45] },
    { at: v(0, 2.26, 0.01), rx: 0.38 * w, rz: 0.265, skin: [spine] },
    { at: v(0, 2.5, 0.0), rx: 0.41 * w, rz: 0.278, skin: [spine, chest, 0.55] },
    { at: v(0, 2.72, 0.0), rx: 0.44 * w, rz: 0.288, skin: [chest] },
    { at: v(0, 2.88, 0.01), rx: 0.46 * w, rz: 0.27, skin: [chest] },
    { at: v(0, 2.97 - drop * 0.4, 0.02), rx: 0.41 * w, rz: 0.235, skin: [chest] },
    { at: v(0, 3.05 - drop * 0.6, 0.025), rx: 0.235, rz: 0.19, skin: [chest, neck, 0.3] },
  ], { segments: 20, garment: "jacket", color: look.jacket, capStart: true, capEnd: true });
  // The hem band and a stand-up collar in the trim colour.
  const hemY = look.longTop ? 1.79 : 1.95;
  const hemRx = (look.longTop ? 0.438 : 0.412) * w, hemRz = look.longTop ? 0.312 : 0.296;
  builder.loft([
    { at: v(0, hemY, 0.02), rx: hemRx, rz: hemRz, skin: [hips] },
    { at: v(0, hemY - 0.08, 0.02), rx: hemRx + 0.002, rz: hemRz + 0.002, skin: [hips] },
  ], { segments: 20, garment: "trim", color: look.trim, capEnd: true });
  builder.loft([
    { at: v(0, 3.0 - drop * 1.1, 0.03), rx: 0.215, rz: 0.2, skin: [chest] },
    { at: v(0, 3.1 - drop * 1.1, 0.035), rx: 0.2, rz: 0.19, skin: [chest, neck, 0.5] },
    { at: v(0, 3.15 - drop * 1.1, 0.04), rx: 0.19, rz: 0.18, skin: [neck] },
  ], { segments: 16, garment: "trim", color: look.longTop || look.bow ? look.jacket : look.trim });
  if (look.bow) {
    // A small ribbon bow at the front of the neckline: two loops, a knot and two short tails.
    const at = v(0, 2.9 - drop * 0.6, -0.2);
    for (const side of [-1, 1]) {
      builder.blob(at.clone().add(v(side * 0.055, 0.005, -0.012)), v(0.055, 0.032, 0.02), [chest], "cap", look.bow, [8, 5]);
      builder.blob(at.clone().add(v(side * 0.03, -0.06, -0.01)), v(0.018, 0.05, 0.012), [chest], "cap", look.bow, [6, 4]);
    }
    builder.blob(at.clone().add(v(0, 0, -0.022)), v(0.022, 0.026, 0.018), [chest], "cap", look.bow, [6, 4]);
  }
  // Neck, shorter under a bigger head.
  const neckY = (y: number) => 3.0 + (y - 3.0) * Math.max(0.3, (0.26 - drop) / 0.26);
  builder.loft([
    { at: v(0, neckY(3.0), 0.03), rx: 0.105, rz: 0.11, skin: [chest, neck, 0.5] },
    { at: v(0, neckY(3.14), 0.025), rx: 0.098, rz: 0.104, skin: [neck] },
    { at: v(0, neckY(3.26), 0.02), rx: 0.1, rz: 0.106, skin: [neck, head, 0.7] },
  ], { segments: 12, garment: "skin", color: look.skin });
  // Head: chin to crown, with a flatter face.
  // An anime face narrows to a small pointed chin.
  const jaw: [y: number, rx: number, rz: number, z: number][] = look.face === "anime"
    ? [[3.16, 0.045, 0.045, -0.15], [3.2, 0.1, 0.11, -0.1], [3.27, 0.165, 0.19, -0.05], [3.36, 0.212, 0.234, -0.015]]
    : [[3.16, 0.07, 0.06, -0.135], [3.2, 0.13, 0.13, -0.085], [3.27, 0.185, 0.2, -0.04], [3.36, 0.218, 0.236, -0.012]];
  const headRings: [y: number, rx: number, rz: number, z: number][] = [
    ...jaw,
    [3.47, 0.232, 0.25, 0.0], [3.58, 0.232, 0.252, 0.008], [3.67, 0.205, 0.228, 0.012], [3.74, 0.14, 0.16, 0.014], [3.785, 0.03, 0.035, 0.014],
  ];
  builder.loft(headRings.map(([y, rx, rz, z]) => ({ at: hp(0, y, z), rx: rx * s, rz: rz * s, skin: [head] as Skin })), {
    segments: 20, garment: "skin", color: look.skin, capStart: true, capEnd: true, flatFront: 0.22,
  });
  // Ears, except under a cute bob, which covers them.
  if (look.face !== "cute" && look.face !== "anime") for (const side of [-1, 1]) builder.blob(hp(side * 0.232, 3.44, 0.02), sized(0.035, 0.07, 0.05), [head], "skin", look.skin, [8, 6]);
  // Faces are drawn the reference's way: features painted almost flush with the face, read as strokes rather than
  // bumps. A dark upper-lid stroke over a small iris, thin brows, a thin mouth; no nose bump and no blush.
  const flush = (x: number, y: number, z: number, w: number, h: number, bone: number, garment: "skin" | "eyes" | "hair", colour: string, depth = 0.005) =>
    builder.blob(hp(x, y, z), sized(w, h, depth), [bone], garment, colour, [10, 5]);
  if (look.face === "anime") {
    // A calm anime face, half-lidded as the reference's own character looks: almond eyes under a heavy lid line that
    // flicks out at the outer corner, a dark iris tucked under it lit warm at its foot, a sliver of white each side,
    // one small highlight, a faint lid crease above. All on the eyes bone, so a blink closes the whole eye.
    for (const side of [-1, 1]) {
      const x = side * 0.1;
      flush(x, 3.42, -0.201, 0.05, 0.022, eyes, "eyes", "#f6f1e8");
      flush(x, 3.418, -0.203, 0.024, 0.028, eyes, "eyes", "#2a1c22");
      flush(x, 3.406, -0.205, 0.016, 0.011, eyes, "eyes", look.iris ?? "#9b5a3a", 0.004);
      flush(x + 0.008, 3.43, -0.207, 0.006, 0.006, eyes, "eyes", "#fbf7f0", 0.003);
      flush(side * 0.064, 3.436, -0.205, 0.018, 0.007, eyes, "eyes", "#1f1518");
      flush(side * 0.1, 3.446, -0.206, 0.04, 0.0095, eyes, "eyes", "#1f1518");
      flush(side * 0.142, 3.443, -0.201, 0.022, 0.009, eyes, "eyes", "#1f1518");
      flush(side * 0.162, 3.432, -0.195, 0.012, 0.006, eyes, "eyes", "#1f1518");
      flush(side * 0.102, 3.468, -0.204, 0.04, 0.0035, eyes, "eyes", "#a0705e", 0.003);
      flush(side * 0.105, 3.506, -0.203, 0.042, 0.0055, head, "hair", look.hair, 0.004);
    }
    flush(0, 3.29, -0.199, 0.019, 0.0035, head, "skin", "#b8766c", 0.003);
  } else if (look.face === "cute") {
    // Larger eyes set a little lower and wider, each with a highlight; a small mouth and a touch of blush, almost
    // flush with the face so they read as colour rather than bumps. No nose; the fringe covers the brows.
    builder.blob(hp(0, 3.3, -0.197), sized(0.024, 0.007, 0.004), [head], "skin", "#b4605a", [8, 4]);
    for (const side of [-1, 1]) {
      builder.blob(hp(side * 0.148, 3.355, -0.186), sized(0.046, 0.022, 0.004), [head], "skin", "#eca596", [8, 4]);
      builder.blob(hp(side * 0.096, 3.44, -0.203), sized(0.04, 0.056, 0.02), [eyes], "eyes", "#2b1f22", [10, 8]);
      builder.blob(hp(side * 0.083, 3.462, -0.219), sized(0.012, 0.014, 0.008), [eyes], "eyes", "#fbf6ee", [6, 4]);
    }
  } else {
    // An everyday face: small dark eyes under a lid stroke, a sliver of white, thin brows in the hair's colour and a
    // thin mouth. The ears stay; there is no nose bump.
    for (const side of [-1, 1]) {
      const x = side * 0.088;
      flush(x, 3.456, -0.202, 0.034, 0.013, eyes, "eyes", "#efe9df", 0.004);
      flush(x, 3.454, -0.204, 0.015, 0.018, eyes, "eyes", "#231a1a", 0.004);
      flush(x, 3.47, -0.206, 0.038, 0.007, eyes, "eyes", "#231a1a");
      flush(side * 0.12, 3.466, -0.201, 0.012, 0.005, eyes, "eyes", "#231a1a", 0.004);
      flush(side * 0.092, 3.53, -0.203, 0.044, 0.006, head, "hair", look.hair);
    }
    flush(0, 3.31, -0.2, 0.024, 0.004, head, "skin", "#9c6a5a", 0.003);
  }
  // Hair: a shell over the back and sides of the skull, with the hairline above the brow.
  const hairRings: [y: number, rx: number, rz: number, z: number][] = look.hairStyle === "bob" || look.hairStyle === "long"
    ? [[3.24, 0.25, 0.26, 0.05], [3.36, 0.262, 0.272, 0.03], [3.5, 0.255, 0.27, 0.015], [3.62, 0.245, 0.262, 0.012], [3.71, 0.2, 0.22, 0.015], [3.775, 0.1, 0.12, 0.016], [3.8, 0.02, 0.02, 0.016]]
    : [[3.3, 0.21, 0.22, 0.06], [3.42, 0.245, 0.262, 0.03], [3.54, 0.248, 0.268, 0.015], [3.64, 0.226, 0.246, 0.014], [3.72, 0.17, 0.19, 0.016], [3.775, 0.08, 0.1, 0.016], [3.795, 0.02, 0.02, 0.016]];
  const hairAt = ([y, rx, rz, z]: [number, number, number, number]) => ({ at: hp(0, y, z), rx: rx * s, rz: rz * s, skin: [head] as Skin });
  if (look.fringe) {
    // A blunt fringe: the bob covers the sides and back up to the brow line, and a closed cap over the crown comes
    // down across the forehead to just above the eyes.
    builder.loft(hairRings.filter(([y]) => y < 3.52).concat([[3.52, 0.255, 0.27, 0.015]]).map(hairAt), { segments: 20, garment: "hair", color: look.hair, flatFront: 0.5 });
    const fringe: [number, number, number, number][] = [
      [3.52, 0.255, 0.27, 0.015], [3.58, 0.25, 0.266, 0.012], [3.66, 0.232, 0.25, 0.012], [3.73, 0.18, 0.2, 0.015], [3.78, 0.1, 0.12, 0.016], [3.805, 0.02, 0.02, 0.016],
    ];
    builder.loft(fringe.map(hairAt), { segments: 20, garment: "hair", color: look.hair, capEnd: true });
  } else {
    // Without a fringe: drawn back off the face at the sides, and a closed cap over the top down to a hairline above
    // the brow, so the crown never shows bare.
    const bobbed = look.hairStyle === "bob" || look.hairStyle === "long";
    const hairline: [number, number, number, number] = bobbed ? [3.6, 0.248, 0.264, 0.012] : [3.6, 0.24, 0.258, 0.014];
    builder.loft(hairRings.filter(([y]) => y < hairline[0]).concat([hairline]).map(hairAt), { segments: 20, garment: "hair", color: look.hair, flatFront: 0.5 });
    builder.loft([hairline as [number, number, number, number]].concat(hairRings.filter(([y]) => y > hairline[0])).map(hairAt), { segments: 20, garment: "hair", color: look.hair, capEnd: true });
  }
  if (look.hairStyle === "bun") builder.blob(hp(0, 3.66, 0.24), sized(0.11, 0.1, 0.1), [head], "hair", look.hair);
  if (look.hairStyle === "long") {
    // Long straight hair down the back to the shoulder blades, lying just off the top; its lower part follows the
    // chest, so it stays on her back as she leans into a run.
    const curtain: [y: number, rx: number, rz: number, z: number][] = [
      [3.45, 0.255, 0.2, 0.09], [3.3, 0.265, 0.17, 0.14], [3.15, 0.27, 0.12, 0.2], [2.95, 0.265, 0.06, 0.27],
      [2.75, 0.255, 0.045, 0.29], [2.6, 0.235, 0.04, 0.292], [2.5, 0.17, 0.03, 0.29], [2.46, 0.06, 0.02, 0.288],
    ];
    builder.loft(curtain.map(([y, rx, rz, z]) => {
      const follow = Math.min(0.75, Math.max(0, (3.15 - y) / 0.7) * 0.75);
      return { at: hp(0, y, z), rx: rx * s, rz: rz * s, skin: (follow > 0 ? [head, chest, follow] : [head]) as Skin };
    }), { segments: 20, garment: "hair", color: look.hair, capEnd: true });
    // Locks framing the face, in front of the ears, down to the jaw.
    for (const side of [-1, 1]) {
      const lock: [y: number, x: number, z: number, rx: number, rz: number][] = [
        [3.52, 0.228, -0.07, 0.045, 0.055], [3.38, 0.238, -0.085, 0.05, 0.045], [3.24, 0.242, -0.09, 0.045, 0.035],
        [3.14, 0.238, -0.085, 0.03, 0.025], [3.09, 0.232, -0.08, 0.012, 0.012],
      ];
      builder.loft(lock.map(([y, x, z, rx, rz]) => ({ at: hp(side * x, y, z), rx: rx * s, rz: rz * s, skin: [head] as Skin })), {
        segments: 10, garment: "hair", color: look.hair, capStart: true, capEnd: true, facing: v(0, 0, -1),
      });
    }
  }
  if (look.ribbon) {
    // A ribbon bow tied at the back of the head: two loops, a knot and two tails.
    for (const side of [-1, 1]) {
      builder.blob(hp(side * 0.11, 3.55, 0.29), sized(0.1, 0.058, 0.035), [head], "cap", look.ribbon, [10, 6]);
      builder.blob(hp(side * 0.05, 3.43, 0.3), sized(0.03, 0.08, 0.016), [head], "cap", look.ribbon, [6, 5]);
    }
    builder.blob(hp(0, 3.53, 0.305), sized(0.036, 0.04, 0.035), [head], "cap", look.ribbon, [8, 5]);
  }
  if (look.clip) builder.blob(hp(0.17, 3.64, -0.175), sized(0.055, 0.022, 0.03), [head], "cap", look.clip, [8, 5]);
  if (look.cap) {
    // A flat cap: a soft crown pulled forward, and a short stiff peak.
    builder.loft([
      { at: hp(0, 3.6, 0.0), rx: 0.255 * s, rz: 0.27 * s, skin: [head] },
      { at: hp(0, 3.7, -0.025), rx: 0.268 * s, rz: 0.292 * s, skin: [head] },
      { at: hp(0, 3.77, -0.04), rx: 0.24 * s, rz: 0.268 * s, skin: [head] },
      { at: hp(0, 3.82, -0.045), rx: 0.14 * s, rz: 0.16 * s, skin: [head] },
      { at: hp(0, 3.835, -0.045), rx: 0.03 * s, rz: 0.03 * s, skin: [head] },
    ], { segments: 20, garment: "cap", color: look.cap, capStart: true, capEnd: true });
    builder.loft([
      { at: hp(0, 3.625, -0.2), rx: 0.2 * s, rz: 0.035 * s, skin: [head] },
      { at: hp(0, 3.6, -0.3), rx: 0.19 * s, rz: 0.03 * s, skin: [head] },
      { at: hp(0, 3.585, -0.345), rx: 0.14 * s, rz: 0.022 * s, skin: [head] },
    ], { segments: 12, garment: "cap", color: look.cap, capStart: true, capEnd: true, boxy: 0.6, facing: v(0, 1, 0) });
  }
  if (look.bag) {
    // A satchel at the left hip, slightly behind, on a strap from the right shoulder across the chest and back.
    // Over a skirt it rides a little higher and further out, clear of the flare.
    const centre = look.legs === "skirt" ? v(-0.47 * w, 2.14, 0.12) : v(-0.43 * w, 1.98, 0.12);
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
function bonePositions(w: number, look: FigureLook): Record<BoneName, THREE.Vector3> {
  const sx = (x: number) => x * w;
  const size = look.head ?? 1;
  const drop = headDrop(size);
  const eyeY = look.face === "anime" ? 3.42 : look.face === "cute" ? 3.44 : 3.46;
  return {
    hips: v(0, BASE.hips, 0.02), spine: v(0, BASE.spine, 0.01), chest: v(0, BASE.chest, 0), neck: v(0, BASE.neck, 0.025), head: v(0, BASE.head - drop, 0.02),
    eyes: v(0, CHIN + (eyeY - CHIN) * size - drop, -0.2 * size), bag: v(-0.43 * w, 2.15, 0.1),
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

/**
 * FigureLook.stature as heights: the plain map shortens the legs (ankle to hip) and trunk (hip to chin) and lifts
 * nothing below the ankle; above the chin everything moves down unchanged. Each bone chain that keeps its shape is
 * moved rigidly with its root: the head (and eyes), the shoes, the satchel; the arms hang from the shoulder and
 * shorten with the trunk. A vertex blends its bones' maps by its skin weights, so the seams stay closed.
 */
function statureMaps(look: FigureLook, rest: Record<BoneName, THREE.Vector3>): { plain: (y: number) => number; bone: (bone: number, y: number) => number } {
  const stature = look.stature;
  if (!stature) return { plain: (y) => y, bone: (_bone, y) => y };
  const ankle = BASE.ankle, hip = BASE.hipJoint.y, chin = CHIN - headDrop(look.head ?? 1);
  const atHip = ankle + (hip - ankle) * stature.legs;
  const atChin = atHip + (chin - hip) * stature.trunk;
  const plain = (y: number) =>
    y <= ankle ? y : y <= hip ? ankle + (y - ankle) * stature.legs : y <= chin ? atHip + (y - hip) * stature.trunk : atChin + (y - chin);
  const rigid = (anchor: number, factor: number) => (y: number) => plain(anchor) + (y - anchor) * factor;
  const head = rigid(rest.head.y, 1), feet = rigid(ankle, 1), bag = rigid(rest.bag.y, 1);
  const armL = rigid(rest.upperArmL.y, stature.trunk), armR = rigid(rest.upperArmR.y, stature.trunk);
  const chains: Partial<Record<BoneName, (y: number) => number>> = {
    head, eyes: head, footL: feet, footR: feet, bag,
    upperArmL: armL, foreArmL: armL, handL: armL, upperArmR: armR, foreArmR: armR, handR: armR,
  };
  const byBone = BONE_NAMES.map((name) => chains[name] ?? plain);
  return { plain, bone: (bone, y) => byBone[bone]!(y) };
}

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

  const rest = bonePositions(w, look);
  const stature = statureMaps(look, rest);
  let leg = BASE_LEG;
  if (look.stature) {
    const { positions, skinIndex, skinWeight } = builder;
    for (let i = 0; i < positions.length / 3; i += 1) {
      const y = positions[i * 3 + 1]!;
      let moved = 0;
      for (let k = 0; k < 4; k += 1) {
        const weight = skinWeight[i * 4 + k]!;
        if (weight > 0) moved += weight * stature.bone(skinIndex[i * 4 + k]!, y);
      }
      positions[i * 3 + 1] = moved;
    }
    for (const name of BONE_NAMES) rest[name].y = stature.bone(BONE[name], rest[name].y);
    const hip = stature.plain(BASE.hipJoint.y), knee = stature.plain(BASE.knee);
    leg = { hip, thigh: hip - knee, shin: knee - BASE.ankle, ankle: BASE.ankle, sole: BASE_LEG.sole };
  }
  const geometry = builder.build();
  const height = stature.plain(BASE.height) * scale;

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
    height,
    pace: height / BASE.height,
    hipsRest: root.position.clone(),
    leg,
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
