import { expect, it } from "vitest";
import { Vector3 } from "three";
import { firstHit, sphereTime } from "./collision";
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
