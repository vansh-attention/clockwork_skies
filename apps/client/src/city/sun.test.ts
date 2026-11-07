import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { illustratedEnvironment } from "@clockwork/render";
import { Sun } from "./sun";

describe("Sun", () => {
  it("shines along the shared sun direction, centred on the focus, with a square shadow of the asked size", () => {
    const sun = new Sun(1024);
    sun.follow(new THREE.Vector3(100, 40, -60), 90);
    const toSun = sun.light.position.clone().sub(sun.light.target.position).normalize();
    expect(toSun.angleTo(illustratedEnvironment.uSunDirection.value.clone().normalize())).toBeLessThan(1e-6);
    // Snapped to a texel (180 / 1024), so the target is within one texel of the focus.
    expect(sun.light.target.position.distanceTo(new THREE.Vector3(100, 40, -60))).toBeLessThan((180 / 1024) * 1.5);
    const camera = sun.light.shadow.camera;
    expect([camera.left, camera.right, camera.top, camera.bottom]).toEqual([-90, 90, 90, -90]);
    expect(camera.far).toBeGreaterThan(sun.light.position.distanceTo(sun.light.target.position));
    sun.dispose();
  });

  it("moves in whole texels, so a small step of the focus leaves the shadow where it was", () => {
    const sun = new Sun(2048);
    sun.follow(new THREE.Vector3(10, 0, 10), 100);
    const before = sun.light.target.position.clone();
    sun.follow(new THREE.Vector3(10.001, 0, 10.001), 100);
    // Only movement across the map shifts shadows; along the sun's own direction it changes depth alone.
    const along = illustratedEnvironment.uSunDirection.value.clone().normalize();
    const moved = sun.light.target.position.clone().sub(before);
    expect(moved.sub(along.multiplyScalar(moved.dot(along))).length()).toBeLessThan(1e-9);
    sun.dispose();
  });

  it("ignores a non-finite focus or a non-positive size", () => {
    const sun = new Sun();
    sun.follow(new THREE.Vector3(0, 0, 0), 50);
    const before = sun.light.position.clone();
    sun.follow(new THREE.Vector3(Number.NaN, 0, 0), 50);
    sun.follow(new THREE.Vector3(5, 0, 0), 0);
    expect(sun.light.position.distanceTo(before)).toBe(0);
    sun.dispose();
  });
});
