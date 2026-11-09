import type { Vec3 } from "@clockwork/shared";
import { describe, expect, it } from "vitest";
import {
  LANDING_SPEED, TASKS, TICK_EARLY_MS, TICK_HITS_NEEDED, TICK_WINDOW_MS, TaskRunner,
  type Anchor, type AnchorId, type TaskEvent,
} from "./tasks";

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const ANCHORS: Record<AnchorId, Anchor> = {
  "market-parcel": { island: "home", position: at(0, 0, 0), radius: 2 },
  "observatory-door": { island: "home", position: at(10, 5, 0), radius: 2 },
  escapement: { island: "home", position: at(20, 0, 0), radius: 2 },
  "port-letter": { island: "home", position: at(30, 0, 0), radius: 2 },
  "home-launcher": { island: "home", position: at(40, 0, 0), radius: 2 },
  "lanternfall-gate": { island: "lanternfall", position: at(100, 50, 0), radius: 5 },
  "keeper-door": { island: "lanternfall", position: at(110, 0, 0), radius: 2 },
};

const START = 1_000_000;
const make = () => new TaskRunner(ANCHORS, START);
const types = (events: TaskEvent[]) => events.map((e) => e.type);

/** Walk to an anchor and press E at a time well inside the tick window. */
function interactAt(runner: TaskRunner, id: AnchorId, nowMs = START + 100) {
  runner.update("walk", ANCHORS[id].position);
  return runner.interact(nowMs);
}

/** Three tick hits on separate seconds. */
function doTicks(runner: TaskRunner, base = 5_000) {
  const out: TaskEvent[] = [];
  for (let i = 0; i < TICK_HITS_NEEDED; i++) out.push(...interactAt(runner, "escapement", base + i * 1000 + 50));
  return out;
}

/** Advance a fresh runner to the first step of task `n` (0-based). */
function advanceToTask(runner: TaskRunner, n: number) {
  if (n >= 1) {
    interactAt(runner, "market-parcel");
    interactAt(runner, "observatory-door");
  }
  if (n >= 2) doTicks(runner);
}

describe("task definitions", () => {
  it("lists the three tasks with exact copy", () => {
    expect(TASKS.map((t) => t.id)).toEqual(["market-parcel", "oil-escapement", "lanternfall-letter"]);
    expect(TASKS.map((t) => t.title)).toEqual(["Market parcel", "Westminster clock", "Letter for Lanternfall"]);
    expect(TASKS[2]!.steps.map((s) => [s.kind, s.anchor, s.prompt])).toEqual([
      ["pickup", "port-letter", "E · Collect letter"],
      ["launch", "home-launcher", "E · Launch"],
      ["land", "lanternfall-gate", null],
      ["deliver", "keeper-door", "E · Deliver letter"],
    ]);
    expect(TASKS[0]!.steps[0]!.label).toBe("Pick up the parcel at Covent Garden");
    expect(TASKS[1]!.steps[0]!.label).toBe("Oil the Westminster clock in time with the tick");
  });

  it("exposes the tuning constants", () => {
    expect(TICK_WINDOW_MS).toBe(260);
    expect(TICK_HITS_NEEDED).toBe(3);
    expect(LANDING_SPEED).toBe(45);
  });
});

describe("full round", () => {
  it("plays through all tasks in order", () => {
    const r = make();
    expect(types(interactAt(r, "market-parcel"))).toEqual(["step-done"]);
    expect(interactAt(r, "observatory-door")).toEqual([
      { type: "step-done", taskId: "market-parcel", stepIndex: 1 },
      { type: "task-done", taskId: "market-parcel" },
    ]);

    const ticks = doTicks(r);
    expect(types(ticks)).toEqual(["tick-hit", "tick-hit", "tick-hit", "step-done", "task-done"]);

    expect(types(interactAt(r, "port-letter"))).toEqual(["step-done"]);
    expect(interactAt(r, "home-launcher")).toEqual([
      { type: "launch", anchor: "home-launcher" },
      { type: "step-done", taskId: "lanternfall-letter", stepIndex: 1 },
    ]);
    r.update("fly", ANCHORS["lanternfall-gate"].position);
    expect(r.interact(START + 100)).toEqual([]);
    expect(r.passGate("lanternfall-gate", 30, START + 200)).toEqual([
      { type: "landed", anchor: "lanternfall-gate" },
      { type: "step-done", taskId: "lanternfall-letter", stepIndex: 2 },
    ]);
    const last = interactAt(r, "keeper-door", START + 5_000);
    expect(types(last)).toEqual(["step-done", "task-done", "round-done"]);
    expect(last[2]).toEqual({ type: "round-done", elapsedMs: 5_000 });

    expect(r.snapshot(START + 9_000).done).toBe(true);
    expect(interactAt(r, "keeper-door")).toEqual([]);
    expect(r.passGate("lanternfall-gate", 1, START)).toEqual([]);
  });

  it("freezes elapsed time once the round is done", () => {
    const r = make();
    advanceToTask(r, 2);
    interactAt(r, "port-letter");
    interactAt(r, "home-launcher");
    r.passGate("lanternfall-gate", 10, START);
    interactAt(r, "keeper-door", START + 7_000);
    expect(r.snapshot(START + 20_000).elapsedMs).toBe(7_000);
  });
});

describe("range and mode", () => {
  it("does nothing before any update", () => {
    expect(make().interact(START)).toEqual([]);
  });

  it("does nothing when out of range", () => {
    const r = make();
    r.update("walk", at(5, 0, 0));
    expect(r.interact(START)).toEqual([]);
    expect(r.snapshot(START).prompt).toBeNull();
    expect(r.snapshot(START).stepIndex).toBe(0);
  });

  it("accepts a position exactly on the radius and rejects just beyond", () => {
    const r = make();
    r.update("walk", at(2, 0, 0));
    expect(r.snapshot(START).prompt).toBe("E · Pick up parcel");
    r.update("walk", at(2.01, 0, 0));
    expect(r.snapshot(START).prompt).toBeNull();
  });

  it("uses horizontal distance on x and z", () => {
    const r = make();
    r.update("walk", at(1.5, 0, 1.5));
    expect(r.interact(START)).toEqual([]);
    r.update("walk", at(0, 0, 1.9));
    expect(r.interact(START)).not.toEqual([]);
  });

  it("does nothing in fly mode", () => {
    const r = make();
    r.update("fly", ANCHORS["market-parcel"].position);
    expect(r.interact(START)).toEqual([]);
    expect(r.snapshot(START).prompt).toBeNull();
  });

  it("rejects a different terrace height but allows dy of 6", () => {
    const r = make();
    r.update("walk", at(0, 6.5, 0));
    expect(r.interact(START)).toEqual([]);
    r.update("walk", at(0, -6.5, 0));
    expect(r.interact(START)).toEqual([]);
    r.update("walk", at(0, 6, 0));
    expect(types(r.interact(START))).toEqual(["step-done"]);
  });

  it("only the current step counts, not other anchors", () => {
    const r = make();
    r.update("walk", ANCHORS["observatory-door"].position);
    expect(r.interact(START)).toEqual([]);
  });
});

describe("tick step", () => {
  const ticking = () => {
    const r = make();
    advanceToTask(r, 1);
    r.update("walk", ANCHORS.escapement.position);
    return r;
  };

  it.each([0, 1, 100, TICK_WINDOW_MS - 1, 1000 - TICK_EARLY_MS + 1, 960, 999])("accepts a press at x%i ms", (ms) => {
    const r = ticking();
    expect(r.interact(7_000 + ms)).toEqual([{ type: "tick-hit", hits: 1 }]);
  });

  it.each([TICK_WINDOW_MS, 300, 500, 700, 1000 - TICK_EARLY_MS])("rejects a press at x%i ms", (ms) => {
    const r = ticking();
    expect(r.interact(7_000 + ms)).toEqual([{ type: "tick-miss" }]);
    expect(r.snapshot(START).tickHits).toBe(0);
  });

  it("counts a double press within 500 ms once", () => {
    const r = ticking();
    expect(r.interact(7_000)).toEqual([{ type: "tick-hit", hits: 1 }]);
    expect(r.interact(7_200)).toEqual([]);
    expect(r.snapshot(START).tickHits).toBe(1);
    expect(r.interact(8_010)).toEqual([{ type: "tick-hit", hits: 2 }]);
  });

  it("returns nothing for any press within 500 ms of a hit, even off the tick", () => {
    const r = ticking();
    r.interact(7_000);
    expect(r.interact(7_300)).toEqual([]);
    expect(r.interact(7_499)).toEqual([]);
    expect(r.snapshot(START).tickHits).toBe(1);
  });

  it("does nothing in fly mode", () => {
    const r = ticking();
    r.update("fly", ANCHORS.escapement.position);
    expect(r.interact(7_000)).toEqual([]);
    expect(r.snapshot(START).tickHits).toBe(0);
  });

  it("resets tickHits after the step completes", () => {
    const r = ticking();
    doTicks(r);
    expect(r.snapshot(START).tickHits).toBe(0);
  });

  it("does not reset hits on a miss", () => {
    const r = ticking();
    r.interact(7_000);
    expect(r.interact(8_500)).toEqual([{ type: "tick-miss" }]);
    expect(r.snapshot(START).tickHits).toBe(1);
    expect(r.interact(9_000)).toEqual([{ type: "tick-hit", hits: 2 }]);
    expect(types(r.interact(10_000))).toEqual(["tick-hit", "step-done", "task-done"]);
  });

  it("appends progress to the step label", () => {
    const r = ticking();
    expect(r.snapshot(START).stepLabel).toBe("Oil the Westminster clock in time with the tick (0/3)");
    r.interact(7_000);
    expect(r.snapshot(START).stepLabel).toBe("Oil the Westminster clock in time with the tick (1/3)");
  });
});

describe("passGate", () => {
  const flying = () => {
    const r = make();
    advanceToTask(r, 2);
    interactAt(r, "port-letter");
    interactAt(r, "home-launcher");
    r.update("fly", ANCHORS["lanternfall-gate"].position);
    return r;
  };

  it("rejects too fast, accepts slow, then ignores further gates", () => {
    const r = flying();
    expect(r.passGate("lanternfall-gate", LANDING_SPEED + 1, START)).toEqual([{ type: "too-fast", speed: LANDING_SPEED + 1 }]);
    expect(r.snapshot(START).stepIndex).toBe(2);
    expect(types(r.passGate("lanternfall-gate", LANDING_SPEED, START))).toEqual(["landed", "step-done"]);
    expect(r.snapshot(START).stepIndex).toBe(3);
    expect(r.passGate("lanternfall-gate", 1, START)).toEqual([]);
  });

  it("reports too-fast once per second per gate", () => {
    const r = flying();
    expect(types(r.passGate("lanternfall-gate", 80, 10_000))).toEqual(["too-fast"]);
    expect(r.passGate("lanternfall-gate", 80, 10_500)).toEqual([]);
    expect(r.passGate("lanternfall-gate", 80, 10_999)).toEqual([]);
    expect(types(r.passGate("lanternfall-gate", 80, 11_000))).toEqual(["too-fast"]);
    expect(types(r.passGate("lanternfall-gate", 20, 11_100))).toEqual(["landed", "step-done"]);
  });

  it("retryLaunch returns from the land step to the launch prompt, and landing still works", () => {
    const r = flying();
    r.retryLaunch();
    expect(r.snapshot(START).stepIndex).toBe(1);
    r.update("walk", ANCHORS["home-launcher"].position);
    expect(r.snapshot(START).prompt).toBe("E · Launch");
    expect(r.interact(START)).toEqual([
      { type: "launch", anchor: "home-launcher" },
      { type: "step-done", taskId: "lanternfall-letter", stepIndex: 1 },
    ]);
    expect(types(r.passGate("lanternfall-gate", 10, START))).toEqual(["landed", "step-done"]);
  });

  it("retryLaunch clears the too-fast debounce", () => {
    const r = flying();
    r.passGate("lanternfall-gate", 80, 10_000);
    r.retryLaunch();
    interactAt(r, "home-launcher");
    expect(types(r.passGate("lanternfall-gate", 80, 10_100))).toEqual(["too-fast"]);
  });

  it("retryLaunch does nothing off a land step", () => {
    const r = make();
    r.retryLaunch();
    expect(r.snapshot(START).stepIndex).toBe(0);
    advanceToTask(r, 2);
    r.retryLaunch();
    expect(r.snapshot(START)).toMatchObject({ taskIndex: 2, stepIndex: 0 });
  });

  it("ignores a non-matching anchor", () => {
    const r = flying();
    expect(r.passGate("home-launcher", 1, START)).toEqual([]);
    expect(r.passGate("keeper-door", 1, START)).toEqual([]);
    expect(r.snapshot(START).stepIndex).toBe(2);
  });

  it("returns nothing for any gate while not on a land step", () => {
    const r = make();
    expect(r.passGate("lanternfall-gate", 1, START)).toEqual([]);
    expect(r.snapshot(START).stepIndex).toBe(0);
  });
});

describe("snapshot", () => {
  it("describes the first step", () => {
    const r = make();
    r.update("walk", ANCHORS["market-parcel"].position);
    const s = r.snapshot(START + 1_500);
    expect(s).toMatchObject({
      taskIndex: 0, stepIndex: 0, taskId: "market-parcel", title: "Market parcel",
      stepLabel: "Pick up the parcel at Covent Garden", prompt: "E · Pick up parcel",
      target: "market-parcel", targetPosition: at(0, 0, 0), tickHits: 0, done: false, elapsedMs: 1_500,
    });
    expect(s.checklist).toEqual([
      { label: "Pick up the parcel at Covent Garden", done: false, current: true },
      { label: "Deliver it to St Paul's", done: false, current: false },
    ]);
  });

  it("tracks progress within the checklist", () => {
    const r = make();
    interactAt(r, "market-parcel");
    const s = r.snapshot(START);
    expect(s.checklist.map((c) => [c.done, c.current])).toEqual([[true, false], [false, true]]);
    expect(s.target).toBe("observatory-door");
    expect(s.targetPosition).toEqual(ANCHORS["observatory-door"].position);
  });

  it("has a null prompt on the land step even in range", () => {
    const r = make();
    advanceToTask(r, 2);
    interactAt(r, "port-letter");
    interactAt(r, "home-launcher");
    r.update("fly", ANCHORS["lanternfall-gate"].position);
    const s = r.snapshot(START);
    expect(s.prompt).toBeNull();
    expect(s.target).toBe("lanternfall-gate");
    expect(s.taskIndex).toBe(2);
    expect(s.checklist).toHaveLength(4);
  });

  it("clears the target when done", () => {
    const r = make();
    advanceToTask(r, 2);
    interactAt(r, "port-letter");
    interactAt(r, "home-launcher");
    r.passGate("lanternfall-gate", 1, START);
    interactAt(r, "keeper-door");
    const s = r.snapshot(START);
    expect(s).toMatchObject({ done: true, stepLabel: "All deliveries made", taskId: null, target: null, targetPosition: null, prompt: null });
  });

  it("does not let callers mutate the anchor position", () => {
    const r = make();
    const s = r.snapshot(START);
    s.targetPosition!.x = 999;
    expect(r.snapshot(START).targetPosition!.x).toBe(0);
  });
});

describe("anchors", () => {
  it("honours a per-anchor maxDy", () => {
    const r = new TaskRunner({ ...ANCHORS, "market-parcel": { ...ANCHORS["market-parcel"], maxDy: 1 } }, START);
    r.update("walk", at(0, 1.5, 0));
    expect(r.interact(START)).toEqual([]);
    r.update("walk", at(0, 1, 0));
    expect(r.interact(START)).not.toEqual([]);
  });

  it("copies anchor positions at construction", () => {
    const mutable: Record<AnchorId, Anchor> = structuredClone(ANCHORS);
    const r = new TaskRunner(mutable, START);
    mutable["market-parcel"].position.x = 500;
    expect(r.snapshot(START).targetPosition!.x).toBe(0);
  });
});

describe("reset", () => {
  it("clears the tick debounce", () => {
    const r = make();
    advanceToTask(r, 1);
    r.update("walk", ANCHORS.escapement.position);
    r.interact(7_000);
    r.reset(START);
    advanceToTask(r, 1);
    r.update("walk", ANCHORS.escapement.position);
    expect(r.interact(7_100)).toEqual([{ type: "tick-hit", hits: 1 }]);
  });

  it("restarts the round with a new start time", () => {
    const r = make();
    advanceToTask(r, 1);
    r.update("walk", ANCHORS.escapement.position);
    r.interact(7_000);
    r.reset(START + 50_000);
    const s = r.snapshot(START + 51_000);
    expect(s).toMatchObject({ taskIndex: 0, stepIndex: 0, tickHits: 0, done: false, elapsedMs: 1_000 });
    expect(interactAt(r, "market-parcel")).toHaveLength(1);
  });

  it("restarts after the round is done", () => {
    const r = make();
    advanceToTask(r, 2);
    interactAt(r, "port-letter");
    interactAt(r, "home-launcher");
    r.passGate("lanternfall-gate", 1, START);
    interactAt(r, "keeper-door");
    r.reset(START);
    expect(r.snapshot(START).done).toBe(false);
    expect(r.snapshot(START).taskId).toBe("market-parcel");
  });
});
