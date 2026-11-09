import { fit, lerp, lerpFPS, shortestAngle, stepSpring, type Spring } from "../motion/ease";
import { WALK } from "./walker";

/**
 * The courier's procedural gait: turns what the drawn courier is doing (speed, ground covered, turning, height) into
 * joint angles. Pure and frame-rate independent; the model applies the pose (models.ts).
 *
 * Angle conventions, in the model's own frame (facing -Z):
 * - a positive limb angle (rotation.x) swings a hanging limb forward; knees bend with negative angles;
 * - torsoPitch < 0 leans forward; torsoRoll < 0 leans to the courier's right (+X).
 */

export type GaitInput = {
  /** Frame time in seconds. */
  dt: number;
  /** Horizontal ground covered this frame. The stride advances with distance, so pushing a wall does not march. */
  distance: number;
  /** Current walking speed, units per second. */
  speed: number;
  /** Drawn heading (radians, 0 faces -Z, positive turns toward +X). */
  heading: number;
  /** Drawn height of the feet. */
  y: number;
  reduced: boolean;
  /** Off the ground (mid-jump): the legs tuck, the arms rise and the stride holds. */
  airborne?: boolean;
  /** The compact courier takes relaxed, rounded steps; the legacy wind-up rig retains its original cadence. */
  compact?: boolean;
};

export type LegPose = { hip: number; knee: number };
export type ArmPose = { swing: number; spread: number };
export type CourierPose = {
  /** Added to the rest hip height (never positive: the body dips as each foot lands). */
  hipsY: number;
  /** Side-to-side wind-up waddle of the hips. */
  hipsRoll: number;
  /** Body scale offset: negative squashes (y) and widens (x, z). */
  squash: number;
  torsoPitch: number;
  torsoRoll: number;
  /** Idle breathing, a small scale offset for the torso. */
  breathe: number;
  headPitch: number;
  headYaw: number;
  legs: [LegPose, LegPose];
  arms: [ArmPose, ArmPose];
};

export type Gait = {
  /** Stride phase in [0, 2PI): the left foot is furthest forward at PI/2. */
  phase: number;
  /** Eased 0..1 weights: how much the courier is walking, and how much of that is running. */
  move: number;
  run: number;
  lean: number;
  roll: number;
  look: number;
  idleTime: number;
  time: number;
  lastSpeed: number;
  lastHeading: number;
  lastY: number;
  lastVy: number;
  /** Eased 0..1: how much of the airborne pose shows. */
  air: number;
  /** Eased vertical speed while airborne: rising reaches up, falling braces for the landing. */
  airVy: number;
  squash: Spring;
  initialized: boolean;
  reduced: boolean;
};

const TAU = Math.PI * 2;
/** Ground covered per full stride cycle (two steps), walking and running. */
const WALK_CYCLE = 4.4;
const RUN_CYCLE = 6.4;
const MAX_TURN_RATE = 6;
const SQUASH_OMEGA = 16;
const SQUASH_ZETA = 0.35;
/** Squash spring kick per unit/s of descent stopped, and the most one frame may add. */
const SQUASH_KICK = 0.22;
const SQUASH_KICK_MAX = 2.5;
const FALLING = -1.5;
/** A sudden climb this fast (a take-off) stretches the body; the stretch kick per unit/s, capped. */
const TAKEOFF = 4;
const STRETCH_KICK = 0.12;
const STRETCH_KICK_MAX = 1.2;

export function createGait(): Gait {
  return {
    phase: 0, move: 0, run: 0, lean: 0, roll: 0, look: 0, idleTime: 0, time: 0,
    lastSpeed: 0, lastHeading: 0, lastY: 0, lastVy: 0, air: 0, airVy: 0,
    squash: { value: 0, velocity: 0 }, initialized: false, reduced: false,
  };
}

/** Forget rates after a teleport, spawn or landing, so the jump is not read as a turn or a fall. */
export function resetGait(gait: Gait, heading: number, y: number): void {
  gait.lastHeading = Number.isFinite(heading) ? heading : 0;
  gait.lastY = Number.isFinite(y) ? y : 0;
  gait.lastVy = 0;
  gait.air = 0;
  gait.airVy = 0;
  gait.roll = 0;
  gait.squash.value = 0;
  gait.squash.velocity = 0;
  gait.initialized = true;
}

export function updateGait(gait: Gait, input: GaitInput): void {
  const { dt } = input;
  if (!Number.isFinite(dt) || dt <= 0) return;
  const speed = Number.isFinite(input.speed) ? Math.max(0, input.speed) : 0;
  const heading = Number.isFinite(input.heading) ? input.heading : gait.lastHeading;
  const y = Number.isFinite(input.y) ? input.y : gait.lastY;
  const distance = Number.isFinite(input.distance) ? Math.max(0, input.distance) : 0;
  if (!gait.initialized) resetGait(gait, heading, y);
  gait.reduced = input.reduced;
  gait.time += dt;
  const airborne = input.airborne === true;
  // Tuck quickly on take-off; let go a little slower on landing so the squash reads first.
  gait.air = lerpFPS(gait.air, airborne ? 1 : 0, airborne ? 0.35 : 0.25, dt);

  gait.move = lerpFPS(gait.move, fit(speed, 0.4, WALK.walkSpeed * 0.6, 0, 1), 0.15, dt);
  gait.run = lerpFPS(gait.run, fit(speed, WALK.walkSpeed, WALK.runSpeed, 0, 1), 0.1, dt);
  // The stride holds in the air, so the feet come down where they left off.
  const cycle = input.compact ? lerp(5.5, 6.6, gait.run) : lerp(WALK_CYCLE, RUN_CYCLE, gait.run);
  gait.phase = (gait.phase + ((distance * (1 - gait.air)) / cycle) * TAU) % TAU;

  // Lean forward with speed, more while speeding up, less while slowing.
  const accel = (speed - gait.lastSpeed) / dt;
  const leanTarget = gait.move * 0.05 + gait.run * 0.08 + Math.min(0.22, Math.max(-0.15, accel * 0.02));
  gait.lean = lerpFPS(gait.lean, leanTarget, 0.12, dt);

  // Bank into turns, in proportion to speed (turning on the spot stays upright).
  const turnRate = Math.min(MAX_TURN_RATE, Math.max(-MAX_TURN_RATE, shortestAngle(gait.lastHeading, heading) / dt));
  const rollTarget = Math.min(0.25, Math.max(-0.25, -turnRate * speed * 0.012));
  gait.roll = lerpFPS(gait.roll, rollTarget, 0.15, dt);

  // Stand still a while and the courier starts to look about.
  gait.idleTime = gait.move < 0.05 ? gait.idleTime + dt : 0;
  const lookTarget = Math.sin(Math.max(0, gait.idleTime - 1.5) * 0.7) * 0.35 * fit(gait.idleTime, 1.5, 3.5, 0, 1);
  gait.look = lerpFPS(gait.look, lookTarget, 0.06, dt);

  // Stopping a descent (stepping down, landing) kicks a bouncy squash spring.
  const vy = (y - gait.lastY) / dt;
  if (gait.lastVy < FALLING && vy > gait.lastVy) {
    gait.squash.velocity -= Math.min(SQUASH_KICK_MAX, (vy - gait.lastVy) * SQUASH_KICK);
  } else if (airborne && vy > TAKEOFF && gait.lastVy < TAKEOFF * 0.5) {
    gait.squash.velocity += Math.min(STRETCH_KICK_MAX, (vy - Math.max(0, gait.lastVy)) * STRETCH_KICK);
  }
  gait.airVy = airborne ? lerpFPS(gait.airVy, vy, 0.3, dt) : 0;
  stepSpring(gait.squash, 0, SQUASH_OMEGA, SQUASH_ZETA, dt);

  gait.lastSpeed = speed;
  gait.lastHeading = heading;
  gait.lastY = y;
  gait.lastVy = vy;
}

export function createPose(): CourierPose {
  return {
    hipsY: 0, hipsRoll: 0, squash: 0, torsoPitch: 0, torsoRoll: 0, breathe: 0, headPitch: 0, headYaw: 0,
    legs: [{ hip: 0, knee: 0 }, { hip: 0, knee: 0 }],
    arms: [{ swing: 0, spread: 0.1 }, { swing: 0, spread: 0.1 }],
  };
}

/** The joint angles for the gait's current state, written into `out` (a fresh pose by default). */
export function gaitPose(gait: Gait, out: CourierPose = createPose()): CourierPose {
  const [left, right] = out.legs;
  const [leftArm, rightArm] = out.arms;
  if (gait.reduced) {
    out.hipsY = 0; out.hipsRoll = 0; out.squash = 0; out.torsoPitch = 0; out.torsoRoll = 0;
    out.breathe = 0; out.headPitch = 0; out.headYaw = 0;
    left.hip = 0; left.knee = 0; right.hip = 0; right.knee = 0;
    leftArm.swing = 0; rightArm.swing = 0; leftArm.spread = 0.1; rightArm.spread = 0.1;
    return out;
  }
  const { move, run, phase } = gait;
  const sin = Math.sin(phase);
  const cos = Math.cos(phase);

  const legSwing = lerp(0.6, 0.95, run) * move;
  const kneeBend = lerp(0.55, 1.15, run) * move;
  const kneeBase = 0.12 * run * move;
  left.hip = sin * legSwing;
  right.hip = -sin * legSwing;
  // The knee folds while its leg swings forward (the derivative of the hip angle is positive).
  const lift = (amount: number) => { const t = Math.max(0, amount); return t * t * (3 - 2 * t); };
  left.knee = -kneeBend * lift(cos) - kneeBase;
  right.knee = -kneeBend * lift(-cos) - kneeBase;

  const armSwing = lerp(0.45, 0.85, run) * move;
  leftArm.swing = -sin * armSwing;
  rightArm.swing = sin * armSwing;
  leftArm.spread = 0.1 + 0.12 * run;
  rightArm.spread = leftArm.spread;

  // The body is highest when a leg passes under it and dips as each foot lands (twice per cycle).
  out.hipsY = lerp(0.14, 0.3, run) * move * (0.5 * Math.cos(2 * phase) - 0.5);
  out.hipsRoll = sin * lerp(0.07, 0.04, run) * move;
  out.squash = Math.min(0.15, Math.max(-0.25, gait.squash.value));
  out.torsoPitch = -gait.lean;
  out.torsoRoll = gait.roll;
  out.breathe = Math.sin(gait.time * 2.4) * 0.025 * (1 - move);
  // The head steadies itself against the lean and nods a little with each step.
  out.headPitch = gait.lean * 0.5 - 0.04 * Math.cos(2 * phase) * move;
  out.headYaw = gait.look;
  if (gait.air > 1e-3) blendAirPose(out, gait.air, fit(gait.airVy, 6, -8, 0, 1));
  return out;
}

/**
 * Mix the jump pose in by `air` (0..1). `fall` (0 rising .. 1 falling fast) moves it from the take-off (lead knee up,
 * trailing leg pushed back, arms thrown up) toward the landing brace (both knees out front, arms spread wide).
 */
function blendAirPose(out: CourierPose, air: number, fall: number): void {
  const [left, right] = out.legs;
  const [leftArm, rightArm] = out.arms;
  left.hip = lerp(left.hip, lerp(0.75, 0.45, fall), air);
  left.knee = lerp(left.knee, lerp(-1.25, -0.7, fall), air);
  right.hip = lerp(right.hip, lerp(-0.35, 0.3, fall), air);
  right.knee = lerp(right.knee, lerp(-0.85, -0.6, fall), air);
  leftArm.swing = lerp(leftArm.swing, lerp(-0.9, -0.35, fall), air);
  rightArm.swing = lerp(rightArm.swing, lerp(0.55, -0.35, fall), air);
  leftArm.spread = lerp(leftArm.spread, lerp(0.35, 0.8, fall), air);
  rightArm.spread = lerp(rightArm.spread, lerp(0.35, 0.8, fall), air);
  out.hipsY = lerp(out.hipsY, 0, air);
  out.hipsRoll = lerp(out.hipsRoll, 0, air);
  out.torsoPitch = lerp(out.torsoPitch, lerp(-0.12, 0.06, fall), air);
  out.headPitch = lerp(out.headPitch, lerp(0.1, -0.12, fall), air);
  out.breathe = lerp(out.breathe, 0, air);
}
