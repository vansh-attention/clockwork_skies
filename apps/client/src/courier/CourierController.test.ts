import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Palette } from "../city/kit";
import { createCityLayout } from "../city/layout";
import { CourierController, createAnchors, type ControlsLike, type WalkKeys } from "./CourierController";
import { HOME_PAD, KEEPER_DOOR, LANTERNFALL_GATE, LANTERNFALL_PAD, createHomeWalkWorld, launchRelease } from "./outpost";
import { LANDING_SPEED, TASKS, type AnchorId } from "./tasks";
import type { FlightInput } from "./skyFlight";
import { WALK } from "./walker";
import { FOLLOW } from "./followCamera";
import { createHomeCameraWorld } from "./cameraWorld";
import { createHillTownWalkWorld } from "./walkWorld";

class FakeKeys implements WalkKeys {
  forward = 0;
  strafe = 0;
  run = false;
  private interact: number | null = null;
  private jumpQueued = false;
  constructor(private readonly now: () => number) {}
  press(): void { this.interact = this.now(); }
  jump(): void { this.jumpQueued = true; }
  takeInteract(): number | null {
    const value = this.interact;
    this.interact = null;
    return value;
  }
  takeJump(): boolean {
    const value = this.jumpQueued;
    this.jumpQueued = false;
    return value;
  }
}

function fakeControls(): ControlsLike {
  return {
    target: new THREE.Vector3(), enabled: false, enablePan: true, minDistance: 0, maxDistance: 0,
    maxPolarAngle: Math.PI, autoRotate: true, update: () => true,
  };
}

class FakeFlight {
  enabled = false;
  enables = 0;
  disables = 0;
  input: FlightInput = { aimX: 0, aimY: 0, throttle: -1, fineRoll: 0, boost: false };
  enable(): void { this.enabled = true; this.enables += 1; }
  disable(): void { this.enabled = false; this.disables += 1; }
  latest(): Readonly<FlightInput> { return this.input; }
}

/** `keys: null` leaves the options without keys, so the controller makes its own DOM reader (needs a stubbed window). */
function setup(options: { keys?: null } = {}) {
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 2, 7000);
  const controls = fakeControls();
  const clock = { t: 5_000_000, reduced: false };
  const keys = new FakeKeys(() => clock.t);
  const flight = new FakeFlight();
  const palette = new Palette();
  const controller = new CourierController({
    world, camera, controls, palette, now: () => clock.t, flightInput: flight, reducedMotion: () => clock.reduced,
    ...(options.keys === null ? {} : { keys }),
  });
  return { world, camera, controls, keys, clock, controller, flight, palette };
}

type Rig = ReturnType<typeof setup>;

/** Teleport to the current objective, press E for one frame. */
function interact(rig: Rig): void {
  rig.controller.teleportToObjective();
  rig.keys.press();
  rig.controller.update(1 / 60);
}

function horizontalLook(camera: THREE.PerspectiveCamera): THREE.Vector3 {
  const look = camera.getWorldDirection(new THREE.Vector3());
  look.y = 0;
  return look.normalize();
}

describe("createAnchors", () => {
  const layout = createCityLayout();
  const walk = createHillTownWalkWorld(layout);
  const anchors = createAnchors();
  const homeIds = (Object.keys(anchors) as AnchorId[]).filter((id) => anchors[id].island === "home");

  it("defines every anchor, with the two Lanternfall ones on that island", () => {
    expect(Object.keys(anchors).sort()).toEqual([
      "escapement", "home-launcher", "keeper-door", "lanternfall-gate", "market-parcel", "observatory-door", "port-letter",
    ]);
    expect(anchors["lanternfall-gate"].island).toBe("lanternfall");
    expect(anchors["keeper-door"].island).toBe("lanternfall");
    expect(homeIds).toHaveLength(5);
  });

  it("uses the documented radii", () => {
    expect(anchors["market-parcel"].radius).toBe(16);
    expect(anchors["observatory-door"].radius).toBe(8);
    expect(anchors.escapement.radius).toBe(14);
    expect(anchors["port-letter"].radius).toBe(12);
    expect(anchors["home-launcher"].radius).toBe(10);
    expect(anchors["lanternfall-gate"].radius).toBe(24);
    expect(anchors["keeper-door"].radius).toBe(6);
  });

  it("puts the market parcel at Rivet Market's centre on the walk surface", () => {
    const market = layout.landmarks[6]!;
    const anchor = anchors["market-parcel"];
    expect(anchor.position.x).toBeCloseTo(market.x);
    expect(anchor.position.z).toBeCloseTo(market.z);
    expect(anchor.position.y).toBeCloseTo(walk.surfaceAt(market.x, market.z).height);
  });

  it("puts the observatory door 19 units out along the landmark's outward axis", () => {
    const landmark = layout.landmarks[1]!;
    const { position } = anchors["observatory-door"];
    expect(position.x).toBeCloseTo(landmark.x + 19 * Math.sin(landmark.bearing));
    expect(position.z).toBeCloseTo(landmark.z - 19 * Math.cos(landmark.bearing));
  });

  it.each(homeIds)("%s is walkable, unblocked and reachable within its radius", (id) => {
    const { position, radius } = anchors[id];
    let found = false;
    for (let ring = 0; ring <= 8 && !found; ring += 1) {
      const r = (radius * ring) / 8;
      const points = ring === 0 ? 1 : 24;
      for (let i = 0; i < points && !found; i += 1) {
        const angle = (i / points) * Math.PI * 2;
        const x = position.x + Math.cos(angle) * r;
        const z = position.z + Math.sin(angle) * r;
        found = walk.surfaceAt(x, z).walkable && !walk.blocked(x, z, WALK.radius);
      }
    }
    expect(found).toBe(true);
  });
});

describe("CourierController", () => {
  it("adds the courier and beacon on start and removes them on stop (twice is safe)", () => {
    const { world, controller } = setup();
    expect(world.getObjectByName("courier")).toBeUndefined();
    controller.start();
    expect(world.getObjectByName("courier")).toBeDefined();
    expect(world.getObjectByName("beacon")).toBeDefined();
    controller.stop();
    expect(world.getObjectByName("courier")).toBeUndefined();
    expect(world.getObjectByName("beacon")).toBeUndefined();
    expect(() => controller.stop()).not.toThrow();
    controller.dispose();
  });

  it("spawns on the summit plaza west of the tower and flies the follow camera in behind it", () => {
    const { camera, controls, controller } = setup();
    controller.start();
    const p = controller.position();
    expect(p.x).toBeCloseTo(-50, 1);
    expect(p.z).toBeCloseTo(0, 1);
    expect(p.y).toBeCloseTo(66);
    expect(controller.mode).toBe("walk");
    // The follow camera owns the view: the orbit controls are off and the view widens for walking.
    expect(controls.enabled).toBe(false);
    for (let i = 0; i < 120; i += 1) controller.update(1 / 60);
    expect(camera.fov).toBeCloseTo(FOLLOW.fov, 1);
    // Facing west, so the camera stands behind it to the east, a little above, at the follow distance from the head.
    const head = new THREE.Vector3(p.x, p.y + FOLLOW.targetLift, p.z);
    expect(camera.position.distanceTo(head)).toBeLessThan(FOLLOW.distance + 0.5);
    expect(camera.position.distanceTo(head)).toBeGreaterThan(FOLLOW.collision.minRadius);
    expect(camera.position.x).toBeGreaterThan(p.x);
    expect(camera.position.y).toBeGreaterThan(head.y);
    expect(horizontalLook(camera).x).toBeLessThan(-0.9);
    controller.dispose();
  });

  it("returns a copy from position()", () => {
    const { controller } = setup();
    controller.start();
    const p = controller.position();
    p.x = 9999;
    expect(controller.position().x).toBeCloseTo(-50, 1);
    controller.dispose();
  });

  it("walks away from the camera while forward is held, with the camera following behind", () => {
    const { camera, keys, controller, world } = setup();
    controller.start();
    for (let i = 0; i < 120; i += 1) controller.update(1 / 60);
    const before = controller.position();
    const look = horizontalLook(camera);
    keys.forward = 1;
    for (let i = 0; i < 60; i += 1) controller.update(1 / 60);
    const after = controller.position();
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    expect(dx * look.x + dz * look.z).toBeGreaterThan(5);
    expect(Math.abs(dx * look.z - dz * look.x)).toBeLessThan(1);
    // The camera follows the drawn courier (blended between fixed steps): still behind it and within its follow range.
    const drawn = world.getObjectByName("courier")!.position;
    expect(drawn.distanceTo(new THREE.Vector3(after.x, after.y, after.z))).toBeLessThan(0.5);
    const toCourier = drawn.clone().sub(camera.position);
    expect(toCourier.x * look.x + toCourier.z * look.z).toBeGreaterThan(0);
    expect(camera.position.distanceTo(drawn)).toBeLessThan(FOLLOW.distance + FOLLOW.lead.max + FOLLOW.targetLift);
    controller.dispose();
  });

  it("does not move without input and ignores non-finite frame times", () => {
    const { controller } = setup();
    controller.start();
    const before = controller.position();
    controller.update(Number.NaN);
    controller.update(-1);
    for (let i = 0; i < 10; i += 1) controller.update(1 / 60);
    expect(controller.position()).toEqual(before);
    controller.dispose();
  });

  it("places the beacon over the target and hides it when the round is done", () => {
    const { world, controller } = setup();
    controller.start();
    controller.update(1 / 60);
    const beacon = world.getObjectByName("beacon")!;
    const target = controller.hud().task.targetPosition!;
    expect(beacon.visible).toBe(true);
    expect(beacon.position.x).toBeCloseTo(target.x);
    expect(beacon.position.y).toBeCloseTo(target.y + 10);
    expect(beacon.position.z).toBeCloseTo(target.z);
    controller.dispose();
  });

  it("teleports next to the objective, then E picks up and shows feedback", () => {
    const rig = setup();
    const { controller } = rig;
    controller.start();
    expect(controller.hud().task.stepIndex).toBe(0);
    expect(controller.hud().feedback).toBeNull();
    controller.teleportToObjective();
    controller.update(1 / 60);
    expect(controller.hud().task.prompt).toBe(TASKS[0]!.steps[0]!.prompt);
    rig.keys.press();
    controller.update(1 / 60);
    const hud = controller.hud();
    expect(hud.task.stepIndex).toBe(1);
    expect(hud.feedback).toEqual({ text: "Picked up", tone: "good" });
    rig.clock.t += 2000;
    expect(controller.hud().feedback).toBeNull();
    controller.dispose();
  });

  it("ignores E when out of range", () => {
    const rig = setup();
    rig.controller.start();
    rig.keys.press();
    rig.controller.update(1 / 60);
    expect(rig.controller.hud().task.stepIndex).toBe(0);
    expect(rig.controller.hud().feedback).toBeNull();
    rig.controller.dispose();
  });

  it("runs tasks 1 and 2 with teleports, interacts and timed tick presses", () => {
    const rig = setup();
    const { controller, clock } = rig;
    controller.start();

    interact(rig); // pick up the parcel
    expect(controller.hud().feedback?.text).toBe("Picked up");
    interact(rig); // deliver it
    expect(controller.hud().feedback).toEqual({ text: "Market parcel complete", tone: "good" });
    expect(controller.hud().task.taskId).toBe("oil-escapement");

    controller.teleportToObjective();
    const press = (ms: number, text: string) => {
      clock.t = 7_000_000 + ms;
      rig.keys.press();
      controller.update(1 / 60);
      expect(controller.hud().feedback?.text).toBe(text);
    };
    press(100, "On the tick (1/3)");
    press(600, "Watch the wheel");
    expect(controller.hud().feedback?.tone).toBe("warn");
    press(1100, "On the tick (2/3)");
    press(2100, "Oil the escapement complete");
    expect(controller.hud().task.taskId).toBe("lanternfall-letter");
    expect(controller.hud().task.tickHits).toBe(0);
    controller.dispose();
  });

  it("switches to fly mode when the launch step is used, and walking stops", () => {
    const full = setup();
    const c = full.controller;
    c.start();
    interact(full); // pick up the parcel
    interact(full); // deliver it
    full.clock.t = 9_000_100; // just after a whole second: on the tick
    for (let i = 0; i < 3; i += 1) {
      interact(full);
      full.clock.t += 1000;
    }
    expect(c.hud().task.taskId).toBe("lanternfall-letter");
    interact(full); // collect the letter
    expect(c.mode).toBe("walk");
    interact(full); // launch
    expect(c.mode).toBe("fly");
    expect(c.hud().mode).toBe("fly");
    expect(c.hud().flight).not.toBeNull();

    // Walking input no longer moves anything: the courier model stays where it launched.
    const courierAt = full.world.getObjectByName("courier")!.position.clone();
    full.keys.forward = 1;
    c.update(0.5);
    expect(full.world.getObjectByName("courier")!.position.distanceTo(courierAt)).toBe(0);
    c.dispose();
  });

  it("restarts the round on a second start()", () => {
    const rig = setup();
    rig.controller.start();
    interact(rig);
    expect(rig.controller.hud().task.stepIndex).toBe(1);
    rig.controller.start();
    expect(rig.controller.hud().task.stepIndex).toBe(0);
    expect(rig.controller.mode).toBe("walk");
    expect(rig.world.children.filter((c) => c.name === "courier")).toHaveLength(1);
    rig.controller.dispose();
  });

  describe("marker", () => {
    function aim(rig: Rig, toward: boolean) {
      const t = rig.controller.hud().task.targetPosition!;
      const eye = new THREE.Vector3(t.x + 30, t.y + 24, t.z + 60);
      const focus = new THREE.Vector3(t.x, t.y + 10, t.z);
      rig.camera.position.copy(eye);
      rig.camera.lookAt(toward ? focus : eye.clone().multiplyScalar(2).sub(focus));
      rig.camera.updateMatrixWorld(true);
    }

    it("is on screen near the centre when the target is in front", () => {
      const rig = setup();
      rig.controller.start();
      aim(rig, true);
      const { marker } = rig.controller.hud();
      expect(marker.visible).toBe(true);
      expect(marker.offscreen).toBe(false);
      expect(marker.x).toBeGreaterThan(40);
      expect(marker.x).toBeLessThan(60);
      expect(marker.y).toBeGreaterThan(40);
      expect(marker.y).toBeLessThan(60);
      expect(marker.distance).toBeGreaterThan(100);
      rig.controller.dispose();
    });

    it("is off screen, clamped to the edge, when the target is behind", () => {
      const rig = setup();
      rig.controller.start();
      aim(rig, false);
      const { marker } = rig.controller.hud();
      expect(marker.visible).toBe(true);
      expect(marker.offscreen).toBe(true);
      const edge = marker.x <= 10.5 || marker.x >= 89.5 || marker.y <= 17.5 || marker.y >= 82.5;
      expect(edge).toBe(true);
      expect(Number.isFinite(marker.bearing)).toBe(true);
      rig.controller.dispose();
    });
  });
});

describe("CourierController timing and robustness", () => {
  const displacement = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(b.x - a.x, b.z - a.z);

  it("faces the way it walks: group rotation.y is -heading after walking east", () => {
    const rig = setup();
    rig.controller.start();
    const p = rig.controller.position();
    for (let i = 0; i < 90; i += 1) rig.controller.update(1 / 60);
    rig.controller.setCameraYaw(Math.PI / 2); // look east
    rig.keys.forward = 1;
    for (let i = 0; i < 90; i += 1) rig.controller.update(1 / 60);
    expect(rig.controller.position().x).toBeGreaterThan(p.x + 5);
    // Heading pi/2 faces +X; the model faces -Z at rotation 0, so it needs rotation.y = -pi/2.
    expect(rig.world.getObjectByName("courier")!.rotation.y).toBeCloseTo(-Math.PI / 2, 1);
    rig.controller.dispose();
  });

  it("shows feedback for exactly 1600 ms", () => {
    const rig = setup();
    rig.controller.start();
    interact(rig);
    expect(rig.controller.hud().feedback?.text).toBe("Picked up");
    rig.clock.t += 1599;
    expect(rig.controller.hud().feedback?.text).toBe("Picked up");
    rig.clock.t += 2;
    expect(rig.controller.hud().feedback).toBeNull();
    rig.controller.dispose();
  });

  it("uses the press timestamp, not the frame time, for the tick window", () => {
    const rig = setup();
    rig.controller.start();
    interact(rig);
    interact(rig);
    rig.controller.teleportToObjective();
    rig.clock.t = 8_000_100; // on the tick when pressed
    rig.keys.press();
    rig.clock.t = 8_000_600; // the frame is processed late, off the tick
    rig.controller.update(1 / 60);
    expect(rig.controller.hud().feedback?.text).toBe("On the tick (1/3)");
    rig.controller.dispose();
  });

  it("stays finite and bounded with huge, NaN, infinite and negative frame times", () => {
    const rig = setup();
    rig.controller.start();
    const before = rig.controller.position();
    rig.keys.forward = 1;
    for (const dt of [1e9, Number.NaN, Number.POSITIVE_INFINITY, -5, 1e9, 0]) rig.controller.update(dt);
    const after = rig.controller.position();
    expect([after.x, after.y, after.z].every(Number.isFinite)).toBe(true);
    // At most 5 fixed steps run per frame, so five long frames cover under a couple of units.
    expect(displacement(before, after)).toBeLessThan(5);
    rig.controller.update(1 / 60);
    expect(rig.controller.hud().marker.visible).toBe(true);
    rig.controller.dispose();
  });

  it("moves the same distance at 144 Hz as at 60 Hz, in steps no bigger than one fixed step", () => {
    const run = (hz: number) => {
      const rig = setup();
      rig.controller.start();
      rig.keys.forward = 1;
      let last = rig.controller.position();
      const start = last;
      let biggest = 0;
      for (let i = 0; i < hz; i += 1) {
        rig.controller.update(1 / hz);
        const now = rig.controller.position();
        biggest = Math.max(biggest, displacement(last, now));
        last = now;
      }
      rig.controller.dispose();
      return { total: displacement(start, last), biggest };
    };
    const slow = run(60);
    const fast = run(144);
    expect(slow.total).toBeGreaterThan(5);
    expect(Math.abs(fast.total - slow.total) / slow.total).toBeLessThan(0.05);
    expect(fast.biggest).toBeLessThanOrEqual(WALK.runSpeed / 60 + 1e-6);
  });
});

describe("DOM keyboard reader", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A stand-in window that records which listeners are registered. */
  function stubWindow() {
    const target = new EventTarget();
    const registered = new Set<string>();
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    Object.assign(target, {
      addEventListener: (type: string, listener: EventListener) => { registered.add(type); add(type, listener); },
      removeEventListener: (type: string, listener: EventListener) => { registered.delete(type); remove(type, listener); },
    });
    vi.stubGlobal("window", target);
    const key = (type: "keydown" | "keyup", code: string, extra: Record<string, unknown> = {}) => {
      const event = Object.assign(new Event(type, { cancelable: true }), {
        code, ctrlKey: false, metaKey: false, altKey: false, repeat: false, isComposing: false,
      });
      const { target: eventTarget, consumed, ...rest } = extra;
      Object.assign(event, rest);
      if (consumed) event.preventDefault();
      if (eventTarget !== undefined) Object.defineProperty(event, "target", { value: eventTarget });
      target.dispatchEvent(event);
      return event;
    };
    return { target, registered, key };
  }

  const walkedFor = (rig: ReturnType<typeof setup>, frames: number) => {
    const before = rig.controller.position();
    for (let i = 0; i < frames; i += 1) rig.controller.update(1 / 60);
    const after = rig.controller.position();
    return Math.hypot(after.x - before.x, after.z - before.z);
  };

  it("moves on W and stops after keyup", () => {
    const win = stubWindow();
    const rig = setup({ keys: null });
    rig.controller.start();
    win.key("keydown", "KeyW");
    expect(walkedFor(rig, 30)).toBeGreaterThan(1);
    win.key("keyup", "KeyW");
    walkedFor(rig, 120); // let the walker come to rest
    expect(walkedFor(rig, 30)).toBeLessThan(0.05);
    rig.controller.dispose();
  });

  it("releases held keys on window blur", () => {
    const win = stubWindow();
    const rig = setup({ keys: null });
    rig.controller.start();
    win.key("keydown", "KeyW");
    walkedFor(rig, 10);
    win.target.dispatchEvent(new Event("blur"));
    walkedFor(rig, 120);
    expect(walkedFor(rig, 30)).toBeLessThan(0.05);
    rig.controller.dispose();
  });

  it("always honours keyup, even with a modifier held", () => {
    const win = stubWindow();
    const rig = setup({ keys: null });
    rig.controller.start();
    win.key("keydown", "KeyW");
    walkedFor(rig, 10);
    win.key("keyup", "KeyW", { ctrlKey: true });
    walkedFor(rig, 120);
    expect(walkedFor(rig, 30)).toBeLessThan(0.05);
    rig.controller.dispose();
  });

  it.each([["ctrlKey"], ["metaKey"], ["altKey"], ["isComposing"]])("ignores keys while %s is set", (flag) => {
    const win = stubWindow();
    const rig = setup({ keys: null });
    rig.controller.start();
    win.key("keydown", "KeyW", { [flag]: true });
    expect(walkedFor(rig, 30)).toBeLessThan(0.01);
    rig.controller.dispose();
  });

  it.each([
    ["input", { tagName: "INPUT" }],
    ["select", { tagName: "select" }],
    ["textarea", { tagName: "TEXTAREA" }],
    ["button", { tagName: "BUTTON" }],
    ["link", { tagName: "A" }],
    ["role element", { tagName: "DIV", hasAttribute: (name: string) => name === "role" }],
    ["editable text", { tagName: "DIV", isContentEditable: true }],
  ])("ignores keys aimed at a %s", (_name, element) => {
    const win = stubWindow();
    const rig = setup({ keys: null });
    rig.controller.start();
    win.key("keydown", "KeyW", { target: element });
    expect(walkedFor(rig, 30)).toBeLessThan(0.01);
    rig.controller.dispose();
  });

  it("ignores a key another handler already consumed", () => {
    const win = stubWindow();
    const rig = setup({ keys: null });
    rig.controller.start();
    win.key("keydown", "KeyW", { consumed: true });
    expect(walkedFor(rig, 30)).toBeLessThan(0.01);
    rig.controller.dispose();
  });

  it("prevents default on consumed arrows and Space (no page scroll), never on filtered keys", () => {
    const win = stubWindow();
    const rig = setup({ keys: null });
    rig.controller.start();
    expect(win.key("keydown", "ArrowUp").defaultPrevented).toBe(true);
    expect(win.key("keydown", "Space").defaultPrevented).toBe(true);
    expect(win.key("keydown", "Space", { target: { tagName: "BUTTON" } }).defaultPrevented).toBe(false);
    expect(win.key("keydown", "ArrowDown", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(win.key("keydown", "ArrowLeft", { target: { tagName: "INPUT" } }).defaultPrevented).toBe(false);
    rig.controller.dispose();
  });

  it("ignores auto-repeated E presses", () => {
    const win = stubWindow();
    const rig = setup({ keys: null });
    rig.controller.start();
    rig.controller.teleportToObjective();
    win.key("keydown", "KeyE", { repeat: true });
    rig.controller.update(1 / 60);
    expect(rig.controller.hud().task.stepIndex).toBe(0);
    win.key("keydown", "KeyE");
    rig.controller.update(1 / 60);
    expect(rig.controller.hud().task.stepIndex).toBe(1);
    rig.controller.dispose();
  });

  it("removes its listeners on stop() and does not leak a held key into the next round", () => {
    const win = stubWindow();
    const rig = setup({ keys: null });
    rig.controller.start();
    expect([...win.registered].sort()).toEqual(["blur", "keydown", "keyup"]);
    win.key("keydown", "KeyW");
    rig.controller.stop();
    expect(win.registered.size).toBe(0);
    rig.controller.start();
    expect(walkedFor(rig, 30)).toBeLessThan(0.01);
    rig.controller.dispose();
    expect(win.registered.size).toBe(0);
  });

  it("does nothing when there is no window", () => {
    const rig = setup({ keys: null });
    expect(() => { rig.controller.start(); rig.controller.update(1 / 60); rig.controller.stop(); }).not.toThrow();
  });

  it("ignores keys while suspended, drops queued E presses, and resumes afterwards", () => {
    const win = stubWindow();
    const rig = setup({ keys: null });
    rig.controller.start();
    rig.controller.teleportToObjective();
    win.key("keydown", "KeyW");
    win.key("keydown", "KeyE");
    rig.controller.setSuspended(true);
    win.key("keydown", "KeyW");
    expect(walkedFor(rig, 30)).toBeLessThan(0.01);
    rig.controller.setSuspended(false);
    rig.controller.update(1 / 60);
    expect(rig.controller.hud().task.stepIndex).toBe(0); // the queued E was dropped
    win.key("keydown", "KeyW");
    expect(walkedFor(rig, 30)).toBeGreaterThan(1);
    rig.controller.dispose();
  });

  it("also holds injected keys still while suspended", () => {
    const rig = setup();
    rig.controller.start();
    rig.controller.setSuspended(true);
    rig.keys.forward = 1;
    rig.controller.teleportToObjective();
    rig.keys.press();
    expect(walkedFor(rig, 30)).toBeLessThan(0.01);
    expect(rig.controller.hud().task.stepIndex).toBe(0);
    rig.controller.dispose();
  });
});

// --- flight -----------------------------------------------------------------------------------------------------

const ARC_FRAMES = 80; // 1.2 s arc is 72 fixed steps

function frames(rig: Rig, count: number): void {
  for (let i = 0; i < count; i += 1) rig.controller.update(1 / 60);
}

/** Tasks 1 and 2, then pick up the letter: the next interact at the launcher is the launch step. */
function reachLaunchStep(rig: Rig): void {
  rig.controller.start();
  interact(rig); // parcel
  interact(rig); // deliver
  rig.clock.t = 9_000_100;
  for (let i = 0; i < 3; i += 1) {
    interact(rig);
    rig.clock.t += 1000;
  }
  interact(rig); // collect the letter
}

function launchTaskFlight(rig: Rig): void {
  reachLaunchStep(rig);
  interact(rig); // launch
}

function planeGroup(rig: Rig): THREE.Object3D {
  return rig.world.getObjectByName("courierPlane")!;
}

/** Fly via the debug teleport, then step until the controller is walking again (or the frame budget ends). */
function flyToGate(rig: Rig, maxFrames = 300): void {
  rig.controller.teleportToObjective();
  for (let i = 0; i < maxFrames && rig.controller.mode === "fly"; i += 1) rig.controller.update(1 / 60);
}

describe("CourierController flight", () => {
  it("keeps one plane parked on the home pad while walking, and removes it on stop", () => {
    const rig = setup();
    rig.controller.start();
    const plane = planeGroup(rig);
    expect(plane.position.x).toBeCloseTo(HOME_PAD.position.x);
    expect(plane.position.y).toBeCloseTo(HOME_PAD.position.y + 1.2);
    expect(plane.position.z).toBeCloseTo(HOME_PAD.position.z);
    expect(plane.rotation.y).toBeCloseTo(-HOME_PAD.yaw);
    expect(rig.world.children.filter((c) => c.name === "courierPlane")).toHaveLength(1);
    expect(rig.controller.hud().flight).toBeNull();
    rig.controller.stop();
    expect(rig.world.getObjectByName("courierPlane")).toBeUndefined();
    rig.controller.dispose();
  });

  it("launch step: hides the courier, arcs to the release point, then flies with physics", () => {
    const rig = setup();
    launchTaskFlight(rig);
    expect(rig.controller.mode).toBe("fly");
    expect(rig.flight.enabled).toBe(true);
    expect(rig.world.getObjectByName("courier")!.visible).toBe(false);
    expect(rig.controls.enabled).toBe(false);

    const release = launchRelease(HOME_PAD);
    frames(rig, 20);
    // Mid-arc: no physics yet, so it is not at the release point.
    expect(planeGroup(rig).position.distanceTo(new THREE.Vector3(release.x, release.y, release.z))).toBeGreaterThan(5);
    frames(rig, ARC_FRAMES);
    // Past the arc, flying: the plane has moved on from the release point along its yaw.
    const p = rig.controller.position();
    expect(Math.hypot(p.x - release.x, p.z - release.z)).toBeGreaterThan(5);
    expect(rig.controller.hud().flight).not.toBeNull();
    rig.controller.dispose();
  });

  it("hands over exactly at launchRelease(pad) when the arc ends", () => {
    const rig = setup();
    launchTaskFlight(rig);
    const release = launchRelease(HOME_PAD);
    // 72 steps complete the 1.2 s arc; the 72nd places the plane on the release point before any physics.
    frames(rig, 71);
    const near = rig.controller.position();
    expect(Math.hypot(near.x - release.x, near.y - release.y, near.z - release.z)).toBeLessThan(40);
    frames(rig, 1);
    const at = rig.controller.position();
    expect(Math.hypot(at.x - release.x, at.y - release.y, at.z - release.z)).toBeLessThan(2);
    rig.controller.dispose();
  });

  it("uses a 0.25 s arc under reduced motion", () => {
    const rig = setup();
    rig.clock.reduced = true;
    launchTaskFlight(rig);
    frames(rig, 40);
    const release = launchRelease(HOME_PAD);
    const p = rig.controller.position();
    expect(Math.hypot(p.x - release.x, p.z - release.z)).toBeGreaterThan(5);
    rig.controller.dispose();
  });

  it("shows the fly prompt near the pad, and E there starts a free flight when no launch step is current", () => {
    const rig = setup();
    rig.controller.start();
    expect(rig.controller.hud().prompt).toBeNull();
    rig.controller.teleportToPad();
    rig.controller.update(1 / 60);
    expect(rig.controller.hud().prompt).toBe("E · Fly to Lanternfall");
    rig.keys.press();
    rig.controller.update(1 / 60);
    expect(rig.controller.mode).toBe("fly");
    expect(rig.controller.hud().task.stepIndex).toBe(0); // the round did not advance
    rig.controller.dispose();
  });

  it("shows the task prompt in preference to the pad prompt", () => {
    const rig = setup();
    reachLaunchStep(rig);
    rig.controller.teleportToObjective(); // the launcher is the pad: both prompts apply, the task's wins
    rig.controller.update(1 / 60);
    expect(rig.controller.hud().prompt).toBe("E · Launch");
    rig.controller.dispose();
  });

  it("lands on Lanternfall when the land step's gate is crossed slowly, and the deliver step is next", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES);
    flyToGate(rig);
    expect(rig.controller.mode).toBe("walk");
    expect(rig.controller.island).toBe("lanternfall");
    expect(rig.flight.enabled).toBe(false);
    expect(rig.controls.enabled).toBe(false); // the follow camera has the view again
    expect(rig.world.getObjectByName("courier")!.visible).toBe(true);
    const p = rig.controller.position();
    expect(Math.hypot(p.x - LANTERNFALL_PAD.position.x, p.z - LANTERNFALL_PAD.position.z)).toBeLessThan(35);
    // Parked on the Lanternfall pad.
    expect(planeGroup(rig).position.x).toBeCloseTo(LANTERNFALL_PAD.position.x);
    expect(planeGroup(rig).position.z).toBeCloseTo(LANTERNFALL_PAD.position.z);
    const hud = rig.controller.hud();
    expect(hud.task.stepLabel).toBe(TASKS[2]!.steps[3]!.label);
    expect(hud.flight).toBeNull();
    expect(hud.feedback?.text).toBe("Landed");
    rig.controller.dispose();
  });

  it("keeps flying and warns when the land gate is crossed too fast", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES);
    rig.controller.teleportToObjective();
    // Full throttle and boost: well above the landing limit by the time the gate arrives.
    rig.flight.input = { aimX: 0, aimY: 0, throttle: 1, fineRoll: 0, boost: true };
    for (let i = 0; i < 120; i += 1) rig.controller.update(1 / 60);
    expect(rig.controller.mode).toBe("fly");
    expect(rig.controller.hud().feedback).toEqual({ text: "Ease the throttle (S) to land", tone: "warn" });
    expect(rig.controller.hud().task.stepLabel).toBe(TASKS[2]!.steps[2]!.label);
    rig.controller.dispose();
  });

  it("reports tooFast in the flight HUD", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES);
    // The release speed is the cruise speed, above the landing limit.
    const flight = rig.controller.hud().flight!;
    expect(flight.tooFast).toBe(true);
    expect(flight.landingSpeed).toBe(LANDING_SPEED);
    rig.flight.input = { aimX: 0, aimY: 0, throttle: -1, fineRoll: 0, boost: false };
    frames(rig, 300);
    expect(rig.controller.hud().flight!.tooFast).toBe(false);
    rig.controller.dispose();
  });

  it("a free landing at the home gate during the land step re-shows the launch prompt", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES);
    // Point the plane at the HOME gate instead of the task's gate.
    rig.controller.teleportToGate("home");
    for (let i = 0; i < 200 && rig.controller.mode === "fly"; i += 1) rig.controller.update(1 / 60);
    expect(rig.controller.mode).toBe("walk");
    expect(rig.controller.island).toBe("home");
    const hud = rig.controller.hud();
    expect(hud.task.stepLabel).toBe(TASKS[2]!.steps[1]!.label);
    // The courier lands beside the home pad; at the launcher the launch prompt shows again.
    rig.controller.teleportToObjective();
    rig.controller.update(1 / 60);
    expect(rig.controller.hud().prompt).toBe("E · Launch");
    rig.controller.dispose();
  });

  it("fly-mode teleport crosses the gate and lands within a couple of seconds", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, 5); // still in the arc: the teleport finishes it first
    rig.controller.teleportToObjective();
    let steps = 0;
    while (rig.controller.mode === "fly" && steps < 180) { rig.controller.update(1 / 60); steps += 1; }
    expect(rig.controller.mode).toBe("walk");
    expect(steps).toBeLessThan(150);
    expect(rig.controller.island).toBe("lanternfall");
    rig.controller.dispose();
  });

  it("runs the whole round end to end", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES);
    flyToGate(rig);
    expect(rig.controller.island).toBe("lanternfall");
    interact(rig); // deliver the letter to the keeper (teleports on Lanternfall)
    const hud = rig.controller.hud();
    expect(hud.task.done).toBe(true);
    expect(hud.feedback).toEqual({ text: "Round complete", tone: "good" });
    expect(hud.marker.visible).toBe(true); // points at the other island's gate once the round is done
    rig.controller.dispose();
  });

  it("flies home freely from Lanternfall and lands on the home pad", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES);
    flyToGate(rig);
    interact(rig); // round done
    rig.controller.teleportToPad();
    rig.controller.update(1 / 60);
    expect(rig.controller.hud().prompt).toBe("E · Fly home");
    rig.keys.press();
    rig.controller.update(1 / 60);
    frames(rig, ARC_FRAMES);
    flyToGate(rig);
    expect(rig.controller.island).toBe("home");
    const p = rig.controller.position();
    expect(Math.hypot(p.x - HOME_PAD.position.x, p.z - HOME_PAD.position.z)).toBeLessThan(35);
    rig.controller.dispose();
  });

  it("reports the flight HUD fields", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES + 10);
    const flight = rig.controller.hud().flight!;
    const p = rig.controller.position();
    expect(flight.speed).toBeGreaterThan(20);
    expect(flight.altitude).toBeCloseTo(p.y);
    expect(flight.boost).toBeGreaterThan(0);
    expect(flight.boostLocked).toBe(false);
    expect(flight.pointerLocked).toBe(false);
    expect(flight.turningBack).toBe(false);
    const gate = LANTERNFALL_GATE.center;
    expect(flight.gateDistance).toBeCloseTo(Math.hypot(gate.x - p.x, gate.y - p.y, gate.z - p.z), 3);
    expect(rig.controller.hud().marker.visible).toBe(true);
    rig.controller.dispose();
  });

  it("chases the plane from behind and above, without touching the orbit controls", () => {
    const rig = setup();
    rig.clock.reduced = true; // the camera follows instantly
    let controlUpdates = 0;
    rig.controls.update = () => { controlUpdates += 1; return true; };
    launchTaskFlight(rig);
    controlUpdates = 0;
    frames(rig, 30);
    expect(controlUpdates).toBe(0);
    const plane = rig.controller.position();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeGroup(rig).quaternion);
    const offset = rig.camera.position.clone().sub(new THREE.Vector3(plane.x, plane.y, plane.z));
    expect(offset.dot(forward)).toBeLessThan(-30);
    expect(offset.y).toBeGreaterThan(5);
    const look = rig.camera.getWorldDirection(new THREE.Vector3());
    expect(look.dot(forward)).toBeGreaterThan(0.8);
    rig.controller.dispose();
  });

  it("poses the plane with yaw, pitch and bank (YXZ)", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES);
    rig.flight.input = { aimX: 1, aimY: 0, throttle: 0, fineRoll: 0, boost: false };
    frames(rig, 30);
    const plane = planeGroup(rig);
    expect(plane.rotation.order).toBe("YXZ");
    expect(plane.rotation.z).toBeLessThan(-0.1); // banked into a right turn: -bank * 0.6
    expect(Number.isFinite(plane.rotation.y)).toBe(true);
    rig.controller.dispose();
  });

  it("releases the flight input when stopped mid-flight", () => {
    const rig = setup();
    launchTaskFlight(rig);
    rig.controller.stop();
    expect(rig.flight.enabled).toBe(false);
    rig.controller.dispose();
  });

  it("dispose frees the plane's own materials but never the palette's", () => {
    const rig = setup();
    rig.controller.start();
    const plane = planeGroup(rig);
    const own = new Set<THREE.Material>();
    plane.traverse((o) => { if (o instanceof THREE.Mesh) own.add(o.material as THREE.Material); });
    expect(own.size).toBe(2);
    const disposed = new Set<THREE.Material>();
    for (const m of own) m.addEventListener("dispose", () => disposed.add(m));
    const shared = rig.palette.get("copper");
    let sharedDisposed = false;
    shared.addEventListener("dispose", () => { sharedDisposed = true; });
    rig.controller.dispose();
    expect(disposed.size).toBe(2);
    expect(sharedDisposed).toBe(false);
  });
});

describe("CourierController flight: pause, restart and edge cases", () => {
  const snapshot = (rig: Rig) => rig.controller.position();
  const same = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  it("freezes the launch arc and the flight while suspended, and resumes afterwards", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, 20); // mid-arc
    rig.controller.setSuspended(true);
    const inArc = snapshot(rig);
    frames(rig, 120);
    expect(same(snapshot(rig), inArc)).toBe(0);
    rig.controller.setSuspended(false);
    frames(rig, ARC_FRAMES + 30);
    const flying = snapshot(rig);
    expect(rig.controller.hud().flight).not.toBeNull();
    rig.controller.setSuspended(true);
    frames(rig, 120); // 2 s
    expect(same(snapshot(rig), flying)).toBe(0);
    rig.controller.setSuspended(false);
    frames(rig, 30);
    expect(same(snapshot(rig), flying)).toBeGreaterThan(10);
    rig.controller.dispose();
  });

  it("cannot cross a gate while suspended", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES);
    rig.controller.teleportToObjective();
    rig.controller.setSuspended(true);
    frames(rig, 300);
    expect(rig.controller.mode).toBe("fly");
    rig.controller.setSuspended(false);
    frames(rig, 150);
    expect(rig.controller.mode).toBe("walk");
    rig.controller.dispose();
  });

  it("does not show a turning-back message (the HUD strip covers it)", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES);
    const plane = rig.controller as unknown as { skyPlane: { position: { x: number; z: number }; yaw: number } };
    plane.skyPlane.position.x = 4300;
    plane.skyPlane.position.z = 0;
    plane.skyPlane.yaw = Math.PI / 2;
    frames(rig, 10);
    expect(rig.controller.hud().flight?.turningBack).toBe(true);
    expect(rig.controller.hud().feedback?.text ?? "").not.toContain("Turning back");
    rig.controller.dispose();
  });

  it("re-enables the orbit controls when stopped mid-flight", () => {
    const rig = setup();
    launchTaskFlight(rig);
    expect(rig.controls.enabled).toBe(false);
    rig.controller.stop();
    expect(rig.controls.enabled).toBe(true);
    rig.controller.dispose();
  });

  it("moves horizontally at a constant 50 units a second through the arc", () => {
    const rig = setup();
    launchTaskFlight(rig);
    const horizontal = () => {
      const p = rig.controller.position();
      return Math.hypot(p.x - HOME_PAD.position.x, p.z - HOME_PAD.position.z);
    };
    const speeds: number[] = [];
    let last = horizontal();
    for (let i = 0; i < 60; i += 1) {
      rig.controller.update(1 / 60);
      const now = horizontal();
      speeds.push((now - last) * 60);
      last = now;
    }
    for (const speed of speeds) expect(speed).toBeCloseTo(50, 0);
    rig.controller.dispose();
  });

  describe.each([
    ["during the launch arc", (rig: Rig) => { launchTaskFlight(rig); frames(rig, 10); }],
    ["during free flight", (rig: Rig) => { launchTaskFlight(rig); frames(rig, ARC_FRAMES + 20); }],
    ["after landing on Lanternfall", (rig: Rig) => { launchTaskFlight(rig); frames(rig, ARC_FRAMES); flyToGate(rig); }],
  ])("start() %s", (_name, arrange) => {
    it("returns to a fresh walk at home", () => {
      const rig = setup();
      arrange(rig);
      rig.controller.start();
      expect(rig.controller.mode).toBe("walk");
      expect(rig.controller.island).toBe("home");
      expect(rig.controls.enabled).toBe(false); // the follow camera has the view
      expect(rig.flight.enabled).toBe(false);
      expect(rig.world.children.filter((c) => c.name === "courierPlane")).toHaveLength(1);
      expect(rig.world.children.filter((c) => c.name === "courier")).toHaveLength(1);
      const plane = planeGroup(rig);
      expect(plane.position.x).toBeCloseTo(HOME_PAD.position.x);
      expect(plane.position.y).toBeCloseTo(HOME_PAD.position.y + 1.2);
      expect(plane.position.z).toBeCloseTo(HOME_PAD.position.z);
      expect(plane.rotation.y).toBeCloseTo(-HOME_PAD.yaw);
      expect(rig.controller.hud().flight).toBeNull();
      expect(rig.controller.hud().task.stepIndex).toBe(0);
      expect(rig.controller.position().x).toBeCloseTo(-50, 1);
      // Nothing is left running: the plane stays parked and the courier stays put.
      const parked = plane.position.clone();
      frames(rig, 60);
      expect(plane.position.distanceTo(parked)).toBe(0);
      expect(rig.controller.mode).toBe("walk");
      expect(rig.flight.enabled).toBe(false);
      rig.controller.dispose();
    });
  });

  it("teleportToObjective on Lanternfall in walk mode lands within the keeper door's radius", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES);
    flyToGate(rig);
    expect(rig.controller.island).toBe("lanternfall");
    rig.controller.teleportToObjective();
    const p = rig.controller.position();
    expect(Math.hypot(p.x - KEEPER_DOOR.x, p.z - KEEPER_DOOR.z)).toBeLessThanOrEqual(6);
    expect(Math.abs(p.y - KEEPER_DOOR.y)).toBeLessThanOrEqual(6);
    rig.controller.update(1 / 60);
    expect(rig.controller.hud().task.prompt).toBe("E · Deliver letter");
    rig.controller.dispose();
  });
});

describe("holding W through a landing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("leaves the courier still after landing", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const key = (type: "keydown" | "keyup", code: string) =>
      target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
        code, ctrlKey: false, metaKey: false, altKey: false, repeat: false, isComposing: false,
      }));
    const rig = setup({ keys: null });
    rig.controller.start();
    rig.controller.teleportToPad();
    key("keydown", "KeyE"); // free flight
    rig.controller.update(1 / 60);
    expect(rig.controller.mode).toBe("fly");
    frames(rig, ARC_FRAMES);
    key("keydown", "KeyW"); // held while flying (never released)
    flyToGate(rig);
    expect(rig.controller.mode).toBe("walk");
    const landed = rig.controller.position();
    frames(rig, 60);
    const after = rig.controller.position();
    expect(Math.hypot(after.x - landed.x, after.z - landed.z)).toBeLessThan(0.01);
    rig.controller.dispose();
  });
});

describe("smooth drawing between fixed steps", () => {
  it("moves the drawn courier a steady amount every frame at 144 fps (no judder)", () => {
    const rig = setup();
    rig.controller.start();
    rig.keys.forward = 1;
    for (let i = 0; i < 144; i += 1) rig.controller.update(1 / 144);
    const courier = rig.world.getObjectByName("courier")!;
    const steps: number[] = [];
    let last = courier.position.clone();
    for (let i = 0; i < 48; i += 1) {
      rig.controller.update(1 / 144);
      steps.push(courier.position.distanceTo(last));
      last = courier.position.clone();
    }
    const mean = steps.reduce((sum, step) => sum + step, 0) / steps.length;
    expect(mean).toBeGreaterThan(0.005);
    // Raw fixed steps at 144 fps alternate between 0 and a whole 1/60 s step; blended frames change only gradually
    // from one frame to the next (the courier may be speeding up or slowing down, but never stops and lurches).
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]!).toBeGreaterThan(steps[i - 1]! * 0.6);
      expect(steps[i]!).toBeLessThan(steps[i - 1]! * 1.7);
    }
    rig.controller.dispose();
  });

  it("draws the courier exactly where it is after a teleport", () => {
    const rig = setup();
    rig.controller.start();
    rig.keys.forward = 1;
    for (let i = 0; i < 30; i += 1) rig.controller.update(1 / 144);
    rig.keys.forward = 0;
    rig.controller.teleportToObjective();
    const p = rig.controller.position();
    expect(rig.world.getObjectByName("courier")!.position.distanceTo(new THREE.Vector3(p.x, p.y, p.z))).toBeLessThan(1e-9);
    rig.controller.dispose();
  });

  it("blends the plane between fixed steps too", () => {
    const rig = setup();
    reachLaunchStep(rig);
    launchTaskFlight(rig);
    frames(rig, 120);
    const plane = planeGroup(rig);
    const steps: number[] = [];
    let last = plane.position.clone();
    for (let i = 0; i < 48; i += 1) {
      rig.controller.update(1 / 144);
      steps.push(plane.position.distanceTo(last));
      last = plane.position.clone();
    }
    const mean = steps.reduce((sum, step) => sum + step, 0) / steps.length;
    expect(mean).toBeGreaterThan(0.1);
    expect(Math.min(...steps)).toBeGreaterThan(mean * 0.6);
    expect(Math.max(...steps)).toBeLessThan(mean * 1.4);
    rig.controller.dispose();
  });
});

describe("plane feel", () => {
  /** How far the propeller turns over `count` frames at 60 fps. */
  function propellerTurn(rig: Rig, count: number): number {
    const propeller = planeGroup(rig).children.find((child) => child.children.length === 3)!;
    const before = propeller.rotation.z;
    frames(rig, count);
    return propeller.rotation.z - before;
  }

  it("spools the propeller with the throttle", () => {
    const rig = setup();
    launchTaskFlight(rig);
    rig.flight.input = { ...rig.flight.input, throttle: -1 };
    frames(rig, ARC_FRAMES + 180);
    const idle = propellerTurn(rig, 30);
    rig.flight.input = { ...rig.flight.input, throttle: 1 };
    frames(rig, 180);
    const full = propellerTurn(rig, 30);
    expect(full).toBeGreaterThan(idle * 1.8);
    rig.controller.dispose();
  });

  it("widens the view with speed, then eases it back after landing", () => {
    const rig = setup();
    launchTaskFlight(rig);
    rig.flight.input = { ...rig.flight.input, throttle: 1 };
    frames(rig, ARC_FRAMES + 300);
    expect(rig.camera.fov).toBeGreaterThan(FOLLOW.fov + 3);
    rig.flight.input = { ...rig.flight.input, throttle: -1 };
    flyToGate(rig);
    expect(rig.controller.mode).toBe("walk");
    frames(rig, 300);
    expect(rig.camera.fov).toBeCloseTo(FOLLOW.fov, 2);
    rig.controller.dispose();
  });

  it("drops the plane onto the pad after landing, settles it, and winds the propeller down", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES);
    flyToGate(rig);
    expect(rig.controller.mode).toBe("walk");
    const plane = planeGroup(rig);
    const rest = LANTERNFALL_PAD.position.y + 1.2;
    expect(plane.position.y).toBeGreaterThan(rest + 1);
    let lowest = Infinity;
    for (let i = 0; i < 180; i += 1) { frames(rig, 1); lowest = Math.min(lowest, plane.position.y); }
    // It bounces a little below rest, but never sinks into the pad by more than the cap.
    expect(lowest).toBeLessThan(rest);
    expect(lowest).toBeGreaterThanOrEqual(rest - 0.4 - 1e-9);
    expect(plane.position.y).toBeCloseTo(rest, 3);
    expect(plane.rotation.x).toBeCloseTo(0, 3);
    frames(rig, 240);
    expect(Math.abs(propellerTurn(rig, 30))).toBeLessThan(0.05);
    rig.controller.dispose();
  });

  it("keeps the camera and the parked plane still under reduced motion", () => {
    const rig = setup();
    rig.clock.reduced = true;
    launchTaskFlight(rig);
    rig.flight.input = { ...rig.flight.input, throttle: 1 };
    frames(rig, 400);
    expect(rig.camera.fov).toBe(FOLLOW.fov);
    rig.flight.input = { ...rig.flight.input, throttle: -1 };
    flyToGate(rig);
    expect(rig.controller.mode).toBe("walk");
    expect(planeGroup(rig).position.y).toBeCloseTo(LANTERNFALL_PAD.position.y + 1.2, 9);
    rig.controller.dispose();
  });
});

describe("review fixes: camera state, suspension and height smoothing", () => {
  it("gives the scene its field of view back when play stops mid-flight", () => {
    const rig = setup();
    launchTaskFlight(rig);
    rig.flight.input = { ...rig.flight.input, throttle: 1 };
    frames(rig, ARC_FRAMES + 300);
    expect(rig.camera.fov).toBeGreaterThan(FOLLOW.fov + 3);
    rig.controller.stop();
    expect(rig.camera.fov).toBe(34);
    expect(rig.camera.near).toBe(2);
    rig.controller.dispose();
  });

  it("holds the drawn plane still while suspended mid-flight", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES + 30);
    rig.controller.setSuspended(true);
    rig.controller.update(1 / 144);
    const plane = planeGroup(rig);
    const held = plane.position.clone();
    for (let i = 0; i < 20; i += 1) {
      rig.controller.update(1 / 144);
      expect(plane.position.distanceTo(held)).toBeLessThan(1e-9);
    }
    rig.controller.dispose();
  });

  /** A controller on a test walk world (spawn is at (-50, 0) facing west; forward walks toward -X). */
  function onGround(height: (x: number) => number) {
    const rig = setup();
    const world = { surfaceAt: (x: number) => ({ height: height(x), walkable: true }), blocked: () => false };
    const controller = new CourierController({
      world: rig.world, camera: rig.camera, controls: rig.controls, palette: rig.palette, now: () => rig.clock.t,
      flightInput: rig.flight, keys: rig.keys, walkWorld: world,
    });
    rig.controller.dispose();
    controller.start();
    return { ...rig, controller, courier: rig.world.getObjectByName("courier")! };
  }

  it("follows a slope exactly (no sinking into the hill while running up it)", () => {
    const slope = (x: number) => Math.max(0, (-50 - x) * 0.25);
    const rig = onGround(slope);
    for (let i = 0; i < 120; i += 1) rig.controller.update(1 / 60);
    rig.controller.setCameraYaw(-Math.PI / 2); // look west, up the slope
    rig.keys.forward = 1;
    rig.keys.run = true;
    for (let i = 0; i < 288; i += 1) {
      rig.controller.update(1 / 144);
      expect(Math.abs(rig.courier.position.y - slope(rig.courier.position.x))).toBeLessThan(1e-6);
    }
    expect(rig.courier.position.y).toBeGreaterThan(3);
    rig.controller.dispose();
  });

  it("eases a kerb step instead of popping up it", () => {
    const kerb = (x: number) => (x < -58 ? 1 : 0);
    const rig = onGround(kerb);
    for (let i = 0; i < 120; i += 1) rig.controller.update(1 / 60);
    rig.controller.setCameraYaw(-Math.PI / 2); // look west, toward the kerb
    rig.keys.forward = 1;
    let last = rig.courier.position.y;
    let biggest = 0;
    for (let i = 0; i < 288; i += 1) {
      rig.controller.update(1 / 144);
      const y = rig.courier.position.y;
      biggest = Math.max(biggest, Math.abs(y - last));
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(1 + 1e-9);
      last = y;
    }
    expect(rig.courier.position.x).toBeLessThan(-60);
    expect(biggest).toBeLessThan(0.35);
    rig.keys.forward = 0;
    for (let i = 0; i < 60; i += 1) rig.controller.update(1 / 144);
    expect(rig.courier.position.y).toBeCloseTo(1, 3);
    rig.controller.dispose();
  });

  it("draws the courier exactly where it lands on Lanternfall, and back at the spawn after a restart", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES);
    flyToGate(rig);
    expect(rig.controller.island).toBe("lanternfall");
    const courier = rig.world.getObjectByName("courier")!;
    const landed = rig.controller.position();
    expect(courier.position.distanceTo(new THREE.Vector3(landed.x, landed.y, landed.z))).toBeLessThan(1e-9);
    rig.controller.start();
    const spawn = rig.controller.position();
    expect(spawn.x).toBeCloseTo(-50, 1);
    expect(courier.position.distanceTo(new THREE.Vector3(spawn.x, spawn.y, spawn.z))).toBeLessThan(1e-9);
    rig.controller.dispose();
  });
});

describe("the follow camera in the town", () => {
  it("keeps a clear view of the courier while it walks about the real hill town", () => {
    const rig = setup();
    const world = createHomeCameraWorld(createHomeWalkWorld());
    rig.controller.start();
    frames(rig, 100);
    const courier = rig.world.getObjectByName("courier")!;
    let blocked = 0;
    let checked = 0;
    const walk = (keys: Partial<{ forward: number; strafe: number; run: boolean }>, seconds: number) => {
      Object.assign(rig.keys, { forward: 0, strafe: 0, run: false }, keys);
      for (let i = 0; i < seconds * 60; i += 1) {
        rig.controller.update(1 / 60);
        const head = { x: courier.position.x, y: courier.position.y + FOLLOW.targetLift, z: courier.position.z };
        if (world.clearFraction(head, rig.camera.position, FOLLOW.collision.ignoreNear) < 0.999) blocked += 1;
        checked += 1;
      }
    };
    walk({ forward: 1, run: true }, 4);
    walk({ strafe: 1 }, 3);
    walk({ forward: 1 }, 3);
    walk({ forward: -1 }, 3);
    walk({ strafe: -1, run: true }, 3);
    expect(checked).toBe(960);
    // The camera may trail an occluder for a frame or two while it pulls in, never longer.
    expect(blocked).toBeLessThanOrEqual(8);
    rig.controller.dispose();
  });

  it("orbits with a canvas drag and zooms with the wheel, but only while walking", () => {
    const rig = setup();
    const canvas = new EventTarget();
    const controller = new CourierController({
      world: rig.world, camera: rig.camera, controls: rig.controls, palette: rig.palette, now: () => rig.clock.t,
      flightInput: rig.flight, keys: rig.keys, canvas: canvas as unknown as HTMLCanvasElement,
    });
    rig.controller.dispose();
    controller.start();
    for (let i = 0; i < 100; i += 1) controller.update(1 / 60);
    const look = () => { const d = horizontalLook(rig.camera); return Math.atan2(d.x, -d.z); };
    const before = look();
    const event = (type: string, x: number) => Object.assign(new Event(type), { clientX: x, clientY: 300, button: 0, pointerId: 1 });
    canvas.dispatchEvent(event("pointerdown", 400));
    canvas.dispatchEvent(event("pointermove", 520));
    canvas.dispatchEvent(event("pointerup", 520));
    for (let i = 0; i < 40; i += 1) controller.update(1 / 60);
    expect(look() - before).toBeGreaterThan(0.3);
    const p = controller.position();
    const head = new THREE.Vector3(p.x, p.y + FOLLOW.targetLift, p.z);
    const near = rig.camera.position.distanceTo(head);
    canvas.dispatchEvent(Object.assign(new Event("wheel", { cancelable: true }), { deltaY: 400 }));
    for (let i = 0; i < 120; i += 1) controller.update(1 / 60);
    expect(rig.camera.position.distanceTo(head)).toBeGreaterThan(near + 3);
    controller.stop();
    const stopped = rig.camera.position.clone();
    canvas.dispatchEvent(event("pointerdown", 400));
    canvas.dispatchEvent(event("pointermove", 600));
    expect(rig.camera.position.distanceTo(stopped)).toBe(0);
    controller.dispose();
  });
});

describe("chase camera", () => {
  it("looks a little into a sustained turn", () => {
    const rig = setup();
    launchTaskFlight(rig);
    frames(rig, ARC_FRAMES + 60);
    rig.flight.input = { ...rig.flight.input, aimX: 0.8 };
    const plane = planeGroup(rig);
    const yawOf = () => -plane.rotation.y;
    frames(rig, 90);
    // The turn's direction over the last few frames (a long window could wrap past half a turn).
    const before = yawOf();
    frames(rig, 6);
    const turning = Math.sign(Math.atan2(Math.sin(yawOf() - before), Math.cos(yawOf() - before)));
    expect(turning).not.toBe(0);
    const dir = rig.camera.getWorldDirection(new THREE.Vector3());
    const look = Math.atan2(dir.x, -dir.z);
    const lead = Math.atan2(Math.sin(look - yawOf()), Math.cos(look - yawOf()));
    expect(Math.sign(lead)).toBe(turning);
    rig.controller.dispose();
  });
});

describe("follow camera input lifecycle", () => {
  const pointer = (type: string, x: number, id = 1) => Object.assign(new Event(type), { clientX: x, clientY: 300, button: 0, pointerId: id });

  function onCanvas() {
    const rig = setup();
    const canvas = new EventTarget();
    const controller = new CourierController({
      world: rig.world, camera: rig.camera, controls: rig.controls, palette: rig.palette, now: () => rig.clock.t,
      flightInput: rig.flight, keys: rig.keys, canvas: canvas as unknown as HTMLCanvasElement,
    });
    rig.controller.dispose();
    const look = () => { const d = horizontalLook(rig.camera); return Math.atan2(d.x, -d.z); };
    return { ...rig, canvas, controller, look };
  }

  it("listens once however often the round restarts, and not at all once disposed", () => {
    const rig = onCanvas();
    rig.controller.start();
    rig.controller.start();
    rig.controller.start();
    for (let i = 0; i < 100; i += 1) rig.controller.update(1 / 60);
    const before = rig.look();
    rig.canvas.dispatchEvent(pointer("pointerdown", 400));
    rig.canvas.dispatchEvent(pointer("pointermove", 450));
    rig.canvas.dispatchEvent(pointer("pointerup", 450));
    for (let i = 0; i < 120; i += 1) rig.controller.update(1 / 60);
    // One listener: 50 px of drag turns the view by 50 * yawPerPixel, not three times that.
    expect(rig.look() - before).toBeCloseTo(50 * FOLLOW.drag.yawPerPixel, 2);
    rig.controller.dispose();
    const after = rig.camera.position.clone();
    rig.canvas.dispatchEvent(pointer("pointerdown", 400));
    rig.canvas.dispatchEvent(pointer("pointermove", 600));
    rig.canvas.dispatchEvent(Object.assign(new Event("wheel", { cancelable: true }), { deltaY: 500 }));
    expect(rig.camera.position.distanceTo(after)).toBe(0);
  });

  it("follows the first pointer only, and ends the drag when capture is lost", () => {
    const rig = onCanvas();
    rig.controller.start();
    for (let i = 0; i < 100; i += 1) rig.controller.update(1 / 60);
    const before = rig.look();
    rig.canvas.dispatchEvent(pointer("pointerdown", 400, 1));
    rig.canvas.dispatchEvent(pointer("pointerdown", 100, 2));
    rig.canvas.dispatchEvent(pointer("pointermove", 900, 2));
    rig.canvas.dispatchEvent(pointer("pointerup", 900, 2));
    rig.canvas.dispatchEvent(pointer("pointermove", 440, 1));
    rig.canvas.dispatchEvent(Object.assign(new Event("lostpointercapture"), { pointerId: 1 }));
    rig.canvas.dispatchEvent(pointer("pointermove", 800, 1));
    for (let i = 0; i < 120; i += 1) rig.controller.update(1 / 60);
    expect(rig.look() - before).toBeCloseTo(40 * FOLLOW.drag.yawPerPixel, 2);
    rig.controller.dispose();
  });
});

describe("jumping", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The courier's dust puffs currently drawn (non-zero scale). */
  const puffs = (rig: Rig) => {
    const mesh = rig.world.getObjectByName("Courier dust") as THREE.InstancedMesh | undefined;
    if (!mesh) return 0;
    const matrix = new THREE.Matrix4();
    let count = 0;
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getMatrixAt(i, matrix);
      if (new THREE.Vector3().setFromMatrixScale(matrix).x > 1e-3) count += 1;
    }
    return count;
  };

  /** Run `frames` fixed frames, returning the highest and final heights above `y0`. */
  const run = (rig: Rig, frames: number, y0: number) => {
    let peak = 0;
    for (let i = 0; i < frames; i += 1) {
      rig.controller.update(1 / 60);
      peak = Math.max(peak, rig.controller.position().y - y0);
    }
    return { peak, final: rig.controller.position().y - y0 };
  };

  const started = () => {
    const rig = setup();
    rig.controller.start();
    run(rig, 10, 0);
    return rig;
  };

  it("hops about a body-height up on Space and comes back down, puffing dust at take-off and landing", () => {
    const rig = started();
    const y0 = rig.controller.position().y;
    expect(puffs(rig)).toBe(0);
    rig.keys.jump();
    rig.controller.update(1 / 60);
    expect(puffs(rig)).toBeGreaterThan(0);
    const up = run(rig, 18, y0);
    expect(up.peak).toBeGreaterThan(0.9);
    expect(up.peak).toBeLessThan(1.5);
    run(rig, 60, y0); // land, and let the take-off puffs fade
    expect(rig.controller.position().y).toBeCloseTo(y0, 6);
    rig.controller.dispose();
  });

  it("puffs dust on landing", () => {
    const rig = started();
    const y0 = rig.controller.position().y;
    rig.keys.jump();
    let landedPuffs = 0;
    let wasUp = false;
    for (let i = 0; i < 60; i += 1) {
      rig.controller.update(1 / 60);
      const height = rig.controller.position().y - y0;
      if (height > 0.5) wasUp = true;
      if (wasUp && height < 1e-9) {
        landedPuffs = puffs(rig);
        break;
      }
    }
    expect(wasUp).toBe(true);
    expect(landedPuffs).toBeGreaterThanOrEqual(7);
    rig.controller.dispose();
  });

  it("cannot jump again in mid-air, but a press just before landing is kept and jumps on touchdown", () => {
    const rig = started();
    const y0 = rig.controller.position().y;
    rig.keys.jump();
    run(rig, 12, y0); // near the top
    rig.keys.jump();
    const top = run(rig, 6, y0);
    expect(top.peak).toBeLessThan(1.5); // no double jump
    // Let it fall to just above the ground, press, and the buffered press jumps as soon as it lands.
    let height = rig.controller.position().y - y0;
    for (let i = 0; i < 30 && height > 0.35; i += 1) {
      rig.controller.update(1 / 60);
      height = rig.controller.position().y - y0;
    }
    expect(height).toBeGreaterThan(0);
    rig.keys.jump();
    const second = run(rig, 40, y0);
    expect(second.peak).toBeGreaterThan(0.9);
    rig.controller.dispose();
  });

  it("drops a press made long before landing (the buffer is short)", () => {
    const rig = started();
    const y0 = rig.controller.position().y;
    rig.keys.jump();
    run(rig, 4, y0);
    rig.keys.jump(); // ~0.5 s before touchdown
    run(rig, 40, y0); // lands
    const after = run(rig, 30, y0);
    expect(after.peak).toBeLessThan(1e-6);
    rig.controller.dispose();
  });

  it("puts a courier teleported mid-jump straight onto the ground", () => {
    const rig = started();
    rig.keys.jump();
    run(rig, 10, 0);
    rig.controller.teleportToObjective();
    const y = rig.controller.position().y;
    const after = run(rig, 30, y);
    expect(Math.abs(after.peak)).toBeLessThan(1e-9);
    expect(Math.abs(after.final)).toBeLessThan(1e-9);
    rig.controller.dispose();
  });

  it("still jumps under reduced motion, without any dust", () => {
    const rig = started();
    rig.clock.reduced = true;
    const y0 = rig.controller.position().y;
    rig.keys.jump();
    const up = run(rig, 20, y0);
    expect(up.peak).toBeGreaterThan(0.9);
    expect(puffs(rig)).toBe(0);
    rig.controller.dispose();
  });

  it("clears drifting dust the moment reduced motion is switched on", () => {
    const rig = started();
    rig.keys.jump();
    rig.controller.update(1 / 60);
    expect(puffs(rig)).toBeGreaterThan(0);
    rig.clock.reduced = true;
    rig.controller.update(1 / 60);
    expect(puffs(rig)).toBe(0);
    rig.controller.dispose();
  });

  it("kicks up dust at the heels when running flat out, and none when walking", () => {
    const rig = started();
    rig.keys.forward = 1;
    let walkingPuffs = 0;
    for (let i = 0; i < 90; i += 1) {
      rig.controller.update(1 / 60);
      walkingPuffs = Math.max(walkingPuffs, puffs(rig));
    }
    expect(walkingPuffs).toBe(0);
    rig.keys.run = true;
    let runningPuffs = 0;
    for (let i = 0; i < 120; i += 1) {
      rig.controller.update(1 / 60);
      runningPuffs = Math.max(runningPuffs, puffs(rig));
    }
    expect(runningPuffs).toBeGreaterThan(0);
    rig.controller.dispose();
  });

  it("removes the dust from the world on stop() and disposes its geometry", () => {
    const rig = started();
    const mesh = rig.world.getObjectByName("Courier dust") as THREE.InstancedMesh;
    expect(mesh).toBeDefined();
    const disposed = vi.fn();
    mesh.geometry.addEventListener("dispose", disposed);
    rig.controller.stop();
    expect(rig.world.getObjectByName("Courier dust")).toBeUndefined();
    rig.controller.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it("ignores Space while suspended and auto-repeated Space, and jumps on a fresh press", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const space = (repeat = false) => {
      const event = Object.assign(new Event("keydown", { cancelable: true }), {
        code: "Space", ctrlKey: false, metaKey: false, altKey: false, repeat, isComposing: false,
      });
      target.dispatchEvent(event);
    };
    const rig = setup({ keys: null });
    rig.controller.start();
    run(rig, 10, 0);
    const y0 = rig.controller.position().y;
    rig.controller.setSuspended(true);
    space();
    expect(run(rig, 20, y0).peak).toBeLessThan(1e-9);
    rig.controller.setSuspended(false);
    expect(run(rig, 20, y0).peak).toBeLessThan(1e-9);
    space(true);
    expect(run(rig, 20, y0).peak).toBeLessThan(1e-9);
    space();
    expect(run(rig, 20, y0).peak).toBeGreaterThan(0.9);
    rig.controller.dispose();
  });

  it("does not carry a Space pressed in the air (boost) into a jump on landing", () => {
    const rig = started();
    rig.controller.teleportToPad();
    rig.keys.press();
    rig.controller.update(1 / 60);
    expect(rig.controller.mode).toBe("fly");
    rig.keys.jump();
    rig.controller.update(1 / 60);
    rig.controller.teleportToGate("lanternfall");
    for (let i = 0; i < 240 && rig.controller.mode === "fly"; i += 1) rig.controller.update(1 / 60);
    expect(rig.controller.mode).toBe("walk");
    const y0 = rig.controller.position().y;
    expect(run(rig, 30, y0).peak).toBeLessThan(1e-9);
    rig.controller.dispose();
  });
});
