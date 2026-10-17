import { expect, it, vi } from "vitest";
import { Resources } from "./SpaceScene";
import { buildSector } from "./SpaceScene";
import { ROCKS, STATIONS } from "./map";

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
