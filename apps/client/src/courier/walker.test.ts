import { describe, expect, it } from "vitest";
import { STAIR_BEARINGS, TERRACES, createCityLayout, polarToXZ } from "../city/layout";
import { WALK, createWalker, stepWalker, type WalkInput, type Walker } from "./walker";
import { createHillTownWalkWorld, type WalkWorld } from "./walkWorld";

const DT = 1 / 60;
const layout = createCityLayout();
const world = createHillTownWalkWorld(layout);
const idle: WalkInput = { forward: 0, strafe: 0, run: false, cameraYaw: 0 };

function run(walker: Walker, input: WalkInput, steps: number) {
  let blocked = false;
  for (let i = 0; i < steps; i += 1) blocked = stepWalker(walker, input, DT, world).blocked || blocked;
  return blocked;
}

/** A house with open ground 8 units outside it radially, plus that start point. */
function housePush() {
  for (const house of layout.houses) {
    const start = polarToXZ(house.theta, house.r + house.depth / 2 + 8);
    if (world.surfaceAt(start.x, start.z).walkable && !world.blocked(start.x, start.z, WALK.radius)) return { house, start };
  }
  throw new Error("no house with a free approach");
}

describe("walker", () => {
  it("places the walker on the surface with the given heading", () => {
    const { x, z } = polarToXZ(0, 130);
    const walker = createWalker(x, z, world, 1.25);
    expect(walker.y).toBe(world.surfaceAt(x, z).height);
    expect(walker.heading).toBe(1.25);
    expect(walker.moving).toBe(false);
    expect(walker.stride).toBe(0);
  });

  it("walks forward along the camera direction and reaches walk speed", () => {
    const { x, z } = polarToXZ(0, 130);
    const walker = createWalker(x, z, world);
    run(walker, { ...idle, forward: 1 }, 120);
    expect(walker.z).toBeLessThan(z - 10);
    expect(walker.x).toBeCloseTo(x, 5);
    expect(walker.speed).toBeGreaterThan(WALK.walkSpeed * 0.95);
    expect(walker.speed).toBeLessThanOrEqual(WALK.walkSpeed + 1e-9);
    expect(walker.moving).toBe(true);
    expect(walker.stride).toBeGreaterThan(10);
  });

  it("running is faster than walking", () => {
    const { x, z } = polarToXZ(0, 130);
    const walking = createWalker(x, z, world);
    const running = createWalker(x, z, world);
    run(walking, { ...idle, forward: 1 }, 90);
    run(running, { ...idle, forward: 1, run: true }, 90);
    expect(Math.hypot(running.x - x, running.z - z)).toBeGreaterThan(Math.hypot(walking.x - x, walking.z - z) * 1.3);
    expect(running.speed).toBeGreaterThan(walking.speed);
  });

  it("does not exceed speed on diagonals", () => {
    const { x, z } = polarToXZ(0, 130);
    const walker = createWalker(x, z, world);
    run(walker, { ...idle, forward: 1, strafe: 1 }, 300);
    expect(walker.speed).toBeLessThanOrEqual(WALK.walkSpeed + 1e-6);
  });

  it("stops at a house wall when walking straight into it", () => {
    const { house, start } = housePush();
    // The house sits along bearing theta, so the camera looks from outside toward the centre.
    const yaw = Math.atan2(-start.x, start.z);
    const walker = createWalker(start.x, start.z, world);
    const blocked = run(walker, { ...idle, forward: 1, cameraYaw: yaw }, 240);
    expect(blocked).toBe(true);
    expect(world.blocked(walker.x, walker.z, WALK.radius)).toBe(false);
    // Still outside the house, and it never tunnelled past the centre.
    const r = Math.hypot(walker.x, walker.z);
    expect(r).toBeGreaterThan(house.r);
    expect(walker.speed).toBeLessThan(1);
  });

  it("climbs a stairway to the next terrace", () => {
    const bearing = STAIR_BEARINGS[0]!;
    const stair = layout.stairs.find((s) => s.bearing === bearing)!;
    const wall = TERRACES[1].radius;
    const flightEnd = Math.max(...stair.steps.filter((s) => s.r >= wall && s.r < TERRACES[0].radius).map((s) => s.r));
    const start = polarToXZ(bearing, flightEnd + 3);
    const walker = createWalker(start.x, start.z, world);
    expect(walker.y).toBe(TERRACES[0].top);
    const yaw = Math.atan2(-start.x, start.z);
    // Walk until just past the terrace-2 wall, before the next flight begins.
    for (let i = 0; i < 600 && Math.hypot(walker.x, walker.z) > wall - 2; i += 1) {
      stepWalker(walker, { ...idle, forward: 1, cameraYaw: yaw }, DT, world);
    }
    expect(Math.hypot(walker.x, walker.z)).toBeLessThanOrEqual(wall - 2);
    expect(walker.y).toBe(TERRACES[1].top);
  });

  it("slides along a wall instead of sticking", () => {
    const { start } = housePush();
    const inward = Math.atan2(-start.x, start.z);
    const walker = createWalker(start.x, start.z, world);
    // Push into the house first so the radial axis is pinned.
    run(walker, { ...idle, forward: 1, cameraYaw: inward }, 240);
    const pinned = { x: walker.x, z: walker.z };
    // Now push diagonally: inward plus sideways along the wall.
    run(walker, { ...idle, forward: 1, strafe: 1, cameraYaw: inward }, 20);
    expect(Math.hypot(walker.x - pinned.x, walker.z - pinned.z)).toBeGreaterThan(0.5);
  });

  it("reports blocked and stays put when every move is invalid", () => {
    const walker = createWalker(0, 0, world); // inside the clock tower
    const before = { x: walker.x, z: walker.z };
    const result = stepWalker(walker, { ...idle, forward: 1 }, DT, world);
    expect(result.blocked).toBe(true);
    expect(walker.x).toBe(before.x);
    expect(walker.z).toBe(before.z);
    expect(walker.vx).toBe(0);
    expect(walker.vz).toBe(0);
  });

  it("is deterministic", () => {
    const { x, z } = polarToXZ(1, 200);
    const a = createWalker(x, z, world);
    const b = createWalker(x, z, world);
    const input: WalkInput = { forward: 0.8, strafe: -0.3, run: true, cameraYaw: 0.7 };
    run(a, input, 300);
    run(b, input, 300);
    expect(a).toEqual(b);
  });

  it("never produces NaN from non-finite input", () => {
    const { x, z } = polarToXZ(0, 130);
    const walker = createWalker(x, z, world);
    const bad: WalkInput = { forward: Number.NaN, strafe: Number.POSITIVE_INFINITY, run: true, cameraYaw: Number.NaN };
    run(walker, bad, 30);
    stepWalker(walker, idle, Number.NaN, world);
    stepWalker(walker, idle, Number.POSITIVE_INFINITY, world);
    for (const value of Object.values(walker)) {
      if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
    }
    // Strafe infinity is treated as 0, so the walker stays put.
    expect(walker.x).toBe(x);
    expect(walker.z).toBe(z);
  });

  it("clamps oversized input to unit strength", () => {
    const { x, z } = polarToXZ(0, 130);
    const walker = createWalker(x, z, world);
    run(walker, { ...idle, forward: 50 }, 300);
    expect(walker.speed).toBeLessThanOrEqual(WALK.walkSpeed + 1e-6);
  });

  it("ignores non-positive dt and splits large dt into capped substeps", () => {
    const { x, z } = polarToXZ(0, 130);
    const walker = createWalker(x, z, world);
    stepWalker(walker, { ...idle, forward: 1 }, 0, world);
    stepWalker(walker, { ...idle, forward: 1 }, -1, world);
    expect(walker.z).toBe(z);

    const split = createWalker(x, z, world);
    const stepped = createWalker(x, z, world);
    stepWalker(split, { ...idle, forward: 1 }, 10 * DT, world);
    run(stepped, { ...idle, forward: 1 }, 10);
    expect(split.z).toBeCloseTo(stepped.z, 9);

    const capped = createWalker(x, z, world);
    const thirty = createWalker(x, z, world);
    stepWalker(capped, { ...idle, forward: 1 }, 1000, world);
    run(thirty, { ...idle, forward: 1 }, 30);
    expect(capped.z).toBeCloseTo(thirty.z, 9);
  });

  it("turns to face the travel direction", () => {
    const { x, z } = polarToXZ(0, 430);
    const walker = createWalker(x, z, world, 0);
    // Strafe right with the camera facing -Z: travel is toward +X, heading pi/2.
    run(walker, { ...idle, strafe: 1 }, 120);
    expect(walker.heading).toBeCloseTo(Math.PI / 2, 1);
    // Walk backwards: heading turns to face +Z (pi), always within (-pi, pi].
    run(walker, { ...idle, forward: -1 }, 150);
    expect(Math.abs(Math.abs(walker.heading) - Math.PI)).toBeLessThan(0.1);
    expect(walker.heading).toBeGreaterThan(-Math.PI);
    expect(walker.heading).toBeLessThanOrEqual(Math.PI);
  });

  it("keeps heading when standing still", () => {
    const { x, z } = polarToXZ(0, 130);
    const walker = createWalker(x, z, world, 2);
    run(walker, idle, 60);
    expect(walker.heading).toBe(2);
    expect(walker.moving).toBe(false);
  });

  it("slides along an oblique wall instead of sticking", () => {
    for (const offset of [0.2, 0.4, -0.4]) {
      const { start } = housePush();
      const inward = Math.atan2(-start.x, start.z);
      const walker = createWalker(start.x, start.z, world);
      const input = { ...idle, forward: 1, cameraYaw: inward + offset };
      let guard = 0;
      while (!stepWalker(walker, input, DT, world).blocked && guard < 600) guard += 1;
      const contact = { x: walker.x, z: walker.z };
      run(walker, input, 60);
      expect(Math.hypot(walker.x - contact.x, walker.z - contact.z)).toBeGreaterThan(2);
    }
  });

  it("crosses the canal on a bridge entered at an angle", () => {
    const bearing = STAIR_BEARINGS[0]!;
    const start = polarToXZ(bearing, 300);
    for (const offset of [0.3, -0.3]) {
      const walker = createWalker(start.x, start.z, world);
      const input = { ...idle, forward: 1, cameraYaw: bearing + offset };
      for (let i = 0; i < 900 && Math.hypot(walker.x, walker.z) < 352; i += 1) stepWalker(walker, input, DT, world);
      expect(Math.hypot(walker.x, walker.z)).toBeGreaterThanOrEqual(352);
    }
  });

  it("refuses to walk off a terrace edge", () => {
    const start = polarToXZ(0, 284);
    expect(world.blocked(start.x, start.z, WALK.radius)).toBe(false);
    const walker = createWalker(start.x, start.z, world);
    expect(walker.y).toBe(TERRACES[0].top);
    const blocked = run(walker, { ...idle, forward: 1, cameraYaw: 0 }, 240);
    expect(blocked).toBe(true);
    expect(Math.hypot(walker.x, walker.z)).toBeLessThanOrEqual(TERRACES[0].radius);
    expect(walker.y).toBe(TERRACES[0].top);
  });

  it("covers about the same distance at 1/144 s and 1/50 s per call", () => {
    const { x, z } = polarToXZ(0, 130);
    const reference = createWalker(x, z, world);
    run(reference, { ...idle, forward: 1 }, 60);
    const travelled = (hz: number) => {
      const walker = createWalker(x, z, world);
      for (let i = 0; i < hz; i += 1) stepWalker(walker, { ...idle, forward: 1 }, 1 / hz, world);
      return Math.hypot(walker.x - x, walker.z - z);
    };
    const expected = Math.hypot(reference.x - x, reference.z - z);
    expect(travelled(144)).toBeCloseTo(expected, -0.5);
    expect(Math.abs(travelled(144) - expected) / expected).toBeLessThan(0.05);
    expect(Math.abs(travelled(50) - expected) / expected).toBeLessThan(0.05);
  });

  it("rejects non-finite spawn coordinates", () => {
    expect(() => createWalker(Number.NaN, 0, world)).toThrow(RangeError);
    expect(() => createWalker(0, Number.POSITIVE_INFINITY, world)).toThrow(RangeError);
  });

  it("escapes from a spawn that overlaps a wall", () => {
    for (const house of layout.houses) {
      const at = (extra: number) => polarToXZ(house.theta, house.r + house.depth / 2 + WALK.radius + extra);
      const spawn = at(-0.3);
      const clear = at(2);
      if (!world.surfaceAt(spawn.x, spawn.z).walkable || !world.blocked(spawn.x, spawn.z, WALK.radius)) continue;
      if (world.blocked(clear.x, clear.z, WALK.radius)) continue;
      const walker = createWalker(spawn.x, spawn.z, world);
      run(walker, { ...idle, forward: 1, cameraYaw: house.theta }, 60);
      expect(world.blocked(walker.x, walker.z, WALK.radius)).toBe(false);
      return;
    }
    throw new Error("no house with an overlapping spawn");
  });

  it("turns across the +-PI seam the short way", () => {
    const { x, z } = polarToXZ(0, 430);
    const walker = createWalker(x, z, world, 3.0);
    let minAbs = Infinity;
    for (let i = 0; i < 90; i += 1) {
      stepWalker(walker, { ...idle, forward: 1, cameraYaw: -3.0 }, DT, world);
      if (walker.moving) minAbs = Math.min(minAbs, Math.abs(walker.heading));
      expect(walker.heading).toBeGreaterThan(-Math.PI);
      expect(walker.heading).toBeLessThanOrEqual(Math.PI);
    }
    expect(minAbs).toBeGreaterThan(2.5);
    expect(walker.heading).toBeCloseTo(-3.0, 1);
  });
});

describe("jumping", () => {
  const flatWorld = (height: (x: number) => number = () => 0): WalkWorld => ({
    surfaceAt: (x: number) => ({ height: height(x), walkable: true }),
    blocked: () => false,
  });
  const still = { forward: 0, strafe: 0, run: false, cameraYaw: 0 };
  const steps = (walker: ReturnType<typeof createWalker>, world: WalkWorld, input: WalkInput, count: number) => {
    let landed = 0;
    let peak = walker.y;
    for (let i = 0; i < count; i += 1) {
      const result = stepWalker(walker, i === 0 ? input : { ...input, jump: false }, 1 / 60, world);
      if (result.landed) landed += 1;
      peak = Math.max(peak, walker.y);
    }
    return { landed, peak };
  };

  it("hops about 1.15 high and lands back on the ground once, about 0.6 s later", () => {
    const world = flatWorld();
    const walker = createWalker(0, 0, world);
    const first = stepWalker(walker, { ...still, jump: true }, 1 / 60, world);
    expect(first.jumped).toBe(true);
    expect(walker.grounded).toBe(false);
    const { landed, peak } = steps(walker, world, still, 60);
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.3);
    expect(landed).toBe(1);
    expect(walker.grounded).toBe(true);
    expect(walker.y).toBe(0);
    expect(walker.vy).toBe(0);
  });

  it("cannot jump again in mid-air", () => {
    const world = flatWorld();
    const walker = createWalker(0, 0, world);
    stepWalker(walker, { ...still, jump: true }, 1 / 60, world);
    for (let i = 0; i < 10; i += 1) stepWalker(walker, still, 1 / 60, world);
    const vy = walker.vy;
    const again = stepWalker(walker, { ...still, jump: true }, 1 / 60, world);
    expect(again.jumped).toBe(false);
    expect(walker.vy).toBeLessThan(vy);
  });

  it("hops up onto a kerb taller than a step, which walking cannot climb", () => {
    const kerb = flatWorld((x) => (x > 2 ? 1.6 : 0));
    const walking = createWalker(0, 0, kerb, Math.PI / 2);
    steps(walking, kerb, { ...still, forward: 1, cameraYaw: Math.PI / 2 }, 120);
    expect(walking.x).toBeLessThan(2);
    const hopping = createWalker(0, 0, kerb, Math.PI / 2);
    for (let i = 0; i < 12; i += 1) stepWalker(hopping, { ...still, forward: 1, cameraYaw: Math.PI / 2 }, 1 / 60, kerb);
    stepWalker(hopping, { ...still, forward: 1, cameraYaw: Math.PI / 2, jump: true }, 1 / 60, kerb);
    steps(hopping, kerb, { ...still, forward: 1, cameraYaw: Math.PI / 2 }, 90);
    expect(hopping.x).toBeGreaterThan(3);
    expect(hopping.y).toBeCloseTo(1.6, 6);
    expect(hopping.grounded).toBe(true);
  });

  it("never jumps off a terrace edge (a drop well beyond a step)", () => {
    const ledge = flatWorld((x) => (x < 2 ? 3 : 0));
    const walker = createWalker(0, 0, ledge, Math.PI / 2);
    for (let i = 0; i < 6; i += 1) stepWalker(walker, { ...still, forward: 1, cameraYaw: Math.PI / 2 }, 1 / 60, ledge);
    const takeOff = stepWalker(walker, { ...still, forward: 1, cameraYaw: Math.PI / 2, jump: true }, 1 / 60, ledge);
    expect(takeOff.jumped).toBe(true);
    const { peak } = steps(walker, ledge, { ...still, forward: 1, cameraYaw: Math.PI / 2 }, 120);
    expect(peak).toBeGreaterThan(4); // it did leave the ground
    expect(walker.x).toBeLessThan(2);
    expect(walker.y).toBe(3);
  });

  it("keeps a take-off up a slope steeper than the hop (never leaves and lands in the same instant)", () => {
    const slope = flatWorld((x) => Math.max(0, x) * 2);
    const walker = createWalker(0.5, 0, slope, Math.PI / 2);
    const uphill = { ...still, forward: 1, cameraYaw: Math.PI / 2 };
    for (let i = 0; i < 30; i += 1) stepWalker(walker, uphill, 1 / 60, slope);
    const takeOff = stepWalker(walker, { ...uphill, jump: true }, 1 / 60, slope);
    expect(takeOff.jumped).toBe(true);
    expect(takeOff.landed).toBe(false);
    expect(walker.grounded).toBe(false);
    expect(walker.y).toBeGreaterThanOrEqual(slope.surfaceAt(walker.x, 0).height);
    const { landed } = steps(walker, slope, uphill, 60);
    expect(landed).toBe(1);
    expect(walker.grounded).toBe(true);
    expect(walker.y).toBeCloseTo(slope.surfaceAt(walker.x, 0).height, 6);
  });
});
