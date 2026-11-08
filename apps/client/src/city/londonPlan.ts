import { SeededRandom } from "@clockwork/shared";

export type PlanPoint = { x: number; z: number };
/** width is asphalt width; pavement is added on each side. */
export type PlanStreet = { id: string; name: string; points: PlanPoint[]; width: number; pavement: number };
/** THREE Y rotation: local X is the long axis, local Z is the width. */
export type PlanBridge = { id: string; name: string; x: number; z: number; rotation: number; length: number; width: number };
export type PlanSquare = { id: string; name: string; x: number; z: number; width: number; depth: number; rotation: number };
export type PlanSite = { district: number; x: number; z: number; rotation: number; clearRadius: number };
/** THREE Y rotation; local +Z is the frontage, facing the street. */
export type PlanHouse = { x: number; z: number; rotation: number; width: number; depth: number; height: number; wall: 0 | 1 | 2; roofColor: 0 | 1 | 2; chimney: boolean; shop: boolean; streetId?: string };
export type LondonPlan = {
  radius: number;
  streets: PlanStreet[];
  river: { points: PlanPoint[]; halfWidth: number };
  bridges: PlanBridge[];
  squares: PlanSquare[];
  sites: PlanSite[];
  houses: PlanHouse[];
};
export type PolylineProjection = { x: number; z: number; distance: number; tangentX: number; tangentZ: number; segment: number; t: number };

const RADIUS = 190;
/**
 * The front area between a terrace and its pavement (area railings, steps, bins), paved like the pavement so a street
 * reads as one hard corridor from house front to house front.
 */
export const FRONT_AREA = 2;
const EPSILON = 1e-8;
const p = (x: number, z: number): PlanPoint => ({ x, z });

/** Nearest point on the finite segments, with deterministic first-segment tie breaking at corners. */
export function nearestOnPolyline(point: PlanPoint, points: readonly PlanPoint[]): PolylineProjection {
  let best: PolylineProjection = { x: points[0]?.x ?? 0, z: points[0]?.z ?? 0, distance: Infinity, tangentX: 1, tangentZ: 0, segment: 0, t: 0 };
  if (points.length === 1) best.distance = Math.hypot(point.x - best.x, point.z - best.z);
  for (let segment = 0; segment < points.length - 1; segment += 1) {
    const a = points[segment]!, b = points[segment + 1]!;
    const dx = b.x - a.x, dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared < EPSILON) continue;
    const length = Math.sqrt(lengthSquared);
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared));
    const x = a.x + dx * t, z = a.z + dz * t;
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance < best.distance - EPSILON) best = { x, z, distance, tangentX: dx / length, tangentZ: dz / length, segment, t };
  }
  return best;
}

export function nearestStreet(x: number, z: number, plan: LondonPlan): ({ street: PlanStreet } & Omit<PolylineProjection, "segment" | "t">) | null {
  let best: ({ street: PlanStreet } & Omit<PolylineProjection, "segment" | "t">) | null = null;
  for (const street of plan.streets) {
    const near = nearestOnPolyline({ x, z }, street.points);
    if (!Number.isFinite(near.distance) || (best && near.distance >= best.distance - EPSILON)) continue;
    best = { street, x: near.x, z: near.z, distance: near.distance, tangentX: near.tangentX, tangentZ: near.tangentZ };
  }
  return best;
}

export function riverAt(x: number, z: number, plan: LondonPlan): PolylineProjection {
  return nearestOnPolyline({ x, z }, plan.river.points);
}

const street = (id: string, name: string, points: PlanPoint[], width = 8, pavement = 2.4): PlanStreet => ({ id, name, points, width, pavement });

function bridgeAt(id: string, name: string, x: number, z: number, river: PlanPoint[]): PlanBridge {
  const tangent = nearestOnPolyline({ x, z }, river);
  // A river-normal axis mapped from local X, matching the bridge model's long axis.
  return { id, name, x, z, rotation: Math.atan2(-tangent.tangentX, -tangent.tangentZ), length: 64, width: 10 };
}
function bridgeEnd(bridge: PlanBridge, sign: number): PlanPoint {
  return p(bridge.x + Math.cos(bridge.rotation) * bridge.length / 2 * sign, bridge.z - Math.sin(bridge.rotation) * bridge.length / 2 * sign);
}

type Rect = { x: number; z: number; rotation: number; width: number; depth: number };
function rectCorners(rect: Rect, margin = 0): PlanPoint[] {
  const cos = Math.cos(rect.rotation), sin = Math.sin(rect.rotation);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const x = sx! * (rect.width / 2 + margin), z = sz! * (rect.depth / 2 + margin);
    return p(rect.x + x * cos + z * sin, rect.z - x * sin + z * cos);
  });
}
function intoRect(point: PlanPoint, rect: Rect): PlanPoint {
  const dx = point.x - rect.x, dz = point.z - rect.z;
  const cos = Math.cos(rect.rotation), sin = Math.sin(rect.rotation);
  return p(dx * cos - dz * sin, dx * sin + dz * cos);
}
function pointRectDistance(point: PlanPoint, rect: Rect): number {
  const local = intoRect(point, rect);
  return Math.hypot(Math.max(0, Math.abs(local.x) - rect.width / 2), Math.max(0, Math.abs(local.z) - rect.depth / 2));
}
function segmentPointDistance(a: PlanPoint, b: PlanPoint, point: PlanPoint): number {
  return nearestOnPolyline(point, [a, b]).distance;
}
function cross(a: PlanPoint, b: PlanPoint, c: PlanPoint): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}
function segmentDistance(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): number {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (abC * abD <= 0 && cdA * cdB <= 0
    && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) + EPSILON
    && Math.max(Math.min(a.z, b.z), Math.min(c.z, d.z)) <= Math.min(Math.max(a.z, b.z), Math.max(c.z, d.z)) + EPSILON) return 0;
  return Math.min(segmentPointDistance(a, b, c), segmentPointDistance(a, b, d), segmentPointDistance(c, d, a), segmentPointDistance(c, d, b));
}
function segmentRectDistance(a: PlanPoint, b: PlanPoint, rect: Rect): number {
  if (pointRectDistance(a, rect) === 0 || pointRectDistance(b, rect) === 0) return 0;
  const corners = rectCorners(rect);
  let nearest = Infinity;
  for (let i = 0; i < 4; i += 1) nearest = Math.min(nearest, segmentDistance(a, b, corners[i]!, corners[(i + 1) % 4]!));
  return nearest;
}
function rectsOverlap(a: Rect, b: Rect, margin: number): boolean {
  const cornersA = rectCorners(a, margin), cornersB = rectCorners(b, margin);
  for (const rotation of [a.rotation, b.rotation]) {
    for (const [dx, dz] of [[Math.cos(rotation), -Math.sin(rotation)], [Math.sin(rotation), Math.cos(rotation)]]) {
      const project = (corners: PlanPoint[]) => corners.map((corner) => corner.x * dx! + corner.z * dz!);
      const pa = project(cornersA), pb = project(cornersB);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

/** How many houses the island holds: enough to line its streets with continuous terraces. */
const MAX_HOUSES = 190;

/** Two houses in the same terrace: on the same street and facing the same way. */
function sameRow(a: PlanHouse, b: PlanHouse): boolean {
  return a.streetId !== undefined && a.streetId === b.streetId && Math.abs(Math.atan2(Math.sin(a.rotation - b.rotation), Math.cos(a.rotation - b.rotation))) < 0.35;
}

function buildHouses(plan: LondonPlan, seed: number): PlanHouse[] {
  const random = new SeededRandom(seed);
  const candidates: PlanHouse[][] = [];
  for (const road of plan.streets) {
    if (road.id.endsWith("bridge") || road.id === "king-street") continue;
    const plots: PlanHouse[] = [];
    for (let segment = 0; segment < road.points.length - 1; segment += 1) {
      const a = road.points[segment]!, b = road.points[segment + 1]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const tx = (b.x - a.x) / length, tz = (b.z - a.z) / length;
      for (const side of [-1, 1]) {
        let along = 2 + random.range(0, 2);
        while (along < length - 2) {
          const width = random.range(8, 10.5), depth = random.range(7.5, 9);
          const position = along + width / 2;
          // Terraced: neighbours share (nearly) a party wall, as London rows do, rather than standing apart.
          along += width + random.range(0.3, 0.7);
          if (position + width / 2 > length - 2) continue;
          const nx = -tz * side, nz = tx * side;
          const offset = road.width / 2 + road.pavement + depth / 2 + FRONT_AREA;
          plots.push({
            streetId: road.id,
            x: a.x + tx * position + nx * offset, z: a.z + tz * position + nz * offset,
            // Three or four storeys (a storey is 6 units, about 2.8 m), as London's terraces stand: tall enough
            // that a street reads as a corridor between house fronts rather than an open space.
            rotation: Math.atan2(-nx, -nz), width, depth, height: random.range(17.5, 25),
            wall: random.int(0, 2) as 0 | 1 | 2, roofColor: random.int(0, 1) as 0 | 1 | 2,
            chimney: random.next() < 0.8,
            shop: /strand|fleet|acre|drury|bishop|charing|victoria|marylebone/.test(road.id) && random.next() < 0.42,
          });
        }
      }
    }
    // Start near each street's centre, then fill outward: the first generation is a city, not a row at one edge.
    plots.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    candidates.push(plots);
  }
  const houses: PlanHouse[] = [];
  const cursors = candidates.map(() => 0);
  let available = true;
  while (houses.length < MAX_HOUSES && available) {
    available = false;
    for (let group = 0; group < candidates.length && houses.length < MAX_HOUSES; group += 1) {
      const plots = candidates[group]!;
      let accepted = false;
      while (cursors[group]! < plots.length && !accepted) {
        available = true;
        const house = plots[cursors[group]!]!;
        cursors[group]! += 1;
        const footprint = { ...house, width: house.width + 1.3, depth: house.depth + 2.5 };
        if (rectCorners(footprint).some((corner) => Math.hypot(corner.x, corner.z) > RADIUS - 10)) continue;
        if (plan.sites.some((site) => pointRectDistance(site, footprint) < site.clearRadius + 1)) continue;
        if (plan.squares.some((square) => rectsOverlap(footprint, square, 0.7))) continue;
        if (plan.streets.some((road) => road.points.slice(1).some((b, i) => segmentRectDistance(road.points[i]!, b, footprint) < road.width / 2 + road.pavement + 0.25))) continue;
        if (plan.river.points.slice(1).some((b, i) => segmentRectDistance(plan.river.points[i]!, b, footprint) < plan.river.halfWidth + 2)) continue;
        // Neighbours in the same row (same street, same side) may stand wall to wall; anything else keeps its
        // padded clearance (back-to-back plots, other streets' rows, corners).
        if (houses.some((other) => sameRow(house, other)
          ? rectsOverlap(house, other, 0.05)
          : rectsOverlap(footprint, { ...other, width: other.width + 1.3, depth: other.depth + 2.5 }, 0.15))) continue;
        houses.push(house);
        accepted = true;
      }
    }
  }
  return houses;
}

/**
 * An authored, connected little London. Streets bend around garden squares and landmark forecourts, and three
 * independent crossings connect the south bank. Building plots face their street and are rejected against the
 * complete street/river graph, named squares, landmark clearings and one another before becoming authoritative.
 */
export function createLondonPlan(seed = 0x10d020): LondonPlan {
  const river = [p(-450, 170), p(-300, 145), p(-150, 175), p(0, 195), p(150, 140), p(285, 170), p(450, 190)];
  const bridges = [bridgeAt("battersea-bridge", "Battersea Bridge", -225, 160, river), bridgeAt("westminster-bridge", "Westminster Bridge", 0, 195, river), bridgeAt("tower-bridge", "Tower Bridge", 285, 170, river)];
  const [bn, wn, tn] = bridges.map((bridge) => bridgeEnd(bridge, -1));
  const [bs, ws, ts] = bridges.map((bridge) => bridgeEnd(bridge, 1));
  const streets: PlanStreet[] = [
    street("strand", "The Strand", [p(-355, 20), p(-285, 15), p(-260, -15), p(-200, -55), p(-150, -65), p(-85, -55), p(-35, -60), p(40, -70), p(115, -125), p(200, -135), p(300, -150)], 9, 2.6),
    street("fleet-street", "Fleet Street", [p(40, -70), p(105, -40), p(165, -35), p(240, -40), p(315, 10), p(350, 65)], 8, 2.5),
    street("marylebone-road", "Marylebone Road", [p(-345, -215), p(-230, -235), p(-190, -235), p(-150, -245), p(-110, -235), p(-105, -185), p(30, -185), p(170, -180), p(300, -150)], 9, 2.4),
    street("euston-road", "Euston Road", [p(-270, -315), p(-205, -340), p(-95, -340), p(40, -325), p(170, -300), p(260, -240)], 9, 2.4),
    street("park-lane", "Park Lane", [p(-205, -340), p(-230, -300), p(-230, -235), p(-235, -150), p(-200, -55), p(-225, 45), bn!], 8, 2.5),
    street("gordon-street", "Gordon Street", [p(-110, -235), p(-110, -285), p(-95, -340)], 7, 2.3),
    street("tavistock-place", "Tavistock Place", [p(-110, -285), p(0, -275), p(40, -325)], 7, 2.3),
    street("southampton-row", "Southampton Row", [p(0, -275), p(-15, -230), p(0, -185), p(30, -185)], 8, 2.3),
    street("bow-street", "Bow Street", [p(-105, -185), p(-120, -150), p(-125, -110), p(-120, -75), p(-150, -65)], 7, 2.4),
    street("long-acre", "Long Acre", [p(-120, -150), p(-60, -155), p(5, -130)], 7, 2.4),
    street("drury-lane", "Drury Lane", [p(30, -185), p(5, -130), p(0, -100), p(-35, -60)], 7, 2.4),
    street("charing-cross", "Charing Cross Road", [p(-35, -60), p(-50, -30), p(-50, 25), p(-40, 75), p(-10, 95), p(40, 125)], 8, 2.5),
    street("king-street", "King Street", [p(-50, -30), p(-5, -48), p(58, -30)], 6, 2),
    street("whitehall", "Whitehall", [p(40, -70), p(58, -30), p(75, 10), p(80, 90), p(40, 125), wn!], 9, 2.6),
    street("victoria-street", "Victoria Street", [p(-225, 45), p(-130, 65), p(-40, 75)], 8, 2.4),
    street("bishopsgate", "Bishopsgate", [p(260, -240), p(300, -150), p(325, -85), p(340, -20), p(350, 65), p(325, 110), tn!], 8, 2.5),
    street("kew-road", "Kew Road", [p(-345, -215), p(-365, -130), p(-365, -5), p(-355, 20), p(-380, 70), p(-355, 115), p(-285, 115), p(-270, 70), p(-285, 15)], 7, 2.4),
    street("north-embankment", "Victoria Embankment", [p(-410, 130), p(-300, 112), bn!, p(-150, 142), wn!, p(150, 107), tn!, p(410, 152)], 8, 2.4),
    street("south-embankment", "Queen's Walk", [p(-410, 198), p(-300, 178), bs!, p(-150, 208), ws!, p(150, 173), ts!, p(410, 219)], 6, 2.4),
    street("battersea-church-road", "Battersea Church Road", [bs!, p(-245, 215), p(-245, 275)], 7, 2.3),
    street("lambeth-road", "Lambeth Road", [p(-350, 240), p(-280, 240), p(-245, 275), p(-190, 300), p(-110, 300), p(-35, 285), p(65, 290), p(170, 280), p(270, 250), p(355, 230), p(410, 219)], 8, 2.4),
    street("waterloo-road", "Waterloo Road", [ws!, p(15, 255), p(65, 290), p(25, 320), p(85, 390)], 7, 2.4),
    street("albert-road", "Albert Road", [p(-350, 240), p(-330, 310), p(-245, 355), p(-195, 360), p(-190, 300)], 7, 2.3),
    street("kennington-road", "Kennington Road", [p(-195, 360), p(-105, 405), p(25, 390), p(85, 390)], 7, 2.3),
    street("tooley-street", "Tooley Street", [ts!, p(270, 250), p(170, 280)], 7, 2.4),
    ...bridges.map((bridge, index) => street(bridge.id, bridge.name, [[bn, wn, tn][index]!, p(bridge.x, bridge.z), [bs, ws, ts][index]!], 7, 1.5)),
  ];
  const squares: PlanSquare[] = [
    { id: "clock-square", name: "Clock Square", x: 0, z: 0, width: 76, depth: 68, rotation: 0 },
    { id: "regents-park", name: "Regent's Park", x: -150, z: -295, width: 68, depth: 66, rotation: 0 },
    { id: "gordon-square", name: "Gordon Square", x: -65, z: -235, width: 54, depth: 48, rotation: 0 },
    { id: "covent-garden", name: "Covent Garden", x: -70, z: -105, width: 66, depth: 64, rotation: 0 },
    { id: "st-pauls-churchyard", name: "St Paul's Churchyard", x: 170, z: -85, width: 74, depth: 68, rotation: 0 },
    { id: "parliament-square", name: "Parliament Square", x: 30, z: 45, width: 66, depth: 66, rotation: 0 },
    { id: "kew-gardens", name: "Kew Gardens", x: -325, z: 70, width: 64, depth: 60, rotation: 0 },
    { id: "battersea-yard", name: "Battersea Yard", x: -190, z: 250, width: 70, depth: 66, rotation: 0 },
  ];
  const sites: PlanSite[] = [
    { district: 0, x: -150, z: -295, rotation: 0, clearRadius: 32 },
    { district: 1, x: 170, z: -85, rotation: 0, clearRadius: 34 },
    { district: 2, x: 285, z: 170, rotation: bridges[2]!.rotation, clearRadius: 0 },
    { district: 3, x: -190, z: 250, rotation: 0, clearRadius: 34 },
    { district: 4, x: 30, z: 45, rotation: 0, clearRadius: 34 },
    { district: 5, x: -325, z: 70, rotation: 0, clearRadius: 32 },
    { district: 6, x: -70, z: -105, rotation: 0, clearRadius: 32 },
    { district: 7, x: -65, z: -235, rotation: 0, clearRadius: 30 },
  ];
  const scale = 0.4;
  const scaledPoints = new Set<PlanPoint>();
  for (const road of streets) {
    for (const point of road.points) if (!scaledPoints.has(point)) { point.x *= scale; point.z *= scale; scaledPoints.add(point); }
    road.width = Math.max(5, road.width * 0.85);
  }
  // Street endpoints share some objects with the river/bridge skeleton; scale each source collection once.
  const scaledRiver = river.map((point) => p(point.x * scale, point.z * scale));
  for (const bridge of bridges) {
    bridge.x *= scale; bridge.z *= scale; bridge.length = 34; bridge.width = 8;
  }
  for (const square of squares) {
    square.x *= scale; square.z *= scale; square.width *= scale; square.depth *= scale;
    square.name = square.id === "clock-square" ? "Little London Square" : square.name;
  }
  for (const site of sites) { site.x *= scale; site.z *= scale; site.clearRadius = site.district === 2 ? 0 : site.clearRadius * 0.56; }
  const plan: LondonPlan = { radius: RADIUS, streets, river: { points: scaledRiver, halfWidth: 7.2 }, bridges, squares, sites, houses: [] };
  plan.houses = buildHouses(plan, seed);
  return plan;
}
