import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createCameraWorld } from "./cameraWorld";
import { FOLLOW, FollowCamera, attachFollowInput, type FollowSubject } from "./followCamera";

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

/** The camera's horizontal look direction as a heading (0 looks toward -Z, positive turns toward +X). */
function lookYaw(camera: THREE.PerspectiveCamera): number {
  const dir = camera.getWorldDirection(new THREE.Vector3());
  return Math.atan2(dir.x, -dir.z);
}

describe("FollowCamera framing", () => {
  it("snaps behind the subject at the default distance and pitch, looking at head height", () => {
    const { camera, follow } = rig();
    follow.snapBehind(subject({ heading: Math.PI / 2 }));
    const head = new THREE.Vector3(0, FOLLOW.targetLift, 0);
    const offset = camera.position.clone().sub(head);
    expect(offset.length()).toBeCloseTo(FOLLOW.distance, 6);
    // Facing +X, so the camera stands to the west (-X), above.
    expect(offset.x).toBeLessThan(-FOLLOW.distance * 0.8);
    expect(Math.asin(offset.y / offset.length())).toBeCloseTo(FOLLOW.pitch, 6);
    expect(lookYaw(camera)).toBeCloseTo(Math.PI / 2, 6);
  });

  it("trails a moving subject, then catches up to the default framing", () => {
    const { camera, follow } = rig();
    follow.snapBehind(subject());
    // Walk north (-Z) at 10/s for a second.
    run(follow, 1, 60, (t) => subject({ z: -10 * t, vz: -10 }));
    const head = new THREE.Vector3(0, FOLLOW.targetLift, -10);
    const leadAllowance = FOLLOW.lead.max + 1;
    expect(camera.position.distanceTo(head)).toBeGreaterThan(FOLLOW.distance - leadAllowance);
    expect(camera.position.distanceTo(head)).toBeLessThan(FOLLOW.distance + leadAllowance);
    run(follow, 3, 60, () => subject({ z: -10 }));
    expect(camera.position.distanceTo(head)).toBeCloseTo(FOLLOW.distance, 1);
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
    // The camera looks north; the subject heads north-east (forward-ish), so the camera should come round toward it.
    const heading = Math.PI / 4;
    run(follow, 4, 60, (t) => subject({ x: Math.sin(heading) * 10 * t, z: -Math.cos(heading) * 10 * t, vx: Math.sin(heading) * 10, vz: -Math.cos(heading) * 10, heading }));
    expect(lookYaw(camera)).toBeGreaterThan(heading * 0.6);
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
    const head = new THREE.Vector3(0, FOLLOW.targetLift, 0);
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
  // A wall 10 units behind a subject facing north: the camera behind it would sit inside the wall.
  const wall = createCameraWorld({
    ground: { surfaceAt: () => ({ height: 0, walkable: true }) },
    islandRadius: 1000,
    houses: [{ x: 0, z: 16, theta: 0, y: 0, width: 60, depth: 8, height: 40 }],
  });

  it("pulls in quickly in front of a wall and never sits inside it", () => {
    const { camera, follow } = rig();
    follow.setWorld(wall, { x: 0, y: 0, z: 0 });
    follow.snapBehind(subject());
    run(follow, 0.15, 60, () => subject());
    // The wall's near face (with padding) is at z = 16 - 4 - 1 = 11.
    expect(camera.position.z).toBeLessThan(11);
    run(follow, 1, 60, () => subject());
    expect(camera.position.z).toBeLessThan(11);
    expect(camera.position.distanceTo(new THREE.Vector3(0, FOLLOW.targetLift, 0))).toBeGreaterThan(2);
  });

  it("eases back out once the view is clear", () => {
    const { camera, follow } = rig();
    follow.setWorld(wall, { x: 0, y: 0, z: 0 });
    follow.snapBehind(subject());
    run(follow, 1, 60, () => subject());
    follow.setWorld(null, { x: 0, y: 0, z: 0 });
    follow.update(1 / 60, subject(), false);
    const head = new THREE.Vector3(0, FOLLOW.targetLift, 0);
    const justAfter = camera.position.distanceTo(head);
    expect(justAfter).toBeLessThan(FOLLOW.distance - 5);
    run(follow, 4, 60, () => subject());
    expect(camera.position.distanceTo(head)).toBeCloseTo(FOLLOW.distance, 1);
  });

  it("checks collisions in the island's own coordinates", () => {
    const { camera, follow } = rig();
    const origin = { x: 1000, y: 100, z: 0 };
    follow.setWorld(wall, origin);
    follow.snapBehind(subject({ x: 1000, y: 100 }));
    run(follow, 1, 60, () => subject({ x: 1000, y: 100 }));
    expect(camera.position.z).toBeLessThan(11);
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
    expect(camera.position.distanceTo(new THREE.Vector3(0, FOLLOW.targetLift, 0))).toBeCloseTo(FOLLOW.distance, 1);
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
    expect(camera.position.distanceTo(new THREE.Vector3(0, FOLLOW.targetLift, 0))).toBeCloseTo(FOLLOW.distance, 6);
    follow.update(1 / 60, subject({ z: -30, vz: -10, heading: 1 }), true);
    expect(camera.position.distanceTo(new THREE.Vector3(0, FOLLOW.targetLift, -30))).toBeCloseTo(FOLLOW.distance, 6);
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
  const wall = createCameraWorld({
    ground: { surfaceAt: () => ({ height: 0, walkable: true }) },
    islandRadius: 5000,
    houses: [{ x: 300, z: 16, theta: 0, y: 0, width: 60, depth: 8, height: 40 }],
  });
  const outsideWall = (camera: THREE.PerspectiveCamera) => !(camera.position.z > 11.25 && camera.position.z < 20.75 && Math.abs(camera.position.x - 300) < 30.75 && camera.position.y < 50);

  it("judges the distance afresh after a teleport next to a wall", () => {
    const { camera, follow } = rig();
    follow.setWorld(wall, { x: 0, y: 0, z: 0 });
    follow.snapBehind(subject());
    follow.jumpTo(subject({ x: 300 }));
    expect(outsideWall(camera)).toBe(true);
  });

  it("never shows the inside of a wall that appears suddenly, not even for a frame", () => {
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
