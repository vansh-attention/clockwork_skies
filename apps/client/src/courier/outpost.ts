import * as THREE from "three";
import { SeededRandom } from "@clockwork/shared";
import type { Vec3 } from "@clockwork/shared";
import {
  Batch, addHouse, addTree, at, frame, gearGeometry, local, merge, normalize, underside,
  type HouseSpec, type MaterialKey, type MaterialSource, type TreeSpec,
} from "../city/kit";
import type { Spinner } from "../city/buildCity";
import { HOME_LAUNCH_SITE, ISLAND_RADIUS, angularGap, pick3, polarToXZ } from "../city/layout";
import type { SkyWorld } from "./skyFlight";
import type { IslandId } from "./tasks";
import { createHillTownWalkWorld, type WalkWorld } from "./walkWorld";
import { createOutpostCameraWorld, type BoxVolume, type CameraWorld } from "./cameraWorld";

/**
 * Lanternfall Isle, the home island's launcher, the two landing gates, and the flight world that ties them together.
 * Everything here is built from the town's kit and existing palette keys.
 */

const TAU = Math.PI * 2;
const DEGREES = Math.PI / 180;

export const LANTERNFALL_RADIUS = 230;
const BEARING = 70 * DEGREES;
const DISTANCE = 2400;
const centre = polarToXZ(BEARING, DISTANCE);
export const LANTERNFALL_CENTER: Readonly<Vec3> = { x: centre.x, y: 120, z: centre.z };

// --- pads and gates ---------------------------------------------------------------------------------------------

/** A launch/parking pad: where the plane sits and which way it launches (yaw). */
export type Pad = { readonly island: IslandId; readonly position: Readonly<Vec3>; readonly yaw: number };
/** A landing gate: a vertical brass ring the plane flies through, travelling along `direction`. */
export type Gate = {
  readonly island: IslandId;
  readonly center: Readonly<Vec3>;
  readonly direction: Readonly<Vec3>;
  readonly radius: number;
  readonly parkAt: Pad;
};

const PAD_RADIUS = 12;
const LANTERNFALL_PAD_RADIUS = 200;
/** Launcher frame uprights, in the pad's frame (+Z is the launch direction, X is across). */
const UPRIGHT_X = 4;
const UPRIGHT_Z = -8;
const UPRIGHT_BLOCK = 1;

const homeSite = polarToXZ(HOME_LAUNCH_SITE.bearing, HOME_LAUNCH_SITE.radius);
export const HOME_PAD: Pad = { island: "home", position: { x: homeSite.x, y: 0, z: homeSite.z }, yaw: HOME_LAUNCH_SITE.bearing };

const padLocal = polarToXZ(BEARING + Math.PI, LANTERNFALL_PAD_RADIUS);
export const LANTERNFALL_PAD: Pad = {
  island: "lanternfall",
  position: { x: LANTERNFALL_CENTER.x + padLocal.x, y: LANTERNFALL_CENTER.y, z: LANTERNFALL_CENTER.z + padLocal.z },
  // Faces home, so the return launch heads straight for the home gate.
  yaw: Math.atan2(Math.sin(BEARING + Math.PI), Math.cos(BEARING + Math.PI)),
};

const GATE_RADIUS = 40;
const GATE_STANDOFF = 90;
const HOME_GATE_HEIGHT = 60;
const LANTERNFALL_GATE_LIFT = 45;

/** A gate on the horizontal line `from` to `target`, `standoff` before `target`, travelling toward it. */
function gateBefore(island: IslandId, from: Readonly<Vec3>, target: Readonly<Vec3>, standoff: number, y: number, parkAt: Pad): Gate {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const length = Math.hypot(dx, dz);
  const ux = dx / length;
  const uz = dz / length;
  return {
    island,
    center: { x: target.x - ux * standoff, y, z: target.z - uz * standoff },
    direction: { x: ux, y: 0, z: uz },
    radius: GATE_RADIUS,
    parkAt,
  };
}
/** On the line from the home pad to Lanternfall, so flying straight at the island flies through it. */
export const LANTERNFALL_GATE: Gate = gateBefore(
  "lanternfall", HOME_PAD.position, LANTERNFALL_CENTER, LANTERNFALL_RADIUS + GATE_STANDOFF, LANTERNFALL_CENTER.y + LANTERNFALL_GATE_LIFT, LANTERNFALL_PAD);
/** On the line from the Lanternfall pad to the home centre, outside the home rim. */
export const HOME_GATE: Gate = gateBefore(
  "home", LANTERNFALL_PAD.position, { x: 0, y: 0, z: 0 }, ISLAND_RADIUS + GATE_STANDOFF, HOME_GATE_HEIGHT, HOME_PAD);

/** Where a scripted launch hands over to free flight: 60 ahead of the pad along its yaw and 100 up. */
export function launchRelease(pad: Pad): Vec3 {
  return { x: pad.position.x + Math.sin(pad.yaw) * 60, y: pad.position.y + 100, z: pad.position.z - Math.cos(pad.yaw) * 60 };
}

/** True when the segment prev→next crosses the gate's plane in the travel direction within its radius. */
export function gateCrossed(gate: Gate, prev: Readonly<Vec3>, next: Readonly<Vec3>): boolean {
  if (![prev.x, prev.y, prev.z, next.x, next.y, next.z].every(Number.isFinite)) return false;
  const { center, direction } = gate;
  const depth = (point: Readonly<Vec3>) =>
    (point.x - center.x) * direction.x + (point.y - center.y) * direction.y + (point.z - center.z) * direction.z;
  const before = depth(prev);
  const after = depth(next);
  // Strictly in front of the plane at the start, on or past it at the end: a segment that ends on the plane counts once.
  if (!(before < 0 && after >= 0)) return false;
  const t = before / (before - after);
  const x = prev.x + (next.x - prev.x) * t - center.x;
  const y = prev.y + (next.y - prev.y) * t - center.y;
  const z = prev.z + (next.z - prev.z) * t - center.z;
  return Math.hypot(x, y, z) <= gate.radius;
}

const HOME_TOP = 80;
const HOME_DEPTH = 500;
const TOWER_RADIUS = 22;
const TOWER_TOP = 260;
const LANTERNFALL_TOP = 70;
const LANTERNFALL_DEPTH = 260;
const EDGE_RADIUS = 4200;
const WORLD_FLOOR = -700;
const WORLD_CEILING = 800;

/** World for stepSkyPlane: the home island, the clock tower, and Lanternfall. */
export function skyWorld(): SkyWorld {
  return {
    islands: [
      { x: 0, y: 0, z: 0, radius: ISLAND_RADIUS, top: HOME_TOP, depth: HOME_DEPTH },
      { x: 0, y: 0, z: 0, radius: TOWER_RADIUS, top: TOWER_TOP, depth: 0 },
      { x: LANTERNFALL_CENTER.x, y: LANTERNFALL_CENTER.y, z: LANTERNFALL_CENTER.z, radius: LANTERNFALL_RADIUS, top: LANTERNFALL_TOP, depth: LANTERNFALL_DEPTH },
    ],
    edgeRadius: EDGE_RADIUS,
    floor: WORLD_FLOOR,
    ceiling: WORLD_CEILING,
  };
}

// --- Lanternfall layout -----------------------------------------------------------------------------------------

/** The bearing, in island coordinates, from the lighthouse toward the pad (and so toward home). */
const PAD_BEARING = BEARING + Math.PI;
const KEEPER_RADIUS = 30;
const KEEPER_DEPTH = 9;
const DOOR_GAP = 3;
const LIGHTHOUSE_BLOCK = 9;
const TREE_TRUNK = 1.5;
const RIM_MARGIN = 6;

const KEEPER: HouseSpec = {
  r: KEEPER_RADIUS, theta: PAD_BEARING, y: 0, width: 12, depth: KEEPER_DEPTH, height: 10,
  roof: "gable", wall: 1, roofColor: 1, chimney: true,
};

type OutpostLayout = { readonly keeper: HouseSpec; readonly houses: readonly HouseSpec[]; readonly trees: readonly TreeSpec[] };

function createLayout(): OutpostLayout {
  const rng = new SeededRandom(0x1a47e12);
  // Twelve cottages, one per 30 degrees, offset half a step so none stands on the path from the pad to the keeper.
  const houses: HouseSpec[] = Array.from({ length: 12 }, (_, index) => {
    const theta = (PAD_BEARING + (index + 0.5) * TAU / 12 + rng.range(-0.08, 0.08)) % TAU;
    const r = rng.range(140, 175);
    const width = rng.range(9, 12);
    const depth = rng.range(8, 10);
    const height = rng.range(8, 13);
    const roofRoll = rng.next();
    const wall = pick3(rng.int(0, 2));
    const roofColor = pick3(rng.int(0, 2));
    const chimney = rng.next() < 0.4;
    return { r, theta, y: 0, width, depth, height, roof: roofRoll < 0.7 ? "gable" : "pyramid", wall, roofColor, chimney };
  });

  const pad = polarToXZ(PAD_BEARING, LANTERNFALL_PAD_RADIUS);
  const trees: TreeSpec[] = [];
  for (let index = 0; index < 16; index += 1) {
    // Draw every random value before rejecting a site so one rejection never reshuffles the rest.
    const theta = index * TAU / 16 + rng.range(-0.1, 0.1);
    const radius = rng.range(190, 214);
    const height = rng.range(10, 15);
    const round = rng.next() < 0.4;
    const shade = pick3(rng.int(0, 2));
    const { x, z } = polarToXZ(theta, radius);
    if (Math.hypot(x - pad.x, z - pad.z) < 24) continue;
    if (angularGap(theta, PAD_BEARING) * radius < 9) continue;
    trees.push({ x, y: 0, z, height, round, shade });
  }
  return { keeper: KEEPER, houses, trees };
}

/**
 * Lanternfall's cottages and trees in island-local coordinates (x, z measured from the island centre).
 * @internal Shared by the builder, the walk world and the tests; not part of the courier API.
 */
export const LANTERNFALL_LAYOUT = createLayout();

const doorOffset = polarToXZ(PAD_BEARING, KEEPER_RADIUS + KEEPER_DEPTH / 2 + DOOR_GAP);
/** World position of the lighthouse keeper's door (the final delivery anchor), just outside it on the path to the pad. */
export const KEEPER_DOOR: Readonly<Vec3> = {
  x: LANTERNFALL_CENTER.x + doorOffset.x, y: LANTERNFALL_CENTER.y, z: LANTERNFALL_CENTER.z + doorOffset.z,
};

// --- building ---------------------------------------------------------------------------------------------------

export type BuiltOutpost = { group: THREE.Group; spinners: Spinner[]; pickables: THREE.Mesh[] };
type Animate = (key: MaterialKey, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, spin: Omit<Spinner, "object">) => void;

/** A round stone platform with a copper spring launcher behind the plane. `base` has +Z along the launch direction. */
function addPadAndLauncher(batch: Batch, base: THREE.Matrix4): void {
  batch.add("stone", new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS + 0.8, 0.4, 28), local(base, 0, 0.1, 0));
  for (const side of [-UPRIGHT_X, UPRIGHT_X]) {
    batch.add("copper", new THREE.BoxGeometry(1.2, 6, 1.2), local(base, side, 3, UPRIGHT_Z));
    batch.add("copper", new THREE.BoxGeometry(0.6, 0.6, 13), local(base, side * 0.6, 0.6, -1.5));
  }
  batch.add("copper", new THREE.BoxGeometry(9.2, 1, 1.2), local(base, 0, 6, UPRIGHT_Z));
  // The spring: four hoops stacked along the launch axis.
  for (let coil = 0; coil < 4; coil += 1) {
    batch.add("copper", new THREE.TorusGeometry(2.4, 0.45, 6, 16), local(base, 0, 2.9, -6.8 + coil * 0.9));
  }
}

function lampGeometry(): THREE.BufferGeometry {
  return merge([
    new THREE.CylinderGeometry(1.5, 1.5, 3.2, 10),
    new THREE.BoxGeometry(9, 0.8, 0.8),
    new THREE.BoxGeometry(0.8, 0.8, 9),
  ]);
}

/** The striped lighthouse at the island's centre, about 61 tall. */
function addLighthouse(batch: Batch, animated: Animate): void {
  const baseHeight = 3;
  batch.add("stone", new THREE.CylinderGeometry(LIGHTHOUSE_BLOCK, LIGHTHOUSE_BLOCK + 0.6, baseHeight, 20), at(0, baseHeight / 2, 0));
  const bands = 5;
  const bandHeight = 8.4;
  for (let band = 0; band < bands; band += 1) {
    const bottom = 7.8 - band * 0.5;
    batch.add(band % 2 === 0 ? "roof0" : "wall0", new THREE.CylinderGeometry(bottom - 0.5, bottom, bandHeight, 20),
      at(0, baseHeight + band * bandHeight + bandHeight / 2, 0));
  }
  batch.add("ink", new THREE.BoxGeometry(2.2, 3.6, 0.6), frame(PAD_BEARING, 7.6, 4.9));
  const gallery = baseHeight + bands * bandHeight;
  batch.add("ink", new THREE.CylinderGeometry(7.4, 7.4, 0.8, 20), at(0, gallery + 0.4, 0));
  batch.add("ink", new THREE.TorusGeometry(6.9, 0.3, 4, 24).rotateX(Math.PI / 2), at(0, gallery + 1.6, 0));
  const room = gallery + 1.2;
  batch.add("face", new THREE.CylinderGeometry(3.3, 3.3, 7, 16), at(0, room + 3.5, 0));
  animated("brass", lampGeometry(), at(0, room + 3.5, 0), { axis: "y", step: Math.PI / 4 });
  batch.add("copper", new THREE.ConeGeometry(4.8, 8, 16), at(0, room + 7 + 4, 0));
}

/** Lanternfall, its pad and spring launcher, positioned at LANTERNFALL_CENTER. */
export function buildLanternfall(palette: MaterialSource): BuiltOutpost {
  const batch = new Batch();
  const group = new THREE.Group();
  group.name = "Lanternfall Isle";
  group.position.set(LANTERNFALL_CENTER.x, LANTERNFALL_CENTER.y, LANTERNFALL_CENTER.z);
  const spinners: Spinner[] = [];
  const animated: Animate = (key, geometry, matrix, spin) => {
    const mesh = new THREE.Mesh(normalize(geometry), palette.get(key));
    mesh.name = `${key} (moving)`;
    mesh.applyMatrix4(matrix);
    group.add(mesh);
    spinners.push({ object: mesh, ...spin });
  };

  batch.add("ground", new THREE.CircleGeometry(LANTERNFALL_RADIUS, 72).rotateX(-Math.PI / 2));
  batch.add("strata", new THREE.CylinderGeometry(LANTERNFALL_RADIUS, LANTERNFALL_RADIUS - 14, 18, 72, 1, true).translate(0, -9, 0));
  batch.add("rock", underside(LANTERNFALL_RADIUS, 260));
  animated("brass", gearGeometry(LANTERNFALL_RADIUS + 14, { teeth: 72, tooth: 6, tube: 2.4, thickness: 4, spokes: 0 }).rotateX(Math.PI / 2),
    at(0, -7, 0), { axis: "y", step: TAU / 72 });

  // The paved path runs from the pad's edge to just short of the keeper's front step.
  const pathStart = KEEPER_RADIUS + KEEPER_DEPTH / 2 + 1.5;
  const pathEnd = LANTERNFALL_PAD_RADIUS - PAD_RADIUS;
  batch.add("paving", new THREE.BoxGeometry(4, 0.2, pathEnd - pathStart), frame(PAD_BEARING, (pathStart + pathEnd) / 2, 0.12));

  addLighthouse(batch, animated);
  for (const house of [LANTERNFALL_LAYOUT.keeper, ...LANTERNFALL_LAYOUT.houses]) addHouse(batch, house);
  for (const tree of LANTERNFALL_LAYOUT.trees) addTree(batch, tree);
  addPadAndLauncher(batch, at(padLocal.x, 0, padLocal.z, Math.PI - LANTERNFALL_PAD.yaw));

  return { group, spinners, pickables: batch.build(palette, group) };
}

/** The home island's pad and spring launcher at HOME_PAD, plus both gate rings (world space). */
export function buildLaunchersAndGates(palette: MaterialSource): BuiltOutpost {
  const batch = new Batch();
  const group = new THREE.Group();
  group.name = "Launchers and gates";

  const { x, y, z } = HOME_PAD.position;
  addPadAndLauncher(batch, at(x, y, z, Math.PI - HOME_PAD.yaw));

  for (const gate of [LANTERNFALL_GATE, HOME_GATE]) {
    // A torus lies in its local XY plane, so local +Z is the ring's axis; turn that onto the travel direction.
    const base = at(gate.center.x, gate.center.y, gate.center.z, Math.atan2(gate.direction.x, gate.direction.z));
    batch.add("brass", new THREE.TorusGeometry(gate.radius, 1.2, 6, 48), base);
    for (const side of [-1, 1]) {
      batch.add("ink", new THREE.BoxGeometry(1.2, 6, 1.2), local(base, side * (gate.radius + 2.4), 0, 0));
    }
  }

  return { group, spinners: [], pickables: batch.build(palette, group) };
}

// --- Lanternfall walk surface ----------------------------------------------------------------------------------

type Circle = { x: number; z: number; r: number };
type Footprint = { x: number; z: number; sin: number; cos: number; halfWidth: number; halfDepth: number };

const footprintOf = (house: Readonly<HouseSpec>): Footprint => {
  const { x, z } = polarToXZ(house.theta, house.r);
  return { x, z, sin: Math.sin(house.theta), cos: Math.cos(house.theta), halfWidth: house.width / 2, halfDepth: house.depth / 2 };
};

/** The two launcher uprights as walk blockers, for a pad at (x, z) facing `yaw` (pad frame rotated by PI - yaw about Y). */
function uprightCircles(x: number, z: number, yaw: number): Circle[] {
  const angle = Math.PI - yaw;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [-UPRIGHT_X, UPRIGHT_X].map((side) => ({
    x: x + side * cos + UPRIGHT_Z * sin,
    z: z - side * sin + UPRIGHT_Z * cos,
    r: UPRIGHT_BLOCK,
  }));
}

const overlapsCircle = (circle: Circle, x: number, z: number, radius: number): boolean => {
  const reach = circle.r + radius;
  const dx = x - circle.x;
  const dz = z - circle.z;
  return dx * dx + dz * dz < reach * reach;
};

/** The home island's walk surface: the hill town, plus the launcher uprights at HOME_PAD. */
export function createHomeWalkWorld(): WalkWorld {
  const town = createHillTownWalkWorld();
  const uprights = uprightCircles(HOME_PAD.position.x, HOME_PAD.position.z, HOME_PAD.yaw);
  return {
    surfaceAt: (x, z) => town.surfaceAt(x, z),
    blocked: (x, z, radius) => town.blocked(x, z, radius) || uprights.some((circle) => overlapsCircle(circle, x, z, radius)),
  };
}

/** Lanternfall's walk surface in island-local coordinates (world − LANTERNFALL_CENTER). */
export function createLanternfallWalkWorld(): WalkWorld {
  const walkRadius = LANTERNFALL_RADIUS - RIM_MARGIN;
  const footprints = [LANTERNFALL_LAYOUT.keeper, ...LANTERNFALL_LAYOUT.houses].map(footprintOf);

  const circles: Circle[] = [
    { x: 0, z: 0, r: LIGHTHOUSE_BLOCK },
    ...uprightCircles(padLocal.x, padLocal.z, LANTERNFALL_PAD.yaw),
    ...LANTERNFALL_LAYOUT.trees.map((tree) => ({ x: tree.x, z: tree.z, r: TREE_TRUNK })),
  ];

  return {
    surfaceAt(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) > walkRadius) return { height: 0, walkable: false };
      return { height: 0, walkable: true };
    },
    blocked(x, z, radius) {
      // Bad input fails closed: a NaN position must never count as free space.
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius)) return true;
      if (Math.hypot(x, z) + radius > walkRadius) return true;
      if (circles.some((circle) => overlapsCircle(circle, x, z, radius))) return true;
      for (const house of footprints) {
        const dx = x - house.x;
        const dz = z - house.z;
        const outward = dx * house.sin - dz * house.cos;
        const along = dx * house.cos + dz * house.sin;
        if (Math.abs(outward) < house.halfDepth + radius && Math.abs(along) < house.halfWidth + radius) return true;
      }
      return false;
    },
  };
}

/**
 * The spring launcher behind a pad (uprights, crossbar and coils; see addPadAndLauncher) as a camera occluder, in the
 * coordinates of the island whose centre is `origin`. The pad frame is rotated by PI - yaw, like a house at bearing yaw.
 */
export function launcherBox(pad: Pad, origin: Readonly<Vec3>): BoxVolume {
  const angle = Math.PI - pad.yaw;
  const centreZ = (UPRIGHT_Z - 1 + -3.3) / 2;
  const x = pad.position.x - origin.x + Math.sin(angle) * centreZ;
  const z = pad.position.z - origin.z + Math.cos(angle) * centreZ;
  const ground = pad.position.y - origin.y;
  return { x, z, theta: pad.yaw, halfX: UPRIGHT_X + 1.3, halfZ: (-3.3 - (UPRIGHT_Z - 1)) / 2, bottom: ground - 1, top: ground + 7 };
}

/** What the follow camera may not pass through on Lanternfall (island-local): houses, trees, the lighthouse, the launcher. */
export function createLanternfallCameraWorld(ground: Pick<WalkWorld, "surfaceAt"> = createLanternfallWalkWorld()): CameraWorld {
  // The lighthouse tops out around 61 (base, five bands, gallery, lamp room and cap; see addLighthouse).
  return createOutpostCameraWorld(ground, LANTERNFALL_RADIUS, [LANTERNFALL_LAYOUT.keeper, ...LANTERNFALL_LAYOUT.houses],
    LANTERNFALL_LAYOUT.trees, { r: LIGHTHOUSE_BLOCK + 0.5, height: 64 }, [launcherBox(LANTERNFALL_PAD, LANTERNFALL_CENTER)]);
}
