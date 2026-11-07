import * as THREE from "three";
import type { Vec3 } from "@clockwork/shared";
import { easeFactor, fit, lerp, lerpAngleFPS, lerpFPS, shortestAngle, wrapAngle } from "../motion/ease";
import type { CameraWorld } from "./cameraWorld";
import { WALK } from "./walker";

/**
 * The walking camera: it orbits the courier on spherical coordinates around a smoothed target at head height.
 * - The target catches up quickly and leads a little along the courier's velocity, so the view breathes with motion.
 * - While the courier walks forward-ish, the view swings back behind it (never when walking toward the camera, and
 *   not for a moment after the player drags).
 * - Drag orbits (eased, quicker while held), the wheel zooms (eased), pitch is limited.
 * - The line from the target to the camera is tested against the camera world: the camera pulls in quickly in front
 *   of a wall, roof, canopy or terrace, and eases back out slowly once the view is clear.
 * - Mode changes swoop in from wherever the camera was.
 * Rates are k60 (fraction of the gap closed per 1/60 s, see motion/ease.ts); everything is frame-rate independent.
 */

export type FollowSubject = { x: number; y: number; z: number; heading: number; vx: number; vz: number };

export const FOLLOW = {
  distance: 20,
  minDistance: 9,
  maxDistance: 70,
  /** Radians above the horizon: low enough to see the sky and the street ahead, high enough to see over a kerb. */
  pitch: 0.26,
  minPitch: -0.08,
  maxPitch: 1.15,
  /** The camera looks at the courier's head. */
  targetLift: 3.4,
  lead: { seconds: 0.35, max: 3, k60: 0.03 },
  catchUp: 0.3,
  /** The drawn courier already glides over steps, so the target keeps up vertically too (a lagging target sinks the camera into stairs). */
  catchUpY: 0.3,
  rotate: { k60: 0.09, dragK60: 0.35 },
  recenter: { delay: 0.6, minSpeed: 1.2, slow: 0.012, fast: 0.04 },
  zoomK60: 0.14,
  /** Pinned against a wall or terrace, the camera may come right in behind the head (over the shoulder). */
  collision: { outK60: 0.035, ignoreNear: 0.6, margin: 0.6, minRadius: 1.2 },
  drag: { yawPerPixel: 0.0055, pitchPerPixel: 0.004 },
  /** Zoom factor per wheel delta unit (exponential, so in and out feel the same). */
  zoomPerWheel: 0.0012,
  swoopSeconds: 1.3,
  /** After landing, the view flies from the chase camera down to the courier in this long. */
  landingSwoopSeconds: 0.9,
  /** The walking field of view (degrees): wider than the town overview, so more sky and street show. */
  fov: 46,
  /** Near plane while playing: the camera may pull in to 3 from the courier's head, closer than the scene's own 2. */
  near: 1,
} as const;

/** A swoop arcs from the old camera to the follow pose (up over whatever lies between) and turns its old orientation (roll included) into the new one. */
type Swoop = { from: THREE.Vector3; fromLook: THREE.Vector3; fromQuat: THREE.Quaternion; elapsed: number; duration: number };
/** How high the swoop arcs, as a fraction of the distance it travels (capped). */
const SWOOP_ARC = 0.5;
const SWOOP_ARC_MAX = 400;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export class FollowCamera {
  /** The view's look direction (heading convention: 0 looks toward −Z, positive turns toward +X) and pitch above the horizon. */
  yaw = 0;
  pitch: number = FOLLOW.pitch;
  private desiredYaw = 0;
  private desiredPitch: number = FOLLOW.pitch;
  /** The zoom distance (eased toward zoomGoal) and the camera's actual distance after collisions. */
  private distance: number = FOLLOW.distance;
  private zoomGoal: number = FOLLOW.distance;
  private radius: number = FOLLOW.distance;
  /** Set when a collision pulled the camera in; cleared once it has eased back out to the zoom distance. */
  private recovering = false;
  private readonly target = new THREE.Vector3();
  /** The courier's own head: collisions are judged from here (the target leads it a little). */
  private readonly head = new THREE.Vector3();
  private readonly lead = new THREE.Vector3();
  private sinceInput = Number.POSITIVE_INFINITY;
  private dragging = false;
  private swoop: Swoop | null = null;
  private world: CameraWorld | null = null;
  private readonly origin = new THREE.Vector3();
  private readonly live = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly control = new THREE.Vector3();
  private readonly liveQuat = new THREE.Quaternion();
  private readonly from = { x: 0, y: 0, z: 0 };
  private readonly to = { x: 0, y: 0, z: 0 };

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  get swooping(): boolean { return this.swoop !== null; }

  /** The occluders of the island the courier is on, in that island's coordinates (world = local + origin). */
  setWorld(world: CameraWorld | null, origin: Readonly<Vec3>): void {
    this.world = world;
    this.origin.set(origin.x, origin.y, origin.z);
  }

  /** Default framing behind the subject, at once. */
  snapBehind(subject: FollowSubject): void {
    this.resetFraming(subject);
    this.swoop = null;
    this.radius = this.allowedRadius(this.distance);
    this.recovering = this.radius < this.distance;
    this.place();
  }

  /** Default framing behind the subject, flown in from wherever the camera is now (title to play, after landing). */
  swoopTo(subject: FollowSubject, seconds: number = FOLLOW.swoopSeconds): void {
    const from = this.camera.position.clone();
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    this.resetFraming(subject);
    this.radius = this.allowedRadius(this.distance);
    this.recovering = this.radius < this.distance;
    const fromLook = from.clone().addScaledVector(forward, Math.max(1, from.distanceTo(this.target)));
    this.swoop = { from, fromLook, fromQuat: this.camera.quaternion.clone(), elapsed: 0, duration: Math.max(0.01, seconds) };
  }

  /** Follow the subject through a teleport: keep the framing and move with it. */
  jumpTo(subject: FollowSubject): void {
    this.lead.set(0, 0, 0);
    this.target.set(subject.x, subject.y + FOLLOW.targetLift, subject.z);
    this.head.copy(this.target);
    this.swoop = null;
    // The new spot may have a wall behind it: judge the distance afresh rather than carry the old one in.
    this.radius = Math.min(this.radius, this.allowedRadius(this.distance));
    this.recovering = this.radius < this.distance;
    this.place();
  }

  /** Pointer drag in pixels: right turns the view right, down raises the camera to look down. */
  drag(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.dragging = true;
    this.sinceInput = 0;
    this.desiredYaw = wrapAngle(this.desiredYaw + dx * FOLLOW.drag.yawPerPixel);
    this.desiredPitch = clamp(this.desiredPitch + dy * FOLLOW.drag.pitchPerPixel, FOLLOW.minPitch, FOLLOW.maxPitch);
  }

  endDrag(): void {
    if (this.dragging) this.sinceInput = 0;
    this.dragging = false;
  }

  /** Wheel delta: positive zooms out. */
  zoom(deltaY: number): void {
    if (!Number.isFinite(deltaY)) return;
    this.zoomGoal = clamp(this.zoomGoal * Math.exp(deltaY * FOLLOW.zoomPerWheel), FOLLOW.minDistance, FOLLOW.maxDistance);
  }

  /** Point the view along `yaw` at once (debug and tests). */
  lookAlong(yaw: number): void {
    if (!Number.isFinite(yaw)) return;
    this.yaw = this.desiredYaw = wrapAngle(yaw);
    this.sinceInput = 0;
    this.place();
  }

  update(dt: number, subject: FollowSubject, reduced: boolean): void {
    if (!Number.isFinite(dt) || dt < 0) return;
    if (![subject.x, subject.y, subject.z, subject.heading, subject.vx, subject.vz].every(Number.isFinite)) return;
    const k = (k60: number) => (reduced ? 1 : easeFactor(k60, dt));
    this.sinceInput += dt;
    this.head.set(subject.x, subject.y + FOLLOW.targetLift, subject.z);

    // Lead a little along the velocity, then catch the target up (vertical more gently, so steps do not bob the view).
    const speed = Math.hypot(subject.vx, subject.vz);
    const leadScale = reduced ? 0 : Math.min(1, FOLLOW.lead.max / Math.max(1e-9, speed * FOLLOW.lead.seconds)) * FOLLOW.lead.seconds;
    this.lead.x = lerp(this.lead.x, subject.vx * leadScale, k(FOLLOW.lead.k60));
    this.lead.z = lerp(this.lead.z, subject.vz * leadScale, k(FOLLOW.lead.k60));
    this.target.x = lerp(this.target.x, subject.x + this.lead.x, k(FOLLOW.catchUp));
    this.target.z = lerp(this.target.z, subject.z + this.lead.z, k(FOLLOW.catchUp));
    this.target.y = lerp(this.target.y, subject.y + FOLLOW.targetLift, k(FOLLOW.catchUpY));

    // Swing back behind a courier walking forward-ish; walking toward the camera never flips the view.
    const { recenter } = FOLLOW;
    if (!reduced && !this.dragging && this.sinceInput > recenter.delay && speed > recenter.minSpeed) {
      const forwardness = (subject.vx * Math.sin(this.yaw) - subject.vz * Math.cos(this.yaw)) / speed;
      const weight = Math.max(0, forwardness) ** 2;
      const rate = fit(speed, recenter.minSpeed, WALK.runSpeed, recenter.slow, recenter.fast) * weight;
      this.desiredYaw = lerpAngleFPS(this.desiredYaw, subject.heading, rate, dt);
      this.desiredPitch = lerpFPS(this.desiredPitch, FOLLOW.pitch, rate * 0.5, dt);
    }

    const turn = k(this.dragging ? FOLLOW.rotate.dragK60 : FOLLOW.rotate.k60);
    this.yaw = wrapAngle(this.yaw + shortestAngle(this.yaw, this.desiredYaw) * turn);
    this.pitch = lerp(this.pitch, this.desiredPitch, turn);
    this.distance = lerp(this.distance, this.zoomGoal, k(FOLLOW.zoomK60));

    // Pull in at once when the view is blocked (never show the inside of a wall); ease back out slowly after a
    // collision, or follow the zoom directly.
    const allowed = this.allowedRadius(this.distance);
    if (allowed < this.distance - 1e-6) this.recovering = true;
    if (allowed < this.radius) this.radius = allowed;
    else this.radius = this.recovering ? lerp(this.radius, allowed, k(FOLLOW.collision.outK60)) : allowed;
    if (this.recovering && Math.abs(this.radius - this.distance) < 0.01) this.recovering = false;

    this.place();
    const swoop = this.swoop;
    if (swoop) {
      swoop.elapsed += dt;
      const s = reduced ? 1 : easeInOut(Math.min(1, swoop.elapsed / swoop.duration));
      this.live.copy(this.camera.position);
      this.liveQuat.copy(this.camera.quaternion);
      // A quadratic arc whose control point sits above the follow pose: the camera comes in from above, clear of
      // the tower, houses and launchers between, and settles straight down into place.
      const lift = Math.min(SWOOP_ARC_MAX, swoop.from.distanceTo(this.live) * SWOOP_ARC);
      this.control.set(this.live.x, Math.max(this.live.y, swoop.from.y) + lift, this.live.z);
      const a = (1 - s) * (1 - s);
      const b = 2 * (1 - s) * s;
      const c = s * s;
      this.camera.position.set(
        a * swoop.from.x + b * this.control.x + c * this.live.x,
        a * swoop.from.y + b * this.control.y + c * this.live.y,
        a * swoop.from.z + b * this.control.z + c * this.live.z,
      );
      // Turn from the old orientation (keeping, then easing out, any roll it had) to looking at the courier.
      this.look.lerpVectors(swoop.fromLook, this.target, s);
      this.camera.lookAt(this.look);
      this.liveQuat.copy(this.camera.quaternion);
      this.camera.quaternion.slerpQuaternions(swoop.fromQuat, this.liveQuat, s);
      this.camera.updateMatrixWorld(true);
      if (s >= 1) this.swoop = null;
    }
  }

  private resetFraming(subject: FollowSubject): void {
    this.yaw = this.desiredYaw = wrapAngle(subject.heading);
    this.pitch = this.desiredPitch = FOLLOW.pitch;
    this.lead.set(0, 0, 0);
    this.target.set(subject.x, subject.y + FOLLOW.targetLift, subject.z);
    this.head.copy(this.target);
    this.distance = this.zoomGoal;
  }

  /** How far out the camera may sit along the current yaw and pitch, given the camera world. */
  private allowedRadius(distance: number): number {
    if (!this.world) return distance;
    const cos = Math.cos(this.pitch);
    // From the courier's head to where the camera would sit at full distance: the view that must stay clear.
    const { from, to, origin, head, target } = this;
    from.x = head.x - origin.x;
    from.y = head.y - origin.y;
    from.z = head.z - origin.z;
    to.x = target.x - origin.x - Math.sin(this.yaw) * cos * distance;
    to.y = target.y - origin.y + Math.sin(this.pitch) * distance;
    to.z = target.z - origin.z + Math.cos(this.yaw) * cos * distance;
    const clear = this.world.clearFraction(from, to, FOLLOW.collision.ignoreNear);
    if (clear >= 1) return distance;
    return Math.min(distance, Math.max(FOLLOW.collision.minRadius, clear * distance - FOLLOW.collision.margin));
  }

  /**
   * Camera at the target plus the orbit offset (behind the look direction, up by the pitch), looking at the target;
   * never below the ground (whatever the smoothing did, the view must not open inside a terrace).
   */
  private place(): void {
    const cos = Math.cos(this.pitch);
    const full = this.distance;
    // At full distance the camera orbits the (leading) target; pulled in, it slides toward the head along the line
    // that the collision test checked, so the courier stays in view.
    const fx = this.target.x - Math.sin(this.yaw) * cos * full;
    const fy = this.target.y + Math.sin(this.pitch) * full;
    const fz = this.target.z + Math.cos(this.yaw) * cos * full;
    const t = full > 1e-9 ? Math.min(1, this.radius / full) : 1;
    const x = this.head.x + (fx - this.head.x) * t;
    const z = this.head.z + (fz - this.head.z) * t;
    let y = this.head.y + (fy - this.head.y) * t;
    if (this.world) y = Math.max(y, this.world.floorAt(x - this.origin.x, z - this.origin.z) + this.origin.y);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld(true);
  }
}

type PointerLike = Event & { clientX?: number; clientY?: number; button?: number; pointerId?: number };
type WheelLike = Event & { deltaY?: number };
type CaptureTarget = EventTarget & { setPointerCapture?: (id: number) => void; releasePointerCapture?: (id: number) => void };

/**
 * Drag to orbit and wheel to zoom, read from `target` (the game canvas) while `active()` is true. Returns a function
 * that removes the listeners.
 */
export function attachFollowInput(target: CaptureTarget, follow: Pick<FollowCamera, "drag" | "endDrag" | "zoom">, active: () => boolean): () => void {
  let last: { x: number; y: number; id: number } | null = null;
  const down = (event: Event) => {
    const e = event as PointerLike;
    // One pointer drives the view; a second finger neither restarts nor hijacks the drag.
    if (last || !active() || (e.button ?? 0) !== 0 || e.clientX === undefined || e.clientY === undefined) return;
    last = { x: e.clientX, y: e.clientY, id: e.pointerId ?? 0 };
    try { target.setPointerCapture?.(last.id); } catch { /* capture is a nicety (drags may leave the canvas) */ }
  };
  const move = (event: Event) => {
    const e = event as PointerLike;
    if (!last || (e.pointerId ?? 0) !== last.id || e.clientX === undefined || e.clientY === undefined) return;
    if (!active()) { up(event); return; }
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last.x = e.clientX;
    last.y = e.clientY;
    if (dx !== 0 || dy !== 0) follow.drag(dx, dy);
  };
  const up = (event: Event) => {
    if (!last) return;
    const id = (event as PointerLike).pointerId;
    if (id !== undefined && id !== last.id) return;
    try { target.releasePointerCapture?.(last.id); } catch { /* already released */ }
    last = null;
    follow.endDrag();
  };
  const wheel = (event: Event) => {
    const e = event as WheelLike;
    if (!active() || e.deltaY === undefined) return;
    event.preventDefault();
    follow.zoom(e.deltaY);
  };
  target.addEventListener("pointerdown", down);
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", up);
  target.addEventListener("lostpointercapture", up);
  target.addEventListener("wheel", wheel, { passive: false });
  return () => {
    target.removeEventListener("pointerdown", down);
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", up);
    target.removeEventListener("lostpointercapture", up);
    target.removeEventListener("wheel", wheel);
    if (last) follow.endDrag();
    last = null;
  };
}
