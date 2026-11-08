import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourierController, type ControlsLike } from "../courier/CourierController";
import { illustratedEnvironment, resetIllustratedEnvironment } from "@clockwork/render";
import { buildCity } from "./buildCity";
import { createHillTownLayout } from "./layout";
import { CityScene, type CityDiagnostics, type CityMode } from "./CityScene";

// CityScene's constructor needs WebGL, so these tests build an instance from the prototype and assign only the fields
// the methods under test read.

type Internals = {
  setMode(mode: CityMode): void;
  restartRound(): void;
  diagnostics(): CityDiagnostics;
  stepPlay(dt: number): void;
  setCourierSuspended(suspended: boolean): void;
  createCourierDebug(): { teleportToObjective(): void };
  dispose(): void;
  courier: CourierController | null;
  shiftTarget: { x: number; y: number };
  shift: { x: number; y: number };
  hudElapsed: number;
  focused: number | null;
  debug: (() => CityDiagnostics) | null;
  courierDebug: { teleportToObjective(): void } | null;
  mode: CityMode;
};

const city = buildCity(createHillTownLayout());

/** A freshly built scene's controls: the title state, which differs from explore's in enabled, maxDistance and autoRotate. */
function fakeControls(): ControlsLike {
  return {
    target: new THREE.Vector3(0, 20, 0), enabled: false, enablePan: true, minDistance: 150, maxDistance: 2600,
    maxPolarAngle: 1.36, autoRotate: true, update: () => true,
  };
}

/** What applyMode("explore") leaves on top of whatever was restored. */
const exploreSettings = (before: ReturnType<typeof settings>) => ({ ...before, enabled: true, maxDistance: 1800, autoRotate: false });

function setup(mode: CityMode = "explore", reducedMotion = true) {
  const world = new THREE.Scene();
  world.add(city.group);
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 2, 7000);
  camera.position.set(600, 500, 600);
  camera.lookAt(0, 20, 0);
  camera.updateMatrixWorld(true);
  const controls = fakeControls();
  const hud = vi.fn();
  const options: { onPick: () => void; onError: () => void; onCourierHud?: typeof hud } = { onPick: vi.fn(), onError: vi.fn(), onCourierHud: hud };
  const scene = Object.assign(Object.create(CityScene.prototype), {
    // The controller is given the canvas for flight input; a plain event target stands in for it.
    renderer: { domElement: new EventTarget() },
    world, camera, controls, city, layout: createHillTownLayout(), residents: { agents: [], update: () => {}, dispose: () => {} }, mode, focused: null, flight: null, reducedMotion,
    container: { clientWidth: 1280, clientHeight: 720 },
    size: { width: 1280, height: 720 },
    shift: { x: 0.1, y: 0.1 }, shiftTarget: { x: 0.1, y: 0.1 },
    stats: { calls: 0, triangles: 0 }, options, courier: null, savedControls: null, hudElapsed: 0, courierDebug: null,
  }) as Internals;
  return { scene, world, controls, options, hud };
}

function settings(c: ControlsLike) {
  return {
  enablePan: c.enablePan, minDistance: c.minDistance, maxDistance: c.maxDistance,
  maxPolarAngle: c.maxPolarAngle, autoRotate: c.autoRotate, enabled: c.enabled,
  };
}
const hasCourierGroup = (world: THREE.Scene) => world.children.some((child) => child instanceof THREE.Group && child !== city.group);

afterEach(() => vi.restoreAllMocks());

describe("play mode", () => {
  it("setMode('play') creates and starts a controller, zeroes the shift target and saves the controls", () => {
    const { scene, world, controls } = setup("explore");
    const before = settings(controls);
    const childrenBefore = world.children.length;
    scene.setMode("play");
    expect(scene.mode).toBe("play");
    expect(scene.courier).toBeInstanceOf(CourierController);
    expect(world.children.length).toBe(childrenBefore + 4); // courier group + beacon + parked plane + dust puffs
    expect(scene.shiftTarget).toEqual({ x: 0, y: 0 });
    // The courier's follow camera owns the view: the orbit controls are switched off, their other settings untouched.
    expect(controls.enabled).toBe(false);
    expect({ ...settings(controls), enabled: before.enabled }).toEqual(before);
    expect(hasCourierGroup(world)).toBe(true);
  });

  it("leaving play restores the controls exactly and removes the courier", () => {
    const { scene, world, controls } = setup("explore");
    const before = settings(controls);
    const childrenBefore = world.children.length;
    scene.setMode("play");
    scene.setMode("explore");
    expect(settings(controls)).toEqual(exploreSettings(before));
    expect(world.children.length).toBe(childrenBefore);
    expect(scene.mode).toBe("explore");
    expect(scene.diagnostics().courier).toBeNull();
  });

  it("leaving play to the title view stops the courier and flies to the title pose", () => {
    const { scene, world } = setup("explore");
    const childrenBefore = world.children.length;
    scene.setMode("play");
    scene.setMode("title");
    expect(world.children.length).toBe(childrenBefore);
    expect(scene.mode).toBe("title");
  });

  it("reuses one controller across rounds", () => {
    const { scene } = setup("explore");
    scene.setMode("play");
    const first = scene.courier;
    scene.setMode("explore");
    scene.setMode("play");
    expect(scene.courier).toBe(first);
  });

  it("stepPlay updates the courier and emits the HUD at most ten times per simulated second", () => {
    const { scene, hud } = setup("explore");
    scene.setMode("play");
    const update = vi.spyOn(scene.courier as CourierController, "update");
    for (let frame = 0; frame < 60; frame += 1) scene.stepPlay(1 / 60);
    expect(update).toHaveBeenCalledTimes(60);
    expect(hud.mock.calls.length).toBeLessThanOrEqual(10);
    expect(hud.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(hud.mock.calls[0]?.[0]).toMatchObject({ mode: "walk" });
  });

  it("stepPlay tolerates a missing HUD callback", () => {
    const { scene, options } = setup("explore");
    delete options.onCourierHud;
    scene.setMode("play");
    expect(() => { for (let frame = 0; frame < 20; frame += 1) scene.stepPlay(1 / 60); }).not.toThrow();
  });

  it("restartRound restarts in play mode and does nothing elsewhere", () => {
    const { scene, hud } = setup("explore");
    scene.restartRound(); // no controller yet: no-op
    expect(scene.courier).toBeNull();
    scene.setMode("play");
    const start = vi.spyOn(scene.courier as CourierController, "start");
    for (let frame = 0; frame < 3; frame += 1) scene.stepPlay(1 / 60);
    expect(scene.hudElapsed).toBeGreaterThan(0);
    hud.mockClear();
    scene.restartRound();
    expect(start).toHaveBeenCalledTimes(1);
    expect(hud).toHaveBeenCalledTimes(1);
    expect(scene.hudElapsed).toBe(0);
    scene.setMode("explore");
    scene.restartRound();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("diagnostics().courier is null outside play and populated in play", () => {
    const { scene } = setup("explore");
    expect(scene.diagnostics().courier).toBeNull();
    scene.setMode("play");
    const courier = scene.diagnostics().courier;
    expect(courier).not.toBeNull();
    expect(courier?.mode).toBe("walk");
    expect(courier?.position).toHaveLength(3);
    expect(courier?.position.every(Number.isFinite)).toBe(true);
    expect(courier?.taskId).toEqual(expect.any(String));
    expect(courier?.stepIndex).toBe(0);
    expect(courier?.done).toBe(false);
    expect(courier && "prompt" in courier).toBe(true);
  });

  it("diagnostics do not call hud(), which expires feedback", () => {
    const { scene } = setup("explore");
    scene.setMode("play");
    const hudSpy = vi.spyOn(scene.courier as CourierController, "hud");
    scene.diagnostics();
    expect(hudSpy).not.toHaveBeenCalled();
  });

  it("title -> play -> title brings back the title controls and shift target", () => {
    const { scene, controls } = setup("title", false);
    const before = settings(controls);
    const titleShift = { x: -0.2, y: 0 }; // wide title view slides the town right
    scene.setMode("play");
    expect(scene.shiftTarget).toEqual({ x: 0, y: 0 });
    expect(scene.shift).toEqual({ x: 0, y: 0 }); // snapped, no sideways slide
    expect(controls.enabled).toBe(false); // the follow camera owns the view while playing
    scene.setMode("title");
    expect(settings(controls)).toEqual(before);
    expect(scene.shiftTarget).toEqual(titleShift);
  });

  it("a controller that throws on start leaves the scene in its previous mode with the controls restored", () => {
    const { scene, controls, options } = setup("explore");
    scene.focused = 3;
    const before = settings(controls);
    const dispose = vi.fn();
    scene.courier = { start: () => { throw new Error("boom"); }, stop: vi.fn(), dispose } as unknown as CourierController;
    scene.setMode("play");
    expect(scene.mode).toBe("explore");
    expect(scene.courier).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(scene.focused).toBe(3);
    expect(settings(controls)).toEqual(exploreSettings(before));
    expect(options.onError).toHaveBeenCalledWith("Could not start the round: boom");
    expect(scene.diagnostics().courier).toBeNull();
  });

  it("a real controller whose start() throws is discarded and the next attempt builds a fresh one", () => {
    const { scene, world, options } = setup("title");
    const childrenBefore = world.children.length;
    const start = vi.spyOn(CourierController.prototype, "start").mockImplementationOnce(() => { throw new Error("no webgl"); });
    scene.setMode("play");
    expect(scene.mode).toBe("title");
    expect(scene.courier).toBeNull();
    expect(world.children.length).toBe(childrenBefore);
    expect(options.onError).toHaveBeenCalledWith("Could not start the round: no webgl");
    start.mockRestore();
    scene.setMode("play");
    expect(scene.mode).toBe("play");
    expect(scene.courier).toBeInstanceOf(CourierController);
  });

  it("setCourierSuspended forwards to the controller and is a no-op without one", () => {
    const { scene } = setup("explore");
    expect(() => scene.setCourierSuspended(true)).not.toThrow();
    scene.setMode("play");
    const suspended = vi.spyOn(scene.courier as CourierController, "setSuspended");
    scene.setCourierSuspended(true);
    scene.setCourierSuspended(false);
    expect(suspended.mock.calls).toEqual([[true], [false]]);
  });

  it("the debug teleport hook reaches the controller in play and does nothing otherwise", () => {
    const { scene } = setup("explore");
    const hook = scene.createCourierDebug();
    expect(() => hook.teleportToObjective()).not.toThrow(); // no controller yet
    scene.setMode("play");
    const teleport = vi.spyOn(scene.courier as CourierController, "teleportToObjective");
    hook.teleportToObjective();
    expect(teleport).toHaveBeenCalledTimes(1);
    scene.setMode("explore"); // the controller is kept, but the hook must not use it
    hook.teleportToObjective();
    expect(teleport).toHaveBeenCalledTimes(1);
  });
});

describe("play mode: dispose", () => {
  afterEach(() => vi.unstubAllGlobals());

  function disposable() {
    const window = Object.assign(new EventTarget(), { setInterval: () => 0, clearInterval: () => {}, __CLOCKWORK_CITY__: undefined as unknown, __CLOCKWORK_COURIER__: undefined as unknown });
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", Object.assign(new EventTarget(), { pointerLockElement: null }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const rig = setup("explore");
    const canvas = Object.assign(new EventTarget(), { remove: vi.fn() });
    Object.assign(rig.controls, { removeEventListener: vi.fn(), dispose: vi.fn() });
    Object.assign(rig.scene, {
      renderer: { domElement: canvas, dispose: vi.fn() }, composer: { dispose: vi.fn() }, gradeLut: { dispose: vi.fn() }, frame: 0,
      onPointerDown: () => {}, onPointerUp: () => {}, onContextLost: () => {}, resize: () => {}, onVisibility: () => {}, cancelFlight: () => {},
    });
    return { ...rig, window };
  }

  const materialsOf = (root: THREE.Object3D) => {
    const found = new Set<THREE.Material>();
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) for (const m of Array.isArray(object.material) ? object.material : [object.material]) found.add(m);
    });
    return found;
  };

  it("disposes each palette material exactly once and the plane's own materials, with a controller", () => {
    const { scene } = disposable();
    scene.setMode("play");
    const courier = scene.courier as CourierController;
    const plane = (courier as unknown as { plane: { group: THREE.Group } }).plane.group;
    const planeMaterials = materialsOf(plane);
    const paletteMaterials = materialsOf(city.group);
    expect(planeMaterials.size).toBeGreaterThan(0);
    const spy = vi.spyOn(THREE.Material.prototype, "dispose").mockImplementation(() => {});
    scene.dispose();
    const counts = (m: THREE.Material) => spy.mock.contexts.filter((context) => context === m).length;
    for (const material of paletteMaterials) expect(counts(material)).toBe(1);
    for (const material of planeMaterials) expect(counts(material)).toBe(1);
    expect(scene.courier).toBeNull();
  });

  it("removes the debug hooks only while they are still its own", () => {
    const own = disposable();
    own.scene.debug = () => own.scene.diagnostics();
    own.scene.courierDebug = own.scene.createCourierDebug();
    Object.assign(own.window, { __CLOCKWORK_CITY__: own.scene.debug, __CLOCKWORK_COURIER__: own.scene.courierDebug });
    own.scene.dispose();
    expect(own.window.__CLOCKWORK_CITY__).toBeUndefined();
    expect(own.window.__CLOCKWORK_COURIER__).toBeUndefined();
  });

  it("leaves hooks that another scene has since installed", () => {
    const rig = disposable();
    rig.scene.debug = () => rig.scene.diagnostics();
    rig.scene.courierDebug = rig.scene.createCourierDebug();
    const otherCity = () => rig.scene.diagnostics();
    const otherCourier = { teleportToObjective: () => {} };
    Object.assign(rig.window, { __CLOCKWORK_CITY__: otherCity, __CLOCKWORK_COURIER__: otherCourier });
    rig.scene.dispose();
    expect(rig.window.__CLOCKWORK_CITY__).toBe(otherCity);
    expect(rig.window.__CLOCKWORK_COURIER__).toBe(otherCourier);
  });
});

describe("play mode: leaving during a flight", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Start play, take off with a free launch from the pad, and return the pieces. */
  function takeOff() {
    const window = Object.assign(new EventTarget(), { setInterval: () => 0, clearInterval: () => {} });
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", Object.assign(new EventTarget(), { pointerLockElement: null }));
    const { scene, controls, world } = setup("explore");
    const before = settings(controls);
    scene.setMode("play");
    const courier = scene.courier as CourierController;
    const latch = (courier as unknown as { latch: { enabled: boolean } }).latch;
    courier.teleportToPad();
    window.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), {
      code: "KeyE", ctrlKey: false, metaKey: false, altKey: false, repeat: false, isComposing: false,
    }));
    scene.stepPlay(1 / 60);
    expect(courier.mode).toBe("fly");
    expect(latch.enabled).toBe(true);
    expect(controls.enabled).toBe(false);
    return { scene, latch, controls, world, before };
  }

  it.each(["explore", "title"] as const)("setMode('%s') mid-flight restores the controls and releases the flight input", (mode) => {
    const { scene, latch, controls, world, before } = takeOff();
    scene.setMode(mode);
    // Explore gets back exactly what it had; the title view sets its own, the same as after a walk-only visit.
    if (mode === "explore") expect(settings(controls)).toEqual(exploreSettings(before));
    else {
      const baseline = setup("explore");
      baseline.scene.setMode("play");
      baseline.scene.setMode("title");
      expect(settings(controls)).toEqual(settings(baseline.controls));
    }
    expect(latch.enabled).toBe(false);
    expect(world.getObjectByName("courierPlane")).toBeUndefined();
    expect(hasCourierGroup(world)).toBe(false);
  });
});

describe("solid scenery while playing", () => {
  afterEach(() => resetIllustratedEnvironment());

  it("never enables a sight-line cutout as the player enters or leaves walking mode", () => {
    const { scene } = setup("explore");
    expect(illustratedEnvironment.uSeeThrough.value).toBe(0);
    scene.setMode("play");
    for (let frame = 0; frame < 5; frame += 1) scene.stepPlay(1 / 60);
    expect(illustratedEnvironment.uSeeThrough.value).toBe(0);
    // In flight there is no courier on foot to keep in view.
    vi.spyOn(scene.courier!, "mode", "get").mockReturnValue("fly");
    expect(illustratedEnvironment.uSeeThrough.value).toBe(0);
    scene.setMode("explore");
    expect(illustratedEnvironment.uSeeThrough.value).toBe(0);
  });
});
