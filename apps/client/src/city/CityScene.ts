import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createGradeLut, IllustratedComposer, illustratedEnvironment, resetIllustratedEnvironment, type DebugView } from "@clockwork/render";
import { buildCity, handsGeometry, type BuiltCity } from "./buildCity";
import { anchorSwing, cycleMs, handAngles, tickValue } from "./clockwork";
import { createCityLayout, districtAt } from "./layout";
import { CourierController, type CourierHud, type CourierMotion } from "../courier/CourierController";
import { buildLanternfall, buildLaunchersAndGates } from "../courier/outpost";
import type { Spinner } from "./buildCity";
import { enableShadows } from "./kit";
import { Sun } from "./sun";
import { SKY_COLORS, Sky } from "./sky";
import { ATMOSPHERE_RATE, blendLook, FOG_NEAR, GROUND_LIGHT, INK, londonGrade, SKY_LIGHT } from "./atmosphere";
import { buildAmbient, type BuiltAmbient } from "./ambient";
import { createHillTownWalkWorld } from "../courier/walkWorld";
import { buildResidents, type BuiltResidents } from "./residents";

export type CityMode = "title" | "explore" | "play";
export type Nudge = "left" | "right" | "up" | "down" | "in" | "out";
export type CourierDiagnostics = { mode: "walk" | "fly"; position: number[]; taskId: string | null; stepIndex: number; done: boolean; prompt: string | null; motion: CourierMotion };
export type CityDiagnostics = {
  mode: CityMode; focused: number | null; calls: number; triangles: number; camera: number[]; target: number[]; courier: CourierDiagnostics | null;
  population: number;
  /** Names of the scene's top-level parts (town, Lanternfall, launchers and gates, courier...), so tests can see what is drawn. */
  parts: string[];
};
export type CitySceneOptions = { onPick: (district: number | null) => void; onError: (message: string) => void; onCourierHud?: (hud: CourierHud) => void };
type CourierDebug = { teleportToObjective(): void; teleportTo(x: number, z: number): void };
type CityWindow = Window & { __CLOCKWORK_CITY__?: () => CityDiagnostics; __CLOCKWORK_COURIER__?: CourierDebug; render_game_to_text?: () => string };
/** The OrbitControls settings the courier camera changes; they are put back when play ends. */
type ControlsSettings = Pick<OrbitControls, "enablePan" | "minDistance" | "maxDistance" | "maxPolarAngle" | "autoRotate" | "enabled">;
type Pose = { position: THREE.Vector3; target: THREE.Vector3 };
/** Flights run on wall-clock time, so a slow frame rate never stretches them out. */
type Flight = { from: THREE.Spherical; to: THREE.Spherical; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; startedAt: number; durationMs: number };

// The title view sits low enough to show the rock the town floats on.
const TITLE_TARGET = new THREE.Vector3(0, 0, 0);
const TITLE_RADIUS = 600;
const TITLE_POLAR = 1.14;
const OVERVIEW_TARGET = new THREE.Vector3(0, 20, 0);
const OVERVIEW_RADIUS = 520;
const OVERVIEW_POLAR = 1.08;
/** Camera flights swing around this point, so they never pass through the tower. */
const FLIGHT_PIVOT = new THREE.Vector3(0, 40, 0);
/** On wide screens the title view slides the town right, clear of the title card. */
const TITLE_SHIFT = -0.2;
/** The courier HUD is republished at most this often (seconds of frame time). */
const HUD_INTERVAL = 0.1;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Half-size of the sun's shadow square: tight and crisp around the courier, wider in flight, the whole island otherwise. */
const SHADOW_REACH = { walk: 55, fly: 100, town: 210 } as const;
/** Seconds between shadow redraws when nothing but the clockwork moves. */
const SHADOW_REFRESH = 0.1;
/**
 * The ink: drawn lines (see @clockwork/render LineStyle) graded through the London look-up table, boiling about a
 * pixel on eights over the town. Fades, tint, weight and haze follow the camera between town and street (atmosphere.ts).
 */
const LINE_STYLE = { lines: "drawn", grade: 0, lut: 1, boil: 0.9 } as const;
/** Toward the sun: a mid-morning sun from the south-east-ish, low enough for long, graphic shadows. */
const SUN_DIRECTION = new THREE.Vector3(0.52, 0.6, 0.6);

export class CityScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: IllustratedComposer;
  private readonly world = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 2, 7000);
  private readonly controls: OrbitControls;
  private readonly city: BuiltCity;
  private readonly layout = createCityLayout();
  /** Every part that turns one tick per second: the town's gears plus Lanternfall's rim gear and lamp. */
  private readonly spinners: Spinner[];
  private readonly spinBase: number[];
  private readonly anchorBase: number;
  private readonly clock = new THREE.Clock();
  private readonly sun = new Sun();
  private readonly sky = new Sky();
  private readonly ambient: BuiltAmbient;
  private readonly residents: BuiltResidents;
  private readonly focus = new THREE.Vector3();
  private elapsed = 0;
  private shadowAge = 0;
  private shadowDrawn = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly debug: (() => CityDiagnostics) | null;
  private readonly textState = () => JSON.stringify({
    coordinates: "island-local; origin at the central square; +Y up, north -Z, east +X",
    ...this.diagnostics(),
    objective: null,
  });
  private mode: CityMode = "title";
  private focused: number | null = null;
  private flight: Flight | null = null;
  private reducedMotion = false;
  private frame = 0;
  private pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  private fpsSamples: number[] = [];
  private minuteShown = -1;
  /** View offset as a fraction of the screen; eased toward its target. */
  private shift = { x: TITLE_SHIFT, y: 0 };
  private shiftTarget = { x: TITLE_SHIFT, y: 0 };
  private size = { width: 1, height: 1 };
  private courier: CourierController | null = null;
  private savedControls: ControlsSettings | null = null;
  private hudElapsed = 0;
  private courierDebug: CourierDebug | null = null;
  private pointerStart: { x: number; y: number } | null = null;
  private stats = { calls: 0, triangles: 0 };
  /** The finished look's colour grade, owned here (the composer only borrows it). */
  private readonly gradeLut = createGradeLut(londonGrade);
  /** 0 = the town look, 1 = the street look; eased toward the camera's situation (see atmosphere.ts). */
  private streetLook = 0;

  constructor(private readonly container: HTMLElement, private readonly options: CitySceneOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    const canvas = this.renderer.domElement;
    try {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.setClearColor(0x75bdc3, 1);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      // Redrawn when something worth shadowing moves (see fitSun), not blindly every frame.
      this.renderer.shadowMap.autoUpdate = false;
      // The composer renders twice per frame; reset by hand so the totals cover the whole frame.
      this.renderer.info.autoReset = false;
      canvas.setAttribute("aria-label", "Little London island. Drag to look around; arrow keys circle the island.");
      canvas.tabIndex = 0;
      container.appendChild(canvas);
      this.composer = new IllustratedComposer(this.renderer);
      // Drawn lines in a dark slate ink, and the whole image regraded through the London table.
      this.composer.setStyle(LINE_STYLE);
      this.composer.setInk(new THREE.Color(INK));
      this.composer.setGradeLut(this.gradeLut);
      this.applyLook();
      // The painted dome is the sky; the far fog matches its horizon so distant islands melt into it.
      this.world.add(this.sky.dome);
      illustratedEnvironment.uFogFar.value.set(SKY_COLORS.horizon);
      illustratedEnvironment.uFogNear.value.set(FOG_NEAR);
      illustratedEnvironment.uSkyLight.value.copy(SKY_LIGHT);
      illustratedEnvironment.uGroundLight.value.copy(GROUND_LIGHT);
      this.city = buildCity(this.layout);
      this.world.add(this.city.group);
      // Lanternfall, the home launcher and both landing gates share the town's palette, so they cost no new surface ids.
      const outposts = this.layout.plan ? [] : [buildLanternfall(this.city.palette), buildLaunchersAndGates(this.city.palette)];
      for (const outpost of outposts) this.world.add(outpost.group);
      for (const root of [this.city.group, ...outposts.map((outpost) => outpost.group)]) enableShadows(root);
      // Grass, pennants, birds and chimney smoke (their own shadow settings: only the pennants cast).
      this.ambient = buildAmbient(this.city.palette, createHillTownWalkWorld(this.layout), this.layout);
      this.world.add(this.ambient.group);
      this.residents = buildResidents(this.city.palette, this.layout);
      this.world.add(this.residents.group);
      this.world.add(...this.sun.objects);
      illustratedEnvironment.uSunDirection.value.copy(SUN_DIRECTION);
      this.spinners = [...this.city.spinners, ...outposts.flatMap((outpost) => outpost.spinners)];
      this.spinBase = this.spinners.map((spinner) => spinner.object.rotation[spinner.axis]);
      this.anchorBase = this.city.anchor?.rotation.z ?? 0;
      this.camera.position.setFromSphericalCoords(TITLE_RADIUS * this.reach(), TITLE_POLAR, -0.8).add(TITLE_TARGET);
      this.controls = new OrbitControls(this.camera, canvas);
      Object.assign(this.controls, {
        enableDamping: true, dampingFactor: 0.08, minDistance: 35, maxDistance: 800, minPolarAngle: 0.3, maxPolarAngle: 1.36,
        screenSpacePanning: false, rotateSpeed: 0.6, zoomSpeed: 0.8, panSpeed: 0.6, autoRotateSpeed: 0.35,
      });
      this.controls.target.copy(TITLE_TARGET);
    } catch (error) {
      this.renderer.dispose();
      canvas.remove();
      throw error;
    }
    this.controls.addEventListener("start", this.cancelFlight);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.debug = new URLSearchParams(window.location.search).get("debug") === "1" ? () => this.diagnostics() : null;
    (window as CityWindow).render_game_to_text = this.textState;
    if (this.debug) {
      this.courierDebug = this.createCourierDebug();
      (window as CityWindow).__CLOCKWORK_CITY__ = this.debug;
      (window as CityWindow).__CLOCKWORK_COURIER__ = this.courierDebug;
    }
    this.applyMode();
    this.resize();
    this.shift = { ...this.shiftTarget };
    this.applyShift();
    this.animate();
  }

  get canvas() { return this.renderer.domElement; }

  setMode(mode: CityMode) {
    if (mode === this.mode) return;
    const previous = this.mode;
    const previousFocus = this.focused;
    const leavingPlay = previous === "play";
    this.mode = mode;
    this.focused = null;
    if (mode === "play") {
      try {
        this.enterPlay();
      } catch (error) {
        this.abandonPlay(previous, previousFocus, error);
        return;
      }
      this.applyMode();
      // The courier camera is not offset sideways, so there is no slide from the title's shifted view.
      this.shift = { ...this.shiftTarget };
      this.applyShift();
      return;
    }
    if (leavingPlay) this.leavePlay();
    this.applyMode();
    this.flyTo(mode === "title"
      ? this.orbitPose(TITLE_RADIUS * this.reach(), TITLE_POLAR, TITLE_TARGET)
      : this.orbitPose(OVERVIEW_RADIUS * this.reach(), OVERVIEW_POLAR, OVERVIEW_TARGET));
  }

  /** Restart the round; only meaningful while playing. */
  restartRound() {
    if (this.mode !== "play" || !this.courier) return;
    this.courier.start();
    this.hudElapsed = 0;
    this.options.onCourierHud?.(this.courier.hud());
  }

  /** Starting play threw: put the scene back as it was and tell the player. */
  private abandonPlay(previous: CityMode, previousFocus: number | null, error: unknown) {
    try { this.courier?.dispose(); } catch { /* the controller is being discarded */ }
    this.courier = null;
    if (this.savedControls) Object.assign(this.controls, this.savedControls);
    this.savedControls = null;
    this.mode = previous;
    this.focused = previousFocus;
    this.applyMode();
    this.options.onError(`Could not start the round: ${error instanceof Error ? error.message : String(error)}`);
  }

  private createCourierDebug(): CourierDebug {
    return {
      teleportToObjective: () => { if (this.mode === "play") this.courier?.teleportToObjective(); },
      teleportTo: (x, z) => { if (this.mode === "play") this.courier?.teleportTo(x, z); },
    };
  }

  /** Pause or resume courier input (guide open, round complete). A no-op without a controller. */
  setCourierSuspended(suspended: boolean): void {
    this.courier?.setSuspended(suspended);
  }

  private enterPlay() {
    const controls = this.controls;
    this.flight = null;
    this.savedControls = {
      enablePan: controls.enablePan, minDistance: controls.minDistance, maxDistance: controls.maxDistance,
      maxPolarAngle: controls.maxPolarAngle, autoRotate: controls.autoRotate, enabled: controls.enabled,
    };
    this.courier ??= new CourierController({
      layout: this.layout,
      freeRoam: !!this.layout.plan,
      world: this.world, camera: this.camera, controls, palette: this.city.palette, canvas: this.canvas, reducedMotion: () => this.reducedMotion,
    });
    this.hudElapsed = 0;
    this.courier.start();
  }

  private leavePlay() {
    this.courier?.stop();
    if (this.savedControls) Object.assign(this.controls, this.savedControls);
    this.savedControls = null;
  }

  /** One frame of play: the courier moves and the camera follows; the HUD is published at most ten times a second. */
  private stepPlay(dt: number) {
    // The courier controller owns the camera in play (its follow camera while walking, the chase camera in flight)
    // and switches the orbit controls off. Updating them here would fight it, and the town clamp (r 430) would drag
    // the view off a courier standing at the launcher (r 444).
    this.courier?.update(dt);
    this.hudElapsed += dt;
    if (this.hudElapsed >= HUD_INTERVAL) {
      this.hudElapsed -= HUD_INTERVAL;
      // A long frame must not queue a burst of publishes.
      if (this.hudElapsed >= HUD_INTERVAL) this.hudElapsed = 0;
      if (this.courier) this.options.onCourierHud?.(this.courier.hud());
    }
  }

  /** Fly to a district, or back to the whole town with null. */
  focusDistrict(index: number | null) {
    if (this.mode !== "explore") return;
    this.focused = index;
    this.updateShiftTarget();
    this.flyTo(index === null ? this.orbitPose(OVERVIEW_RADIUS * this.reach(), OVERVIEW_POLAR, OVERVIEW_TARGET) : this.districtPose(index));
  }

  /** Portrait screens see less sideways, so every preset view stands further back there. */
  private reach(): number {
    return this.container.clientWidth < this.container.clientHeight ? 1.5 : 1;
  }

  setReducedMotion(value: boolean) {
    this.reducedMotion = value;
    this.applyMode();
    if (value && this.flight) { this.flight.startedAt = -Infinity; this.stepFlight(performance.now()); }
  }

  setDebugView(view: DebugView) { this.composer.setDebugView(view); }

  nudge(direction: Nudge) {
    if (this.mode !== "explore") return;
    this.flight = null;
    const spherical = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    if (direction === "left") spherical.theta -= 0.12;
    if (direction === "right") spherical.theta += 0.12;
    if (direction === "up") spherical.phi -= 0.06;
    if (direction === "down") spherical.phi += 0.06;
    if (direction === "in") spherical.radius *= 0.88;
    if (direction === "out") spherical.radius /= 0.88;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi, this.controls.minPolarAngle, this.controls.maxPolarAngle);
    spherical.radius = THREE.MathUtils.clamp(spherical.radius, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.setFromSpherical(spherical).add(this.controls.target);
    this.controls.update();
  }

  diagnostics(): CityDiagnostics {
    return { mode: this.mode, focused: this.focused, calls: this.stats.calls, triangles: this.stats.triangles,
      population: this.residents.agents.length,
      camera: this.camera.position.toArray(), target: this.controls.target.toArray(), courier: this.courierDiagnostics(),
      parts: this.world.children.map((child) => child.name).filter((name) => name.length > 0) };
  }

  private courierDiagnostics(): CourierDiagnostics | null {
    if (this.mode !== "play" || !this.courier) return null;
    const { mode, position, task, prompt } = this.courier.snapshot();
    return { mode, position: [position.x, position.y, position.z], taskId: this.layout.plan ? null : task.taskId, stepIndex: this.layout.plan ? 0 : task.stepIndex, done: this.layout.plan ? false : task.done, prompt: this.layout.plan ? null : prompt, motion: this.courier.motion() };
  }

  private applyMode() {
    if (this.mode === "play") {
      // The courier controller owns the camera and the controls while playing.
      this.updateShiftTarget();
      this.applyShift();
      return;
    }
    this.controls.enabled = this.mode === "explore";
    this.controls.autoRotate = this.mode === "title" && !this.reducedMotion;
    // The title camera stands further back than anyone may zoom out while exploring.
    this.controls.maxDistance = this.layout.plan ? (this.mode === "title" ? 1000 : 800) : (this.mode === "title" ? 2600 : 1800);
    this.updateShiftTarget();
    this.applyShift();
  }

  private updateShiftTarget() {
    const { width } = this.size;
    const narrow = width < 700;
    this.shiftTarget = {
      // Wide title: slide the town right of the title card.
      x: this.mode === "title" && width >= 900 ? TITLE_SHIFT : 0,
      // Lift a focused landmark above its district card; on phones, drop the title town below the title card.
      y: this.mode === "title" ? (narrow ? -0.04 : 0) : this.focused !== null ? (narrow ? 0.2 : 0.12) : 0,
    };
    if (this.reducedMotion) this.shift = { ...this.shiftTarget };
  }

  private applyShift() {
    const { width, height } = this.size;
    if (Math.abs(this.shift.x) < 0.0005 && Math.abs(this.shift.y) < 0.0005) {
      this.shift = { x: 0, y: 0 };
      if (this.camera.view?.enabled) this.camera.clearViewOffset();
    } else {
      this.camera.setViewOffset(width, height, this.shift.x * width, this.shift.y * height, width, height);
    }
  }

  private orbitPose(radius: number, polar: number, target: THREE.Vector3): Pose {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const azimuth = Math.atan2(offset.x, offset.z);
    return { position: new THREE.Vector3().setFromSphericalCoords(radius, polar, azimuth).add(target), target: target.clone() };
  }

  /** Look at a district from just outside it, with the clock tower behind. */
  private districtPose(index: number): Pose {
    const point = this.city.focusPoints[index];
    if (!point) return this.orbitPose(OVERVIEW_RADIUS, OVERVIEW_POLAR, OVERVIEW_TARGET);
    const rotation = this.layout.landmarks[index]?.rotation;
    const outward = rotation === undefined ? new THREE.Vector3(point.x, 0, point.z).normalize()
      : new THREE.Vector3(Math.sin(rotation), 0, Math.cos(rotation));
    const reach = this.reach();
    const target = point.clone().addScaledVector(outward, -12).add(new THREE.Vector3(0, 6, 0));
    return { position: target.clone().addScaledVector(outward, 85 * reach).add(new THREE.Vector3(0, 55 * reach, 0)), target };
  }

  private flyTo(pose: Pose) {
    if (this.reducedMotion) {
      this.flight = null;
      this.camera.position.copy(pose.position);
      this.controls.target.copy(pose.target);
      this.controls.update();
      return;
    }
    const from = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(FLIGHT_PIVOT));
    const to = new THREE.Spherical().setFromVector3(pose.position.clone().sub(FLIGHT_PIVOT));
    to.theta = from.theta + THREE.MathUtils.euclideanModulo(to.theta - from.theta + Math.PI, Math.PI * 2) - Math.PI;
    this.flight = { from, to, fromTarget: this.controls.target.clone(), toTarget: pose.target.clone(), startedAt: performance.now(), durationMs: 1500 };
  }

  private stepFlight(now: number) {
    const flight = this.flight;
    if (!flight) return;
    const t = easeInOut(THREE.MathUtils.clamp((now - flight.startedAt) / flight.durationMs, 0, 1));
    const lerp = THREE.MathUtils.lerp;
    const spherical = new THREE.Spherical(lerp(flight.from.radius, flight.to.radius, t), lerp(flight.from.phi, flight.to.phi, t), lerp(flight.from.theta, flight.to.theta, t));
    this.camera.position.setFromSpherical(spherical).add(FLIGHT_PIVOT);
    this.controls.target.lerpVectors(flight.fromTarget, flight.toTarget, t);
    this.camera.lookAt(this.controls.target);
    if (t >= 1) { this.flight = null; this.controls.update(); }
  }

  private cancelFlight = () => { this.flight = null; };

  private keepTargetInTown() {
    const target = this.controls.target;
    const radius = Math.hypot(target.x, target.z);
    if (radius > 430) { target.x *= 430 / radius; target.z *= 430 / radius; }
    target.y = THREE.MathUtils.clamp(target.y, 0, 150);
  }

  private onPointerDown = (event: PointerEvent) => {
    this.pointerStart = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  };

  private onPointerUp = (event: PointerEvent) => {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || this.mode !== "explore" || event.button !== 0) return;
    // A drag looks around; only a still click picks a district.
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.city.pickables, false)[0];
    if (!hit) return;
    const district = districtAt(hit.point.x, hit.point.z);
    this.focusDistrict(district);
    this.options.onPick(district);
  };

  /** Hands move once a minute; every gear moves one tick per second. */
  private updateClockwork(now: number) {
    if (this.layout.plan) return;
    const minute = Math.floor(now / 60_000);
    if (minute !== this.minuteShown) {
      this.minuteShown = minute;
      const angles = handAngles(new Date(now));
      const previous = this.city.hands.geometry;
      this.city.hands.geometry = handsGeometry(this.city.faces, angles.hour, angles.minute);
      previous.dispose();
    }
    if (this.reducedMotion) return;
    const cycle = cycleMs(now);
    const ticks = tickValue(cycle);
    this.spinners.forEach((spinner, index) => {
      spinner.object.rotation[spinner.axis] = (this.spinBase[index] ?? 0) + ticks * spinner.step;
    });
    if (this.city.anchor) this.city.anchor.rotation.z = this.anchorBase + anchorSwing(cycle);
  }

  private animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.2);
    if (this.mode === "play") this.stepPlay(dt);
    else if (this.flight) this.stepFlight(performance.now());
    else { this.controls.update(dt); if (this.mode === "explore") this.keepTargetInTown(); }
    if (this.shift.x !== this.shiftTarget.x || this.shift.y !== this.shiftTarget.y) {
      const ease = 1 - Math.exp(-5 * dt);
      for (const axis of ["x", "y"] as const) {
        this.shift[axis] += (this.shiftTarget[axis] - this.shift[axis]) * ease;
        if (Math.abs(this.shift[axis] - this.shiftTarget[axis]) < 0.0005) this.shift[axis] = this.shiftTarget[axis];
      }
      this.applyShift();
    }
    this.updateClockwork(Date.now());
    if (!this.reducedMotion) this.elapsed += dt;
    illustratedEnvironment.uTime.value = this.elapsed;
    this.ambient.update(this.elapsed, tickValue(cycleMs(Date.now())), this.reducedMotion);
    this.residents.update(this.elapsed, this.reducedMotion, this.camera.position);
    this.fitSun(dt);
    if (!this.reducedMotion) this.city.clouds.rotation.y += dt * 0.006;
    this.renderer.info.reset();
    this.sky.update(this.camera, this.elapsed, this.pixelRatio);
    // The scene clock stops under reduced motion, so the line boil holds still with it.
    this.composer.setTime(this.elapsed);
    // Stable ink while walking: the deliberate eight-frame line boil otherwise looks like motion judder.
    this.composer.setStyle({ boil: this.mode === "play" ? 0 : LINE_STYLE.boil });
    this.easeLook(dt);
    this.composer.render(this.world, this.camera, [{ scene: this.sky.overlay, camera: this.camera }]);
    this.stats = { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
    this.adaptResolution(rawDt);
  };

  /** Ease the air and the ink toward the street look while walking, and the town look otherwise (atmosphere.ts). */
  private easeLook(dt: number) {
    const target = this.mode === "play" && this.courier?.mode === "walk" ? 1 : 0;
    if (this.streetLook === target) return;
    const step = this.reducedMotion ? 1 : 1 - Math.exp(-ATMOSPHERE_RATE * Math.max(0, dt));
    this.streetLook += (target - this.streetLook) * step;
    if (Math.abs(this.streetLook - target) < 0.002) this.streetLook = target;
    this.applyLook();
  }

  private applyLook() {
    const look = blendLook(this.streetLook);
    illustratedEnvironment.uFogDensity.value = look.fogDensity;
    this.composer.setStyle(look.line);
    this.composer.setThickness(look.thickness);
  }

  /** Shadows where they matter: around the courier (or the plane) while playing, over the whole island otherwise. */
  private fitSun(dt: number) {
    const playing = this.mode === "play" && this.courier !== null;
    if (playing) {
      this.courier!.focusPoint(this.focus);
      this.sun.follow(this.focus, this.courier!.mode === "fly" ? SHADOW_REACH.fly : SHADOW_REACH.walk);
    } else {
      this.sun.follow(this.focus.set(0, 0, 0), SHADOW_REACH.town);
    }
    // While playing the courier (or plane) moves every frame. Over the town only gears and pennants move, once a
    // tick at most, so a few refreshes a second are plenty.
    this.shadowAge += dt;
    if (playing || this.shadowAge >= SHADOW_REFRESH || !this.shadowDrawn) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowAge = 0;
      this.shadowDrawn = true;
    }
  }

  private adaptResolution(dt: number) {
    this.fpsSamples.push(dt > 0 ? 1 / dt : 60);
    if (this.fpsSamples.length < 120) return;
    const average = this.fpsSamples.reduce((sum, value) => sum + value, 0) / this.fpsSamples.length;
    this.fpsSamples.length = 0;
    const ceiling = Math.min(window.devicePixelRatio || 1, 1.5);
    const next = average < 42 ? Math.max(0.65, this.pixelRatio - 0.1) : average > 57 ? Math.min(ceiling, this.pixelRatio + 0.05) : this.pixelRatio;
    if (next !== this.pixelRatio) { this.pixelRatio = next; this.renderer.setPixelRatio(next); this.resize(); }
  }

  private resize = () => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.size = { width, height };
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.resize(width, height, this.pixelRatio);
    this.updateShiftTarget();
    this.applyShift();
  };

  private onVisibility = () => { if (document.hidden) this.clock.stop(); else this.clock.start(); };

  private onContextLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(this.frame);
    this.courier?.stop();
    this.options.onError("The graphics context was lost. Reload the page to see the town again.");
  };

  dispose() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    const canvas = this.canvas;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.controls.removeEventListener("start", this.cancelFlight);
    // A throwing controller must not leak the renderer, the canvas or the debug hooks below.
    try { this.courier?.dispose(); } catch (error) { console.warn("Courier cleanup failed", error); }
    this.courier = null;
    this.controls.dispose();
    const materials = new Set<THREE.Material>();
    this.world.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    materials.forEach((material) => material.dispose());
    this.sun?.dispose();
    this.sky?.dispose();
    resetIllustratedEnvironment();
    this.residents.dispose();
    this.composer.dispose();
    this.gradeLut.dispose();
    this.renderer.dispose();
    canvas.remove();
    const target = window as CityWindow;
    if (this.debug && target.__CLOCKWORK_CITY__ === this.debug) delete target.__CLOCKWORK_CITY__;
    if (target.render_game_to_text === this.textState) delete target.render_game_to_text;
    if (this.courierDebug && target.__CLOCKWORK_COURIER__ === this.courierDebug) delete target.__CLOCKWORK_COURIER__;
  }
}
