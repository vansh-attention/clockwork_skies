import { describe, expect, it } from "vitest";
import { RESOLUTION, ResolutionGovernor } from "./resolution";

/** A governor past its warm-up (the frames it ignores after starting), ready to judge. */
function warmed(ratio: number, limits = { floor: 0.65, ceiling: 1.25 }): ResolutionGovernor {
  const governor = new ResolutionGovernor(ratio, limits);
  for (let i = 0; i < RESOLUTION.warmup; i += 1) governor.frame(1 / 60, 40);
  return governor;
}

/** Feed whole decision windows of identical frames; returns the last change made (or null). */
function run(governor: ResolutionGovernor, windows: number, dt: number, gpuMs: number | null): number | null {
  let last: number | null = null;
  for (let i = 0; i < windows * RESOLUTION.window; i += 1) last = governor.frame(dt, gpuMs) ?? last;
  return last;
}

/** A card whose frame costs `fixed` ms plus `perRatioSquared` ms times the pixel ratio squared. */
function settleOn(governor: ResolutionGovernor, fixed: number, perRatioSquared: number, windows = 40): number[] {
  const history: number[] = [];
  for (let i = 0; i < windows; i += 1) {
    run(governor, 1, 1 / 60, fixed + perRatioSquared * governor.ratio ** 2);
    history.push(governor.ratio);
  }
  return history;
}

describe("resolution governor", () => {
  it("leaves the resolution alone while the GPU is inside its budget", () => {
    const governor = warmed(1.25);
    expect(run(governor, 6, 1 / 144, 11)).toBeNull();
    expect(governor.ratio).toBe(1.25);
  });

  it("ignores the first frames altogether, however slow: loading is not load", () => {
    const governor = new ResolutionGovernor(1.25, { floor: 0.65, ceiling: 1.25 });
    // At sixty frames a second the warm-up is its frame count; at twenty it is its two seconds.
    for (let i = 0; i < RESOLUTION.warmup; i += 1) expect(governor.frame(1 / 60, 60)).toBeNull();
    expect(governor.ratio).toBe(1.25);
    // And again after a reset (a new view, a tab shown again).
    run(governor, 1, 1 / 20, 60);
    expect(governor.ratio).toBeLessThan(1.25);
    const after = governor.ratio;
    governor.reset();
    for (let i = 0; i < RESOLUTION.warmupSeconds * 20; i += 1) expect(governor.frame(1 / 20, 60)).toBeNull();
    expect(governor.ratio).toBe(after);
    run(governor, 1, 1 / 20, 60);
    expect(governor.ratio).toBeLessThan(after);
  });

  it("relieves a renderer that can barely draw within seconds, not after hundreds of frames", () => {
    // Five frames a second and no GPU reading (software rendering): two seconds of warm-up, then a decision every
    // second and a half, each a double step taken at once.
    const governor = new ResolutionGovernor(1, { floor: 0.65, ceiling: 1 });
    let seconds = 0;
    while (governor.ratio > 0.65 && seconds < 30) { governor.frame(0.2, null); seconds += 0.2; }
    expect(governor.ratio).toBe(0.65);
    expect(seconds).toBeLessThan(7);
  });

  it("drops when the GPU stays over budget, by no more than a fifth at a time and never below the floor", () => {
    const governor = warmed(1.25);
    // One slow spell is let pass; a second in a row is load.
    expect(run(governor, 1, 1 / 48, 18)).toBeNull();
    expect(run(governor, 1, 1 / 48, 18)).toBeCloseTo(1, 5);
    // A hitch between two good spells never softens the picture.
    const steady = warmed(1.25);
    for (let i = 0; i < 6; i += 1) { run(steady, 1, 1 / 48, 18); run(steady, 1, 1 / 60, 10); }
    expect(steady.ratio).toBe(1.25);
    // A card far over budget is relieved at once, down to the floor and no further.
    const drowning = warmed(0.7);
    expect(run(drowning, 1, 1 / 30, 40)).toBe(0.65);
    run(drowning, 5, 1 / 30, 40);
    expect(drowning.ratio).toBe(0.65);
  });

  it("settles inside the budget on a slow card and stays there, without hunting up and down", () => {
    const governor = warmed(1.25);
    const history = settleOn(governor, 5, 8.3);
    const settled = history.slice(-20);
    expect(new Set(settled).size).toBe(1);
    expect(5 + 8.3 * settled[0]! ** 2).toBeLessThanOrEqual(RESOLUTION.gpu.over);
    expect(settled[0]!).toBeLessThan(1.25);
    expect(settled[0]!).toBeGreaterThanOrEqual(0.65);
  });

  it("uses the room it has: a drop caused by a passing load is won back as far as the budget allows", () => {
    // 4 ms fixed and 5.6 ms a unit of area: 12.75 ms at 1.25 (over), 9.6 ms at 1.0, 10.8 ms at 1.1, 11.4 ms at 1.15.
    const governor = warmed(1.25);
    run(governor, 1, 1 / 60, 25);
    expect(governor.ratio).toBe(1);
    const history = settleOn(governor, 4, 5.6);
    const settled = history.at(-1)!;
    expect(settled).toBeGreaterThan(1);
    expect(4 + 5.6 * settled ** 2).toBeLessThanOrEqual(RESOLUTION.gpu.over);
    expect(new Set(history.slice(-20)).size).toBe(1);
  });

  it("climbs back to full sharpness when the load goes, in steps it knows will fit", () => {
    const governor = warmed(0.8);
    const history = settleOn(governor, 2, 3);
    expect(history.at(-1)).toBe(1.25);
    for (let i = 1; i < history.length; i += 1) expect(history[i]! / history[i - 1]!).toBeLessThanOrEqual(RESOLUTION.step.up + 1e-9);
  });

  it("reaches a ceiling that is not a whole step, and follows the ceiling when the screen changes", () => {
    const governor = warmed(1, { floor: 0.65, ceiling: 1.3333 });
    settleOn(governor, 1, 2);
    expect(governor.ratio).toBe(1.3333);
    governor.setCeiling(1);
    settleOn(governor, 1, 2, 2);
    expect(governor.ratio).toBe(1);
  });

  it("falls back to the frame rate without a GPU reading, and waits before trying to rise again", () => {
    const governor = warmed(1.25);
    expect(run(governor, 1, 1 / 40, null)).toBeNull();
    expect(run(governor, 1, 1 / 40, null)).toBeCloseTo(1.15, 5);
    // Smooth again straight away: it holds for a while rather than bouncing back into the slow frame rate.
    expect(run(governor, 3, 1 / 60, null)).toBeNull();
    run(governor, Math.ceil(RESOLUTION.riseWait / RESOLUTION.window) + 1, 1 / 60, null);
    expect(governor.ratio).toBeGreaterThan(1.15);
  });

  it("relieves a software renderer whose every frame takes most of a second, since its own timings prove the load", () => {
    const governor = new ResolutionGovernor(1, { floor: 0.65, ceiling: 1 });
    let frames = 0;
    while (governor.ratio > 0.65 && frames < 200) { governor.frame(0.7, 650); frames += 1; }
    expect(governor.ratio).toBe(0.65);
    // Two seconds of warm-up, a decision of six frames, a second's rest, and another decision.
    expect(frames).toBeLessThanOrEqual(20);
    // The same slow ticks with a quick GPU (a throttled background tab) change nothing.
    const throttled = new ResolutionGovernor(1, { floor: 0.65, ceiling: 1 });
    for (let i = 0; i < 60; i += 1) expect(throttled.frame(1, 9)).toBeNull();
    expect(throttled.ratio).toBe(1);
  });

  it("shrugs off a card's ordinary wandering and passing stalls without touching the resolution", () => {
    const governor = warmed(1.25);
    // A millisecond or two either way, never over budget twice running.
    for (let i = 0; i < 40; i += 1) run(governor, 1, 1 / 72, [11.4, 12.9, 13.4, 12.2][i % 4]!);
    expect(governor.ratio).toBe(1.25);
    // A stall the card had no part in (another program, a paused tab): nearly a second with a quick GPU reading.
    for (let i = 0; i < 30; i += 1) { expect(governor.frame(0.9, 14)).toBeNull(); run(governor, 1, 1 / 72, 11); }
    expect(governor.ratio).toBe(1.25);
  });

  it("rests after every change, and does not climb again straight after a drop", () => {
    const governor = warmed(1.25);
    run(governor, 2, 1 / 48, 18);
    expect(governor.ratio).toBe(1);
    // The first frames on rebuilt buffers are ignored, however they read.
    for (let i = 0; i < RESOLUTION.rest; i += 1) expect(governor.frame(1 / 60, 90)).toBeNull();
    expect(governor.ratio).toBe(1);
    // Plenty of room at once: still it waits out the seconds after a drop before rising.
    const waiting = Math.floor((RESOLUTION.riseAfterSeconds - RESOLUTION.restSeconds) * 60 / RESOLUTION.window) - 1;
    expect(run(governor, waiting, 1 / 60, 5)).toBeNull();
    run(governor, 3, 1 / 60, 5);
    expect(governor.ratio).toBe(1.25);
  });

  it("does not count stalls (a hidden tab, a debugger) as load", () => {
    const governor = new ResolutionGovernor(1.25, { floor: 0.65, ceiling: 1.25 });
    for (let i = 0; i < RESOLUTION.window * 4; i += 1) expect(governor.frame(1, null)).toBeNull();
    expect(governor.ratio).toBe(1.25);
    expect(governor.frame(Number.NaN, 30)).toBeNull();
    expect(governor.frame(0, 30)).toBeNull();
  });
});
