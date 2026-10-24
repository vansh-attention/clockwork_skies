import { expect, it } from "vitest";
import { DRONE_SPAWNS, GATES, makeRocks, OBSTACLES, ROCKS, SPAWN, STATIONS, TARGETS } from "./map";

it("reproduces a finite yard with 72 clear asteroid placements", () => {
  const rocks = makeRocks();
  expect(rocks).toHaveLength(72);
  expect(rocks).toEqual(makeRocks());
  expect(new Set(rocks.map((rock) => rock.id)).size).toBe(72);
  expect(ROCKS).toEqual(rocks);
  expect(OBSTACLES).toHaveLength(rocks.length + STATIONS.length);
  const route = [SPAWN, ...GATES, ...TARGETS, ...DRONE_SPAWNS];
  for (const rock of rocks) {
    if (rock.kind !== "sphere") throw new Error("Asteroid must be a sphere proxy");
    for (const point of route) {
      const distance = Math.hypot(...point.map((coordinate, axis) => coordinate - rock.center[axis]!));
      expect(distance).toBeGreaterThan(rock.radius + 3);
    }
  }
});

it("places five ordered gates ahead of spawn", () => {
  expect(GATES).toHaveLength(5);
  expect(GATES[0]).toEqual([0, 0, 460]);
  expect(GATES.every((gate) => gate[2] < SPAWN[2])).toBe(true);
});
