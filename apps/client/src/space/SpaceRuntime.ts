import { FixedClock, FrameDriver, FrameMetrics } from "./clock";
import { SpaceSession } from "./SpaceSession";
import { SpaceScene } from "./SpaceScene";
import { SpaceInput } from "./SpaceInput";
import { SpaceAudio } from "./SpaceAudio";
import type { HUD, Mode, Phase } from "./types";
export const initialHUD: HUD = {
  phase: "menu", mode: "training", busy: false, hull: 100, heat: 0, energy: 100, speed: 0,
  rockets: 2, remaining: 3, gate: 0, lock: 0, warning: false, objective: "The Drift Yard",
  flash: false, fps: 0, p95: 0, calls: 0, triangles: 0,
  markerX: 50, markerY: 50, markerBehind: false, markerDistance: 0, markerHull: 0,
  markerOffscreen: false, markerBearing: 0, markerKind: "none", notice: "",
};
export type RuntimeOptions = {
  sceneFactory?: (mount: HTMLElement) => SpaceScene;
  inputFactory?: (canvas: HTMLCanvasElement, pause: () => void) => SpaceInput;
  audioFactory?: () => SpaceAudio;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
};
export class SpaceRuntime {
  readonly session = new SpaceSession();
  readonly scene!: SpaceScene;
  readonly input!: SpaceInput;
  readonly audio!: SpaceAudio;
  readonly clock = new FixedClock();
  readonly metrics: FrameMetrics;
  readonly driver!: FrameDriver;
  phase: Phase = "menu";
  busy = false;
  pauseCount = 0;
  private disposed = false; private generation = 0;
  private hudElapsed = 0; private tickWallMs = 0;
  private notice = ""; private noticeUntil = 0;
  private benchmark: boolean; private count: number; private seed: number;
  private debugRead: (() => ReturnType<SpaceRuntime["diagnostics"]>) | null = null;
  constructor(mount: HTMLElement, private publish: (hud: HUD) => void,
    private failed: (message: string) => void, options: RuntimeOptions = {}) {
    const query = new URLSearchParams(window.location.search);
    this.benchmark = query.get("benchmark") === "1";
    const requested = Number(query.get("drones") ?? 3);
    this.count = this.benchmark && Number.isInteger(requested) ? Math.max(1, Math.min(6, requested)) : 3;
    const seed = Number(query.get("seed") ?? 42);
    this.seed = Number.isInteger(seed) ? seed : 42;
    this.metrics = new FrameMetrics(this.benchmark);
    let scene: SpaceScene | undefined;
    let input: SpaceInput | undefined;
    let audio: SpaceAudio | undefined;
    let listenerAdded = false;
    try {
      scene = (options.sceneFactory ?? ((host) => new SpaceScene(host)))(mount);
      this.scene = scene;
      input = (options.inputFactory ?? ((canvas, pause) => new SpaceInput(canvas, pause)))(scene.canvas, () => this.pause());
      this.input = input;
      audio = (options.audioFactory ?? (() => new SpaceAudio()))();
      this.audio = audio;
      this.driver = new FrameDriver(this.frame,
        options.requestFrame ?? (callback => window.requestAnimationFrame(callback)),
        options.cancelFrame ?? (handle => window.cancelAnimationFrame(handle)),
        options.now ?? (() => performance.now()));
      scene.canvas.addEventListener("webglcontextlost", this.contextLost);
      listenerAdded = true;
      this.session.reset("training", 3, this.seed, this.benchmark); this.scene.update(this.session, 1); this.emitHUD();
      if (query.get("debug") === "1" || this.benchmark) {
        this.debugRead = () => this.diagnostics();
        (window as SpaceWindow).__CLOCKWORK_SPACE__ = this.debugRead;
      }
    } catch (error) {
      this.disposed = true;
      this.driver?.stop();
      if (listenerAdded) scene?.canvas.removeEventListener("webglcontextlost", this.contextLost);
      input?.dispose(); audio?.dispose(); scene?.dispose();
      if ((window as SpaceWindow).__CLOCKWORK_SPACE__ === this.debugRead)
        delete (window as SpaceWindow).__CLOCKWORK_SPACE__;
      throw error;
    }
  }
  private contextLost = (event: Event) => {
    if (this.disposed) return;
    event.preventDefault(); this.pause(); this.failed("Graphics context lost. Reload the page; do not keep playing a frozen view.");
  };
  private frame = (raw: number) => {
    if (this.disposed || this.phase !== "playing") return;
    const start = performance.now(), droppedBefore = this.clock.dropped;
    try {
      const alpha = this.clock.step(raw, this.tick);
      this.tickWallMs += (this.clock.dropped - droppedBefore) * 1000;
      this.scene.update(this.session, alpha);
      this.metrics.record(raw * 1000, performance.now() - start);
      this.hudElapsed += raw;
      if (this.session.result !== "playing") {
        this.phase = this.session.result; this.driver.stop(); this.input.release(); this.audio.silence(); this.emitHUD();
      } else if (this.hudElapsed >= 0.1) { this.hudElapsed = 0; this.emitHUD(); }
    } catch (error) { this.pause(); this.failed(error instanceof Error ? error.message : "Space rendering failed"); }
  };
  private tick = (dt: number) => {
    if (this.session.result !== "playing") return;
    this.tickWallMs += dt * 1000;
    const previousHull = this.session.player.hull;
    this.session.tick(dt, this.input.sample(dt, this.tickWallMs));
    if (this.session.player.hull < previousHull) {
      this.session.flashUntil = this.session.time + 0.15;
      if (!this.session.events.some(event => event.kind === "hit" && event.target === "player"))
        this.caption(this.session.warning ? "Sector damage — return to the yard" : "Hull impact");
    }
    for (const event of this.session.events) {
      this.audio.event(event);
      if (event.kind === "gate") this.caption("Gate cleared");
      if (event.kind === "pickup") this.caption(`${event.target ?? "Supply"} collected`);
      if (event.kind === "hit") this.caption(event.target === "player" ? "Taking damage" : "Target hit");
      if (event.kind === "destroyed") this.caption("Target destroyed");
      if (event.kind === "rocket" && event.owner === "player") this.caption("Rocket launched");
    }
  };
  private caption(text: string): void { this.notice = text; this.noticeUntil = this.session.time + 0.8; }
  private emitHUD(): void {
    if (this.disposed) return;
    if (this.phase === "playing" && this.session.time > this.noticeUntil) this.notice = "";
    const player = this.session.player, stats = this.metrics.snapshot(), marker = this.scene.marker;
    this.audio.motion(player.v.length(), this.phase === "playing");
    this.publish({ phase: this.phase, mode: this.session.mode, busy: this.busy, hull: player.hull, heat: player.heat,
      energy: player.energy, speed: player.v.length(), rockets: player.rockets,
      remaining: this.session.remaining, gate: this.session.gate,
      lock: Math.min(1, player.lockTime / 0.9), warning: this.session.warning,
      objective: this.session.objective, flash: this.session.time < this.session.flashUntil,
      fps: stats.fps, p95: stats.p95Ms, calls: this.scene.renderer.info.render.calls,
      triangles: this.scene.renderer.info.render.triangles, markerX: marker.x, markerY: marker.y,
      markerBehind: marker.behind, markerDistance: marker.distance, markerHull: marker.hull,
      markerOffscreen: marker.offscreen, markerBearing: marker.bearing, markerKind: marker.kind,
      notice: this.benchmark ? `BENCHMARK — invulnerable. ${this.notice}` : this.notice });
  }
  async launch(mode: Mode, keyboard = false): Promise<void> {
    if (this.disposed || this.busy) return;
    this.driver.stop(); this.clock.reset(); this.phase = "paused"; this.input.release();
    this.session.reset(mode, this.count, this.seed, this.benchmark); this.scene.update(this.session, 1);
    await this.resume(keyboard);
  }
  async resume(keyboard = false): Promise<void> {
    if (this.disposed || this.busy || this.session.result !== "playing") return;
    this.busy = true;
    const generation = ++this.generation;
    try { this.audio.unlock(); } catch { this.audio.muted = true; } // Audio failure must not block flight.
    this.notice = keyboard ? "Starting keyboard flight" : "Capturing mouse…"; this.emitHUD();
    try {
      await this.input.capture(keyboard);
      if (this.disposed) { this.input.release(); return; }
      if (generation !== this.generation) return; // Never release a newer capture on stale completion.
      if (document.hidden || !document.hasFocus()) {
        this.input.release(); this.phase = "paused"; this.notice = "Focus the flight window and resume intentionally"; return;
      }
      this.clock.reset(); this.hudElapsed = 0; this.phase = "playing"; this.notice = "";
      this.tickWallMs = this.driver.resume(); this.emitHUD();
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.phase = "paused"; this.notice = error instanceof Error ? error.message : "Mouse capture failed"; this.emitHUD();
    } finally { this.busy = false; if (!this.disposed) this.emitHUD(); }
  }
  pause(): void {
    if (this.disposed || this.phase !== "playing" && !this.busy) return;
    if (this.phase === "playing") this.pauseCount++;
    this.generation++; this.phase = "paused"; this.driver.stop(); this.clock.reset();
    this.input.cancelPendingCapture(); this.notice = "Flight paused — resume intentionally";
    this.input.release(); this.audio.silence(); this.emitHUD();
  }
  menu(): void {
    if (this.disposed || this.busy) return;
    this.generation++; this.driver.stop(); this.clock.reset(); this.phase = "menu";
    this.input.release(); this.audio.silence(); this.session.reset("training", 3, this.seed, this.benchmark);
    this.notice = ""; this.scene.update(this.session, 1); this.emitHUD();
  }
  quality(value: "medium" | "low"): void { this.scene.setQuality(value); if (this.phase !== "playing") this.scene.update(this.session, 1); }
  mute(value: boolean): void { this.audio.muted = value; if (value) this.audio.silence(); }
  diagnostics() {
    return { phase: this.phase, mode: this.session.mode, time: this.session.time,
      player: { p: this.session.player.p.toArray(), q: this.session.player.q.toArray(),
        hull: this.session.player.hull, heat: this.session.player.heat, energy: this.session.player.energy },
      remaining: this.session.remaining, driverRunning: this.driver.running, pauseCount: this.pauseCount,
      ships: this.session.ships.map(ship => ({ id: ship.id, p: ship.p.toArray(), q: ship.q.toArray(), hull: ship.hull, heat: ship.heat })),
      rocketState: this.session.combat.rockets.map(rocket => ({ active: rocket.active, p: rocket.p.toArray(), ttl: rocket.ttl })),
      pickupState: Array.from(this.session.pickupAt),
      visible: !document.hidden && document.hasFocus(),
      frameMs: this.metrics.history.slice(), cpuMs: this.metrics.cpuHistory.slice(),
      timing: this.metrics.snapshot(), droppedSimulationSeconds: this.clock.dropped,
      droppedInputEvents: this.input.droppedEvents,
      pools: { ships: this.session.ships.length, rockets: this.session.combat.rockets.length, traces: this.session.combat.traces.length },
      ...this.scene.diagnostics() };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++; this.driver.stop(); this.input.dispose(); this.audio.dispose();
    this.scene.canvas.removeEventListener("webglcontextlost", this.contextLost); this.scene.dispose();
    const target = window as SpaceWindow;
    if (target.__CLOCKWORK_SPACE__ === this.debugRead) delete target.__CLOCKWORK_SPACE__;
  }
}
export type SpaceWindow = Window & { __CLOCKWORK_SPACE__?: () => ReturnType<SpaceRuntime["diagnostics"]> };

