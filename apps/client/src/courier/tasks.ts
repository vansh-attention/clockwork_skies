import type { Vec3 } from "@clockwork/shared";

export type IslandId = "home" | "lanternfall";
export type AnchorId =
  | "market-parcel" | "observatory-door" | "escapement" | "port-letter"
  | "home-launcher" | "lanternfall-gate" | "keeper-door";

/** World position of a task spot and how close the courier must be. */
export type Anchor = {
  island: IslandId;
  position: Vec3;
  radius: number;
  /** Largest height difference that still counts as in range. Defaults to 6. */
  maxDy?: number;
};

export type StepKind = "pickup" | "deliver" | "tick" | "launch" | "land";
export type TaskStep = { readonly kind: StepKind; readonly anchor: AnchorId; readonly label: string; readonly prompt: string | null };
export type TaskDef = { readonly id: string; readonly title: string; readonly steps: readonly TaskStep[] };

export const TASKS: readonly TaskDef[] = [
  {
    id: "market-parcel",
    title: "Market parcel",
    steps: [
      { kind: "pickup", anchor: "market-parcel", label: "Pick up the parcel at Covent Garden", prompt: "E · Pick up parcel" },
      { kind: "deliver", anchor: "observatory-door", label: "Deliver it to St Paul's", prompt: "E · Deliver parcel" },
    ],
  },
  {
    id: "oil-escapement",
    title: "Westminster clock",
    steps: [
      { kind: "tick", anchor: "escapement", label: "Oil the Westminster clock in time with the tick", prompt: "E · Oil on the tick" },
    ],
  },
  {
    id: "lanternfall-letter",
    title: "Letter for Lanternfall",
    steps: [
      { kind: "pickup", anchor: "port-letter", label: "Collect the letter at Tower Wharf", prompt: "E · Collect letter" },
      { kind: "launch", anchor: "home-launcher", label: "Launch from the spring launcher on the east rim", prompt: "E · Launch" },
      { kind: "land", anchor: "lanternfall-gate", label: "Fly slowly through Lanternfall's landing gate", prompt: null },
      { kind: "deliver", anchor: "keeper-door", label: "Deliver the letter to the lighthouse keeper", prompt: "E · Deliver letter" },
    ],
  },
];

/** A press this far into each second still counts as on the tick (the wheel kicks at whole seconds). */
export const TICK_WINDOW_MS = 260;
export const TICK_HITS_NEEDED = 3;
/** Fastest plane speed that still counts as a landing. */
export const LANDING_SPEED = 45;

/** Presses this close before the whole second also count, to forgive early reflexes. */
export const TICK_EARLY_MS = 60;
/** A second hit this soon after the last one is the same tick. */
const TICK_DEBOUNCE_MS = 500;
/** Default height difference that still counts as the same terrace level. */
const DEFAULT_MAX_DY = 6;
/** After a too-fast report for a gate, ignore further passes of that gate for this long. */
const TOO_FAST_DEBOUNCE_MS = 1000;

export type TaskEvent =
  | { type: "step-done"; taskId: string; stepIndex: number }
  | { type: "task-done"; taskId: string }
  | { type: "round-done"; elapsedMs: number }
  | { type: "tick-hit"; hits: number }
  | { type: "tick-miss" }
  | { type: "launch"; anchor: AnchorId }
  | { type: "landed"; anchor: AnchorId }
  | { type: "too-fast"; speed: number };

export type CourierMode = "walk" | "fly";

export type TaskSnapshot = {
  taskIndex: number;
  stepIndex: number;
  taskId: string | null;
  title: string;
  stepLabel: string;
  /** The interaction hint to show now (e.g. "E · Pick up parcel"), or null when out of range or not interactive. */
  prompt: string | null;
  target: AnchorId | null;
  targetPosition: Vec3 | null;
  tickHits: number;
  done: boolean;
  elapsedMs: number;
  checklist: ReadonlyArray<{ label: string; done: boolean; current: boolean }>;
};

export class TaskRunner {
  private taskIndex = 0;
  private stepIndex = 0;
  private tickHits = 0;
  private lastHitMs = Number.NEGATIVE_INFINITY;
  private startedAtMs: number;
  private finishedElapsedMs: number | null = null;
  private mode: CourierMode | null = null;
  private position: Vec3 | null = null;
  private readonly tooFastAt = new Map<AnchorId, number>();
  private readonly anchors: Readonly<Record<AnchorId, Anchor>>;

  /** Every `nowMs` passed to this class must come from the same clock, `Date.now()`. */
  constructor(anchors: Readonly<Record<AnchorId, Anchor>>, startedAtMs: number) {
    const copy = {} as Record<AnchorId, Anchor>;
    for (const id of Object.keys(anchors) as AnchorId[]) {
      const a = anchors[id];
      copy[id] = { ...a, position: { x: a.position.x, y: a.position.y, z: a.position.z } };
    }
    this.anchors = copy;
    this.startedAtMs = startedAtMs;
  }

  /** Each fixed step: where the courier (or plane) is. Updates whether the current step's prompt is in range. */
  update(mode: CourierMode, position: Vec3): void {
    this.mode = mode;
    this.position = { x: position.x, y: position.y, z: position.z };
  }

  /** The player pressed E. nowMs must be wall-clock ms (`Date.now()`), used for the tick window. */
  interact(nowMs: number): TaskEvent[] {
    const step = this.currentStep();
    if (!step || step.kind === "land" || !this.inRange(step)) return [];

    switch (step.kind) {
      case "tick":
        return this.pressTick(nowMs);
      case "launch":
        return [{ type: "launch", anchor: step.anchor }, ...this.completeStep(nowMs)];
      default:
        return this.completeStep(nowMs);
    }
  }

  /** The controller saw the plane pass through a landing gate at `speed`. */
  passGate(anchor: AnchorId, speed: number, nowMs: number): TaskEvent[] {
    const step = this.currentStep();
    if (!step || step.kind !== "land" || step.anchor !== anchor) return [];
    if (speed > LANDING_SPEED) {
      const last = this.tooFastAt.get(anchor);
      if (last !== undefined && nowMs - last < TOO_FAST_DEBOUNCE_MS) return [];
      this.tooFastAt.set(anchor, nowMs);
      return [{ type: "too-fast", speed }];
    }
    return [{ type: "landed", anchor }, ...this.completeStep(nowMs)];
  }

  /**
   * Un-stick a failed flight: on a land step, go back to the preceding launch step so its prompt shows again.
   * Does nothing on any other step.
   */
  retryLaunch(): void {
    const task = TASKS[this.taskIndex];
    if (!task || task.steps[this.stepIndex]?.kind !== "land") return;
    for (let i = this.stepIndex - 1; i >= 0; i--) {
      if (task.steps[i]?.kind === "launch") {
        this.stepIndex = i;
        this.tooFastAt.clear();
        return;
      }
    }
  }

  snapshot(nowMs: number): TaskSnapshot {
    const task = TASKS[this.taskIndex];
    const step = this.currentStep();
    if (!task || !step) {
      return {
        taskIndex: this.taskIndex, stepIndex: 0, taskId: null, title: "Round complete", stepLabel: "All deliveries made",
        prompt: null, target: null, targetPosition: null, tickHits: 0, done: true,
        elapsedMs: this.finishedElapsedMs ?? this.elapsed(nowMs), checklist: [],
      };
    }
    const anchorPos = this.anchors[step.anchor].position;
    return {
      taskIndex: this.taskIndex,
      stepIndex: this.stepIndex,
      taskId: task.id,
      title: task.title,
      stepLabel: step.kind === "tick" ? `${step.label} (${this.tickHits}/${TICK_HITS_NEEDED})` : step.label,
      prompt: this.inRange(step) ? step.prompt : null,
      target: step.anchor,
      targetPosition: { x: anchorPos.x, y: anchorPos.y, z: anchorPos.z },
      tickHits: this.tickHits,
      done: false,
      elapsedMs: this.elapsed(nowMs),
      checklist: task.steps.map((s, i) => ({ label: s.label, done: i < this.stepIndex, current: i === this.stepIndex })),
    };
  }

  reset(startedAtMs: number): void {
    this.taskIndex = 0;
    this.stepIndex = 0;
    this.tickHits = 0;
    this.lastHitMs = Number.NEGATIVE_INFINITY;
    this.startedAtMs = startedAtMs;
    this.finishedElapsedMs = null;
    this.tooFastAt.clear();
  }

  private currentStep(): TaskStep | undefined {
    return TASKS[this.taskIndex]?.steps[this.stepIndex];
  }

  private elapsed(nowMs: number): number {
    return Math.max(0, nowMs - this.startedAtMs);
  }

  private inRange(step: TaskStep): boolean {
    if (step.kind === "land" || this.mode !== "walk" || !this.position) return false;
    const anchor = this.anchors[step.anchor];
    const dx = this.position.x - anchor.position.x;
    const dz = this.position.z - anchor.position.z;
    const dy = this.position.y - anchor.position.y;
    return Math.hypot(dx, dz) <= anchor.radius && Math.abs(dy) <= (anchor.maxDy ?? DEFAULT_MAX_DY);
  }

  private pressTick(nowMs: number): TaskEvent[] {
    if (nowMs - this.lastHitMs < TICK_DEBOUNCE_MS) return [];
    const phase = ((nowMs % 1000) + 1000) % 1000;
    if (!(phase < TICK_WINDOW_MS || phase > 1000 - TICK_EARLY_MS)) return [{ type: "tick-miss" }];
    this.lastHitMs = nowMs;
    this.tickHits += 1;
    const events: TaskEvent[] = [{ type: "tick-hit", hits: this.tickHits }];
    if (this.tickHits >= TICK_HITS_NEEDED) events.push(...this.completeStep(nowMs));
    return events;
  }

  /** Mark the current step done and move on, emitting the step/task/round events. */
  private completeStep(nowMs: number): TaskEvent[] {
    const task = TASKS[this.taskIndex];
    if (!task) return [];
    const events: TaskEvent[] = [{ type: "step-done", taskId: task.id, stepIndex: this.stepIndex }];
    this.tickHits = 0;
    if (this.stepIndex + 1 < task.steps.length) {
      this.stepIndex += 1;
      return events;
    }
    events.push({ type: "task-done", taskId: task.id });
    this.taskIndex += 1;
    this.stepIndex = 0;
    if (this.taskIndex >= TASKS.length) {
      this.finishedElapsedMs = this.elapsed(nowMs);
      events.push({ type: "round-done", elapsedMs: this.finishedElapsedMs });
    }
    return events;
  }
}
