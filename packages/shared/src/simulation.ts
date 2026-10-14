import { angularDistance, clamp, damp, rotateAroundAxis, tangentBasis, V, type Vec3 } from "./math.js";
import { MATCH_RULES, type MatchRules } from "./rules.js";
import type { AircraftState, InputCommand, PickupState, StormState } from "./types.js";

export const NEUTRAL_INPUT: InputCommand = {
  version: 1,
  sequence: 0,
  clientTime: 0,
  aimX: 0,
  aimY: 0,
  throttle: 0,
  fineRoll: 0,
  cannon: false,
  rocket: false,
  rocketTargetId: null,
  boost: false,
  rearView: false,
  ping: null,
  emote: 0,
};

export function createAircraft(position: Vec3, forward: Vec3, rules: MatchRules = MATCH_RULES): AircraftState {
  const basis = tangentBasis(position, forward);
  return {
    position: V.clone(position),
    velocity: V.scale(basis.forward, rules.aircraft.cruiseSpeed),
    forward: basis.forward,
    speed: rules.aircraft.cruiseSpeed,
    throttle: 0.55,
    hull: rules.aircraft.hull,
    shield: 0,
    cannonHeat: 0,
    rockets: 2,
    boost: rules.aircraft.boostCapacity,
    spawnProtection: 3,
    lastInputSequence: 0,
  };
}

export type FlightStepResult = { collided: boolean; collisionDamage: number; outsideStorm: boolean };

export function stepAircraft(
  aircraft: AircraftState,
  input: InputCommand,
  dt: number,
  storm?: StormState,
  rules: MatchRules = MATCH_RULES,
): FlightStepResult {
  if (!Number.isFinite(dt) || dt <= 0) return { collided: false, collisionDamage: 0, outsideStorm: false };
  // Both 20 Hz authority and 30 Hz commands integrate on the same 60 Hz grid.
  const steps = Math.max(1, Math.ceil(dt * 60 - 1e-9));
  const result: FlightStepResult = { collided: false, collisionDamage: 0, outsideStorm: false };
  for (let i = 0; i < steps; i++) {
    const next = integrateAircraft(aircraft, input, dt / steps, storm, rules);
    result.collided ||= next.collided;
    result.collisionDamage = Math.max(result.collisionDamage, next.collisionDamage);
    result.outsideStorm = next.outsideStorm;
  }
  return result;
}

function integrateAircraft(aircraft: AircraftState, input: InputCommand, dt: number, storm: StormState | undefined, rules: MatchRules): FlightStepResult {
  const { up, forward, right } = tangentBasis(aircraft.position, aircraft.forward);
  const throttleTarget = clamp((input.throttle + 1) * 0.5, 0, 1);
  aircraft.throttle = damp(aircraft.throttle, throttleTarget, 4, dt);

  const yaw = -clamp(input.aimX + input.fineRoll * 0.35, -1, 1) * rules.aircraft.turnRate * dt;
  const previousPitch = Math.asin(clamp(V.dot(V.normalize(aircraft.forward), up), -0.48, 0.48));
  const pitch = damp(previousPitch, -input.aimY * rules.aircraft.pitchRate * 0.55, 3.5, dt);
  const tangentForward = rotateAroundAxis(forward, up, yaw);
  const nextForward = V.normalize(V.add(V.scale(tangentForward, Math.cos(pitch)), V.scale(up, Math.sin(pitch))));
  aircraft.forward = nextForward;

  const baseTargetSpeed = rules.aircraft.minSpeed + aircraft.throttle * (rules.aircraft.maxSpeed - rules.aircraft.minSpeed);
  const boosting = input.boost && aircraft.boost > 0;
  const targetSpeed = baseTargetSpeed * (boosting ? rules.aircraft.boostMultiplier : 1);
  aircraft.speed = damp(aircraft.speed, targetSpeed, rules.aircraft.acceleration / rules.aircraft.maxSpeed, dt);
  aircraft.boost = clamp(
    aircraft.boost + (boosting ? -rules.aircraft.boostDrainPerSecond : rules.aircraft.boostRechargePerSecond) * dt,
    0,
    rules.aircraft.boostCapacity,
  );
  aircraft.spawnProtection = Math.max(0, aircraft.spawnProtection - dt);
  aircraft.cannonHeat = Math.max(0, aircraft.cannonHeat - rules.cannon.coolPerSecond * dt);
  aircraft.velocity = V.scale(nextForward, aircraft.speed);
  aircraft.position = V.add(aircraft.position, V.scale(aircraft.velocity, dt));
  // Transport orientation with the spherical surface; preserve inclination rather
  // than interpreting curvature as a new pitch input or discarding pitch each tick.
  const nextUp = V.normalize(aircraft.position);
  const transportedTangent = V.normalize(V.projectOnPlane(nextForward, nextUp), tangentForward);
  aircraft.forward = V.normalize(V.add(V.scale(transportedTangent, Math.cos(pitch)), V.scale(nextUp, Math.sin(pitch))));
  aircraft.lastInputSequence = Math.max(aircraft.lastInputSequence, input.sequence);

  const radius = V.length(aircraft.position);
  const minRadius = rules.planetRadius + rules.minAltitude;
  const maxRadius = rules.planetRadius + rules.maxAltitude;
  let collided = false;
  let collisionDamage = 0;
  if (radius < minRadius) {
    collided = true;
    collisionDamage = clamp((minRadius - radius) * 1.5 + Math.max(0, aircraft.speed - rules.aircraft.minSpeed) * 0.12, 4, 45);
    aircraft.position = V.scale(V.normalize(aircraft.position), minRadius);
    aircraft.forward = V.normalize(V.projectOnPlane(aircraft.forward, V.normalize(aircraft.position)));
    aircraft.speed = Math.max(rules.aircraft.minSpeed, aircraft.speed * 0.65);
  } else if (radius > maxRadius) {
    aircraft.position = V.scale(V.normalize(aircraft.position), maxRadius);
    aircraft.forward = V.normalize(V.projectOnPlane(aircraft.forward, V.normalize(aircraft.position)));
  }

  const outsideStorm = storm ? angularDistance(aircraft.position, storm.center) > storm.angularRadius : false;
  return { collided, collisionDamage, outsideStorm };
}

export function applyDamage(aircraft: AircraftState, amount: number) {
  if (aircraft.spawnProtection > 0 || !Number.isFinite(amount) || amount <= 0) return 0;
  const shieldDamage = Math.min(aircraft.shield, amount);
  aircraft.shield -= shieldDamage;
  const hullDamage = Math.min(aircraft.hull, amount - shieldDamage);
  aircraft.hull = Math.max(0, aircraft.hull - hullDamage);
  return shieldDamage + hullDamage;
}

export function applyPickup(aircraft: AircraftState, pickup: PickupState, rules: MatchRules = MATCH_RULES) {
  const amount = rules.pickups[pickup.type].amount;
  if (pickup.type === "repair") aircraft.hull = Math.min(rules.aircraft.hull, aircraft.hull + amount);
  if (pickup.type === "rockets") aircraft.rockets = Math.min(6, aircraft.rockets + amount);
  if (pickup.type === "boost") aircraft.boost = Math.min(rules.aircraft.boostCapacity, aircraft.boost + amount);
  if (pickup.type === "shield") aircraft.shield = Math.min(60, aircraft.shield + amount);
}

export function stormRadiusAt(storm: StormState, now: number) {
  const duration = Math.max(1, storm.phaseEndsAt - storm.phaseStartedAt);
  const t = clamp((now - storm.phaseStartedAt) / duration, 0, 1);
  return storm.startRadius + (storm.targetRadius - storm.startRadius) * (t * t * (3 - 2 * t));
}

export function stormCenterAt(storm: StormState, now: number) {
  const duration = Math.max(1, storm.phaseEndsAt - storm.phaseStartedAt);
  const t = clamp((now - storm.phaseStartedAt) / duration, 0, 1);
  return V.normalize(V.lerp(storm.startCenter, storm.nextCenter, t * t * (3 - 2 * t)));
}
