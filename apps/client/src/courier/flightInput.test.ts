import { describe, expect, it, vi } from "vitest";
import { MATCH_RULES, NEUTRAL_INPUT, type InputCommand } from "@clockwork/shared";
import { FixedClock } from "../space/clock";
import { FlightInputLatch, NEUTRAL_FLIGHT, type InputSourceFactory } from "./flightInput";
import { createSkyPlane, stepSkyPlane, type FlightInput, type SkyWorld } from "./skyFlight";

function fakeFactory() {
  let emit: (command: InputCommand) => void = () => {};
  const source = { enable: vi.fn(), disable: vi.fn() };
  const factory: InputSourceFactory = (_element, onInput) => { emit = onInput; return source; };
  return { factory, source, emit: (patch: Partial<InputCommand>) => emit({ ...NEUTRAL_INPUT, ...patch }) };
}
const element = {} as HTMLElement;

describe("FlightInputLatch", () => {
  it("is neutral before any command", () => {
    const f = fakeFactory();
    const latch = new FlightInputLatch(element, f.factory);
    expect(latch.latest()).toEqual(NEUTRAL_FLIGHT);
    expect(latch.enabled).toBe(false);
  });

  it("reflects the newest command's flight fields only", () => {
    const f = fakeFactory();
    const latch = new FlightInputLatch(element, f.factory);
    latch.enable();
    f.emit({ aimX: 0.1, throttle: -1 });
    f.emit({ aimX: 0.5, aimY: -0.25, throttle: 1, fineRoll: -1, boost: true, cannon: true, rocket: true, ping: "enemy", emote: 2 });
    expect(latch.latest()).toEqual({ aimX: 0.5, aimY: -0.25, throttle: 1, fineRoll: -1, boost: true });
  });

  it("returns the same immutable snapshot until a new command arrives", () => {
    const f = fakeFactory();
    const latch = new FlightInputLatch(element, f.factory);
    latch.enable();
    f.emit({ throttle: 1 });
    const a: Readonly<FlightInput> = latch.latest();
    expect(latch.latest()).toBe(a);
    f.emit({ throttle: -1 });
    expect(a.throttle).toBe(1);
    expect(latch.latest().throttle).toBe(-1);
    expect(Object.isFrozen(NEUTRAL_FLIGHT)).toBe(true);
  });

  it("ignores commands emitted after disable", () => {
    const f = fakeFactory();
    const latch = new FlightInputLatch(element, f.factory);
    latch.enable();
    latch.disable();
    f.emit({ throttle: 1, boost: true });
    expect(latch.latest()).toEqual(NEUTRAL_FLIGHT);
  });

  it("releases pointer lock on disable only when it holds the lock", () => {
    const f = fakeFactory();
    const doc = { pointerLockElement: element as Element | null, exitPointerLock: vi.fn() };
    const latch = new FlightInputLatch(element, f.factory, doc);
    latch.enable();
    latch.disable();
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1);

    doc.pointerLockElement = {} as Element;
    latch.enable();
    latch.disable();
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1);

    doc.pointerLockElement = null;
    latch.enable();
    latch.disable();
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1);
  });

  it("disable works without a document in Node", () => {
    const f = fakeFactory();
    const latch = new FlightInputLatch(element, f.factory);
    latch.enable();
    expect(() => latch.disable()).not.toThrow();
  });

  it("resets to neutral on disable and disables the source once", () => {
    const f = fakeFactory();
    const latch = new FlightInputLatch(element, f.factory);
    latch.enable();
    f.emit({ throttle: 1, boost: true });
    latch.disable();
    latch.disable();
    expect(latch.latest()).toEqual(NEUTRAL_FLIGHT);
    expect(f.source.disable).toHaveBeenCalledTimes(1);
    expect(latch.enabled).toBe(false);
  });

  it("enable is idempotent and disable before enable does nothing", () => {
    const f = fakeFactory();
    const latch = new FlightInputLatch(element, f.factory);
    latch.disable();
    expect(f.source.disable).not.toHaveBeenCalled();
    latch.enable();
    latch.enable();
    expect(f.source.enable).toHaveBeenCalledTimes(1);
    expect(latch.enabled).toBe(true);
  });

  it("can be re-enabled after disable with a neutral start", () => {
    const f = fakeFactory();
    const latch = new FlightInputLatch(element, f.factory);
    latch.enable();
    f.emit({ throttle: 1 });
    latch.disable();
    latch.enable();
    expect(latch.latest()).toEqual(NEUTRAL_FLIGHT);
    expect(f.source.enable).toHaveBeenCalledTimes(2);
  });

  it("flight advances with the frame clock while the input timer is idle", () => {
    const f = fakeFactory();
    const latch = new FlightInputLatch(element, f.factory);
    latch.enable();
    f.emit({ throttle: 1 });
    const world: SkyWorld = { islands: [], edgeRadius: 1e6, floor: -1e6, ceiling: 1e6 };
    const plane = createSkyPlane({ x: 0, y: 0, z: 0 }, 0);
    const startSpeed = plane.speed;
    const clock = new FixedClock();
    for (let i = 0; i < 60; i += 1) clock.step(1 / 60, (dt) => stepSkyPlane(plane, latch.latest(), dt, world));
    const travelled = -plane.position.z;
    expect(plane.speed).toBeGreaterThan(startSpeed);
    expect(travelled).toBeGreaterThan(startSpeed * 0.9);
    expect(travelled).toBeLessThan(MATCH_RULES.aircraft.maxSpeed * 1.05);
    expect(Math.abs(plane.position.x)).toBeLessThan(1e-6);
  });
});
