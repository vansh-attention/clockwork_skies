import * as THREE from "three";
import type { Vec3 } from "@clockwork/shared";
import { easeFactor, fit, lerp, lerpAngleFPS, lerpFPS, shortestAngle, wrapAngle } from "../motion/ease";
import type { CameraWorld } from "./cameraWorld";
import { COURIER_SIZE } from "./size";
import { WALK } from "./walker";

/**
 * The walking camera: it orbits the courier on spherical coordinates around a smoothed target at head height.
 * - The target keeps up with the courier, so the camera holds its distance while the courier runs, as the reference's
 *   does: in its live trace the camera stays 3.39 of its character's heights from it standing, jogging and sprinting
 *   alike. The view sits over the courier's shoulder: the courier a little left of centre.
 * - While the courier walks nearly straight ahead, the view settles behind it. Lateral/diagonal travel keeps the
 *   chosen view: camera-relative input must not steer itself into a circle as the camera recentres.
 * - Drag orbits (eased, quicker while held), the wheel zooms (eased), pitch is limited.
 * - The line from the target to the camera is tested against the camera world: the camera pulls in quickly in front
 *   of a wall, roof, canopy or terrace, and eases back out slowly once the view is clear.
 * - Mode changes swoop in from wherever the camera was.
 * Rates are k60 (fraction of the gap closed per 1/60 s, see motion/ease.ts); everything is frame-rate independent.
 */

export type FollowSubject = { x: number; y: number; z: number; heading: number; vx: number; vz: number };

export const FOLLOW = {
  /**
   * Street-scale framing, matched to the reference's own frames (1280×720, five standing views from two sessions): its
   * character stands about 320 px tall with the top of its head at the centre of the view, its feet near the bottom
   * edge, and a little left of centre. With `pitch`, `lookLift` and `fov` this puts the camera 2.5 of the courier's
   * heights behind it and 1.5 up, looking down about 12° at its head: the same framing, worked out in
   * .claude/abeto-messenger/look-analysis.md (sixth pass). Every length here was fitted to a 3.79-tall figure and is
   * carried to the courier's own height by COURIER_SIZE (size.ts).
   */
  distance: 9.9 * COURIER_SIZE,
  minDistance: 8 * COURIER_SIZE,
  maxDistance: 70,
  /**
   * Radians above the horizon at which the camera orbits the target (the courier's chest). The view itself looks a
   * little less steeply down, at the head (see `lookLift`).
   */
  pitch: 0.29,
  minPitch: -0.08,
  maxPitch: 1.15,
  /**
   * The point the camera orbits: the courier's chest (about 0.77 of its height). Collisions, rising over low things
   * and keeping the courier in view are all judged around it.
   */
  targetLift: 2.9 * COURIER_SIZE,
  /**
   * The view looks this far above the target: at the top of the courier's head (3.77), as the reference camera looks
   * at the top of its character's capsule. The figure then stands in the lower half of the view with the street ahead
   * above it.
   */
  lookLift: 0.87 * COURIER_SIZE,
  /**
   * Where the view must stay clear from: just above the courier's head (an adult's eye height). The camera can look
   * over a parked cab or a stall that stands above her shoulders (she is short: a cab's roof is above her eyes), so
   * the collision test starts here, not at her own eyes; pulled in, the camera slides toward it and looks over her
   * head rather than into her back. A world height, not scaled with her.
   */
  sightLift: 3.45,
  /**
   * Over the shoulder: the view (target and camera together) is moved this far to its right, so the courier sits a
   * little left of centre where the reference's frames show its character (centre line at x 485–505 of 1280; its
   * camera's target offset is 0.4 of the character's height to the side). Where a wall on the right leaves no room
   * (walking along house fronts), the view slides back behind the courier instead of being pulled in against its
   * back, at `shoulderK60`.
   */
  shoulder: 1.6 * COURIER_SIZE,
  shoulderK60: 0.06,
  /**
   * Over low things (a parked cab, a stall) the view rises rather than being pulled in or losing the courier behind
   * them: up to `max` radians above its pitch, in `step`s, the least that keeps the courier's chest in view, easing
   * at `k60`. Walls and houses it cannot see over still pull the camera in.
   */
  rise: { max: 0.32, step: 0.08, k60: 0.08 },
  /**
   * The target's catch-up horizontally (k60). 1: it keeps up exactly, so the courier neither recedes nor rises on
   * screen while running. The reference configures a 0.175 blend, but its camera's measured distance from its moving
   * character does not grow at all (live-timing.json), and what the player sees is what this matches.
   */
  catchUp: 1,
  /** The drawn courier already glides over steps, so the target keeps up vertically too (a lagging target sinks the camera into stairs). */
  catchUpY: 0.3,
  rotate: { k60: 0.09, dragK60: 0.35 },
  recenter: { delay: 0.6, minSpeed: 1.2, minForwardness: 0.92, slow: 0.012, fast: 0.04 },
  zoomK60: 0.14,
  /** Pinned against a wall or terrace, the camera may come right in behind the head (over the shoulder). */
  collision: { outK60: 0.035, ignoreNear: 0.6, margin: 0.6, minRadius: 1.2 },
  drag: { yawPerPixel: 0.0055, pitchPerPixel: 0.004 },
  /** Zoom factor per wheel delta unit (exponential, so in and out feel the same). */
  zoomPerWheel: 0.0012,
  swoopSeconds: 1.3,
  /** After landing, the view flies from the chase camera down to the courier in this long. */
  landingSwoopSeconds: 0.9,
  /** The walking field of view (degrees, vertical): the reference camera's own 45. */
  fov: 45,
  /** The walking camera can pull to 1.2 from the head; preserve nearby head/shoulder surfaces during that squeeze. */
  near: 0.15,
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
  /** The shoulder offset in use (eased): FOLLOW.shoulder, or less where a wall on the right leaves no room. */
  private shoulder: number = FOLLOW.shoulder;
  /** How far the view has risen over something low in the way (eased; see FOLLOW.rise). */
  private rise = 0;
  private readonly target = new THREE.Vector3();
  /** The courier's own eyes: collisions are judged from here (the target trails a little behind). */
  private readonly head = new THREE.Vector3();
  /** Where the camera looks: the target raised to the head, moved over the shoulder (in proportion as the camera is pulled in). */
  private readonly aim = new THREE.Vector3();
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
    this.shoulder = this.shoulderGoal();
    this.rise = this.riseGoal();
    this.radius = this.allowedRadius(this.distance);
    this.recovering = this.radius < this.distance;
    this.place();
  }

  /** Default framing behind the subject, flown in from wherever the camera is now (title to play, after landing). */
  swoopTo(subject: FollowSubject, seconds: number = FOLLOW.swoopSeconds): void {
    const from = this.camera.position.clone();
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    this.resetFraming(subject);
    this.shoulder = this.shoulderGoal();
    this.rise = this.riseGoal();
    this.radius = this.allowedRadius(this.distance);
    this.recovering = this.radius < this.distance;
    const fromLook = from.clone().addScaledVector(forward, Math.max(1, from.distanceTo(this.target)));
    this.swoop = { from, fromLook, fromQuat: this.camera.quaternion.clone(), elapsed: 0, duration: Math.max(0.01, seconds) };
  }

  /** Follow the subject through a teleport: keep the framing and move with it. */
  jumpTo(subject: FollowSubject): void {
    this.target.set(subject.x, subject.y + FOLLOW.targetLift, subject.z);
    this.head.set(subject.x, subject.y + FOLLOW.sightLift, subject.z);
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
    this.head.set(subject.x, subject.y + FOLLOW.sightLift, subject.z);

    // The target catches up, trailing a little while the courier moves.
    const speed = Math.hypot(subject.vx, subject.vz);
    this.target.x = lerp(this.target.x, subject.x, k(FOLLOW.catchUp));
    this.target.z = lerp(this.target.z, subject.z, k(FOLLOW.catchUp));
    this.target.y = lerp(this.target.y, subject.y + FOLLOW.targetLift, k(FOLLOW.catchUpY));

    // A diagonal velocity is an intentional camera-relative direction, not a reason to rotate the camera.
    // Fade recentring in only near straight ahead so crossing this boundary does not kick the orbit.
    const { recenter } = FOLLOW;
    if (!reduced && !this.dragging && this.sinceInput > recenter.delay && speed > recenter.minSpeed) {
      const forwardness = (subject.vx * Math.sin(this.yaw) - subject.vz * Math.cos(this.yaw)) / speed;
      const alignment = fit(forwardness, recenter.minForwardness, 1, 0, 1);
      const weight = alignment * alignment * (3 - 2 * alignment);
      const rate = fit(speed, recenter.minSpeed, WALK.runSpeed, recenter.slow, recenter.fast) * weight;
      this.desiredYaw = lerpAngleFPS(this.desiredYaw, subject.heading, rate, dt);
      this.desiredPitch = lerpFPS(this.desiredPitch, FOLLOW.pitch, rate * 0.5, dt);
    }

    const turn = k(this.dragging ? FOLLOW.rotate.dragK60 : FOLLOW.rotate.k60);
    this.yaw = wrapAngle(this.yaw + shortestAngle(this.yaw, this.desiredYaw) * turn);
    this.pitch = lerp(this.pitch, this.desiredPitch, turn);
    this.distance = lerp(this.distance, this.zoomGoal, k(FOLLOW.zoomK60));

    // Over the shoulder where there is room; then pull in at once when the view is blocked (never show the inside of
    // a wall), and ease back out slowly after a collision, or follow the zoom directly.
    this.shoulder = lerp(this.shoulder, this.shoulderGoal(), k(FOLLOW.shoulderK60));
    // Rising over something low: while the view climbs, the distance may be judged at the height it is rising to, so
    // the camera is not pulled in on the way up, but only when the camera's own path up there is clear (then only
    // its sight line grazes the low thing meanwhile, never the camera itself).
    const rise = this.riseGoal();
    this.rise = lerp(this.rise, rise, k(FOLLOW.rise.k60));
    let allowed = this.allowedRadius(this.distance, this.shoulder, this.rise);
    if (allowed < this.distance - 1e-6 && rise > this.rise + 1e-6 && this.risePathClear(rise)) {
      allowed = this.allowedRadius(this.distance, this.shoulder, rise);
    }
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
      this.look.lerpVectors(swoop.fromLook, this.aim, s);
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
    this.target.set(subject.x, subject.y + FOLLOW.targetLift, subject.z);
    this.head.set(subject.x, subject.y + FOLLOW.sightLift, subject.z);
    this.distance = this.zoomGoal;
  }

  /**
   * The shoulder offset to head for: the full one, unless the view over the shoulder is blocked (a wall or the house
   * fronts on the courier's right) while the view from straight behind is clearer.
   */
  private shoulderGoal(): number {
    const wide = this.allowedRadius(this.distance, FOLLOW.shoulder);
    if (wide >= this.distance - 1e-6) return FOLLOW.shoulder;
    return this.allowedRadius(this.distance, 0) > wide + 0.5 ? 0 : FOLLOW.shoulder;
  }

  /**
   * The rise (see FOLLOW.rise) to head for: the least at which the camera, at full distance, has a clear view from the
   * courier's eyes and sees its chest; failing that, the least that at least clears the view from the eyes (so the
   * camera is not pulled in); none when no rise helps (a wall, a house) or none is needed.
   */
  private riseGoal(): number {
    const sightClear = (rise: number) => this.allowedRadius(this.distance, this.shoulder, rise) >= this.distance - 1e-6;
    let fallback = sightClear(0) ? 0 : -1;
    if (fallback === 0 && this.chestInView(0)) return 0;
    for (let rise = FOLLOW.rise.step; rise <= FOLLOW.rise.max + 1e-9; rise += FOLLOW.rise.step) {
      if (this.pitch + rise > FOLLOW.maxPitch) break;
      if (!sightClear(rise)) continue;
      if (this.chestInView(rise)) return rise;
      if (fallback < 0) fallback = rise;
    }
    return Math.max(0, fallback);
  }

  /** True when the camera at full distance (pitch raised by `rise`) sees the courier's chest (the target) unobstructed. */
  private chestInView(rise: number): boolean {
    if (!this.world) return true;
    const { from, to, origin, target } = this;
    from.x = target.x - origin.x;
    from.y = target.y - origin.y;
    from.z = target.z - origin.z;
    this.orbitPoint(this.distance, this.shoulder, rise, to);
    return this.world.clearFraction(from, to, FOLLOW.collision.ignoreNear) >= 1;
  }

  /** True when the camera could move from its full orbit position now to the one risen by `rise` without passing through anything. */
  private risePathClear(rise: number): boolean {
    if (!this.world) return true;
    this.orbitPoint(this.distance, this.shoulder, this.rise, this.from);
    this.orbitPoint(this.distance, this.shoulder, rise, this.to);
    return this.world.clearFraction(this.to, this.from, 0) >= 1;
  }

  /** The camera's full orbit position (`distance` out, pitch raised by `rise`, `shoulder` to the right), island-local. */
  private orbitPoint(distance: number, shoulder: number, rise: number, out: { x: number; y: number; z: number }): void {
    const pitch = this.pitch + rise;
    const cos = Math.cos(pitch);
    const { origin, target } = this;
    out.x = target.x - origin.x - Math.sin(this.yaw) * cos * distance + Math.cos(this.yaw) * shoulder;
    out.y = target.y - origin.y + Math.sin(pitch) * distance;
    out.z = target.z - origin.z + Math.cos(this.yaw) * cos * distance + Math.sin(this.yaw) * shoulder;
  }

  /**
   * How far out the camera may sit along the current yaw and pitch (raised by `rise`, with the shoulder offset), given
   * the camera world.
   */
  private allowedRadius(distance: number, shoulder = this.shoulder, rise = this.rise): number {
    if (!this.world) return distance;
    // From the courier's eyes to where the camera would sit at full distance: the view that must stay clear.
    const { from, to, origin, head } = this;
    from.x = head.x - origin.x;
    from.y = head.y - origin.y;
    from.z = head.z - origin.z;
    this.orbitPoint(distance, shoulder, rise, to);
    const clear = this.world.clearFraction(from, to, FOLLOW.collision.ignoreNear);
    if (clear >= 1) return distance;
    return Math.min(distance, Math.max(FOLLOW.collision.minRadius, clear * distance - FOLLOW.collision.margin));
  }

  /**
   * Camera at the target plus the orbit offset (behind the look direction, up by the pitch, over the shoulder),
   * looking along the orbit at the target moved over the shoulder; never below the ground (whatever the smoothing did,
   * the view must not open inside a terrace).
   */
  private place(): void {
    const pitch = this.pitch + this.rise;
    const cos = Math.cos(pitch);
    const full = this.distance;
    // The view's right, for the shoulder offset (yaw 0 looks toward −Z, so its right is +X).
    const rightX = Math.cos(this.yaw), rightZ = Math.sin(this.yaw);
    // At full distance the camera orbits the target; pulled in, it slides toward the eyes along the line that the
    // collision test checked, so the courier stays in view (and the shoulder offset shrinks with it).
    const fx = this.target.x - Math.sin(this.yaw) * cos * full + rightX * this.shoulder;
    const fy = this.target.y + Math.sin(pitch) * full;
    const fz = this.target.z + Math.cos(this.yaw) * cos * full + rightZ * this.shoulder;
    const t = full > 1e-9 ? Math.min(1, this.radius / full) : 1;
    const x = this.head.x + (fx - this.head.x) * t;
    const z = this.head.z + (fz - this.head.z) * t;
    let y = this.head.y + (fy - this.head.y) * t;
    if (this.world) y = Math.max(y, this.world.floorAt(x - this.origin.x, z - this.origin.z) + this.origin.y);
    this.camera.position.set(x, y, z);
    this.aim.set(this.target.x + rightX * this.shoulder * t, this.target.y + FOLLOW.lookLift, this.target.z + rightZ * this.shoulder * t);
    this.camera.lookAt(this.aim);
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
