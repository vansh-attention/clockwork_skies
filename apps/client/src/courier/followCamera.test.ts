import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createCameraWorld } from "./cameraWorld";
import { FOLLOW, FollowCamera, attachFollowInput, type FollowSubject } from "./followCamera";
import { COURIER_HEIGHT } from "./size";

const subject = (over: Partial<FollowSubject> = {}): FollowSubject => ({ x: 0, y: 0, z: 0, heading: 0, vx: 0, vz: 0, ...over });

function rig() {
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.5, 5000);
  const follow = new FollowCamera(camera);
  return { camera, follow };
}

function run(follow: FollowCamera, seconds: number, fps: number, at: (t: number) => FollowSubject, reduced = false) {
  const frames = Math.round(seconds * fps);
  for (let i = 1; i <= frames; i += 1) follow.update(1 / fps, at(i / fps), reduced);
}

/** The point the camera orbits and looks at: the subject's target moved FOLLOW.shoulder to the right of a view along `yaw`. */
const aim = (x: number, z: number, yaw: number, y = FOLLOW.targetLift) =>
  new THREE.Vector3(x + Math.cos(yaw) * FOLLOW.shoulder, y, z + Math.sin(yaw) * FOLLOW.shoulder);

/** The camera's horizontal look direction as a heading (0 looks toward -Z, positive turns toward +X). */
function lookYaw(camera: THREE.PerspectiveCamera): number {
  const dir = camera.getWorldDirection(new THREE.Vector3());
  return Math.atan2(dir.x, -dir.z);
}

describe("FollowCamera framing", () => {
  it("snaps behind the subject at the default distance and pitch, looking at head height", () => {
    const { camera, follow } = rig();
    follow.snapBehind(subject({ heading: Math.PI / 2 }));
    const offset = camera.position.clone().sub(aim(0, 0, Math.PI / 2));
    expect(offset.length()).toBeCloseTo(FOLLOW.distance, 6);
    // Facing +X, so the camera stands to the west (-X), above.
    expect(offset.x).toBeLessThan(-FOLLOW.distance * 0.8);
    expect(Math.asin(offset.y / offset.length())).toBeCloseTo(FOLLOW.pitch, 6);
    expect(lookYaw(camera)).toBeCloseTo(Math.PI / 2, 6);
  });

  it("holds its distance from a running subject, as the reference's camera does", () => {
    const { camera, follow } = rig();
    follow.snapBehind(subject());
    // Run north (-Z) at 10/s for a second. The reference's camera stays the same distance from its character standing,
    // jogging and sprinting (live-timing.json), so this one neither falls back nor closes in.
    run(follow, 1, 60, (t) => subject({ z: -10 * t, vz: -10 }));
    expect(camera.position.distanceTo(aim(0, -10, 0))).toBeCloseTo(FOLLOW.distance, 3);
    run(follow, 3, 60, () => subject({ z: -10 }));
    expect(camera.position.distanceTo(aim(0, -10, 0))).toBeCloseTo(FOLLOW.distance, 3);
  });

  it("frames the subject as the reference frames its character: head at the centre, feet near the bottom, a little left", () => {
    const camera = new THREE.PerspectiveCamera(FOLLOW.fov, 16 / 9, FOLLOW.near, 5000);
    const follow = new FollowCamera(camera);
    follow.snapBehind(subject());
    // The reference's standing frames (1280×720, five views from two sessions): the top of its character's head at
    // y 345–358 px, its feet at 662–678 px (314–323 px tall), its centre line at x 485–505. Here, within 10 px of those.
    const py = (point: THREE.Vector3) => 360 - point.clone().project(camera).y * 360;
    const head = py(new THREE.Vector3(0, COURIER_HEIGHT, 0)); // the courier's height (size.ts)
    const feet = py(new THREE.Vector3(0, 0, 0));
    expect(head).toBeGreaterThan(335);
    expect(head).toBeLessThan(368);
    expect(feet).toBeGreaterThan(652);
    expect(feet).toBeLessThan(688);
    expect(feet - head).toBeGreaterThan(304);
    expect(feet - head).toBeLessThan(333);
    const x = 640 + new THREE.Vector3(0, FOLLOW.targetLift, 0).project(camera).x * 640;
    expect(x).toBeGreaterThan(475);
    expect(x).toBeLessThan(515);
  });

  it("gives the same result at 60 and 144 fps", () => {
    const a = rig();
    const b = rig();
    const path = (t: number) => subject({ x: 6 * t, z: -8 * t, vx: 6, vz: -8, heading: Math.atan2(6, 8) });
    a.follow.snapBehind(subject());
    b.follow.snapBehind(subject());
    run(a.follow, 1.5, 60, path);
    run(b.follow, 1.5, 144, path);
    expect(a.camera.position.distanceTo(b.camera.position)).toBeLessThan(0.15);
  });
});

describe("FollowCamera recentring", () => {
  it("swings back behind the subject while it walks forward", () => {
    const { camera, follow } = rig();
    follow.snapBehind(subject());
    // A small drift from straight ahead still lets the view settle gently behind the courier.
    const heading = Math.PI / 12;
    run(follow, 4, 60, (t) => subject({ x: Math.sin(heading) * 10 * t, z: -Math.cos(heading) * 10 * t, vx: Math.sin(heading) * 10, vz: -Math.cos(heading) * 10, heading }));
    expect(lookYaw(camera)).toBeGreaterThan(heading * 0.6);
  });

  it.each([-1, 1])("keeps a held camera-relative diagonal from steering the camera into a circle (side %s)", (side) => {
    for (const fps of [30, 60, 144]) {
      const { camera, follow } = rig();
      follow.snapBehind(subject());
      const dt = 1 / fps;
      let x = 0, z = 0;
      for (let frame = 0; frame < fps * 6; frame += 1) {
        // Model held W+A/D exactly as movement input does: direction is read from the actual current camera.
        const heading = lookYaw(camera) + side * Math.PI / 4;
        const vx = Math.sin(heading) * 10, vz = -Math.cos(heading) * 10;
        x += vx * dt; z += vz * dt;
        follow.update(dt, subject({ x, z, vx, vz, heading }), false);
        expect(Math.abs(lookYaw(camera))).toBeLessThan(1e-6);
      }
      expect(x / -z).toBeCloseTo(side, 5);
    }
  });

  it("does not spin round when the subject walks toward the camera", () => {
    const { camera, follow } = rig();
    follow.snapBehind(subject());
    run(follow, 3, 60, (t) => subject({ z: 10 * t, vz: 10, heading: Math.PI }));
    expect(Math.abs(lookYaw(camera))).toBeLessThan(0.05);
  });

  it("leaves the view alone for a moment after the player drags, and while dragging", () => {
    const { camera, follow } = rig();
    follow.snapBehind(subject());
    follow.drag(200, 0);
    run(follow, 0.4, 60, () => subject({ heading: 0 }));
    const dragged = lookYaw(camera);
    expect(dragged).toBeGreaterThan(0.5);
    // Still dragging: walking forward does not pull the view back.
    run(follow, 1, 60, (t) => subject({ z: -10 * t, vz: -10, heading: 0 }));
    expect(lookYaw(camera)).toBeCloseTo(dragged, 2);
    follow.endDrag();
  });
});

describe("FollowCamera input", () => {
  it("turns right when dragged right and looks down from higher when dragged down, within limits", () => {
    const { camera, follow } = rig();
    follow.snapBehind(subject());
    follow.drag(100, 0);
    follow.endDrag();
    run(follow, 0.5, 60, () => subject());
    expect(lookYaw(camera)).toBeGreaterThan(0.2);
    const before = camera.position.y;
    follow.drag(0, 100);
    follow.endDrag();
    run(follow, 0.5, 60, () => subject());
    expect(camera.position.y).toBeGreaterThan(before + 2);
    follow.drag(0, 100000);
    follow.endDrag();
    run(follow, 2, 60, () => subject());
    const offset = camera.position.clone().sub(new THREE.Vector3(0, FOLLOW.targetLift, 0));
    expect(Math.asin(offset.y / offset.length())).toBeLessThanOrEqual(FOLLOW.maxPitch + 1e-6);
  });

  it("zooms in and out with the wheel, eased and clamped", () => {
    const { camera, follow } = rig();
    follow.snapBehind(subject());
    const head = aim(0, 0, 0);
    follow.zoom(-100000);
    follow.update(1 / 60, subject(), false);
    expect(camera.position.distanceTo(head)).toBeGreaterThan(FOLLOW.minDistance + 0.5);
    run(follow, 2, 60, () => subject());
    expect(camera.position.distanceTo(head)).toBeCloseTo(FOLLOW.minDistance, 2);
    follow.zoom(100000);
    run(follow, 3, 60, () => subject());
    expect(camera.position.distanceTo(head)).toBeCloseTo(FOLLOW.maxDistance, 1);
  });
});

describe("FollowCamera collision", () => {
  // A wall behind a subject facing north, near enough that the camera can neither sit at full distance nor rise clear
  // of it. Its near face, padded 0.75 by the camera world, is at z = 9.5 - 4 - 0.75 = 4.75.
  const WALL_FACE = 4.75;
  const wall = createCameraWorld({
    ground: { surfaceAt: () => ({ height: 0, walkable: true }) },
    islandRadius: 1000,
    houses: [{ x: 0, z: 9.5, theta: 0, y: 0, width: 60, depth: 8, height: 40 }],
  });
  /** The premise of these tests: at full distance, even risen as far as it goes, the camera would sit inside the wall. */
  const wallPins = () => expect(FOLLOW.distance * Math.cos(FOLLOW.pitch + FOLLOW.rise.max)).toBeGreaterThan(WALL_FACE + 1);

  it("pulls in quickly in front of a wall and never sits inside it", () => {
    wallPins();
    const { camera, follow } = rig();
    follow.setWorld(wall, { x: 0, y: 0, z: 0 });
    follow.snapBehind(subject());
    run(follow, 0.15, 60, () => subject());
    expect(camera.position.z).toBeLessThan(WALL_FACE);
    run(follow, 1, 60, () => subject());
    expect(camera.position.z).toBeLessThan(WALL_FACE);
    expect(camera.position.distanceTo(new THREE.Vector3(0, FOLLOW.targetLift, 0))).toBeGreaterThan(2);
  });

  it("keeps nearby head and shoulder surfaces inside the depth clip range when a wall pins the camera close", () => {
    const camera = new THREE.PerspectiveCamera(FOLLOW.fov, 16 / 9, FOLLOW.near, 5000);
    const follow = new FollowCamera(camera);
    const closeWall = createCameraWorld({
      ground: { surfaceAt: () => ({ height: 0, walkable: true }) }, islandRadius: 100,
      boxes: [{ x: 0, z: 3.6, theta: 0, halfX: 10, halfZ: 2, bottom: 0, top: 12 }],
    });
    follow.setWorld(closeWall, { x: 0, y: 0, z: 0 });
    follow.snapBehind(subject());
    run(follow, 0.2, 60, () => subject());
    // Pinned, the camera sits at the minimum radius: that fraction of the way (minRadius / distance) along the line
    // from the courier's eyes (the sight line's origin) to its full orbit position, above and behind the head.
    const lift = FOLLOW.sightLift - FOLLOW.targetLift;
    // (The shoulder offset is square to both the view and the lift.)
    const fullFromEyes = Math.sqrt(FOLLOW.distance ** 2 - 2 * lift * FOLLOW.distance * Math.sin(FOLLOW.pitch) + lift ** 2 + FOLLOW.shoulder ** 2);
    expect(camera.position.distanceTo(new THREE.Vector3(0, FOLLOW.sightLift, 0)))
      .toBeCloseTo(FOLLOW.collision.minRadius * fullFromEyes / FOLLOW.distance, 5);
    expect(camera.position.y).toBeGreaterThan(FOLLOW.sightLift);
    expect(camera.position.z).toBeLessThan(1.6); // camera remains in front of the wall
    // The back of the courier's head and its nape project toward the pinned camera. They are within a metre of its
    // lens, even though its focus is further away. Check depth only: this close framing may crop them at an edge.
    const surfaces = [new THREE.Vector3(0, FOLLOW.sightLift + 0.15, 0.28), new THREE.Vector3(0, FOLLOW.sightLift - 0.1, 0.27)];
    const oldClip = camera.clone();
    oldClip.near = 1;
    oldClip.updateProjectionMatrix();
    for (const point of surfaces) {
      const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z;
      expect(depth).toBeGreaterThan(camera.near);
      expect(depth).toBeLessThan(1);
      const projected = point.clone().project(camera);
      expect(projected.z).toBeGreaterThan(-1);
      expect(projected.z).toBeLessThan(1);
      expect(point.clone().project(oldClip).z).toBeLessThan(-1); // regression: the former near=1 clipped these surfaces
    }
  });

  it("eases back out once the view is clear", () => {
    const { camera, follow } = rig();
    follow.setWorld(wall, { x: 0, y: 0, z: 0 });
    follow.snapBehind(subject());
    run(follow, 1, 60, () => subject());
    // Pulled in, the camera lies on the line from the eyes (the sight origin) to its full orbit position, at a
    // distance along it in proportion to the allowed radius; so measured from the eyes it eases out linearly.
    const eyes = new THREE.Vector3(0, FOLLOW.sightLift, 0);
    const lift = FOLLOW.sightLift - FOLLOW.targetLift;
    const fullFromEyes = Math.sqrt(FOLLOW.distance ** 2 - 2 * lift * FOLLOW.distance * Math.sin(FOLLOW.pitch) + lift ** 2 + FOLLOW.shoulder ** 2);
    const pinned = camera.position.distanceTo(eyes);
    wallPins();
    expect(pinned).toBeLessThan(fullFromEyes - 1);
    follow.setWorld(null, { x: 0, y: 0, z: 0 });
    follow.update(1 / 60, subject(), false);
    const justAfter = camera.position.distanceTo(eyes);
    expect(justAfter).toBeCloseTo(pinned + (fullFromEyes - pinned) * FOLLOW.collision.outK60, 6);
    expect(justAfter).toBeLessThan(fullFromEyes);
    run(follow, 4, 60, () => subject());
    // Back out at its full orbit round the target.
    expect(camera.position.distanceTo(aim(0, 0, 0))).toBeCloseTo(FOLLOW.distance, 1);
  });

  it("rises over something low behind the subject rather than being pulled in", () => {
    // A low obstacle (as a parked cab, a little above the eyes) between the subject and the camera.
    const low = createCameraWorld({
      ground: { surfaceAt: () => ({ height: 0, walkable: true }) }, islandRadius: 1000,
      boxes: [{ x: 0, z: 3, theta: 0, halfX: 6, halfZ: 1.2, bottom: 0, top: 3.95 }],
    });
    const { camera, follow } = rig();
    follow.setWorld(low, { x: 0, y: 0, z: 0 });
    follow.snapBehind(subject());
    run(follow, 2, 60, () => subject());
    const aimed = aim(0, 0, 0);
    expect(camera.position.distanceTo(aimed)).toBeCloseTo(FOLLOW.distance, 1);
    const offset = camera.position.clone().sub(aimed);
    const elevation = Math.asin(offset.y / offset.length());
    expect(elevation).toBeGreaterThan(FOLLOW.pitch + 0.05);
    expect(elevation).toBeLessThanOrEqual(FOLLOW.pitch + FOLLOW.rise.max + 1e-6);
    // Clear of it, the view settles back to its pitch.
    follow.setWorld(null, { x: 0, y: 0, z: 0 });
    run(follow, 3, 60, () => subject());
    const settled = camera.position.clone().sub(aim(0, 0, 0));
    expect(Math.asin(settled.y / settled.length())).toBeCloseTo(FOLLOW.pitch, 2);
  });

  it("rises to keep the subject in view over something low its eyes can see past", () => {
    // A cab-like obstacle just below the sight line from the eyes but above it from the chest: without rising, the
    // camera would keep its distance and lose the subject behind it.
    const low = createCameraWorld({
      ground: { surfaceAt: () => ({ height: 0, walkable: true }) }, islandRadius: 1000,
      boxes: [{ x: 0, z: 4, theta: 0, halfX: 6, halfZ: 2, bottom: 0, top: 3.8 }],
    });
    const { camera, follow } = rig();
    follow.setWorld(low, { x: 0, y: 0, z: 0 });
    follow.snapBehind(subject());
    run(follow, 2, 60, () => subject());
    expect(camera.position.distanceTo(aim(0, 0, 0))).toBeCloseTo(FOLLOW.distance, 1);
    const chest = new THREE.Vector3(0, FOLLOW.targetLift, 0);
    expect(low.clearFraction(chest, camera.position)).toBe(1);
  });

  it("slides back behind the subject, rather than being pulled in, beside a wall on its right", () => {
    // Walking along house fronts on the right: over the shoulder the view would hit them, straight behind it is clear.
    const houseFronts = createCameraWorld({
      ground: { surfaceAt: () => ({ height: 0, walkable: true }) }, islandRadius: 1000,
      boxes: [{ x: 4.2, z: 0, theta: 0, halfX: 3, halfZ: 40, bottom: 0, top: 20 }],
    });
    const { camera, follow } = rig();
    follow.setWorld(houseFronts, { x: 0, y: 0, z: 0 });
    follow.snapBehind(subject());
    run(follow, 2, 60, () => subject());
    expect(Math.abs(camera.position.x)).toBeLessThan(0.05);
    expect(camera.position.distanceTo(new THREE.Vector3(0, FOLLOW.targetLift, 0))).toBeCloseTo(FOLLOW.distance, 1);
    // Away from the wall the view goes back over the shoulder.
    follow.setWorld(null, { x: 0, y: 0, z: 0 });
    run(follow, 2, 60, () => subject());
    expect(camera.position.x).toBeCloseTo(FOLLOW.shoulder, 1);
  });

  it("checks collisions in the island's own coordinates", () => {
    const { camera, follow } = rig();
    const origin = { x: 1000, y: 100, z: 0 };
    follow.setWorld(wall, origin);
    follow.snapBehind(subject({ x: 1000, y: 100 }));
    run(follow, 1, 60, () => subject({ x: 1000, y: 100 }));
    wallPins();
    expect(camera.position.z).toBeLessThan(WALL_FACE);
  });
});

describe("FollowCamera transitions", () => {
  it("swoops from where the camera was to the follow framing", () => {
    const { camera, follow } = rig();
    camera.position.set(900, 600, 900);
    camera.lookAt(0, 0, 0);
    follow.swoopTo(subject(), 1);
    follow.update(1 / 60, subject(), false);
    expect(camera.position.distanceTo(new THREE.Vector3(900, 600, 900))).toBeLessThan(5);
    run(follow, 0.5, 60, () => subject());
    const mid = camera.position.length();
    expect(mid).toBeLessThan(1300);
    expect(mid).toBeGreaterThan(FOLLOW.distance + 10);
    run(follow, 0.6, 60, () => subject());
    expect(camera.position.distanceTo(aim(0, 0, 0))).toBeCloseTo(FOLLOW.distance, 1);
    expect(follow.swooping).toBe(false);
  });

  it("carries the framing through a teleport", () => {
    const { camera, follow } = rig();
    follow.snapBehind(subject());
    const before = camera.position.clone();
    follow.jumpTo(subject({ x: 50, z: -20 }));
    expect(camera.position.clone().sub(before).distanceTo(new THREE.Vector3(50, 0, -20))).toBeLessThan(1e-9);
  });

  it("snaps to the follow pose under reduced motion (no swoop, no lag, no recentring)", () => {
    const { camera, follow } = rig();
    camera.position.set(900, 600, 900);
    follow.swoopTo(subject(), 1);
    follow.update(1 / 60, subject(), true);
    expect(camera.position.distanceTo(aim(0, 0, 0))).toBeCloseTo(FOLLOW.distance, 6);
    follow.update(1 / 60, subject({ z: -30, vz: -10, heading: 1 }), true);
    expect(camera.position.distanceTo(aim(0, -30, 0))).toBeCloseTo(FOLLOW.distance, 6);
    expect(lookYaw(camera)).toBeCloseTo(0, 6);
  });

  it("ignores bad frame times", () => {
    const { camera, follow } = rig();
    follow.snapBehind(subject());
    const before = camera.position.clone();
    follow.update(Number.NaN, subject({ x: 40 }), false);
    follow.update(-1, subject({ x: 40 }), false);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-9);
  });
});

describe("attachFollowInput", () => {
  const pointer = (type: string, x: number, y: number) => Object.assign(new Event(type), { clientX: x, clientY: y, button: 0, pointerId: 1 });
  const wheel = (deltaY: number) => Object.assign(new Event("wheel", { cancelable: true }), { deltaY });

  function fakeFollow() {
    const calls: string[] = [];
    return {
      calls,
      drag: (dx: number, dy: number) => { calls.push(`drag ${dx},${dy}`); },
      endDrag: () => { calls.push("end"); },
      zoom: (delta: number) => { calls.push(`zoom ${delta}`); },
    };
  }

  it("turns pointer drags into drag deltas and the wheel into zoom while active", () => {
    const canvas = new EventTarget();
    const follow = fakeFollow();
    const detach = attachFollowInput(canvas, follow, () => true);
    canvas.dispatchEvent(pointer("pointerdown", 100, 100));
    canvas.dispatchEvent(pointer("pointermove", 130, 90));
    canvas.dispatchEvent(pointer("pointermove", 140, 95));
    canvas.dispatchEvent(pointer("pointerup", 140, 95));
    const event = wheel(120);
    canvas.dispatchEvent(event);
    expect(follow.calls).toEqual(["drag 30,-10", "drag 10,5", "end", "zoom 120"]);
    expect(event.defaultPrevented).toBe(true);
    detach();
    canvas.dispatchEvent(pointer("pointerdown", 0, 0));
    canvas.dispatchEvent(pointer("pointermove", 50, 0));
    canvas.dispatchEvent(wheel(10));
    expect(follow.calls).toHaveLength(4);
  });

  it("ignores input while inactive (flying, suspended) and ends a drag that outlives it", () => {
    const canvas = new EventTarget();
    const follow = fakeFollow();
    let active = false;
    attachFollowInput(canvas, follow, () => active);
    canvas.dispatchEvent(pointer("pointerdown", 0, 0));
    canvas.dispatchEvent(pointer("pointermove", 40, 0));
    canvas.dispatchEvent(wheel(50));
    expect(follow.calls).toEqual([]);
    active = true;
    canvas.dispatchEvent(pointer("pointerdown", 0, 0));
    active = false;
    canvas.dispatchEvent(pointer("pointermove", 40, 0));
    expect(follow.calls).toEqual(["end"]);
  });
});

describe("review fixes", () => {
  // A wall whose padded box (0.75 round the house) spans z = 11.5 ± 4.75: its near face lies inside the camera's
  // resting reach, so a camera left at full distance would sit in it.
  const WALL_NEAR = 6.75, WALL_FAR = 16.25;
  const wall = createCameraWorld({
    ground: { surfaceAt: () => ({ height: 0, walkable: true }) },
    islandRadius: 5000,
    houses: [{ x: 300, z: 11.5, theta: 0, y: 0, width: 60, depth: 8, height: 40 }],
  });
  const outsideWall = (camera: THREE.PerspectiveCamera) => !(camera.position.z > WALL_NEAR && camera.position.z < WALL_FAR && Math.abs(camera.position.x - 300) < 30.75 && camera.position.y < 50);
  /** The premise: at full distance and resting pitch the camera would sit inside the wall. */
  const wallInReach = () => expect(FOLLOW.distance * Math.cos(FOLLOW.pitch)).toBeGreaterThan(WALL_NEAR + 0.5);

  it("judges the distance afresh after a teleport next to a wall", () => {
    wallInReach();
    const { camera, follow } = rig();
    follow.setWorld(wall, { x: 0, y: 0, z: 0 });
    follow.snapBehind(subject());
    follow.jumpTo(subject({ x: 300 }));
    expect(outsideWall(camera)).toBe(true);
  });

  it("never shows the inside of a wall that appears suddenly, not even for a frame", () => {
    wallInReach();
    const { camera, follow } = rig();
    follow.setWorld(wall, { x: 0, y: 0, z: 0 });
    follow.snapBehind(subject({ x: 200 }));
    // Walk sideways in front of the wall: from open ground into its shadow.
    for (let i = 1; i <= 240; i += 1) {
      follow.update(1 / 60, subject({ x: 200 + i * 0.6, vx: 36 }), false);
      expect(outsideWall(camera)).toBe(true);
    }
  });

  it("arcs the swoop up over what lies between, and eases out the old roll", () => {
    const { camera, follow } = rig();
    camera.position.set(-600, 300, 0);
    camera.lookAt(0, 0, 0);
    camera.rotateZ(0.4);
    const rolled = camera.quaternion.clone();
    follow.swoopTo(subject(), 1);
    follow.update(1 / 600, subject(), false);
    expect(camera.quaternion.angleTo(rolled)).toBeLessThan(0.01);
    run(follow, 0.5, 60, () => subject());
    // Halfway, a straight line from (-600, 300) to the follow pose would be about 150 up; the arc is well above it.
    expect(camera.position.y).toBeGreaterThan(250);
    run(follow, 0.6, 60, () => subject());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    expect(Math.abs(right.y)).toBeLessThan(1e-6);
    expect(up.y).toBeGreaterThan(0);
  });

  it("ignores a subject with bad numbers", () => {
    const { camera, follow } = rig();
    follow.snapBehind(subject());
    const before = camera.position.clone();
    follow.update(1 / 60, subject({ x: Number.NaN }), false);
    follow.update(1 / 60, subject(), false);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-6);
  });
});
