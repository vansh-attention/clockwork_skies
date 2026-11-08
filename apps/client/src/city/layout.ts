import { SeededRandom } from "@clockwork/shared";
import { DISTRICTS, type DistrictTerrace } from "./districts";
import { createLondonPlan, nearestOnPolyline, nearestStreet, riverAt, type LondonPlan } from "./londonPlan";

const TAU = Math.PI * 2;

export const ISLAND_RADIUS = 470;
export const CANAL = { inner: 318, outer: 346 } as const;
/** Terraces from the outermost (lowest) to the summit plaza. */
export const TERRACES = [
  { level: 1, radius: 290, top: 14 },
  { level: 2, radius: 225, top: 30 },
  { level: 3, radius: 160, top: 48 },
  { level: 4, radius: 82, top: 66 },
] as const;
export const SUMMIT = TERRACES[3];
/** Each terrace's ring street runs from `radius - inset` to `radius - inset + width`. */
export const STREET = { inset: 22, width: 12 } as const;
/** Asphalt sits just proud of the flagstone pavement; transport and crossings use the same height. */
export const ROAD_LIFT = 0.28;
/** Stairways (and the canal bridges below them) sit between districts. */
export const STAIR_BEARINGS: readonly number[] = Array.from({ length: 8 }, (_, index) => (index * 45 + 22.5) * Math.PI / 180);
/** The eight stair bridges plus Tower Bridge's dedicated east-bank crossing. */
export const BRIDGE_BEARINGS: readonly number[] = [...STAIR_BEARINGS, Math.PI / 2];
/** Tower Bridge's authored road is 0.47 above its model origin; this lift puts it on the shared 2-unit deck. */
export const TOWER_BRIDGE = { bearing: Math.PI / 2, rotation: Math.PI / 2, modelLift: 1.53 } as const;

/** The home launcher pad: due east, just outside Sundial Port's plaza. Trees keep `clear` units away from it. */
export const HOME_LAUNCH_SITE = { bearing: Math.PI / 2, radius: 444, clear: 26 } as const;

const LANDMARK_RADIUS: Record<DistrictTerrace, number> = { 0: 384, 1: 250, 2: 184, 3: 116 };

export const HOUSE_ROWS = [
  { radius: 240, terrace: 1 }, { radius: 258, terrace: 1 },
  { radius: 174, terrace: 2 }, { radius: 192, terrace: 2 },
  { radius: 100, terrace: 3 }, { radius: 120, terrace: 3 },
  { radius: 384, terrace: 0 },
] as const;

export type Landmark = { district: number; bearing: number; radius: number; x: number; y: number; z: number; clearRadius: number; rotation?: number; scale?: number };
export type House = {
  r: number; theta: number; x: number; y: number; z: number;
  width: number; depth: number; height: number;
  roof: "gable" | "pyramid"; wall: 0 | 1 | 2; roofColor: 0 | 1 | 2; chimney: boolean; terrace: DistrictTerrace;
  rotation?: number; shop?: boolean;
};
export type Tree = { x: number; y: number; z: number; height: number; round: boolean; shade: 0 | 1 | 2 };
export type StairStep = { r: number; bottom: number; top: number };
export type Stair = { bearing: number; steps: StairStep[] };
export type CityLayout = { landmarks: Landmark[]; houses: House[]; trees: Tree[]; stairs: Stair[]; plan?: LondonPlan };

/** Bearing is radians clockwise from north (−Z). */
export function polarToXZ(bearing: number, radius: number) {
  return { x: Math.sin(bearing) * radius, z: -Math.cos(bearing) * radius };
}

export function bearingOf(x: number, z: number): number {
  const bearing = Math.atan2(x, -z);
  return bearing < 0 ? bearing + TAU : bearing;
}

/** Height of the walkable surface at a distance from the tower. */
export function groundHeight(radius: number): number {
  let height = 0;
  for (const terrace of TERRACES) if (radius <= terrace.radius) height = terrace.top;
  return height;
}

/** The district a ground point belongs to, or null on the summit plaza. */
export function districtAt(x: number, z: number): number | null {
  if (Math.abs(x) < 12 && Math.abs(z) < 10) return null;
  let closest = 0;
  let distance = Infinity;
  for (const site of DEFAULT_PLAN.sites) {
    const d = Math.hypot(x - site.x, z - site.z);
    if (d < distance) { distance = d; closest = site.district; }
  }
  return closest;
}

export function angularGap(a: number, b: number): number {
  const difference = Math.abs(a - b) % TAU;
  return Math.min(difference, TAU - difference);
}

/** Clamps a random integer-ish value to one of the three wall/roof/leaf variants. */
export const pick3 = (value: number) => Math.min(2, Math.max(0, Math.floor(value))) as 0 | 1 | 2;

export function createHillTownLayout(seed = 0xc10c): CityLayout {
  const rng = new SeededRandom(seed);
  const landmarks: Landmark[] = DISTRICTS.map((district, index) => {
    const bearing = district.bearing * Math.PI / 180;
    const radius = district.kind === "port" ? (CANAL.inner + CANAL.outer) / 2 : LANDMARK_RADIUS[district.terrace];
    const { x, z } = polarToXZ(bearing, radius);
    return { district: index, bearing, radius, x, y: groundHeight(radius), z, clearRadius: district.kind === "escapement" ? 40 : 32 };
  });

  const houses: House[] = [];
  for (const row of HOUSE_ROWS) {
    const start = rng.range(0, TAU);
    const circumference = TAU * row.radius;
    let travelled = 0;
    for (;;) {
      const width = rng.range(9, 13);
      const gap = rng.range(2.5, 5);
      // Leave at least a narrow lane before the row wraps back to its first house.
      if (travelled + width + 2.5 > circumference) break;
      const theta = (start + (travelled + width / 2) / row.radius) % TAU;
      travelled += width + gap;
      // Draw every random value before rejecting a site so one rejection never reshuffles the rest of the town.
      const depth = rng.range(8, 11);
      const height = rng.range(15, row.terrace === 0 ? 22 : 28);
      const roofRoll = rng.next();
      const wall = pick3(rng.int(0, 2));
      const roofColor = pick3(rng.int(0, 2));
      const chimney = rng.next() < 0.8;
      const keep = rng.next();
      if (row.terrace === 0 && keep > 0.55) continue;
      const { x, z } = polarToXZ(theta, row.radius);
      const halfSpan = Math.max(width, depth) / 2;
      if (STAIR_BEARINGS.some((bearing) => angularGap(theta, bearing) * row.radius < 9 + halfSpan)) continue;
      if (landmarks.some((landmark) => Math.hypot(landmark.x - x, landmark.z - z) < landmark.clearRadius + halfSpan)) continue;
      houses.push({ r: row.radius, theta, x, y: groundHeight(row.radius), z, width, depth, height,
        roof: roofRoll < 0.7 ? "gable" : "pyramid", wall, roofColor, chimney, terrace: row.terrace });
    }
  }

  const launchSite = polarToXZ(HOME_LAUNCH_SITE.bearing, HOME_LAUNCH_SITE.radius);
  const trees: Tree[] = [];
  for (let attempt = 0; trees.length < 120 && attempt < 4000; attempt += 1) {
    const theta = rng.range(0, TAU);
    const radius = rng.range(402, ISLAND_RADIUS - 14);
    const height = rng.range(11, 19);
    const round = rng.next() < 0.3;
    const shade = pick3(rng.int(0, 2));
    const { x, z } = polarToXZ(theta, radius);
    // Every random value above is already drawn, so clearing the launcher never shifts the other trees' dice.
    if (Math.hypot(x - launchSite.x, z - launchSite.z) < HOME_LAUNCH_SITE.clear) continue;
    if (STAIR_BEARINGS.some((bearing) => angularGap(theta, bearing) * radius < 5)) continue;
    if (trees.some((tree) => Math.hypot(tree.x - x, tree.z - z) < 11)) continue;
    if (landmarks.some((landmark) => Math.hypot(landmark.x - x, landmark.z - z) < landmark.clearRadius + 4)) continue;
    trees.push({ x, y: 0, z, height, round, shade });
  }
  // Four round trees soften the corners of the summit plaza, clear of the stairways.
  for (let index = 0; index < 4; index += 1) {
    const { x, z } = polarToXZ(index * Math.PI / 2, 62);
    trees.push({ x, y: SUMMIT.top, z, height: 13, round: true, shade: 1 });
  }

  // London plane avenues occupy the outer pavement of each neighbourhood, rather than
  // leaving all greenery in a distant forest belt. Keep stair and landmark approaches open.
  for (const terrace of TERRACES.slice(0, 3)) {
    const r = terrace.radius - 4.5;
    for (let i = 0; i < 32; i += 1) {
      const theta = (i + 0.5) / 32 * TAU;
      const { x, z } = polarToXZ(theta, r);
      if (STAIR_BEARINGS.some((bearing) => angularGap(theta, bearing) * r < 12)) continue;
      if (landmarks.some((landmark) => Math.hypot(x - landmark.x, z - landmark.z) < landmark.clearRadius + 8)) continue;
      trees.push({ x, y: terrace.top, z, height: 15 + (i % 3) * 2, round: true, shade: pick3(i % 3) });
    }
  }

  const levels = [0, ...TERRACES.map((terrace) => terrace.top)];
  const stairs: Stair[] = STAIR_BEARINGS.map((bearing) => {
    const steps: StairStep[] = [];
    TERRACES.forEach((terrace, index) => {
      const lower = levels[index]!;
      const count = Math.ceil((terrace.top - lower) / 2);
      for (let step = 0; step < count; step += 1) {
        steps.push({ r: terrace.radius + 1.3 + step * 2.6, bottom: lower, top: terrace.top - (terrace.top - lower) * (step + 1) / (count + 1) });
      }
    });
    return { bearing, steps };
  });

  return { landmarks, houses, trees, stairs };
}

/**
 * Vehicles at real size beside the courier (3.79 units tall for a 1.75 m person: about 2.17 units to the metre): the
 * black cab 4.6 m long, 1.8 m wide and 1.83 m to the top of its roof sign; the double-decker 11.2 m long, 2.5 m wide
 * and 4.4 m tall. The models are authored compactly and each axis is scaled to those sizes; wheels, hubs and lamps are
 * placed by it but stay round, at `round` of their authored size.
 */
export const VEHICLE_SCALE = {
  taxi: { x: 1.68, y: 1.45, z: 1.54, round: 1.25 },
  bus: { x: 1.94, y: 1.52, z: 1.77, round: 1.2 },
} as const;
/**
 * The black cab's body roof above the road (its small roof sign stands higher). From anywhere the courier can stand
 * beside a cab, the follow camera's sight line from the eyes rises over it.
 */
export const TAXI_ROOF = 2.5 * VEHICLE_SCALE.taxi.y;

export type FurnitureKind = "lamp" | "postbox" | "bench" | "stall" | "kiosk" | "planter" | "bus" | "taxi" | "bus-stop" | "beacon" | "bin" | "bollard";

/**
 * A piece of street furniture standing at `bearing` from the tower, in the local frame of kit `frame` (+X along the
 * street, +Z away from the tower), turned a further `turn` radians about its own Y (0 or PI). Benches, stalls and
 * phone boxes face -Z at turn 0: toward the tower. `variant` picks a colourway.
 */
export type Furniture = { kind: FurnitureKind; x: number; y: number; z: number; bearing: number; rotation?: number; turn?: number; variant?: number };

/**
 * The solid footprint of each kind (half sizes in its local frame; `round` ones are circles of radius halfX) and its
 * height. The builder (buildCity), the walk world (what the courier bumps into) and the camera world all read this.
 */
export const FURNITURE_SIZE: Readonly<Record<FurnitureKind, { halfX: number; halfZ: number; height: number; round?: boolean }>> = {
  lamp: { halfX: 0.45, halfZ: 0.45, height: 8.45, round: true },
  postbox: { halfX: 0.65, halfZ: 0.65, height: 2.05, round: true },
  bench: { halfX: 1.35, halfZ: 0.5, height: 1.15 },
  stall: { halfX: 2.15, halfZ: 1.2, height: 3.3 },
  kiosk: { halfX: 0.72, halfZ: 0.72, height: 3.35 },
  planter: { halfX: 1.2, halfZ: 1.2, height: 2.6 },
  // Vehicles at real size (VEHICLE_SCALE of their authored footprints).
  bus: { halfX: 6.2 * VEHICLE_SCALE.bus.x, halfZ: 1.71 * VEHICLE_SCALE.bus.z, height: 6.7 * VEHICLE_SCALE.bus.y },
  taxi: { halfX: 2.95 * VEHICLE_SCALE.taxi.x, halfZ: 1.41 * VEHICLE_SCALE.taxi.z, height: 2.87 * VEHICLE_SCALE.taxi.y },
  "bus-stop": { halfX: 0.35, halfZ: 0.35, height: 5.5, round: true },
  beacon: { halfX: 0.14, halfZ: 0.14, height: 4.6, round: true },
  bin: { halfX: 0.5, halfZ: 0.5, height: 1.95, round: true },
  bollard: { halfX: 0.3, halfZ: 0.3, height: 1.45, round: true },
};

const DEG = Math.PI / 180;

/**
 * The summit plaza, dressed like a London square around its clock tower (bearings in degrees; the courier spawns at
 * 270, r 50, and the stairways leave at 22.5 + 45k, whose lanes stay open):
 * - two little markets of striped-awning stalls (45 and 225), facing the tower;
 * - a pair of red telephone kiosks (315) and a garden of planters around a bench (135);
 * - benches either side of the plaza trees, facing the tower (not the west one: the courier starts just inside it,
 *   and its first steps must be open), and an inner ring of four just beyond the setts round the plinth, looking out;
 * - four lamps on the plinth's diagonals.
 */
type Placement = Omit<Furniture, "x" | "y" | "z"> & { r: number };

function summitDressing(): Placement[] {
  const items: Placement[] = [];
  const at = (kind: FurnitureKind, degrees: number, r: number, extra: Pick<Furniture, "turn" | "variant"> = {}) => {
    items.push({ kind, bearing: degrees * DEG, r, ...extra });
  };
  for (const site of [45, 225]) [-7, 0, 7].forEach((offset, index) => at("stall", site + offset, 46, { variant: (index + site / 45) % 3 }));
  at("kiosk", 313, 56);
  at("kiosk", 317, 56);
  at("planter", 129, 48);
  at("planter", 141, 48);
  at("bench", 135, 48);
  for (const tree of [0, 90, 180, 270]) {
    if (tree !== 270) {
      at("bench", tree - 9, 56);
      at("bench", tree + 9, 56);
    }
    at("bench", tree, 31, { turn: Math.PI });
  }
  for (const diagonal of [45, 135, 225, 315]) at("lamp", diagonal, 37);
  return items;
}

/** Where the street furniture stands: lamps along each ring street, round the summit plaza and along the river; pillar boxes on the house-side kerbs. */
export function createStreetFurniture(layout: CityLayout): Furniture[] {
  if (layout.plan) return createLondonFurniture(layout);
  const items: Furniture[] = [];
  // `reach`: how far the item extends along the street from its centre (a long bus must clear a stair by its length).
  const clearOf = (x: number, z: number, bearing: number, r: number, reach = 4.5) => {
    if (STAIR_BEARINGS.some((stair) => angularGap(bearing, stair) * r < 4.5 + reach)) return false;
    if (angularGap(bearing, HOME_LAUNCH_SITE.bearing) * r < HOME_LAUNCH_SITE.clear + reach - 4.5 && Math.abs(r - HOME_LAUNCH_SITE.radius) < HOME_LAUNCH_SITE.clear) return false;
    return !layout.landmarks.some((landmark) => Math.hypot(x - landmark.x, z - landmark.z) < landmark.clearRadius + reach - 1.5);
  };
  const ring = (kind: Furniture["kind"], r: number, y: number, spacing: number, offset: number, every = 1) => {
    const count = Math.floor((TAU * r) / spacing);
    for (let i = 0; i < count; i += every) {
      const bearing = ((i + offset) / count) * TAU;
      const { x, z } = polarToXZ(bearing, r);
      if (clearOf(x, z, bearing, r)) items.push({ kind, x, y, z, bearing });
    }
  };
  for (const terrace of TERRACES.slice(0, 3)) {
    const inner = terrace.radius - STREET.inset;
    ring("lamp", inner + STREET.width - 0.9, terrace.top, 26, 0.5);
    // Pillar boxes stand midway between lamp positions, one every five.
    ring("postbox", inner + 1.1, terrace.top, 26, 2.5, 5);
    // Parked vehicles use the same solid footprints for rendering, walking and follow-camera collision.
    const road = inner + STREET.width / 2;
    for (let i = 0; i < 8; i += 1) {
      const bearing = (i * 45 + 10) * DEG;
      const { x, z } = polarToXZ(bearing, road);
      const kind = i % 3 === 0 ? "bus" : "taxi";
      if (!clearOf(x, z, bearing, road, FURNITURE_SIZE[kind].halfX + 1)) continue;
      items.push({ kind, x, z, y: terrace.top + ROAD_LIFT, bearing });
      if (kind === "bus") {
        const stop = polarToXZ(bearing + 9 / road, inner + STREET.width - 0.8);
        if (clearOf(stop.x, stop.z, bearing + 9 / road, inner + STREET.width - 0.8)) {
          items.push({ kind: "bus-stop", ...stop, y: terrace.top, bearing: bearing + 9 / road });
        }
      }
    }
    // Belisha beacons stand just outside each zebra's walking lane. Unlike general street furniture, these
    // legitimately flank a stair route; their real posts are shared by rendering, walking and camera collision.
    for (const crossing of STAIR_BEARINGS) {
      for (const lateral of [-4.6, 4.6]) {
        const edge = polarToXZ(crossing, road + 4.7);
        const x = edge.x - lateral * Math.cos(crossing);
        const z = edge.z - lateral * Math.sin(crossing);
        if (layout.landmarks.some((landmark) => Math.hypot(x - landmark.x, z - landmark.z) < landmark.clearRadius + 1)) continue;
        items.push({ kind: "beacon", x, z, bearing: bearingOf(x, z), y: terrace.top + ROAD_LIFT });
      }
    }
  }
  for (let i = 0; i < 8; i += 1) {
    const bearing = (i / 8) * TAU;
    const { x, z } = polarToXZ(bearing, SUMMIT.radius - 8);
    if (clearOf(x, z, bearing, SUMMIT.radius - 8)) items.push({ kind: "lamp", x, y: SUMMIT.top, z, bearing });
  }
  for (const { r, ...piece } of summitDressing()) {
    const { x, z } = polarToXZ(piece.bearing, r);
    if (clearOf(x, z, piece.bearing, r)) items.push({ ...piece, x, y: SUMMIT.top, z });
  }
  ring("lamp", CANAL.outer + 14.8, 0, 30, 0.25);
  return items;
}

// The default city is now an authored street graph. Polar helpers and the explicit
// hill-town factory above remain for the separate sky-island slice and old fixtures.
const DEFAULT_PLAN = createLondonPlan();

function freePlot(x: number, z: number, layout: Pick<CityLayout, "houses" | "landmarks">, clearance: number): boolean {
  if (Math.hypot(x, z) > DEFAULT_PLAN.radius - 10 || Math.max(Math.abs(x), Math.abs(z)) < 12 + clearance) return false;
  for (const h of layout.houses) {
    const angle = h.rotation ?? Math.PI - h.theta;
    const dx = x - h.x; const dz = z - h.z;
    if (Math.abs(dx * Math.cos(angle) - dz * Math.sin(angle)) < h.width / 2 + clearance
      && Math.abs(dx * Math.sin(angle) + dz * Math.cos(angle)) < h.depth / 2 + clearance) return false;
  }
  return !layout.landmarks.some((l) => Math.hypot(x - l.x, z - l.z) < l.clearRadius + clearance);
}

export function createCityLayout(seed = 0xc10c): CityLayout {
  const plan = seed === 0xc10c ? DEFAULT_PLAN : createLondonPlan(seed);
  const landmarks: Landmark[] = plan.sites.map((site) => ({
    ...site, bearing: bearingOf(site.x, site.z), radius: Math.hypot(site.x, site.z),
    y: DISTRICTS[site.district]?.kind === "port" ? ROAD_LIFT - 0.47 * 0.56 : 0, scale: 0.56,
  }));
  const houses: House[] = plan.houses.map((h) => ({
    ...h, r: Math.hypot(h.x, h.z), theta: bearingOf(h.x, h.z), y: 0,
    roof: "gable", terrace: 0,
  }));
  const layout: CityLayout = { plan, landmarks, houses, trees: [], stairs: [] };
  const rng = new SeededRandom(seed ^ 0x7ee);
  const addTree = (x: number, z: number, height: number) => {
    if (!freePlot(x, z, layout, 2) || riverAt(x, z, plan).distance < plan.river.halfWidth + 6) return;
    if (Math.hypot(x - 444, z) < HOME_LAUNCH_SITE.clear) return;
    if (layout.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 10)) return;
    layout.trees.push({ x, z, y: 0, height, round: true, shade: pick3(rng.int(0, 2)) });
  };
  for (const street of plan.streets) {
    for (let i = 1; i < street.points.length && layout.trees.length < 35; i += 1) {
      const a = street.points[i - 1]!; const b = street.points[i]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / length; const nz = (b.x - a.x) / length;
      for (let d = 8; d < length - 5; d += 25) {
        for (const side of [-1, 1]) {
          const offset = side * (street.width / 2 + street.pavement - 0.8);
          addTree(a.x + (b.x - a.x) * d / length + nx * offset, a.z + (b.z - a.z) * d / length + nz * offset, rng.range(12, 18));
        }
      }
    }
  }
  for (let i = 0; i < 600 && layout.trees.length < 45; i += 1) {
    const x = rng.range(-170, 170); const z = rng.range(-170, 160);
    if (Math.hypot(x, z) > plan.radius - 10) continue;
    const street = nearestStreet(x, z, plan);
    if (street && street.distance < street.street.width / 2 + street.street.pavement + 4) continue;
    addTree(x, z, rng.range(12, 21));
  }
  return layout;
}

function createLondonFurniture(layout: CityLayout): Furniture[] {
  const plan = layout.plan!;
  const items: Furniture[] = [];
  const add = (kind: FurnitureKind, x: number, z: number, rotation: number, variant = 0) => {
    const size = FURNITURE_SIZE[kind];
    if (!freePlot(x, z, layout, Math.min(2, size.halfZ))) return;
    if (riverAt(x, z, plan).distance < plan.river.halfWidth + 2) return;
    if (Math.hypot(x - 444, z) < HOME_LAUNCH_SITE.clear) return;
    if (layout.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2.5)) return;
    if (items.some((p) => Math.hypot(p.x - x, p.z - z) < 2 + Math.min(4, size.halfX))) return;
    items.push({ kind, x, z, y: kind === "bus" || kind === "taxi" ? ROAD_LIFT : 0,
      rotation, bearing: bearingOf(x, z), variant });
  };
  for (const [streetIndex, street] of plan.streets.entries()) {
    for (let i = 1; i < street.points.length; i += 1) {
      const a = street.points[i - 1]!; const b = street.points[i]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const tx = (b.x - a.x) / length; const tz = (b.z - a.z) / length;
      const nx = -tz; const nz = tx;
      const rotation = Math.atan2(-tz, tx);
      for (let d = 16; d < length - 12; d += 30) {
        const side = (Math.floor(d / 30) + streetIndex) % 2 ? 1 : -1;
        const offset = side * (street.width / 2 + 0.7);
        add("lamp", a.x + tx * d + nx * offset, a.z + tz * d + nz * offset, rotation);
        if (Math.floor(d / 30) % 4 === 0) add("postbox", a.x + tx * (d + 5) + nx * offset, a.z + tz * (d + 5) + nz * offset, rotation);
      }
      const kind = streetIndex % 3 === 0 && street.width >= 7.5 ? "bus" : "taxi";
      // Parked on a long enough stretch of a wide enough street, clear of the junctions at both ends: a bus needs a
      // main street and room to pull in, a cab fits most streets.
      const room = kind === "bus" ? 16 : 10;
      if (length > 2 * FURNITURE_SIZE[kind].halfX + room && street.width >= 6.5 && (streetIndex + i) % 2 === 0) {
        const d = length * 0.52;
        const side = streetIndex % 2 ? -1 : 1;
        // Parked against the kerb (its own half-width in from the edge), leaving the rest of the carriageway free.
        const offset = side * Math.max(0, street.width / 2 - FURNITURE_SIZE[kind].halfZ - 0.15);
        add(kind, a.x + tx * d + nx * offset, a.z + tz * d + nz * offset, rotation);
        if (kind === "bus") {
          const stopOffset = side * (street.width / 2 + street.pavement - 0.6);
          add("bus-stop", a.x + tx * (d + 9) + nx * stopOffset, a.z + tz * (d + 9) + nz * stopOffset, rotation);
        }
      }
    }
  }
  // Telephone boxes and benches sit beside the central square, leaving the west-side spawn clear.
  for (const [kind, x, z, rotation] of [["kiosk", -27, -26, 0], ["kiosk", -24, -26, 0], ["bench", 27, -24, 0], ["bench", 27, 24, Math.PI]] as const) {
    items.push({ kind, x, z, y: 0, bearing: bearingOf(x, z), rotation });
  }
  // Pavement clutter, placed after everything above so it never displaces a lamp, a postbox or a bus: a litter bin
  // between the lamps, and a pair of bollards guarding each street end where it meets another.
  for (const [streetIndex, street] of plan.streets.entries()) {
    for (let i = 1; i < street.points.length; i += 1) {
      const a = street.points[i - 1]!; const b = street.points[i]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const tx = (b.x - a.x) / length; const tz = (b.z - a.z) / length;
      const rotation = Math.atan2(-tz, tx);
      for (let d = 31; d < length - 10; d += 60) {
        const side = (Math.floor(d / 30) + streetIndex) % 2 ? -1 : 1;
        const offset = side * (street.width / 2 + 0.75);
        add("bin", a.x + tx * d - tz * offset, a.z + tz * d + tx * offset, rotation);
      }
    }
    for (const end of [0, street.points.length - 1]) {
      const tip = street.points[end]!;
      const next = street.points[end === 0 ? 1 : end - 1]!;
      const length = Math.hypot(next.x - tip.x, next.z - tip.z);
      if (length < 12 || !plan.streets.some((other) => other !== street && nearestOnPolyline(tip, other.points).distance < other.width / 2 + 2)) continue;
      const tx = (next.x - tip.x) / length; const tz = (next.z - tip.z) / length;
      let d = 0;
      while (d < Math.min(length, 30) && plan.streets.some((other) => other !== street && nearestOnPolyline({ x: tip.x + tx * d, z: tip.z + tz * d }, other.points).distance < other.width / 2 + street.pavement + 1)) d += 0.5;
      for (const side of [-1, 1]) {
        const offset = side * (street.width / 2 + 0.6);
        add("bollard", tip.x + tx * (d + 1.5) - tz * offset, tip.z + tz * (d + 1.5) + tx * offset, Math.atan2(-tz, tx));
      }
    }
  }
  return items;
}
