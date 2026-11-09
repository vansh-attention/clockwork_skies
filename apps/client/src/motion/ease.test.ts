import { describe, expect, it } from "vitest";
import {
  easeFactor, fit, lerpAngleFPS, lerpFPS, lerpFPSLimited, shortestAngle, stepSpring, wrapAngle, type Spring,
} from "./ease";

/** Runs `frames` equal frames of `seconds` total through `step`. */
function run(seconds: number, fps: number, step: (dt: number) => void) {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i += 1) step(1 / fps);
}

describe("easeFactor", () => {
  it("closes exactly k60 of the gap in one 60 fps frame", () => {
    expect(easeFactor(0.2, 1 / 60)).toBeCloseTo(0.2, 12);
    expect(easeFactor(0.75, 1 / 60)).toBeCloseTo(0.75, 12);
  });

  it("is 0 for no time and 1 for k60 = 1", () => {
    expect(easeFactor(0.3, 0)).toBe(0);
    expect(easeFactor(1, 1 / 144)).toBe(1);
  });

  it("treats non-finite or negative input as no movement and clamps k60", () => {
    expect(easeFactor(0.3, Number.NaN)).toBe(0);
    expect(easeFactor(0.3, -1)).toBe(0);
    expect(easeFactor(Number.NaN, 1 / 60)).toBe(0);
    expect(easeFactor(-2, 1 / 60)).toBe(0);
    expect(easeFactor(7, 1 / 60)).toBe(1);
  });
});

describe("lerpFPS", () => {
  it("lands in the same place after one second at 30, 60 and 144 fps", () => {
    const after = (fps: number) => { let value = 0; run(1, fps, (dt) => { value = lerpFPS(value, 10, 0.05, dt); }); return value; };
    expect(after(30)).toBeCloseTo(after(60), 9);
    expect(after(144)).toBeCloseTo(after(60), 9);
  });

  it("never overshoots", () => {
    let value = 0;
    run(2, 60, (dt) => { value = lerpFPS(value, 1, 0.4, dt); expect(value).toBeLessThanOrEqual(1); });
  });
});

describe("lerpFPSLimited", () => {
  it("caps the change at maxPerSecond * dt", () => {
    expect(lerpFPSLimited(0, 100, 0.5, 1 / 60, 6)).toBeCloseTo(0.1, 12);
    expect(lerpFPSLimited(0, -100, 0.5, 1 / 60, 6)).toBeCloseTo(-0.1, 12);
  });

  it("behaves like lerpFPS when the cap is not reached", () => {
    expect(lerpFPSLimited(0, 1, 0.1, 1 / 60, 1000)).toBeCloseTo(lerpFPS(0, 1, 0.1, 1 / 60), 12);
  });
});

describe("angles", () => {
  it("wraps to (-PI, PI]", () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-3 * Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
  });

  it("takes the short way across the seam", () => {
    expect(shortestAngle(3, -3)).toBeCloseTo(2 * Math.PI - 6, 12);
    const eased = lerpAngleFPS(3, -3, 0.5, 1 / 60);
    expect(Math.abs(eased)).toBeGreaterThan(3);
  });
});

describe("fit", () => {
  it("maps and clamps", () => {
    expect(fit(5, 0, 10, 0, 1)).toBeCloseTo(0.5, 12);
    expect(fit(-5, 0, 10, 0, 1)).toBe(0);
    expect(fit(50, 0, 10, 2, 4)).toBe(4);
    expect(fit(3, 3, 3, 0, 1)).toBe(1);
  });
});

describe("stepSpring", () => {
  const spring = (value = 0, velocity = 0): Spring => ({ value, velocity });

  it("settles on the target without overshoot when critically damped", () => {
    const s = spring(0);
    let peak = 0;
    run(2, 60, (dt) => { stepSpring(s, 1, 12, 1, dt); peak = Math.max(peak, s.value); });
    expect(s.value).toBeCloseTo(1, 4);
    expect(peak).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("bounces past the target when under-damped, then settles", () => {
    const s = spring(0);
    let peak = 0;
    run(3, 60, (dt) => { stepSpring(s, 1, 14, 0.35, dt); peak = Math.max(peak, s.value); });
    expect(peak).toBeGreaterThan(1.05);
    expect(s.value).toBeCloseTo(1, 3);
  });

  it("is stable for a long frame and frame-rate independent", () => {
    const a = spring(0);
    const b = spring(0);
    run(1, 60, (dt) => stepSpring(a, 1, 10, 0.5, dt));
    run(1, 144, (dt) => stepSpring(b, 1, 10, 0.5, dt));
    expect(a.value).toBeCloseTo(b.value, 3);
    const c = spring(0);
    stepSpring(c, 1, 30, 0.4, 0.5);
    expect(Number.isFinite(c.value)).toBe(true);
    expect(Math.abs(c.value - 1)).toBeLessThan(0.5);
  });

  it("ignores non-finite or non-positive time", () => {
    const s = spring(0.3, 2);
    stepSpring(s, 1, 10, 1, Number.NaN);
    stepSpring(s, 1, 10, 1, 0);
    expect(s).toEqual({ value: 0.3, velocity: 2 });
  });
});
