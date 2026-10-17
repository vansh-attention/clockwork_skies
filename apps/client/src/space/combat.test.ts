import { expect, it } from "vitest";
import { Vector3 } from "three";
import { Combat } from "./combat";
import { createShip, forwardOf } from "./flight";
import { neutral, type Event, type Obstacle } from "./types";

it("limits cannon heat and does not shoot through solids", () => {
  const combat = new Combat();
  const pilot = createShip("player", [0, 0, 0]);
  const target = createShip("target", [0, 0, -90]);
  const events: Event[] = [];
  pilot.heat = 95;
  combat.weapon(pilot, { ...neutral(), fire: true }, 1 / 60, 1, [pilot, target], [], (event) => events.push(event));
  expect(target.hull).toBe(100);
  expect(events).toHaveLength(0);
  pilot.heat = 0;
  const wall: Obstacle = { id: "wall", kind: "box", center: [0, 0, -30], half: [8, 8, 1] };
  combat.weapon(pilot, { ...neutral(), fire: true }, 1 / 60, 2, [pilot, target], [wall], (event) => events.push(event));
  expect(target.hull).toBe(100);
  expect(combat.traces.filter((trace) => trace.active)).toHaveLength(1);
  expect(combat.traces.find((trace) => trace.active)!.b.z).toBeGreaterThan(-31);
});

it("shares the first-person camera forward ray and respects cooldown", () => {
  const combat = new Combat(); const pilot = createShip("player", [0, 0, 0]);
  pilot.q.setFromAxisAngle(new Vector3(0, 1, 0), 0.5);
  const events: Event[] = [];
  combat.weapon(pilot, { ...neutral(), fire: true }, 1 / 60, 1, [pilot], [], (event) => events.push(event));
  combat.weapon(pilot, { ...neutral(), fire: true }, 1 / 60, 1.01, [pilot], [], (event) => events.push(event));
  expect(events.filter((event) => event.kind === "shot")).toHaveLength(1);
  const trace = combat.traces.find((item) => item.active)!;
  const ray = trace.b.clone().sub(trace.a).normalize();
  expect(ray.dot(forwardOf(pilot, new Vector3()))).toBeCloseTo(1);
});
