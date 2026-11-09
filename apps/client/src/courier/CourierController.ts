import * as THREE from "three";
import { MATCH_RULES } from "@clockwork/shared";
import type { Vec3 } from "@clockwork/shared";
import { enableShadows, type MaterialSource } from "../city/kit";
import { cycleMs, tickValue } from "../city/clockwork";
import { DISTRICTS } from "../city/districts";
import { createCityLayout, createHillTownLayout, polarToXZ, type CityLayout } from "../city/layout";
import { fitIndicator } from "../hudMarker";
import { createPlaneModel } from "../planeModel";
import { FixedClock } from "../space/clock";
import { easeFactor, fit, lerp, lerpFPS, shortestAngle, stepSpring, type Spring } from "../motion/ease";
import { animateBeacon, animateCourier, animateHuman, createBeacon, createCourierModel, disposeModel, type CourierModel } from "./models";
import { createFigurePose } from "./figure";
import { createHumanGait, humanPose, relaxPose, resetHumanGait, updateHumanGait } from "./humanGait";
import { FlightInputLatch, NEUTRAL_FLIGHT } from "./flightInput";
import {
  HOME_GATE, HOME_PAD, KEEPER_DOOR, LANTERNFALL_CENTER, LANTERNFALL_GATE, LANTERNFALL_PAD,
  createHomeWalkWorld, createLanternfallCameraWorld, createLanternfallWalkWorld, gateCrossed, launchRelease, launcherBox, skyWorld,
  type Gate, type Pad,
} from "./outpost";
import { createSkyPlane, stepSkyPlane, type FlightInput, type SkyPlane } from "./skyFlight";
import {
  LANDING_SPEED, TASKS, TaskRunner,
  type Anchor, type AnchorId, type CourierMode, type IslandId, type StepKind, type TaskEvent, type TaskDef, type TaskSnapshot, type TaskStep,
} from "./tasks";
import { WALK, createWalker, stepWalker, type Walker } from "./walker";
import { createGait, createPose, gaitPose, resetGait, updateGait } from "./gait";
import { createHomeCameraWorld, type CameraWorld } from "./cameraWorld";
import { createDust, type Dust } from "./dust";
import { FOLLOW, FollowCamera, attachFollowInput, type FollowSubject } from "./followCamera";
import { createHillTownWalkWorld, type WalkWorld } from "./walkWorld";

/**
 * The walking half of the courier controller: it owns the courier model, the task beacon, the follow camera and the
 * task runner, and feeds them from keyboard input. In fly mode it also owns the plane, the flight input and the chase camera.
 */

export type WalkKeys = {
  /** −1..1 each: W/S or ↑/↓ forward, D/A or →/← strafe; Shift runs. */
  readonly forward: number;
  readonly strafe: number;
  readonly run: boolean;
  /** The wall-clock time (ms) of the oldest unread E press, or null when there is none; reading it clears it. */
  takeInteract(): number | null;
  /** Whether Space was pressed since the last read; reading it clears it. Optional: without it the courier never jumps. */
  takeJump?(): boolean;
};

/** x/y are percentages of the canvas; `bearing` is degrees with 0 = up, for an edge arrow. */
/** Diagnostics (see CourierController.motion): simulated speed and the drawn gait. */
export type CourierMotion = { speed: number; phase: number; move: number; walk: number; jog: number; run: number };
export type MarkerState = { visible: boolean; x: number; y: number; offscreen: boolean; bearing: number; distance: number };
export type Feedback = { text: string; tone: "good" | "warn" | "info" };
/** The flight readout; null while walking. */
export type FlightHud = {
  speed: number;
  altitude: number;
  boost: number;
  boostLocked: boolean;
  /** Distance to the gate the plane is heading for: the task's land gate, or the other island's gate in free flight. */
  gateDistance: number;
  landingSpeed: number;
  tooFast: boolean;
  pointerLocked: boolean;
  turningBack: boolean;
};
export type CourierHud = {
  mode: CourierMode;
  task: TaskSnapshot;
  marker: MarkerState;
  feedback: Feedback | null;
  /** The interaction hint now: the task's prompt, else the free-flight prompt near the pad, else null. */
  prompt: string | null;
  flight: FlightHud | null;
};

/** What the controller needs from the flight controls (a FlightInputLatch fits). */
export type FlightInputLike = { enable(): void; disable(): void; latest(): Readonly<FlightInput> };

export type ControlsLike = {
  target: THREE.Vector3;
  update(dt?: number): unknown;
  enabled: boolean;
  enablePan: boolean;
  minDistance: number;
  maxDistance: number;
  maxPolarAngle: number;
  autoRotate: boolean;
};

/** Her body against other people, as a share of her collision radius (WALK.radius 1.5: 0.45). */
const PERSON_BODY = 0.3;

export type CourierControllerOptions = {
  /** A walking experience, without the retired clock and flight quest loop. */
  freeRoam?: boolean;
  world: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: ControlsLike;
  /** The city's shared palette (the courier and beacon reuse its materials). */
  palette: MaterialSource;
  /** The canvas that receives flight input and pointer lock; used for the default flight input. */
  canvas?: HTMLElement;
  /** Default: a FlightInputLatch on `canvas`, or neutral controls when there is no canvas. */
  flightInput?: FlightInputLike;
  /** Default: createCityLayout(). Used for the task anchors. */
  layout?: CityLayout;
  /** Default: createHomeWalkWorld() (the hill town plus the home launcher's uprights). */
  walkWorld?: WalkWorld;
  /**
   * People in the home town (world coordinates): whether a body of `radius` at (x, z) would touch one. The courier
   * walks round them; only her own step uses it (not the camera, the task anchors or the spawn).
   */
  people?: (x: number, z: number, radius: number) => boolean;
  /** Default: a DOM keyboard reader attached in start() and removed in stop(), only when `window` exists. */
  keys?: WalkKeys;
  /** Wall-clock milliseconds; default Date.now. Task timing (tick presses) uses this clock. */
  now?: () => number;
  reducedMotion?: () => boolean;
};

const SPAWN_RADIUS = 50;
/** West of the clock tower (bearing 270 degrees, clockwise from north), facing west. */
const SPAWN_BEARING = 270 * Math.PI / 180;
const SPAWN_HEADING = -Math.PI / 2;
const FEEDBACK_MS = 1600;
/** Height above a task target for both the beacon and the HUD marker. */
const TARGET_LIFT = 10;
const MAX_ANIMATION_DT = 0.1;
/** A sudden step in height (a kerb, a stair) is eased out on a critically damped spring this stiff (rad/s). */
const SHOWN_Y_OMEGA = 22;
/** A height change bigger than this is a teleport, not a step, and is shown at once. */
const SHOWN_Y_SNAP = 3;
/** Height changes faster than this (units/s) are steps to ease; anything slower is a slope, followed exactly. */
const SLOPE_RATE = 12;
const STEP_MIN = 0.15;
/** A Space press stays queued this long, so pressing just before touching down still jumps. */
const JUMP_BUFFER_SECONDS = 0.15;
/**
 * Dust puffs, as the reference's footstep particles: none on take-off; a pair on landing; while moving over the ground
 * faster than about half the jog, a try every half second that comes good every other time (the reference tosses a
 * coin), at one foot then the other, a little behind; never more than two in the air at once.
 */
const DUST = {
  landing: 2, landingRadius: 0.35, stepRadius: 0.25, every: 0.5, fromSpeed: 0.55 * WALK.walkSpeed, side: 0.27, back: 0.4, most: 2,
} as const;
/** Teleport spots keep this much height margin inside the anchor's allowed height difference. */
const TELEPORT_DY_MARGIN = 1;
const SPOT_RINGS = 8;
const SPOT_RING_POINTS = 24;
const SPOT_REACH = 0.9;

const NO_FLIGHT_INPUT: FlightInputLike = { enable() {}, disable() {}, latest: () => NEUTRAL_FLIGHT };
const ARC_SECONDS = 1.2;
const ARC_SECONDS_REDUCED = 0.25;
const ARC_PITCH = 0.5;
const PLANE_PAD_LIFT = 1.2;
const NEAR_PAD = 10;
/**
 * How far inward of the pad the courier steps off after landing: far enough that the follow camera, settling about
 * 19 behind the courier, ends up past the launcher arch (6.5 tall, 8 behind the pad) with the arch behind it, not
 * hanging across the bottom of the view.
 */
const LAND_OFFSET = 32;
/**
 * The flight chase camera: `back` behind and `up` above the plane, looking `look` ahead of it. Position eases at
 * k60 (height a little more lazily, so climbs and dives feel floaty), the look point eases too, and in a turn the
 * view leads into it by `turnLead` units per rad/s of yaw rate (at most `turnLeadMax`).
 */
const CHASE = { back: 42, up: 14, look: 30, k60: 0.07, upK60: 0.05, lookK60: 0.2, turnLead: 22, turnLeadMax: 28, turnK60: 0.08 } as const;
const GATE_RUN_UP = 60;
const GATE_RUN_UP_SPEED = 40;
const GATE_RUN_UP_THROTTLE = 0.1;
/** Propeller rad/s at idle and full throttle, plus a boost kick; the spin eases so it spools up and winds down. */
const PROPELLER = { idle: 14, full: 46, boost: 16, k60: 0.06 } as const;
/** The chase camera's field of view widens by up to this many degrees as the plane speeds past cruise. */
const FOV_KICK = 9;
const FOV_K60 = 0.05;
/** The chase camera rolls this fraction of the plane's own roll, so turns feel banked without the horizon spinning. */
const CHASE_ROLL = 0.22;
/** After landing the plane drops onto its pad from this high and settles on a bouncy spring. */
const SETTLE = { drop: 2.4, omega: 9, zeta: 0.42, maxSink: 0.4 } as const;
const DEBOUNCE_MS = { bump: 1000, tooFast: 1000 } as const;
const PLANE_BANK_SCALE = 0.6;
const GATES: readonly Gate[] = [LANTERNFALL_GATE, HOME_GATE];
const ZERO_OFFSET: Readonly<Vec3> = { x: 0, y: 0, z: 0 };

// --- anchors ----------------------------------------------------------------------------------------------------

/** Start on a real pavement with a short clear walk ahead, rather than in a leftover radial plaza/back garden. */
export function chooseIslandSpawn(layout: CityLayout, world: WalkWorld): { x: number; z: number; heading: number } {
  const plan = layout.plan;
  if (!plan) return { ...polarToXZ(SPAWN_BEARING, SPAWN_RADIUS), heading: SPAWN_HEADING };
  // The walk opens mid-block on Kew Road's long straight stretch: a narrow street closed in by terraces on both
  // sides, looking down it, as the reference's walk opens in a narrow lane. Longest straight stretches first, either
  // way along them, on the left-hand pavement first, so the over-the-shoulder camera (which sits to the courier's
  // right) looks across the street rather than into the house fronts.
  const streets = plan.streets.slice().sort((a, b) => {
    const priority = (id: string) => id === "kew-road" ? 0 : id === "long-acre" ? 1 : id === "fleet-street" ? 2 : 3;
    return priority(a.id) - priority(b.id);
  });
  for (const street of streets) {
    const segments = street.points.slice(1).map((_, i) => i + 1);
    const span = (i: number) => Math.hypot(street.points[i]!.x - street.points[i - 1]!.x, street.points[i]!.z - street.points[i - 1]!.z);
    segments.sort((i, j) => span(j) - span(i));
    for (const i of segments) {
      const a = street.points[i - 1]!; const b = street.points[i]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const tx = (b.x - a.x) / length; const tz = (b.z - a.z) / length;
      for (const side of [-1, 1]) for (const [t, way] of [[0.25, 1], [0.75, -1], [0.4, 1], [0.6, -1], [0.65, 1], [0.35, -1]] as const) {
        // Travelling `way` along the segment; `side` −1 is the left-hand pavement.
        const ux = tx * way, uz = tz * way;
        const offset = side * (street.width / 2 + street.pavement / 2);
        const x = a.x + (b.x - a.x) * t - uz * offset;
        const z = a.z + (b.z - a.z) * t + ux * offset;
        let clear = true;
        for (let d = -2; d <= 7; d += 0.5) {
          const px = x + ux * d; const pz = z + uz * d;
          if (!world.surfaceAt(px, pz).walkable || world.blocked(px, pz, WALK.radius)) { clear = false; break; }
        }
        if (clear) return { x, z, heading: Math.atan2(ux, -uz) };
      }
    }
  }
  throw new Error("The London island has no clear pavement spawn");
}

/**
 * The anchors the round uses, in world coordinates. The optional arguments let callers reuse an existing layout and
 * walk world (the controller does); each home anchor's height comes from the walk surface.
 */
export function createAnchors(layout: CityLayout = createHillTownLayout(), walk: WalkWorld = createHillTownWalkWorld(layout)): Record<AnchorId, Anchor> {
  const grounded = (x: number, z: number): Vec3 => ({ x, y: walk.surfaceAt(x, z).height, z });
  /** A landmark's local frame has +Z outward and +X along the street. */
  const inLandmark = (district: number, lx: number, lz: number): Vec3 => {
    const landmark = layout.landmarks[district];
    if (!landmark) throw new RangeError(`createAnchors: no landmark for district ${district} (${DISTRICTS.length} districts)`);
    const rotation = landmark.rotation ?? Math.PI - landmark.bearing;
    const sin = Math.sin(rotation);
    const cos = Math.cos(rotation);
    return grounded(landmark.x + lx * cos + lz * sin, landmark.z - lx * sin + lz * cos);
  };
  return {
    "market-parcel": { island: "home", position: inLandmark(6, 0, 0), radius: 16 },
    "observatory-door": { island: "home", position: inLandmark(1, 0, 19), radius: 8 },
    escapement: { island: "home", position: inLandmark(4, 0, 9), radius: 14 },
    "port-letter": { island: "home", position: inLandmark(2, 0, 0), radius: 12 },
    "home-launcher": { island: "home", position: grounded(HOME_PAD.position.x, HOME_PAD.position.z), radius: 10 },
    "lanternfall-gate": { island: "lanternfall", position: { ...LANTERNFALL_GATE.center }, radius: 24 },
    "keeper-door": { island: "lanternfall", position: { ...KEEPER_DOOR }, radius: 6 },
  };
}

// --- keyboard ---------------------------------------------------------------------------------------------------

const FORWARD_KEYS = ["KeyW", "ArrowUp"];
const BACK_KEYS = ["KeyS", "ArrowDown"];
const RIGHT_KEYS = ["KeyD", "ArrowRight"];
const LEFT_KEYS = ["KeyA", "ArrowLeft"];
const RUN_KEYS = ["ShiftLeft", "ShiftRight"];
const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const HELD_KEYS = new Set([...FORWARD_KEYS, ...BACK_KEYS, ...RIGHT_KEYS, ...LEFT_KEYS, ...RUN_KEYS]);

/** Elements that keep their own keyboard behaviour: form fields, buttons, links, anything with a role, editable text. */
function isIgnoredTarget(target: EventTarget | null): boolean {
  const element = target as { tagName?: unknown; isContentEditable?: unknown; hasAttribute?: (name: string) => boolean } | null;
  if (!element) return false;
  if (element.isContentEditable === true) return true;
  if (typeof element.hasAttribute === "function" && element.hasAttribute("role")) return true;
  return typeof element.tagName === "string" && IGNORED_TAGS.includes(element.tagName.toUpperCase());
}

const IGNORED_TAGS = ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"];

/** Reads W/A/S/D, the arrows, Shift, Space and E from the window. Only attached while the controller is started ("playing"). */
class DomWalkKeys implements WalkKeys {
  private readonly down = new Set<string>();
  private interact: number | null = null;
  private jump = false;
  private suspended = false;

  constructor(private readonly now: () => number) {}

  attach(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.release);
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.release);
    this.release();
  }

  /** While suspended (e.g. a dialog is open) keys are ignored, held keys clear and queued E presses are dropped. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) this.release();
  }

  /** Forget held keys and any queued E press (used when the mode changes). */
  clear(): void { this.release(); }

  get forward(): number { return this.axis(FORWARD_KEYS) - this.axis(BACK_KEYS); }
  get strafe(): number { return this.axis(RIGHT_KEYS) - this.axis(LEFT_KEYS); }
  get run(): boolean { return this.axis(RUN_KEYS) > 0; }

  takeInteract(): number | null {
    const value = this.interact;
    this.interact = null;
    return value;
  }

  takeJump(): boolean {
    const value = this.jump;
    this.jump = false;
    return value;
  }

  private axis(codes: readonly string[]): number {
    return codes.some((code) => this.down.has(code)) ? 1 : 0;
  }

  private release = (): void => {
    this.down.clear();
    this.interact = null;
    this.jump = false;
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.suspended || event.defaultPrevented || event.isComposing) return;
    if (event.ctrlKey || event.metaKey || event.altKey || isIgnoredTarget(event.target)) return;
    const { code } = event;
    if (code === "KeyE") {
      if (!event.repeat && this.interact === null) this.interact = this.now();
    } else if (code === "Space") {
      // Space would scroll the page too.
      event.preventDefault();
      if (!event.repeat) this.jump = true;
    } else if (HELD_KEYS.has(code)) {
      // Arrows would scroll the page; stop that only when the key is actually consumed.
      if (ARROW_KEYS.includes(code)) event.preventDefault();
      this.down.add(code);
    }
  };

  // Releases are never filtered, so a key can't stick if focus or a modifier changed while it was down.
  private onKeyUp = (event: KeyboardEvent): void => {
    this.down.delete(event.code);
  };
}

// --- feedback ---------------------------------------------------------------------------------------------------

type Candidate = { rank: number; feedback: Feedback };

const STEP_TEXT: Readonly<Record<StepKind, string | null>> = {
  pickup: "Picked up", deliver: "Delivered", tick: "Escapement oiled", launch: null, land: null,
};

/**
 * What an event says to the player. When one press produces several events the highest rank wins, so finishing a
 * task reads "<title> complete" rather than the step text. Launch and land steps say nothing themselves; the "landed" event does.
 */
function describeEvent(event: TaskEvent): Candidate | null {
  switch (event.type) {
    case "round-done":
      return { rank: 5, feedback: { text: "Round complete", tone: "good" } };
    case "task-done": {
      const title = TASKS.find((task) => task.id === event.taskId)?.title ?? "Task";
      return { rank: 4, feedback: { text: `${title} complete`, tone: "good" } };
    }
    case "step-done": {
      const kind = TASKS.find((task) => task.id === event.taskId)?.steps[event.stepIndex]?.kind;
      const text = kind ? STEP_TEXT[kind] : null;
      return text ? { rank: 3, feedback: { text, tone: "good" } } : null;
    }
    case "tick-miss":
      return { rank: 2, feedback: { text: "Watch the wheel", tone: "warn" } };
    case "too-fast":
      return { rank: 2, feedback: { text: "Ease the throttle (S) to land", tone: "warn" } };
    case "tick-hit":
      return { rank: 1, feedback: { text: `On the tick (${event.hits}/3)`, tone: "info" } };
    case "landed":
      return { rank: 3, feedback: { text: "Landed", tone: "good" } };
    case "launch":
      return null;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

// --- controller -------------------------------------------------------------------------------------------------

type Pose = { x: number; y: number; z: number; yaw: number; pitch: number; bank: number };
type LaunchArc = { pad: Pad; release: Readonly<Vec3>; elapsed: number; duration: number };

function copyPose(target: Pose, source: Readonly<Pose>): void {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
  target.yaw = source.yaw;
  target.pitch = source.pitch;
  target.bank = source.bank;
}

/** A frame time long enough that every eased value reaches its target: used to snap a camera into place. */
const SNAP_DT = 1e3;

/**
 * The courier dissolves once the camera is closer than `from` to its head, completely by `full` (`most` 1 leaves no
 * fragments: every cell of the dissolve lattice is gone).
 */
const PINNED_FADE = { from: 2.6, full: 1.5, most: 1 } as const;

export class CourierController {
  private currentMode: CourierMode = "walk";
  private currentIsland: IslandId = "home";
  private started = false;
  private disposed = false;
  private suspended = false;

  private readonly now: () => number;
  private readonly reducedMotion: () => boolean;
  private readonly homeWorld: WalkWorld;
  private lanternfallWorld: WalkWorld | null = null;
  /** The walk world of the current island, in that island's local coordinates. */
  private walkWorld: WalkWorld;
  private readonly anchors: Record<AnchorId, Anchor>;
  private readonly runner: TaskRunner;
  private readonly clock: FixedClock;
  private readonly walker: Walker;
  private readonly spawnPose: { x: number; z: number; heading: number };
  private readonly courier: CourierModel;
  private readonly beacon: THREE.Group;
  private readonly plane: { group: THREE.Group; propeller: THREE.Group };
  private readonly latch: FlightInputLike;
  private readonly sky = skyWorld();
  private ownKeys: DomWalkKeys | null = null;
  private feedback: Feedback | null = null;
  private feedbackUntil = 0;
  private cameraYaw = 0;

  private skyPlane: SkyPlane | null = null;
  private arc: LaunchArc | null = null;
  private turningBack = false;
  private readonly pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, bank: 0 };
  private readonly previous: Vec3 = { x: 0, y: 0, z: 0 };
  /** How far (0..1) the frame is between the last two fixed steps; drawn states blend previous to current by it. */
  private alpha = 0;
  /** The walker (island-local) and flight pose as they were before the latest fixed step. */
  private readonly prevWalk = { x: 0, y: 0, z: 0, heading: 0 };
  private readonly prevFlight: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, bank: 0 };
  /** What is drawn this frame: the courier in world coordinates (y eased by a spring so steps glide), and the plane. */
  private readonly shown = { x: 0, y: 0, z: 0, heading: 0 };
  /** How far the drawn height still trails a recent step (eased to 0); slopes are followed exactly. */
  private readonly stepOffset: Spring = { value: 0, velocity: 0 };
  private lastTargetY = 0;
  private readonly drawnFlight: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, bank: 0 };
  /** The courier's procedural gait, fed from the drawn courier each frame, and the pose it produces. */
  private readonly gait = createGait();
  private readonly courierPose = createPose();
  /** The London courier walks with the human gait (humanGait.ts) and this pose; the wind-up courier keeps its own. */
  private readonly humanGait = createHumanGait();
  private readonly figurePose = createFigurePose();
  private readonly lastShown = { x: 0, z: 0 };
  private readonly gaitInput = { dt: 0, distance: 0, speed: 0, heading: 0, y: 0, reduced: false, airborne: false, compact: false };
  /** Seconds a Space press stays queued, so a press just before landing still jumps. */
  private jumpBuffer = 0;
  /** Puffs kicked up by landings and brisk steps (world coordinates). */
  private readonly dust: Dust;
  /** Time towards the next step puff, the tries so far (every other one puffs) and the foot of the last one (±1). */
  private dustClock = 0;
  private dustTries = 0;
  private dustSide = 1;
  /** The camera's field of view when the controller was made; flight widens it, walking eases it back. */
  private readonly baseFov: number;
  private propellerSpin = 0;
  private readonly planeSettle: Spring = { value: 0, velocity: 0 };
  private parkedPad: Pad | null = null;
  private readonly debounced = new Map<string, number>();

  /** Where the courier was when the camera last followed it (world coordinates). */
  /** The walking camera, its occluders per island, and its canvas input (drag to orbit, wheel to zoom). */
  private readonly follow: FollowCamera;
  private readonly homeCameraWorld: CameraWorld;
  private lanternfallCameraWorld: CameraWorld | null = null;
  private detachFollowInput: (() => void) | null = null;
  private readonly subject: FollowSubject = { x: 0, y: 0, z: 0, heading: 0, vx: 0, vz: 0 };
  /** The scene camera's own near plane, put back when play stops. */
  private readonly baseNear: number;
  private readonly scratch = new THREE.Vector3();
  private readonly chaseTarget = new THREE.Vector3();
  private readonly chaseLook = new THREE.Vector3();
  private readonly chaseLookShown = new THREE.Vector3();
  private chaseYaw = 0;
  private chaseTurn = 0;
  /** Set when the chase camera takes over (launch, gate teleport): its smoothing starts from the current pose. */
  private chaseFresh = true;

  constructor(private readonly options: CourierControllerOptions) {
    // Free walking can safely catch up a 200 ms frame through fixed collision steps; ordinary hitches must not
    // slow the character to half speed. The retired flight mode retains its existing simulation work budget.
    this.clock = new FixedClock(options.freeRoam ? 12 : undefined);
    this.now = options.now ?? Date.now;
    this.reducedMotion = options.reducedMotion ?? (() => false);
    const layout = options.layout ?? (options.freeRoam ? createCityLayout() : createHillTownLayout());
    this.homeWorld = options.walkWorld ?? (options.freeRoam ? createHillTownWalkWorld(layout) : createHomeWalkWorld());
    this.walkWorld = this.homeWorld;
    this.anchors = createAnchors(layout, this.homeWorld);
    this.homeCameraWorld = createHomeCameraWorld(this.homeWorld, layout, [launcherBox(HOME_PAD, ZERO_OFFSET)]);
    this.follow = new FollowCamera(options.camera);
    this.runner = new TaskRunner(this.anchors, this.now());
    this.spawnPose = options.freeRoam ? chooseIslandSpawn(layout, this.homeWorld) : { ...polarToXZ(SPAWN_BEARING, SPAWN_RADIUS), heading: SPAWN_HEADING };
    this.walker = createWalker(this.spawnPose.x, this.spawnPose.z, this.homeWorld, this.spawnPose.heading);
    this.courier = createCourierModel(options.palette, options.freeRoam);
    if (options.freeRoam) this.courier.rig.key.visible = false;
    this.beacon = createBeacon(options.palette);
    this.dust = createDust(options.palette);
    this.plane = createPlaneModel("cream-copper", "world");
    this.plane.group.name = "courierPlane";
    this.plane.group.rotation.order = "YXZ";
    this.baseFov = options.camera.fov;
    this.baseNear = options.camera.near;
    this.latch = options.flightInput ?? (options.canvas ? new FlightInputLatch(options.canvas) : NO_FLIGHT_INPUT);
    this.courier.group.visible = false;
    this.beacon.visible = false;
    for (const root of [this.courier.group, this.beacon, this.plane.group]) enableShadows(root);
  }

  get mode(): CourierMode { return this.currentMode; }

  /** The island the courier is on (while flying: the island it took off from). */
  get island(): IslandId { return this.currentIsland; }

  /** Spawn the courier, reset the round, configure the follow camera, show the beacon. */
  start(): void {
    if (this.disposed) throw new Error("CourierController: start() after dispose()");
    this.started = true;
    this.feedback = null;
    this.clock.reset();
    this.runner.reset(this.now());
    this.options.world.add(this.courier.group, this.dust.mesh);
    if (!this.options.freeRoam) this.options.world.add(this.beacon, this.plane.group);

    if (!this.options.keys && !this.ownKeys && typeof window !== "undefined") {
      this.ownKeys = new DomWalkKeys(this.now);
      this.ownKeys.setSuspended(this.suspended);
      this.ownKeys.attach();
    }

    this.skyPlane = null;
    this.arc = null;
    this.turningBack = false;
    this.debounced.clear();
    this.latch.disable();
    this.setIsland("home");
    this.parkPlane(HOME_PAD);
    const camera = this.options.camera;
    if (camera.near !== FOLLOW.near) {
      camera.near = FOLLOW.near;
      camera.updateProjectionMatrix();
    }
    const canvas = this.options.canvas;
    if (canvas && !this.detachFollowInput) {
      this.detachFollowInput = attachFollowInput(canvas, this.follow, () => this.started && this.currentMode === "walk" && !this.suspended);
    }
    this.enterWalk(this.spawnPose, this.spawnPose.heading, FOLLOW.swoopSeconds);
    this.updateBeacon(this.runner.snapshot(this.now()));
  }

  /** Remove the courier, plane and beacon from the world, drop keyboard and flight input, release anything held. Safe to call twice. */
  stop(): void {
    this.started = false;
    // Flight widens the view; the title and explore cameras must get the scene's own field of view back.
    const camera = this.options.camera;
    if (camera.fov !== this.baseFov || camera.near !== this.baseNear) {
      camera.fov = this.baseFov;
      camera.near = this.baseNear;
      camera.updateProjectionMatrix();
    }
    this.detachFollowInput?.();
    this.detachFollowInput = null;
    this.options.world.remove(this.courier.group, this.beacon, this.plane.group, this.dust.mesh);
    this.dust.clear();
    this.latch.disable();
    // While playing the orbit controls are off; leave them usable (CityScene restores its own settings anyway).
    this.options.controls.enabled = true;
    this.ownKeys?.detach();
    this.ownKeys = null;
    this.drainInteract();
  }

  /**
   * While suspended (a dialog is open, say) key input is ignored: held keys clear and queued E presses are dropped.
   * The courier stands still, a flight (and any launch arc) is frozen where it is, and the world keeps animating.
   */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    this.ownKeys?.setSuspended(suspended);
    if (suspended) this.drainInteract();
    // A frozen flight is drawn exactly where it stopped, from this frame on.
    if (suspended && this.currentMode === "fly") copyPose(this.prevFlight, this.flightPose());
  }

  /**
   * Per rendered frame: advance a 60 Hz fixed clock over `frameDt` (seconds), step the walker or plane and the task
   * runner each fixed step, then animate and update the camera once.
   */
  update(frameDt: number): void {
    if (!this.started) return;
    if (this.options.freeRoam && this.currentMode === "walk") this.cameraYaw = this.follow.yaw;
    else {
      this.options.camera.getWorldDirection(this.scratch);
      this.cameraYaw = Math.atan2(this.scratch.x, -this.scratch.z);
    }

    this.alpha = this.clock.step(frameDt, (dt) => this.fixedStep(dt));

    const animationDt = Number.isFinite(frameDt) ? Math.min(Math.max(frameDt, 0), this.options.freeRoam ? 0.2 : MAX_ANIMATION_DT) : 0;
    const nowMs = this.now();
    this.updateBeacon(this.runner.snapshot(nowMs));

    if (this.currentMode === "walk") {
      this.poseCourier(animationDt);
      this.animateGait(animationDt, nowMs);
      this.followWalkCamera(animationDt);
      this.settlePlane(animationDt);
      this.easeFov(FOLLOW.fov, animationDt);
    } else {
      this.poseFlight();
      this.chaseCamera(animationDt);
    }
    this.spinPropeller(animationDt);
    // Reduced motion: no puffs at all (any still drifting from before the switch go at once).
    if (this.reducedMotion()) {
      if (this.dust.alive > 0) this.dust.clear();
    } else {
      this.dust.update(animationDt);
    }
  }

  /** Where the action is, for the sun's shadow fit: the drawn courier, or the drawn plane while flying. */
  focusPoint(out: THREE.Vector3): THREE.Vector3 {
    if (this.currentMode === "fly") return out.copy(this.plane.group.position);
    return out.set(this.shown.x, this.shown.y, this.shown.z);
  }

  /** Point the walking view along `yaw` at once (heading convention). Debug and tests. */
  setCameraYaw(yaw: number): void {
    if (this.currentMode === "walk") this.follow.lookAlong(yaw);
  }

  /** What the HUD shows now. Cheap enough to call 10 times a second. */
  hud(): CourierHud {
    const nowMs = this.now();
    const task = this.runner.snapshot(nowMs);
    if (this.feedback && nowMs >= this.feedbackUntil) this.feedback = null;
    const prompt = this.promptFor(task);
    return {
      mode: this.currentMode, task, marker: this.markerFor(task), feedback: this.feedback, prompt,
      flight: this.currentMode === "fly" ? this.flightHud(task) : null,
    };
  }

  /** A read-only look for diagnostics: no feedback expiry, no marker projection. */
  snapshot(): { mode: CourierMode; position: { x: number; y: number; z: number }; task: TaskSnapshot; prompt: string | null } {
    const task = this.runner.snapshot(this.now());
    return { mode: this.currentMode, position: this.position(), task, prompt: this.promptFor(task) };
  }

  private promptFor(task: TaskSnapshot): string | null {
    if (task.prompt === null && this.currentMode === "walk" && this.nearPad()) {
      return this.currentIsland === "home" ? "E · Fly to Lanternfall" : "E · Fly home";
    }
    return task.prompt;
  }

  /**
   * Debug and tests. Walking: put the courier next to the current task target (a walkable, unblocked spot within the
   * anchor radius) when the target is on this island. Flying (finishing any launch arc first): see teleportToGate.
   */
  teleportToObjective(): void {
    if (this.currentMode === "fly") {
      this.teleportToGate(this.targetGate().island);
      return;
    }
    const target = this.runner.snapshot(this.now()).target;
    const anchor = target ? this.anchors[target] : undefined;
    if (!anchor || anchor.island !== this.currentIsland) return;
    const offset = this.offset();
    this.placeCourierNear({ x: anchor.position.x - offset.x, y: anchor.position.y - offset.y, z: anchor.position.z - offset.z },
      anchor.radius, anchor.maxDy ?? 6);
  }

  /** Debug and tests (walk mode): put the courier at the clear spot nearest (x, z) on the current island (island-local). */
  teleportTo(x: number, z: number): void {
    if (this.currentMode !== "walk" || !Number.isFinite(x) || !Number.isFinite(z)) return;
    this.placeCourierNear({ x, y: this.walkWorld.surfaceAt(x, z).height, z }, 6, 6);
  }

  /** Debug and tests (walk mode): put the courier within the free-flight prompt range of the current island's pad. */
  teleportToPad(): void {
    if (this.currentMode !== "walk") return;
    const pad = this.padOf();
    const offset = this.offset();
    this.placeCourierNear({ x: pad.position.x - offset.x, y: pad.position.y - offset.y, z: pad.position.z - offset.z }, NEAR_PAD - 1, 6);
  }

  /**
   * Debug and tests (fly mode): put the plane 60 units before `island`'s gate, aimed through its centre at speed 40
   * with a low throttle, so the next fixed steps cross the gate. Finishes any launch arc first.
   */
  teleportToGate(island: IslandId): void {
    if (this.currentMode !== "fly") return;
    this.finishArc();
    const plane = this.skyPlane;
    if (!plane) return;
    const gate = island === "lanternfall" ? LANTERNFALL_GATE : HOME_GATE;
    plane.position.x = gate.center.x - gate.direction.x * GATE_RUN_UP;
    plane.position.y = gate.center.y;
    plane.position.z = gate.center.z - gate.direction.z * GATE_RUN_UP;
    plane.yaw = Math.atan2(gate.direction.x, -gate.direction.z);
    plane.pitch = 0;
    plane.bank = 0;
    plane.speed = GATE_RUN_UP_SPEED;
    plane.throttle = GATE_RUN_UP_THROTTLE;
    plane.bumpCooldown = 0;
    // A jump, not a flight: draw it (and put the chase camera behind it) at once rather than sweeping across the gap.
    copyPose(this.prevFlight, this.flightPose());
    this.runner.update("fly", plane.position);
    this.chaseFresh = true;
    if (this.started) this.chaseCamera(SNAP_DT);
  }

  /**
   * Diagnostics: the walker's simulated horizontal speed (units per second) and the drawn gait (the left leg's cycle
   * phase in [0, 1), how far into moving, and the walk/jog/run mix), so movement can be measured in the running game.
   */
  motion(): CourierMotion {
    const gait = this.humanGait;
    return { speed: Math.hypot(this.walker.vx, this.walker.vz), phase: gait.phase, move: gait.move, walk: gait.walk, jog: gait.jog, run: gait.run };
  }

  /** Position (copy) for diagnostics, in world coordinates: the courier, or the plane while flying. */
  position(): { x: number; y: number; z: number } {
    if (this.currentMode === "fly") {
      const pose = this.flightPose();
      return { x: pose.x, y: pose.y, z: pose.z };
    }
    const offset = this.offset();
    return { x: this.walker.x + offset.x, y: this.walker.y + offset.y, z: this.walker.z + offset.z };
  }

  dispose(): void {
    this.stop();
    if (this.disposed) return;
    this.disposed = true;
    disposeModel(this.courier.group);
    disposeModel(this.beacon);
    this.dust.dispose();
    // The plane's two materials are its own (the town palette's are shared and must never be disposed here).
    const materials = new Set<THREE.Material>();
    this.plane.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const material of materials) material.dispose();
  }

  // --- mode changes (the only places `currentMode` is written) -----------------------------------------------------

  /** Take off from the current island's pad: hide the courier, take the flight controls, and start the scripted launch arc. */
  private enterFly(): void {
    if (this.currentMode === "fly") return;
    const pad = this.padOf();
    this.currentMode = "fly";
    this.drainInteract();
    this.courier.group.visible = false;
    this.skyPlane = null;
    this.turningBack = false;
    this.arc = { pad, release: launchRelease(pad), elapsed: 0, duration: this.reducedMotion() ? ARC_SECONDS_REDUCED : ARC_SECONDS };
    Object.assign(this.pose, { x: pad.position.x, y: pad.position.y + PLANE_PAD_LIFT, z: pad.position.z, yaw: pad.yaw, pitch: ARC_PITCH, bank: 0 });
    copyPose(this.prevFlight, this.pose);
    this.chaseFresh = true;
    this.options.controls.enabled = false;
    this.latch.enable();
    this.runner.update("fly", this.pose);
  }

  /** Stand the courier at island-local (x, z) facing `heading`, show it, and take the camera back (also used after landing). */
  private enterWalk(position: { x: number; z: number }, heading: number, swoopSeconds = 0): void {
    this.currentMode = "walk";
    this.drainInteract();
    this.resetWalker(this.walker, position.x, position.z, heading);
    this.courier.group.visible = true;
    this.snapCourier();
    this.enterWalkCamera(swoopSeconds);
    this.runner.update("walk", this.worldWalker());
  }

  /** Park the plane on the gate's pad, release the controls, and walk off beside it. */
  private land(gate: Gate): void {
    this.skyPlane = null;
    this.arc = null;
    this.turningBack = false;
    this.latch.disable();
    this.setIsland(gate.island);
    const pad = gate.parkAt;
    this.parkPlane(pad);
    if (!this.reducedMotion()) {
      this.planeSettle.value = SETTLE.drop;
      this.settlePlane(0);
    }
    const offset = this.offset();
    const localX = pad.position.x - offset.x;
    const localZ = pad.position.z - offset.z;
    const length = Math.hypot(localX, localZ);
    // Toward the island centre; facing the same way.
    const inwardX = length > 0 ? -localX / length : 0;
    const inwardZ = length > 0 ? -localZ / length : 1;
    const spot = this.clearSpotNear(localX + inwardX * LAND_OFFSET, localZ + inwardZ * LAND_OFFSET);
    this.enterWalk(spot, Math.atan2(inwardX, -inwardZ), FOLLOW.landingSwoopSeconds);
    // Landing at the wrong island leaves the round on its land step: bring the launch prompt back.
    if (this.currentStep()?.kind === "land") this.runner.retryLaunch();
  }

  // --- internals ------------------------------------------------------------------------------------------------

  private setIsland(island: IslandId): void {
    this.currentIsland = island;
    if (island === "home") {
      this.walkWorld = this.homeWorld;
      this.follow.setWorld(this.homeCameraWorld, ZERO_OFFSET);
    } else {
      this.walkWorld = this.lanternfallWorld ??= createLanternfallWalkWorld();
      this.lanternfallCameraWorld ??= createLanternfallCameraWorld(this.walkWorld);
      this.follow.setWorld(this.lanternfallCameraWorld, LANTERNFALL_CENTER);
    }
  }

  /** World position of the current island's local origin. */
  /**
   * The world her step is taken in: the walk world, with the town's people solid on the home island. Her collision
   * radius is sized for walls and keeps the camera clear of them; against people her own body counts, so she can pass
   * someone on a pavement.
   */
  private stepWorld(): WalkWorld {
    const people = this.options.people;
    if (!people || this.currentIsland !== "home") return this.walkWorld;
    const world = this.walkWorld;
    this.peopleWorld ??= {
      surfaceAt: (x, z) => world.surfaceAt(x, z),
      blocked: (x, z, radius) => world.blocked(x, z, radius) || people(x, z, radius * PERSON_BODY),
    };
    return this.peopleWorld;
  }
  private peopleWorld: WalkWorld | null = null;

  private offset(): Readonly<Vec3> {
    return this.currentIsland === "lanternfall" ? LANTERNFALL_CENTER : ZERO_OFFSET;
  }

  private padOf(): Pad {
    return this.currentIsland === "home" ? HOME_PAD : LANTERNFALL_PAD;
  }

  private worldWalker(): Vec3 {
    const offset = this.offset();
    return { x: this.walker.x + offset.x, y: this.walker.y + offset.y, z: this.walker.z + offset.z };
  }

  private currentStep(snapshot: TaskSnapshot = this.runner.snapshot(this.now())): TaskStep | undefined {
    const { taskIndex, stepIndex } = snapshot;
    const task: TaskDef | undefined = TASKS[taskIndex];
    return task?.steps[stepIndex];
  }

  /** The gate the plane is heading for: the task's land gate, else the other island's gate. */
  private targetGate(snapshot?: TaskSnapshot): Gate {
    const step = this.currentStep(snapshot);
    if (step?.kind === "land" && step.anchor === "lanternfall-gate") return LANTERNFALL_GATE;
    return this.currentIsland === "home" ? LANTERNFALL_GATE : HOME_GATE;
  }

  private nearPad(): boolean {
    const pad = this.padOf();
    const world = this.worldWalker();
    return Math.hypot(world.x - pad.position.x, world.z - pad.position.z) <= NEAR_PAD;
  }

  private parkPlane(pad: Pad): void {
    this.parkedPad = pad;
    this.planeSettle.value = 0;
    this.planeSettle.velocity = 0;
    this.plane.group.position.set(pad.position.x, pad.position.y + PLANE_PAD_LIFT, pad.position.z);
    this.plane.group.rotation.set(0, -pad.yaw, 0, "YXZ");
  }

  /** The parked plane's landing bounce: it drops onto the pad and rocks a little before it rests. */
  private settlePlane(dt: number): void {
    const settle = this.planeSettle;
    const pad = this.parkedPad;
    if (!pad || (settle.value === 0 && settle.velocity === 0)) return;
    if (this.reducedMotion()) {
      settle.value = 0;
      settle.velocity = 0;
    }
    stepSpring(settle, 0, SETTLE.omega, SETTLE.zeta, dt);
    if (Math.abs(settle.value) < 1e-3 && Math.abs(settle.velocity) < 1e-3) {
      settle.value = 0;
      settle.velocity = 0;
    }
    this.plane.group.position.y = pad.position.y + PLANE_PAD_LIFT + Math.max(-SETTLE.maxSink, settle.value);
    this.plane.group.rotation.x = Math.min(0.12, Math.max(-0.12, settle.velocity * 0.012));
  }

  /** Spool the propeller toward the throttle (and boost) while flying, and wind it down once parked. */
  private spinPropeller(dt: number): void {
    const plane = this.skyPlane;
    let target = 0;
    if (this.currentMode === "fly") {
      const throttle = plane ? plane.throttle : 1;
      const boosting = plane !== null && this.latch.latest().boost && !plane.boostLocked && plane.boost > 0;
      target = lerp(PROPELLER.idle, PROPELLER.full, throttle) + (boosting ? PROPELLER.boost : 0);
    }
    this.propellerSpin = lerpFPS(this.propellerSpin, target, PROPELLER.k60, dt);
    if (!this.reducedMotion()) this.plane.propeller.rotation.z += dt * this.propellerSpin;
  }

  /** Ease the camera's field of view toward `target` degrees. */
  private easeFov(target: number, dt: number): void {
    const camera = this.options.camera;
    if (camera.fov === target) return;
    const next = this.reducedMotion() ? target : lerpFPS(camera.fov, target, FOV_K60, dt);
    camera.fov = Math.abs(next - target) < 1e-3 ? target : next;
    camera.updateProjectionMatrix();
  }

  private resetWalker(walker: Walker, x: number, z: number, heading: number): void {
    walker.x = x;
    walker.y = this.walkWorld.surfaceAt(x, z).height;
    walker.z = z;
    walker.heading = heading;
    walker.vx = 0;
    walker.vz = 0;
    walker.speed = 0;
    walker.moving = false;
    walker.stride = 0;
    walker.acc = 0;
    this.groundWalker(walker);
  }

  /** Stand the walker on the ground it is at: no vertical speed, no queued jump. */
  private groundWalker(walker: Walker): void {
    walker.vy = 0;
    walker.grounded = true;
    walker.baseY = walker.y;
    this.jumpBuffer = 0;
  }

  private drainInteract(): void {
    if (this.options.freeRoam) return;
    this.options.keys?.takeInteract();
    this.options.keys?.takeJump?.();
    this.ownKeys?.clear();
    this.jumpBuffer = 0;
  }

  private allow(key: keyof typeof DEBOUNCE_MS, nowMs: number): boolean {
    const last = this.debounced.get(key);
    if (last !== undefined && nowMs - last < DEBOUNCE_MS[key]) return false;
    this.debounced.set(key, nowMs);
    return true;
  }

  private setFeedback(feedback: Feedback): void {
    this.feedback = feedback;
    this.feedbackUntil = this.now() + FEEDBACK_MS;
  }

  private fixedStep(dt: number): void {
    if (this.currentMode === "fly") {
      // Suspended (the guide is open): freeze the simulation, arc included, so nothing happens behind the dialog.
      // Nothing moved, so the drawn plane must not keep blending between the last two poses either.
      if (this.suspended) copyPose(this.prevFlight, this.flightPose());
      else this.flyStep(dt);
      return;
    }
    const keys = this.options.keys ?? this.ownKeys;
    const live = this.suspended ? null : keys;
    const walker = this.walker;
    this.capturePrevWalk();
    if (live?.takeJump?.()) this.jumpBuffer = JUMP_BUFFER_SECONDS;
    const result = stepWalker(walker, {
      forward: live?.forward ?? 0, strafe: live?.strafe ?? 0, run: live?.run ?? false, cameraYaw: this.cameraYaw,
      jump: this.jumpBuffer > 0,
    }, dt, this.stepWorld());
    this.jumpBuffer = result.jumped ? 0 : Math.max(0, this.jumpBuffer - dt);
    if (result.landed) this.puff(Math.min(DUST.landing, DUST.most - this.dust.alive), DUST.landingRadius);
    this.runner.update("walk", this.worldWalker());
    const pressedAt = live?.takeInteract() ?? null;
    if (pressedAt === null) return;
    const events = this.runner.interact(pressedAt);
    // Nothing for the task to do here: E beside the pad is a free flight.
    if (events.length === 0 && this.nearPad()) this.enterFly();
    else this.apply(events);
  }

  private flyStep(dt: number): void {
    copyPose(this.prevFlight, this.flightPose());
    if (this.arc) {
      this.stepArc(this.arc, dt);
      return;
    }
    const plane = this.skyPlane;
    if (!plane) return;
    this.previous.x = plane.position.x;
    this.previous.y = plane.position.y;
    this.previous.z = plane.position.z;
    const step = stepSkyPlane(plane, this.latch.latest(), dt, this.sky);
    this.turningBack = step.turningBack;
    this.runner.update("fly", plane.position);
    const nowMs = this.now();
    for (const gate of GATES) {
      if (!gateCrossed(gate, this.previous, plane.position)) continue;
      this.crossGate(gate, plane.speed, nowMs);
      if (this.currentMode !== "fly") return;
    }
    if (step.bumped && this.allow("bump", nowMs)) this.setFeedback({ text: "Bumped the island", tone: "info" });
  }

  /** The scripted spring launch: no physics, just a curve from the pad to the release point. */
  private stepArc(arc: LaunchArc, dt: number): void {
    arc.elapsed += dt;
    const done = arc.elapsed >= arc.duration - 1e-9;
    const t = done ? 1 : arc.elapsed / arc.duration;
    const { release } = arc;
    const from = arc.pad.position;
    const rise = 1 - (1 - t) ** 3; // rises quickly ...
    const run = t; // ... at a constant horizontal speed (60 units in 1.2 s = cruise speed) into the hand-over
    this.pose.x = from.x + (release.x - from.x) * run;
    this.pose.y = from.y + PLANE_PAD_LIFT + (release.y - from.y - PLANE_PAD_LIFT) * rise;
    this.pose.z = from.z + (release.z - from.z) * run;
    this.pose.yaw = arc.pad.yaw;
    this.pose.pitch = ARC_PITCH * (1 - t);
    this.pose.bank = 0;
    if (done) this.finishArc();
    else this.runner.update("fly", this.pose);
  }

  /** Ends the launch arc at once: the plane appears at the release point at cruise speed. */
  private finishArc(): void {
    const arc = this.arc;
    if (!arc) return;
    this.arc = null;
    this.skyPlane = createSkyPlane({ ...arc.release }, arc.pad.yaw);
    this.runner.update("fly", this.skyPlane.position);
  }

  private crossGate(gate: Gate, speed: number, nowMs: number): void {
    const step = this.currentStep();
    if (step?.kind === "land" && step.anchor === "lanternfall-gate" && gate === LANTERNFALL_GATE) {
      const events = this.runner.passGate("lanternfall-gate", speed, nowMs);
      this.apply(events);
      if (events.some((event) => event.type === "landed")) this.land(gate);
      return;
    }
    // Free flight (or the wrong island for the task): any gate lands, if slow enough.
    if (speed <= LANDING_SPEED) {
      this.land(gate);
      this.setFeedback({ text: "Landed", tone: "good" });
    } else if (this.allow("tooFast", nowMs)) {
      this.setFeedback({ text: "Ease the throttle (S) to land", tone: "warn" });
    }
  }

  /** Turns task events into one feedback line (the highest ranked) and handles the mode-changing ones. */
  private apply(events: readonly TaskEvent[]): void {
    let best: Candidate | null = null;
    for (const event of events) {
      if (event.type === "launch") this.enterFly();
      const candidate = describeEvent(event);
      if (candidate && (!best || candidate.rank > best.rank)) best = candidate;
    }
    if (best) this.setFeedback(best.feedback);
  }

  private flightPose(): Pose {
    const plane = this.skyPlane;
    if (plane) {
      const pose = this.pose;
      pose.x = plane.position.x;
      pose.y = plane.position.y;
      pose.z = plane.position.z;
      pose.yaw = plane.yaw;
      pose.pitch = plane.pitch;
      pose.bank = plane.bank;
    }
    return this.pose;
  }

  /** The flight pose blended from before the last fixed step to now by the frame's alpha, so the plane never judders. */
  private renderedFlight(): Pose {
    const now = this.flightPose();
    const prev = this.prevFlight;
    const t = this.alpha;
    const out = this.drawnFlight;
    out.x = lerp(prev.x, now.x, t);
    out.y = lerp(prev.y, now.y, t);
    out.z = lerp(prev.z, now.z, t);
    out.yaw = prev.yaw + shortestAngle(prev.yaw, now.yaw) * t;
    out.pitch = lerp(prev.pitch, now.pitch, t);
    out.bank = lerp(prev.bank, now.bank, t);
    return out;
  }

  private poseFlight(): void {
    const pose = this.renderedFlight();
    this.plane.group.position.set(pose.x, pose.y, pose.z);
    this.plane.group.rotation.set(pose.pitch, -pose.yaw, -pose.bank * PLANE_BANK_SCALE, "YXZ");
  }

  private flightHud(task: TaskSnapshot): FlightHud {
    const pose = this.flightPose();
    const plane = this.skyPlane;
    const gate = this.targetGate(task).center;
    const speed = plane?.speed ?? MATCH_RULES.aircraft.cruiseSpeed;
    const { canvas } = this.options;
    return {
      speed,
      altitude: pose.y,
      boost: plane?.boost ?? MATCH_RULES.aircraft.boostCapacity,
      boostLocked: plane?.boostLocked ?? false,
      gateDistance: Math.hypot(gate.x - pose.x, gate.y - pose.y, gate.z - pose.z),
      landingSpeed: LANDING_SPEED,
      tooFast: speed > LANDING_SPEED,
      pointerLocked: typeof document !== "undefined" && canvas !== undefined && document.pointerLockElement === canvas,
      turningBack: this.turningBack,
    };
  }

  /**
   * Draw the courier between its last two fixed steps (by the frame's alpha), with the height eased by a spring so
   * stairs and kerbs glide instead of snapping. `dt` is the frame time; 0 holds the spring where it is.
   */
  private poseCourier(dt = 0): void {
    const { group } = this.courier;
    const walker = this.walker;
    const prev = this.prevWalk;
    const offset = this.offset();
    const t = this.alpha;
    const shown = this.shown;
    shown.x = lerp(prev.x, walker.x, t) + offset.x;
    shown.z = lerp(prev.z, walker.z, t) + offset.z;
    shown.heading = prev.heading + shortestAngle(prev.heading, walker.heading) * t;
    const targetY = lerp(prev.y, walker.y, t) + offset.y;
    const rise = targetY - this.lastTargetY;
    this.lastTargetY = targetY;
    const step = this.stepOffset;
    if (Math.abs(rise) > SHOWN_Y_SNAP || this.reducedMotion()) {
      // A teleport or island change (or reduced motion): show it at once.
      step.value = 0;
      step.velocity = 0;
    } else if (walker.grounded && dt > 0 && Math.abs(rise) > Math.max(STEP_MIN, SLOPE_RATE * dt)) {
      // (A jump is drawn exactly as simulated: only a grounded rise is a kerb or stair.)
      // Too sudden for a slope: a kerb or stair. Keep the drawn height where it was and ease it across.
      step.value = Math.min(SHOWN_Y_SNAP, Math.max(-SHOWN_Y_SNAP, step.value - rise));
    }
    stepSpring(step, 0, SHOWN_Y_OMEGA, 1, dt);
    shown.y = targetY + step.value;
    group.position.set(shown.x, shown.y, shown.z);
    group.rotation.y = -shown.heading;
  }

  private capturePrevWalk(): void {
    const { prevWalk, walker } = this;
    prevWalk.x = walker.x;
    prevWalk.y = walker.y;
    prevWalk.z = walker.z;
    prevWalk.heading = walker.heading;
  }

  /** Make the drawn courier match the simulation exactly (after a spawn, teleport or landing). */
  private snapCourier(): void {
    const walker = this.walker;
    this.capturePrevWalk();
    this.alpha = 0;
    this.lastTargetY = walker.y + this.offset().y;
    this.stepOffset.value = 0;
    this.stepOffset.velocity = 0;
    this.poseCourier();
    this.lastShown.x = this.shown.x;
    this.lastShown.z = this.shown.z;
    this.subject.vx = 0;
    this.subject.vz = 0;
    resetGait(this.gait, this.shown.heading, this.shown.y);
    resetHumanGait(this.humanGait, this.shown.heading, this.shown.y);
    // A spawn or teleport starts the step-puff clock afresh.
    this.dustClock = 0;
  }

  /** Drive the gait from what is drawn (ground covered, speed, turning, height) and put the pose on the rig. */
  private animateGait(dt: number, nowMs: number): void {
    const shown = this.shown;
    const dx = shown.x - this.lastShown.x;
    const dz = shown.z - this.lastShown.z;
    const distance = Math.hypot(dx, dz);
    this.subject.vx = dt > 0 ? dx / dt : 0;
    this.subject.vz = dt > 0 ? dz / dt : 0;
    this.lastShown.x = shown.x;
    this.lastShown.z = shown.z;
    const reduced = this.reducedMotion();
    const input = this.gaitInput;
    input.dt = dt;
    input.distance = distance;
    // Speed from what is drawn: the walker's own speed only changes on fixed steps and would flicker the lean.
    input.speed = dt > 0 ? distance / dt : 0;
    input.heading = shown.heading;
    input.y = shown.y;
    input.reduced = reduced;
    input.airborne = !this.walker.grounded;
    input.compact = this.options.freeRoam === true;
    const figure = this.courier.figure;
    if (figure) {
      updateHumanGait(this.humanGait, { ...input, scale: figure.scale, pace: figure.pace, leg: figure.leg });
      animateHuman(this.courier, relaxPose(this.humanGait, humanPose(this.humanGait, this.figurePose, figure.leg)));
    } else {
      updateGait(this.gait, input);
      animateCourier(this.courier, gaitPose(this.gait, this.courierPose), tickValue(cycleMs(nowMs)), reduced);
    }
    this.kickRunDust(dt);
  }

  /**
   * Where the stride is, whichever gait draws the courier: phase in radians (footfalls at 0 and PI), how much of it is
   * running flat out, and how much of the airborne pose shows.
   */
  private stride(): { phase: number; run: number; air: number } {
    if (this.courier.figure) {
      const gait = this.humanGait;
      return { phase: gait.phase * Math.PI * 2, run: gait.run, air: gait.air };
    }
    return { phase: this.gait.phase, run: this.gait.run, air: this.gait.air };
  }

  /**
   * While the courier moves briskly over the ground, a puff about once a second. As the reference: half a second after
   * the last try, the next is made as soon as the courier is on the ground and moving faster than about half the jog;
   * every other try puffs (the reference tosses a coin), at one foot then the other; never more than two in the air.
   */
  private kickRunDust(dt: number): void {
    this.dustClock = Math.min(DUST.every, this.dustClock + (Number.isFinite(dt) ? Math.max(0, dt) : 0));
    if (this.dustClock < DUST.every) return;
    const speed = Math.hypot(this.walker.vx, this.walker.vz);
    if (!this.walker.grounded || this.stride().air > 0.1 || !(speed >= DUST.fromSpeed)) return;
    this.dustClock = 0;
    this.dustTries += 1;
    if (this.dustTries % 2 === 1 || this.dust.alive >= DUST.most) return;
    this.dustSide = -this.dustSide;
    // A little behind the courier (heading 0 faces −Z, so behind is (−sin, cos)) and to one side (its right is (cos, sin)).
    const h = this.shown.heading;
    const dx = -Math.sin(h) * DUST.back + Math.cos(h) * DUST.side * this.dustSide;
    const dz = Math.cos(h) * DUST.back + Math.sin(h) * DUST.side * this.dustSide;
    this.puff(1, DUST.stepRadius, dx, dz);
  }

  /** Kick up `count` puffs at the courier's feet (offset by dx, dz world units), unless motion is reduced. */
  private puff(count: number, radius: number, dx = 0, dz = 0): void {
    if (this.reducedMotion() || this.currentMode !== "walk") return;
    const world = this.worldWalker();
    this.dust.spawn(world.x + dx, world.y, world.z + dz, count, radius);
  }

  private updateBeacon(task: TaskSnapshot): void {
    if (this.options.freeRoam) { this.beacon.visible = false; this.plane.group.visible = false; return; }
    const target = task.done ? null : task.targetPosition;
    this.beacon.visible = target !== null;
    if (!target) return;
    this.beacon.position.set(target.x, target.y + TARGET_LIFT, target.z);
    animateBeacon(this.beacon, this.now() / 1000, this.reducedMotion());
  }

  /**
   * Hand the view to the follow camera, behind the courier: flown in over `swoopSeconds` from wherever the camera is
   * (0, or reduced motion, cuts straight there). The orbit controls stay off while walking; CityScene restores its own.
   */
  private enterWalkCamera(swoopSeconds: number): void {
    this.options.controls.enabled = false;
    const subject = this.followSubject();
    if (swoopSeconds > 0 && !this.reducedMotion()) this.follow.swoopTo(subject, swoopSeconds);
    else this.follow.snapBehind(subject);
  }

  /** The follow camera tracks what is drawn (blended between fixed steps), so it moves as smoothly as the courier. */
  private followWalkCamera(dt: number): void {
    this.follow.update(dt, this.followSubject(), this.reducedMotion());
    this.fadeWhenPinned(dt);
  }

  /**
   * A camera pinned close behind the courier (backed against a wall, a van or a tree) would show nothing but its back.
   * Like the reference does for its own courier, the figure dissolves while the camera is that close, so the street
   * stays in view; it eases back as the camera pulls out. Shadows are unaffected.
   */
  private fadeWhenPinned(dt: number): void {
    const figure = this.courier.figure;
    if (!figure) return;
    const uniform = (figure.mesh.material as THREE.ShaderMaterial).uniforms.uFade;
    if (!uniform) return;
    const head = this.scratch.set(this.shown.x, this.shown.y + figure.height * 0.85, this.shown.z);
    const near = this.options.camera.position.distanceTo(head);
    const target = THREE.MathUtils.clamp((PINNED_FADE.from - near) / (PINNED_FADE.from - PINNED_FADE.full), 0, 1) * PINNED_FADE.most;
    uniform.value = this.reducedMotion() ? target : lerpFPS(uniform.value, target, 0.25, dt);
    if (uniform.value < 0.01) uniform.value = 0;
  }

  private followSubject(): FollowSubject {
    const { subject, shown } = this;
    subject.x = shown.x;
    subject.y = shown.y;
    subject.z = shown.z;
    subject.heading = shown.heading;
    return subject;
  }

  /** Flight camera: eases to behind and above the plane and looks ahead of it. The orbit controls are off and not updated. */
  private chaseCamera(dt: number): void {
    const { camera } = this.options;
    const pose = this.renderedFlight();
    const reduced = this.reducedMotion();
    const k = (k60: number) => (reduced ? 1 : easeFactor(k60, dt));
    if (this.chaseFresh) {
      this.chaseYaw = pose.yaw;
      this.chaseTurn = 0;
    }
    const cosPitch = Math.cos(pose.pitch);
    const fx = Math.sin(pose.yaw) * cosPitch;
    const fy = Math.sin(pose.pitch);
    const fz = -Math.cos(pose.yaw) * cosPitch;
    this.chaseTarget.set(pose.x - fx * CHASE.back, pose.y - fy * CHASE.back + CHASE.up, pose.z - fz * CHASE.back);
    camera.position.x = lerp(camera.position.x, this.chaseTarget.x, k(CHASE.k60));
    camera.position.y = lerp(camera.position.y, this.chaseTarget.y, k(CHASE.upK60));
    camera.position.z = lerp(camera.position.z, this.chaseTarget.z, k(CHASE.k60));
    // Lead into turns: look a little toward the side the plane is turning to.
    const yawRate = dt > 0 ? shortestAngle(this.chaseYaw, pose.yaw) / dt : 0;
    this.chaseYaw = pose.yaw;
    const turnGoal = reduced ? 0 : Math.min(CHASE.turnLeadMax, Math.max(-CHASE.turnLeadMax, yawRate * CHASE.turnLead));
    this.chaseTurn = lerp(this.chaseTurn, turnGoal, k(CHASE.turnK60));
    const rightX = Math.cos(pose.yaw);
    const rightZ = Math.sin(pose.yaw);
    this.chaseLook.set(
      pose.x + fx * CHASE.look + rightX * this.chaseTurn,
      pose.y + fy * CHASE.look,
      pose.z + fz * CHASE.look + rightZ * this.chaseTurn,
    );
    if (this.chaseFresh) this.chaseLookShown.copy(this.chaseLook);
    else this.chaseLookShown.lerp(this.chaseLook, k(CHASE.lookK60));
    this.chaseFresh = false;
    camera.lookAt(this.chaseLookShown);
    // Roll a little with the plane (lookAt resets the roll every frame, and the walk camera's lookAt clears it).
    if (!this.reducedMotion()) camera.rotateZ(-pose.bank * PLANE_BANK_SCALE * CHASE_ROLL);
    camera.updateMatrixWorld(true);
    // Speed past cruise widens the view.
    const speed = this.skyPlane?.speed ?? MATCH_RULES.aircraft.cruiseSpeed;
    const rush = fit(speed, MATCH_RULES.aircraft.cruiseSpeed, MATCH_RULES.aircraft.maxSpeed, 0, 1);
    this.easeFov(FOLLOW.fov + (this.reducedMotion() ? 0 : FOV_KICK * rush), dt);
  }

  /** Put the courier at the clear spot nearest `centre` (island-local) within `radius`, then re-sync the runner and camera. */
  private placeCourierNear(centre: Vec3, radius: number, maxDy: number): void {
    const spot = this.findSpot(centre, radius, maxDy - TELEPORT_DY_MARGIN);
    if (!spot) return;
    const walker = this.walker;
    walker.x = spot.x;
    walker.y = spot.y;
    walker.z = spot.z;
    walker.vx = 0;
    walker.vz = 0;
    walker.speed = 0;
    walker.moving = false;
    walker.acc = 0;
    this.groundWalker(walker);
    this.runner.update("walk", this.worldWalker());
    if (this.started) {
      this.snapCourier();
      this.follow.jumpTo(this.followSubject());
    }
  }

  /** The point closest to `centre` where the courier can stand and still be in range. */
  private findSpot(centre: Vec3, radius: number, maxDy: number): { x: number; y: number; z: number } | null {
    for (let ring = 0; ring <= SPOT_RINGS; ring += 1) {
      const reach = (radius * SPOT_REACH * ring) / SPOT_RINGS;
      const count = ring === 0 ? 1 : SPOT_RING_POINTS;
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2;
        const x = centre.x + Math.cos(angle) * reach;
        const z = centre.z + Math.sin(angle) * reach;
        const surface = this.walkWorld.surfaceAt(x, z);
        if (surface.walkable && !this.walkWorld.blocked(x, z, WALK.radius) && Math.abs(surface.height - centre.y) <= maxDy) {
          return { x, y: surface.height, z };
        }
      }
    }
    return null;
  }

  /** A walkable, unblocked spot at or near (x, z) in island-local coordinates; (x, z) itself if none is found. */
  private clearSpotNear(x: number, z: number): { x: number; z: number } {
    const spot = this.findSpot({ x, y: this.walkWorld.surfaceAt(x, z).height, z }, 16, 6);
    return spot ? { x: spot.x, z: spot.z } : { x, z };
  }

  private markerFor(task: TaskSnapshot): MarkerState {
    // The task's target, else the other island's gate.
    const target = task.done ? null : task.targetPosition;
    const point = target ?? (this.currentIsland === "home" ? LANTERNFALL_GATE : HOME_GATE).center;
    const { camera } = this.options;
    camera.updateMatrixWorld();
    // Into view space (looking down -Z, so z >= 0 is behind the camera), then on to normalised device coordinates.
    this.scratch.set(point.x, point.y + TARGET_LIFT, point.z).applyMatrix4(camera.matrixWorldInverse);
    const behind = this.scratch.z >= 0;
    this.scratch.applyMatrix4(camera.projectionMatrix);
    const out = { x: 50, y: 50, bearing: 0, offscreen: false };
    fitIndicator(this.scratch.x, this.scratch.y, behind, out);
    const here = this.position();
    return { visible: true, ...out, distance: Math.hypot(point.x - here.x, point.z - here.z) };
  }
}
