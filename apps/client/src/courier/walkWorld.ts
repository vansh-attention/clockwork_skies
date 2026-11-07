import { DISTRICTS, type DistrictKind } from "../city/districts";
import {
  CANAL, ISLAND_RADIUS, STAIR_BEARINGS, TERRACES,
  FURNITURE_SIZE, angularGap, bearingOf, createCityLayout, createStreetFurniture, groundHeight,
  type CityLayout, type House,
} from "../city/layout";

export type Surface = { height: number; walkable: boolean };
export interface WalkWorld {
  /** Ground height and walkability at (x, z) in island-local coordinates. */
  surfaceAt(x: number, z: number): Surface;
  /** True when a circle of `radius` at (x, z) overlaps a house, a landmark blocker, the clock tower, a tree trunk or the island rim. */
  blocked(x: number, z: number, radius: number): boolean;
}

const TAU = Math.PI * 2;
const RIM_MARGIN = 6;
const STAIR_HALF_WIDTH = 4.5;
const STAIR_OUTER_PAD = 1.3;
/** Canal bridges: deck spans `inner`–`outer`, ramps down to the ground over the last `ramp` units, rails at ±`rail`. */
export const BRIDGE = {
  halfWidth: 5,
  inner: (CANAL.inner + CANAL.outer) / 2 - 26,
  outer: (CANAL.inner + CANAL.outer) / 2 + 26,
  deck: 2,
  ramp: 4,
  rail: 4.8,
  railHalf: 0.35,
} as const;
const TOWER_HALF = 18;
const TREE_TRUNK_RADIUS = 1.5;
const HOUSE_BUCKETS = 64;

type Circle = { x: number; z: number; r: number };
/** Axis-aligned rectangle in island coordinates, by half extents. */
type Rect = { x: number; z: number; halfX: number; halfZ: number };
/** A box turned like kit `frame` at `bearing` (local +X along the street, +Z away from the tower). */
type TurnedBox = { x: number; z: number; cos: number; sin: number; halfX: number; halfZ: number };
type Flight = { bearing: number; wall: number; end: number; upper: number; lower: number };
type Bucketed = { house: House; sin: number; cos: number };

/** [local x along the street, local z away from the tower, radius] per landmark kind. */
const BLOCKERS: Record<DistrictKind, ReadonlyArray<readonly [number, number, number]>> = {
  windpumps: [[-18, 4, 6], [0, -6, 6], [18, 4, 6]],
  observatory: [[0, 0, 17], [-21, 6, 6]],
  port: [],
  workshops: [[-16, -4, 9], [0, 4, 9], [16, -4, 9]],
  escapement: [[0, -10, 8], ...[-12, -6, 0, 6, 12].map((x) => [x, 0, 2.5] as const)],
  farm: [[15, -2, 8]],
  market: [-15, -5, 5, 15].flatMap((x) => [-6, 6].map((z) => [x, z, 3.5] as const)),
  orchard: [
    [0, 0, 6.5],
    ...[-18, -6, 6, 18].flatMap((x) =>
      [-10, 0, 10].filter((z) => !(z === 0 && Math.abs(x) === 6)).map((z) => [x, z, 1.4] as const)),
  ],
};

/** Landmark local frame to world: rotation about Y by PI - bearing (three.js convention). */
function toWorld(landmark: { x: number; z: number; bearing: number }, lx: number, lz: number) {
  const angle = Math.PI - landmark.bearing;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: landmark.x + lx * cos + lz * sin, z: landmark.z - lx * sin + lz * cos };
}

function buildFlights(layout: CityLayout): Flight[] {
  const flights: Flight[] = [];
  for (const stair of layout.stairs) {
    TERRACES.forEach((terrace, index) => {
      // A step belongs to the terrace with the largest wall radius at or below it.
      const next = TERRACES[index - 1]?.radius ?? Infinity;
      const radii = stair.steps.map((step) => step.r).filter((r) => r >= terrace.radius && r < next);
      if (radii.length === 0) return;
      flights.push({
        bearing: stair.bearing,
        wall: terrace.radius,
        end: Math.max(...radii) + STAIR_OUTER_PAD,
        upper: terrace.top,
        lower: index === 0 ? 0 : TERRACES[index - 1]!.top,
      });
    });
  }
  return flights;
}

export function createHillTownWalkWorld(layout: CityLayout = createCityLayout()): WalkWorld {
  const flights = buildFlights(layout);

  const circles: Circle[] = layout.trees.map((tree) => ({ x: tree.x, z: tree.z, r: TREE_TRUNK_RADIUS }));
  // Street furniture is solid too: posts and pillar boxes as circles, benches, stalls, kiosks and planters as boxes.
  const turned: TurnedBox[] = [];
  for (const item of createStreetFurniture(layout)) {
    const size = FURNITURE_SIZE[item.kind];
    if (size.round) circles.push({ x: item.x, z: item.z, r: size.halfX });
    else turned.push({ x: item.x, z: item.z, cos: Math.cos(Math.PI - item.bearing), sin: Math.sin(Math.PI - item.bearing), halfX: size.halfX, halfZ: size.halfZ });
  }
  const rects: Rect[] = [];
  for (const landmark of layout.landmarks) {
    const kind = DISTRICTS[landmark.district]?.kind;
    if (!kind) continue;
    for (const [lx, lz, r] of BLOCKERS[kind]) circles.push({ ...toWorld(landmark, lx, lz), r });
    // The sundial gnomon is a 1.2-wide blade along world z, from the landmark's z + 7 (tall end) north to z − 7;
    // its low northern tip is ankle height, so only z − 5 … z + 7 blocks.
    if (kind === "port") rects.push({ x: landmark.x, z: landmark.z + 1, halfX: 0.6, halfZ: 6 });
  }

  const buckets: Bucketed[][] = Array.from({ length: HOUSE_BUCKETS }, () => []);
  let maxHalfDiagonal = 0;
  for (const house of layout.houses) {
    const index = Math.floor((((house.theta % TAU) + TAU) % TAU) / TAU * HOUSE_BUCKETS) % HOUSE_BUCKETS;
    buckets[index]!.push({ house, sin: Math.sin(house.theta), cos: Math.cos(house.theta) });
    maxHalfDiagonal = Math.max(maxHalfDiagonal, Math.hypot(house.width, house.depth) / 2);
  }

  /** Distance across the nearest stair/bridge bearing, in units of arc at radius r. */
  const lateralToStair = (bearing: number, r: number) => {
    let best = Infinity;
    for (const stairBearing of STAIR_BEARINGS) best = Math.min(best, angularGap(bearing, stairBearing) * r);
    return best;
  };
  const onBridge = (bearing: number, r: number) =>
    r >= BRIDGE.inner && r <= BRIDGE.outer && lateralToStair(bearing, r) <= BRIDGE.halfWidth;

  function surfaceAt(x: number, z: number): Surface {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return { height: 0, walkable: false };
    const r = Math.hypot(x, z);
    if (r > ISLAND_RADIUS - RIM_MARGIN) return { height: groundHeight(r), walkable: false };
    const bearing = bearingOf(x, z);

    // The deck ramps down over its last few units so the walker can step off onto the promenade.
    if (onBridge(bearing, r)) return { height: BRIDGE.deck * Math.min(1, (BRIDGE.outer - r) / BRIDGE.ramp), walkable: true };
    if (r >= CANAL.inner && r <= CANAL.outer) return { height: 0, walkable: false };

    for (const flight of flights) {
      if (r < flight.wall || r > flight.end) continue;
      if (angularGap(bearing, flight.bearing) * r > STAIR_HALF_WIDTH) continue;
      const t = (r - flight.wall) / (flight.end - flight.wall);
      return { height: flight.upper + (flight.lower - flight.upper) * t, walkable: true };
    }
    return { height: groundHeight(r), walkable: true };
  }

  function blockedByHouse(x: number, z: number, radius: number, r: number): boolean {
    const reach = maxHalfDiagonal + radius;
    const spread = r > reach ? Math.asin(reach / r) : Math.PI;
    const centre = bearingOf(x, z) / TAU * HOUSE_BUCKETS;
    const half = spread / TAU * HOUSE_BUCKETS;
    const first = Math.floor(centre - half);
    const last = Math.floor(centre + half);
    const count = Math.min(last - first + 1, HOUSE_BUCKETS);
    for (let step = 0; step < count; step += 1) {
      const bucket = buckets[(((first + step) % HOUSE_BUCKETS) + HOUSE_BUCKETS) % HOUSE_BUCKETS]!;
      for (const { house, sin, cos } of bucket) {
        const outward = x * sin - z * cos;
        if (Math.abs(outward - house.r) >= house.depth / 2 + radius) continue;
        const along = x * cos + z * sin;
        if (Math.abs(along) < house.width / 2 + radius) return true;
      }
    }
    return false;
  }

  function blocked(x: number, z: number, radius: number): boolean {
    // Bad input fails closed: a NaN position must never count as free space.
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius)) return true;
    const r = Math.hypot(x, z);
    if (r + radius > ISLAND_RADIUS - RIM_MARGIN) return true;
    if (Math.abs(x) < TOWER_HALF + radius && Math.abs(z) < TOWER_HALF + radius) return true;
    const nearBridgeSpan = r + radius > BRIDGE.inner && r - radius < BRIDGE.outer - BRIDGE.ramp;
    const nearCanal = r + radius > CANAL.inner && r - radius < CANAL.outer;
    if (nearBridgeSpan || nearCanal) {
      const lateral = lateralToStair(bearingOf(x, z), r);
      // Brass rails run along both edges of each bridge deck (before its ramp).
      if (nearBridgeSpan && Math.abs(lateral - BRIDGE.rail) < BRIDGE.railHalf + radius) return true;
      // Off the bridge, the body may not hang over the canal.
      if (nearCanal && lateral > BRIDGE.rail - BRIDGE.railHalf - radius) return true;
    }
    for (const circle of circles) {
      const reach = circle.r + radius;
      const dx = x - circle.x;
      const dz = z - circle.z;
      if (dx * dx + dz * dz < reach * reach) return true;
    }
    for (const rect of rects) {
      if (Math.abs(x - rect.x) < rect.halfX + radius && Math.abs(z - rect.z) < rect.halfZ + radius) return true;
    }
    for (const box of turned) {
      // Into the box's own frame (the inverse of walkWorld toWorld / kit frame).
      const dx = x - box.x;
      const dz = z - box.z;
      if (Math.abs(dx * box.cos - dz * box.sin) < box.halfX + radius && Math.abs(dx * box.sin + dz * box.cos) < box.halfZ + radius) return true;
    }
    return blockedByHouse(x, z, radius, r);
  }

  return { surfaceAt, blocked };
}
