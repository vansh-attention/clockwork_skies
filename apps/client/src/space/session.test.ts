import { expect, it } from "vitest";
import { Vector3 } from "three";
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

it("moves only skirmish drones and keeps fixed-input outcomes deterministic", () => {
  const run = () => {
    const session = new SpaceSession(); session.reset("skirmish", 3, 123);
    const before = session.drones.map((drone) => drone.p.clone());
    for (let i = 0; i < 120; i++) session.tick(1 / 60, { ...neutral(), strafe: 0.2 });
    expect(session.drones.slice(0, 3).some((drone, index) => drone.p.distanceTo(before[index]!) > 1)).toBe(true);
    expect(session.drones.slice(3).every((drone) => drone.hull === 0)).toBe(true);
    return session.ships.map((ship) => ({ p: ship.p.toArray(), q: ship.q.toArray(), hull: ship.hull }));
  };
  expect(run()).toEqual(run());
  const training = new SpaceSession(); training.reset("training");
  const before = training.drones[0]!.p.clone();
  for (let i = 0; i < 120; i++) training.tick(1 / 60, neutral());
  expect(training.drones[0]!.p.toArray()).toEqual(before.toArray());
});

it("does not let a drone fire through a station", () => {
  const session = new SpaceSession(); session.reset("skirmish", 1, 42);
  const drone = session.drones[0]!;
  drone.p.set(-410, 0, -80); drone.prevP.copy(drone.p);
  drone.q.setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
  session.player.p.set(-210, 0, -80); session.player.prevP.copy(session.player.p);
  for (let i = 0; i < 300; i++) {
    drone.p.set(-410, 0, -80); drone.prevP.copy(drone.p); drone.v.set(0, 0, 0);
    session.player.p.set(-210, 0, -80); session.player.prevP.copy(session.player.p);
    session.tick(1 / 60, neutral());
    expect(session.events.some((event) => event.kind === "shot" && event.owner === drone.id)).toBe(false);
  }
});

it("limits visible drone cannon cadence", () => {
  const session = new SpaceSession(); session.reset("skirmish", 1, 42);
  const drone = session.drones[0]!;
  let shots = 0;
  for (let i = 0; i < 360; i++) {
    drone.p.set(0, 0, 0); drone.prevP.copy(drone.p); drone.v.set(0, 0, 0); drone.q.identity();
    session.player.p.set(0, 0, -120); session.player.prevP.copy(session.player.p);
    session.tick(1 / 60, neutral());
    shots += session.events.filter((event) => event.kind === "shot" && event.owner === drone.id).length;
  }
  expect(shots).toBeGreaterThan(0);
  expect(shots).toBeLessThanOrEqual(3);
});

it("supports six renewable drones only in benchmark mode", () => {
  const session = new SpaceSession(); session.reset("skirmish", 6, 42, true);
  session.player.hull = 0;
  session.drones[0]!.hull = 0;
  session.tick(1 / 60, neutral());
  expect(session.result).toBe("playing");
  expect(session.remaining).toBe(6);
  expect(session.player.hull).toBe(100);
});
