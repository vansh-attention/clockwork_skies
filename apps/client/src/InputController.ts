import { NEUTRAL_INPUT, PROTOCOL_VERSION, clamp, type InputCommand } from "@clockwork/shared";

type InputOptions = { onInput: (input: InputCommand) => void; getRocketTarget: () => string | null; initialSequence?: number };

export class InputController {
  private readonly keys = new Set<string>();
  private aimX = 0;
  private aimY = 0;
  private cannon = false;
  private rocket = false;
  private sequence = 0;
  private timer = 0;
  private lastEmote = 0;
  private ping: InputCommand["ping"] = null;
  private enabled = false;

  constructor(private readonly element: HTMLElement, private readonly options: InputOptions) { this.sequence = options.initialSequence ?? 0; }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("blur", this.reset);
    document.addEventListener("pointerlockchange", this.onLockChange);
    this.element.addEventListener("contextmenu", this.onContextMenu);
    this.element.addEventListener("click", this.requestLock);
    this.timer = window.setInterval(() => this.send(), 1000 / 30);
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("blur", this.reset);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    this.element.removeEventListener("contextmenu", this.onContextMenu);
    this.element.removeEventListener("click", this.requestLock);
    window.clearInterval(this.timer);
    this.reset();
  }

  private reset = () => { this.keys.clear(); this.cannon = false; this.rocket = false; this.aimX = 0; this.aimY = 0; this.ping = null; this.lastEmote = 0; };
  private onLockChange = () => { if (document.pointerLockElement !== this.element) this.reset(); };
  private onContextMenu = (event: Event) => event.preventDefault();
  private requestLock = () => {
    this.element.focus();
    if (document.pointerLockElement !== this.element) {
      try { const result = this.element.requestPointerLock?.(); result?.catch(() => {}); } catch { /* Absolute mouse aiming remains available. */ }
    }
  };
  private onMouseMove = (event: MouseEvent) => {
    if (document.pointerLockElement === this.element) {
      this.aimX = clamp(this.aimX + event.movementX * 0.0028, -1, 1);
      this.aimY = clamp(this.aimY + event.movementY * 0.0028, -1, 1);
    } else if (event.target === this.element) {
      this.aimX = clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
      this.aimY = clamp((event.clientY / window.innerHeight) * 2 - 1, -1, 1);
    }
  };
  private onMouseDown = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.element && event.target !== this.element) return;
    if (event.button === 0) this.cannon = true;
    if (event.button === 2) this.rocket = true;
  };
  private onMouseUp = (event: MouseEvent) => { if (event.button === 0) this.cannon = false; if (event.button === 2) this.rocket = false; };
  private onKeyDown = (event: KeyboardEvent) => {
    if (document.activeElement !== this.element && document.pointerLockElement !== this.element) return;
    if (["Space", "KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyC"].includes(event.code)) event.preventDefault();
    this.keys.add(event.code);
    if (event.code === "KeyQ") this.ping = "enemy";
    if (/^Digit[1-4]$/.test(event.code)) this.lastEmote = Number(event.code.slice(-1));
  };
  private onKeyUp = (event: KeyboardEvent) => this.keys.delete(event.code);

  private send() {
    if (document.activeElement !== this.element && document.pointerLockElement !== this.element) this.reset();
    const pad = navigator.getGamepads?.()[0];
    const padAimX = pad?.axes[2] ?? 0;
    const padAimY = pad?.axes[3] ?? 0;
    const padThrottle = -(pad?.axes[1] ?? 0);
    const input: InputCommand = {
      ...NEUTRAL_INPUT,
      version: PROTOCOL_VERSION,
      sequence: ++this.sequence,
      clientTime: performance.now(),
      aimX: clamp(Math.abs(padAimX) > 0.12 ? padAimX : this.aimX, -1, 1),
      aimY: clamp(Math.abs(padAimY) > 0.12 ? padAimY : this.aimY, -1, 1),
      throttle: clamp((this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0) + padThrottle, -1, 1),
      fineRoll: clamp((this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0), -1, 1),
      cannon: this.cannon || !!pad?.buttons[7]?.pressed,
      rocket: this.rocket || !!pad?.buttons[6]?.pressed,
      rocketTargetId: this.options.getRocketTarget(),
      boost: this.keys.has("Space") || !!pad?.buttons[0]?.pressed,
      rearView: this.keys.has("KeyC") || !!pad?.buttons[2]?.pressed,
      ping: this.ping,
      emote: this.lastEmote,
    };
    this.options.onInput(input);
    this.ping = null;
    this.lastEmote = 0;
    this.aimX *= 0.965;
    this.aimY *= 0.965;
  }
}
