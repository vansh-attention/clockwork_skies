import { RULES } from "./types";

export class FrameDriver {
  private handle: number | null = null;
  private anchor = 0;
  private generation = 0;
  running = false;
  constructor(private frame: (rawSeconds: number) => void,
    private request: (callback: FrameRequestCallback) => number,
    private cancel: (handle: number) => void, private now: () => number) {}
  resume(): number {
    if (this.running) return this.anchor;
    this.running = true;
    this.anchor = this.now();
    this.schedule();
    return this.anchor;
  }
  private schedule(): void {
    const generation = this.generation;
    this.handle = this.request((stamp) => {
      if (!this.running || generation !== this.generation) return;
      this.handle = null;
      const raw = Math.max(0, (stamp - this.anchor) / 1000);
      this.anchor = stamp;
      this.frame(raw);
      if (this.running && generation === this.generation) this.schedule();
    });
  }
  stop(): void {
    this.running = false;
    this.generation++;
    if (this.handle !== null) this.cancel(this.handle);
    this.handle = null;
  }
}

export class FixedClock {
  private accumulated = 0;
  dropped = 0;
  step(rawSeconds: number, tick: (dt: number) => void): number {
    this.accumulated += Math.max(0, Number.isFinite(rawSeconds) ? rawSeconds : 0);
    const dt = 1 / RULES.hz;
    let steps = 0;
    while (this.accumulated + 1e-10 >= dt && steps < RULES.maxSteps) {
      tick(dt); this.accumulated -= dt; steps++;
    }
    if (this.accumulated >= dt) {
      const dropped = Math.floor(this.accumulated / dt) * dt;
      this.dropped += dropped; this.accumulated -= dropped;
    }
    return Math.max(0, Math.min(1, this.accumulated / dt));
  }
  reset(): void { this.accumulated = 0; }
}

export class FrameMetrics {
  private readonly samples = new Float64Array(300);
  private readonly cpu = new Float64Array(300);
  private cursor = 0;
  private count = 0;
  private elapsed = 0;
  readonly history: number[] = [];
  readonly cpuHistory: number[] = [];
  totalFrames = 0;

  constructor(private readonly capture = false) {}

  record(rawMs: number, cpuMs: number): void {
    if (!Number.isFinite(rawMs) || rawMs <= 0) return;
    const measuredCpu = Number.isFinite(cpuMs) && cpuMs >= 0 ? cpuMs : 0;
    this.samples[this.cursor] = rawMs;
    this.cpu[this.cursor] = measuredCpu;
    this.elapsed += rawMs / 1000;
    if (this.capture && this.elapsed > 5 && this.history.length < 20000) {
      this.history.push(rawMs);
      this.cpuHistory.push(measuredCpu);
    }
    this.cursor = (this.cursor + 1) % this.samples.length;
    this.count = Math.min(this.count + 1, this.samples.length);
    this.totalFrames++;
  }

  snapshot() {
    const values = Array.from(this.samples.subarray(0, this.count)).sort((a, b) => a - b);
    const at = (p: number) => values[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
    const medianMs = at(0.5), p95Ms = at(0.95);
    let cpuSum = 0;
    for (let i = 0; i < this.count; i++) cpuSum += this.cpu[i]!;
    return { medianMs, p95Ms, fps: medianMs ? 1000 / medianMs : 0,
      cpuMeanMs: this.count ? cpuSum / this.count : 0,
      frames: this.totalFrames, sampleCount: this.count };
  }
}
