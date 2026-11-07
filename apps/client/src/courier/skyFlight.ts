import { MATCH_RULES, V, clamp, damp } from "@clockwork/shared";
import type { InputCommand, Vec3 } from "@clockwork/shared";

export type FlightInput = Pick<InputCommand, "aimX" | "aimY" | "throttle" | "fineRoll" | "boost">;

export type SkyPlane = {
  position: Vec3;
  yaw: number;
  pitch: number;
  bank: number;
  speed: number;
  throttle: number;
  boost: number;
  /** Set when boost runs dry; boost stays off until the button is released or the gauge refills to BOOST_RELOCK. */
  boostLocked: boolean;
  /** Seconds until another island contact may count as a new bump. */
  bumpCooldown: number;
};

/** A floating island as a solid: a disc of `radius` whose top is `top` above `y`, over a rock cone reaching `depth` below `y`. */
export type SolidIsland = { x: number; y: number; z: number; radius: number; top: number; depth: number };

/** Islands should sit fully inside [floor, ceiling]: floor < y − depth and y + top + 6 < ceiling. */
export type SkyWorld = { islands: readonly SolidIsland[]; edgeRadius: number; floor: number; ceiling: number };

/**
 * `bumped` fires once per impact (then cools down for BUMP_COOLDOWN seconds) — use it for one-shot effects.
 * `contact` is true whenever the plane was pushed out of an island during the call — use it for continuous scraping.
 */
export type FlightStep = { bumped: boolean; contact: boolean; turningBack: boolean };

const FIXED_STEP = 1 / 60;
const MAX_SUBSTEPS = 600;
const EPSILON = 1e-9;
const FINE_ROLL_WEIGHT = 0.35;
const PITCH_SHARPNESS = 3.5;
const PITCH_PER_AIM = 0.55;
const MAX_PITCH = 0.5;
const THROTTLE_SHARPNESS = 4;
const BANK_SHARPNESS = 4;
const BUMP_SPEED_FACTOR = 0.6;
const ISLAND_MARGIN = 4;
const ISLAND_HEADROOM = 6;
/** Pushed-out planes rest this far clear of the surface so the next substep does not re-test as inside. */
const CLEARANCE = 0.01;
const BUMP_COOLDOWN = 0.4;
/** Boost gauge level at which a dry, held boost re-engages. */
export const BOOST_RELOCK = 15;

export function createSkyPlane(position: Vec3, yaw: number): SkyPlane {
  return {
    position: V.clone(position),
    yaw,
    pitch: 0,
    bank: 0,
    speed: MATCH_RULES.aircraft.cruiseSpeed,
    throttle: 0.55,
    boost: MATCH_RULES.aircraft.boostCapacity,
    boostLocked: false,
    bumpCooldown: 0,
  };
}

/** Signed smallest rotation from angle `from` to angle `to`, in (−π, π]. Use it when easing a camera toward the plane's yaw. */
export function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** Finite value clamped to [−1, 1]; NaN and ±Infinity from a bad device become 0. */
const axis = (value: number): number => (Number.isFinite(value) ? clamp(value, -1, 1) : 0);

export function skyForward(plane: SkyPlane): Vec3 {
  const cosPitch = Math.cos(plane.pitch);
  return {
    x: Math.sin(plane.yaw) * cosPitch,
    y: Math.sin(plane.pitch),
    z: -Math.cos(plane.yaw) * cosPitch,
  };
}

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Push the plane out of one island by the shortest route that stays inside the world. Returns true when it was inside. */
function resolveIsland(plane: SkyPlane, island: SolidIsland, world: SkyWorld): boolean {
  const p = plane.position;
  const dx = p.x - island.x;
  const dz = p.z - island.z;
  const distance = Math.hypot(dx, dz);
  const reach = island.radius + ISLAND_MARGIN;
  if (distance >= reach) return false;

  const ceilingY = island.y + island.top + ISLAND_HEADROOM;
  const rockDepth = island.radius > 0 ? island.depth * Math.max(0, 1 - distance / island.radius) : 0;
  const undersideY = island.y - rockDepth;
  if (p.y <= undersideY || p.y >= ceilingY) return false;

  // A vertical exit the world's floor/ceiling clamp would undo is not an exit at all.
  const costUp = ceilingY + CLEARANCE <= world.ceiling ? ceilingY - p.y : Infinity;
  const costDown = undersideY - CLEARANCE >= world.floor ? p.y - undersideY : Infinity;
  const costOut = reach - distance;
  if (costUp <= costDown && costUp <= costOut) {
    p.y = ceilingY + CLEARANCE;
  } else if (costDown <= costOut) {
    p.y = undersideY - CLEARANCE;
  } else {
    // Outward direction from the island centre; fall back to the reverse of travel when dead centre.
    const nx = distance > EPSILON ? dx / distance : -Math.sin(plane.yaw);
    const nz = distance > EPSILON ? dz / distance : Math.cos(plane.yaw);
    p.x = island.x + nx * (reach + CLEARANCE);
    p.z = island.z + nz * (reach + CLEARANCE);
  }
  return true;
}

function substep(plane: SkyPlane, input: FlightInput, dt: number, world: SkyWorld, result: FlightStep): void {
  const rules = MATCH_RULES.aircraft;
  const p = plane.position;

  // Steering: player input, or an override toward the origin beyond the world edge.
  let steer = clamp(axis(input.aimX) + axis(input.fineRoll) * FINE_ROLL_WEIGHT, -1, 1);
  const fromOrigin = Math.hypot(p.x, p.z);
  if (fromOrigin > world.edgeRadius) {
    result.turningBack = true;
    const towardOrigin = Math.atan2(-p.x, p.z);
    const error = wrapAngle(towardOrigin - plane.yaw);
    const maxTurn = rules.turnRate * dt;
    plane.yaw += clamp(error, -maxTurn, maxTurn);
    steer = clamp(error, -1, 1);
  } else {
    plane.yaw += steer * rules.turnRate * dt;
  }
  if (Math.abs(plane.yaw) > Math.PI) plane.yaw = wrapAngle(plane.yaw);
  plane.bank = damp(plane.bank, steer, BANK_SHARPNESS, dt);

  const pitchTarget = clamp(-axis(input.aimY) * PITCH_PER_AIM, -MAX_PITCH, MAX_PITCH);
  plane.pitch = clamp(damp(plane.pitch, pitchTarget, PITCH_SHARPNESS, dt), -MAX_PITCH, MAX_PITCH);

  plane.throttle = damp(plane.throttle, (axis(input.throttle) + 1) / 2, THROTTLE_SHARPNESS, dt);

  // A dry boost stays off (no on/off flicker at an empty gauge) until released or refilled.
  if (plane.boostLocked && (!input.boost || plane.boost >= BOOST_RELOCK)) plane.boostLocked = false;
  const boosting = input.boost && !plane.boostLocked && plane.boost > 0;
  const baseSpeed = rules.minSpeed + plane.throttle * (rules.maxSpeed - rules.minSpeed);
  const targetSpeed = boosting ? baseSpeed * rules.boostMultiplier : baseSpeed;
  plane.speed = damp(plane.speed, targetSpeed, rules.acceleration / rules.maxSpeed, dt);
  plane.boost = clamp(
    plane.boost + (boosting ? -rules.boostDrainPerSecond : rules.boostRechargePerSecond) * dt,
    0,
    rules.boostCapacity,
  );
  if (boosting && plane.boost <= 0) plane.boostLocked = true;

  const cosPitch = Math.cos(plane.pitch);
  const travel = plane.speed * dt;
  p.x += Math.sin(plane.yaw) * cosPitch * travel;
  p.y += Math.sin(plane.pitch) * travel;
  p.z += -Math.cos(plane.yaw) * cosPitch * travel;

  plane.bumpCooldown = Math.max(0, plane.bumpCooldown - dt);
  let contact = false;
  for (const island of world.islands) {
    if (resolveIsland(plane, island, world)) contact = true;
  }
  if (contact) {
    result.contact = true;
    // Only a fresh impact costs speed and counts as a bump; scraping along a rim does not repeat it.
    if (plane.bumpCooldown <= 0) {
      plane.speed = Math.max(rules.minSpeed, plane.speed * BUMP_SPEED_FACTOR);
      result.bumped = true;
    }
    plane.bumpCooldown = BUMP_COOLDOWN;
  }

  p.y = clamp(p.y, world.floor, world.ceiling);
}

/**
 * Advance the plane by `dt` seconds, in 1/60 s substeps plus any remainder.
 * Pass exactly 1/60 from a fixed clock (as the courier controller does): results only repeat exactly for identical dt sequences.
 */
export function stepSkyPlane(plane: SkyPlane, input: FlightInput, dt: number, world: SkyWorld): FlightStep {
  const result: FlightStep = { bumped: false, contact: false, turningBack: false };
  if (!Number.isFinite(dt) || dt <= 0) return result;

  let remaining = Math.min(dt, MAX_SUBSTEPS * FIXED_STEP);
  while (remaining > EPSILON) {
    const h = Math.min(FIXED_STEP, remaining);
    substep(plane, input, h, world, result);
    remaining -= h;
  }
  return result;
}
