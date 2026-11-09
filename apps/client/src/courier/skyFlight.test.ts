import { MATCH_RULES } from "@clockwork/shared";
import { describe, expect, it } from "vitest";
import {
  BOOST_RELOCK,
  createSkyPlane,
  shortestAngle,
  skyForward,
  stepSkyPlane,
  type FlightInput,
  type SkyPlane,
  type SkyWorld,
} from "./skyFlight";

const rules = MATCH_RULES.aircraft;
const NEUTRAL: FlightInput = { aimX: 0, aimY: 0, throttle: 0, fineRoll: 0, boost: false };

const world: SkyWorld = {
  islands: [{ x: 0, y: 0, z: -300, radius: 100, top: 20, depth: 60 }],
  edgeRadius: 5000,
  floor: -1000,
  ceiling: 1000,
};

function run(plane: SkyPlane, input: FlightInput, seconds: number, w: SkyWorld = world) {
  const dt = 1 / 60;
  let bumped = false;
  let turningBack = false;
  for (let i = 0; i < Math.round(seconds / dt); i += 1) {
    const step = stepSkyPlane(plane, input, dt, w);
    bumped ||= step.bumped;
    turningBack ||= step.turningBack;
  }
  return { bumped, turningBack };
}

describe("createSkyPlane", () => {
  it("starts level at cruise speed with full boost", () => {
    const plane = createSkyPlane({ x: 1, y: 2, z: 3 }, 0.5);
    expect(plane.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(plane.yaw).toBe(0.5);
    expect(plane.pitch).toBe(0);
    expect(plane.bank).toBe(0);
    expect(plane.speed).toBe(rules.cruiseSpeed);
    expect(plane.throttle).toBe(0.55);
    expect(plane.boost).toBe(rules.boostCapacity);
  });

  it("does not alias the caller's position", () => {
    const start = { x: 0, y: 0, z: 0 };
    const plane = createSkyPlane(start, 0);
    plane.position.x = 9;
    expect(start.x).toBe(0);
  });
});

describe("skyForward", () => {
  it("faces -Z at yaw 0 and +X at positive quarter yaw", () => {
    const a = skyForward(createSkyPlane({ x: 0, y: 0, z: 0 }, 0));
    expect(a.x).toBeCloseTo(0);
    expect(a.y).toBeCloseTo(0);
    expect(a.z).toBeCloseTo(-1);
    const b = skyForward(createSkyPlane({ x: 0, y: 0, z: 0 }, Math.PI / 2));
    expect(b.x).toBeCloseTo(1);
    expect(b.z).toBeCloseTo(0);
  });

  it("climbs with positive pitch", () => {
    const plane = createSkyPlane({ x: 0, y: 0, z: 0 }, 0);
    plane.pitch = 0.3;
    const f = skyForward(plane);
    expect(f.y).toBeCloseTo(Math.sin(0.3));
    expect(f.z).toBeCloseTo(-Math.cos(0.3));
  });
});

describe("stepSkyPlane flight", () => {
  it("keeps altitude within 1 unit and flies straight with neutral input", () => {
    const plane = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    run(plane, NEUTRAL, 10);
    expect(Math.abs(plane.position.y - 200)).toBeLessThan(1);
    expect(Math.abs(plane.position.x)).toBeLessThan(1e-6);
    expect(plane.position.z).toBeLessThan(-300);
    expect(plane.yaw).toBeCloseTo(0);
  });

  it("increases yaw with positive aimX and banks the same way", () => {
    const plane = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    run(plane, { ...NEUTRAL, aimX: 1 }, 1);
    expect(plane.yaw).toBeGreaterThan(0.5);
    expect(plane.yaw).toBeLessThanOrEqual(rules.turnRate + 1e-9);
    expect(plane.bank).toBeGreaterThan(0);
    expect(plane.position.x).toBeGreaterThan(0);
  });

  it("decreases yaw with negative aimX", () => {
    const plane = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    run(plane, { ...NEUTRAL, aimX: -1 }, 1);
    expect(plane.yaw).toBeLessThan(-0.5);
  });

  it("lets fineRoll nudge steering and clamps total steering to 1", () => {
    const plane = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    run(plane, { ...NEUTRAL, aimX: 1, fineRoll: 1 }, 1);
    expect(plane.yaw).toBeLessThanOrEqual(rules.turnRate + 1e-9);
    const fine = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    run(fine, { ...NEUTRAL, fineRoll: 1 }, 1);
    expect(fine.yaw).toBeCloseTo(0.35 * rules.turnRate, 3);
  });

  it("climbs with negative aimY and dives with positive aimY, within the pitch limit", () => {
    const up = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    run(up, { ...NEUTRAL, aimY: -1 }, 4);
    expect(up.position.y).toBeGreaterThan(200);
    expect(up.pitch).toBeLessThanOrEqual(0.5);
    expect(up.pitch).toBeGreaterThan(0.4);
    const down = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    run(down, { ...NEUTRAL, aimY: 1 }, 4);
    expect(down.position.y).toBeLessThan(200);
    expect(down.pitch).toBeGreaterThanOrEqual(-0.5);
  });

  it("approaches maxSpeed at full throttle and never exceeds it without boost", () => {
    const plane = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    let peak = 0;
    for (let i = 0; i < 60 * 40; i += 1) {
      stepSkyPlane(plane, { ...NEUTRAL, throttle: 1 }, 1 / 60, world);
      peak = Math.max(peak, plane.speed);
    }
    expect(plane.speed).toBeGreaterThan(rules.maxSpeed - 1);
    expect(peak).toBeLessThanOrEqual(rules.maxSpeed + 1e-9);
  });

  it("stays at or below maxSpeed x boostMultiplier while boosting, and exceeds maxSpeed", () => {
    const plane = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    let peak = 0;
    for (let i = 0; i < 60 * 30; i += 1) {
      stepSkyPlane(plane, { ...NEUTRAL, throttle: 1, boost: true }, 1 / 60, world);
      peak = Math.max(peak, plane.speed);
    }
    expect(peak).toBeLessThanOrEqual(rules.maxSpeed * rules.boostMultiplier + 1e-9);
    expect(peak).toBeGreaterThan(rules.maxSpeed);
  });

  it("drains boost while held and recharges after release", () => {
    const plane = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    run(plane, { ...NEUTRAL, boost: true }, 2);
    expect(plane.boost).toBeCloseTo(rules.boostCapacity - rules.boostDrainPerSecond * 2, 0);
    const drained = plane.boost;
    run(plane, NEUTRAL, 2);
    expect(plane.boost).toBeGreaterThan(drained);
    expect(plane.boost).toBeCloseTo(drained + rules.boostRechargePerSecond * 2, 0);
  });

  it("keeps boost within 0..capacity and locks it off once it runs dry", () => {
    const plane = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    run(plane, { ...NEUTRAL, boost: true }, rules.boostCapacity / rules.boostDrainPerSecond + 0.1);
    expect(plane.boost).toBeGreaterThanOrEqual(0);
    expect(plane.boostLocked).toBe(true);
    // While locked and still held, the gauge refills toward BOOST_RELOCK without boosting.
    run(plane, { ...NEUTRAL, boost: true }, 1);
    expect(plane.boostLocked).toBe(true);
    expect(plane.boost).toBeGreaterThan(5);
    expect(plane.boost).toBeLessThan(BOOST_RELOCK);
    run(plane, NEUTRAL, 60);
    expect(plane.boost).toBe(rules.boostCapacity);
    expect(plane.boostLocked).toBe(false);
  });

  it("settles to base speed while a dry boost is held, with no free half-boost", () => {
    const plane = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    run(plane, { ...NEUTRAL, boost: true }, rules.boostCapacity / rules.boostDrainPerSecond + 0.1);
    run(plane, { ...NEUTRAL, boost: true }, 1.5);
    const base = rules.minSpeed + plane.throttle * (rules.maxSpeed - rules.minSpeed);
    expect(plane.speed).toBeLessThan(base * 1.25);
  });

  it("treats non-finite and out-of-range input as safe values", () => {
    const plane = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    run(plane, { aimX: Number.NaN, aimY: Number.POSITIVE_INFINITY, throttle: 5, fineRoll: Number.NaN, boost: false }, 30);
    expect(Number.isFinite(plane.position.x) && Number.isFinite(plane.position.z) && Number.isFinite(plane.yaw)).toBe(true);
    expect(plane.speed).toBeLessThanOrEqual(rules.maxSpeed + 1e-9);
  });

  it("reports one bump per impact while scraping along a rim, with contact every time", () => {
    const plane = createSkyPlane({ x: 0, y: 10, z: -150 }, 0);
    let bumps = 0;
    let contacts = 0;
    for (let i = 0; i < 120; i += 1) {
      const step = stepSkyPlane(plane, { ...NEUTRAL, aimX: 0.05 }, 1 / 60, world);
      if (step.bumped) bumps += 1;
      if (step.contact) contacts += 1;
    }
    expect(contacts).toBeGreaterThan(10);
    expect(bumps).toBeLessThanOrEqual(Math.ceil(120 / 60 / 0.4) + 1);
    expect(bumps).toBeGreaterThanOrEqual(1);
  });

  it("finds the shortest way round when easing toward a yaw across ±π", () => {
    expect(shortestAngle(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(shortestAngle(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2);
    expect(shortestAngle(0.3, 0.1)).toBeCloseTo(-0.2);
  });

  it("clamps y to floor and ceiling", () => {
    const low = createSkyPlane({ x: 0, y: -2000, z: 0 }, 0);
    stepSkyPlane(low, NEUTRAL, 1 / 60, world);
    expect(low.position.y).toBe(world.floor);
    const high = createSkyPlane({ x: 0, y: 2000, z: 0 }, 0);
    stepSkyPlane(high, NEUTRAL, 1 / 60, world);
    expect(high.position.y).toBe(world.ceiling);
  });
});

describe("stepSkyPlane dt handling", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("ignores dt = %s", (dt) => {
    const plane = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    const before = structuredClone(plane);
    const step = stepSkyPlane(plane, { ...NEUTRAL, aimX: 1, boost: true }, dt, world);
    expect(plane).toEqual(before);
    expect(step).toEqual({ bumped: false, contact: false, turningBack: false });
  });

  it("splits a large dt into substeps matching the 1/60 grid", () => {
    const a = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    const b = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    const input = { ...NEUTRAL, aimX: 0.6, aimY: -0.3, throttle: 1 };
    stepSkyPlane(a, input, 0.5, world);
    for (let i = 0; i < 30; i += 1) stepSkyPlane(b, input, 1 / 60, world);
    expect(a.position.x).toBeCloseTo(b.position.x, 6);
    expect(a.position.y).toBeCloseTo(b.position.y, 6);
    expect(a.position.z).toBeCloseTo(b.position.z, 6);
    expect(a.yaw).toBeCloseTo(b.yaw, 9);
  });
});

describe("stepSkyPlane islands", () => {
  it("pushes a level plane out of an island's side and reports bumped", () => {
    const plane = createSkyPlane({ x: 0, y: 2, z: 0 }, 0);
    const { bumped } = run(plane, NEUTRAL, 12);
    expect(bumped).toBe(true);
    const island = world.islands[0]!;
    const d = Math.hypot(plane.position.x - island.x, plane.position.z - island.z);
    expect(d).toBeGreaterThanOrEqual(island.radius + 4 - 0.01);
    expect(plane.speed).toBeGreaterThanOrEqual(rules.minSpeed);
    expect(plane.speed).toBeLessThan(rules.cruiseSpeed);
  });

  it("does not bump when clear of the island", () => {
    const plane = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    const { bumped } = run(plane, NEUTRAL, 12);
    expect(bumped).toBe(false);
  });

  it("pushes a plane that dips just below the top up and over", () => {
    const plane = createSkyPlane({ x: 0, y: 24, z: -300 }, 0);
    const step = stepSkyPlane(plane, NEUTRAL, 1 / 60, world);
    expect(step.bumped).toBe(true);
    expect(plane.position.y).toBeGreaterThanOrEqual(26 - 0.01);
  });

  it("pushes a plane in the rock underside down below it", () => {
    const plane = createSkyPlane({ x: 0, y: -55, z: -300 }, 0);
    // at the centre the rock reaches 60 below y; -55 is 5 above the tip, so down is shortest
    const step = stepSkyPlane(plane, NEUTRAL, 1 / 60, world);
    expect(step.bumped).toBe(true);
    expect(plane.position.y).toBeLessThanOrEqual(-59);
  });

  it("never lowers speed below minSpeed on repeated bumps", () => {
    const plane = createSkyPlane({ x: 0, y: 2, z: -250 }, 0);
    for (let i = 0; i < 120; i += 1) stepSkyPlane(plane, NEUTRAL, 1 / 60, world);
    expect(plane.speed).toBeGreaterThanOrEqual(rules.minSpeed - 1e-9);
  });

  it("handles a plane exactly at the island centre without NaN", () => {
    const plane = createSkyPlane({ x: 0, y: 5, z: -300 }, 0);
    stepSkyPlane(plane, NEUTRAL, 1 / 60, world);
    expect(Number.isFinite(plane.position.x)).toBe(true);
    expect(Number.isFinite(plane.position.y)).toBe(true);
    expect(Number.isFinite(plane.position.z)).toBe(true);
  });
});

describe("stepSkyPlane world edge", () => {
  const edgeWorld: SkyWorld = { islands: [], edgeRadius: 500, floor: -1000, ceiling: 1000 };

  it("turns back toward the origin beyond the edge, overriding aim", () => {
    const plane = createSkyPlane({ x: 600, y: 200, z: 0 }, Math.PI / 2); // flying outward (+X)
    const { turningBack } = run(plane, { ...NEUTRAL, aimX: -1 }, 4, edgeWorld);
    expect(turningBack).toBe(true);
    const f = skyForward(plane);
    const r = Math.hypot(plane.position.x, plane.position.z);
    const inward = -(f.x * plane.position.x + f.z * plane.position.z) / r;
    expect(inward).toBeGreaterThan(0.8);
  });

  it("eventually returns inside the edge", () => {
    const plane = createSkyPlane({ x: 0, y: 200, z: 700 }, Math.PI); // flying outward (+Z)
    run(plane, NEUTRAL, 15, edgeWorld);
    expect(Math.hypot(plane.position.x, plane.position.z)).toBeLessThan(edgeWorld.edgeRadius);
  });

  it("does not report turningBack inside the edge", () => {
    const plane = createSkyPlane({ x: 0, y: 200, z: 0 }, 0);
    expect(run(plane, NEUTRAL, 2, edgeWorld).turningBack).toBe(false);
  });
});

describe("determinism", () => {
  it("gives identical results for identical inputs", () => {
    const script: FlightInput[] = [
      { ...NEUTRAL, aimX: 0.7, throttle: 1, boost: true },
      { ...NEUTRAL, aimY: -0.4, fineRoll: 0.5 },
      { ...NEUTRAL, aimX: -1, aimY: 0.2, throttle: -1 },
    ];
    const fly = () => {
      const plane = createSkyPlane({ x: 10, y: 20, z: 30 }, 0.3);
      for (let i = 0; i < 600; i += 1) {
        stepSkyPlane(plane, script[i % script.length]!, i % 2 === 0 ? 1 / 60 : 0.03, world);
      }
      return plane;
    };
    expect(fly()).toEqual(fly());
  });
});
