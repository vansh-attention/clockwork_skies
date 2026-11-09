import { riverAt } from "../city/londonPlan";
import { DISTRICTS } from "../city/districts";
import { getLandmarkSolids, landmarkPoint } from "../city/londonSolids";
import {
  BRIDGE_BEARINGS, CANAL, ISLAND_RADIUS, ROAD_LIFT, TERRACES, TOWER_BRIDGE,
  FURNITURE_SIZE, angularGap, bearingOf, createCityLayout, createStreetFurniture, groundHeight,
  type CityLayout, type House,
} from "../city/layout";
import { createLondonGroundHeight } from "../city/londonTerrain";

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
/** A box turned like kit `frame` at `bearing` (local +X along the street, +Z away from the tower). */
type TurnedBox = { x: number; z: number; cos: number; sin: number; halfX: number; halfZ: number };
type Flight = { bearing: number; wall: number; end: number; upper: number; lower: number };
type Bucketed = { house: House; sin: number; cos: number };

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
  if (layout.plan) return createLondonWalkWorld(layout);
  const flights = buildFlights(layout);

  const circles: Circle[] = layout.trees.map((tree) => ({ x: tree.x, z: tree.z, r: TREE_TRUNK_RADIUS }));
  // Street furniture is solid too: posts and pillar boxes as circles, benches, stalls, kiosks and planters as boxes.
  const turned: TurnedBox[] = [];
  for (const item of createStreetFurniture(layout)) {
    const size = FURNITURE_SIZE[item.kind];
    if (size.round) circles.push({ x: item.x, z: item.z, r: size.halfX });
    else turned.push({ x: item.x, z: item.z, cos: Math.cos(Math.PI - item.bearing + (item.turn ?? 0)), sin: Math.sin(Math.PI - item.bearing + (item.turn ?? 0)), halfX: size.halfX, halfZ: size.halfZ });
  }
  for (const landmark of layout.landmarks) {
    const kind = DISTRICTS[landmark.district]?.kind;
    if (!kind) continue;
    for (const solid of getLandmarkSolids(kind, landmark)) {
      if ("col" in solid) {
        const [lx, lz, r, bottom, top] = solid.col;
        if (bottom > 2.5 || top <= 1.2) continue;
        circles.push({ ...landmarkPoint(landmark, lx, lz), r });
      } else {
        const [lx, lz, halfX, halfZ, bottom, top] = solid.box;
        if (bottom > 2.5 || top <= 1.2) continue;
        const angle = landmark.rotation ?? Math.PI - landmark.bearing;
        turned.push({ ...landmarkPoint(landmark, lx, lz), cos: Math.cos(angle), sin: Math.sin(angle), halfX, halfZ });
      }
    }
  }

  const buckets: Bucketed[][] = Array.from({ length: HOUSE_BUCKETS }, () => []);
  let maxHalfDiagonal = 0;
  for (const house of layout.houses) {
    const index = Math.floor((((house.theta % TAU) + TAU) % TAU) / TAU * HOUSE_BUCKETS) % HOUSE_BUCKETS;
    buckets[index]!.push({ house, sin: Math.sin(house.theta), cos: Math.cos(house.theta) });
    maxHalfDiagonal = Math.max(maxHalfDiagonal, Math.hypot(house.width, house.depth) / 2);
  }

  /** Distance across the nearest stair/bridge bearing, in units of arc at radius r. */
  const lateralToBridge = (bearing: number, r: number) => {
    let best = Infinity;
    for (const bridgeBearing of BRIDGE_BEARINGS) best = Math.min(best, angularGap(bearing, bridgeBearing) * r);
    return best;
  };
  const onBridge = (bearing: number, r: number) =>
    r >= BRIDGE.inner && r <= BRIDGE.outer && lateralToBridge(bearing, r) <= BRIDGE.halfWidth;

  function surfaceAt(x: number, z: number): Surface {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return { height: 0, walkable: false };
    const r = Math.hypot(x, z);
    if (r > ISLAND_RADIUS - RIM_MARGIN) return { height: groundHeight(r), walkable: false };
    const bearing = bearingOf(x, z);

    // The deck ramps down over its last few units so the walker can step off onto the promenade.
    if (onBridge(bearing, r)) {
      // The original eight bridges meet stair flights on the inner bank. Tower Bridge meets flat quay paving,
      // so it has a second, matching ramp there instead of an unwalkable two-unit lip.
      const innerRamp = angularGap(bearing, TOWER_BRIDGE.bearing) * r <= BRIDGE.halfWidth ? (r - BRIDGE.inner) / BRIDGE.ramp : 1;
      return { height: BRIDGE.deck * Math.min(1, innerRamp, (BRIDGE.outer - r) / BRIDGE.ramp), walkable: true };
    }
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
      const lateral = lateralToBridge(bearingOf(x, z), r);
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

/**
 * Flat London: authored street blocks and a winding Thames, with bridge rectangles rather than radial terraces.
 * River distance is exact to the centre-line polyline: the courier's whole body stays on a quay or inside a bridge.
 */
export function createLondonWalkWorld(layout: CityLayout): WalkWorld {
  const plan = layout.plan!;
  if (!plan) throw new TypeError("createLondonWalkWorld requires an authored London plan");
  // People stand on what is drawn: the road's top, a kerb stone, a square, an apron, the paving or the grass.
  const groundHeight = createLondonGroundHeight(plan);
  type Obstacle = { kind: "circle"; x: number; z: number; r: number } | { kind: "box"; x: number; z: number; cos: number; sin: number; halfX: number; halfZ: number };
  const obstacles: Obstacle[] = [];
  const addBox = (x: number, z: number, halfX: number, halfZ: number, rotation: number) => {
    obstacles.push({ kind: "box", x, z, halfX, halfZ, cos: Math.cos(rotation), sin: Math.sin(rotation) });
  };
  for (const house of layout.houses) addBox(house.x, house.z, house.width / 2, house.depth / 2, house.rotation ?? Math.PI - house.theta);
  for (const tree of layout.trees) obstacles.push({ kind: "circle", x: tree.x, z: tree.z, r: TREE_TRUNK_RADIUS });
  for (const item of createStreetFurniture(layout)) {
    const size = FURNITURE_SIZE[item.kind];
    if (size.round) obstacles.push({ kind: "circle", x: item.x, z: item.z, r: size.halfX });
    else addBox(item.x, item.z, size.halfX, size.halfZ, (item.rotation ?? Math.PI - item.bearing) + (item.turn ?? 0));
  }
  for (const landmark of layout.landmarks) {
    const kind = DISTRICTS[landmark.district]?.kind;
    if (!kind) continue;
    for (const solid of getLandmarkSolids(kind, landmark)) {
      if ("col" in solid) {
        const [x, z, r, bottom, top] = solid.col;
        if (landmark.y + bottom > 2.5 || landmark.y + top <= 0.1) continue;
        obstacles.push({ kind: "circle", ...landmarkPoint(landmark, x, z), r });
      } else {
        const [x, z, halfX, halfZ, bottom, top] = solid.box;
        if (landmark.y + bottom > 2.5 || landmark.y + top <= 0.1) continue;
        const position = landmarkPoint(landmark, x, z);
        addBox(position.x, position.z, halfX, halfZ, landmark.rotation ?? Math.PI - landmark.bearing);
      }
    }
  }
  // Every bridge's low side rail is solid even on the dry approach, so a courier cannot step off its sides.
  for (const bridge of plan.bridges) for (const side of [-1, 1]) {
    const lateral = side * (bridge.width / 2 - 0.2);
    addBox(bridge.x + Math.sin(bridge.rotation) * lateral, bridge.z + Math.cos(bridge.rotation) * lateral,
      bridge.length / 2, 0.15, bridge.rotation);
  }
  const cellSize = 24;
  const grid = new Map<number, Obstacle[]>();
  const key = (x: number, z: number) => (x + 64) * 128 + z + 64;
  for (const obstacle of obstacles) {
    const reach = obstacle.kind === "circle" ? obstacle.r : Math.hypot(obstacle.halfX, obstacle.halfZ);
    for (let x = Math.floor((obstacle.x - reach) / cellSize); x <= Math.floor((obstacle.x + reach) / cellSize); x += 1) {
      for (let z = Math.floor((obstacle.z - reach) / cellSize); z <= Math.floor((obstacle.z + reach) / cellSize); z += 1) {
        const id = key(x, z);
        const bucket = grid.get(id);
        if (bucket) bucket.push(obstacle); else grid.set(id, [obstacle]);
      }
    }
  }
  const bridgeCoordinates = (bridge: typeof plan.bridges[number], x: number, z: number) => {
    const dx = x - bridge.x;
    const dz = z - bridge.z;
    return { along: dx * Math.cos(bridge.rotation) - dz * Math.sin(bridge.rotation), across: dx * Math.sin(bridge.rotation) + dz * Math.cos(bridge.rotation) };
  };
  function surfaceAt(x: number, z: number): Surface {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) > plan.radius - RIM_MARGIN) return { height: 0, walkable: false };
    for (const bridge of plan.bridges) {
      const point = bridgeCoordinates(bridge, x, z);
      // A bridge's deck, or whatever stands higher on its approach (a kerb running onto it).
      if (Math.abs(point.along) <= bridge.length / 2 && Math.abs(point.across) <= bridge.width / 2) return { height: Math.max(ROAD_LIFT, groundHeight(x, z)), walkable: true };
    }
    if (riverAt(x, z, plan).distance <= plan.river.halfWidth) return { height: -3, walkable: false };
    return { height: groundHeight(x, z), walkable: true };
  }
  function blocked(x: number, z: number, radius: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius < 0) return true;
    if (Math.hypot(x, z) + radius > plan.radius - RIM_MARGIN) return true;
    if (riverAt(x, z, plan).distance <= plan.river.halfWidth + radius) {
      const supported = plan.bridges.some((bridge) => {
        const point = bridgeCoordinates(bridge, x, z);
        return Math.abs(point.along) + radius <= bridge.length / 2 && Math.abs(point.across) + radius <= bridge.width / 2 - 0.35;
      });
      if (!supported) return true;
    }
    const checked = new Set<Obstacle>();
    for (let gx = Math.floor((x - radius) / cellSize); gx <= Math.floor((x + radius) / cellSize); gx += 1) {
      for (let gz = Math.floor((z - radius) / cellSize); gz <= Math.floor((z + radius) / cellSize); gz += 1) {
        for (const obstacle of grid.get(key(gx, gz)) ?? []) {
          if (checked.has(obstacle)) continue;
          checked.add(obstacle);
          const dx = x - obstacle.x;
          const dz = z - obstacle.z;
          if (obstacle.kind === "circle") {
            if (dx * dx + dz * dz < (obstacle.r + radius) ** 2) return true;
          } else {
            const lx = Math.abs(dx * obstacle.cos - dz * obstacle.sin);
            const lz = Math.abs(dx * obstacle.sin + dz * obstacle.cos);
            if (radius === 0 ? lx < obstacle.halfX && lz < obstacle.halfZ
              : Math.max(0, lx - obstacle.halfX) ** 2 + Math.max(0, lz - obstacle.halfZ) ** 2 < radius * radius) return true;
          }
        }
      }
    }
    return false;
  }
  return { surfaceAt, blocked };
}
