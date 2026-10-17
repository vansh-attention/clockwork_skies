import { afterEach, expect, it, vi } from "vitest";
import { SpaceInput } from "./SpaceInput";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const w = Object.assign(new EventTarget(), { setInterval: vi.fn() });
  const doc = Object.assign(new EventTarget(), {
    pointerLockElement: null as unknown, activeElement: null as unknown, hidden: false,
    exitPointerLock: vi.fn(),
  });
  const canvas = Object.assign(new EventTarget(), { focus() { doc.activeElement = canvas; } });
  doc.pointerLockElement = canvas;
  vi.stubGlobal("window", w); vi.stubGlobal("document", doc);
  const pause = vi.fn();
  const input = new SpaceInput(canvas as unknown as HTMLCanvasElement, pause);
  return { w, doc, canvas, pause, input };
}

function key(target: EventTarget, type: string, code: string) {
  target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
}

it("consumes ten relative mouse events exactly once", () => {
  const { w, input } = fixture();
  for (let i = 0; i < 10; i++) w.dispatchEvent(Object.assign(new Event("mousemove"), { movementX: 2, movementY: 0 }));
  expect(input.sample(1 / 60).yaw).toBeCloseTo(-20 * input.sensitivity);
  expect(input.sample(1 / 60).yaw).toBe(0);
  input.dispose();
});

it("clears held controls and pauses on blur and pointer unlock", () => {
  const { w, doc, pause, input } = fixture();
  key(w, "keydown", "KeyW");
  expect(input.sample(1 / 60).forward).toBe(1);
  w.dispatchEvent(new Event("blur"));
  expect(input.sample(1 / 60).forward).toBe(0);
  expect(pause).toHaveBeenCalled();
  doc.pointerLockElement = null; doc.dispatchEvent(new Event("pointerlockchange"));
  expect(pause).toHaveBeenCalledTimes(2);
  input.dispose();
});

it("ignores DOM controls, supports keyboard flight, and starts no interval", () => {
  const { w, doc, canvas, input } = fixture();
  doc.pointerLockElement = null;
  doc.activeElement = { tagName: "INPUT" };
  key(w, "keydown", "KeyW");
  expect(input.sample(1 / 60).forward).toBe(0);
  input.keyboard = true; doc.activeElement = canvas;
  key(w, "keydown", "ArrowLeft"); key(w, "keydown", "KeyJ");
  const controls = input.sample(1 / 60);
  expect(controls.yaw).toBeGreaterThan(0);
  expect(controls.fire).toBe(true);
  expect(w.setInterval).not.toHaveBeenCalled();
  input.dispose();
});

it("rejects a late pointer lock while a pending capture is being cancelled", async () => {
  const { w, doc, canvas, input } = fixture();
  doc.pointerLockElement = null;
  Object.assign(w, { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() });
  Object.assign(canvas, { requestPointerLock: () => new Promise<void>(() => {}) });
  const capture = input.capture();
  const rejected = expect(capture).rejects.toThrow("Mouse capture failed");
  input.cancelPendingCapture();
  doc.pointerLockElement = canvas;
  doc.dispatchEvent(new Event("pointerlockchange"));
  await rejected;
  expect(doc.exitPointerLock).toHaveBeenCalledTimes(1);
  input.dispose();
});
