import { afterEach, expect, it, vi } from "vitest";
import { FrameDriver } from "./clock";
import { SpaceRuntime } from "./SpaceRuntime";
import type { SpaceAudio } from "./SpaceAudio";
import type { SpaceScene } from "./SpaceScene";
import type { SpaceInput } from "./SpaceInput";

afterEach(() => vi.unstubAllGlobals());

function rafHarness() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 1, now = 0;
  return {
    callbacks,
    request: (callback: FrameRequestCallback) => { const id = next++; callbacks.set(id, callback); return id; },
    cancel: (id: number) => { callbacks.delete(id); },
    now: () => now,
    setNow: (value: number) => { now = value; },
    fire: (time: number) => {
      const [id, callback] = callbacks.entries().next().value!;
      callbacks.delete(id); callback(time);
    },
  };
}

it("owns one callback and discards wall time spent paused", () => {
  const raf = rafHarness(), raw: number[] = [];
  const driver = new FrameDriver(dt => raw.push(dt), raf.request, raf.cancel, raf.now);
  driver.resume(); driver.resume();
  expect(raf.callbacks.size).toBe(1);
  raf.fire(16); driver.stop();
  expect(raf.callbacks.size).toBe(0);
  raf.setNow(60000); driver.resume(); raf.fire(60016); driver.stop();
  expect(raw).toEqual([0.016, 0.016]);
});

it("does not requeue after a callback stops itself or after a stale callback", () => {
  const raf = rafHarness();
  const driver = new FrameDriver(() => driver.stop(), raf.request, raf.cancel, raf.now);
  driver.resume();
  const stale = [...raf.callbacks.values()][0]!;
  raf.fire(16);
  expect(driver.running).toBe(false);
  expect(raf.callbacks.size).toBe(0);
  driver.resume(); stale(50);
  expect(raf.callbacks.size).toBe(1);
  driver.stop();
});

function runtimeHost(failUpdate = false) {
  const raf = rafHarness();
  const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
  const scene = {
    canvas,
    marker: { x: 50, y: 50, behind: false, distance: 0, hull: 0, offscreen: false, bearing: 0, kind: "none" },
    renderer: { info: { render: { calls: 3, triangles: 30 } } },
    update: vi.fn(() => { if (failUpdate) throw new Error("injected draw failure"); }),
    setQuality: vi.fn(), diagnostics: vi.fn(() => ({ resourceCount: 12 })), dispose: vi.fn(),
  };
  const input = {
    keyboard: true, sensitivity: 0.002, droppedEvents: 0,
    capture: vi.fn(async () => {}), sample: vi.fn(() => ({ yaw: 0, pitch: 0, roll: 0, forward: 0,
      strafe: 0, lift: 0, boost: false, brake: false, fire: false, rocket: false })),
    release: vi.fn(), cancelPendingCapture: vi.fn(), dispose: vi.fn(),
  };
  const audio = { muted: false, unlock: vi.fn(), motion: vi.fn(), event: vi.fn(),
    silence: vi.fn(), dispose: vi.fn() };
  vi.stubGlobal("window", { location: { search: "?debug=1" } });
  vi.stubGlobal("document", { hidden: false, hasFocus: () => true });
  const publish = vi.fn(), failed = vi.fn();
  const construct = () => new SpaceRuntime({} as HTMLElement, publish, failed, {
    sceneFactory: () => scene as unknown as SpaceScene,
    inputFactory: () => input as unknown as SpaceInput,
    audioFactory: () => audio as unknown as SpaceAudio,
    requestFrame: raf.request, cancelFrame: raf.cancel, now: raf.now,
  });
  return { raf, scene, input, audio, publish, failed, construct };
}

it("runs a single session, pauses, resumes without catch-up, and reuses ownership on restart", async () => {
  const host = runtimeHost();
  const runtime = host.construct();
  await runtime.launch("training", true);
  expect(host.raf.callbacks.size).toBe(1);
  host.raf.fire(100);
  const elapsed = runtime.session.time;
  expect(elapsed).toBeGreaterThan(0);
  runtime.pause();
  expect(host.raf.callbacks.size).toBe(0);
  host.raf.setNow(60000);
  await runtime.resume(true);
  host.raf.fire(60016);
  expect(runtime.session.time - elapsed).toBeLessThan(0.04);
  await runtime.launch("skirmish", true);
  expect(runtime.session.time).toBe(0);
  expect(host.raf.callbacks.size).toBe(1);
  expect(host.scene.update.mock.calls.length).toBeGreaterThan(2);
  expect(host.input.capture).toHaveBeenCalledTimes(3);
  runtime.dispose(); runtime.dispose();
  expect(host.raf.callbacks.size).toBe(0);
  expect(host.scene.dispose).toHaveBeenCalledTimes(1);
  expect(host.input.dispose).toHaveBeenCalledTimes(1);
  expect(host.audio.dispose).toHaveBeenCalledTimes(1);
});

it("cleans acquired scene and input when the first draw fails", () => {
  const host = runtimeHost(true);
  expect(host.construct).toThrow("injected draw failure");
  expect(host.scene.dispose).toHaveBeenCalledTimes(1);
  expect(host.input.dispose).toHaveBeenCalledTimes(1);
  expect(host.audio.dispose).toHaveBeenCalledTimes(1);
  expect(host.raf.callbacks.size).toBe(0);
});
