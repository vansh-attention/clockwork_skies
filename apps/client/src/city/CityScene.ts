import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { IllustratedComposer, type DebugView } from "@clockwork/render";
import { buildCity, handsGeometry, type BuiltCity } from "./buildCity";
import { anchorSwing, cycleMs, handAngles, tickValue } from "./clockwork";
import { districtAt } from "./layout";

export type CityMode = "title" | "explore";
export type Nudge = "left" | "right" | "up" | "down" | "in" | "out";
export type CityDiagnostics = { mode: CityMode; focused: number | null; calls: number; triangles: number; camera: number[]; target: number[] };
export type CitySceneOptions = { onPick: (district: number | null) => void; onError: (message: string) => void };
type CityWindow = Window & { __CLOCKWORK_CITY__?: () => CityDiagnostics };
type Pose = { position: THREE.Vector3; target: THREE.Vector3 };
/** Flights run on wall-clock time, so a slow frame rate never stretches them out. */
type Flight = { from: THREE.Spherical; to: THREE.Spherical; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; startedAt: number; durationMs: number };

// The title view sits low enough to show the rock the town floats on.
const TITLE_TARGET = new THREE.Vector3(0, -60, 0);
const TITLE_RADIUS = 1420;
const TITLE_POLAR = 1.14;
const OVERVIEW_TARGET = new THREE.Vector3(0, 20, 0);
const OVERVIEW_RADIUS = 1080;
const OVERVIEW_POLAR = 1.08;
/** Camera flights swing around this point, so they never pass through the tower. */
const FLIGHT_PIVOT = new THREE.Vector3(0, 40, 0);
/** On wide screens the title view slides the town right, clear of the title card. */
const TITLE_SHIFT = -0.2;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class CityScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: IllustratedComposer;
  private readonly world = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 2, 7000);
  private readonly controls: OrbitControls;
  private readonly city: BuiltCity;
  private readonly spinBase: number[];
  private readonly anchorBase: number;
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly debug: (() => CityDiagnostics) | null;
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
  private pointerStart: { x: number; y: number } | null = null;
  private stats = { calls: 0, triangles: 0 };

  constructor(private readonly container: HTMLElement, private readonly options: CitySceneOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    const canvas = this.renderer.domElement;
    try {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.setClearColor(0x75bdc3, 1);
      // The composer renders twice per frame; reset by hand so the totals cover the whole frame.
      this.renderer.info.autoReset = false;
      canvas.setAttribute("aria-label", "Clockwork Skies hill town. Drag to look around; arrow keys circle the town.");
      canvas.tabIndex = 0;
      container.appendChild(canvas);
      this.composer = new IllustratedComposer(this.renderer);
      this.composer.setThickness(1.15);
      this.world.background = new THREE.Color(0x75bdc3);
      this.city = buildCity();
      this.world.add(this.city.group);
      this.spinBase = this.city.spinners.map((spinner) => spinner.object.rotation[spinner.axis]);
      this.anchorBase = this.city.anchor.rotation.z;
      this.camera.position.setFromSphericalCoords(TITLE_RADIUS * this.reach(), TITLE_POLAR, -0.8).add(TITLE_TARGET);
      this.controls = new OrbitControls(this.camera, canvas);
      Object.assign(this.controls, {
        enableDamping: true, dampingFactor: 0.08, minDistance: 150, maxDistance: 1800, minPolarAngle: 0.3, maxPolarAngle: 1.36,
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
    if (this.debug) (window as CityWindow).__CLOCKWORK_CITY__ = this.debug;
    this.applyMode();
    this.resize();
    this.shift = { ...this.shiftTarget };
    this.applyShift();
    this.animate();
  }

  get canvas() { return this.renderer.domElement; }

  setMode(mode: CityMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.focused = null;
    this.applyMode();
    this.flyTo(mode === "title"
      ? this.orbitPose(TITLE_RADIUS * this.reach(), TITLE_POLAR, TITLE_TARGET)
      : this.orbitPose(OVERVIEW_RADIUS * this.reach(), OVERVIEW_POLAR, OVERVIEW_TARGET));
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
      camera: this.camera.position.toArray(), target: this.controls.target.toArray() };
  }

  private applyMode() {
    this.controls.enabled = this.mode === "explore";
    this.controls.autoRotate = this.mode === "title" && !this.reducedMotion;
    // The title camera stands further back than anyone may zoom out while exploring.
    this.controls.maxDistance = this.mode === "title" ? 2600 : 1800;
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
      y: this.mode === "title" ? (narrow ? -0.2 : 0) : this.focused !== null ? (narrow ? 0.2 : 0.12) : 0,
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
    const outward = new THREE.Vector3(point.x, 0, point.z).normalize();
    const reach = this.reach();
    const target = point.clone().addScaledVector(outward, -12).add(new THREE.Vector3(0, 6, 0));
    return { position: target.clone().addScaledVector(outward, 230 * reach).add(new THREE.Vector3(0, 140 * reach, 0)), target };
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
    this.city.spinners.forEach((spinner, index) => {
      spinner.object.rotation[spinner.axis] = (this.spinBase[index] ?? 0) + ticks * spinner.step;
    });
    this.city.anchor.rotation.z = this.anchorBase + anchorSwing(cycle);
  }

  private animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.flight) this.stepFlight(performance.now());
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
    if (!this.reducedMotion) this.city.clouds.rotation.y += dt * 0.006;
    this.renderer.info.reset();
    this.composer.render(this.world, this.camera);
    this.stats = { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
    this.adaptResolution(dt);
  };

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
    this.controls.dispose();
    const materials = new Set<THREE.Material>();
    this.world.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    materials.forEach((material) => material.dispose());
    this.composer.dispose();
    this.renderer.dispose();
    canvas.remove();
    const target = window as CityWindow;
    if (this.debug && target.__CLOCKWORK_CITY__ === this.debug) delete target.__CLOCKWORK_CITY__;
  }
}
