import { SeededRandom } from "@clockwork/shared";
import { DISTRICTS, type DistrictTerrace } from "./districts";

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
/** Stairways (and the canal bridges below them) sit between districts. */
export const STAIR_BEARINGS: readonly number[] = Array.from({ length: 8 }, (_, index) => (index * 45 + 22.5) * Math.PI / 180);

/** The home launcher pad: due east, just outside Sundial Port's plaza. Trees keep `clear` units away from it. */
export const HOME_LAUNCH_SITE = { bearing: Math.PI / 2, radius: 444, clear: 26 } as const;

const LANDMARK_RADIUS: Record<DistrictTerrace, number> = { 0: 384, 1: 250, 2: 184, 3: 116 };

export const HOUSE_ROWS = [
  { radius: 240, terrace: 1 }, { radius: 258, terrace: 1 },
  { radius: 174, terrace: 2 }, { radius: 192, terrace: 2 },
  { radius: 100, terrace: 3 }, { radius: 120, terrace: 3 },
  { radius: 384, terrace: 0 },
] as const;

export type Landmark = { district: number; bearing: number; radius: number; x: number; y: number; z: number; clearRadius: number };
export type House = {
  r: number; theta: number; x: number; y: number; z: number;
  width: number; depth: number; height: number;
  roof: "gable" | "pyramid"; wall: 0 | 1 | 2; roofColor: 0 | 1 | 2; chimney: boolean; terrace: DistrictTerrace;
};
export type Tree = { x: number; y: number; z: number; height: number; round: boolean; shade: 0 | 1 | 2 };
export type StairStep = { r: number; bottom: number; top: number };
export type Stair = { bearing: number; steps: StairStep[] };
export type CityLayout = { landmarks: Landmark[]; houses: House[]; trees: Tree[]; stairs: Stair[] };

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
  if (Math.hypot(x, z) < SUMMIT.radius + 4) return null;
  return Math.round(bearingOf(x, z) / (Math.PI / 4)) % DISTRICTS.length;
}

export function angularGap(a: number, b: number): number {
  const difference = Math.abs(a - b) % TAU;
  return Math.min(difference, TAU - difference);
}

/** Clamps a random integer-ish value to one of the three wall/roof/leaf variants. */
export const pick3 = (value: number) => Math.min(2, Math.max(0, Math.floor(value))) as 0 | 1 | 2;

export function createCityLayout(seed = 0xc10c): CityLayout {
  const rng = new SeededRandom(seed);
  const landmarks: Landmark[] = DISTRICTS.map((district, index) => {
    const bearing = district.bearing * Math.PI / 180;
    const radius = LANDMARK_RADIUS[district.terrace];
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
      const height = rng.range(9, row.terrace === 0 ? 13 : 18);
      const roofRoll = rng.next();
      const wall = pick3(rng.int(0, 2));
      const roofColor = pick3(rng.int(0, 2));
      const chimney = rng.next() < 0.3;
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
    if (trees.some((tree) => Math.hypot(tree.x - x, tree.z - z) < 11)) continue;
    if (landmarks.some((landmark) => Math.hypot(landmark.x - x, landmark.z - z) < landmark.clearRadius + 4)) continue;
    trees.push({ x, y: 0, z, height, round, shade });
  }
  // Four round trees soften the corners of the summit plaza, clear of the stairways.
  for (let index = 0; index < 4; index += 1) {
    const { x, z } = polarToXZ(index * Math.PI / 2, 62);
    trees.push({ x, y: SUMMIT.top, z, height: 13, round: true, shade: 1 });
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

export type FurnitureKind = "lamp" | "postbox" | "bench" | "stall" | "kiosk" | "planter";

/**
 * A piece of street furniture standing at `bearing` from the tower, in the local frame of kit `frame` (+X along the
 * street, +Z away from the tower), turned a further `turn` radians about its own Y (0 or PI). Benches, stalls and
 * phone boxes face -Z at turn 0: toward the tower. `variant` picks a colourway.
 */
export type Furniture = { kind: FurnitureKind; x: number; y: number; z: number; bearing: number; turn?: number; variant?: number };

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
  const items: Furniture[] = [];
  const clearOf = (x: number, z: number, bearing: number, r: number) => {
    if (STAIR_BEARINGS.some((stair) => angularGap(bearing, stair) * r < 9)) return false;
    if (angularGap(bearing, HOME_LAUNCH_SITE.bearing) * r < HOME_LAUNCH_SITE.clear && Math.abs(r - HOME_LAUNCH_SITE.radius) < HOME_LAUNCH_SITE.clear) return false;
    return !layout.landmarks.some((landmark) => Math.hypot(x - landmark.x, z - landmark.z) < landmark.clearRadius + 3);
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
