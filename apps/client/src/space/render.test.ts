import { expect, it, vi } from "vitest";
import { Matrix4, Vector3 } from "three";
import { Resources, SectorUpdater, buildSector } from "./SpaceScene";
import { ROCKS, STATIONS } from "./map";
import { SpaceSession } from "./SpaceSession";
import { neutral, type Obstacle } from "./types";

it("disposes each shared resource exactly once", () => {
  const resources = new Resources();
  const geometry = { dispose: vi.fn() };
  const material = { dispose: vi.fn() };
  resources.own(geometry);
  resources.own(material);
  resources.own(geometry);
  expect(resources.size).toBe(2);

  resources.dispose();
  resources.dispose();
  expect(geometry.dispose).toHaveBeenCalledTimes(1);
  expect(material.dispose).toHaveBeenCalledTimes(1);
  expect(resources.size).toBe(0);
});

it("pools rocket and occluded cannon feedback without drawing through a wall", () => {
  const resources = new Resources(), sector = buildSector(resources);
  const updater = new SectorUpdater(sector), session = new SpaceSession();
  session.reset("training");
  const wall: Obstacle = { id: "wall", kind: "box", center: [0, 0, 610], half: [8, 8, 1] };
  session.combat.weapon(session.player, { ...neutral(), fire: true }, 1 / 60, 1,
    [session.player], [wall], () => {});
  const trace = session.combat.traces.find((item) => item.active)!;
  expect(trace.b.z).toBeGreaterThan(609);
  const rocket = session.combat.rockets[0]!;
  rocket.active = true; rocket.p.set(10, 0, 600); rocket.prev.copy(rocket.p); rocket.v.set(0, 0, -140);
  const geometry = sector.traces.geometry, rocketGeometry = sector.rockets.geometry;
  for (let i = 0; i < 10; i++) updater.updateEffects(session, 1);
  expect(sector.tracePositions.length).toBe(24 * 6);
  expect(sector.tracePositions[5]).toBeCloseTo(trace.b.z);
  expect(sector.rockets.count).toBe(8);
  expect(sector.traces.geometry).toBe(geometry);
  expect(sector.rockets.geometry).toBe(rocketGeometry);
  session.combat.reset(); updater.updateEffects(session, 1);
  expect(sector.tracePositions[5]).toBe(0);
  const matrix = new Matrix4(); sector.rockets.getMatrixAt(0, matrix);
  expect(new Vector3().setFromMatrixScale(matrix).length()).toBe(0);
  resources.dispose();
});

it("reuses fixed gate, pickup and drone batches across resets", () => {
  const resources = new Resources();
  const sector = buildSector(resources);
  const updater = new SectorUpdater(sector);
  const session = new SpaceSession();
  const geometries = [sector.gates.geometry, sector.pickups.geometry, sector.drones.geometry];
  const initialResourceCount = resources.size;
  expect([sector.gates.count, sector.pickups.count, sector.drones.count]).toEqual([5, 4, 6]);

  session.reset("training");
  updater.updateActors(session, 1);
  const matrix = new Matrix4(), scale = new Vector3();
  sector.drones.getMatrixAt(5, matrix);
  scale.setFromMatrixScale(matrix);
  expect(scale.length()).toBe(0);
  expect(sector.gates.instanceColor?.getX(0)).toBeGreaterThan(0);

  session.reset("skirmish", 6);
  updater.updateActors(session, 1);
  sector.drones.getMatrixAt(5, matrix);
  scale.setFromMatrixScale(matrix);
  expect(scale.x).toBeCloseTo(1);
  sector.gates.getMatrixAt(0, matrix);
  scale.setFromMatrixScale(matrix);
  expect(scale.length()).toBe(0);
  expect([sector.gates.geometry, sector.pickups.geometry, sector.drones.geometry]).toEqual(geometries);
  expect(resources.size).toBe(initialResourceCount);
  resources.dispose();
});

it("builds a static sector with instanced rocks and camera-centered stars", () => {
  const resources = new Resources();
  const sector = buildSector(resources);
  expect(sector.rocks.count).toBe(72);
  expect(sector.rocks.count).toBe(ROCKS.length);
  expect(sector.stars.geometry.getAttribute("position").count).toBe(600);
  expect(sector.station.geometry.getAttribute("position").count).toBe(STATIONS.length * 24);
  expect(sector.world.children.some((child) => /planet|globe|shell/i.test(child.name))).toBe(false);
  expect(sector.world.children).toContain(sector.camera);
  resources.dispose();
});
