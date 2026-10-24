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

it("requires uninterrupted visible lock before consuming a rocket", () => {
  const combat = new Combat(); const pilot = createShip("player", [0, 0, 0]);
  const target = createShip("target", [0, 0, -90]);
  for (let i = 0; i < 30; i++) combat.weapon(pilot, { ...neutral(), rocket: true }, 1 / 60, i / 60, [pilot, target], [], () => {});
  expect(pilot.rockets).toBe(2);
  combat.weapon(pilot, neutral(), 1 / 60, 0.6, [pilot, target], [], () => {});
  expect(pilot.lockTime).toBe(0);
  for (let i = 0; i < 60; i++) combat.weapon(pilot, { ...neutral(), rocket: true }, 1 / 60, 1 + i / 60, [pilot, target], [], () => {});
  expect(pilot.rockets).toBe(1);
  expect(combat.rockets.some((rocket) => rocket.active)).toBe(true);
});

it("resets lock when the target is out of range or behind a wall", () => {
  const combat = new Combat(); const pilot = createShip("player", [0, 0, 0]);
  const target = createShip("target", [0, 0, -90]);
  combat.weapon(pilot, { ...neutral(), rocket: true }, 1 / 60, 1, [pilot, target], [], () => {});
  expect(pilot.lockId).toBe(target.id);
  target.p.z = -1000;
  combat.weapon(pilot, { ...neutral(), rocket: true }, 1 / 60, 2, [pilot, target], [], () => {});
  expect(pilot.lockId).toBeNull();
  expect(pilot.lockTime).toBe(0);
  target.p.z = -90;
  const wall: Obstacle = { id: "screen", kind: "box", center: [0, 0, -30], half: [10, 10, 2] };
  combat.weapon(pilot, { ...neutral(), rocket: true }, 1 / 60, 3, [pilot, target], [wall], () => {});
  expect(pilot.lockId).toBeNull();
});

it("sweeps fast rockets and reuses fixed effect capacities", () => {
  const combat = new Combat(); const pilot = createShip("player", [20, 0, 0]);
  const target = createShip("target", [0, 0, -50]);
  const rocket = combat.rockets[0]!;
  rocket.active = true; rocket.owner = pilot.id; rocket.target = "none";
  rocket.p.set(0, 0, 0); rocket.v.set(0, 0, -1000); rocket.ttl = 1;
  combat.advance(0.1, [pilot, target], [], () => {});
  expect(target.hull).toBeLessThan(100);
  expect(rocket.active).toBe(false);
  for (let i = 0; i < 100; i++) combat.reset();
  expect(combat.rockets).toHaveLength(8);
  expect(combat.traces).toHaveLength(24);
});

it("does not let an expired rocket hit beyond its lifetime", () => {
  const combat = new Combat(); const pilot = createShip("player", [20, 0, 0]);
  const target = createShip("target", [0, 0, -50]);
  const rocket = combat.rockets[0]!;
  rocket.active = true; rocket.owner = pilot.id; rocket.target = "none";
  rocket.p.set(0, 0, 0); rocket.v.set(0, 0, -1000); rocket.ttl = 0.01;
  combat.advance(0.1, [pilot, target], [], () => {});
  expect(rocket.active).toBe(false);
  expect(target.hull).toBe(100);
});
