import { RULES } from "./types";

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
