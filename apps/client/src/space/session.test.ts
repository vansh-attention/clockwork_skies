import { expect, it } from "vitest";
import { SpaceSession } from "./SpaceSession";
import { DRONE_SPAWNS, GATES, PICKUPS, TARGETS } from "./map";
import { neutral } from "./types";

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

it("counts only an ordered swept gate aperture crossing", () => {
  const session = new SpaceSession(); session.reset("training");
  session.player.p.set(100, 0, 461); session.player.v.set(0, 0, -120);
  session.tick(1 / 60, neutral());
  expect(session.gate).toBe(0);
  session.player.p.set(...GATES[1]!); session.player.p.z += 1;
  session.player.v.set(0, 0, -120);
  session.tick(1 / 60, neutral());
  expect(session.gate).toBe(0);
  session.player.p.set(0, 0, 461); session.player.v.set(0, 0, -120);
  session.tick(1 / 60, neutral());
  expect(session.gate).toBe(1);
});

it("collects a pickup once during its cooldown", () => {
  const session = new SpaceSession(); session.reset("training");
  session.player.p.set(...PICKUPS[0]!.at); session.player.v.set(0, 0, 0); session.player.hull = 20;
  session.tick(1 / 60, neutral());
  expect(session.player.hull).toBe(45);
  session.tick(1 / 60, neutral());
  expect(session.player.hull).toBe(45);
});

it("warns near the extent and applies delta-based damage beyond it", () => {
  const run = (hz: number) => {
    const session = new SpaceSession(); session.reset("training");
    session.player.p.set(950, 0, 650);
    for (let i = 0; i < hz; i++) session.tick(1 / hz, neutral());
    return session;
  };
  expect(run(30).player.hull).toBeCloseTo(80);
  const session = run(60);
  expect(session.player.hull).toBeCloseTo(80);
  expect(session.warning).toBe(true);
  expect(session.player.p.x).toBe(950);
  session.player.p.set(0, 0, 650);
  session.tick(1 / 60, neutral());
  expect(session.warning).toBe(false);
});

it("freezes a lost or completed training mission", () => {
  const lost = new SpaceSession(); lost.reset("training"); lost.player.hull = 0;
  lost.tick(1 / 60, neutral());
  expect(lost.result).toBe("lost");
  const time = lost.time; lost.tick(1 / 60, neutral()); expect(lost.time).toBe(time);
  const won = new SpaceSession(); won.reset("training"); won.gate = GATES.length;
  won.drones.forEach((drone) => { drone.hull = 0; });
  won.tick(1 / 60, neutral());
  expect(won.result).toBe("won");
  const completeTime = won.time; won.tick(1 / 60, neutral()); expect(won.time).toBe(completeTime);
});
