import * as THREE from "three";
import { SeededRandom } from "@clockwork/shared";
import { createHillTownWalkWorld, type WalkWorld } from "../courier/walkWorld";
import { DISTRICTS } from "./districts";
import { bearingOf, createCityLayout, polarToXZ, STREET, TERRACES, type CityLayout, type Landmark } from "./layout";
import { seededSequence, type MaterialSource } from "./kit";
import { animateFigureExpression, createFigure, createFigureMaterial, createFigurePose, poseFigure, type Figure, type FigureLook, type FigurePose } from "../courier/figure";
import { createHumanGait, humanPose, updateHumanGait, type HumanGait } from "../courier/humanGait";
import { landmarkPoint } from "./londonSolids";
import { nearestOnPolyline, type LondonPlan } from "./londonPlan";

/**
 * Original, cosmetic London residents. They have no quest, collision or interaction role: the courier can pass them.
 * Their short pavement walks are validated against the same static world as the courier, including London props.
 * Each is a drawn person (courier/figure.ts) in everyday London dress, walking with the same human gait as the courier
 * (courier/humanGait.ts); all share one material. Far beyond the street haze they rest and hide.
 */
type Point = { x: number; z: number };
export type ResidentRoute = Readonly<{ height: number }> & (
  | Readonly<{ kind: "arc"; radius: number; bearing: number; halfArc: number }>
  | Readonly<{ kind: "path"; points: readonly Point[]; streetId?: string }>
);
export type ResidentAgent = Readonly<{
  id: string;
  district: number;
  route: ResidentRoute;
  stationary: boolean;
  /** Stationary residents face the landmark they are browsing. */
  facing: number;
  coat: 0 | 1 | 2;
  scale: number;
  cap: boolean;
  speed: number;
  phase: number;
}>;
export type BuiltResidents = {
  group: THREE.Group;
  agents: readonly ResidentAgent[];
  /**
   * Seconds on the scene clock. Reduced motion holds a single deterministic pose and position. With a viewpoint, those
   * beyond RESIDENT_VIEW_DISTANCE of it rest and hide.
   */
  update(time: number, reduced: boolean, viewpoint?: THREE.Vector3, courier?: Readonly<{ x: number; z: number }> | null): void;
  /**
   * Whether a body of `radius` at (x, z) would touch a resident where they stand now: people are solid, so the
   * courier walks round them rather than through them.
   */
  blocks(x: number, z: number, radius: number): boolean;
  /**
   * Frees what a scene's own teardown (disposing every mesh's geometry and material it finds) cannot reach: each
   * figure's bone texture.
   */
  dispose(): void;
};

/** Residents further than this from the camera are hidden and not animated (deep in the haze, a few pixels tall). */
export const RESIDENT_VIEW_DISTANCE = 340;

const TAU = Math.PI * 2;
/** Includes a margin around the widest silhouette (0.8 units at the largest scale). */
export const RESIDENT_CLEARANCE = 1.08;
const SAMPLE_STEP = 0.35;
const AGENT_GAP = 3;
const TURN_SECONDS = 1.1;
/** A walker reaches its pace from a standstill (and stops) over this long, at most a sixth of a stretch. */
const EASE_SECONDS = 0.6;
/** A resident's own body, for the courier to walk round (times their scale). */
export const RESIDENT_BODY = 0.5;
/** A walker makes way when the courier stands in its path: this far ahead, this close to its line. */
export const MAKE_WAY = { ahead: 2.6, across: 1.1, rate: 6 } as const;
/** The heading of a figure facing along (x, z): 0 faces −Z, positive turns toward +X (figure.ts, poseFigure). */
export const headingAlong = (x: number, z: number) => Math.atan2(x, -z);
function routeLength(route: ResidentRoute): number {
  if (route.kind === "arc") return route.halfArc * 2;
  return route.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - route.points[i]!.x, p.z - route.points[i]!.z), 0);
}

function pointAlongRoute(route: ResidentRoute, progress: number): Point & { tangentX: number; tangentZ: number } {
  if (route.kind === "arc") {
    const bearing = route.bearing + (route.radius > 0 ? (progress * 2 - 1) * route.halfArc / route.radius : 0);
    return { ...polarToXZ(bearing, route.radius), tangentX: Math.cos(bearing), tangentZ: Math.sin(bearing) };
  }
  let distance = THREE.MathUtils.clamp(progress, 0, 1) * routeLength(route);
  for (let i = 1; i < route.points.length; i += 1) {
    const a = route.points[i - 1]!, b = route.points[i]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (distance <= length || i === route.points.length - 1) {
      const t = length > 0 ? distance / length : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
        tangentX: length > 0 ? (b.x - a.x) / length : 0, tangentZ: length > 0 ? (b.z - a.z) / length : -1 };
    }
    distance -= length;
  }
  return { ...route.points[0]!, tangentX: 0, tangentZ: -1 };
}

function routePoints(route: ResidentRoute, step = SAMPLE_STEP): Point[] {
  const length = routeLength(route);
  const count = Math.max(1, Math.ceil(length / step));
  return Array.from({ length: count + 1 }, (_, i) => pointAlongRoute(route, i / count));
}

/** Reject both walls and drop-offs; sampling with a wider probe also clears the gaps between samples. */
function clearRoute(route: ResidentRoute, world: WalkWorld): boolean {
  for (const { x, z } of routePoints(route)) {
    if (world.blocked(x, z, RESIDENT_CLEARANCE)) return false;
    for (const [dx, dz] of [[0, 0], [-0.85, 0], [0.85, 0], [0, -0.85], [0, 0.85]]) {
      const surface = world.surfaceAt(x + dx!, z + dz!);
      if (!surface.walkable || Math.abs(surface.height - route.height) > 0.15) return false;
    }
  }
  return true;
}

function clearOfResidents(route: ResidentRoute, occupied: readonly ResidentRoute[]): boolean {
  const points = routePoints(route, 1);
  for (const other of occupied) {
    if (Math.abs(route.height - other.height) > 2) continue;
    for (const a of points) for (const b of routePoints(other, 1)) {
      if (Math.hypot(a.x - b.x, a.z - b.z) < AGENT_GAP) return false;
    }
  }
  return true;
}

function pavementRadii(landmark: Landmark): number[] {
  const terrace = DISTRICTS[landmark.district]!.terrace;
  if (terrace === 0) return [362.2, 370.8];
  const inner = TERRACES[terrace - 1]!.radius - STREET.inset;
  // Asphalt occupies the middle 7.6 units. These tracks stay on the pale pavements either side.
  return [inner + 1.05, inner + STREET.width - 1.05];
}

function chooseLegacyRoute(landmark: Landmark, slot: number, world: WalkWorld, occupied: readonly ResidentRoute[]): ResidentRoute | null {
  const radii = pavementRadii(landmark);
  const stationary = slot >= 2;
  if (stationary) {
    // The market's open aisle and the paved approaches to the other landmarks. A blocked candidate is never used.
    const fronts = slot === 2
      ? [[-4, 20], [-8, 16], [-3, 5], [-24, 0], [-20, -18], [-8, -22]]
      : [[4, 20], [8, 16], [3, -5], [24, 0], [20, -18], [8, -22]];
    for (const [x, z] of fronts) {
      const p = landmarkPoint(landmark, x!, z!);
      const route: ResidentRoute = { kind: "arc", radius: Math.hypot(p.x, p.z), bearing: bearingOf(p.x, p.z), halfArc: 0, height: world.surfaceAt(p.x, p.z).height };
      if (clearRoute(route, world) && clearOfResidents(route, occupied)) return route;
    }
  }
  // Search nearby, never outside this neighbourhood's 45-degree sector. A shorter route is preferable to a wall.
  const preferred = slot === 0 ? -8 : slot === 1 ? 8 : slot === 2 ? -15 : 15;
  for (const length of stationary ? [0] : [18, 12, 7]) {
    for (const radius of [radii[slot % 2]!, radii[(slot + 1) % 2]!]) {
      for (const offset of [0, -3, 3, -6, 6, -9, 9, -12, 12]) {
        const degrees = preferred + offset;
        if (Math.abs(degrees) > 18) continue;
        const bearing = landmark.bearing + degrees * Math.PI / 180;
        const p = polarToXZ(bearing, radius);
        const route: ResidentRoute = { kind: "arc", radius, bearing, halfArc: length / 2, height: world.surfaceAt(p.x, p.z).height };
        if (clearRoute(route, world) && clearOfResidents(route, occupied)) return route;
      }
    }
  }
  return null;
}

/** A pavement remains a pavement at junctions only while no other carriageway crosses it. */
function offCarriageways(point: Point, plan: LondonPlan): boolean {
  return plan.streets.every((street) => nearestOnPolyline(point, street.points).distance >= street.width / 2 + 0.3);
}

function choosePlanRoute(layout: CityLayout, landmark: Landmark, slot: number, world: WalkWorld, occupied: readonly ResidentRoute[]): ResidentRoute | null {
  const plan = layout.plan!;
  const stationary = slot >= 2;
  const candidates: ResidentRoute[] = [];
  const make = (points: Point[], streetId?: string): ResidentRoute => ({ kind: "path", points, streetId, height: world.surfaceAt(points[0]!.x, points[0]!.z).height });
  if (stationary) {
    // Browsers occupy real paved approaches, rather than points on an invisible ring around the town.
    for (const front of [20, 24, 28, -20, -24]) for (const side of [-8, 8, -16, 16, -24, 24, 0]) {
      const point = landmarkPoint(landmark, side, front);
      if (offCarriageways(point, plan)) candidates.push(make([point]));
    }
  }
  for (const street of plan.streets) {
    for (let segment = 1; segment < street.points.length; segment += 1) {
      const a = street.points[segment - 1]!, b = street.points[segment]!;
      const segmentLength = Math.hypot(b.x - a.x, b.z - a.z);
      if (segmentLength < 8) continue;
      const tx = (b.x - a.x) / segmentLength, tz = (b.z - a.z) / segmentLength;
      const projected = (landmark.x - a.x) * tx + (landmark.z - a.z) * tz;
      for (const sign of [-1, 1]) {
        const offset = sign * (street.width / 2 + street.pavement / 2);
        for (const length of stationary ? [0] : [18, 12, 7]) for (const shift of [0, -10, 10, -20, 20, -35, 35]) {
          const centre = THREE.MathUtils.clamp(projected + shift, length / 2 + 2, segmentLength - length / 2 - 2);
          if (centre < length / 2 || centre + length / 2 > segmentLength) continue;
          const at = (along: number): Point => ({ x: a.x + tx * along - tz * offset, z: a.z + tz * along + tx * offset });
          candidates.push(make(stationary ? [at(centre)] : [at(centre - length / 2), at(centre + length / 2)], street.id));
        }
      }
    }
  }
  // Keep a district's residents in its own neighbourhood even when a nearby street crosses another site's catchment.
  const neighbourhood = (point: Point) => layout.landmarks.every((other) => other.district === landmark.district
    || Math.hypot(point.x - landmark.x, point.z - landmark.z) <= Math.hypot(point.x - other.x, point.z - other.z));
  candidates.sort((a, b) => {
    const pa = pointAlongRoute(a, 0.5), pb = pointAlongRoute(b, 0.5);
    return Math.hypot(pa.x - landmark.x, pa.z - landmark.z) - Math.hypot(pb.x - landmark.x, pb.z - landmark.z);
  });
  for (const route of candidates) {
    if (!routePoints(route, 1).every((point) => neighbourhood(point) && offCarriageways(point, plan))) continue;
    if (clearRoute(route, world) && clearOfResidents(route, occupied)) return route;
  }
  return null;
}

/**
 * Size and pace, drawn in this order from the seeded hand. An everyday walk of 1.1–1.4 m/s: in proportion to the
 * walker's size, so every walker steps at a natural cadence (about 105–125 steps a minute), not in slow motion.
 */
function stride(random: SeededRandom) {
  const scale = random.range(0.86, 1.08);
  const cap = random.next() > 0.25;
  const speed = scale * random.range(2.45, 2.95);
  const phase = random.range(0, 25);
  return { scale, cap, speed, phase };
}

/** Exported specifications make route safety reviewable without rendering or running an animation. */
export function createResidentAgents(layout: CityLayout = createCityLayout(), seed = 0x10d0): readonly ResidentAgent[] {
  const random = new SeededRandom(seed);
  const world = createHillTownWalkWorld(layout);
  const agents: ResidentAgent[] = [];
  for (const landmark of layout.landmarks) {
    for (let slot = 0; slot < 4; slot += 1) {
      const occupied = agents.map((agent) => agent.route);
      const route = layout.plan ? choosePlanRoute(layout, landmark, slot, world, occupied) : chooseLegacyRoute(landmark, slot, world, occupied);
      if (!route) continue;
      const point = pointAlongRoute(route, 0.5);
      agents.push({
        id: `resident-${landmark.district}-${slot}`, district: landmark.district, route, stationary: slot >= 2,
        facing: headingAlong(landmark.x - point.x, landmark.z - point.z),
        coat: ((landmark.district + slot) % 3) as 0 | 1 | 2,
        ...stride(random),
      });
    }
  }
  return agents;
}

type Pose = { x: number; z: number; heading: number; walking: boolean };
function poseAt(agent: ResidentAgent, time: number): Pose {
  const { route } = agent;
  const length = routeLength(route);
  if (agent.stationary || length === 0) return { ...pointAlongRoute(route, 0.5), heading: agent.facing, walking: false };
  const duration = length / agent.speed;
  const cycle = 2 * (duration + TURN_SECONDS);
  const t = ((time + agent.phase) % cycle + cycle) % cycle;
  let progress: number, turn: number, walking: boolean;
  if (t < duration) { progress = easedProgress(t, duration); turn = 0; walking = true; }
  else if (t < duration + TURN_SECONDS) { progress = 1; turn = (t - duration) / TURN_SECONDS; walking = false; }
  else if (t < duration * 2 + TURN_SECONDS) { progress = 1 - easedProgress(t - duration - TURN_SECONDS, duration); turn = 1; walking = true; }
  else { progress = 0; turn = 1 + (t - duration * 2 - TURN_SECONDS) / TURN_SECONDS; walking = false; }
  // Eased turns happen at rest, leaving the validated route unchanged.
  const whole = Math.floor(turn);
  const fraction = turn - whole;
  const easedTurn = whole + fraction * fraction * (3 - 2 * fraction);
  const point = pointAlongRoute(route, progress);
  return { x: point.x, z: point.z, heading: headingAlong(point.tangentX, point.tangentZ) + easedTurn * Math.PI, walking };
}

/**
 * How far along a stretch of `duration` seconds a walker is after `t`, as a fraction: it eases up to its pace and
 * back down to a stop at the end, over the same time and distance as walking it at an even pace.
 */
export function easedProgress(t: number, duration: number): number {
  if (t <= 0) return 0;
  if (t >= duration) return 1;
  const ease = Math.min(EASE_SECONDS, duration / 6);
  const top = 1 / (duration - ease);
  if (t < ease) return (0.5 * top * t * t) / ease;
  if (t > duration - ease) return 1 - (0.5 * top * (duration - t) ** 2) / ease;
  return top * (t - ease / 2);
}

/** The reference's slender anatomy under relaxed green, salmon and cream knits and softly fitted blue denim. */
const SKINS = ["#f1cbb5", "#e5b79a", "#d09e7b", "#b98161", "#916046", "#704a38"] as const;
const HAIRS = ["#262629", "#302b29", "#3b302c", "#4b3931", "#5b4638", "#685345"] as const;
const TOPS: readonly (readonly [cloth: string, ribbing: string])[] = [
  ["#a4c994", "#87aa7b"], ["#97bd8e", "#7c9f78"], ["#d09a83", "#b78270"],
  ["#dca993", "#bd8b78"], ["#e7dfc9", "#c6bda7"], ["#d7d3bd", "#b8b39f"],
] as const;
const TROUSERS = ["#64748e", "#6e7e96", "#5e6e88", "#74819a", "#63718b", "#718096"] as const;
const SHOES = ["#e8e2d3", "#ded7c5", "#ece6d8", "#d7cdb8"] as const;
export type ResidentIdentity = Readonly<{ gender: "woman" | "man"; age: "young" | "adult" | "older"; garment: "hoodie" | "cardigan" }>;

/** Appearance only: the seeded routes, sizes, walking pace and avoidance are unchanged. */
export function residentIdentity(_agent: ResidentAgent, index: number): ResidentIdentity {
  const age = index % 8 === 0 || index % 8 === 5 ? "older" : index % 3 === 0 ? "young" : "adult";
  return { gender: index % 4 < 2 ? "woman" : "man", age, garment: index % 2 === 0 ? "cardigan" : "hoodie" };
}
export function residentLook(agent: ResidentAgent, index: number): FigureLook {
  const random = seededSequence(index * 7919 + agent.district * 104729 + 0x5ca1e);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length) % list.length]!;
  const identity = residentIdentity(agent, index);
  const [jacket, ribbing] = TOPS[(Math.floor(index / 2) + agent.district) % TOPS.length]!;
  return {
    scale: agent.scale * 0.97,
    build: identity.gender === "woman" ? 0.82 + random() * 0.08 : 0.87 + random() * 0.09,
    head: identity.age === "young" ? 1.12 : identity.age === "older" ? 1.04 : 1.08,
    face: "anime", iris: pick(["#514638", "#5f594c", "#68523e", "#454a43"]),
    expression: identity.age === "older" ? "calm" : index % 3 === 0 ? "bright" : "gentle", age: identity.age,
    skin: pick(SKINS), hair: identity.age === "older" ? pick(["#514b47", "#62594f", "#4e4a48"]) : pick(HAIRS),
    // The shared layered style starts at a medium jaw/nape shag; vary its wispy length without long curtains.
    hairStyle: "layered", hairLength: identity.gender === "woman" ? 1.1 + random() * 0.3 : 1 + random() * 0.3, fringe: true,
    limbs: 0.75 + random() * 0.11, hands: 0.74 + random() * 0.08,
    garment: identity.garment, fit: 1.03 + random() * 0.09, longTop: true, trouserFit: 1.04 + random() * 0.08,
    jacket, trim: identity.garment === "cardigan" ? "#3d3937" : ribbing,
    shirt: "#b3b1ac", legs: "trousers", trousers: pick(TROUSERS), socks: "#e8e2d3", shoes: pick(SHOES),
    pockets: false,
  };
}

/** A sphere around a standing or striding figure in its own space (feet at 0), for frustum culling. */
const FIGURE_BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 1.9, 0), 2.7);

export function buildResidents(_palette: MaterialSource, layout: CityLayout = createCityLayout(), seed = 0x10d0): BuiltResidents {
  const agents = createResidentAgents(layout, seed);
  const group = new THREE.Group();
  group.name = "London residents";
  group.userData.cosmetic = true;
  group.userData.interactive = false;
  const material = createFigureMaterial();
  // Each resident stands on the ground drawn where they are (a road is higher than the paving beside it), so feet
  // never sink into a road or a kerb as a route crosses them.
  const world = createHillTownWalkWorld(layout);
  const people = agents.map((agent, index) => {
    const look = residentLook(agent, index);
    const figure: Figure = createFigure(look, material);
    figure.group.name = agent.id;
    figure.group.userData = { ...residentIdentity(agent, index), hairStyle: look.hairStyle, skin: look.skin, jacket: look.jacket };
    figure.mesh.boundingSphere = FIGURE_BOUNDS.clone();
    figure.mesh.frustumCulled = true;
    group.add(figure.group);
    return {
      agent, figure, gait: createHumanGait() as HumanGait, pose: createFigurePose() as FigurePose, x: NaN, z: NaN,
      /** The drawn heading (last frame's, for making way). */
      heading: NaN,
      /** 1 walking on, 0 stopped to make way; and the route time lost to making way, so far. */
      flow: 1, paused: 0,
    };
  });
  let lastTime = NaN;
  function update(time: number, reduced: boolean, viewpoint?: THREE.Vector3, courier?: Readonly<{ x: number; z: number }> | null): void {
    const t = reduced || !Number.isFinite(time) ? 0 : time;
    const dt = Number.isFinite(lastTime) ? Math.min(0.2, Math.max(0, t - lastTime)) : 0;
    lastTime = t;
    for (const person of people) {
      const { agent, figure, gait, pose } = person;
      // Making way: a walker with the courier standing in its path eases to a stop, and walks on once she has gone.
      // The route clock only loses the time spent stopped, so with no one in the way it keeps the scene's time.
      if (!reduced && dt > 0 && !agent.stationary && Number.isFinite(person.heading)) {
        let target = 1;
        if (courier) {
          const fx = Math.sin(person.heading), fz = -Math.cos(person.heading);
          const dx = courier.x - person.x, dz = courier.z - person.z;
          const along = dx * fx + dz * fz;
          if (along > 0 && along < MAKE_WAY.ahead * agent.scale && Math.abs(dx * fz - dz * fx) < MAKE_WAY.across) target = 0;
        }
        person.flow += (target - person.flow) * (1 - Math.exp(-MAKE_WAY.rate * dt));
        if (person.flow > 0.999) person.flow = 1;
        person.paused += (1 - person.flow) * dt;
      }
      const placed = poseAt(agent, reduced ? 0 : t - person.paused);
      person.heading = placed.heading;
      const near = !viewpoint || Math.hypot(placed.x - viewpoint.x, placed.z - viewpoint.z) <= RESIDENT_VIEW_DISTANCE;
      figure.group.visible = near;
      const distance = Number.isFinite(person.x) ? Math.hypot(placed.x - person.x, placed.z - person.z) : 0;
      person.x = placed.x;
      person.z = placed.z;
      const ground = world.surfaceAt(placed.x, placed.z);
      const y = ground.walkable ? ground.height : agent.route.height;
      figure.group.position.set(placed.x, y, placed.z);
      figure.group.rotation.set(0, -person.heading, 0);
      if (!near && !reduced) continue;
      // A frame's step can only be a stroll's worth: anything longer (a time jump, the first frame) is not walking.
      const stepping = dt > 0 && distance <= agent.speed * dt * 1.5 + 1e-6;
      updateHumanGait(gait, {
        dt: dt > 0 ? dt : 1 / 60, distance: stepping ? distance : 0, speed: stepping && dt > 0 ? distance / dt : 0,
        heading: person.heading, y, reduced, scale: figure.scale, pace: figure.pace, leg: figure.leg,
      });
      // Independent scene-clock phases prevent the whole crowd breathing and blinking in unison.
      gait.time = t + agent.phase;
      const drawnPose = humanPose(gait, pose, figure.leg);
      drawnPose.eyes = 1; // the shared face helper owns the staggered blink, rather than combining two blink clocks
      poseFigure(figure, drawnPose);
      animateFigureExpression(figure, t, reduced, agent.phase);
    }
  }
  update(0, false);
  function blocks(x: number, z: number, radius: number): boolean {
    for (const person of people) {
      if (!person.figure.group.visible || !Number.isFinite(person.x)) continue;
      const reach = radius + RESIDENT_BODY * person.agent.scale;
      if ((x - person.x) ** 2 + (z - person.z) ** 2 < reach * reach) return true;
    }
    return false;
  }
  return {
    group, agents, update, blocks,
    dispose() {
      for (const person of people) person.figure.mesh.skeleton.dispose();
    },
  };
}
