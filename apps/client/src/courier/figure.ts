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
  hairStyle?: "short" | "bob" | "bun" | "long" | "layered";
  /** Layered side/cheek/nape length: 1 short, 1.5–1.8 softly shaggy at the neck/shoulders. Crown stays fixed. */
  hairLength?: number;
  jacket: string;
  /** Authored streetwear silhouettes; defaults to the original short jacket. */
  garment?: "jacket" | "hoodie" | "cardigan";
  /** Cloth fullness independent of the person's build. */
  fit?: number;
  trouserFit?: number;
  /** Under the open cardigan. */
  shirt?: string;
  collar?: "spread" | "stand";
  pockets?: boolean;
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
  expression?: "gentle" | "bright" | "calm";
  age?: "young" | "adult" | "older";
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
 * Soft inked anime streetwear from the supplied illustration: shaggy dark hair, a roomy sage hoodie, loose denim
 * and pale canvas sneakers. The existing rig/stature keeps the approved movement and framing.
 */
export const COURIER_LOOK: FigureLook = {
  head: 1.08, face: "anime", iris: "#624b3c", expression: "bright", age: "young",
  build: 0.88, limbs: 0.8, hands: 0.82, feet: 0.9, stature: { legs: 0.74, trunk: 0.90682 },
  skin: "#fff1e9", hair: "#191a1b", hairStyle: "layered", hairLength: 1.2, fringe: true,
  garment: "hoodie", fit: 1.1, pockets: false, trouserFit: 1.11, longTop: true,
  jacket: "#9fd790", trim: "#96cb87", shirt: "#e5e7df", legs: "trousers", trousers: "#7287ab", socks: "#f7f4ed", shoes: "#f5f0df",
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
  /** Expression helper restores these offsets each frame, so gaze never accumulates drift. */
  eyesRest: THREE.Vector3;
  expression: NonNullable<FigureLook["expression"]>;
};

/** Where outlined garments start in surface-id space (each garment adds a step; scenery stays well below). */
const FIGURE_SURFACE_ID = 0.902;
const ID_STEP = 0.0062;
const GARMENT = { skin: 0, hair: 1, jacket: 2, trim: 3, trousers: 4, turnup: 5, socks: 6, shoes: 7, bag: 8, strap: 9, eyes: 10, cap: 11 } as const;

/** One shared material for every drawn person (colours and garments ride on the vertices). */
export function createFigureMaterial(): THREE.ShaderMaterial {
  const material = createIllustratedMaterial({
    color: "#ffffff", lighting: "world", vertexColors: true, character: true, softCharacter: true, surfaceId: FIGURE_SURFACE_ID, outline: 0.68, grain: 0,
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
  /** Authored silhouette edits after the ring frame is built (the layered fringe's continuous, swept edge). */
  deform?: (point: THREE.Vector3, ring: number, angle: number) => THREE.Vector3;
  /** Broad, restrained variations in the cloth's pigment. */
  wash?: number;
  /** A genuine opening between cloth layers, such as the front of a cardigan. */
  openAt?: (point: THREE.Vector3) => boolean;
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

  /** Painted facial regions follow the cheek surface instead of floating flat in front of it. */
  patch(points: readonly THREE.Vector2[], project: (point: THREE.Vector2) => THREE.Vector3, skin: Skin | ((point: THREE.Vector3) => Skin), garment: keyof typeof GARMENT, colour: string, steps = 1, edgeSteps = 1): void {
    const color = new THREE.Color(colour);
    const outline = points.flatMap((point, i) => Array.from({ length: edgeSteps }, (_, step) => point.clone().lerp(points[(i + 1) % points.length]!, step / edgeSteps)));
    const centre2 = outline.reduce((sum, point) => sum.add(point), new THREE.Vector2()).multiplyScalar(1 / outline.length);
    const centre3 = project(centre2);
    const put = (point: THREE.Vector3) => this.vertex(point, typeof skin === "function" ? skin(point) : skin, color, GARMENT[garment]);
    const centre = put(centre3);
    const inside = centre3.clone().add(v(0, 0, 0.02));
    let previous = -1;
    for (let ring = 1; ring <= steps; ring += 1) {
      const start = this.positions.length / 3;
      outline.forEach((point) => put(project(centre2.clone().lerp(point, ring / steps))));
      outline.forEach((_, i) => {
        const j = (i + 1) % outline.length;
        if (previous < 0) this.face(centre, start + i, start + j, inside);
        else { this.face(previous + i, start + i, start + j, inside); this.face(previous + i, start + j, previous + j, inside); }
      });
      previous = start;
    }
  }

  panel(points: readonly THREE.Vector3[], skin: Skin, garment: keyof typeof GARMENT, colour: string): void {
    const color = new THREE.Color(colour);
    const centre3 = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
    const centre = this.vertex(centre3, skin, color, GARMENT[garment]);
    const start = this.positions.length / 3;
    points.forEach((point) => this.vertex(point, skin, color, GARMENT[garment]));
    const inside = centre3.clone().add(v(0, 0, 0.04));
    points.forEach((_, i) => this.face(centre, start + i, start + (i + 1) % points.length, inside));
  }

  /** A thin curved cloth sheet with a connected front, underside and edge, rather than overlapping flat panels. */
  sheet(columns: number, rows: number, project: (u: number, v: number) => THREE.Vector3, skin: (u: number, v: number) => Skin, garment: keyof typeof GARMENT, colour: string): void {
    const color = new THREE.Color(colour), starts: number[] = [];
    for (const face of [-1, 1]) {
      starts.push(this.positions.length / 3);
      for (let row = 0; row <= rows; row += 1) for (let col = 0; col <= columns; col += 1) {
        const u = col / columns, t = row / rows;
        this.vertex(project(u, t).add(v(0, face * 0.0035, 0)), skin(u, t), color, GARMENT[garment]);
      }
    }
    const at = (layer: number, row: number, col: number) => starts[layer]! + row * (columns + 1) + col;
    const quad = (a: number, b: number, c: number, d: number, inside: THREE.Vector3) => {
      this.face(a, b, c, inside); this.face(a, c, d, inside);
    };
    for (let row = 0; row < rows; row += 1) for (let col = 0; col < columns; col += 1) {
      const centre = project((col + 0.5) / columns, (row + 0.5) / rows);
      quad(at(0, row, col), at(0, row + 1, col), at(0, row + 1, col + 1), at(0, row, col + 1), centre.clone().add(v(0, 0.02, 0)));
      quad(at(1, row, col), at(1, row + 1, col), at(1, row + 1, col + 1), at(1, row, col + 1), centre.clone().add(v(0, -0.02, 0)));
    }
    for (const row of [0, rows]) for (let col = 0; col < columns; col += 1) {
      quad(at(0, row, col), at(1, row, col), at(1, row, col + 1), at(0, row, col + 1), project((col + 0.5) / columns, row === 0 ? 0.03 : 0.97));
    }
    for (const col of [0, columns]) for (let row = 0; row < rows; row += 1) {
      quad(at(0, row, col), at(1, row, col), at(1, row + 1, col), at(0, row + 1, col), project(col === 0 ? 0.02 : 0.98, (row + 0.5) / rows));
    }
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
        let p = ring.at.clone().addScaledVector(side, c * ring.rx * fold).addScaledVector(front, along * fold);
        if (options.deform) p = options.deform(p, r, theta);
        const pigment = options.wash ? color.clone().multiplyScalar(1 - options.wash * (0.5 + 0.5 * Math.sin(theta * 3.2 + r * 1.7) * Math.cos(r * 0.73 - theta))) : color;
        this.vertex(p, options.skinAt ? options.skinAt(ring, p) : ring.skin, pigment, garment);
      }
    });
    for (let r = 0; r < rings.length - 1; r += 1) {
      const inside = centres[r]!.clone().add(centres[r + 1]!).multiplyScalar(0.5);
      for (let i = 0; i < n; i += 1) {
        const j = (i + 1) % n;
        const a = start + r * n + i, b = start + (r + 1) * n + i, c = start + (r + 1) * n + j, d = start + r * n + j;
        if (options.openAt) {
          const centre = [a, b, c, d].reduce((sum, index) => sum.add(v(this.positions[index * 3]!, this.positions[index * 3 + 1]!, this.positions[index * 3 + 2]!)), new THREE.Vector3()).multiplyScalar(0.25);
          if (options.openAt(centre)) continue;
        }
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
    const fit = look.trouserFit ?? 1;
    const loose = fit > 1.02;
    const legRings: [number, number, number, Skin][] = [
      [2.04, 0.2 * w, 0.205, [BONE.hips]],
      [1.86, 0.205 * w, 0.22, [BONE.hips, thigh, 0.25]],
      [1.68, 0.2 * w, 0.212, [BONE.hips, thigh, 0.8]],
      [1.42, (loose ? 0.166 : 0.186) * w, 0.198, [thigh]],
      [1.18, 0.147, 0.163, [thigh]],
      [1.03, 0.137, 0.151, [thigh, shin, 0.25]],
      [0.94, 0.135, 0.147, [thigh, shin, 0.75]],
      [0.82, 0.139, 0.151, [shin]],
      [0.68, 0.144, 0.156, [shin]],
      [0.54, 0.136, 0.143, [shin]],
      [0.44, 0.132, 0.139, [shin]],
    ];
    if (loose) legRings.push([0.34, 0.141, 0.148, [shin]], [0.27, 0.127, 0.135, [shin, foot, 0.1]], [0.21, 0.12, 0.128, [shin, foot, 0.3]]);
    builder.loft(legRings.map(([y, rx, rz, skin]) => ({ at: v(x + (loose ? side * 0.025 * Math.sin(Math.min(1, (1.8 - y) / 1.6) * Math.PI) : 0), y, 0.01), rx: rx * fit, rz: rz * fit, skin })), {
      segments: 24, garment: "trousers", color: look.trousers, wash: loose ? 0.16 : 0,
      deform: loose ? (point, ring, angle) => {
        const y = legRings[ring]![0];
        const fold = Math.sin(angle * 3 + side * 0.7 + y * 6) * (y < 0.6 ? 0.011 : 0.004);
        point.x += Math.cos(angle) * fold;
        point.z -= Math.sin(angle) * fold;
        return point;
      } : undefined,
    });
    if (look.turnup) {
      const lowerHem = fit > 1.1 ? 0.17 : 0;
      builder.loft([
        { at: v(x, 0.53 - lowerHem, 0.01), rx: 0.152 * fit, rz: 0.158 * fit, skin: [shin] },
        { at: v(x, 0.47 - lowerHem, 0.01), rx: 0.158 * fit, rz: 0.164 * fit, skin: [shin] },
        { at: v(x, 0.41 - lowerHem, 0.01), rx: 0.152 * fit, rz: 0.158 * fit, skin: [shin] },
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
    segments: 14, garment: "shoes", color: look.shoes, capStart: true, capEnd: true, boxy: 0.3, facing: v(0, 1, 0), wash: 0.05,
  });
  builder.loft(shoe.slice(1, -1).map(([z, hw]) => ({ at: v(x, 0.019 * k, ankleZ + z), rx: hw * k * 1.015, rz: 0.016 * k, skin: [foot] as Skin })), {
    segments: 12, garment: "shoes", color: new THREE.Color(look.shoes).multiplyScalar(0.73).getStyle(), capStart: true, capEnd: true, boxy: 0.4, facing: v(0, 1, 0),
  });
}

/** An arm in a sleeve with a cuff, and a hand. Side −1 is the left (−X). */
function addArm(builder: FigureBuilder, look: FigureLook, side: -1 | 1, w: number): void {
  const L = side < 0 ? "L" : "R";
  const clavicle = BONE[`clavicle${L}`], upper = BONE[`upperArm${L}`], fore = BONE[`foreArm${L}`], hand = BONE[`hand${L}`];
  const armDrop = headDrop(look.head ?? 1) * 0.55;
  const shoulder = v(side * BASE.shoulder.x * w, BASE.shoulder.y - armDrop, 0.02);
  const elbow = v(side * (BASE.elbow.x * w + 0.02), BASE.elbow.y - armDrop, 0.04);
  const wrist = v(side * (BASE.wrist.x * w + 0.03), BASE.wrist.y - armDrop, 0.0);
  const streetwear = look.garment === "hoodie" || look.garment === "cardigan";
  const limb = (look.limbs ?? 1) * (look.fit ?? 1);
  const handSize = look.hands ?? 0.5 + 0.5 * limb;
  // The sleeve starts just inside the jacket's sloping shoulder, so no peak shows above the arm.
  const up = shoulder.clone().add(v(-side * 0.12, 0.015, 0));
  builder.loft([
    { at: up, rx: 0.012 * limb, rz: 0.015 * limb, skin: [BONE.chest, clavicle, 0.3] },
    { at: mix(shoulder, elbow, 0.035).add(v(-side * 0.045, 0, 0)), rx: 0.1 * limb, rz: 0.12 * limb, skin: [clavicle, upper, 0.4] },
    { at: mix(shoulder, elbow, 0.13), rx: 0.145 * limb, rz: 0.16 * limb, skin: [clavicle, upper, 0.8] },
    { at: mix(shoulder, elbow, 0.22), rx: (streetwear ? 0.165 : 0.152) * limb, rz: 0.158 * limb, skin: [upper] },
    { at: mix(shoulder, elbow, 0.55), rx: (streetwear ? 0.155 : 0.138) * limb, rz: 0.142 * limb, skin: [upper] },
    { at: mix(shoulder, elbow, 0.86), rx: (streetwear ? 0.137 : 0.126) * limb, rz: 0.13 * limb, skin: [upper, fore, 0.3] },
    { at: elbow, rx: 0.122 * limb, rz: 0.126 * limb, skin: [upper, fore, 0.55] },
    { at: mix(elbow, wrist, 0.14), rx: 0.124 * limb, rz: 0.128 * limb, skin: [upper, fore, 0.85] },
    { at: mix(elbow, wrist, 0.5), rx: (streetwear ? 0.138 : 0.123) * limb, rz: 0.128 * limb, skin: [fore] },
    { at: mix(elbow, wrist, 0.8), rx: 0.103 * limb, rz: 0.108 * limb, skin: [fore] },
  ], { segments: 16, garment: "jacket", color: look.jacket, capStart: true, wash: streetwear ? 0.06 : 0 });
  builder.loft([
    { at: mix(elbow, wrist, 0.83), rx: 0.103 * limb, rz: 0.108 * limb, skin: [fore] },
    { at: mix(elbow, wrist, 0.93), rx: 0.095 * limb, rz: 0.101 * limb, skin: [fore] },
    { at: mix(elbow, wrist, 0.98), rx: 0.088 * limb, rz: 0.095 * limb, skin: [fore] },
  ], { segments: 12, garment: "trim", color: look.trim, capEnd: true });
  // A slender relaxed hand, with a palm, four unequal loosely curled fingers, and an opposed thumb.
  const down = wrist.clone().sub(elbow).normalize();
  const along = (d: number) => wrist.clone().addScaledVector(down, d * handSize);
  const handStart = builder.positions.length / 3;
  builder.loft([
    { at: along(-0.06), rx: 0.052 * handSize, rz: 0.042 * handSize, skin: [fore, hand, 0.5] },
    { at: along(0.03), rx: 0.055 * handSize, rz: 0.039 * handSize, skin: [hand] },
    { at: along(0.12), rx: 0.074 * handSize, rz: 0.037 * handSize, skin: [hand] },
    { at: along(0.2), rx: 0.069 * handSize, rz: 0.034 * handSize, skin: [hand] },
    { at: along(0.235), rx: 0.052 * handSize, rz: 0.027 * handSize, skin: [hand] },
  ], { segments: 12, garment: "skin", color: look.skin, capEnd: true, facing: v(-side, 0, 0) });
  for (let finger = 0; finger < 4; finger += 1) {
    const offset = (finger - 1.5) * 0.028 * handSize, length = [0.08, 0.116, 0.105, 0.073][finger]!;
    builder.loft(Array.from({ length: 4 }, (_, i) => {
      const t = i / 3;
      return { at: along(0.205 + length * t).add(v(offset + side * t * 0.003, 0, -Math.sin(t * Math.PI / 2) * 0.045 * handSize)), rx: (0.018 - t * 0.006) * handSize, rz: (0.02 - t * 0.007) * handSize, skin: [hand] as Skin };
    }), { segments: 6, garment: "skin", color: look.skin, capStart: true, capEnd: true });
  }
  builder.loft([
    { at: along(0.07).add(v(-side * 0.05 * handSize, 0, -0.005)), rx: 0.03 * handSize, rz: 0.028 * handSize, skin: [hand] },
    { at: along(0.115).add(v(-side * 0.08 * handSize, 0, -0.02)), rx: 0.027 * handSize, rz: 0.026 * handSize, skin: [hand] },
    { at: along(0.18).add(v(-side * 0.075 * handSize, 0, -0.034)), rx: 0.018 * handSize, rz: 0.018 * handSize, skin: [hand] },
    { at: along(0.2).add(v(-side * 0.063 * handSize, 0, -0.035)), rx: 0.008 * handSize, rz: 0.01 * handSize, skin: [hand] },
  ], { segments: 8, garment: "skin", color: look.skin, capStart: true, capEnd: true });
  for (let i = handStart; i < builder.positions.length / 3; i += 1) {
    const point = v(builder.positions[i * 3]!, builder.positions[i * 3 + 1]!, builder.positions[i * 3 + 2]!).sub(wrist).applyAxisAngle(down, side * 0.65).add(wrist);
    builder.positions[i * 3] = point.x; builder.positions[i * 3 + 1] = point.y; builder.positions[i * 3 + 2] = point.z;
  }
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
  const fit = look.fit ?? 1;
  const streetwear = look.garment === "hoodie" || look.garment === "cardigan";
  const cloth = (rings: Ring[]) => rings.map((ring) => ({ ...ring, rx: ring.rx * fit, rz: ring.rz * fit * (streetwear ? 0.88 : 1) }));
  const lowerClothSkin = (point: THREE.Vector3, fallback: Skin): Skin => {
    const down = THREE.MathUtils.clamp((1.95 - point.y) / 0.35, 0, 1);
    const side = THREE.MathUtils.smoothstep(Math.abs(point.x), 0.025, 0.17);
    return down > 0 && side > 0 ? [hips, point.x < 0 ? BONE.thighL : BONE.thighR, down * side * 0.6] : fallback;
  };
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
    ? [{ at: v(0, 1.62, 0.02), rx: 0.46 * w, rz: 0.35, skin: [hips] }, { at: v(0, 1.88, 0.02), rx: 0.445 * w, rz: 0.325, skin: [hips] }]
    : [{ at: v(0, 1.9, 0.02), rx: 0.405 * w, rz: 0.29, skin: [hips] }];
  const topRings = cloth([
    ...hem,
    { at: v(0, 2.06, 0.015), rx: (streetwear ? 0.44 : 0.395) * w, rz: streetwear ? 0.3 : 0.26, skin: [hips, spine, 0.45] },
    { at: v(0, 2.26, 0.01), rx: (streetwear ? 0.425 : 0.38) * w, rz: 0.25, skin: [spine] },
    { at: v(0, 2.5, 0.0), rx: (streetwear ? 0.435 : 0.41) * w, rz: 0.263, skin: [spine, chest, 0.55] },
    { at: v(0, 2.72, 0.0), rx: 0.44 * w, rz: 0.288, skin: [chest] },
    { at: v(0, 2.88, 0.01), rx: 0.46 * w, rz: 0.27, skin: [chest] },
    { at: v(0, 2.97 - drop * 0.4, 0.02), rx: 0.41 * w, rz: 0.235, skin: [chest] },
    { at: v(0, 3.05 - drop * 0.6, 0.025), rx: 0.235, rz: 0.19, skin: [chest, neck, 0.3] },
  ]);
  const clothSkin = (point: THREE.Vector3): Skin => {
    let a = topRings[0]!, b = topRings[1]!;
    for (let i = 0; i < topRings.length - 1; i += 1) if (point.y >= topRings[i]!.at.y) { a = topRings[i]!; b = topRings[i + 1]!; }
    const t = THREE.MathUtils.clamp((point.y - a.at.y) / (b.at.y - a.at.y), 0, 1);
    const weights = new Map<number, number>();
    for (const [skin, blend] of [[a.skin, 1 - t], [b.skin, t]] as const) {
      const [bone, other = bone, weight = 0] = skin;
      weights.set(bone, (weights.get(bone) ?? 0) + blend * (1 - weight));
      weights.set(other, (weights.get(other) ?? 0) + blend * weight);
    }
    const [first, second = first] = [...weights].sort((a, b) => b[1] - a[1]);
    return lowerClothSkin(point, [first![0], second![0], second![1] / (first![1] + second![1])]);
  };
  const bodyIndexStart = builder.indices.length;
  builder.loft(topRings, {
    segments: 32, garment: "jacket", color: look.jacket, capStart: true, capEnd: !streetwear, wash: streetwear ? 0.05 : 0,
    skinAt: (ring, point) => lowerClothSkin(point, ring.skin),
    openAt: look.garment === "cardigan" ? (point) => {
      if (point.z >= 0 || point.y <= 2.12) return false;
      const half = point.y > 2.6 ? THREE.MathUtils.mapLinear(point.y, 2.6, 3.05, 0.2, 0.14)
        : THREE.MathUtils.mapLinear(point.y, 2.12, 2.6, 0.05, 0.2);
      return Math.abs(point.x) < half * w;
    } : undefined,
    // A sweatshirt opens at the neck. Its front edge drops into the hood opening instead of capping the throat
    // with a horizontal shelf; the last ring still wraps round the shoulders and the back of the neck.
    deform: streetwear ? (point, ring, angle) => {
      const opening = ring - (topRings.length - 3);
      const fall = look.garment === "hoodie" ? [0.08, 0.04, 0.02] : [0.04, 0.08, 0.1];
      if (opening >= 0) point.y -= Math.max(0, Math.sin(angle)) ** 2 * fall[opening]!;
      return point;
    } : undefined,
  });
  const bodyTriangles: THREE.Triangle[] = [];
  const pointAt = (index: number) => v(builder.positions[index * 3]!, builder.positions[index * 3 + 1]!, builder.positions[index * 3 + 2]!);
  for (let i = bodyIndexStart; i < builder.indices.length; i += 3) bodyTriangles.push(new THREE.Triangle(pointAt(builder.indices[i]!), pointAt(builder.indices[i + 1]!), pointAt(builder.indices[i + 2]!)));
  const clothRay = new THREE.Ray(v(0, 0, -3), v(0, 0, 1));
  const clothHit = new THREE.Vector3();
  const jacketZ = (x: number, y: number) => {
    // The shoulder rings tilt with the coat's curved centre line. Project onto those actual triangles, including
    // their tilt, rather than assuming horizontal ellipses and losing the collar's centre inside the cloth.
    clothRay.origin.set(x, y, -3);
    let front = Infinity;
    for (const triangle of bodyTriangles) if (clothRay.intersectTriangle(triangle.a, triangle.b, triangle.c, false, clothHit) && clothHit.z < 0) front = Math.min(front, clothHit.z);
    // An open cardigan has no centre-front triangles. Its lapel still follows the front envelope below, rather
    // than projecting onto the far back of the coat through that opening and vanishing behind the tee.
    if (Number.isFinite(front)) return front;
    let a = topRings[0]!, b = topRings[1]!;
    for (let i = 0; i < topRings.length - 1; i += 1) if (y >= topRings[i]!.at.y) { a = topRings[i]!; b = topRings[i + 1]!; }
    const t = THREE.MathUtils.clamp((y - a.at.y) / (b.at.y - a.at.y), 0, 1);
    const rx = THREE.MathUtils.lerp(a.rx, b.rx, t), rz = THREE.MathUtils.lerp(a.rz, b.rz, t);
    return THREE.MathUtils.lerp(a.at.z, b.at.z, t) - Math.sqrt(Math.max(0.02, 1 - (x / rx) ** 2)) * rz;
  };
  // The hem band and a stand-up collar in the trim colour.
  const hemY = look.longTop ? 1.69 : 1.95;
  const hemRx = (look.longTop ? 0.465 : 0.412) * w, hemRz = look.longTop ? 0.356 : 0.296;
  builder.loft(cloth([
    { at: v(0, hemY, 0.02), rx: hemRx, rz: hemRz, skin: [hips] },
    { at: v(0, hemY - 0.08, 0.02), rx: hemRx + 0.002, rz: hemRz + 0.002, skin: [hips] },
  ]), { segments: 20, garment: "trim", color: look.trim, capEnd: true, skinAt: (ring, point) => lowerClothSkin(point, ring.skin) });
  if (!streetwear) builder.loft([
    { at: v(0, 3.0 - drop * 1.1, 0.03), rx: 0.215, rz: 0.2, skin: [chest] },
    { at: v(0, 3.1 - drop * 1.1, 0.035), rx: 0.2, rz: 0.19, skin: [chest, neck, 0.5] },
    { at: v(0, 3.15 - drop * 1.1, 0.04), rx: 0.19, rz: 0.18, skin: [neck] },
  ], { segments: 16, garment: "trim", color: look.longTop || look.bow ? look.jacket : look.trim });
  if (look.garment === "hoodie") {
    // The hood rests behind the neck. Its opening is a rounded rolled edge, not two broad flat lapels.
    const hoodIndexStart = builder.indices.length;
    const hoodColor = new THREE.Color(look.jacket).multiplyScalar(1.025).getStyle();
    builder.loft([
      { at: v(0, 2.7, 0.28), rx: 0.13 * w, rz: 0.055, skin: [chest] },
      { at: v(0, 2.79, 0.35), rx: 0.28 * w, rz: 0.12, skin: [chest] },
      { at: v(0, 2.96, 0.3), rx: 0.29 * w, rz: 0.16, skin: [chest] },
      { at: v(0, 3.08 - drop * 0.2, 0.16), rx: 0.18 * w, rz: 0.085, skin: [chest, neck, 0.15] },
    ], { segments: 28, garment: "trim", color: hoodColor, capStart: true, capEnd: true });
    const lipY = (y: number) => y - drop * 0.3;
    const lip = new THREE.CatmullRomCurve3([
      v(-0.105 * w, lipY(2.965), jacketZ(-0.105 * w, lipY(2.965)) + 0.003),
      v(-0.16 * w, lipY(3.025), -0.145), v(-0.205 * w, lipY(3.095), -0.045),
      v(-0.215 * w, lipY(3.11), 0.07), v(-0.15 * w, lipY(3.095), 0.2),
      v(0, lipY(3.08), 0.25),
      v(0.15 * w, lipY(3.095), 0.2), v(0.215 * w, lipY(3.11), 0.07),
      v(0.205 * w, lipY(3.095), -0.045), v(0.16 * w, lipY(3.025), -0.145),
      v(0.105 * w, lipY(2.965), jacketZ(0.105 * w, lipY(2.965)) + 0.003),
    ], false, "centripetal");
    // Small side/back joins slope into the shoulder and existing pouch. Their front ends stay beside the neck,
    // leaving the V open; widening them across the chest was what made the former hood read as a shirt collar.
    builder.sheet(30, 5, (u, t) => {
      const point = lip.getPoint(0.12 + u * 0.76);
      const back = THREE.MathUtils.smoothstep(point.z, 0, 0.25);
      return v(point.x * (1 + t * 0.27), point.y - t * (0.13 + back * 0.025), point.z + t * (0.04 + back * 0.07));
    }, (_u, t) => [chest, neck, (1 - t) * 0.12], "jacket", hoodColor);
    builder.loft(Array.from({ length: 33 }, (_, i) => {
      const t = i / 32, end = Math.min(t, 1 - t);
      const radius = THREE.MathUtils.lerp(0.009, 0.041, THREE.MathUtils.smoothstep(end, 0, 0.16));
      return { at: lip.getPoint(t), rx: radius, rz: radius * 0.9, skin: [chest, neck, 0.12] as Skin };
    }), { segments: 10, garment: "jacket", color: hoodColor, capStart: true, capEnd: true, wash: 0.015 });
    // A short fitted tee collar wraps the neck inside the opening; no tall white cone projects onto the chest.
    builder.loft([
      { at: v(0, 2.88, 0.035), rx: 0.185 * w, rz: 0.16, skin: [chest] },
      { at: v(0, 2.995, 0.035), rx: 0.135, rz: 0.125, skin: [chest, neck, 0.65] },
      { at: v(0, 3.075 - drop * 0.15, 0.04), rx: 0.115, rz: 0.108, skin: [neck] },
      { at: v(0, 3.1 - drop * 0.15, 0.04), rx: 0.11, rz: 0.103, skin: [neck] },
    ], { segments: 24, garment: "jacket", color: look.shirt ?? "#faf7ed", capStart: true });
    // Project each cord onto the actual hood and sweatshirt triangles; its first point belongs to the rolled lip.
    for (let i = hoodIndexStart; i < builder.indices.length; i += 3) bodyTriangles.push(new THREE.Triangle(pointAt(builder.indices[i]!), pointAt(builder.indices[i + 1]!), pointAt(builder.indices[i + 2]!)));
    for (const side of [-1, 1]) {
      const anchor = lip.getPoint(side < 0 ? 0.055 : 0.945);
      builder.loft(Array.from({ length: 20 }, (_, i) => {
        const t = i / 19, x = anchor.x * (1 - t * 0.13) + side * Math.sin(t * Math.PI) * 0.005, y = anchor.y - t * 0.36;
        const point = v(x, y, jacketZ(x, y) - 0.014);
        return { at: point, rx: t > 0.94 ? 0.008 : 0.0055, rz: 0.0055, skin: y > 2.75 ? [chest] as Skin : clothSkin(point) };
      }), { segments: 7, garment: "trim", color: look.shirt ?? "#dfe2cf", capStart: true, capEnd: true });
    }
    // A single fine kangaroo-pocket seam follows the actual cloth instead of an intersecting padded oval.
    const pocket = [[-0.27, 2.04], [-0.24, 2.15], [-0.18, 2.33], [0.18, 2.33], [0.24, 2.15], [0.27, 2.04]];
    const seam = new THREE.Color(look.jacket).multiplyScalar(0.65).getStyle();
    for (let i = 1; i < pocket.length; i += 1) {
      const [ax, ay] = pocket[i - 1]!, [bx, by] = pocket[i]!;
      builder.patch([new THREE.Vector2(ax! * w, ay!), new THREE.Vector2(bx! * w, by!), new THREE.Vector2(bx! * w, by! - 0.004), new THREE.Vector2(ax! * w, ay! - 0.004)],
        (point) => v(point.x, point.y, jacketZ(point.x, point.y) - 0.018), clothSkin, "jacket", seam, 6);
    }
  } else if (look.garment === "cardigan") {
    const shirt = look.shirt ?? "#e8e5d9";
    const onCloth = (point: THREE.Vector2, layer = 0.04) => v(point.x, point.y, jacketZ(point.x, point.y) - layer);
    // The tee's ribbed neck and a continuous dark shawl edge rise out of the loose cardigan body. Drawing only
    // two flat strips on its chest made them read as suspenders and left a conspicuous green shelf at the neck.
    builder.loft([
      { at: v(0, 2.08, 0.015), rx: 0.32 * w, rz: 0.23, skin: [hips, spine, 0.5] },
      { at: v(0, 2.26, 0.015), rx: 0.325 * w, rz: 0.23, skin: [spine] },
      { at: v(0, 2.5, 0.015), rx: 0.34 * w, rz: 0.235, skin: [spine, chest, 0.55] },
      { at: v(0, 2.72, 0.015), rx: 0.32 * w, rz: 0.235, skin: [chest] },
      { at: v(0, 2.94, 0.015), rx: 0.23 * w, rz: 0.225, skin: [chest, neck, 0.15] },
      { at: v(0, 3.045, 0.015), rx: 0.143, rz: 0.15, skin: [chest, neck, 0.6] },
      { at: v(0, 3.13, 0.015), rx: 0.113, rz: 0.108, skin: [neck] },
    ], { segments: 32, garment: "jacket", color: shirt, capStart: true });
    for (const side of [-1, 1]) builder.loft([
      { at: v(side * 0.14, 3.1 - drop * 0.3, 0.11), rx: 0.052, rz: 0.016, skin: [chest, neck, 0.3] },
      ...Array.from({ length: 14 }, (_, i) => {
        const y = 3.0 - i / 13 * 0.85;
        const x = y >= 2.6 ? THREE.MathUtils.mapLinear(y, 2.6, 3.0, 0.22, 0.18) : THREE.MathUtils.mapLinear(y, 2.15, 2.6, 0.09, 0.22);
        const point = onCloth(new THREE.Vector2(side * x * w, y), 0.06);
        return { at: point, rx: 0.05, rz: 0.018, skin: clothSkin(point) };
      }),
    ], { segments: 10, garment: "trim", color: look.trim, capStart: true, capEnd: true, facing: v(0, 0, -1) });
    // Loose vertical woven stripes and the small waist tie distinguish the wrap cardigan in the illustration.
    const stripe = new THREE.Color(look.jacket).multiplyScalar(0.7).getStyle();
    for (let x = -0.48 * w; x <= 0.49 * w; x += 0.065 * w) {
      const top = Math.abs(x) < 0.14 * w ? 2.05 : Math.abs(x) < 0.29 * w ? 2.44 : 2.76;
      builder.patch([new THREE.Vector2(x, 1.73), new THREE.Vector2(x + 0.003, 1.73), new THREE.Vector2(x + 0.015, top), new THREE.Vector2(x + 0.011, top)],
        (point) => onCloth(point, 0.012), clothSkin, "jacket", stripe, 6);
    }
    builder.blob(v(0, 2.15, jacketZ(0, 2.15) - 0.027), v(0.045, 0.035, 0.022), [spine], "jacket", look.jacket, [10, 6]);
    for (const side of [-1, 1]) builder.loft([
      { at: v(0, 2.15, jacketZ(0, 2.15) - 0.03), rx: 0.012, rz: 0.009, skin: [spine] },
      { at: v(side * 0.065, 2.02, jacketZ(side * 0.065, 2.02) - 0.025), rx: 0.012, rz: 0.009, skin: [spine, hips, 0.3] },
      { at: v(side * 0.11, 1.94, jacketZ(side * 0.11, 1.94) - 0.02), rx: 0.009, rz: 0.007, skin: [spine, hips, 0.6] },
    ], { segments: 6, garment: "jacket", color: stripe, capStart: true, capEnd: true });
  }
  if (look.collar === "spread") {
    for (const side of [-1, 1]) builder.patch([
      new THREE.Vector2(side * 0.025, 3.03 - drop * 0.65), new THREE.Vector2(side * 0.18, 3.015 - drop * 0.65),
      new THREE.Vector2(side * 0.32 * w, 2.86 - drop * 0.4), new THREE.Vector2(side * 0.14, 2.77 - drop * 0.4),
    ], (point) => v(point.x, point.y, jacketZ(point.x, point.y) - 0.035), [chest], "trim", look.trim, 5, 4);
  }
  if (look.pockets) {
    for (const side of [-1, 1]) {
      const x = side * 0.23 * w;
      builder.patch([new THREE.Vector2(x - 0.12, 2.64), new THREE.Vector2(x + 0.12, 2.64), new THREE.Vector2(x + 0.1, 2.51), new THREE.Vector2(x, 2.47), new THREE.Vector2(x - 0.1, 2.51)],
        (point) => v(point.x, point.y, jacketZ(point.x, point.y) - 0.018), [chest, spine, 0.3], "trim", look.trim, 3);
      builder.blob(v(x, 2.545, jacketZ(x, 2.545) - 0.027), v(0.023, 0.023, 0.008), [chest, spine, 0.3], "jacket", look.jacket, [7, 5]);
    }
    for (const y of [2.72, 2.39, 2.07]) builder.blob(v(0, y, jacketZ(0, y) - 0.02), v(0.026, 0.026, 0.009), [spine, chest, 0.3], "trim", look.trim, [7, 5]);
  }
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
  const neckTop = look.face === "anime" ? CHIN + HEAD_SPAN + (hp(0, 3.26, 0).y - CHIN - HEAD_SPAN) * 0.86 : neckY(3.26);
  builder.loft([
    { at: v(0, neckY(2.99), 0.05), rx: 0.145, rz: 0.118, skin: [chest, neck, 0.4] },
    { at: v(0, neckY(3.05), 0.041), rx: 0.119, rz: 0.107, skin: [chest, neck, 0.75] },
    { at: v(0, neckY(3.12), 0.03), rx: 0.091, rz: 0.091, skin: [neck] },
    { at: v(0, neckTop - 0.105, 0.021), rx: 0.079, rz: 0.084, skin: [neck, head, 0.15] },
    { at: v(0, neckTop - 0.055, 0.012), rx: 0.082, rz: 0.09, skin: [neck, head, 0.55] },
    { at: v(0, neckTop, 0.008), rx: 0.092, rz: 0.102, skin: [head] },
  ], { segments: 20, garment: "skin", color: look.skin });
  // Head: chin to crown, with a flatter face.
  const drawnHeadStart = builder.positions.length / 3;
  // The cheek turns gradually into a narrow jaw; closely spaced rings keep the lower face softly anatomical.
  const chinWidth = look.age === "older" ? 0.057 : look.age === "adult" ? 0.049 : 0.041;
  const jawWidth = look.age === "older" ? 0.129 : look.age === "adult" ? 0.121 : 0.113;
  const jaw: [y: number, rx: number, rz: number, z: number][] = look.face === "anime"
    ? [[3.185, chinWidth, 0.071, -0.061], [3.205, 0.078, 0.109, -0.055], [3.235, jawWidth, 0.15, -0.041],
      [3.265, 0.153, 0.184, -0.027], [3.295, 0.179, 0.207, -0.016], [3.325, 0.199, 0.223, -0.008],
      [3.35, 0.212, 0.235, -0.003], [3.375, 0.22, 0.244, 0], [3.405, 0.225, 0.25, 0.002], [3.435, 0.228, 0.252, 0.003]]
    : [[3.16, 0.07, 0.06, -0.135], [3.2, 0.13, 0.13, -0.085], [3.27, 0.185, 0.2, -0.04], [3.36, 0.218, 0.236, -0.012]];
  const headRings: [y: number, rx: number, rz: number, z: number][] = [
    ...jaw,
    [3.47, 0.232, 0.25, 0.0], [3.58, 0.232, 0.252, 0.008], [3.67, 0.205, 0.228, 0.012], [3.74, 0.14, 0.16, 0.014], [3.785, 0.03, 0.035, 0.014],
  ];
  const flatFace = look.face === "anime" ? 0.055 : 0.22;
  const facialRelief = (x: number, y: number) => look.face === "anime"
    ? -0.028 * Math.exp(-((x / 0.022) ** 2) - ((y - 3.401) / 0.064) ** 2)
      - 0.024 * Math.exp(-((x / 0.029) ** 2) - ((y - 3.358) / 0.023) ** 2)
      - 0.009 * Math.exp(-(((Math.abs(x) - 0.025) / 0.015) ** 2) - ((y - 3.35) / 0.013) ** 2)
      - 0.01 * Math.exp(-((x / 0.048) ** 2) - ((y - 3.298) / 0.011) ** 2)
      - 0.006 * Math.exp(-((x / 0.035) ** 2) - ((y - 3.281) / 0.009) ** 2)
      - 0.009 * Math.exp(-(((Math.abs(x) - 0.122) / 0.051) ** 2) - ((y - 3.366) / 0.047) ** 2)
    : 0;
  builder.loft(headRings.map(([y, rx, rz, z]) => ({ at: hp(0, y, z), rx: rx * s, rz: rz * s, skin: [head] as Skin })), {
    segments: look.face === "anime" ? 48 : 32, garment: "skin", color: look.skin, capStart: true, capEnd: true, flatFront: flatFace,
    deform: (point, _ring, angle) => {
      if (Math.sin(angle) > 0.25) point.z += facialRelief(point.x / s, CHIN + (point.y + drop - CHIN) / s) * s * THREE.MathUtils.smoothstep(Math.sin(angle), 0.25, 0.85);
      return point;
    },
  });
  if (look.face === "anime") {
    // Very restrained painted planes support the actual relief under broad daylight, without drawing a nose ball.
    const skinPigment = new THREE.Color(look.skin), shadePigment = skinPigment.clone().lerp(new THREE.Color("#a97973"), 0.3);
    for (let i = drawnHeadStart; i < builder.positions.length / 3; i += 1) {
      const x = builder.positions[i * 3]! / s, y = CHIN + (builder.positions[i * 3 + 1]! + drop - CHIN) / s, z = builder.positions[i * 3 + 2]! / s;
      if (z > -0.07) continue;
      const nose = Math.exp(-((x / 0.039) ** 2) - ((y - 3.341) / 0.011) ** 2) * 0.5;
      const lip = Math.exp(-((x / 0.047) ** 2) - ((y - 3.291) / 0.007) ** 2) * 0.35;
      const cheek = Math.exp(-(((Math.abs(x) - 0.17) / 0.037) ** 2) - ((y - 3.345) / 0.051) ** 2) * 0.16;
      const pigment = skinPigment.clone().lerp(shadePigment, Math.min(0.65, nose + lip + cheek));
      builder.colors[i * 3] = pigment.r; builder.colors[i * 3 + 1] = pigment.g; builder.colors[i * 3 + 2] = pigment.b;
    }
  }
  // Ears, except under a cute bob, which covers them.
  if (look.face !== "cute" && look.face !== "anime") for (const side of [-1, 1]) builder.blob(hp(side * 0.232, 3.44, 0.02), sized(0.035, 0.07, 0.05), [head], "skin", look.skin, [8, 6]);
  // Fine ink lies against the sculpted cheeks, nose and lip plane, so three-quarter views keep an actual face.
  const flush = (x: number, y: number, z: number, w: number, h: number, bone: number, garment: "skin" | "eyes" | "hair", colour: string, depth = 0.005) =>
    builder.blob(hp(x, y, z), sized(w, h, depth), [bone], garment, colour, [10, 5]);
  if (look.face === "anime") {
    // Painted open almond eyes, soft brows and a small smile. Every point follows the cheek surface, including
    // the corners, so features remain attached in three-quarter views instead of becoming floating eye discs.
    const faceZ = (x: number, y: number): number => {
      let a = headRings[0]!, b = headRings[1]!;
      for (let i = 0; i < headRings.length - 1; i += 1) if (y >= headRings[i]![0]) { a = headRings[i]!; b = headRings[i + 1]!; }
      const t = THREE.MathUtils.clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
      const rx = THREE.MathUtils.lerp(a[1], b[1], t), rz = THREE.MathUtils.lerp(a[2], b[2], t), z = THREE.MathUtils.lerp(a[3], b[3], t);
      const c = Math.min(0.99, Math.abs(x) / rx);
      return z - Math.min(Math.sqrt(1 - c * c) * rz, rz * (1 - flatFace * (1 - c * 0.5))) + facialRelief(x, y);
    };
    const paint = (points: THREE.Vector2[], bone: number, garment: "skin" | "eyes" | "hair", colour: string, layer = 0.01) =>
      builder.patch(points, (point) => hp(point.x, point.y, faceZ(point.x, point.y) - layer), [bone], garment, colour);
    const oval = (x: number, y: number, rx: number, ry: number, bone: number, garment: "skin" | "eyes" | "hair", colour: string, layer = 0.01) =>
      paint(Array.from({ length: 18 }, (_, i) => new THREE.Vector2(x + Math.cos(i / 18 * Math.PI * 2) * rx, y + Math.sin(i / 18 * Math.PI * 2) * ry)), bone, garment, colour, layer);
    const stroke = (points: readonly (readonly [number, number])[], width: number, bone: number, garment: "skin" | "eyes" | "hair", colour: string, layer = 0.016) => {
      for (let i = 1; i < points.length; i += 1) {
        const a = new THREE.Vector2(...points[i - 1]!), b = new THREE.Vector2(...points[i]!);
        const normal = new THREE.Vector2(-(b.y - a.y), b.x - a.x).normalize().multiplyScalar(width / 2);
        paint([a.clone().add(normal), b.clone().add(normal), b.clone().sub(normal), a.clone().sub(normal)], bone, garment, colour, layer);
      }
    };
    const inkPath = (points: THREE.Vector2[], peak: number, bone: number, garment: "skin" | "eyes" | "hair", colour: string, layer = 0.016) => {
      const edge = points.map((point, i) => {
        const tangent = points[Math.min(points.length - 1, i + 1)]!.clone().sub(points[Math.max(0, i - 1)]!).normalize();
        const width = peak * (0.12 + 0.88 * Math.sin(i / (points.length - 1) * Math.PI));
        return new THREE.Vector2(-tangent.y, tangent.x).multiplyScalar(width / 2);
      });
      for (let i = 1; i < points.length; i += 1) paint([points[i - 1]!.clone().add(edge[i - 1]!), points[i]!.clone().add(edge[i]!), points[i]!.clone().sub(edge[i]!), points[i - 1]!.clone().sub(edge[i - 1]!)], bone, garment, colour, layer);
    };
    const inkCurve = (a: THREE.Vector2, control: THREE.Vector2, b: THREE.Vector2, width: number, bone: number, garment: "skin" | "eyes" | "hair", colour: string, layer = 0.016) =>
      inkPath(new THREE.QuadraticBezierCurve(a, control, b).getPoints(16), width, bone, garment, colour, layer);
    const mood = look.expression ?? "gentle";
    const open = (mood === "bright" ? 0.031 : mood === "calm" ? 0.022 : 0.027) * (look.age === "older" ? 0.86 : 1);
    const ink = "#29242b";
    for (const side of [-1, 1]) {
      const x = side * 0.103, y = 3.433;
      const eyeWidth = 0.059;
      const upper = Array.from({ length: 17 }, (_, i) => { const u = i / 8 - 1; return new THREE.Vector2(x + u * eyeWidth, y + open * (1 - u * u) + u * side * 0.003); });
      const lower = Array.from({ length: 17 }, (_, i) => { const u = 1 - i / 8; return new THREE.Vector2(x + u * eyeWidth, y - open * 0.45 * Math.max(0, 1 - u * u) ** 0.65 + u * side * 0.003); });
      paint([...upper, ...lower], eyes, "eyes", "#fbf5e9");
      const iris = (cy: number, rx: number, ry: number, colour: string, layer: number) => paint(Array.from({ length: 20 }, (_, i) => {
        const px = x + Math.cos(i / 20 * Math.PI * 2) * rx;
        const py = cy + Math.sin(i / 20 * Math.PI * 2) * ry;
        const edge = Math.sqrt(Math.max(0, 1 - ((px - x) / eyeWidth) ** 2));
        return new THREE.Vector2(px, THREE.MathUtils.clamp(py, y - open * 0.44 * edge, y + open * 0.96 * edge * edge));
      }), eyes, "eyes", colour, layer);
      iris(y + 0.003, 0.024, open, ink, 0.013);
      const irisColour = look.iris ?? "#785848";
      iris(y - open * 0.08, 0.02, open * 0.72, irisColour, 0.014);
      iris(y + open * 0.1, 0.009, open * 0.82, ink, 0.015);
      const irisLight = new THREE.Color(irisColour).lerp(new THREE.Color("#d3baa0"), 0.36).getStyle();
      for (let ray = 0; ray < 5; ray += 1) {
        const a = Math.PI * (1.12 + ray * 0.17);
        stroke([[x + Math.cos(a) * 0.012, y + Math.sin(a) * open * 0.42], [x + Math.cos(a) * 0.018, y + Math.sin(a) * open * 0.61]], 0.0011, eyes, "eyes", irisLight, 0.016);
      }
      oval(x - 0.006, y + open * 0.4, 0.003, 0.0042, eyes, "eyes", "#fffaf0", 0.017);
      oval(x + 0.008, y - open * 0.2, 0.0015, 0.0017, eyes, "eyes", "#e8ded0", 0.017);
      inkPath(upper, 0.0048, eyes, "eyes", ink);
      inkPath(lower.slice(2, 12), 0.0015, eyes, "eyes", "#986e65", 0.014);
      inkCurve(new THREE.Vector2(x - 0.047, y + 0.025), new THREE.Vector2(x, y + open + 0.019), new THREE.Vector2(x + 0.045, y + 0.029), 0.0012, head, "skin", "#bb9388", 0.008);
      for (let lash = 0; lash < 2; lash += 1) inkCurve(
        new THREE.Vector2(x + side * (0.043 + lash * 0.007), y + 0.013 - lash * 0.005),
        new THREE.Vector2(x + side * (0.057 + lash * 0.006), y + 0.016 - lash * 0.005),
        new THREE.Vector2(x + side * (0.064 + lash * 0.005), y + 0.022 - lash * 0.005), 0.0026 - lash * 0.0005, eyes, "eyes", ink, 0.017);
      inkCurve(new THREE.Vector2(side * 0.045, 3.515), new THREE.Vector2(side * 0.1, 3.535), new THREE.Vector2(side * 0.153, 3.521), 0.0033, head, "hair", look.hair, 0.012);
      if (look.age === "older") stroke([[x - 0.04, y - open - 0.02], [x + 0.025, y - open - 0.026]], 0.003, head, "skin", "#aa8074", 0.008);
      else for (let hatch = 0; hatch < 3; hatch += 1) {
        const cheek = side * (0.145 + hatch * 0.012);
        inkCurve(new THREE.Vector2(cheek - 0.003, 3.354), new THREE.Vector2(cheek, 3.345), new THREE.Vector2(cheek + 0.003, 3.339), 0.0017, head, "skin", new THREE.Color(look.skin).lerp(new THREE.Color("#c87e7d"), 0.27).getStyle(), 0.006);
      }
    }
    const lipShadow = new THREE.Color(look.skin).lerp(new THREE.Color("#8d5d61"), 0.55).getStyle();
    inkCurve(new THREE.Vector2(-0.037, 3.294), new THREE.Vector2(-0.015, 3.299), new THREE.Vector2(0, 3.293), 0.0022, head, "skin", lipShadow, 0.006);
    inkCurve(new THREE.Vector2(0, 3.293), new THREE.Vector2(0.018, mood === "calm" ? 3.292 : 3.287), new THREE.Vector2(0.038, 3.296), 0.0027, head, "skin", lipShadow, 0.006);
    inkCurve(new THREE.Vector2(-0.018, 3.282), new THREE.Vector2(0.002, 3.277), new THREE.Vector2(0.023, 3.283), 0.0013, head, "skin", new THREE.Color(look.skin).lerp(new THREE.Color("#fffaf3"), 0.4).getStyle(), 0.006);
    const noseShadow = new THREE.Color(look.skin).lerp(new THREE.Color("#996c66"), 0.35).getStyle();
    inkCurve(new THREE.Vector2(0.008, 3.382), new THREE.Vector2(0.018, 3.359), new THREE.Vector2(0.006, 3.347), 0.0016, head, "skin", noseShadow, 0.004);
    inkCurve(new THREE.Vector2(-0.017, 3.349), new THREE.Vector2(-0.01, 3.345), new THREE.Vector2(-0.006, 3.348), 0.0013, head, "skin", noseShadow, 0.004);
    oval(-0.006, 3.366, 0.005, 0.002, head, "skin", new THREE.Color(look.skin).lerp(new THREE.Color("#fffdf4"), 0.55).getStyle(), 0.004);
    for (const side of [-1, 1]) builder.blob(hp(side * 0.227, 3.407, 0.01), sized(0.026, 0.052, 0.033), [head], "skin", look.skin, [10, 8]);
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
  if (look.hairStyle === "layered") {
    // An inset scalp backing follows the actual head rings. Its lower width stays inside the cut's visible layers.
    // Only the face opening is recessed; the rear scalp remains covered continuously through every lock's root.
    builder.loft(headRings.filter(([y]) => y >= 3.205).map(([y, rx, rz, z]) => ({
      at: hp(0, y, z), rx: (rx + 0.011) * s, rz: (rz + 0.014) * s, skin: [head] as Skin,
    })), {
      segments: 40, garment: "hair", color: look.hair, capStart: true, capEnd: true,
      deform: (point, _ring, angle) => {
        const rawY = CHIN + (point.y + drop - CHIN) / s;
        const opening = 1 - THREE.MathUtils.smoothstep(rawY, 3.51, 3.61);
        point.z += Math.max(0, Math.sin(angle)) ** 2 * opening * 0.145 * s;
        return point;
      },
    });
    // The backing ends above the feathered cut: individual lower layers, rather than a bob shell, make its outline.
    const hem = 3.255 - (THREE.MathUtils.clamp(look.hairLength ?? 1, 1, 1.8) - 1) * 0.035;
    const layeredRings: [number, number, number, number][] = [
      [hem, 0.065, 0.032, 0.181], [hem + 0.028, 0.165, 0.075, 0.157], [hem + 0.06, 0.227, 0.137, 0.111],
      [3.35, 0.26, 0.205, 0.072], [3.43, 0.275, 0.257, 0.032],
      [3.53, 0.264, 0.277, 0.014], [3.585, 0.254, 0.277, 0.014],
    ];
    const crownRings: [number, number, number, number][] = Array.from({ length: 12 }, (_, i) => {
      const angle = (1 - (i + 1) / 12) * Math.PI / 2;
      return [3.585 + 0.22 * Math.cos(angle), Math.max(0.004, 0.254 * Math.sin(angle)), Math.max(0.004, 0.277 * Math.sin(angle)), 0.014];
    });
    builder.loft([...layeredRings, ...crownRings].map(hairAt), {
      segments: 36, garment: "hair", color: look.hair, capStart: true, capEnd: true,
      deform: (point, ring, angle) => {
        const rawY = CHIN + (point.y + drop - CHIN) / s;
        const opening = 1 - THREE.MathUtils.smoothstep(rawY, 3.43, 3.585);
        point.z += Math.max(0, Math.sin(angle)) ** 2 * opening * 0.18 * s;
        // Broad unequal volume, with a subtle off-centre crown rather than a geometrically even helmet.
        point.x += Math.sin(angle + 0.8) * 0.006 * s;
        if (ring < 4) point.y += (Math.sin(angle * 5 + 0.9) * 0.016 + Math.cos(angle * 3 - 0.5) * 0.011) * s * (1 - ring / 4);
        if (ring < 14) point.y += (Math.sin(angle * 3 + 0.65) * 0.004 + Math.cos(angle - 0.4) * 0.003) * s;
        return point;
      },
    });
  } else if (look.fringe) {
    // A blunt fringe: the bob covers the sides and back up to the brow line, and a closed cap over the crown comes
    // down across the forehead to just above the eyes.
    const fringeEdge = 3.52;
    builder.loft(hairRings.filter(([y]) => y < fringeEdge).concat([[fringeEdge, 0.255, 0.27, 0.015]]).map(hairAt), { segments: 32, garment: "hair", color: look.hair, flatFront: 0.5 });
    const fringe: [number, number, number, number][] = [
      [fringeEdge, 0.255, 0.27, 0.015], [3.58, 0.25, 0.266, 0.012], [3.66, 0.232, 0.25, 0.012], [3.73, 0.18, 0.2, 0.015], [3.78, 0.1, 0.12, 0.016], [3.805, 0.02, 0.02, 0.016],
    ];
    builder.loft(fringe.map(hairAt), { segments: 24, garment: "hair", color: look.hair, capEnd: true });
  } else {
    // Without a fringe: drawn back off the face at the sides, and a closed cap over the top down to a hairline above
    // the brow, so the crown never shows bare.
    const bobbed = look.hairStyle === "bob" || look.hairStyle === "long";
    const hairline: [number, number, number, number] = bobbed ? [3.6, 0.248, 0.264, 0.012] : [3.6, 0.24, 0.258, 0.014];
    builder.loft(hairRings.filter(([y]) => y < hairline[0]).concat([hairline]).map(hairAt), { segments: 20, garment: "hair", color: look.hair, flatFront: 0.5 });
    builder.loft([hairline as [number, number, number, number]].concat(hairRings.filter(([y]) => y > hairline[0])).map(hairAt), { segments: 20, garment: "hair", color: look.hair, capEnd: true });
  }
  if (look.hairStyle === "bun") builder.blob(hp(0, 3.66, 0.24), sized(0.11, 0.1, 0.1), [head], "hair", look.hair);
  if (look.hairStyle === "layered") {
    const lock = (points: readonly (readonly [number, number, number])[], width: number, color = look.hair, depth = 0.005, feathered = false) => {
      const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => hp(x, y, z)), false, "centripetal");
      const fine = width < 0.003;
      const steps = fine ? 7 : 10;
      builder.loft(Array.from({ length: steps + 1 }, (_, i) => {
        const u = i / steps;
        const fullness = Math.sin(Math.PI * u) ** 0.7 * (feathered ? 1 - u * 0.55 : 1);
        return { at: curve.getPoint(u), rx: ((fine ? 0.00012 : 0.0004) + width * fullness) * s, rz: ((fine ? 0.0001 : 0.0003) + depth * fullness) * s, skin: [head] as Skin };
      }), { segments: fine ? 4 : 7, garment: "hair", color, capStart: true, capEnd: true });
    };
    const crownFront = (x: number, y: number) => {
      const ring = Math.sqrt(Math.max(0.04, 1 - ((y - 3.585) / 0.22) ** 2));
      return 0.014 - 0.277 * ring * Math.sqrt(Math.max(0.03, 1 - (x / (0.254 * ring)) ** 2));
    };
    const fringeFront = (x: number) => 0.003 - 0.286 * Math.sqrt(Math.max(0.08, 1 - (x / 0.267) ** 2));
    const fringe = (rootX: number, upperX: number, emergeX: number, tipX: number, endY: number, width: number) => {
      const rootY = 3.742 - Math.abs(rootX) * 0.16;
      const upperY = 3.64 - Math.abs(upperX) * 0.04;
      lock([
        [rootX, rootY, crownFront(rootX, rootY) + 0.025],
        [upperX, upperY, crownFront(upperX, upperY) + 0.018],
        [emergeX, 3.573, fringeFront(emergeX)],
        [(emergeX + tipX) / 2, (3.57 + endY) / 2, fringeFront((emergeX + tipX) / 2) - 0.003],
        [tipX, endY, fringeFront(tipX) + 0.004],
      ], width, look.hair, 0.008);
    };
    // Several convex curved sweeps overlap, leaving a narrow eye gap instead of one flat triangular leaf.
    fringe(-0.065, -0.067, -0.035, 0.136, 3.365, 0.027);
    fringe(-0.018, 0.025, 0.085, 0.195, 3.425, 0.022);
    fringe(0.052, 0.105, 0.149, 0.216, 3.49, 0.019);
    fringe(0.13, 0.19, 0.225, 0.235, 3.38, 0.021);
    fringe(-0.10, -0.15, -0.19, -0.228, 3.35, 0.025);
    fringe(-0.125, -0.13, -0.10, -0.15, 3.47, 0.02);
    fringe(-0.16, -0.205, -0.24, -0.255, 3.425, 0.018);
    fringe(-0.015, -0.055, -0.085, -0.108, 3.47, 0.01);
    // Fine ends curve away from the larger sweeps, rather than forming an evenly spaced toothed edge.
    lock([[-0.09, 3.64, -0.207], [-0.06, 3.49, -0.286], [0.005, 3.399, -0.279], [0.061, 3.378, -0.264]], 0.0045, look.hair, 0.002);
    lock([[0.09, 3.65, -0.196], [0.14, 3.53, -0.256], [0.185, 3.43, -0.22], [0.205, 3.415, -0.2]], 0.005, look.hair, 0.0018);
    // Sparse warm light strands follow curved locks; the broad hair masses remain dark and coherent.
    const glint = new THREE.Color(look.hair).lerp(new THREE.Color("#d9cfaa"), 0.39).getStyle();
    for (const x of [-0.16, 0.105]) lock([
      [x * 0.65, 3.733, crownFront(x * 0.65, 3.733) - 0.001],
      [x * 0.85, 3.685, crownFront(x * 0.85, 3.685) - 0.001],
      [x, 3.645, crownFront(x, 3.645) - 0.001],
    ], 0.0009, glint, 0.0002);
    lock([[-0.045, 3.69, crownFront(-0.045, 3.69) - 0.004], [-0.047, 3.575, -0.291], [0.021, 3.447, -0.288], [0.104, 3.39, -0.266]], 0.0012, glint, 0.0002);
    lock([[0.16, 3.65, -0.199], [0.21, 3.54, -0.207], [0.224, 3.4, -0.175]], 0.0009, glint, 0.0002);
    const shag = (THREE.MathUtils.clamp(look.hairLength ?? 1, 1, 1.8) - 1) * 0.1;
    for (const side of [-1, 1]) {
      const uneven = side < 0 ? 0.027 : -0.012;
      // Only a short temple core stays continuous. Below the ear, overlapping tapered layers leave real openings.
      const cheek: [number, number, number, number, number][] = [
        [3.58, 0.212, -0.003, 0.033, 0.091], [3.49, 0.243, -0.015, 0.042, 0.1],
        [3.405, 0.252, -0.009, 0.046, 0.085], [3.345, 0.242, 0.008, 0.034, 0.061],
        [3.275 + uneven, 0.226, 0.051, 0.025, 0.047], [3.225 + uneven, 0.205, 0.081, 0.011, 0.025],
        [3.208 + uneven, 0.194, 0.098, 0.002, 0.004],
      ];
      builder.loft(cheek.map(([y, x, z, rx, rz]) => ({ at: hp(side * x, y, z), rx: rx * s, rz: rz * s, skin: [head] as Skin })), {
        segments: 14, garment: "hair", color: look.hair, capStart: true, capEnd: true,
      });
      if (side < 0) {
        lock([[-0.20, 3.64, -0.065], [-0.265, 3.53, -0.084], [-0.316, 3.503, -0.044], [-0.337, 3.523, -0.006]], 0.019, look.hair, 0.01);
        lock([[-0.23, 3.49, 0.004], [-0.258, 3.38, -0.051], [-0.239, 3.275, -0.082], [-0.272, 3.225, -0.026]], 0.026, look.hair, 0.017);
        lock([[-0.239, 3.43, 0.056], [-0.268, 3.29, 0.005], [-0.283, 3.212, 0.012], [-0.319, 3.226, 0.05]], 0.031, look.hair, 0.018, true);
        lock([[-0.21, 3.37, 0.121], [-0.249, 3.23, 0.085], [-0.271, 3.137 - shag, 0.092], [-0.289, 3.15 - shag, 0.134]], 0.033, look.hair, 0.019, true);
        lock([[-0.167, 3.37, 0.222], [-0.228, 3.255, 0.195], [-0.242, 3.185 - shag, 0.167], [-0.282, 3.153 - shag, 0.19]], 0.035, look.hair, 0.018, true);
        lock([[-0.22, 3.34, 0.066], [-0.249, 3.195, 0.033], [-0.231, 3.15, 0.042]], 0.011, look.hair, 0.007);
      } else {
        lock([[0.19, 3.64, -0.065], [0.252, 3.53, -0.084], [0.291, 3.475, -0.042]], 0.021, look.hair, 0.011);
        lock([[0.231, 3.47, 0.009], [0.266, 3.355, -0.044], [0.265, 3.292, -0.06], [0.301, 3.273, -0.004]], 0.025, look.hair, 0.017);
        lock([[0.224, 3.405, 0.069], [0.258, 3.26, 0.008], [0.273, 3.17, 0.035], [0.306, 3.176, 0.084]], 0.032, look.hair, 0.018, true);
        lock([[0.19, 3.36, 0.167], [0.24, 3.235, 0.126], [0.279, 3.17 - shag, 0.139]], 0.034, look.hair, 0.019, true);
        lock([[0.14, 3.395, 0.252], [0.198, 3.275, 0.226], [0.226, 3.205 - shag, 0.23], [0.268, 3.16 - shag, 0.266]], 0.036, look.hair, 0.018, true);
        lock([[0.237, 3.35, 0.06], [0.262, 3.23, 0.038], [0.288, 3.205, 0.071]], 0.01, look.hair, 0.007);
      }
      // A few fine flyaways lift beyond the mass, with different directions and lengths on each side.
      lock([[side * 0.179, 3.69, 0.04], [side * 0.278, 3.64, 0.003], [side * 0.309, 3.54 + uneven, -0.013], [side * 0.35, 3.55 + uneven, 0.014]], 0.0014, look.hair, 0.0003);
      lock([[side * 0.255, 3.37, 0.13], [side * 0.316, 3.28, 0.109], [side * 0.347, 3.29 + uneven, 0.135]], 0.0012, look.hair, 0.0003);
      lock([[side * 0.251, 3.27, 0.043], [side * 0.277, 3.17 - shag, 0.012], [side * 0.299, 3.143 - shag + uneven, 0.033]], 0.0009, glint, 0.0002);
    }
    // Unequal overlapping rear layers continue beyond the short backing, exposing staggered tapered tips at the nape.
    const napeLayers: [number, number, number, number, number, number][] = [
      [-0.185, -0.229, -0.29, 3.23, 0.041, 0.23], [-0.13, -0.18, -0.235, 3.135, 0.043, 0.274],
      [-0.068, -0.091, -0.166, 3.195, 0.042, 0.296], [0.008, -0.025, -0.041, 3.145, 0.047, 0.287],
      [0.071, 0.102, 0.175, 3.108, 0.044, 0.278], [0.132, 0.17, 0.235, 3.182, 0.041, 0.257],
      [0.18, 0.221, 0.285, 3.24, 0.037, 0.214],
    ];
    for (const [rootX, middleX, tipX, endY, width, z] of napeLayers) lock([
      [rootX, 3.47 - Math.abs(rootX) * 0.2, z - 0.07], [middleX, 3.32, z],
      [(middleX + tipX) * 0.5, endY + 0.067 - shag, z + 0.017], [tipX, endY - shag, z - 0.012],
    ], width, look.hair, 0.018, true);
    // The part is slightly off centre; a loose curved strand breaks its crown silhouette.
    lock([[-0.11, 3.755, 0.045], [-0.07, 3.795, 0.028], [0.025, 3.802, 0.019], [0.07, 3.782, 0.02]], 0.0012, look.hair, 0.0003);
  }
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
  if (look.face === "anime") {
    // Shorten only the drawing about its fixed crown: the approved skeleton, player height and gait stay intact.
    const crown = CHIN + HEAD_SPAN;
    for (let i = drawnHeadStart; i < builder.positions.length / 3; i += 1) {
      builder.positions[i * 3]! *= 0.93;
      builder.positions[i * 3 + 1] = crown + (builder.positions[i * 3 + 1]! - crown) * 0.86;
      builder.positions[i * 3 + 2]! *= 0.96;
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
    const centre = look.legs === "skirt" ? v(-0.5 * w * fit, 2.14, 0.12) : v(-0.5 * w * fit, 1.98, 0.12);
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
      builder.loft(path.map(([x, y, z, skin]) => ({ at: v(x, y, z * fit + Math.sign(z) * 0.012), rx: 0.058, rz: 0.022, skin })), {
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
  const armDrop = headDrop(size) * 0.55;
  const eyeY = look.face === "anime" ? 3.433 : look.face === "cute" ? 3.44 : 3.46;
  const eyePosition = v(0, CHIN + (eyeY - CHIN) * size - drop, -0.2 * size);
  if (look.face === "anime") {
    eyePosition.y = CHIN + HEAD_SPAN + (eyePosition.y - CHIN - HEAD_SPAN) * 0.86;
    eyePosition.z *= 0.96;
  }
  return {
    hips: v(0, BASE.hips, 0.02), spine: v(0, BASE.spine, 0.01), chest: v(0, BASE.chest, 0), neck: v(0, BASE.neck, 0.025), head: v(0, BASE.head - drop, 0.02),
    eyes: eyePosition, bag: v(-0.5 * w * (look.fit ?? 1), 2.15, 0.1),
    clavicleL: v(sx(-0.08), 2.92 - armDrop, 0.02), upperArmL: v(-sx(BASE.shoulder.x), BASE.shoulder.y - armDrop, 0.02),
    foreArmL: v(-(BASE.elbow.x * w + 0.02), BASE.elbow.y - armDrop, 0.04), handL: v(-(BASE.wrist.x * w + 0.03), BASE.wrist.y - armDrop, 0),
    clavicleR: v(sx(0.08), 2.92 - armDrop, 0.02), upperArmR: v(sx(BASE.shoulder.x), BASE.shoulder.y - armDrop, 0.02),
    foreArmR: v(BASE.elbow.x * w + 0.02, BASE.elbow.y - armDrop, 0.04), handR: v(BASE.wrist.x * w + 0.03, BASE.wrist.y - armDrop, 0),
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
    eyesRest: pick("eyes").position.clone(),
    expression: look.expression ?? "gentle",
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

/**
 * Apply AFTER poseFigure. A short, seeded blink and tiny gaze/head movements keep street portraits alive; the
 * pose reset owns the large motions. This helper never advances gait or changes a person's world placement.
 */
export function animateFigureExpression(figure: Figure, time: number, reduced: boolean, seed = 0): void {
  const t = Number.isFinite(time) ? time : 0;
  const eyes = figure.bones.eyes;
  eyes.position.copy(figure.eyesRest);
  if (reduced) return;
  const phase = ((t + seed * 0.719) % 4.4 + 4.4) % 4.4;
  const blink = Math.abs(phase - 3.2) < 0.085 ? Math.abs(phase - 3.2) / 0.085 : 1;
  eyes.scale.y = Math.min(eyes.scale.y, Math.max(0.08, blink));
  const lively = figure.expression === "bright" ? 1 : figure.expression === "calm" ? 0.45 : 0.7;
  eyes.position.x += Math.sin(t * 0.63 + seed) * 0.003 * lively;
  figure.bones.head.rotation.y += Math.sin(t * 0.47 + seed) * 0.025 * lively;
  figure.bones.head.rotation.z += Math.sin(t * 0.39 + seed * 1.3) * 0.009 * lively;
}

/** Dispose of a figure's geometry and bone texture (the material is shared and stays). */
export function disposeFigure(figure: Figure): void {
  figure.mesh.geometry.dispose();
  figure.mesh.skeleton.dispose();
}
