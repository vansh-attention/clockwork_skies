import { expect, it, vi } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import { Resources, SectorUpdater, buildSector } from "./SpaceScene";
import { ROCKS, STATIONS } from "./map";
import { SpaceSession } from "./SpaceSession";

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
  const matrix = new Matrix4(), position = new Vector3(), attitude = new Quaternion(), scale = new Vector3();
  sector.drones.getMatrixAt(5, matrix);
  matrix.decompose(position, attitude, scale);
  expect(scale.length()).toBe(0);
  expect(sector.gates.instanceColor?.getX(0)).toBeGreaterThan(0);

  session.reset("skirmish", 6);
  updater.updateActors(session, 1);
  sector.drones.getMatrixAt(5, matrix);
  matrix.decompose(position, attitude, scale);
  expect(scale.x).toBeCloseTo(1);
  sector.gates.getMatrixAt(0, matrix);
  matrix.decompose(position, attitude, scale);
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
