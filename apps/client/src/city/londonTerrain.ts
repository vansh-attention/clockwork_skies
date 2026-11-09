import * as THREE from "three";
import { Batch, at, local } from "./kit";
import { ROAD_LIFT } from "./layout";
import { FRONT_AREA, nearestOnPolyline, type LondonPlan, type PlanPoint, type PlanStreet } from "./londonPlan";
import { frontageApron } from "./londonDetails";

/** Offset a polyline at its mitred joins, preserving the street/river width at corners. */
export function offsetLine(points: readonly PlanPoint[], offset: number): PlanPoint[] {
  return points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)]!; const next = points[Math.min(points.length - 1, i + 1)]!;
    const normal = (a: PlanPoint, b: PlanPoint) => {
      const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { x: -(b.z - a.z) / d, z: (b.x - a.x) / d };
    };
    const n1 = i === 0 ? normal(p, next) : normal(prev, p);
    const n2 = i === points.length - 1 ? n1 : normal(p, next);
    const denominator = Math.max(0.3, 1 + n1.x * n2.x + n1.z * n2.z);
    return { x: p.x + (n1.x + n2.x) * offset / denominator, z: p.z + (n1.z + n2.z) * offset / denominator };
  });
}

function flatPolygon(points: readonly PlanPoint[], y: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)));
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, y, 0);
}

/** The outline of a strip `width` wide along a winding street, clipped to the island's rim. */
function ribbonOutline(points: readonly PlanPoint[], width: number, radius: number): PlanPoint[] {
  return clipToRim([...offsetLine(points, width / 2), ...offsetLine(points, -width / 2).reverse()], radius);
}

/** One continuous strip, avoiding gaps between the segments of a winding street. */
export function streetRibbon(points: readonly PlanPoint[], width: number, y: number, radius = 190): THREE.BufferGeometry {
  return flatPolygon(ribbonOutline(points, width, radius), y);
}

/** Heights of the drawn walking surfaces (their top faces). Everything people stand on is one of these. */
export const LONDON_SURFACE = {
  ground: 0, paving: 0.05, apron: 0.055, square: 0.065, road: ROAD_LIFT,
  /** Kerb stones stand 0.12 tall, centred on the road's height. */
  kerb: ROAD_LIFT + 0.06,
} as const;
const KERB_SIZE = { width: 0.24, height: 0.12, spacing: 1.5 } as const;

type KerbStone = { x: number; z: number; length: number; angle: number };
/** Every kerb stone along every street: shared by the drawing and the ground heights, so they always agree. */
function kerbStones(plan: LondonPlan): KerbStone[] {
  const stones: KerbStone[] = [];
  for (const street of plan.streets) {
    for (const side of [-1, 1]) {
      const kerb = offsetLine(street.points, side * (street.width / 2 + KERB_SIZE.width / 2));
      for (let i = 1; i < kerb.length; i += 1) {
        const a = kerb[i - 1]!; const b = kerb[i]!;
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const count = Math.ceil(length / KERB_SIZE.spacing);
        for (let j = 0; j < count; j += 1) {
          const t = (j + 0.5) / count;
          const point = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
          // Kerbs stop at joining carriageways instead of drawing white lines across the junction.
          if (plan.streets.some((other) => other !== street && nearestOnPolyline(point, other.points).distance < other.width / 2 + 0.4)) continue;
          stones.push({ x: point.x, z: point.z, length: length / count + 0.02, angle: Math.atan2(-(b.z - a.z), b.x - a.x) });
        }
      }
    }
  }
  return stones;
}

/** Even-odd point-in-polygon. */
function inside(polygon: readonly PlanPoint[], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!; const b = polygon[j]!;
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

/** Whether (x, z) lies on a flat rectangle drawn with `at(x, y, z, rotation)` (width along local X, depth along Z). */
function onRect(rect: { x: number; z: number; width: number; depth: number; rotation: number }, x: number, z: number): boolean {
  const dx = x - rect.x, dz = z - rect.z;
  const c = Math.cos(rect.rotation), s = Math.sin(rect.rotation);
  return Math.abs(dx * c - dz * s) <= rect.width / 2 && Math.abs(dx * s + dz * c) <= rect.depth / 2;
}

/**
 * The height of the drawn London ground at (x, z): the top of the highest walking surface drawn there (road, kerb
 * stone, square, front apron, paving or plain ground), from the very outlines buildLondonStreetNetwork draws. People
 * stand on this, so no foot sinks into a road or a kerb. Bridges and the river are the walk world's own business.
 */
export function createLondonGroundHeight(plan: LondonPlan): (x: number, z: number) => number {
  type Area = { polygon: PlanPoint[]; height: number; minX: number; maxX: number; minZ: number; maxZ: number };
  const areas: Area[] = [];
  const addArea = (polygon: PlanPoint[], height: number) => {
    if (polygon.length < 3) return;
    const xs = polygon.map((p) => p.x), zs = polygon.map((p) => p.z);
    areas.push({ polygon, height, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
  };
  for (const street of plan.streets) {
    addArea(ribbonOutline(street.points, street.width + (street.pavement + FRONT_AREA) * 2, plan.radius), LONDON_SURFACE.paving);
    addArea(ribbonOutline(street.points, street.width, plan.radius), LONDON_SURFACE.road);
  }
  const rects: { rect: { x: number; z: number; width: number; depth: number; rotation: number }; height: number }[] = [];
  for (const square of plan.squares) rects.push({ rect: square, height: LONDON_SURFACE.square });
  for (const house of plan.houses) {
    const apron = frontageApron(house, plan);
    if (apron) rects.push({ rect: apron, height: LONDON_SURFACE.apron });
  }
  // Kerb stones, bucketed by a coarse grid: there are hundreds of them.
  const cell = 8;
  const kerbs = new Map<string, KerbStone[]>();
  for (const stone of kerbStones(plan)) {
    const reach = stone.length / 2 + KERB_SIZE.width;
    for (let gx = Math.floor((stone.x - reach) / cell); gx <= Math.floor((stone.x + reach) / cell); gx += 1) {
      for (let gz = Math.floor((stone.z - reach) / cell); gz <= Math.floor((stone.z + reach) / cell); gz += 1) {
        const key = `${gx},${gz}`;
        const bucket = kerbs.get(key);
        if (bucket) bucket.push(stone); else kerbs.set(key, [stone]);
      }
    }
  }
  return (x: number, z: number) => {
    let height: number = LONDON_SURFACE.ground;
    for (const area of areas) {
      if (area.height <= height || x < area.minX || x > area.maxX || z < area.minZ || z > area.maxZ) continue;
      if (inside(area.polygon, x, z)) height = area.height;
    }
    for (const { rect, height: top } of rects) if (top > height && onRect(rect, x, z)) height = top;
    for (const stone of kerbs.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) {
      if (onRect({ x: stone.x, z: stone.z, width: stone.length, depth: KERB_SIZE.width, rotation: stone.angle }, x, z)) {
        height = Math.max(height, LONDON_SURFACE.kerb);
      }
    }
    return height;
  };
}

/** Clip land polygons to the island's convex rim. The Thames genuinely cuts the ground into two banks. */
function clipToRim(input: PlanPoint[], islandRadius = 190): PlanPoint[] {
  let polygon = input;
  for (let edge = 0; edge < 96; edge += 1) {
    const a = { x: Math.cos(edge / 96 * Math.PI * 2) * islandRadius, z: Math.sin(edge / 96 * Math.PI * 2) * islandRadius };
    const b = { x: Math.cos((edge + 1) / 96 * Math.PI * 2) * islandRadius, z: Math.sin((edge + 1) / 96 * Math.PI * 2) * islandRadius };
    const side = (p: PlanPoint) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    const result: PlanPoint[] = [];
    for (let i = 0; i < polygon.length; i += 1) {
      const p = polygon[i]!; const q = polygon[(i + 1) % polygon.length]!;
      const dp = side(p); const dq = side(q);
      if (dp >= 0) result.push(p);
      if ((dp >= 0) !== (dq >= 0)) {
        const t = dp / (dp - dq);
        result.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
      }
    }
    polygon = result;
  }
  return polygon;
}

export function buildLondonGround(batch: Batch, plan: LondonPlan) {
  const river = plan.river;
  const north = offsetLine(river.points, -river.halfWidth);
  const south = offsetLine(river.points, river.halfWidth);
  const firstN = north[0]!; const lastN = north[north.length - 1]!;
  const firstS = south[0]!; const lastS = south[south.length - 1]!;
  batch.add("ground", flatPolygon(clipToRim([
    { x: -600, z: -600 }, { x: 600, z: -600 }, { x: 600, z: lastN.z }, ...north.slice().reverse(), { x: -600, z: firstN.z },
  ], plan.radius), 0));
  batch.add("ground", flatPolygon(clipToRim([
    { x: -600, z: firstS.z }, ...south, { x: 600, z: lastS.z }, { x: 600, z: 600 }, { x: -600, z: 600 },
  ], plan.radius), 0));
  batch.add("water", streetRibbon(river.points, river.halfWidth * 2, -3, plan.radius));
  for (const bank of [north, south]) {
    for (let i = 1; i < bank.length; i += 1) {
      const a = bank[i - 1]!; const b = bank[i]!;
      const distance = Math.hypot(b.x - a.x, b.z - a.z);
      const base = at((a.x + b.x) / 2, 0, (a.z + b.z) / 2, Math.atan2(-(b.z - a.z), b.x - a.x));
      batch.add("stone", new THREE.BoxGeometry(distance + 0.3, 4.1, 0.6), local(base, 0, -1.9, 0));
    }
  }
  for (const side of [-1, 1]) {
    const promenade = offsetLine(river.points, side * (river.halfWidth + 3));
    batch.add("paving", streetRibbon(promenade, 6, 0.045, plan.radius));
  }
  // Original narrowboats float below the quays; the river collision keeps walkers on the banks.
  for (const [segment, t] of [[1, 0.55], [3, 0.45]] as const) {
    const a = river.points[segment]!; const b = river.points[segment + 1]!;
    const base = at(a.x + (b.x - a.x) * t, -3, a.z + (b.z - a.z) * t, Math.atan2(-(b.z - a.z), b.x - a.x));
    batch.add("wall2", new THREE.BoxGeometry(10, 0.75, 2.7), local(base, 0, 0.45, 0));
    batch.add("face", new THREE.BoxGeometry(6.4, 1.2, 2.1), local(base, -0.7, 1.4, 0));
    batch.add("leaf0", new THREE.BoxGeometry(6.7, 0.18, 2.3), local(base, -0.7, 2.08, 0));
    for (const side of [-1, 1]) for (const x of [-2.4, -0.7, 1]) {
      batch.add("ink", new THREE.BoxGeometry(1.05, 0.55, 0.08), local(base, x, 1.5, side * 1.08));
    }
  }
}

/** A flat painted mark, `length` along its local X and `width` across, facing up. */
const flat = (length: number, width: number) => new THREE.PlaneGeometry(length, width).rotateX(-Math.PI / 2);

/** True where another carriageway crosses or joins this one: paint and kerbs stop there. */
function inJunction(point: { x: number; z: number }, street: PlanStreet, plan: LondonPlan, margin = 0.4): boolean {
  return plan.streets.some((other) => other !== street && nearestOnPolyline(point, other.points).distance < other.width / 2 + margin);
}

/**
 * What a London street wears: double yellow lines inside both kerbs, a broken white centre line, give-way dashes where
 * it meets another street, iron manhole covers and kerbside gullies, all flat on the tarmac (paint carries no ink).
 */
function paintStreet(batch: Batch, street: PlanStreet, plan: LondonPlan): void {
  const lift = ROAD_LIFT + 0.022;
  for (let segment = 1; segment < street.points.length; segment += 1) {
    const a = street.points[segment - 1]!; const b = street.points[segment]!;
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    if (distance < 1e-6) continue;
    const tx = (b.x - a.x) / distance, tz = (b.z - a.z) / distance;
    const nx = -tz, nz = tx;
    const angle = Math.atan2(-tz, tx);
    const point = (d: number, offset: number) => ({ x: a.x + tx * d + nx * offset, z: a.z + tz * d + nz * offset });
    // Double yellows, in short pieces so they stop cleanly at junctions.
    for (const side of [-1, 1]) for (const inset of [0.42, 0.68]) {
      for (let d = 0.75; d < distance; d += 1.5) {
        const p = point(d, side * (street.width / 2 - inset));
        if (inJunction(p, street, plan, 0.9)) continue;
        batch.add("paintYellow", flat(1.52, 0.13), at(p.x, lift, p.z, angle));
      }
    }
    // A broken centre line.
    for (let d = 3; d < distance - 2; d += 7) {
      const p = point(d, 0);
      if (inJunction(p, street, plan, 1.5)) continue;
      batch.add("paint", flat(3.2, 0.15), at(p.x, lift, p.z, angle));
    }
    // Iron covers down the carriageway and gullies in the gutter, alternating sides.
    for (let d = 9, i = 0; d < distance - 4; d += 23, i += 1) {
      const cover = point(d, (i % 2 ? 1 : -1) * street.width * 0.2);
      if (!inJunction(cover, street, plan, 1)) batch.add("ink", new THREE.CylinderGeometry(0.58, 0.58, 0.05, 14), at(cover.x, ROAD_LIFT + 0.02, cover.z));
      const gully = point(d + 11, (i % 2 ? -1 : 1) * (street.width / 2 - 0.35));
      if (!inJunction(gully, street, plan, 1)) batch.add("ink", new THREE.BoxGeometry(0.95, 0.04, 0.42), at(gully.x, ROAD_LIFT + 0.02, gully.z, angle));
    }
  }
  // Give-way dashes across each end that meets another street.
  for (const end of [0, street.points.length - 1]) {
    const tip = street.points[end]!;
    const next = street.points[end === 0 ? 1 : end - 1]!;
    const length = Math.hypot(next.x - tip.x, next.z - tip.z);
    if (length < 1e-6 || !plan.streets.some((other) => other !== street && nearestOnPolyline(tip, other.points).distance < other.width / 2 + 2)) continue;
    const tx = (next.x - tip.x) / length, tz = (next.z - tip.z) / length;
    // Walk in from the end until clear of the other carriageway, then paint across the full width.
    let d = 0;
    while (d < Math.min(length, 30) && inJunction({ x: tip.x + tx * d, z: tip.z + tz * d }, street, plan, 0.6)) d += 0.5;
    const cx = tip.x + tx * (d + 0.6), cz = tip.z + tz * (d + 0.6);
    const angle = Math.atan2(-tz, tx);
    for (let w = -street.width / 2 + 0.6; w <= street.width / 2 - 0.6; w += 1.0) {
      batch.add("paint", flat(0.22, 0.55), at(cx - tz * w, ROAD_LIFT + 0.022, cz + tx * w, angle));
    }
  }
}

export function buildLondonStreetNetwork(batch: Batch, plan: LondonPlan) {
  for (const street of plan.streets) {
    // Paved from house front to house front: pavements and the front areas behind them (no lawns along a street).
    batch.add("paving", streetRibbon(street.points, street.width + (street.pavement + FRONT_AREA) * 2, LONDON_SURFACE.paving, plan.radius));
    batch.add("road", streetRibbon(street.points, street.width, LONDON_SURFACE.road, plan.radius));
    paintStreet(batch, street, plan);
  }
  for (const stone of kerbStones(plan)) {
    batch.add("stone", new THREE.BoxGeometry(stone.length, KERB_SIZE.height, KERB_SIZE.width), at(stone.x, ROAD_LIFT, stone.z, stone.angle));
  }
  for (const square of plan.squares) {
    batch.add("paving", new THREE.PlaneGeometry(square.width, square.depth).rotateX(-Math.PI / 2), at(square.x, LONDON_SURFACE.square, square.z, square.rotation));
  }
  for (const house of plan.houses) {
    const apron = frontageApron(house, plan);
    if (apron) batch.add("paving", new THREE.PlaneGeometry(apron.width, apron.depth).rotateX(-Math.PI / 2), at(apron.x, LONDON_SURFACE.apron, apron.z, apron.rotation));
  }
  for (const bridge of plan.bridges) {
    const base = at(bridge.x, 0, bridge.z, bridge.rotation);
    batch.add("stone", new THREE.BoxGeometry(bridge.length, 3, bridge.width), local(base, 0, -1.3, 0));
    batch.add("road", new THREE.BoxGeometry(bridge.length, 0.08, bridge.width - 0.5), local(base, 0, ROAD_LIFT - 0.04, 0));
    // Match the London walk world's side-rail centres and thickness exactly.
    for (const side of [-1, 1]) {
      batch.add("ink", new THREE.BoxGeometry(bridge.length, 0.16, 0.3), local(base, 0, 2, side * (bridge.width / 2 - 0.2)));
      for (let x = -bridge.length / 2; x <= bridge.length / 2; x += 2) {
        batch.add("ink", new THREE.CylinderGeometry(0.07, 0.07, 1.8, 5), local(base, x, 1.1, side * (bridge.width / 2 - 0.2)));
      }
    }
  }
}
