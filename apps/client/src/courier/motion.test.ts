import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Palette } from "../city/kit";
import { createCityLayout } from "../city/layout";
import { CourierController, type WalkKeys } from "./CourierController";
import { FOLLOW, type FollowCamera } from "./followCamera";
import { createWalker, stepWalker, WALK, type WalkInput } from "./walker";
import type { WalkWorld } from "./walkWorld";

const flat: WalkWorld = { surfaceAt: () => ({ height: 0, walkable: true }), blocked: () => false };
const idle: WalkInput = { forward: 0, strafe: 0, run: false, cameraYaw: 0 };

describe("smooth walking response", () => {
  it("starts and stops on the soft S-curves measured on the reference courier, with a modest sprint boost", () => {
    // Reference trace (live player probe, movement-reference/live-timing.json), times from the key event: ordinary
    // starts from standing reach a quarter of top speed after 0.07–0.10 s, half after 0.13–0.18 s and 93% after
    // 0.29–0.47 s (its first start, out of the idle fidget, was slower and is not a fair start). Releases lose half the
    // speed after 0.10–0.20 s and are down to 2% after 0.36–0.51 s, stopping within about a third of its height.
    const walker = createWalker(0, 0, flat);
    let time = 0;
    const crossings = (input: WalkInput, seconds: number, levels: readonly number[], rising: boolean) => {
      const found = levels.map(() => Infinity);
      const start = time;
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        stepWalker(walker, input, 1 / 60, flat);
        time += 1 / 60;
        levels.forEach((level, k) => {
          const fraction = walker.speed / WALK.walkSpeed;
          if (found[k] === Infinity && (rising ? fraction >= level : fraction <= level)) found[k] = time - start;
        });
      }
      return found;
    };
    stepWalker(walker, { ...idle, forward: 1 }, 1 / 60, flat);
    expect(walker.speed / WALK.walkSpeed).toBeLessThan(0.05);
    time = 1 / 60;
    const [quarter, half, most] = crossings({ ...idle, forward: 1 }, 1.25 - 1 / 60, [0.25, 0.5, 0.93], true).map((t) => t + 1 / 60);
    expect(quarter).toBeGreaterThan(0.07); expect(quarter).toBeLessThan(0.1);
    expect(half).toBeGreaterThan(0.13); expect(half).toBeLessThan(0.18);
    expect(most).toBeGreaterThan(0.29); expect(most).toBeLessThan(0.47);
    expect(walker.speed / WALK.walkSpeed).toBeGreaterThan(0.995);
    const atRelease = walker.z;
    const [halfGone, almostGone] = crossings(idle, 1, [0.5, 0.02], false);
    expect(halfGone).toBeGreaterThan(0.1); expect(halfGone).toBeLessThan(0.2);
    expect(almostGone).toBeGreaterThan(0.36); expect(almostGone).toBeLessThan(0.51);
    expect(walker.speed).toBe(0);
    const stoppingDistance = atRelease - walker.z;
    expect(stoppingDistance).toBeGreaterThan(3.79 * 0.2);
    expect(stoppingDistance).toBeLessThan(3.79 * 0.45);
    expect(WALK.runSpeed / WALK.walkSpeed).toBeGreaterThan(1.25);
    expect(WALK.runSpeed / WALK.walkSpeed).toBeLessThan(1.4);
  });

  it("never jerks: speed changes smoothly from frame to frame through a start and a stop", () => {
    const walker = createWalker(0, 0, flat);
    let last = 0, lastChange = 0;
    for (const input of [{ ...idle, forward: 1 }, idle]) for (let i = 0; i < 90; i++) {
      stepWalker(walker, input, 1 / 60, flat);
      const change = walker.speed - last;
      // Acceleration itself changes gradually: no frame-to-frame step larger than the reference's own first frame of
      // braking (about 4% of top speed), and starts are gentler still.
      expect(Math.abs(change - lastChange)).toBeLessThan(WALK.walkSpeed * 0.045);
      last = walker.speed; lastChange = change;
    }
  });

  it("produces the same path through start, turn, reverse and release at different frame rates", () => {
    const simulate = (hz: number) => {
      const walker = createWalker(0, 0, flat);
      for (const input of [{ ...idle, forward: 1 }, { ...idle, strafe: 1 }, { ...idle, forward: -1, run: true }, idle]) {
        for (let i = 0; i < hz; i++) stepWalker(walker, input, 1 / hz, flat);
      }
      return walker;
    };
    const baseline = simulate(60);
    for (const hz of [10, 20, 30, 50, 120, 144]) {
      const actual = simulate(hz);
      for (const key of ["x", "z", "heading", "vx", "vz", "stride"] as const) expect(actual[key], `${hz}Hz ${key}`).toBeCloseTo(baseline[key], 8);
    }
  });

  it("slides continuously along rotated walls without speed chatter or a preferred side", () => {
    for (const angle of [0, 0.27, 0.71, Math.PI / 2, 2.2]) for (const side of [-1, 1]) {
      const nx = Math.cos(angle), nz = Math.sin(angle), tx = -nz * side, tz = nx * side;
      const wall: WalkWorld = { ...flat, blocked: (x, z, radius) => x * nx + z * nz < radius };
      const walker = createWalker(nx * 1.7, nz * 1.7, wall);
      const heading = Math.atan2(tx - nx, -(tz - nz));
      const input = { ...idle, forward: 1, cameraYaw: heading };
      const speeds: number[] = [], clearance: number[] = [];
      for (let i = 0; i < 300; i++) {
        stepWalker(walker, input, 1 / 60, wall);
        expect(wall.blocked(walker.x, walker.z, WALK.radius)).toBe(false);
        if (i > 180) { speeds.push(walker.vx * tx + walker.vz * tz); clearance.push(walker.x * nx + walker.z * nz); }
      }
      const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      expect(mean).toBeCloseTo(WALK.walkSpeed / Math.sqrt(2), 1);
      expect((Math.max(...speeds) - Math.min(...speeds)) / mean).toBeLessThan(0.01);
      expect(Math.max(...clearance) - Math.min(...clearance)).toBeLessThan(0.01);
    }
  });
});

describe("the compact courier render pipeline", () => {
  const layout = createCityLayout();
  function rig() {
    const world = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.15, 7000);
    const keys = { forward: 1, strafe: 0, run: false, takeInteract: () => null, takeJump: () => false } satisfies WalkKeys;
    const controller = new CourierController({ world, camera, palette: new Palette(), layout, freeRoam: true, walkWorld: flat, keys,
      controls: { target: new THREE.Vector3(), enabled: false, enablePan: true, minDistance: 0, maxDistance: 1000, maxPolarAngle: 1.3, autoRotate: false, update: () => true } });
    controller.start();
    // Isolate timing/interpolation from scenery collisions; those are exercised in camera/world regressions.
    (controller as unknown as { follow: FollowCamera }).follow.setWorld(null, { x: 0, y: 0, z: 0 });
    return { controller, world, keys };
  }

  it("keeps real-time movement speed at 10Hz and holds direction during the entry camera swoop", () => {
    const simulate = (hz: number) => {
      const { controller, keys } = rig();
      for (let i = 0; i < hz * 2; i++) controller.update(1 / hz);
      const position = controller.position();
      keys.forward = 0;
      for (let i = 0; i < hz; i++) controller.update(1 / hz);
      const stopped = controller.position();
      controller.dispose();
      return { position, stopped };
    };
    const baseline = simulate(60);
    for (const hz of [10, 20, 30, 120, 144]) {
      const actual = simulate(hz);
      for (const phase of ["position", "stopped"] as const) for (const axis of ["x", "y", "z"] as const) expect(actual[phase][axis], `${hz}Hz ${phase}.${axis}`).toBeCloseTo(baseline[phase][axis], 7);
    }
  });

  it("dissolves the courier while the camera is pinned against its back, and restores it as the camera pulls out", () => {
    const { controller, world } = rig();
    for (let i = 0; i < 30; i++) controller.update(1 / 60);
    const courier = world.getObjectByName("courier")!;
    const figure = courier.getObjectByProperty("type", "SkinnedMesh") as THREE.SkinnedMesh;
    const fade = () => ((figure.material as THREE.ShaderMaterial).uniforms.uFade!.value as number);
    expect(fade()).toBe(0);
    const internals = controller as unknown as { options: { camera: THREE.Camera }; fadeWhenPinned(dt: number): void };
    const head = courier.position.clone().add(new THREE.Vector3(0, 3.2, 0));
    for (let i = 0; i < 60; i++) {
      internals.options.camera.position.copy(head).add(new THREE.Vector3(0, 0.2, 1.2));
      internals.fadeWhenPinned(1 / 60);
    }
    // Fully pinned, the dissolve removes the whole figure (no leftover fragments).
    expect(fade()).toBeGreaterThan(0.97);
    for (let i = 0; i < 90; i++) {
      internals.options.camera.position.copy(head).add(new THREE.Vector3(0, 3, 11));
      internals.fadeWhenPinned(1 / 60);
    }
    expect(fade()).toBe(0);
    controller.dispose();
  });

  it("draws nonzero, evenly spaced movement at 144Hz between fixed simulation ticks", () => {
    const { controller, world } = rig();
    // Three seconds: the soft two-stage start (see walker WALK.accel) is fully settled at top speed by then.
    for (let i = 0; i < 144 * 3; i++) controller.update(1 / 144);
    const courier = world.getObjectByName("courier")!;
    let previous = courier.position.clone();
    for (let i = 0; i < 144; i++) {
      controller.update(1 / 144);
      expect(courier.position.distanceTo(previous)).toBeCloseTo(WALK.walkSpeed / 144, 5);
      previous.copy(courier.position);
    }
    expect(FOLLOW.targetLift).toBeLessThan(3);
    controller.dispose();
  });
});
