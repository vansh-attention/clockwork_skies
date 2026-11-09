import { clamp, damp } from "@clockwork/shared";
import type { WalkWorld } from "./walkWorld";
import { COURIER_SIZE } from "./size";

/** forward/strafe in [-1, 1]; cameraYaw is the direction the camera looks, radians: 0 faces −Z, positive turns toward +X. */
/** `jump` asks for a jump on this step (taken only when standing). */
export type WalkInput = { forward: number; strafe: number; run: boolean; cameraYaw: number; jump?: boolean };
export type Walker = {
  x: number; y: number; z: number;
  /** Facing, same convention as cameraYaw, wrapped to (−PI, PI]. */
  heading: number;
  vx: number; vz: number;
  /**
   * The intended velocity, which eases toward the input before the real velocity eases toward it. Two gentle stages
   * give the soft S-shaped start and stop measured on the reference courier, rather than an instant jerk.
   */
  driveX: number; driveZ: number;
  speed: number;
  moving: boolean;
  /** Distance travelled so far, for leg animation. */
  stride: number;
  /** Unspent simulation time in seconds, always below one fixed step. */
  acc: number;
  /** Vertical speed (units/s) while airborne; 0 when standing. */
  vy: number;
  grounded: boolean;
  /** The ground height the walker last stood on: it may land on anything up to a kerb above it, but never jump off a terrace. */
  baseY: number;
};

export const WALK = {
  // The reference courier's measured pace: 2.11 of its heights a second jogging and 2.99 sprinting (live-timing.json),
  // that is 8.0 and 11.3 for a 3.79-tall figure, carried to the courier's own height (size.ts).
  radius: 1.5, walkSpeed: 8 * COURIER_SIZE, runSpeed: 11.2 * COURIER_SIZE, maxStep: 1.2,
  /**
   * Response rates per second for both stages (intent, then velocity), fitted to the reference courier's live trace
   * (movement-reference/live-timing.json) and checked against the same key sequence replayed in this game. Starts from
   * standing reach a quarter of top speed after about 0.09 s, half after 0.16 s and 93% after 0.43 s (reference
   * 0.07–0.10, 0.13–0.18 and 0.29–0.47 s); on release half the speed is gone after about 0.12 s and the courier stops
   * within about 0.45 s and about a third of its height (reference 0.095–0.20 s and 0.36–0.51 s). The trace's first
   * start began from the idle fidget and was slower; it is not a fair start.
   */
  accel: 10, brake: 12.5,
  /** Jump take-off speed and gravity: a hop about 1.15 high, about 0.6 s in the air. */
  jumpSpeed: 7.8, gravity: 26,
  /** Steering in the air, as a fraction of the acceleration on the ground. */
  airControl: 0.45,
} as const;

const STEP = 1 / 60;
const MAX_SUBSTEPS = 30;
const MOVING_SPEED = 0.5;
const TURN_SHARPNESS = 12;
const TAU = Math.PI * 2;
const EPSILON = 1e-9;

const finiteOrZero = (value: number) => (Number.isFinite(value) ? value : 0);
const axis = (value: number) => clamp(finiteOrZero(value), -1, 1);

/** Wraps an angle to (−PI, PI]. */
function wrapAngle(angle: number): number {
  const wrapped = angle - Math.floor((angle + Math.PI) / TAU) * TAU;
  // floor-based wrapping yields [−PI, PI); map the lower bound to +PI.
  return wrapped <= -Math.PI ? Math.PI : wrapped;
}

export function createWalker(x: number, z: number, world: WalkWorld, heading = 0): Walker {
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError("createWalker: x and z must be finite");
  return {
    x, y: world.surfaceAt(x, z).height, z,
    heading: finiteOrZero(heading),
    vx: 0, vz: 0, driveX: 0, driveZ: 0, speed: 0, moving: false, stride: 0, acc: 0,
    vy: 0, grounded: true, baseY: world.surfaceAt(x, z).height,
  };
}

/** Largest body radius (to 1/1024 of WALK.radius) that fits at (x, z); 0 when even a point is blocked. */
function clearanceAt(x: number, z: number, world: WalkWorld): number {
  let low = 0;
  let high: number = WALK.radius;
  for (let i = 0; i < 14; i += 1) {
    const mid = (low + high) / 2;
    if (world.blocked(x, z, mid)) high = mid;
    else low = mid;
  }
  return low;
}

type SubstepResult = { blocked: boolean; jumped: boolean; landed: boolean };

function substep(walker: Walker, input: WalkInput, world: WalkWorld): SubstepResult {
  let jumped = false;
  if (input.jump === true && walker.grounded) {
    walker.vy = WALK.jumpSpeed;
    walker.grounded = false;
    jumped = true;
  }
  const forward = axis(input.forward);
  const strafe = axis(input.strafe);
  const yaw = finiteOrZero(input.cameraYaw);
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);

  let dx = sin * forward + cos * strafe;
  let dz = -cos * forward + sin * strafe;
  const length = Math.hypot(dx, dz);
  if (length > 1) {
    dx /= length;
    dz /= length;
  }
  const top = input.run ? WALK.runSpeed : WALK.walkSpeed;
  const response = length < 1e-6 ? WALK.brake : WALK.accel;
  const rate = walker.grounded ? response : response * WALK.airControl;
  walker.driveX = damp(finiteOrZero(walker.driveX), dx * top, rate, STEP);
  walker.driveZ = damp(finiteOrZero(walker.driveZ), dz * top, rate, STEP);
  walker.vx = damp(walker.vx, walker.driveX, rate, STEP);
  walker.vz = damp(walker.vz, walker.driveZ, rate, STEP);
  if (length < 1e-6 && Math.hypot(walker.vx, walker.vz) < 0.025) { walker.vx = 0; walker.vz = 0; walker.driveX = 0; walker.driveZ = 0; }

  const free = (x: number, z: number) => world.surfaceAt(x, z).walkable && !world.blocked(x, z, WALK.radius);
  // A walker already in a bad spot may move wherever it is no more cramped than it is now, so it can escape.
  const escaping = !free(walker.x, walker.z);
  const clearance = escaping ? clearanceAt(walker.x, walker.z, world) : WALK.radius;
  const valid = (x: number, z: number) => {
    const surface = world.surfaceAt(x, z);
    if (!surface.walkable) return false;
    if (escaping) return !world.blocked(x, z, clearance);
    if (world.blocked(x, z, WALK.radius)) return false;
    // In the air: anything up to a kerb above the feet, but no dropping off a terrace edge.
    if (!walker.grounded) return surface.height - walker.y <= WALK.maxStep && surface.height >= walker.baseY - WALK.maxStep;
    return Math.abs(surface.height - walker.y) <= WALK.maxStep;
  };

  const mx = walker.vx * STEP;
  const mz = walker.vz * STEP;
  const intended = Math.hypot(mx, mz);
  let nextX = walker.x;
  let nextZ = walker.z;
  if (valid(walker.x + mx, walker.z + mz)) {
    nextX = walker.x + mx;
    nextZ = walker.z + mz;
  } else if (intended > 0) {
    // Advance to contact, then remove only inward motion. Estimating the normal from body clearance
    // keeps arbitrary rotated walls smooth; an angular search alternated directions and speed at contact.
    let remainingX = mx, remainingZ = mz;
    for (let contact = 0; contact < 3; contact += 1) {
      if (valid(nextX + remainingX, nextZ + remainingZ)) { nextX += remainingX; nextZ += remainingZ; break; }
      let lo = 0, hi = 1;
      for (let i = 0; i < 14; i += 1) {
        const mid = (lo + hi) / 2;
        if (valid(nextX + remainingX * mid, nextZ + remainingZ * mid)) lo = mid;
        else hi = mid;
      }
      nextX += remainingX * lo; nextZ += remainingZ * lo;
      const probe = 0.08;
      let nx = clearanceAt(nextX + probe, nextZ, world) - clearanceAt(nextX - probe, nextZ, world);
      let nz = clearanceAt(nextX, nextZ + probe, world) - clearanceAt(nextX, nextZ - probe, world);
      const normalLength = Math.hypot(nx, nz);
      if (normalLength < 1e-6) {
        // Height discontinuities can reject a step without a horizontal solid. Stay on the valid surface.
        if (valid(nextX + remainingX * (1 - lo), nextZ)) { nextX += remainingX * (1 - lo); walker.vz = 0; }
        else if (valid(nextX, nextZ + remainingZ * (1 - lo))) { nextZ += remainingZ * (1 - lo); walker.vx = 0; }
        else { walker.vx = 0; walker.vz = 0; }
        break;
      }
      nx /= normalLength; nz /= normalLength;
      remainingX *= 1 - lo; remainingZ *= 1 - lo;
      const inward = Math.min(0, remainingX * nx + remainingZ * nz);
      remainingX -= nx * inward; remainingZ -= nz * inward;
      const velocityInward = Math.min(0, walker.vx * nx + walker.vz * nz);
      walker.vx -= nx * velocityInward; walker.vz -= nz * velocityInward;
      // A tiny outward clearance prevents roundoff from treating the next tangent step as penetration.
      if (valid(nextX + nx * 0.001, nextZ + nz * 0.001)) { nextX += nx * 0.001; nextZ += nz * 0.001; }
      if (Math.hypot(remainingX, remainingZ) < 1e-7) break;
    }
  }

  const achieved = Math.hypot(nextX - walker.x, nextZ - walker.z);
  walker.stride += achieved;
  walker.x = nextX;
  walker.z = nextZ;
  const ground = world.surfaceAt(nextX, nextZ).height;
  let landed = false;
  if (walker.grounded) {
    walker.y = ground;
    walker.baseY = ground;
  } else {
    walker.vy -= WALK.gravity * STEP;
    walker.y += walker.vy * STEP;
    if (walker.y <= ground && walker.vy > 0) {
      // Still rising over ground that climbs faster (a kerb or steep slope just ahead of a take-off): ride up it and
      // keep the hop, rather than landing in the same instant as leaving.
      walker.y = ground;
    } else if (walker.y <= ground) {
      walker.y = ground;
      walker.vy = 0;
      walker.grounded = true;
      walker.baseY = ground;
      landed = true;
    }
  }

  walker.speed = Math.hypot(walker.vx, walker.vz);
  walker.moving = walker.speed > MOVING_SPEED;
  if (walker.moving) {
    const travel = Math.atan2(walker.vx, -walker.vz);
    const delta = wrapAngle(travel - walker.heading);
    walker.heading = wrapAngle(walker.heading + delta * (1 - Math.exp(-TURN_SHARPNESS * STEP)));
  }
  // Blocked means the intended motion was not mostly achieved.
  return { blocked: intended > 1e-9 && achieved < intended * 0.5, jumped, landed };
}

/**
 * Advances the walker in fixed 1/60 s substeps (at most 30 per call); leftover time carries in `acc`. A jump request
 * is used on the first substep only. Reports whether it was blocked, took off or landed.
 */
export function stepWalker(walker: Walker, input: WalkInput, dt: number, world: WalkWorld): SubstepResult {
  const result: SubstepResult = { blocked: false, jumped: false, landed: false };
  if (!Number.isFinite(dt) || dt <= 0) return result;
  walker.acc += dt;
  let steps = 0;
  // Only the first substep may take the jump; the rest get the same input without it.
  const calm: WalkInput = input.jump === true ? { ...input, jump: false } : input;
  let next = input;
  while (walker.acc >= STEP - EPSILON && steps < MAX_SUBSTEPS) {
    const step = substep(walker, next, world);
    next = calm;
    result.blocked = step.blocked || result.blocked;
    result.jumped = step.jumped || result.jumped;
    result.landed = step.landed || result.landed;
    walker.acc = Math.max(0, walker.acc - STEP);
    steps += 1;
  }
  // Past the cap the remaining time is dropped rather than replayed later.
  if (steps >= MAX_SUBSTEPS) walker.acc = 0;
  return result;
}
