import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
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
// greens, with pillar-box red and gilt kept for accents. Swatches give the lit colour only: the colour in shade follows
// from it by rule (@clockwork/render shadeOf: same hue a touch warmer, same saturation, half the value), so every
// surface shades the same way and shade stays coloured. Most surfaces carry painted marks (see @clockwork/render
// patterns) that fade out with distance, so far views read as calm masses and street level shows the courses. Worn
// stucco, light grass and plane bark ink their own painted patches, as an illustrator outlines a chipped wall.
/** The town's default painted value patches (see Palette.get); the illustrated material's own default is 0.035. */
const TOWN_GRAIN = 0.015;

const SWATCHES = {
  road: { color: "#7c9991", outline: 0.4, grain: 0.015, pattern: "tarmac", patternStrength: 0.8 },
  // Road paint carries no ink: lines and letters on a street are paint, not objects.
  paint: { color: "#e2e6dc", outline: 0, grain: 0 },
  paintYellow: { color: "#d5b247", outline: 0, grain: 0 },
  sea: { color: "#62aaa6", outline: 0.1, grain: 0.015, pattern: "water", patternColor: "#b2d9cd", patternStrength: 0.24 },
  ground: { color: "#6d9d61", grain: 0.025, pattern: "grass", patternColor: "#98bf7c" },
  terrace: { color: "#8db57a", pattern: "grass", patternColor: "#b2cf8c" },
  paving: { color: "#c7d2c0", outline: 0.6, grain: 0.015, pattern: "flags", patternColor: "#98a093", patternStrength: 0.55 },
  stone: { color: "#cdd4c4", outline: 0.6, pattern: "ashlar", patternColor: "#acad9e" },
  rock: { color: "#a3a594", grain: 0.04, pattern: "hatch", patternColor: "#3f4843" },
  strata: { color: "#8f7c60", pattern: "hatch", patternColor: "#3b3128" },
  water: { color: "#4f8884", outline: 0.35, pattern: "water", patternColor: "#cfe4da" },
  skin: { color: "#dfb59b", grain: 0.012, outline: 0.65 },
  coat: { color: "#8c4353", grain: 0.025, outline: 0.8 },
  leather: { color: "#8f5a3e", grain: 0.025 },
  /** White stucco with weathered patches a few tones darker (damp and grime), inked as the reference inks its stains. */
  wall0: { color: "#d5ded1", pattern: "render", patternColor: "#b9c2b5", patternStrength: 0.95, inkPatches: true },
  wall1: { color: "#c9b080", pattern: "brick", patternColor: "#ddd2b6", patternStrength: 0.5 },
  wall2: { color: "#ad6f5a", pattern: "brick", patternColor: "#cfbba0", patternStrength: 0.48 },
  roof0: { color: "#5f6c78", pattern: "slate", patternColor: "#2c343b" },
  roof1: { color: "#4c5660", pattern: "slate", patternColor: "#22292e" },
  roof2: { color: "#b4623f", pattern: "slate", patternColor: "#7a3b27" },
  // Black-painted iron (railings, lamps, downpipes, cab bodies), as a dark charcoal slate rather than ink-black: the
  // reference keeps its metal well above its darkest lines.
  ink: { color: "#3a434c" },
  // Window glass: a dark slate that still catches the sky, as the reference's panes do (about 50–70 of 255), so
  // terraces of sash windows read as glass rather than holes of ink.
  glass: { color: "#53676f", outline: 0.25 },
  // Street metal (lamp posts, railings, bins, bollards, posts) in the reference's own pole tone, a mid-dark green grey
  // (its poles read about (80–90, 95–106, 88–99)), rather than near-black.
  iron: { color: "#55645c" },
  trunk: { color: "#7d765c", pattern: "camo", patternColor: "#d0c8a3", patternStrength: 0.85, inkPatches: true },
  // Solid foliage: a sight-line cutout also erased intersecting hedges/props that share these materials.
  // The camera avoids scenery through its collision world rather than deleting visible fragments.
  leaf0: { color: "#4d8b62", pattern: "leaves", patternColor: "#7fb27a" },
  leaf1: { color: "#679f66", pattern: "leaves", patternColor: "#98c47f" },
  leaf2: { color: "#8ab26c", pattern: "leaves", patternColor: "#b6d08a" },
  // Grass tufts: thin blades would drown in ink, so they are drawn as colour alone.
  tuft: { color: "#80ad6c", outline: 0, grain: 0 },
  brass: { color: "#dcae4a" },
  copper: { color: "#c43e2f" },
  face: { color: "#e7efe2", outline: 0.4 },
  cloud: { color: "#eef0e8", grain: 0.05 },
  smoke: { color: "#dcdfd4", grain: 0.05 },
  /**
   * Dust kicked up by feet: one flat mid grey, as the reference's own footstep particles (#7c7c7c, drawn unlit), not a
   * white cloud; the same colour in shade, so a puff never shows two tones.
   */
  dust: { color: "#747a72", shadow: "#747a72", grain: 0 },
  fieldA: { color: "#a9b56f" },
  fieldB: { color: "#d3b264" },
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
  && a.seeThrough === b.seeThrough && a.inkPatches === b.inkPatches && a.vertexColors === b.vertexColors && a.character === b.character;

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
    // The town is lit by a sun fixed in the world, with cast shadows and fog (see CityScene and city/sun.ts). Its
    // painted value patches are gentle (TOWN_GRAIN unless a swatch says otherwise), so surfaces read as the
    // reference's flat fills rather than mottled ones.
    const material = createIllustratedMaterial({ grain: TOWN_GRAIN, ...swatch, surfaceId, lighting: "world" });
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
  /** Authored city plots use an independent position and frontage orientation; older island houses remain polar. */
  x?: number; z?: number; rotation?: number;
  width: number; depth: number; height: number;
  roof: "gable" | "pyramid"; wall: 0 | 1 | 2; roofColor: 0 | 1 | 2; chimney: boolean;
};

export function houseFrame(house: Readonly<HouseSpec>): THREE.Matrix4 {
  if (house.x !== undefined && house.z !== undefined && house.rotation !== undefined) return at(house.x, house.y, house.z, house.rotation);
  return frame(house.theta, house.r, house.y);
}
export type TreeSpec = { x: number; y: number; z: number; height: number; round: boolean; shade: 0 | 1 | 2 };

/** Chimney pots stand this tall on top of a stack (smoke rises from their tops). */
export const CHIMNEY_POT_HEIGHT = 0.9;

/**
 * A London terraced house: brick or white stucco walls (brick houses get a stucco ground floor), a stone cornice,
 * white-framed sash windows with glazing bars and stone sills, a black door in a white case with a fanlight, a stone
 * step, iron area railings in front (gap at the door), a slate or tile roof, and a brick chimney stack with two pots.
 * Local frame: +Z faces out from the tower (the street front), +X runs along the street.
 */
export function addHouse(batch: Pick<Batch, "add">, house: Readonly<HouseSpec>): void {
  const base = houseFrame(house);
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

  // The front door, painted as London's are (black for some, oxblood, slate blue or brown for others; swatches the
  // town already draws with), in a white case with pilasters and a fanlight, up a stone step.
  const DOORS: readonly SwatchKey[] = ["ink", "ink", "coat", "glass", "leather"];
  const door = DOORS[Math.floor(seededSequence(Math.round((house.x ?? house.r) * 13.1 + (house.z ?? house.theta * 100) * 7.7) ^ 0xd0)() * DOORS.length)]!;
  batch.add(door, new THREE.BoxGeometry(2.2, 3.6, 0.4), local(base, 0, 1.8, front));
  batch.add("face", new THREE.BoxGeometry(2.2, 0.7, 0.3), local(base, 0, 3.95, front + 0.05));
  for (const x of [-1.35, 1.35]) batch.add("face", new THREE.BoxGeometry(0.42, 4.5, 0.45), local(base, x, 2.25, front + 0.06));
  batch.add("face", new THREE.BoxGeometry(3.3, 0.35, 0.55), local(base, 0, 4.45, front + 0.06));
  batch.add("stone", new THREE.BoxGeometry(3.4, 0.45, 1.3), local(base, 0, 0.22, front + 0.55));

  // Each house is furnished a little differently (blinds, curtains, window boxes, bins), the same on every rebuild.
  const random = seededSequence(Math.round((house.x ?? house.r) * 31.7 + (house.z ?? house.theta * 100) * 17.3) ^ 0x4a11);
  // Only swatches the town already draws with, so furnishing costs no new materials or surface ids.
  const BLINDS: readonly SwatchKey[] = ["face", "face", "face", "stone", "paving", "brass"];
  const CURTAINS: readonly SwatchKey[] = ["copper", "leaf0", "roof0"];

  // Sash windows: dark glass in a white frame, a glazing-bar cross and a stone sill. Behind the glass most rooms show
  // a blind drawn part way down or a curtain at one side, so the windows read as lived-in rooms, not holes.
  const sash = (x: number, y: number, facade = base, paneZ = front) => {
    batch.add("face", new THREE.BoxGeometry(2.3, 2.9, 0.3), local(facade, x, y, paneZ - 0.02));
    batch.add("glass", new THREE.BoxGeometry(1.8, 2.4, 0.4), local(facade, x, y, paneZ + 0.02));
    const room = random();
    if (room < 0.55) {
      const drop = 0.5 + random() * 1.3;
      batch.add(BLINDS[Math.floor(random() * BLINDS.length)]!, new THREE.PlaneGeometry(1.7, drop), local(facade, x, y + 1.2 - drop / 2, paneZ + 0.235));
    } else if (room < 0.8) {
      const side = random() < 0.5 ? -1 : 1;
      batch.add(CURTAINS[Math.floor(random() * CURTAINS.length)]!, new THREE.PlaneGeometry(0.55, 2.3), local(facade, x + side * 0.6, y, paneZ + 0.235));
    }
    batch.add("face", new THREE.BoxGeometry(0.14, 2.4, 0.5), local(facade, x, y, paneZ + 0.05));
    batch.add("face", new THREE.BoxGeometry(1.8, 0.14, 0.5), local(facade, x, y + 0.15, paneZ + 0.05));
    batch.add("stone", new THREE.BoxGeometry(2.5, 0.28, 0.6), local(facade, x, y - 1.5, paneZ + 0.2));
  };
  // A window box of flowers under a first-floor front window.
  const windowBox = (x: number, y: number) => {
    batch.add("trunk", new THREE.BoxGeometry(2.1, 0.42, 0.55), local(base, x, y - 1.15, front + 0.55));
    for (let i = 0; i < 4; i += 1) {
      const bloom: SwatchKey = (["copper", "brass", "face", "copper"] as const)[(i + Math.floor(random() * 4)) % 4]!;
      batch.add("leaf1", new THREE.IcosahedronGeometry(0.3, 0), local(base, x - 0.75 + i * 0.5, y - 0.82, front + 0.6));
      batch.add(bloom, new THREE.IcosahedronGeometry(0.14, 0), local(base, x - 0.7 + i * 0.5, y - 0.6, front + 0.72));
    }
  };
  const side = width / 2 - 1.9;
  for (const x of [-side, side]) sash(x, 3.2);
  for (let floor = 1; 3.2 + floor * 6 < height - 2; floor += 1) {
    for (const x of [-width / 4, width / 4]) {
      sash(x, 3.2 + floor * 6);
      if (floor === 1 && random() < 0.3) windowBox(x, 3.2 + floor * 6);
    }
    // A stone string course marks each floor on brick fronts.
    if (house.wall !== 0) batch.add("stone", new THREE.BoxGeometry(width + 0.1, 0.24, 0.14), local(base, 0, floor * 6 + 0.2, depth / 2 + 0.07));
  }
  // A downpipe from the eaves to the pavement at one end of the front, painted a slate grey as so many are.
  const pipeX = (random() < 0.5 ? -1 : 1) * (width / 2 - 0.35);
  batch.add("glass", new THREE.CylinderGeometry(0.11, 0.11, height - 0.6, 6), local(base, pipeX, (height - 0.6) / 2, depth / 2 + 0.13));
  batch.add("glass", new THREE.BoxGeometry(0.42, 0.4, 0.34), local(base, pipeX, height - 0.75, depth / 2 + 0.16));

  // The courier sees backs and ends as often as fronts: no blank stage-set walls when
  // descending from Westminster or turning into a side lane.
  const rear = local(base, 0, 0, 0, Math.PI);
  for (let y = 3.2; y < height - 2; y += 6) {
    for (const x of [-width / 4, width / 4]) sash(x, y, rear);
    for (const turn of [-Math.PI / 2, Math.PI / 2]) sash(0, y, local(base, 0, 0, 0, turn), width / 2 + 0.15);
  }

  // A wheelie bin waits in the front area of some houses, away from the door.
  if (random() < 0.45) {
    const binX = (random() < 0.5 ? -1 : 1) * Math.min(width / 2 - 1, 2.9 + random() * 0.6);
    const lid: SwatchKey = random() < 0.6 ? "ink" : "leaf0";
    batch.add(lid, new THREE.BoxGeometry(0.9, 1.45, 0.78), local(base, binX, 0.73, depth / 2 + 0.62));
    batch.add(lid, new THREE.BoxGeometry(0.98, 0.1, 0.86), local(base, binX, 1.5, depth / 2 + 0.62));
  }

  // Iron area railings just in front of the house, with a gap for the door.
  const railZ = depth / 2 + 1.05;
  for (let x = -width / 2 + 0.3; x <= width / 2 - 0.3; x += 1.15) {
    if (Math.abs(x) < 1.9) continue;
    batch.add("iron", new THREE.BoxGeometry(0.13, 1.3, 0.13), local(base, x, 0.65, railZ));
  }
  for (const sign of [-1, 1]) {
    const length = width / 2 - 1.9;
    batch.add("iron", new THREE.BoxGeometry(length, 0.12, 0.12), local(base, sign * (1.9 + length / 2), 1.25, railZ));
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

/** A fir's stacked cones, bottom to top: [width, height, base] as fractions of the tree's height. */
const FIR_TIERS = [[0.34, 0.5, 0.18], [0.27, 0.42, 0.42], [0.19, 0.36, 0.64]] as const;

/** A small deterministic random sequence (mulberry32), so every rebuild grows the same tree in the same place. */
export function seededSequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One clump of leaves: a sphere pushed into broad lumps, with a flatter underside and smooth normals, so the light
 * turns across it in a soft band and the ink pass outlines it where it overlaps its neighbours.
 */
export function leafClump(radius: number, seed: number, detail = 1): THREE.BufferGeometry {
  const sphere = new THREE.IcosahedronGeometry(1, detail);
  sphere.deleteAttribute("normal");
  sphere.deleteAttribute("uv");
  const geometry = mergeVertices(sphere);
  sphere.dispose();
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const lump = 1 + 0.11 * Math.sin(x * 3.1 + seed) * Math.sin(y * 2.7 + seed * 1.7) + 0.06 * Math.sin(z * 5.3 + x * 2.1 + seed * 0.7);
    position.setXYZ(i, x * radius * lump, y * radius * lump * (y < 0 ? 0.8 : 1), z * radius * lump);
  }
  geometry.computeVertexNormals();
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(position.count * 2), 2));
  return geometry;
}

/** A tapered limb from `from` to `to` (local coordinates), thick at the start. */
function limb(from: THREE.Vector3, to: THREE.Vector3, startRadius: number, endRadius: number): THREE.BufferGeometry {
  const direction = to.clone().sub(from);
  const length = direction.length();
  return new THREE.CylinderGeometry(endRadius, startRadius, length, 7, 1)
    .translate(0, length / 2, 0)
    .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()))
    .translate(from.x, from.y, from.z);
}

/**
 * Where a London plane's parts sit (above its base): a clear trunk to `trunkTop`, then a crown of leaf clumps round
 * `centre` (horizontal extent `radius`, vertical half-extent `halfHeight`, both with a margin). The crown is carried
 * high, as street planes are pruned, so people and a street-level camera pass under it. The geometry (addPlaneTree)
 * and the camera's occluders (courier/cameraWorld) both use this, so they always agree.
 */
export function planeTreeCrown(height: number): { trunkTop: number; centre: number; radius: number; halfHeight: number } {
  const crown = height * 0.3;
  const trunkTop = 6.6 + height * 0.08;
  const middle = trunkTop + crown * 0.62;
  return { trunkTop, centre: middle + crown * 0.175, radius: crown * 1.2 + 0.4, halfHeight: crown * 0.875 + 0.4 };
}

/**
 * A London plane: a tall, slightly leaning trunk with a root flare and dappled bark, three limbs forking into the
 * crown, and a crown of about a dozen lumpy leaf clumps around a core. Everything stays inside the camera's crown and
 * trunk column for the same tree (planeTreeCrown) and the walking trunk circle.
 */
function addPlaneTree(batch: Pick<Batch, "add">, tree: Readonly<TreeSpec>, base: THREE.Matrix4): void {
  const random = seededSequence(Math.round(tree.x * 73.13 + tree.z * 19.79) ^ 0x5eed);
  const radius = tree.height * 0.3;
  const { trunkTop } = planeTreeCrown(tree.height);
  const centre = trunkTop + radius * 0.62;
  const lean = local(base, 0, 0, 0, 0);
  lean.multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(random() - 0.5, 0, random() - 0.5).normalize(), 0.035));
  batch.add("trunk", new THREE.CylinderGeometry(0.56, 0.9, trunkTop - 0.4, 10, 3).translate(0, (trunkTop - 0.4) / 2 + 0.4, 0), lean);
  batch.add("trunk", new THREE.CylinderGeometry(0.9, 1.3, 0.6, 10).translate(0, 0.3, 0), lean);
  const fork = new THREE.Vector3(0, trunkTop - 0.3, 0);
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * TAU + random() * 0.9;
    const reach = radius * (0.38 + random() * 0.12);
    const tip = new THREE.Vector3(Math.cos(angle) * reach, centre - radius * (0.12 + random() * 0.15), Math.sin(angle) * reach);
    batch.add("trunk", limb(fork, tip, 0.46, 0.2), lean);
  }
  const leaf: SwatchKey = `leaf${tree.shade}`;
  batch.add(leaf, leafClump(radius * 0.7, random() * 10, 2), local(base, 0, centre - radius * 0.05, 0));
  const clumps = 11 + Math.floor(random() * 4);
  for (let i = 0; i < clumps; i += 1) {
    // A golden-angle spiral from the crown's top down to just below its middle, with a little jitter.
    const y = 1 - 1.5 * ((i + 0.5) / clumps);
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = i * 2.39996 + random() * 0.4;
    const distance = radius * (0.5 + random() * 0.1);
    const size = radius * (0.38 + random() * 0.12);
    batch.add(leaf, leafClump(size, random() * 10), local(base, Math.cos(angle) * ring * distance, centre + y * distance * 0.78, Math.sin(angle) * ring * distance));
  }
}

export function addTree(batch: Pick<Batch, "add">, tree: Readonly<TreeSpec>): void {
  const base = at(tree.x, tree.y, tree.z, (tree.x * 0.37 + tree.z * 0.11) % TAU);
  if (tree.round) {
    addPlaneTree(batch, tree, base);
    return;
  }
  // A layered fir: a trunk and three stacked cones, each narrower.
  batch.add("trunk", new THREE.CylinderGeometry(0.7, 1.3, 5.5, 6), local(base, 0, 2.75, 0));
  const leaf: SwatchKey = `leaf${tree.shade}`;
  for (const [width, height, bottom] of FIR_TIERS) {
    const h = tree.height * height;
    batch.add(leaf, new THREE.ConeGeometry(tree.height * width, h, 7), local(base, 0, 3 + tree.height * bottom + h / 2, 0));
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
