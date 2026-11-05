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

const pick3 = (value: number) => Math.min(2, Math.max(0, value)) as 0 | 1 | 2;

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

  const trees: Tree[] = [];
  for (let attempt = 0; trees.length < 120 && attempt < 4000; attempt += 1) {
    const theta = rng.range(0, TAU);
    const radius = rng.range(402, ISLAND_RADIUS - 14);
    const height = rng.range(11, 19);
    const round = rng.next() < 0.3;
    const shade = pick3(rng.int(0, 2));
    const { x, z } = polarToXZ(theta, radius);
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
