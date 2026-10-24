import { neutral, type Controls } from "./types";
const GAME_KEYS = new Set(["KeyW", "KeyS", "KeyA", "KeyD", "KeyR", "KeyF", "KeyQ", "KeyE",
  "KeyJ", "KeyK", "Space", "ShiftLeft", "ShiftRight", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
type Queued = { at: number; kind: "key" | "mouse" | "button"; code?: string;
  pressed?: boolean; dx?: number; dy?: number; button?: number };
export class SpaceInput {
  private keys = new Set<string>();
  private queue: Queued[] = [];
  private head = 0; private fire = false; private rocket = false;
  private capturing = false; private cancelCapture: (() => void) | null = null;
  private granted = false;
  keyboard = false;
  sensitivity = 0.002;
  droppedEvents = 0;
  constructor(readonly canvas: HTMLCanvasElement, private pause: () => void) {
    window.addEventListener("keydown", this.down); window.addEventListener("keyup", this.up);
    window.addEventListener("blur", this.blur); window.addEventListener("mousemove", this.mouse);
    canvas.addEventListener("mousedown", this.buttonDown); window.addEventListener("mouseup", this.buttonUp);
    canvas.addEventListener("contextmenu", this.context); document.addEventListener("pointerlockchange", this.lock);
    document.addEventListener("visibilitychange", this.visibility);
  }
  private active = () => {
    const focus = document.activeElement as HTMLElement | null;
    if (focus?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(focus?.tagName ?? "")) return false;
    return document.pointerLockElement === this.canvas || this.keyboard && focus === this.canvas;
  };
  private enqueue(event: Queued): void {
    if (this.queue.length - this.head >= 512) { this.droppedEvents++; this.reset(); }
    this.queue.push(event);
  }
  private down = (e: KeyboardEvent) => {
    if (e.code === "Escape") { this.reset(); this.pause(); return; }
    if (e.code === "Tab" && this.active()) { this.reset(); this.pause(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) { this.reset(); return; }
    if (!this.active() || !GAME_KEYS.has(e.code)) return;
    e.preventDefault(); if (!e.repeat) this.enqueue({ at: e.timeStamp, kind: "key", code: e.code, pressed: true });
  };
  private up = (e: KeyboardEvent) => {
    if (GAME_KEYS.has(e.code)) this.enqueue({ at: e.timeStamp, kind: "key", code: e.code, pressed: false });
  };
  private blur = () => { this.reset(); this.pause(); };
  private visibility = () => { if (document.hidden) this.blur(); };
  private mouse = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) return;
    // Discard impossible individual device spikes, not legitimate accumulated motion.
    if (!Number.isFinite(e.movementX) || !Number.isFinite(e.movementY) ||
      Math.abs(e.movementX) > 10000 || Math.abs(e.movementY) > 10000) { this.droppedEvents++; return; }
    this.enqueue({ at: e.timeStamp, kind: "mouse", dx: e.movementX, dy: e.movementY });
  };
  private buttonDown = (e: MouseEvent) => {
    if (this.active() && (e.button === 0 || e.button === 2))
      this.enqueue({ at: e.timeStamp, kind: "button", button: e.button, pressed: true });
  };
  private buttonUp = (e: MouseEvent) => {
    if (e.button === 0 || e.button === 2) this.enqueue({ at: e.timeStamp, kind: "button", button: e.button, pressed: false });
  };
  private context = (e: Event) => e.preventDefault();
  private lock = () => {
    if (document.pointerLockElement === this.canvas) {
      if (!this.capturing && !this.granted) document.exitPointerLock(); // Reject a late cancelled request.
    } else if (!this.capturing && !this.keyboard) this.blur();
  };
  async capture(keyboard = false): Promise<void> {
    this.reset(); this.granted = false; this.keyboard = keyboard; this.canvas.focus({ preventScroll: true });
    if (keyboard || document.pointerLockElement === this.canvas) return;
    if (!this.canvas.requestPointerLock) throw new Error("Pointer lock unavailable; open in Chrome/Edge or use keyboard flight.");
    this.capturing = true;
    try {
      await new Promise<void>((resolve, reject) => {
        let timer = 0, settled = false;
        const cleanup = () => { window.clearTimeout(timer); document.removeEventListener("pointerlockchange", changed);
          document.removeEventListener("pointerlockerror", failed); this.cancelCapture = null; };
        const changed = () => {
          if (!settled && document.pointerLockElement === this.canvas) {
            settled = true; this.granted = true; cleanup(); resolve();
          }
        };
        const failed = () => {
          if (settled) return; settled = true; cleanup();
          reject(new Error("Mouse capture failed; open in a browser or use keyboard flight."));
        };
        this.cancelCapture = failed;
        document.addEventListener("pointerlockchange", changed); document.addEventListener("pointerlockerror", failed);
        timer = window.setTimeout(failed, 1500);
        try { const request = this.canvas.requestPointerLock(); Promise.resolve(request).catch(failed); changed(); }
        catch { failed(); }
      });
    } finally { this.capturing = false; }
    this.reset(); // The capture click is not a cannon command.
  }
  sample(dt: number, untilMs = Infinity): Controls {
    if (!this.active()) { this.reset(); return neutral(); }
    const c = neutral();
    while (this.head < this.queue.length && this.queue[this.head]!.at <= untilMs) {
      const event = this.queue[this.head++]!;
      if (event.kind === "key") { if (event.pressed) this.keys.add(event.code!); else this.keys.delete(event.code!); }
      if (event.kind === "button") { if (event.button === 0) this.fire = !!event.pressed; else this.rocket = !!event.pressed; }
      if (event.kind === "mouse") { c.yaw -= event.dx! * this.sensitivity; c.pitch -= event.dy! * this.sensitivity; }
    }
    if (this.head > 64 || this.head === this.queue.length) { this.queue.splice(0, this.head); this.head = 0; }
    const key = (code: string) => Number(this.keys.has(code));
    c.yaw += (key("ArrowLeft") - key("ArrowRight")) * 1.5 * dt;
    c.pitch += (key("ArrowUp") - key("ArrowDown")) * 1.5 * dt;
    c.roll = key("KeyE") - key("KeyQ"); c.forward = key("KeyW") - key("KeyS");
    c.strafe = key("KeyD") - key("KeyA"); c.lift = key("KeyR") - key("KeyF");
    c.brake = !!key("Space"); c.boost = !!(key("ShiftLeft") || key("ShiftRight"));
    c.fire = this.fire || !!key("KeyJ"); c.rocket = this.rocket || !!key("KeyK");
    return c;
  }
  reset(): void { this.keys.clear(); this.queue.length = 0; this.head = 0; this.fire = this.rocket = false; }
  cancelPendingCapture(): void {
    this.granted = false;
    this.capturing = false;
    this.cancelCapture?.();
  }
  release(): void { this.granted = false; this.reset(); if (document.pointerLockElement === this.canvas) document.exitPointerLock(); }
  dispose(): void {
    this.cancelCapture?.(); this.release(); window.removeEventListener("keydown", this.down); window.removeEventListener("keyup", this.up);
    window.removeEventListener("blur", this.blur); window.removeEventListener("mousemove", this.mouse);
    this.canvas.removeEventListener("mousedown", this.buttonDown); window.removeEventListener("mouseup", this.buttonUp);
    this.canvas.removeEventListener("contextmenu", this.context); document.removeEventListener("pointerlockchange", this.lock);
    document.removeEventListener("visibilitychange", this.visibility);
  }
}
