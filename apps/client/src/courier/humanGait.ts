import { fit, lerp, lerpFPS, shortestAngle, stepSpring, type Spring } from "../motion/ease";
import { BASE_LEG, createFigurePose, type FigurePose, type LegDimensions } from "./figure";

/**
 * How a drawn person walks, jogs, runs, stands and jumps: pure, frame-rate independent, and fed by what the person is
 * doing (ground covered, speed, turning, height). It writes joint angles for figure.ts.
 *
 * The gaits are keyframed from how people actually move rather than from sine waves: the hip flexes before heel strike
 * and extends through stance, the knee takes a small bend as weight comes on and a deep one in swing, and the foot rolls
 * heel to toe. The hips' height comes from the legs themselves (the supporting leg reaches the ground, with a little
 * float in a run's flight), and each gait's stride is measured from how far the planted foot travels, so feet do not
 * slide. Idle, walk, jog and run blend by speed, with weights that ease in and out (as the reference's animation
 * weights were seen to: about 0.7 s into motion, a quick stop that lets the stride settle). No squash, no waddle.
 *
 * Angle senses follow figure.ts (poseFigure). Phase is the left leg's cycle in [0, 1): heel strike at 0.
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

type GaitKeys = Readonly<{
  /** Left-leg joint angles (degrees) at u = 0, 0.1, … 0.9 of the cycle: hip flexion, knee flexion, ankle dorsiflexion. */
  hip: readonly number[]; knee: readonly number[]; ankle: readonly number[];
  /** Fraction of the cycle a foot is on the ground. */
  stance: number;
  /** Trunk lean forward, pelvis turn and drop, and the hips' sideways shift toward the supporting foot. */
  lean: number; pelvisYaw: number; pelvisRoll: number; sway: number;
  /** How much the chest turns against the pelvis (0 none, 1 equal and opposite). */
  counter: number;
  /** Arm swing (degrees per degree of the opposite leg), its forward bias, elbow bend and how much more it bends forward. */
  armSwing: number; armBias: number; elbow: number; elbowSwing: number; armOut: number;
  /** Extra float of the hips at mid-flight (figure units), for gaits with a flight phase. */
  float: number;
}>;

/** A brisk walk. */
const WALK_KEYS: GaitKeys = {
  hip: [26, 22, 12, 2, -7, -13, -6, 12, 25, 28],
  knee: [4, 15, 11, 5, 4, 12, 36, 58, 40, 10],
  ankle: [2, -6, 2, 8, 11, 4, -16, -6, 2, 4],
  stance: 0.6, lean: 3, pelvisYaw: 5, pelvisRoll: 3.5, sway: 0.035, counter: 0.6,
  armSwing: 0.62, armBias: 3, elbow: 16, elbowSwing: 14, armOut: 6, float: 0,
};

/** The courier's everyday pace: a long, light jog with a short float between steps. */
const JOG_KEYS: GaitKeys = {
  hip: [38, 22, 2, -24, -18, 6, 34, 50, 52, 46],
  knee: [20, 38, 32, 24, 50, 84, 104, 100, 70, 34],
  ankle: [6, 16, 12, -14, -22, -10, 0, 8, 10, 8],
  stance: 0.34, lean: 8, pelvisYaw: 8, pelvisRoll: 3, sway: 0.02, counter: 0.8,
  armSwing: 0.72, armBias: 8, elbow: 82, elbowSwing: 16, armOut: 9, float: 0.05,
};

/** Running hard (sprint). */
const RUN_KEYS: GaitKeys = {
  hip: [44, 21, -3, -28, -20, 10, 44, 62, 64, 54],
  knee: [22, 38, 32, 28, 64, 104, 124, 118, 82, 38],
  ankle: [8, 16, 12, -18, -26, -10, 2, 10, 12, 10],
  stance: 0.3, lean: 13, pelvisYaw: 10, pelvisRoll: 2.5, sway: 0.015, counter: 0.9,
  armSwing: 0.88, armBias: 12, elbow: 92, elbowSwing: 12, armOut: 11, float: 0.08,
};

/** Periodic Catmull-Rom through evenly spaced keys (u in cycles, any value). */
function sampleKeys(keys: readonly number[], u: number): number {
  const n = keys.length;
  const x = (((u % 1) + 1) % 1) * n;
  const i = Math.floor(x);
  const t = x - i;
  const p0 = keys[(i - 1 + n) % n]!, p1 = keys[i % n]!, p2 = keys[(i + 1) % n]!, p3 = keys[(i + 2) % n]!;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/**
 * Where a leg's sole reaches (figure units, from the hip joint) for joint angles in radians: how far below the hip its
 * lowest sole point is, and how far forward its heel and toe are.
 */
export function legReach(hip: number, knee: number, ankle: number, leg: LegDimensions = BASE_LEG): { down: number; heel: number; toe: number } {
  const kneeF = leg.thigh * Math.sin(hip);
  const kneeY = -leg.thigh * Math.cos(hip);
  const shinAngle = hip - knee;
  const ankleF = kneeF + leg.shin * Math.sin(shinAngle);
  const ankleY = kneeY - leg.shin * Math.cos(shinAngle);
  const pitch = shinAngle + ankle;
  const c = Math.cos(pitch), s = Math.sin(pitch);
  let lowest = Infinity;
  const points = leg.sole.map(([f, y]) => {
    const pf = ankleF + f * c - y * s;
    const py = ankleY + f * s + y * c;
    lowest = Math.min(lowest, py);
    return pf;
  });
  return { down: -lowest, heel: points[0]!, toe: points[points.length - 1]! };
}

const SAMPLES = 96;

/** A gait baked for one leg geometry: joint angles, the hips' float above the supporting leg, and stride per cycle. */
export type GaitTable = Readonly<{
  keys: GaitKeys;
  hip: Float32Array; knee: Float32Array; ankle: Float32Array;
  /** How far the hips rise above the longer leg's reach (flight float), figure units. */
  float: Float32Array;
  /** Ground covered per full cycle (two steps) with the planted foot not slipping, figure units. */
  stride: number;
}>;

export function bakeGait(keys: GaitKeys, leg: LegDimensions = BASE_LEG): GaitTable {
  const hip = new Float32Array(SAMPLES), knee = new Float32Array(SAMPLES), ankle = new Float32Array(SAMPLES), float = new Float32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i += 1) {
    const u = i / SAMPLES;
    hip[i] = sampleKeys(keys.hip, u) * DEG;
    knee[i] = sampleKeys(keys.knee, u) * DEG;
    ankle[i] = sampleKeys(keys.ankle, u) * DEG;
  }
  // Flight float: a smooth rise and fall over each stretch where neither foot is down.
  if (keys.float > 0 && keys.stance < 0.5) {
    const flight = 0.5 - keys.stance;
    for (let i = 0; i < SAMPLES; i += 1) {
      const u = i / SAMPLES;
      const inFlight = (u % 0.5) - keys.stance;
      float[i] = inFlight >= 0 ? keys.float * Math.sin((inFlight / flight) * Math.PI) : 0;
    }
  }
  // Stride: the hips travel over the planted foot from heel strike to toe-off, plus the roll from heel to toe.
  const at = (u: number) => legReach(sampleKeys(keys.hip, u) * DEG, sampleKeys(keys.knee, u) * DEG, sampleKeys(keys.ankle, u) * DEG, leg);
  const foot = leg.sole[leg.sole.length - 1]![0] - leg.sole[0]![0];
  const travel = foot + at(0).heel - at(keys.stance).toe;
  return { keys, hip, knee, ankle, float, stride: travel / keys.stance };
}

const TABLES = { walk: bakeGait(WALK_KEYS), jog: bakeGait(JOG_KEYS), run: bakeGait(RUN_KEYS) } as const;
/** The baked gaits, for tests and tools. */
export const GAITS = TABLES;

function tableAt(table: Float32Array, u: number): number {
  const x = (((u % 1) + 1) % 1) * SAMPLES;
  const i = Math.floor(x);
  const t = x - i;
  return table[i % SAMPLES]! * (1 - t) + table[(i + 1) % SAMPLES]! * t;
}

export type HumanGaitInput = {
  dt: number;
  /** Horizontal ground covered this frame (world units). */
  distance: number;
  /** Speed (world units per second). */
  speed: number;
  /** Drawn heading (radians, 0 faces −Z, positive turns toward +X). */
  heading: number;
  /** Drawn height of the feet. */
  y: number;
  reduced: boolean;
  airborne?: boolean;
  /** The figure's size (figure.scale): strides and speed thresholds scale with it. */
  scale?: number;
};

export type HumanGait = {
  /** The left leg's cycle in [0, 1): heel strike at 0, the right leg's at 0.5. */
  phase: number;
  /** Eased 0..1: moving (vs standing). */
  move: number;
  /** Eased weights of walk, jog and run among the moving gaits (they sum to 1). */
  walk: number; jog: number; run: number;
  lean: number;
  roll: number;
  turn: number;
  look: number;
  idleTime: number;
  time: number;
  lastSpeed: number;
  /** The recent top speed (scaled), easing down slowly: what the moving pose measures a slowdown against. */
  peak: number;
  lastHeading: number;
  lastY: number;
  lastVy: number;
  /** Eased 0..1: how much of the airborne pose shows, and the eased vertical speed while airborne. */
  air: number;
  airVy: number;
  /** Which leg leads a jump (−1 left, 1 right). */
  lead: number;
  /** Knees give on landing and on stepping down: 0..1 crouch, sprung. */
  give: Spring;
  /** The satchel's swing (radians), sprung against the body's motion. */
  bag: Spring;
  initialized: boolean;
  reduced: boolean;
};

export function createHumanGait(): HumanGait {
  return {
    phase: 0, move: 0, walk: 1, jog: 0, run: 0, lean: 0, roll: 0, turn: 0, look: 0, idleTime: 0, time: 0,
    lastSpeed: 0, peak: 0, lastHeading: 0, lastY: 0, lastVy: 0, air: 0, airVy: 0, lead: -1,
    give: { value: 0, velocity: 0 }, bag: { value: 0, velocity: 0 }, initialized: false, reduced: false,
  };
}

/** Forget rates after a teleport, spawn or landing, so the jump is not read as a turn or a fall. */
export function resetHumanGait(gait: HumanGait, heading: number, y: number): void {
  gait.lastHeading = Number.isFinite(heading) ? heading : 0;
  gait.lastY = Number.isFinite(y) ? y : 0;
  gait.lastVy = 0;
  gait.lastSpeed = 0;
  gait.peak = 0;
  gait.air = 0;
  gait.airVy = 0;
  gait.roll = 0;
  gait.turn = 0;
  gait.give.value = 0;
  gait.give.velocity = 0;
  gait.bag.value = 0;
  gait.bag.velocity = 0;
  gait.initialized = true;
}

/** Speeds (world units per second, at scale 1) where one gait hands over to the next. */
export const GAIT_SPEEDS = { walkTop: 3.4, jogFull: 6.6, runFrom: 9.5, runFull: 10.9 } as const;

const MAX_TURN_RATE = 8;
/** Knee give per unit/s of descent stopped, and its spring. */
const GIVE_PER_SPEED = 0.85;
const GIVE_OMEGA = 13;
const GIVE_ZETA = 0.75;

export function updateHumanGait(gait: HumanGait, input: HumanGaitInput): void {
  const { dt } = input;
  if (!Number.isFinite(dt) || dt <= 0) return;
  const scale = input.scale && input.scale > 0 ? input.scale : 1;
  const speed = Number.isFinite(input.speed) ? Math.max(0, input.speed) / scale : 0;
  const heading = Number.isFinite(input.heading) ? input.heading : gait.lastHeading;
  const y = Number.isFinite(input.y) ? input.y : gait.lastY;
  const distance = Number.isFinite(input.distance) ? Math.max(0, input.distance) / scale : 0;
  if (!gait.initialized) resetHumanGait(gait, heading, y);
  gait.reduced = input.reduced;
  gait.time += dt;
  const airborne = input.airborne === true;
  if (airborne && gait.air < 0.05) gait.lead = tableAt(TABLES.walk.hip, gait.phase) >= tableAt(TABLES.walk.hip, gait.phase + 0.5) ? -1 : 1;
  gait.air = lerpFPS(gait.air, airborne ? 1 : 0, airborne ? 0.3 : 0.22, dt);

  // Which gait: walking below a jog's pace, jogging at the courier's ordinary pace, running when sprinting.
  const jogging = fit(speed, GAIT_SPEEDS.walkTop, GAIT_SPEEDS.jogFull, 0, 1);
  const running = fit(speed, GAIT_SPEEDS.runFrom, GAIT_SPEEDS.runFull, 0, 1);
  const targets = [1 - jogging, jogging * (1 - running), jogging * running] as const;
  gait.walk = lerpFPS(gait.walk, targets[0], 0.06, dt);
  gait.jog = lerpFPS(gait.jog, targets[1], 0.06, dt);
  gait.run = lerpFPS(gait.run, targets[2], 0.05, dt);
  const sum = gait.walk + gait.jog + gait.run || 1;
  gait.walk /= sum; gait.jog /= sum; gait.run /= sum;
  // The moving pose follows speed, as the reference's clip weights do: full from half the recent top speed (never
  // below a stroll's pace, so a steady stroller's planted feet never slide), so a stopping courier blends out with
  // its speed. Measured with the walker: half in about 0.15 s into a start and 90% by 0.4 s; half out about 0.33 s
  // after release and down to a tenth by 0.54 s (reference 0.11–0.28, 0.36–0.55, 0.21–0.35 and 0.47–0.61 s).
  gait.peak = Math.max(speed, lerpFPS(gait.peak, speed, 0.02, dt));
  gait.move = lerpFPS(gait.move, fit(speed, 0.15, Math.max(1.6, 0.5 * gait.peak), 0, 1), speed > 0.15 ? 0.1 : 0.15, dt);

  // Turning: how fast the heading swings, eased, for banking and looking into the turn.
  const turnRate = Math.min(MAX_TURN_RATE, Math.max(-MAX_TURN_RATE, shortestAngle(gait.lastHeading, heading) / dt));
  gait.turn = lerpFPS(gait.turn, turnRate, 0.12, dt);
  gait.roll = lerpFPS(gait.roll, Math.min(0.2, Math.max(-0.2, -gait.turn * speed * 0.0065)), 0.12, dt);

  // Stride: distance advances the phase by the blended stride length; turning on the spot shuffles the feet round.
  const stride = gait.walk * TABLES.walk.stride + gait.jog * TABLES.jog.stride + gait.run * TABLES.run.stride;
  const shuffle = speed < 1 ? Math.abs(shortestAngle(gait.lastHeading, heading)) * 0.5 : 0;
  gait.phase = (gait.phase + ((distance + shuffle) * (1 - gait.air)) / stride) % 1;

  // Lean into acceleration, back a little when braking.
  const accel = (speed - gait.lastSpeed) / dt;
  gait.lean = lerpFPS(gait.lean, Math.min(0.14, Math.max(-0.08, accel * 0.012)), 0.1, dt);

  // Stand still a while and the head starts to look about.
  gait.idleTime = gait.move < 0.05 ? gait.idleTime + dt : 0;
  const lookTarget = Math.sin(Math.max(0, gait.idleTime - 2) * 0.55) * 0.42 * fit(gait.idleTime, 2, 4, 0, 1);
  gait.look = lerpFPS(gait.look, lookTarget, 0.05, dt);

  // Stopping a descent (landing, stepping down) makes the knees give, then spring back.
  const vy = (y - gait.lastY) / dt;
  if (gait.lastVy < -1.5 && vy > gait.lastVy) gait.give.velocity += Math.min(6.5, (vy - gait.lastVy) * GIVE_PER_SPEED);
  gait.airVy = airborne ? lerpFPS(gait.airVy, vy, 0.3, dt) : 0;
  stepSpring(gait.give, 0, GIVE_OMEGA, GIVE_ZETA, dt);
  if (gait.give.value < 0) { gait.give.value = 0; gait.give.velocity = Math.max(0, gait.give.velocity); }

  // The satchel swings against the body's acceleration and settles.
  gait.bag.velocity -= accel * 0.004 + vy * 0.02 * (airborne ? 1 : 0);
  stepSpring(gait.bag, 0, 6.5, 0.35, dt);

  gait.lastSpeed = speed;
  gait.lastHeading = heading;
  gait.lastY = y;
  gait.lastVy = vy;
}

/** A calm standing pose: the same for every call (reduced motion, previews). */
function standingPose(out: FigurePose): FigurePose {
  const rest = createFigurePose();
  Object.assign(out.hips, rest.hips);
  Object.assign(out.spine, rest.spine);
  Object.assign(out.chest, rest.chest);
  Object.assign(out.neck, rest.neck);
  Object.assign(out.head, rest.head);
  Object.assign(out.bag, rest.bag);
  out.eyes = 1;
  for (let i = 0; i < 2; i += 1) {
    Object.assign(out.legs[i]!, rest.legs[i]!);
    Object.assign(out.arms[i]!, rest.arms[i]!);
  }
  return out;
}

/** The joint angles for the gait's current state, written into `out` (a fresh pose by default). */
export function humanPose(gait: HumanGait, out: FigurePose = createFigurePose(), leg: LegDimensions = BASE_LEG): FigurePose {
  if (gait.reduced) return standingPose(out);
  const u = gait.phase;
  const w = [gait.walk, gait.jog, gait.run] as const;
  const tables = [TABLES.walk, TABLES.jog, TABLES.run] as const;
  const blendKey = (key: keyof Pick<GaitKeys, "lean" | "pelvisYaw" | "pelvisRoll" | "sway" | "counter" | "armSwing" | "armBias" | "elbow" | "elbowSwing" | "armOut">) =>
    w[0] * tables[0].keys[key] + w[1] * tables[1].keys[key] + w[2] * tables[2].keys[key];
  const blendTable = (pick: (table: GaitTable) => Float32Array, at: number) =>
    w[0] * tableAt(pick(tables[0]), at) + w[1] * tableAt(pick(tables[1]), at) + w[2] * tableAt(pick(tables[2]), at);

  const move = gait.move;
  const still = 1 - move;
  const t = gait.time;
  // Standing: weight settles on one leg, then the other, every few seconds; breathing lifts the chest.
  const weightShift = Math.sin(t * 0.21 + 0.7) * Math.min(1, Math.abs(Math.sin(t * 0.21 + 0.7)) * 3);
  const breath = Math.sin(t * 1.55);

  // Legs: the gait cycle while moving, a relaxed stance while still; knees give on landings.
  const give = Math.min(1, gait.give.value);
  for (let i = 0; i < 2; i += 1) {
    const at = u + i * 0.5;
    const side = i === 0 ? -1 : 1;
    const relaxed = Math.max(0, side * weightShift);
    const idleHip = 0.02 + relaxed * 0.07;
    const idleKnee = 0.05 + relaxed * 0.2;
    const idleAnkle = relaxed * 0.1;
    const legPose = out.legs[i]!;
    legPose.hip = lerp(idleHip, blendTable((g) => g.hip, at), move) + give * 0.42;
    legPose.knee = lerp(idleKnee, blendTable((g) => g.knee, at), move) + give * 0.84;
    legPose.ankle = lerp(idleAnkle, blendTable((g) => g.ankle, at), move) + give * 0.42;
    legPose.hipOut = still * (0.03 + relaxed * 0.025);
    legPose.hipTwist = still * 0.08;
  }

  // The hips sit where the supporting leg reaches the ground, floating a little in a run's flight.
  const reachLeft = legReach(out.legs[0].hip, out.legs[0].knee, out.legs[0].ankle, leg).down;
  const reachRight = legReach(out.legs[1].hip, out.legs[1].knee, out.legs[1].ankle, leg).down;
  const float = blendTable((g) => g.float, u) * move;
  const cycle = u * TAU;
  const yawAmount = blendKey("pelvisYaw") * DEG * move;
  const rollAmount = blendKey("pelvisRoll") * DEG * move;
  out.hips.y = Math.max(reachLeft, reachRight) - leg.hip + float;
  out.hips.x = -blendKey("sway") * Math.sin(cycle) * move + still * 0.045 * weightShift;
  out.hips.z = 0;
  const lean = blendKey("lean") * DEG * move + gait.lean;
  out.hips.pitch = -lean * 0.25;
  out.hips.yaw = -yawAmount * Math.cos(cycle);
  out.hips.roll = -rollAmount * Math.sin(cycle) + still * 0.05 * weightShift + gait.roll;

  // The trunk leans with speed, turns against the pelvis, and keeps the shoulders level against the pelvis's tilt.
  const counter = blendKey("counter");
  const chestYaw = -(1 + counter) * out.hips.yaw;
  out.spine.pitch = -lean * 0.45 + breath * 0.008 * still;
  out.spine.yaw = chestYaw * 0.4;
  out.spine.roll = -out.hips.roll * 0.5 + gait.roll * 0.4;
  out.chest.pitch = -lean * 0.3 - breath * 0.012 * still;
  out.chest.yaw = chestYaw * 0.6;
  out.chest.roll = -out.hips.roll * 0.3;

  // The head steadies itself (level gaze), looks into turns, and looks about when idle.
  const tilt = out.hips.pitch + out.spine.pitch + out.chest.pitch;
  out.neck.pitch = -tilt * 0.45;
  out.neck.yaw = -(out.hips.yaw + out.spine.yaw + out.chest.yaw) * 0.45;
  const turnLook = Math.min(0.35, Math.max(-0.35, -gait.turn * 0.09)) * move;
  out.head.pitch = -tilt * 0.4 + 0.03 * Math.cos(2 * cycle) * move;
  out.head.yaw = -(out.hips.yaw + out.spine.yaw + out.chest.yaw) * 0.4 + gait.look + turnLook;
  out.head.roll = -(out.hips.roll + out.spine.roll + out.chest.roll) * 0.6;

  // Arms swing against the opposite leg (left arm with the right leg), elbows bending more as they come forward.
  const swing = blendKey("armSwing");
  const bias = blendKey("armBias");
  const elbow = blendKey("elbow");
  const elbowSwing = blendKey("elbowSwing");
  const armOut = blendKey("armOut");
  for (let i = 0; i < 2; i += 1) {
    const side = i === 0 ? -1 : 1;
    const ownHip = blendTable((g) => g.hip, u + i * 0.5) / DEG;
    const meanHip = (blendTable((g) => g.hip, u) + blendTable((g) => g.hip, u + 0.5)) / 2 / DEG;
    const swingDeg = bias - swing * (ownHip - meanHip);
    const forward = Math.max(0, swingDeg - bias) / 30;
    const arm = out.arms[i]!;
    const idleSwing = 0.03 + 0.02 * Math.sin(t * 0.8 + i * 1.7);
    arm.swing = lerp(idleSwing, swingDeg * DEG, move);
    arm.out = lerp(0.1 + 0.01 * breath + Math.max(0, -side * weightShift) * 0.02, armOut * DEG, move);
    arm.elbow = lerp(0.22, (elbow + elbowSwing * forward) * DEG, move);
    arm.wrist = lerp(0.05, -0.12, move);
  }

  // The bag swings with the stride and against starts and stops.
  out.bag.pitch = gait.bag.value + 0.06 * Math.sin(2 * cycle + 0.8) * move;
  out.bag.roll = 0.07 * Math.sin(cycle + 0.4) * move;

  // An unhurried blink every few seconds.
  const blinkClock = (t + 0.37) % 4.3;
  out.eyes = blinkClock < 0.12 ? Math.abs(blinkClock - 0.06) / 0.06 : 1;

  if (gait.air > 1e-3) blendAirPose(out, gait.air, fit(gait.airVy, 5, -7, 0, 1), gait.lead);
  return out;
}

/**
 * Mix the jump in by `air` (0..1). `fall` (0 rising .. 1 falling fast) moves it from the take-off (lead knee up, the
 * other leg pushing back, arms rising) toward the landing (both legs reaching down, arms out for balance).
 */
function blendAirPose(out: FigurePose, air: number, fall: number, lead: number): void {
  const leadIndex = lead < 0 ? 0 : 1;
  for (let i = 0; i < 2; i += 1) {
    const isLead = i === leadIndex;
    const legPose = out.legs[i]!;
    legPose.hip = lerp(legPose.hip, isLead ? lerp(0.95, 0.5, fall) : lerp(-0.2, 0.25, fall), air);
    legPose.knee = lerp(legPose.knee, isLead ? lerp(1.35, 0.55, fall) : lerp(0.75, 0.4, fall), air);
    legPose.ankle = lerp(legPose.ankle, lerp(-0.15, 0.1, fall), air);
    const arm = out.arms[i]!;
    arm.swing = lerp(arm.swing, isLead ? lerp(-0.35, 0.15, fall) : lerp(0.75, 0.2, fall), air);
    arm.out = lerp(arm.out, lerp(0.35, 0.7, fall), air);
    arm.elbow = lerp(arm.elbow, lerp(0.9, 0.45, fall), air);
  }
  out.hips.y = lerp(out.hips.y, 0, air);
  out.hips.x = lerp(out.hips.x, 0, air);
  out.hips.roll = lerp(out.hips.roll, 0, air);
  out.spine.pitch = lerp(out.spine.pitch, lerp(-0.1, 0.03, fall), air);
  out.head.pitch = lerp(out.head.pitch, lerp(0.08, -0.1, fall), air);
}
