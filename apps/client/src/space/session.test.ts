import { expect, it } from "vitest";
import { SpaceSession } from "./SpaceSession";
import { DRONE_SPAWNS, TARGETS } from "./map";

it("reuses session and pool identities across repeated resets", () => {
  const session = new SpaceSession();
  const ships = session.ships.slice();
  const rockets = session.combat.rockets.slice();
  for (let i = 0; i < 10; i++) session.reset("skirmish", 3);
  expect(session.remaining).toBe(3);
  expect(session.ships).toHaveLength(7);
  session.ships.forEach((ship, index) => expect(ship).toBe(ships[index]));
  session.combat.rockets.forEach((rocket, index) => expect(rocket).toBe(rockets[index]));
  expect(session.combat.rockets).toHaveLength(8);
  expect(session.combat.traces).toHaveLength(24);
});

it("starts training with stationary targets and skirmish with three drones", () => {
  const session = new SpaceSession();
  session.reset("training");
  expect(session.remaining).toBe(3);
  expect(session.drones[0]!.p.toArray()).toEqual(TARGETS[0]);
  expect(session.drones[0]!.v.length()).toBe(0);
  expect(session.objective).toContain("gate 1");
  session.reset("skirmish");
  expect(session.remaining).toBe(3);
  expect(session.drones[0]!.p.toArray()).toEqual(DRONE_SPAWNS[0]);
  expect(session.drones[3]!.hull).toBe(0);
  session.reset("skirmish", 6, 42, true);
  expect(session.remaining).toBe(6);
  expect(session.benchmark).toBe(true);
});
