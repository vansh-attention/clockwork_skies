import { expect, it } from "vitest";
import { Vector3 } from "three";
import { createShip } from "./flight";
import { firstHit, moveWithCollisions, sphereTime } from "./collision";
import { GATES, OBSTACLES, SPAWN } from "./map";
import { RULES } from "./types";
import type { Obstacle } from "./types";

const wall: Obstacle = { id: "wall", kind: "box", center: [0, 0, 0], half: [0.5, 10, 10] };

it("sweeps through a thin wall instead of tunnelling", () => {
  const hit = firstHit(new Vector3(-10, 0, 0), new Vector3(20, 0, 0), 0, [wall]);
  expect(hit?.id).toBe("wall");
  expect(hit?.t).toBeCloseTo(9.5 / 20);
  expect(hit?.normal.x).toBe(-1);
});

it("sweeps a sphere and rejects a parallel ray miss", () => {
  expect(sphereTime(new Vector3(-10, 0, 0), new Vector3(20, 0, 0), 0, 0, 0, 2)).toBeCloseTo(0.4);
  expect(firstHit(new Vector3(-10, 20, 0), new Vector3(20, 0, 0), 0, [wall])).toBeNull();
});

it("returns the nearest obstacle using a segment fraction", () => {
  const farther: Obstacle = { id: "farther", kind: "box", center: [5, 0, 0], half: [0.5, 10, 10] };
  const hit = firstHit(new Vector3(-10, 0, 0), new Vector3(20, 0, 0), 0, [farther, wall]);
  expect(hit?.id).toBe("wall");
  expect(hit?.t).toBeGreaterThanOrEqual(0);
  expect(hit?.t).toBeLessThanOrEqual(1);
});

it("reports a finite unit normal for initial overlaps", () => {
  const hit = firstHit(new Vector3(), new Vector3(), 0, [wall]);
  expect(hit?.t).toBe(0);
  expect(hit?.normal.length()).toBeCloseTo(1);
  expect(sphereTime(new Vector3(), new Vector3(), 0, 0, 0, 1)).toBe(0);
});

it("stops at a wall and slides along it without tunnelling", () => {
  const ship = createShip("player", [-10, 0, 0]);
  ship.prevP.copy(ship.p); ship.p.set(10, 5, 0); ship.v.set(100, 25, 0);
  moveWithCollisions(ship, [wall], 1);
  expect(ship.p.x).toBeLessThan(-wall.half[0] - RULES.radius);
  expect(ship.p.y).toBeGreaterThan(4.5);
  expect(ship.v.x).toBe(0);
  expect(ship.v.y).toBeGreaterThan(0);
  expect(ship.hull).toBeLessThan(100);
});

it("applies impact damage on a cooldown", () => {
  const ship = createShip("player", [-10, 0, 0]);
  ship.prevP.copy(ship.p); ship.p.set(10, 0, 0); ship.v.set(100, 0, 0);
  moveWithCollisions(ship, [wall], 1); const hull = ship.hull;
  ship.prevP.set(-10, 0, 0); ship.p.set(10, 0, 0); ship.v.set(100, 0, 0);
  moveWithCollisions(ship, [wall], 1.1);
  expect(ship.hull).toBe(hull);
});

it("keeps decorative gates non-solid and clears the authored spawn", () => {
  expect(firstHit(new Vector3(...SPAWN), new Vector3(), RULES.radius, OBSTACLES)).toBeNull();
  const gate = GATES[0]!;
  expect(firstHit(new Vector3(gate[0], gate[1], gate[2] + 30), new Vector3(0, 0, -60), RULES.radius, [])).toBeNull();
});
