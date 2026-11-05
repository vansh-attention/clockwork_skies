import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SeededRandom } from "@clockwork/shared";
import { createIllustratedMaterial } from "@clockwork/render";
import { DISTRICTS, type DistrictKind } from "./districts";
import { CANAL, ISLAND_RADIUS, STREET, SUMMIT, TERRACES, createCityLayout, polarToXZ, type CityLayout, type House, type Landmark, type Tree } from "./layout";

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

// The game's existing illustration palette, plus canal water and two field colours.
const SWATCHES = {
  ground: { color: "#6f9b88", shadow: "#385f58", grain: 0.025 },
  terrace: { color: "#91ad86", shadow: "#637a62" },
  paving: { color: "#e3dcc4", shadow: "#a39f8a", outline: 0.6 },
  stone: { color: "#b8b797", shadow: "#81927b" },
  rock: { color: "#93a08c", shadow: "#5d6e64", grain: 0.05 },
  strata: { color: "#8a7a5f", shadow: "#4f4a3c" },
  water: { color: "#5f9fa6", shadow: "#3c6f73", outline: 0.35 },
  wall0: { color: "#eee9d6", shadow: "#a4ac9c" },
  wall1: { color: "#e9e2cf", shadow: "#9e9a8a" },
  wall2: { color: "#d9ddc7", shadow: "#8f9588" },
  roof0: { color: "#bd6445", shadow: "#754e42" },
  roof1: { color: "#d19b5a", shadow: "#7f5b3d" },
  roof2: { color: "#c66a47", shadow: "#713e36" },
  ink: { color: "#384946", shadow: "#202b2a" },
  trunk: { color: "#826f54", shadow: "#4b4e42" },
  leaf0: { color: "#43845b", shadow: "#416a51" },
  leaf1: { color: "#5d9967", shadow: "#416a51" },
  leaf2: { color: "#86a96b", shadow: "#4f6e52" },
  brass: { color: "#dfaa45", shadow: "#8f6430" },
  copper: { color: "#b65538", shadow: "#6a3428" },
  face: { color: "#f4eedc", shadow: "#c9c2aa", outline: 0.6 },
  cloud: { color: "#e7e8db", shadow: "#9fb2ab", grain: 0.05 },
  smoke: { color: "#dcdfd4", shadow: "#a3afa9", grain: 0.05 },
  fieldA: { color: "#a9b56f", shadow: "#6d7a4c" },
  fieldB: { color: "#d3b264", shadow: "#8d7440" },
} as const;
type SwatchKey = keyof typeof SWATCHES;
type MaterialKey = SwatchKey | `accent${number}`;

export type Spinner = { object: THREE.Object3D; axis: "x" | "y" | "z"; step: number };
export type ClockFace = { center: THREE.Vector3; normal: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 };
export type BuiltCity = {
  group: THREE.Group;
  /** Static surfaces a click can land on; clouds and chimney smoke are left out. */
  pickables: THREE.Mesh[];
  hands: THREE.Mesh;
  faces: ClockFace[];
  /** Everything that advances one tick per second. */
  spinners: Spinner[];
  anchor: THREE.Object3D;
  clouds: THREE.Object3D;
  /** One ground point per district, in DISTRICTS order. */
  focusPoints: THREE.Vector3[];
};

/** One illustrated material per key. Each gets its own surface id so the ink pass outlines where surfaces meet. */
class Palette {
  private readonly materials = new Map<MaterialKey, THREE.ShaderMaterial>();

  get(key: MaterialKey): THREE.ShaderMaterial {
    let material = this.materials.get(key);
    if (!material) {
      const swatch = key.startsWith("accent")
        ? { color: DISTRICTS[Number(key.slice("accent".length))]?.accent ?? "#c45f45" }
        : SWATCHES[key as SwatchKey];
      material = createIllustratedMaterial({ ...swatch, surfaceId: 0.05 + this.materials.size * 0.027 });
      this.materials.set(key, material);
    }
    return material;
  }
}

function normalize(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  for (const name of Object.keys(flat.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") flat.deleteAttribute(name);
  flat.clearGroups();
  return flat;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map(normalize);
  const merged = mergeGeometries(flat, false);
  flat.forEach((part) => part.dispose());
  if (!merged) throw new Error("Could not merge city geometry");
  return merged;
}

/** Collects static geometry per material and merges it into one draw call each. */
class Batch {
  private readonly parts = new Map<MaterialKey, THREE.BufferGeometry[]>();

  add(key: MaterialKey, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4) {
    const part = normalize(geometry);
    if (matrix) part.applyMatrix4(matrix);
    let list = this.parts.get(key);
    if (!list) { list = []; this.parts.set(key, list); }
    list.push(part);
  }

  build(palette: Palette, parent: THREE.Object3D): THREE.Mesh[] {
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

type Scale = readonly [number, number, number];
function at(x: number, y: number, z: number, rotationY = 0, scale: Scale = [1, 1, 1]): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, rotationY), new THREE.Vector3(...scale));
}
/** A local frame at a bearing from the tower: +Z points away from the tower, +X runs along the street. */
function frame(bearing: number, radius: number, y: number): THREE.Matrix4 {
  const { x, z } = polarToXZ(bearing, radius);
  return at(x, y, z, Math.PI - bearing);
}
function local(base: THREE.Matrix4, x: number, y: number, z: number, rotationY = 0, scale?: Scale): THREE.Matrix4 {
  return base.clone().multiply(at(x, y, z, rotationY, scale));
}

/** Unit gable roof: 1 wide (Z), 1 long (X, the ridge), 1 tall, sitting on y = 0. */
function gableRoof(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0); shape.lineTo(0.5, 0); shape.lineTo(0, 1); shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5).rotateY(Math.PI / 2);
}
/** Unit square pyramid sitting on y = 0. */
function pyramidRoof(): THREE.BufferGeometry {
  return new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
}
/** A right-angled wedge in the XY plane, used for sails and the sundial's gnomon. */
function wedge(width: number, height: number, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(width, 0); shape.lineTo(0, height); shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }).translate(0, 0, -thickness / 2);
}

type GearOptions = { teeth: number; tooth: number; tube: number; thickness: number; spokes: number };
/** A gear in the XY plane turning about Z. `radius` reaches the tooth tips. */
function gearGeometry(radius: number, options: GearOptions): THREE.BufferGeometry {
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

/** The escape wheel: thirty hooked teeth, one released per second. */
function escapementWheel(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(21, 1.6, 5, 60)];
  for (let index = 0; index < 30; index += 1) {
    parts.push(new THREE.BoxGeometry(2, 7.5, 2.6).translate(0, 3.4, 0).rotateZ(-0.5).translate(0, 21.5, 0).rotateZ(index / 30 * TAU));
  }
  for (let index = 0; index < 6; index += 1) parts.push(new THREE.BoxGeometry(1.6, 21, 1.6).translate(0, 10.5, 0).rotateZ(index / 6 * TAU));
  parts.push(new THREE.CylinderGeometry(3.4, 3.4, 3.2, 12).rotateX(Math.PI / 2));
  return merge(parts);
}

/** The pallet fork that rocks over the escape wheel, pivoting at its origin. */
function anchorGeometry(): THREE.BufferGeometry {
  return merge([
    new THREE.CylinderGeometry(2.2, 2.2, 3, 10).rotateX(Math.PI / 2),
    new THREE.BoxGeometry(2.4, 7, 2.4).translate(0, -3.5, 0),
    new THREE.BoxGeometry(30, 2.6, 2.6).translate(0, -7, 0),
    new THREE.BoxGeometry(2.6, 9, 2.6).translate(0, -4.5, 0).rotateZ(0.3).translate(-14, -7, 0),
    new THREE.BoxGeometry(2.6, 9, 2.6).translate(0, -4.5, 0).rotateZ(-0.3).translate(14, -7, 0),
  ]);
}

function rotorGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(1.6, 1.6, 1.8, 8).rotateX(Math.PI / 2)];
  for (let blade = 0; blade < 4; blade += 1) parts.push(new THREE.BoxGeometry(2.6, 14, 0.7).translate(0, 8, 0).rotateZ(blade * Math.PI / 2));
  return merge(parts);
}

function loomWheel(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(8.6, 0.8, 5, 32), new THREE.CylinderGeometry(1.8, 1.8, 1.6, 10).rotateX(Math.PI / 2)];
  for (let paddle = 0; paddle < 8; paddle += 1) parts.push(new THREE.BoxGeometry(2.8, 3.6, 1).translate(0, 9.6, 0).rotateZ(paddle / 8 * TAU));
  for (let spoke = 0; spoke < 4; spoke += 1) parts.push(new THREE.BoxGeometry(0.9, 17.2, 0.6).rotateZ(spoke / 4 * Math.PI));
  return merge(parts);
}

function hash(x: number, y: number, z: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

/** The craggy rock the town floats on. Jitter depends only on position, so seams stay closed. */
function underside(): THREE.BufferGeometry {
  // Tall enough that its flanks stay visible from a camera well above the horizon.
  const cone = new THREE.ConeGeometry(ISLAND_RADIUS - 14, 500, 28, 6, true).rotateX(Math.PI).translate(0, -268, 0);
  const position = cone.getAttribute("position");
  const vertex = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    if (vertex.y > -19 || vertex.y < -510) continue;
    const noise = hash(Math.round(vertex.x), Math.round(vertex.y), Math.round(vertex.z));
    const scale = 0.9 + noise * 0.2;
    position.setXYZ(index, vertex.x * scale, vertex.y + (noise - 0.5) * 14, vertex.z * scale);
  }
  const flat = cone.toNonIndexed();
  cone.dispose();
  flat.computeVertexNormals();
  return flat;
}

type Animate = (key: MaterialKey, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, spin?: Omit<Spinner, "object">) => THREE.Mesh;

function buildIsland(batch: Batch, animated: Animate) {
  batch.add("ground", new THREE.CircleGeometry(ISLAND_RADIUS, 96).rotateX(-Math.PI / 2));
  batch.add("water", new THREE.RingGeometry(CANAL.inner, CANAL.outer, 96, 1).rotateX(-Math.PI / 2).translate(0, 0.35, 0));
  batch.add("paving", new THREE.RingGeometry(CANAL.outer + 14, CANAL.outer + 26, 96, 1).rotateX(-Math.PI / 2).translate(0, 0.25, 0));
  batch.add("strata", new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS - 14, 18, 96, 1, true).translate(0, -9, 0));
  batch.add("rock", underside());
  animated("brass", gearGeometry(ISLAND_RADIUS + 16, { teeth: 120, tooth: 8, tube: 3, thickness: 5, spokes: 0 }).rotateX(Math.PI / 2),
    at(0, -7, 0), { axis: "y", step: TAU / 120 });
}

function buildTerraces(batch: Batch, layout: CityLayout) {
  TERRACES.forEach((terrace, index) => {
    batch.add("stone", new THREE.CylinderGeometry(terrace.radius, terrace.radius + 1.5, terrace.top, 96, 1, true).translate(0, terrace.top / 2, 0));
    const inner = TERRACES[index + 1];
    if (inner) {
      batch.add("terrace", new THREE.RingGeometry(inner.radius, terrace.radius, 96, 1).rotateX(-Math.PI / 2).translate(0, terrace.top, 0));
      batch.add("paving", new THREE.RingGeometry(terrace.radius - STREET.inset, terrace.radius - STREET.inset + STREET.width, 96, 1)
        .rotateX(-Math.PI / 2).translate(0, terrace.top + 0.25, 0));
    } else {
      batch.add("paving", new THREE.CircleGeometry(terrace.radius, 64).rotateX(-Math.PI / 2).translate(0, terrace.top, 0));
    }
  });
  const bridgeRadius = (CANAL.inner + CANAL.outer) / 2;
  for (const stair of layout.stairs) {
    for (const step of stair.steps) {
      batch.add("stone", new THREE.BoxGeometry(9, step.top - step.bottom, 2.6), frame(stair.bearing, step.r, (step.top + step.bottom) / 2));
    }
    batch.add("stone", new THREE.BoxGeometry(10, 1.6, 52), frame(stair.bearing, bridgeRadius, 1.2));
    for (const side of [-4.8, 4.8]) batch.add("brass", new THREE.BoxGeometry(0.7, 1.8, 52), local(frame(stair.bearing, bridgeRadius, 0), side, 2.9, 0));
  }
}

const GABLE = gableRoof();
const PYRAMID = pyramidRoof();

function addHouse(batch: Batch, house: House) {
  const base = frame(house.theta, house.r, house.y);
  const { width, depth, height } = house;
  batch.add(`wall${house.wall}`, new THREE.BoxGeometry(width, height, depth), local(base, 0, height / 2, 0));
  const roofHeight = Math.min(7, Math.max(4.5, depth * 0.55));
  if (house.roof === "gable") batch.add(`roof${house.roofColor}`, GABLE.clone(), local(base, 0, height, 0, 0, [width + 1.2, roofHeight, depth + 1.4]));
  else batch.add(`roof${house.roofColor}`, PYRAMID.clone(), local(base, 0, height, 0, 0, [width + 1, roofHeight * 1.15, depth + 1]));
  // Door and windows face downhill, toward anyone looking at the town from outside.
  const front = depth / 2 + 0.15;
  batch.add("ink", new THREE.BoxGeometry(2.4, 3.8, 0.4), local(base, 0, 1.9, front));
  const side = width / 2 - 1.9;
  for (const x of [-side, side]) batch.add("ink", new THREE.BoxGeometry(1.8, 2.4, 0.4), local(base, x, 3.2, front));
  for (let floor = 1; 3.2 + floor * 6 < height - 2; floor += 1) {
    for (const x of [-width / 4, width / 4]) batch.add("ink", new THREE.BoxGeometry(1.8, 2.4, 0.4), local(base, x, 3.2 + floor * 6, front));
  }
  if (house.chimney) batch.add("ink", new THREE.BoxGeometry(1.6, roofHeight + 1.5, 1.6), local(base, width / 4, height + roofHeight / 2 + 0.6, -depth / 5));
}

function addTree(batch: Batch, tree: Tree) {
  const base = at(tree.x, tree.y, tree.z, (tree.x * 0.37 + tree.z * 0.11) % TAU);
  batch.add("trunk", new THREE.CylinderGeometry(0.9, 1.4, 5, 5), local(base, 0, 2.5, 0));
  if (tree.round) batch.add(`leaf${tree.shade}`, new THREE.IcosahedronGeometry(tree.height * 0.33, 0), local(base, 0, 4 + tree.height * 0.3, 0));
  else batch.add(`leaf${tree.shade}`, new THREE.ConeGeometry(tree.height * 0.32, tree.height, 6), local(base, 0, 4 + tree.height / 2, 0));
}

/** The clock tower on the summit. Returns its four clock faces. */
function buildTower(batch: Batch, animated: Animate): ClockFace[] {
  const floor = SUMMIT.top;
  batch.add("stone", new THREE.BoxGeometry(36, 10, 36), at(0, floor + 5, 0));
  batch.add("wall0", new THREE.BoxGeometry(24, 80, 24), at(0, floor + 50, 0));
  for (const y of [floor + 50, floor + 89]) batch.add("copper", new THREE.BoxGeometry(26.5, 2.2, 26.5), at(0, y, 0));
  const stage = floor + 104;
  batch.add("wall1", new THREE.BoxGeometry(29, 28, 29), at(0, stage, 0));

  const faces: ClockFace[] = [];
  for (let side = 0; side < 4; side += 1) {
    const bearing = side * Math.PI / 2;
    const normal = new THREE.Vector3(Math.sin(bearing), 0, -Math.cos(bearing));
    const up = UP.clone();
    const right = new THREE.Vector3().crossVectors(up, normal);
    const basis = new THREE.Matrix4().makeBasis(right, up, normal);
    const center = new THREE.Vector3(0, stage, 0).addScaledVector(normal, 14.5);
    const onFace = (offset: number) => basis.clone().setPosition(center.clone().addScaledVector(normal, offset));
    batch.add("face", new THREE.CylinderGeometry(11, 11, 1, 40).rotateX(Math.PI / 2), onFace(0.5));
    batch.add("ink", new THREE.TorusGeometry(11, 0.9, 5, 40), onFace(1));
    for (let mark = 0; mark < 12; mark += 1) {
      batch.add("ink", new THREE.BoxGeometry(0.9, mark % 3 === 0 ? 2.6 : 1.6, 0.5).translate(0, 8.4, 0).rotateZ(-mark / 12 * TAU), onFace(1.1));
    }
    faces.push({ center: center.clone().addScaledVector(normal, 1.3), normal, right, up });
  }

  const deck = stage + 14;
  batch.add("stone", new THREE.BoxGeometry(30, 2, 30), at(0, deck + 1, 0));
  for (const [x, z] of [[-12.5, -12.5], [12.5, -12.5], [-12.5, 12.5], [12.5, 12.5]] as const) {
    batch.add("stone", new THREE.BoxGeometry(3, 18, 3), at(x, deck + 11, z));
  }
  batch.add("brass", new THREE.CylinderGeometry(3.5, 7, 9, 14), at(0, deck + 9.5, 0));
  batch.add("brass", new THREE.SphereGeometry(2.4, 10, 8), at(0, deck + 15, 0));
  batch.add("stone", new THREE.BoxGeometry(32, 2.4, 32), at(0, deck + 21.2, 0));
  const spireBase = deck + 22.4;
  batch.add("copper", new THREE.ConeGeometry(19, 48, 4).rotateY(Math.PI / 4), at(0, spireBase + 24, 0));
  batch.add("ink", new THREE.CylinderGeometry(0.45, 0.45, 8, 6), at(0, spireBase + 51, 0));
  batch.add("brass", new THREE.SphereGeometry(2.4, 10, 8), at(0, spireBase + 54, 0));
  // The belfry crown gear, held off the posts by four brackets.
  for (let corner = 0; corner < 4; corner += 1) batch.add("brass", new THREE.BoxGeometry(1.2, 1.2, 5), frame(Math.PI / 4 + corner * Math.PI / 2, 19.5, deck + 3.5));
  animated("brass", gearGeometry(25, { teeth: 24, tooth: 2.8, tube: 1.3, thickness: 1.8, spokes: 0 }).rotateX(Math.PI / 2),
    at(0, deck + 3.5, 0), { axis: "y", step: TAU / 24 });
  return faces;
}

/** One district's signature landmark. Returns the escapement anchor when it builds one. */
function buildDistrict(batch: Batch, landmark: Landmark, kind: DistrictKind, animated: Animate): THREE.Object3D | null {
  const accent: MaterialKey = `accent${landmark.district}`;
  const base = frame(landmark.bearing, landmark.radius, landmark.y);
  const put = (key: MaterialKey, geometry: THREE.BufferGeometry, x: number, y: number, z: number, rotationY = 0, scale?: Scale) =>
    batch.add(key, geometry, local(base, x, y, z, rotationY, scale));

  switch (kind) {
    case "windpumps":
      for (const [x, z] of [[-18, 4], [0, -6], [18, 4]] as const) {
        put("wall1", new THREE.BoxGeometry(9, 7, 9), x, 3.5, z);
        put(accent, PYRAMID.clone(), x, 7, z, 0, [10, 4.5, 10]);
        put("copper", new THREE.CylinderGeometry(1.1, 1.8, 34, 6), x, 24, z);
        animated(accent, rotorGeometry(), local(base, x, 42, z + 2.4), { axis: "z", step: Math.PI / 6 });
      }
      return null;
    case "observatory":
      put("wall0", new THREE.CylinderGeometry(15, 16, 14, 20), 0, 7, 0);
      put("ink", new THREE.TorusGeometry(16.4, 0.7, 4, 40).rotateX(Math.PI / 2), 0, 14, 0);
      put(accent, new THREE.SphereGeometry(15.4, 20, 10, 0, TAU, 0, Math.PI / 2), 0, 14, 0);
      put("ink", new THREE.CylinderGeometry(2.1, 2.7, 26, 10).rotateX(0.8), 0, 25, 6);
      put("wall1", new THREE.BoxGeometry(8, 9, 8), -21, 4.5, 6);
      put(accent, PYRAMID.clone(), -21, 9, 6, 0, [9, 4.5, 9]);
      return null;
    case "port": {
      put("paving", new THREE.CircleGeometry(24, 40).rotateX(-Math.PI / 2), 0, 0.45, 0);
      // A real sundial: the gnomon points true north whatever the camera does.
      batch.add("ink", wedge(14, 9, 1.2).rotateY(Math.PI / 2), at(landmark.x, 0.45, landmark.z + 7));
      for (let hour = 0; hour < 9; hour += 1) {
        batch.add("ink", new THREE.BoxGeometry(0.5, 0.2, 13).translate(0, 0, -6.5), at(landmark.x, 0.6, landmark.z + 7, (hour - 4) * 0.36));
      }
      batch.add("stone", new THREE.BoxGeometry(7, 1.4, 26), frame(landmark.bearing, 347, 1));
      [-0.05, 0.036, 0.078].forEach((offset, index) => {
        const boat = frame(landmark.bearing + offset, 332, 0.4);
        batch.add("wall1", new THREE.BoxGeometry(13, 2.6, 5), local(boat, 0, 1.3, 0));
        batch.add("wall2", new THREE.BoxGeometry(4, 2.6, 3.6), local(boat, -3, 3.9, 0));
        batch.add("ink", new THREE.CylinderGeometry(0.35, 0.35, 10, 5), local(boat, 2.5, 7.6, 0));
        batch.add(index === 1 ? "wall0" : accent, wedge(6, 8, 0.4), local(boat, 2.8, 3.2, 0));
      });
      return null;
    }
    case "workshops":
      for (const [x, z] of [[-16, -4], [0, 4], [16, -4]] as const) {
        put("wall2", new THREE.BoxGeometry(14, 9, 13), x, 4.5, z);
        for (const offset of [-4.3, 0, 4.3]) put(accent, GABLE.clone(), x, 9, z + offset, 0, [14.6, 3.6, 4.4]);
        put("ink", new THREE.CylinderGeometry(1.8, 2.3, 26, 8), x + 5, 13, z - 3);
        for (let puff = 0; puff < 3; puff += 1) put("smoke", new THREE.IcosahedronGeometry(2.6 + puff, 1), x + 5 + puff * 1.6, 28 + puff * 4.5, z - 3 - puff);
      }
      return null;
    case "escapement":
      put("stone", new THREE.BoxGeometry(12, 44, 9), 0, 22, -10);
      put("ink", new THREE.BoxGeometry(2.4, 30, 2.4), 0, 59, -6);
      put("ink", new THREE.BoxGeometry(2.4, 2.4, 7), 0, 72, -2.5);
      put("ink", new THREE.CylinderGeometry(1.6, 1.6, 12, 8).rotateX(Math.PI / 2), 0, 34, -4);
      animated(accent, escapementWheel(), local(base, 0, 34, 0), { axis: "z", step: TAU / 30 });
      return animated("ink", anchorGeometry(), local(base, 0, 72, 1.6));
    case "farm":
      for (let stripe = 0; stripe < 4; stripe += 1) put(stripe % 2 ? "fieldB" : "fieldA", new THREE.BoxGeometry(26, 0.6, 5.6), -9, 0.3, -9 + stripe * 6);
      put("wall1", new THREE.BoxGeometry(11, 15, 10), 15, 7.5, -2);
      put(accent, GABLE.clone(), 15, 15, -2, 0, [11.8, 6, 11.4]);
      animated(accent, loomWheel(), local(base, 15, 13, 3.6), { axis: "z", step: TAU / 16 });
      return null;
    case "market":
      [-15, -5, 5, 15].forEach((x, column) => [-6, 6].forEach((z, row) => {
        put("wall2", new THREE.BoxGeometry(6.5, 3, 4), x, 1.5, z);
        for (const postX of [-3, 3]) for (const postZ of [-2, 2]) put("ink", new THREE.BoxGeometry(0.5, 6.6, 0.5), x + postX, 3.3, z + postZ);
        put((column + row) % 2 ? "wall0" : accent, GABLE.clone(), x, 6.6, z, 0, [7.6, 2.4, 5.4]);
      }));
      return null;
    case "orchard":
      for (const x of [-18, -6, 6, 18]) for (const z of [-10, 0, 10]) {
        if (Math.abs(x) === 6 && z === 0) continue;
        put("trunk", new THREE.CylinderGeometry(0.8, 1.2, 6, 5), x, 3, z);
        put("brass", new THREE.IcosahedronGeometry(4.6, 0), x, 9.2, z, (x + z) * 0.4);
      }
      put("stone", new THREE.CylinderGeometry(6, 6, 0.8, 12), 0, 0.4, 0);
      for (let post = 0; post < 6; post += 1) {
        const angle = post / 6 * TAU;
        put("ink", new THREE.BoxGeometry(0.6, 6, 0.6), Math.cos(angle) * 4.8, 3.8, Math.sin(angle) * 4.8);
      }
      put(accent, new THREE.ConeGeometry(6.4, 4.6, 6), 0, 9.1, 0);
      return null;
  }
}

function buildClouds(palette: Palette): THREE.Group {
  const rng = new SeededRandom(0xc10d);
  const parts: THREE.BufferGeometry[] = [];
  for (let index = 0; index < 18; index += 1) {
    const bearing = rng.range(0, TAU);
    const radius = rng.range(560, 900);
    const y = index < 13 ? rng.range(40, 175) : rng.range(-330, -150);
    const { x, z } = polarToXZ(bearing, radius);
    const puffs = 3 + rng.int(0, 2);
    for (let puff = 0; puff < puffs; puff += 1) {
      const size = rng.range(9, 18);
      const offset = (puff - (puffs - 1) / 2) * size * 1.15;
      parts.push(new THREE.IcosahedronGeometry(size, 1)
        .applyMatrix4(at(x, y + rng.range(-3, 4), z, bearing + Math.PI / 2).multiply(at(offset, 0, rng.range(-4, 4)))));
    }
  }
  const group = new THREE.Group();
  group.name = "Drifting clouds";
  const mesh = new THREE.Mesh(merge(parts), palette.get("cloud"));
  mesh.name = "cloud";
  group.add(mesh);
  return group;
}

/** Hour and minute hands for all four faces as one mesh; rebuilt once a minute. */
export function handsGeometry(faces: readonly ClockFace[], hour: number, minute: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const face of faces) {
    const place = new THREE.Matrix4().makeBasis(face.right, face.up, face.normal).setPosition(face.center);
    parts.push(new THREE.BoxGeometry(1.7, 6.6, 0.5).translate(0, 2.1, 0.3).rotateZ(-hour).applyMatrix4(place));
    parts.push(new THREE.BoxGeometry(1.15, 9.6, 0.5).translate(0, 3.6, 0.8).rotateZ(-minute).applyMatrix4(place));
    parts.push(new THREE.CylinderGeometry(1.1, 1.1, 1.6, 10).rotateX(Math.PI / 2).translate(0, 0, 0.6).applyMatrix4(place));
  }
  return merge(parts);
}

export function buildCity(layout: CityLayout = createCityLayout()): BuiltCity {
  const palette = new Palette();
  const batch = new Batch();
  const group = new THREE.Group();
  group.name = "Clockwork hill town";
  const spinners: Spinner[] = [];
  const animated: Animate = (key, geometry, matrix, spin) => {
    const mesh = new THREE.Mesh(normalize(geometry), palette.get(key));
    mesh.name = `${key} (moving)`;
    mesh.applyMatrix4(matrix);
    group.add(mesh);
    if (spin) spinners.push({ object: mesh, ...spin });
    return mesh;
  };

  buildIsland(batch, animated);
  buildTerraces(batch, layout);
  for (const house of layout.houses) addHouse(batch, house);
  for (const tree of layout.trees) addTree(batch, tree);
  const faces = buildTower(batch, animated);
  let anchor: THREE.Object3D | null = null;
  for (const landmark of layout.landmarks) {
    const district = DISTRICTS[landmark.district];
    if (district) anchor = buildDistrict(batch, landmark, district.kind, animated) ?? anchor;
  }

  const statics = batch.build(palette, group);
  const clouds = buildClouds(palette);
  group.add(clouds);
  const hands = new THREE.Mesh(handsGeometry(faces, 0, 0), palette.get("ink"));
  hands.name = "clock hands";
  group.add(hands);

  return {
    group,
    pickables: statics.filter((mesh) => mesh.name !== "smoke"),
    hands,
    faces,
    spinners,
    anchor: anchor ?? new THREE.Object3D(),
    clouds,
    focusPoints: layout.landmarks.map((landmark) => new THREE.Vector3(landmark.x, landmark.y, landmark.z)),
  };
}
