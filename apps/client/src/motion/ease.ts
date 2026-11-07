/**
 * Frame-rate independent easing and springs: one vocabulary for everything that moves on screen.
 *
 * Ease rates are given as `k60`, the fraction of the remaining gap closed in one 1/60 s frame (0..1). The same k60
 * gives the same motion at 30, 60 or 144 fps, so tuning reads like "closes 10% a frame" and never drifts with the
 * display's refresh rate.
 */

const TAU = Math.PI * 2;

/** The fraction of the gap to close over `dt` seconds for a per-60fps-frame rate `k60`. 0 for bad or empty time. */
export function easeFactor(k60: number, dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(k60) || k60 <= 0) return 0;
  if (k60 >= 1) return 1;
  return 1 - (1 - k60) ** (dt * 60);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Moves `a` toward `b` by easeFactor(k60, dt) of the gap. */
export function lerpFPS(a: number, b: number, k60: number, dt: number): number {
  return a + (b - a) * easeFactor(k60, dt);
}

/** As lerpFPS, but never moves faster than `maxPerSecond`. */
export function lerpFPSLimited(a: number, b: number, k60: number, dt: number, maxPerSecond: number): number {
  const step = lerpFPS(a, b, k60, dt) - a;
  const limit = Math.max(0, maxPerSecond) * Math.max(0, Number.isFinite(dt) ? dt : 0);
  return a + Math.min(limit, Math.max(-limit, step));
}

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(angle: number): number {
  const wrapped = angle - Math.floor((angle + Math.PI) / TAU) * TAU;
  return wrapped <= -Math.PI ? Math.PI : wrapped;
}

/** The signed angle from `from` to `to`, the short way round. */
export function shortestAngle(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** lerpFPS for angles: eases the short way round and returns a wrapped angle. */
export function lerpAngleFPS(a: number, b: number, k60: number, dt: number): number {
  return wrapAngle(a + shortestAngle(a, b) * easeFactor(k60, dt));
}

/** Maps `value` from [inMin, inMax] to [outMin, outMax], clamped. A zero-width input range maps to outMax. */
export function fit(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return outMax;
  const t = Math.min(1, Math.max(0, (value - inMin) / (inMax - inMin)));
  return outMin + (outMax - outMin) * t;
}

export type Spring = { value: number; velocity: number };

/**
 * Advances a damped spring toward `target` by `dt` seconds using the exact solution, so any frame length is stable
 * and the result does not depend on frame rate. `omega` is the natural frequency (rad/s); `zeta` the damping ratio
 * (1 = critically damped, below 1 bounces).
 */
export function stepSpring(spring: Spring, target: number, omega: number, zeta: number, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(omega) || omega <= 0 || !Number.isFinite(target)) return;
  // A spring poisoned by a bad value would stay NaN for ever: put it back at rest on the target.
  if (!Number.isFinite(spring.value) || !Number.isFinite(spring.velocity)) {
    spring.value = target;
    spring.velocity = 0;
    return;
  }
  const z = Math.max(0, Number.isFinite(zeta) ? zeta : 1);
  const x0 = spring.value - target;
  const v0 = spring.velocity;
  let x: number;
  let v: number;
  if (Math.abs(z - 1) < 1e-4) {
    const e = Math.exp(-omega * dt);
    const b = v0 + omega * x0;
    x = (x0 + b * dt) * e;
    v = (v0 - omega * b * dt) * e;
  } else if (z < 1) {
    const a = z * omega;
    const wd = omega * Math.sqrt(1 - z * z);
    const e = Math.exp(-a * dt);
    const cos = Math.cos(wd * dt);
    const sin = Math.sin(wd * dt);
    x = e * (x0 * cos + ((v0 + a * x0) / wd) * sin);
    v = e * (v0 * cos - ((a * v0 + omega * omega * x0) / wd) * sin);
  } else {
    const root = Math.sqrt(z * z - 1);
    // z - root, written without the cancellation that loses precision for heavy damping.
    const r1 = -omega / (z + root);
    const r2 = -omega * (z + root);
    const c1 = (v0 - r2 * x0) / (r1 - r2);
    const c2 = x0 - c1;
    const e1 = Math.exp(r1 * dt);
    const e2 = Math.exp(r2 * dt);
    x = c1 * e1 + c2 * e2;
    v = r1 * c1 * e1 + r2 * c2 * e2;
  }
  spring.value = target + x;
  spring.velocity = v;
}
