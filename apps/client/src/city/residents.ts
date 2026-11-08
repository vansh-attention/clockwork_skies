import * as THREE from "three";
import { SeededRandom } from "@clockwork/shared";
import { createHillTownWalkWorld, type WalkWorld } from "../courier/walkWorld";
import { DISTRICTS } from "./districts";
import { bearingOf, createCityLayout, polarToXZ, STREET, TERRACES, type CityLayout, type Landmark } from "./layout";
import { seededSequence, type MaterialSource } from "./kit";
import { createFigure, createFigureMaterial, createFigurePose, poseFigure, type Figure, type FigureLook, type FigurePose } from "../courier/figure";
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
  update(time: number, reduced: boolean, viewpoint?: THREE.Vector3): void;
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
        facing: Math.atan2(point.x - landmark.x, point.z - landmark.z),
        coat: ((landmark.district + slot) % 3) as 0 | 1 | 2,
        scale: random.range(0.86, 1.08), cap: random.next() > 0.25,
        speed: random.range(1.7, 2.35), phase: random.range(0, 25),
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
  if (t < duration) { progress = t / duration; turn = 0; walking = true; }
  else if (t < duration + TURN_SECONDS) { progress = 1; turn = (t - duration) / TURN_SECONDS; walking = false; }
  else if (t < duration * 2 + TURN_SECONDS) { progress = 1 - (t - duration - TURN_SECONDS) / duration; turn = 1; walking = true; }
  else { progress = 0; turn = 1 + (t - duration * 2 - TURN_SECONDS) / TURN_SECONDS; walking = false; }
  // Eased turns happen at rest, leaving the validated route unchanged.
  const whole = Math.floor(turn);
  const fraction = turn - whole;
  const easedTurn = whole + fraction * fraction * (3 - 2 * fraction);
  const point = pointAlongRoute(route, progress);
  return { x: point.x, z: point.z, heading: Math.atan2(-point.tangentX, -point.tangentZ) + easedTurn * Math.PI, walking };
}

/** Everyday London dress, mixed per resident from a seeded hand: coats, trousers, hair and skin of many tones. */
const SKINS = ["#f1caa9", "#e3b493", "#cf9b77", "#b07a57", "#8a5a3c", "#6a4129"] as const;
const HAIRS = ["#2e2420", "#4a3426", "#6b4a32", "#9a7a55", "#b5aea2", "#1f1c1b", "#8a3f2a"] as const;
const COATS: readonly (readonly [jacket: string, trim: string])[] = [
  ["#3c4b63", "#2e3a4d"], ["#a8865a", "#8a6c46"], ["#4e5458", "#3c4144"], ["#5f6b45", "#4b5536"],
  ["#7c3f42", "#633235"], ["#2f5a5e", "#244749"], ["#b9a789", "#9a8a6f"], ["#c36a44", "#a3573a"],
] as const;
const TROUSERS = ["#2d3236", "#3a4a5e", "#5c5248", "#2f3f3a", "#6d6a62", "#1f2a33"] as const;
const SHOES = ["#2a2422", "#3b2c27", "#4a4038", "#1d1d1f"] as const;
const CAPS = ["#5b5d61", "#4a4136", "#3a4450"] as const;

export function residentLook(agent: ResidentAgent, index: number): FigureLook {
  const random = seededSequence(index * 7919 + agent.district * 104729 + 0x5ca1e);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length) % list.length]!;
  const [jacket, trim] = COATS[(agent.coat * 3 + Math.floor(random() * 3) + index) % COATS.length]!;
  const hairStyle = (["short", "bob", "bun"] as const)[Math.floor(random() * 3)]!;
  return {
    scale: agent.scale * 0.97,
    build: 0.9 + random() * 0.2,
    skin: pick(SKINS), hair: pick(HAIRS), hairStyle,
    jacket, trim, trousers: pick(TROUSERS), socks: "#d9d3c4", shoes: pick(SHOES),
    cap: agent.cap && hairStyle === "short" ? pick(CAPS) : undefined,
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
  const people = agents.map((agent, index) => {
    const figure: Figure = createFigure(residentLook(agent, index), material);
    figure.group.name = agent.id;
    figure.mesh.boundingSphere = FIGURE_BOUNDS.clone();
    figure.mesh.frustumCulled = true;
    group.add(figure.group);
    return { agent, figure, gait: createHumanGait() as HumanGait, pose: createFigurePose() as FigurePose, x: NaN, z: NaN };
  });
  let lastTime = NaN;
  function update(time: number, reduced: boolean, viewpoint?: THREE.Vector3): void {
    const t = reduced || !Number.isFinite(time) ? 0 : time;
    const dt = Number.isFinite(lastTime) ? Math.min(0.2, Math.max(0, t - lastTime)) : 0;
    lastTime = t;
    for (const person of people) {
      const { agent, figure, gait, pose } = person;
      const placed = poseAt(agent, t);
      const near = !viewpoint || Math.hypot(placed.x - viewpoint.x, placed.z - viewpoint.z) <= RESIDENT_VIEW_DISTANCE;
      figure.group.visible = near;
      const distance = Number.isFinite(person.x) ? Math.hypot(placed.x - person.x, placed.z - person.z) : 0;
      person.x = placed.x;
      person.z = placed.z;
      figure.group.position.set(placed.x, agent.route.height, placed.z);
      figure.group.rotation.set(0, -placed.heading, 0);
      if (!near && !reduced) continue;
      // A frame's step can only be a stroll's worth: anything longer (a time jump, the first frame) is not walking.
      const stepping = dt > 0 && distance <= agent.speed * dt * 1.5 + 1e-6;
      updateHumanGait(gait, {
        dt: dt > 0 ? dt : 1 / 60, distance: stepping ? distance : 0, speed: stepping && dt > 0 ? distance / dt : 0,
        heading: placed.heading, y: agent.route.height, reduced, scale: figure.scale,
      });
      poseFigure(figure, humanPose(gait, pose, figure.leg));
    }
  }
  update(0, false);
  return {
    group, agents, update,
    dispose() {
      for (const person of people) person.figure.mesh.skeleton.dispose();
    },
  };
}
