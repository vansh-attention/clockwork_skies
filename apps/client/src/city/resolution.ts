/**
 * Steers the drawing resolution so the town keeps a smooth frame rate on whatever graphics card it meets: a little
 * softer when the card is over its budget, back to full sharpness when there is room.
 *
 * It prefers the GPU's own time per frame (see gpuTimer.ts). The frame rate alone is a poor guide: vertical sync
 * rounds it to steps (144, 72, 48, 36 on a 144 Hz screen), so a card one millisecond over budget and one eight
 * milliseconds over look the same, and there is no telling how much room a rise would have. With the real time, each
 * change is sized to land inside the budget. Where the browser gives no GPU time, it falls back to the frame rate.
 *
 * It is deliberately slow to act. Every change rebuilds the drawing buffers (a stall of a few frames), and a card's
 * time wanders by a millisecond or two with heat and with what else the computer is doing. So it ignores loading,
 * waits for a slow spell to repeat before dropping, rests after every change, and leaves a wide gap between the time
 * that makes it drop and the time it will rise into.
 */
export const RESOLUTION = {
  /**
   * Each decision looks at this many frames, or at this many seconds' worth if that comes first (a renderer managing
   * two frames a second must not wait twenty seconds to be relieved), but never at fewer than `least` frames.
   */
  window: 45,
  windowSeconds: 1.5,
  least: 6,
  /**
   * GPU milliseconds a frame: sixty frames a second leaves 16.7 ms, of which the script wants its share. Above `over`
   * the resolution drops, aiming at `aim`. It rises only when the rise would still cost no more than `settle`: pixels
   * cost at most in proportion, so that is known before trying, and the two milliseconds between `settle` and `over`
   * keep a card's ordinary wandering from tipping it back.
   */
  gpu: { over: 13, settle: 11, aim: 10.5 },
  /**
   * Without a GPU reading: frames a second below which the resolution drops, and above which it may rise. Below
   * `crawl` the picture is a slide show: the drop is doubled and made at once.
   */
  fps: { low: 50, high: 57, crawl: 30, down: 0.1, up: 0.05 },
  /** The largest single change, as a factor of the ratio. */
  step: { down: 0.8, up: 1.25 },
  /** Ratios move in steps this size, so the buffers are not rebuilt for a sliver. */
  grain: 0.05,
  /**
   * A drop waits for this many decisions in a row to ask for it: a passing hitch is not a reason to soften the
   * picture. A card further over budget than `urgent` times is relieved at once.
   */
  patience: 2,
  urgent: 1.6,
  /**
   * Ignored after the start, after every reset and (the shorter `rest`) after every change, since loading, first
   * draws and freshly rebuilt buffers say nothing about steady load: this many frames, or seconds if that comes first.
   */
  warmup: 120,
  warmupSeconds: 2,
  rest: 30,
  restSeconds: 1,
  /** After a drop, seconds before a rise is tried on GPU time, and frames before one is tried on frame rate alone. */
  riseAfterSeconds: 5,
  riseWait: 1200,
  /**
   * A frame longer than this (seconds) is a stall, not load, and is not counted (a hidden tab ticks once a second; a
   * debugger; another program hogging the computer), unless the GPU's own reading shows it was busy for at least
   * `busy` of that time: a software renderer at one frame a second is real load.
   */
  stall: 0.6,
  busy: 0.5,
} as const;

export type ResolutionLimits = { floor: number; ceiling: number };

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

export class ResolutionGovernor {
  private gpu: number[] = [];
  private frames = 0;
  private windowSeconds = 0;
  /** Frames and seconds still to be ignored (warming up, or resting after a change). */
  private idleFrames: number = RESOLUTION.warmup;
  private idleSeconds: number = RESOLUTION.warmupSeconds;
  private dropsAsked = 0;
  private framesSinceDrop: number = RESOLUTION.riseWait;
  private secondsSinceDrop: number = RESOLUTION.riseAfterSeconds;
  private floor: number;
  private ceiling: number;

  /** `ratio` is the pixel ratio in use now; it is kept between `limits.floor` and `limits.ceiling`. */
  constructor(public ratio: number, limits: ResolutionLimits) {
    this.floor = limits.floor;
    this.ceiling = Math.max(limits.floor, limits.ceiling);
  }

  /** The sharpest ratio allowed (the screen's own, capped): it changes when the window moves to another screen. */
  setCeiling(ceiling: number): void {
    if (Number.isFinite(ceiling) && ceiling > 0) this.ceiling = Math.max(this.floor, ceiling);
  }

  /** Forget what was measured and warm up afresh (the tab was hidden, the view changed, new things were loaded). */
  reset(): void {
    this.idle(RESOLUTION.warmup, RESOLUTION.warmupSeconds);
  }

  private idle(frames: number, seconds: number): void {
    this.gpu.length = 0;
    this.frames = 0;
    this.windowSeconds = 0;
    this.dropsAsked = 0;
    this.idleFrames = frames;
    this.idleSeconds = seconds;
  }

  /**
   * One drawn frame: `dt` seconds since the last, and the GPU's time for a recent frame in milliseconds (null where
   * the browser cannot say). Returns the ratio to switch to, or null to stay as it is.
   */
  frame(dt: number, gpuMs: number | null): number | null {
    if (!(dt > 0)) return null;
    const measured = gpuMs !== null && Number.isFinite(gpuMs) && gpuMs > 0;
    // A long frame counts only when the card itself was busy for most of it (see RESOLUTION.stall).
    if (dt > RESOLUTION.stall && !(measured && gpuMs >= dt * 1000 * RESOLUTION.busy)) return null;
    this.framesSinceDrop += 1;
    this.secondsSinceDrop += dt;
    if (this.idleFrames > 0 && this.idleSeconds > 0) { this.idleFrames -= 1; this.idleSeconds -= dt; return null; }
    this.frames += 1;
    this.windowSeconds += dt;
    if (measured) this.gpu.push(gpuMs);
    const counted = this.frames;
    if (counted < RESOLUTION.window && (this.windowSeconds < RESOLUTION.windowSeconds || counted < RESOLUTION.least)) return null;
    const gpuMs50 = this.gpu.length >= counted / 2 ? median(this.gpu) : null;
    // Frames over the seconds they took (not the mean of each frame's rate, which a few quick frames would flatter).
    const frameRate = counted / this.windowSeconds;
    const next = this.settle(gpuMs50 !== null ? this.byGpu(gpuMs50) : this.byFrameRate(frameRate));
    this.gpu.length = 0;
    this.frames = 0;
    this.windowSeconds = 0;
    if (next >= this.ratio) {
      this.dropsAsked = 0;
      if (next === this.ratio) return null;
      return this.change(next);
    }
    // A drop: only once it has been asked for `patience` times running, unless the card is drowning.
    this.dropsAsked += 1;
    const drowning = gpuMs50 !== null ? gpuMs50 > RESOLUTION.gpu.over * RESOLUTION.urgent : frameRate < RESOLUTION.fps.crawl;
    if (this.dropsAsked < RESOLUTION.patience && !drowning) return null;
    this.framesSinceDrop = 0;
    this.secondsSinceDrop = 0;
    return this.change(next);
  }

  /** Switch, and rest: the first frames on rebuilt buffers are not a fair measure. */
  private change(next: number): number {
    this.ratio = next;
    this.idle(RESOLUTION.rest, RESOLUTION.restSeconds);
    return next;
  }

  /** Pixels cost time in proportion, so the ratio (one side of the picture) moves by the square root of the change wanted. */
  private byGpu(ms: number): number {
    const { over, settle, aim } = RESOLUTION.gpu;
    if (ms > over) return this.ratio * Math.max(RESOLUTION.step.down, Math.sqrt(aim / ms));
    if (this.secondsSinceDrop < RESOLUTION.riseAfterSeconds) return this.ratio;
    return this.ratio * Math.max(1, Math.min(RESOLUTION.step.up, Math.sqrt(settle / ms)));
  }

  private byFrameRate(average: number): number {
    const { low, high, crawl, down, up } = RESOLUTION.fps;
    if (average < crawl) return this.ratio - down * 2;
    if (average < low) return this.ratio - down;
    if (average > high && this.framesSinceDrop >= RESOLUTION.riseWait) return this.ratio + up;
    return this.ratio;
  }

  /** Whole steps only (rounded down, so a rise never overshoots), within the limits; the ceiling itself is always reachable. */
  private settle(wanted: number): number {
    if (wanted >= this.ceiling) return this.ceiling;
    const stepped = Math.floor(wanted / RESOLUTION.grain + 1e-6) * RESOLUTION.grain;
    // A drop always moves at least one step, or a card just over budget would never be relieved.
    // And a rise never ends lower than it began (a ratio that was not on a whole step, such as an odd ceiling).
    const moved = wanted < this.ratio ? (stepped >= this.ratio ? this.ratio - RESOLUTION.grain : stepped) : Math.max(this.ratio, stepped);
    return Math.min(this.ceiling, Math.max(this.floor, Number(moved.toFixed(4))));
  }
}
