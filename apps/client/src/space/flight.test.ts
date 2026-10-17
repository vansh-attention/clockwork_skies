import { expect, it } from "vitest";
import { Vector3 } from "three";
import { createShip, stepShip } from "./flight";
import { neutral } from "./types";

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
