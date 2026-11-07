import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createIllustratedMaterial, type IllustratedMaterialOptions } from "@clockwork/render";
import { polarToXZ } from "./layout";

/**
 * Reusable geometry pieces for floating-island scenes: an illustrated palette, a per-material
 * batch that merges into one draw call each, placement helpers, and a few shared shapes.
 */

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

export type Swatch = Readonly<Omit<IllustratedMaterialOptions, "surfaceId">>;

// A London palette: stock and red brick, white stucco, Portland stone, Welsh slate, iron black, river green, plane-tree
// greens, with pillar-box red and gilt kept for accents. Most surfaces carry painted marks (see @clockwork/render
// patterns) that fade out with distance, so far views read as calm masses and street level shows the courses.
const SWATCHES = {
  ground: { color: "#7ea56c", shadow: "#4e7356", grain: 0.02, pattern: "grass", patternColor: "#a3c27f" },
  terrace: { color: "#8db57a", shadow: "#5d8063", pattern: "grass", patternColor: "#b2cf8c" },
  paving: { color: "#d7d0bd", shadow: "#9a9686", outline: 0.6, pattern: "flags", patternColor: "#aca592", patternStrength: 0.55 },
  stone: { color: "#e2dbc8", shadow: "#a8a493", pattern: "ashlar", patternColor: "#bab29c" },
  rock: { color: "#a3a594", shadow: "#646d65", grain: 0.04, pattern: "hatch", patternColor: "#3f4843" },
  strata: { color: "#8f7c60", shadow: "#56493a", pattern: "hatch", patternColor: "#3b3128" },
  water: { color: "#4f8783", shadow: "#2f5a59", outline: 0.35, pattern: "water", patternColor: "#cfe4da" },
  wall0: { color: "#ece6d5", shadow: "#ada99a" },
  wall1: { color: "#c39a68", shadow: "#7f6247", pattern: "brick", patternColor: "#e6d6b8", patternStrength: 0.75 },
  wall2: { color: "#a85a42", shadow: "#6a3a2d", pattern: "brick", patternColor: "#dcc8ad", patternStrength: 0.75 },
  roof0: { color: "#5e6b77", shadow: "#3a434c", pattern: "slate", patternColor: "#2c343b" },
  roof1: { color: "#4b555e", shadow: "#2e353b", pattern: "slate", patternColor: "#22292e" },
  roof2: { color: "#b4623f", shadow: "#743e2b", pattern: "slate", patternColor: "#7a3b27" },
  ink: { color: "#283036", shadow: "#161b1f" },
  trunk: { color: "#8a7d68", shadow: "#55503f", pattern: "bark", patternColor: "#5f5545" },
  // Canopies open a window when they hide the courier from the follow camera (see @clockwork/render seeThrough).
  leaf0: { color: "#4c8a5c", shadow: "#335f45", pattern: "leaves", patternColor: "#7fb27a", seeThrough: true },
  leaf1: { color: "#679e62", shadow: "#41694a", pattern: "leaves", patternColor: "#98c47f", seeThrough: true },
  leaf2: { color: "#8bb06a", shadow: "#56764f", pattern: "leaves", patternColor: "#b6d08a", seeThrough: true },
  brass: { color: "#dcae4a", shadow: "#8f6630" },
  copper: { color: "#c23f2f", shadow: "#76261d" },
  face: { color: "#f4eedd", shadow: "#c7c0aa", outline: 0.6 },
  cloud: { color: "#eef0e8", shadow: "#a9bab6", grain: 0.05 },
  smoke: { color: "#dcdfd4", shadow: "#a3afa9", grain: 0.05 },
  fieldA: { color: "#a9b56f", shadow: "#6d7a4c" },
  fieldB: { color: "#d3b264", shadow: "#8d7440" },
} as const satisfies Record<string, Swatch>;

export type SwatchKey = keyof typeof SWATCHES;
export type AccentKey = `accent${number}`;
export type MaterialKey<Extra extends string = never> = SwatchKey | AccentKey | Extra;
/**
 * Anything that hands out materials by key. `get` is a property (not a method) so the compiler checks it
 * contravariantly: a palette that was never `extend`ed with "stripe" cannot build a Batch<"stripe">.
 */
export type MaterialSource<Extra extends string = never> = { readonly get: (key: MaterialKey<Extra>) => THREE.ShaderMaterial };

const ACCENT_PREFIX = "accent";
const FALLBACK_ACCENT = "#c45f45";
const sameSwatch = (a: Swatch, b: Swatch) =>
  a.color === b.color && a.shadow === b.shadow && a.outline === b.outline && a.grain === b.grain
  && a.pattern === b.pattern && a.patternColor === b.patternColor && a.patternStrength === b.patternStrength
  && a.seeThrough === b.seeThrough;

/**
 * One illustrated material per key, created on first use. Each gets its own surface id so the
 * ink pass outlines where surfaces meet; ids follow creation order, so call order matters.
 */
export class Palette<Extra extends string = never> {
  private readonly materials = new Map<string, THREE.ShaderMaterial>();
  private readonly extra = new Map<string, Swatch>();
  private created = 0;

  /** `accent` maps the index in an `accentN` key to a colour; unresolved indices fall back to a warm red. */
  constructor(private readonly accent: (index: number) => string | undefined = () => undefined) {}

  /** A property, not a method, so `MaterialSource` assignability is checked contravariantly (see MaterialSource). */
  readonly get = (key: MaterialKey<Extra>): THREE.ShaderMaterial => {
    const cached = this.materials.get(key);
    if (cached) return cached;
    const swatch = this.swatchFor(key);
    const surfaceId = 0.05 + this.created * 0.027;
    if (surfaceId >= 1) throw new RangeError(`Palette is out of surface ids (${this.created} in use) at "${key}"; reuse an existing swatch`);
    // The town is lit by a sun fixed in the world, with cast shadows and fog (see CityScene and city/sun.ts).
    const material = createIllustratedMaterial({ ...swatch, surfaceId, lighting: "world" });
    this.created += 1;
    this.materials.set(key, material);
    return material;
  };

  /**
   * Registers more swatches on this palette and returns it with a wider key type. Creates no materials.
   * Re-registering an identical swatch is a no-op (safe for rebuilds); use the returned value for the wider type.
   */
  extend<More extends string>(swatches: Readonly<Record<More, Swatch>>): Palette<Extra | More> {
    const entries = Object.entries<Swatch>(swatches);
    for (const [key, swatch] of entries) {
      if (key.startsWith(ACCENT_PREFIX)) throw new Error(`Swatch "${key}" uses the reserved "${ACCENT_PREFIX}" prefix`);
      const existing = this.extra.get(key);
      if (Object.hasOwn(SWATCHES, key) || (existing && !sameSwatch(existing, swatch))) throw new Error(`Swatch "${key}" already exists`);
    }
    for (const [key, swatch] of entries) this.extra.set(key, swatch);
    return this as unknown as Palette<Extra | More>;
  }

  private swatchFor(key: string): Swatch {
    if (key.startsWith(ACCENT_PREFIX)) return { color: this.accent(Number(key.slice(ACCENT_PREFIX.length))) ?? FALLBACK_ACCENT };
    const swatch = this.extra.get(key) ?? (Object.hasOwn(SWATCHES, key) ? SWATCHES[key as SwatchKey] : undefined);
    if (!swatch) throw new Error(`Unknown material key "${key}"`);
    return swatch;
  }
}

export function normalize(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  for (const name of Object.keys(flat.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") flat.deleteAttribute(name);
  flat.clearGroups();
  return flat;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map(normalize);
  const merged = mergeGeometries(flat, false);
  flat.forEach((part) => part.dispose());
  if (!merged) throw new Error("Could not merge geometry (parts must share position, normal and uv)");
  return merged;
}

/** Collects static geometry per material and merges it into one draw call each. */
export class Batch<Extra extends string = never> {
  private readonly parts = new Map<MaterialKey<Extra>, THREE.BufferGeometry[]>();

  add(key: MaterialKey<Extra>, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4): void {
    const part = normalize(geometry);
    if (matrix) part.applyMatrix4(matrix);
    let list = this.parts.get(key);
    if (!list) { list = []; this.parts.set(key, list); }
    list.push(part);
  }

  build(palette: MaterialSource<Extra>, parent: THREE.Object3D): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [key, list] of this.parts) {
      const mesh = new THREE.Mesh(merge(list), palette.get(key));
      mesh.name = key;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.parts.clear();
    return meshes;
  }
}

export type Scale = readonly [number, number, number];

export function at(x: number, y: number, z: number, rotationY = 0, scale: Scale = [1, 1, 1]): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, rotationY), new THREE.Vector3(...scale));
}

/** A local frame at a bearing from the tower: +Z points away from the tower, +X runs along the street. */
export function frame(bearing: number, radius: number, y: number): THREE.Matrix4 {
  const { x, z } = polarToXZ(bearing, radius);
  return at(x, y, z, Math.PI - bearing);
}

export function local(base: THREE.Matrix4, x: number, y: number, z: number, rotationY = 0, scale?: Scale): THREE.Matrix4 {
  return base.clone().multiply(at(x, y, z, rotationY, scale));
}

/** Unit gable roof: 1 wide (Z), 1 long (X, the ridge), 1 tall, sitting on y = 0. */
function buildGableRoof(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0); shape.lineTo(0.5, 0); shape.lineTo(0, 1); shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5).rotateY(Math.PI / 2);
}
/** Unit square pyramid sitting on y = 0. */
function buildPyramidRoof(): THREE.BufferGeometry {
  return new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
}

const GABLE = buildGableRoof();
const PYRAMID = buildPyramidRoof();

/** A fresh copy of the unit gable roof; callers may transform or dispose it. */
export function gableRoof(): THREE.BufferGeometry { return GABLE.clone(); }
/** A fresh copy of the unit pyramid roof; callers may transform or dispose it. */
export function pyramidRoof(): THREE.BufferGeometry { return PYRAMID.clone(); }

/** A right-angled wedge in the XY plane, used for sails and the sundial's gnomon. */
export function wedge(width: number, height: number, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(width, 0); shape.lineTo(0, height); shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }).translate(0, 0, -thickness / 2);
}

export type GearOptions = { teeth: number; tooth: number; tube: number; thickness: number; spokes: number };
/** A gear in the XY plane turning about Z. `radius` reaches the tooth tips. */
export function gearGeometry(radius: number, options: GearOptions): THREE.BufferGeometry {
  const rim = radius - options.tooth;
  const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(rim, options.tube, 5, Math.max(16, options.teeth * 2))];
  for (let index = 0; index < options.teeth; index += 1) {
    parts.push(new THREE.BoxGeometry(options.tooth * 0.9, options.tooth * 1.25, options.thickness)
      .translate(0, rim + options.tooth * 0.55, 0).rotateZ(index / options.teeth * TAU));
  }
  for (let index = 0; index < options.spokes; index += 1) {
    parts.push(new THREE.BoxGeometry(Math.max(0.8, rim * 0.07), rim, options.thickness * 0.6).translate(0, rim / 2, 0).rotateZ(index / options.spokes * TAU));
  }
  if (options.spokes) parts.push(new THREE.CylinderGeometry(rim * 0.16, rim * 0.16, options.thickness * 1.4, 12).rotateX(Math.PI / 2));
  return merge(parts);
}

function hash(x: number, y: number, z: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * The craggy rock an island floats on. Jitter depends only on position, so seams stay closed.
 * The default depth is tall enough that its flanks stay visible from a camera well above the horizon.
 */
export function underside(radius: number, depth = 500): THREE.BufferGeometry {
  const centre = -(18 + depth / 2);
  const bottom = -(18 + depth);
  const cone = new THREE.ConeGeometry(radius - 14, depth, 28, 6, true).rotateX(Math.PI).translate(0, centre, 0);
  const position = cone.getAttribute("position");
  const vertex = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    if (vertex.y > -19 || vertex.y < bottom + 8) continue;
    const noise = hash(Math.round(vertex.x), Math.round(vertex.y), Math.round(vertex.z));
    const scale = 0.9 + noise * 0.2;
    position.setXYZ(index, vertex.x * scale, vertex.y + (noise - 0.5) * 14, vertex.z * scale);
  }
  const flat = cone.toNonIndexed();
  cone.dispose();
  flat.computeVertexNormals();
  return flat;
}

export type HouseSpec = {
  r: number; theta: number; y: number;
  width: number; depth: number; height: number;
  roof: "gable" | "pyramid"; wall: 0 | 1 | 2; roofColor: 0 | 1 | 2; chimney: boolean;
};
export type TreeSpec = { x: number; y: number; z: number; height: number; round: boolean; shade: 0 | 1 | 2 };

/** Chimney pots stand this tall on top of a stack (smoke rises from their tops). */
export const CHIMNEY_POT_HEIGHT = 0.9;

/**
 * A London terraced house: brick or white stucco walls (brick houses get a stucco ground floor), a stone cornice,
 * white-framed sash windows with glazing bars and stone sills, a black door in a white case with a fanlight, a stone
 * step, black area railings in front (gap at the door), a slate or tile roof, and a brick chimney stack with two pots.
 * Local frame: +Z faces out from the tower (the street front), +X runs along the street.
 */
export function addHouse(batch: Pick<Batch, "add">, house: Readonly<HouseSpec>): void {
  const base = frame(house.theta, house.r, house.y);
  const { width, depth, height } = house;
  const wall: SwatchKey = `wall${house.wall}`;
  batch.add(wall, new THREE.BoxGeometry(width, height, depth), local(base, 0, height / 2, 0));
  const roofHeight = Math.min(7, Math.max(4.5, depth * 0.55));
  if (house.roof === "gable") batch.add(`roof${house.roofColor}`, gableRoof(), local(base, 0, height, 0, 0, [width + 1.2, roofHeight, depth + 1.4]));
  else batch.add(`roof${house.roofColor}`, pyramidRoof(), local(base, 0, height, 0, 0, [width + 1, roofHeight * 1.15, depth + 1]));
  // A stone cornice where the walls meet the roof.
  batch.add("stone", new THREE.BoxGeometry(width + 0.5, 0.55, depth + 0.5), local(base, 0, height - 0.28, 0));

  const front = depth / 2 + 0.15;
  // Brick houses wear a white stucco ground floor, as so many London terraces do.
  if (house.wall !== 0) batch.add("wall0", new THREE.BoxGeometry(width + 0.08, 4.4, 0.3), local(base, 0, 2.2, depth / 2 + 0.08));

  // The front door: black, in a white case with pilasters and a fanlight, up a stone step.
  batch.add("ink", new THREE.BoxGeometry(2.2, 3.6, 0.4), local(base, 0, 1.8, front));
  batch.add("face", new THREE.BoxGeometry(2.2, 0.7, 0.3), local(base, 0, 3.95, front + 0.05));
  for (const x of [-1.35, 1.35]) batch.add("face", new THREE.BoxGeometry(0.42, 4.5, 0.45), local(base, x, 2.25, front + 0.06));
  batch.add("face", new THREE.BoxGeometry(3.3, 0.35, 0.55), local(base, 0, 4.45, front + 0.06));
  batch.add("stone", new THREE.BoxGeometry(3.4, 0.45, 1.3), local(base, 0, 0.22, front + 0.55));

  // Sash windows: dark glass in a white frame, a glazing-bar cross and a stone sill.
  const sash = (x: number, y: number) => {
    batch.add("face", new THREE.BoxGeometry(2.3, 2.9, 0.3), local(base, x, y, front - 0.02));
    batch.add("ink", new THREE.BoxGeometry(1.8, 2.4, 0.4), local(base, x, y, front + 0.02));
    batch.add("face", new THREE.BoxGeometry(0.14, 2.4, 0.5), local(base, x, y, front + 0.05));
    batch.add("face", new THREE.BoxGeometry(1.8, 0.14, 0.5), local(base, x, y + 0.15, front + 0.05));
    batch.add("stone", new THREE.BoxGeometry(2.5, 0.28, 0.6), local(base, x, y - 1.5, front + 0.2));
  };
  const side = width / 2 - 1.9;
  for (const x of [-side, side]) sash(x, 3.2);
  for (let floor = 1; 3.2 + floor * 6 < height - 2; floor += 1) {
    for (const x of [-width / 4, width / 4]) sash(x, 3.2 + floor * 6);
  }

  // Black area railings just in front of the house, with a gap for the door.
  const railZ = depth / 2 + 1.05;
  for (let x = -width / 2 + 0.3; x <= width / 2 - 0.3; x += 1.15) {
    if (Math.abs(x) < 1.9) continue;
    batch.add("ink", new THREE.BoxGeometry(0.13, 1.3, 0.13), local(base, x, 0.65, railZ));
  }
  for (const sign of [-1, 1]) {
    const length = width / 2 - 1.9;
    batch.add("ink", new THREE.BoxGeometry(length, 0.12, 0.12), local(base, sign * (1.9 + length / 2), 1.25, railZ));
  }

  // A brick chimney stack (contrasting brick on brick houses) with two clay pots.
  if (house.chimney) {
    const stack: SwatchKey = house.wall === 2 ? "wall1" : "wall2";
    const stackHeight = roofHeight + 1.5;
    const top = height + roofHeight / 2 + 0.6 + stackHeight / 2;
    batch.add(stack, new THREE.BoxGeometry(1.6, stackHeight, 1.6), local(base, width / 4, top - stackHeight / 2, -depth / 5));
    for (const x of [-0.4, 0.4]) {
      batch.add("roof2", new THREE.CylinderGeometry(0.26, 0.32, CHIMNEY_POT_HEIGHT, 8), local(base, width / 4 + x, top + CHIMNEY_POT_HEIGHT / 2, -depth / 5));
    }
  }
}

/** Where a round tree's canopy lobes sit around the main one, in units of its radius: [x, y, z, size]. */
const CANOPY_LOBES = [
  [0.62, -0.15, 0, 0.68], [-0.45, -0.25, 0.5, 0.64], [-0.3, -0.05, -0.62, 0.66], [0.1, 0.62, -0.05, 0.6],
] as const;
/** A fir's stacked cones, bottom to top: [width, height, base] as fractions of the tree's height. */
const FIR_TIERS = [[0.34, 0.5, 0.18], [0.27, 0.42, 0.42], [0.19, 0.36, 0.64]] as const;

export function addTree(batch: Pick<Batch, "add">, tree: Readonly<TreeSpec>): void {
  const base = at(tree.x, tree.y, tree.z, (tree.x * 0.37 + tree.z * 0.11) % TAU);
  batch.add("trunk", new THREE.CylinderGeometry(0.7, 1.3, 5.5, 6), local(base, 0, 2.75, 0));
  const leaf: SwatchKey = `leaf${tree.shade}`;
  if (tree.round) {
    // A clustered canopy (a big lobe and four smaller ones) reads as leaves rather than one cut gem.
    const radius = tree.height * 0.3;
    const centre = 4 + tree.height * 0.3;
    batch.add(leaf, new THREE.IcosahedronGeometry(radius, 1), local(base, 0, centre, 0));
    for (const [x, y, z, size] of CANOPY_LOBES) {
      batch.add(leaf, new THREE.IcosahedronGeometry(radius * size, 0), local(base, x * radius, centre + y * radius, z * radius));
    }
  } else {
    // A layered fir: three stacked cones, each narrower.
    for (const [width, height, bottom] of FIR_TIERS) {
      const h = tree.height * height;
      batch.add(leaf, new THREE.ConeGeometry(tree.height * width, h, 7), local(base, 0, 3 + tree.height * bottom + h / 2, 0));
    }
  }
}

/**
 * Flat or hidden surfaces that only catch shadows: casting them would redraw the island's ground and underside in
 * the shadow pass for nothing.
 */
export const RECEIVE_ONLY: ReadonlySet<string> = new Set(["ground", "terrace", "paving", "water", "strata", "rock", "cloud", "smoke"]);

/** Every mesh under `root` receives the sun's shadows; all but the `receiveOnly` ones (by mesh name) cast them too. */
export function enableShadows(root: THREE.Object3D, receiveOnly: ReadonlySet<string> = RECEIVE_ONLY): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = !receiveOnly.has(object.name);
    object.receiveShadow = true;
  });
}
