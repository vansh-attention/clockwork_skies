import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { createAircraft, type MatchState } from "@clockwork/shared";
import { GameScene } from "./GameScene";

it("draws a short cannon tracer from the firing aircraft", () => {
  const overlay = new THREE.Scene();
  const aircraft = createAircraft({ x: 0, y: 430, z: 0 }, { x: 0, y: 0, z: -1 });
  const state = { players: { local: { aircraft } } } as unknown as MatchState;
  const scene = Object.assign(Object.create(GameScene.prototype), { state, sessionId: "local", overlay, shotLines: new Map(), eventFlash: 0 }) as GameScene;
  scene.flash({ type: "shot", playerId: "local" });
  expect(overlay.children).toHaveLength(1);
  expect(overlay.children[0]).toBeInstanceOf(THREE.Line);
});

it("hides cockpit during title orbit instead of obscuring the planet", () => {
  const cockpit = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(); camera.add(cockpit);
  const scene = Object.assign(Object.create(GameScene.prototype), { state: null, sessionId: "", camera, cockpit, reducedMotion: false }) as { updateCamera: (elapsed: number) => void };
  scene.updateCamera(0);
  expect(cockpit.visible).toBe(false);
});
it("publishes instruments at most ten times per second", () => {
  const onHud = vi.fn();
  const aircraft = createAircraft({ x: 0, y: 430, z: 0 }, { x: 0, y: 0, z: -1 });
  const state = { phase: "open", players: { local: { status: "active", aircraft, kills: 0 } }, storm: { center: { x: 0, y: 1, z: 0 }, angularRadius: 3 } } as unknown as MatchState;
  const scene = Object.assign(Object.create(GameScene.prototype), { state, sessionId: "local", onHud, hudElapsed: 0, targetId: null }) as { updateHud: (dt: number) => void };
  for (let frame = 0; frame < 60; frame++) scene.updateHud(1 / 60);
  expect(onHud.mock.calls.length).toBeLessThanOrEqual(10);
  expect(onHud.mock.calls.length).toBeGreaterThanOrEqual(8);
});

it("registers each remote plane's propeller when it is first synced", () => {
  const aircraft = createAircraft({ x: 0, y: 430, z: 0 }, { x: 0, y: 0, z: -1 });
  const state = {
    players: { remote: { id: "remote", status: "active", paint: "sage-gold", aircraft } },
    pickups: {}, projectiles: {}, storm: { center: { x: 0, y: 1, z: 0 }, angularRadius: 3 },
  } as unknown as MatchState;
  type Internals = { createStormLine: () => THREE.LineLoop; syncState: () => void; playerMeshes: Map<string, THREE.Group>; propellers: THREE.Object3D[] };
  const scene = Object.create(GameScene.prototype) as Internals;
  Object.assign(scene, { state, sessionId: "local", world: new THREE.Scene(), playerMeshes: new Map(), pickupMeshes: new Map(), rocketMeshes: new Map(), propellers: [] });
  Object.assign(scene, { stormLine: scene.createStormLine() });
  scene.syncState();
  expect(scene.propellers).toHaveLength(1);
  expect(scene.propellers[0]).toBe(scene.playerMeshes.get("remote")!.userData.propeller);
});
