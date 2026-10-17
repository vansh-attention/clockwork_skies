import { expect, it, vi } from "vitest";
import { Matrix4, PerspectiveCamera, Vector3, type WebGLRenderer } from "three";
import { Resources, SectorUpdater, SpaceScene, buildSector, fitIndicator, updateCockpitCamera } from "./SpaceScene";
import { ROCKS, STATIONS } from "./map";
import { SpaceSession } from "./SpaceSession";
import { neutral, type Obstacle } from "./types";
import { createShip, eyeOf, forwardOf } from "./flight";

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

it("aligns first-person attitude and eye with the weapon under pitch and roll", () => {
  const ship = createShip("player");
  ship.q.setFromAxisAngle(new Vector3(1, 1, 1).normalize(), 1.1);
  const camera = new PerspectiveCamera(75);
  updateCockpitCamera(camera, ship);
  expect(camera.getWorldDirection(new Vector3()).dot(forwardOf(ship, new Vector3()))).toBeCloseTo(1);
  expect(camera.position.distanceTo(eyeOf(ship, new Vector3()))).toBeCloseTo(0);
});

it("fits behind and invalid objective markers to finite screen edges", () => {
  const marker = { x: 0, y: 0, bearing: 0, offscreen: false };
  fitIndicator(0, 0, true, marker);
  expect(marker.offscreen).toBe(true);
  expect(marker.x === 10 || marker.x === 90 || marker.y === 17.5 || marker.y === 82.5).toBe(true);
  fitIndicator(Infinity, NaN, false, marker);
  expect([marker.x, marker.y, marker.bearing].every(Number.isFinite)).toBe(true);
});

function fakeSceneHost(failCompile = false) {
  const canvas = { style: {} as Record<string, string>, tabIndex: -1,
    setAttribute: vi.fn(), remove: vi.fn() };
  const mount = { clientWidth: 1920, clientHeight: 1080,
    appendChild: vi.fn() } as unknown as HTMLElement;
  const observer = { observe: vi.fn(), disconnect: vi.fn() };
  const renderer = {
    domElement: canvas, outputColorSpace: "", info: { render: { calls: 12, triangles: 100 },
      memory: { geometries: 3, textures: 0 } },
    setPixelRatio: vi.fn(), setSize: vi.fn(),
    compile: vi.fn(() => { if (failCompile) throw new Error("shader fault"); }),
    render: vi.fn(), dispose: vi.fn(), forceContextLoss: vi.fn(),
    renderLists: { dispose: vi.fn() },
  };
  return { canvas, mount, observer, renderer, options: {
    rendererFactory: () => renderer as unknown as WebGLRenderer,
    observerFactory: () => observer as unknown as ResizeObserver,
  } };
}

it("keeps one canvas and reuses geometry while resizing low and medium views", () => {
  const host = fakeSceneHost();
  const scene = new SpaceScene(host.mount, host.options);
  const session = new SpaceSession(); session.reset("training");
  const geometry = scene.sector.rocks.geometry;
  for (let i = 0; i < 10; i++) scene.update(session, 1);
  expect(host.renderer.render).toHaveBeenCalledTimes(10);
  expect(scene.sector.rocks.geometry).toBe(geometry);
  expect(host.mount.appendChild).toHaveBeenCalledTimes(1);
  expect(host.canvas.style.width).toBe("100%");
  scene.setQuality("low");
  expect(host.renderer.setSize).toHaveBeenLastCalledWith(1280, 720, false);
  scene.setQuality("medium");
  expect(host.renderer.setSize).toHaveBeenLastCalledWith(1920, 1080, false);
  expect(scene.sector.camera.aspect).toBeCloseTo(16 / 9);
  expect(scene.sector.stars.position.distanceTo(scene.sector.camera.position)).toBe(0);
  scene.dispose(); scene.dispose();
  expect(host.observer.disconnect).toHaveBeenCalledTimes(1);
  expect(host.renderer.dispose).toHaveBeenCalledTimes(1);
  expect(host.canvas.remove).toHaveBeenCalledTimes(1);
});

it("rolls back canvas, observer and render resources after a compile fault", () => {
  const host = fakeSceneHost(true);
  let resources: Resources | undefined;
  expect(() => new SpaceScene(host.mount, { ...host.options,
    sectorFactory: (owner) => { resources = owner; return buildSector(owner); },
  })).toThrow("shader fault");
  expect(resources?.size).toBe(0);
  expect(host.observer.disconnect).toHaveBeenCalledTimes(1);
  expect(host.renderer.dispose).toHaveBeenCalledTimes(1);
  expect(host.renderer.forceContextLoss).toHaveBeenCalledTimes(1);
  expect(host.canvas.remove).toHaveBeenCalledTimes(1);
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
