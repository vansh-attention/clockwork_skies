import { expect, it } from "vitest";
import * as THREE from "three";
import { createAircraft, type MatchState } from "@clockwork/shared";
import { GameScene } from "./GameScene";

it("never culls the moving storm using its initial zero-sized bounds", () => {
  const scene = Object.create(GameScene.prototype) as { createStormLine: () => THREE.LineLoop };
  expect(scene.createStormLine().frustumCulled).toBe(false);
});

it("keeps every world draw compatible with both MRT attachments", () => {
  const world = new THREE.Scene();
  const scene = Object.assign(Object.create(GameScene.prototype), {
    world, camera: new THREE.PerspectiveCamera(68), cockpit: new THREE.Group(), gears: [], propellers: [], pickupMeshes: new Map(),
  }) as { buildWorld: () => void };
  scene.buildWorld();
  const incompatible: string[] = [];
  world.traverse(object => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const item of Array.isArray(material) ? material : [material]) {
      if (!(item instanceof THREE.ShaderMaterial) || !item.fragmentShader.includes("location = 1")) incompatible.push(object.type);
    }
  });
  expect(incompatible).toEqual([]);
});

it("frames a visible planet horizon while keeping the cannon sight aligned", () => {
  const aircraft = createAircraft({ x: 475, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  const state = { phase: "open", players: { local: { status: "active", aircraft } } } as unknown as MatchState;
  const cockpit = new THREE.Group();
  const sight = new THREE.Object3D(); sight.name = "Cannon sight"; cockpit.add(sight);
  const camera = new THREE.PerspectiveCamera(78, 1.6, 0.1, 1500); camera.add(cockpit);
  const scene = Object.assign(Object.create(GameScene.prototype), { state, sessionId: "local", camera, cockpit, reducedMotion: true, flightInput: null }) as { updateCamera: (elapsed: number) => void };
  scene.updateCamera(0);
  camera.updateMatrixWorld();
  const look = camera.getWorldDirection(new THREE.Vector3());
  const up = camera.position.clone().normalize();
  expect(look.dot(up)).toBeLessThan(-0.35);
  const horizonDepression = Math.acos(350 / camera.position.length());
  const cameraDepression = Math.asin(-look.dot(up));
  // Horizon should land above the cockpit's lower third, not outside the lens.
  expect(horizonDepression - cameraDepression).toBeLessThan(THREE.MathUtils.degToRad(20));
  const sightDirection = sight.getWorldPosition(new THREE.Vector3()).sub(camera.position).normalize();
  const cannonDirection = new THREE.Vector3(aircraft.forward.x, aircraft.forward.y, aircraft.forward.z).normalize();
  expect(sightDirection.dot(cannonDirection)).toBeGreaterThan(0.999);
});
