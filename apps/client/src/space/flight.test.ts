import { expect, it } from "vitest";
import { Vector3 } from "three";
import { createShip, stepShip } from "./flight";
import { neutral, RULES } from "./types";

it("creates a stopped, normalized spacecraft at the spawn", () => {
  const ship = createShip("player");
  expect(ship.p.toArray()).toEqual([0, 0, 650]);
  expect(ship.prevP.toArray()).toEqual(ship.p.toArray());
  expect(ship.v.length()).toBe(0);
  expect(ship.q.length()).toBeCloseTo(1);
});

it("turns independent of position relative to a planet", () => {
  const a = createShip("player", [0, 0, 0]);
  const b = createShip("player", [450, -90, 70]);
  const control = { ...neutral(), yaw: 0.07, pitch: -0.03, roll: 1 };
  for (let i = 0; i < 60; i++) { stepShip(a, control, 1 / 60); stepShip(b, control, 1 / 60); }
  expect(a.q.angleTo(b.q)).toBeLessThan(1e-6);
  expect(a.q.angleTo(createShip("untouched").q)).toBeGreaterThan(0.1);
});

it("rolls local up without snapping to global up", () => {
  const ship = createShip("player");
  for (let i = 0; i < 60; i++) stepShip(ship, { ...neutral(), roll: 1 }, 1 / 60);
  expect(new Vector3(0, 1, 0).applyQuaternion(ship.q).y).toBeLessThan(0.5);
  expect(ship.q.length()).toBeCloseTo(1);
});

it("preserves quaternion normalization over sustained roll", () => {
  const ship = createShip("player");
  for (let i = 0; i < 6000; i++) stepShip(ship, { ...neutral(), roll: 1 }, 1 / 60);
  expect(Math.abs(ship.q.length() - 1)).toBeLessThan(1e-6);
});

it("holds a neutral ship still and supports forward and reverse thrust", () => {
  const still = createShip("player", [0, 0, 0]);
  const ahead = createShip("player", [0, 0, 0]);
  const reverse = createShip("player", [0, 0, 0]);
  for (let i = 0; i < 60; i++) {
    stepShip(still, neutral(), 1 / 60);
    stepShip(ahead, { ...neutral(), forward: 1 }, 1 / 60);
    stepShip(reverse, { ...neutral(), forward: -1 }, 1 / 60);
  }
  expect(still.p.length()).toBe(0);
  expect(ahead.p.z).toBeLessThan(0);
  expect(reverse.p.z).toBeGreaterThan(0);
});

it("maps strafe and lift through ship attitude with a diagonal speed cap", () => {
  const ship = createShip("player", [0, 0, 0]);
  for (let i = 0; i < 60; i++) stepShip(ship, { ...neutral(), strafe: 1, lift: 1, forward: 1 }, 1 / 60);
  expect(ship.p.x).toBeGreaterThan(0);
  expect(ship.p.y).toBeGreaterThan(0);
  expect(ship.p.z).toBeLessThan(0);
  expect(ship.v.length()).toBeLessThanOrEqual(RULES.speed + 1e-6);
});

it("boosts only with energy and forward thrust", () => {
  const boosted = createShip("player"), ordinary = createShip("player");
  for (let i = 0; i < 60; i++) {
    stepShip(boosted, { ...neutral(), forward: 1, boost: true }, 1 / 60);
    stepShip(ordinary, { ...neutral(), forward: 1 }, 1 / 60);
  }
  expect(boosted.v.length()).toBeGreaterThan(ordinary.v.length());
  expect(boosted.energy).toBeLessThan(100);
  boosted.energy = 0;
  stepShip(boosted, { ...neutral(), forward: 1, boost: true }, 1 / 60);
  expect(boosted.energy).toBeGreaterThanOrEqual(0);
  expect(boosted.v.length()).toBeLessThan(RULES.boostSpeed);
});

it("brakes a moving ship quickly", () => {
  const ship = createShip("player"); ship.v.set(0, 0, -60);
  for (let i = 0; i < 60; i++) stepShip(ship, { ...neutral(), brake: true }, 1 / 60);
  expect(ship.v.length()).toBeLessThan(0.01);
});
