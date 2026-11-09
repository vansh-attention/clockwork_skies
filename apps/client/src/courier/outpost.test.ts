import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Vec3 } from "@clockwork/shared";
import { HOME_LAUNCH_SITE, createHillTownLayout as createCityLayout, createHillTownLayout, polarToXZ } from "../city/layout";
import { Palette, type MaterialKey, type MaterialSource } from "../city/kit";
import {
  HOME_GATE, HOME_PAD, KEEPER_DOOR, LANTERNFALL_CENTER, LANTERNFALL_GATE, LANTERNFALL_LAYOUT, LANTERNFALL_PAD, LANTERNFALL_RADIUS,
  buildLanternfall, buildLaunchersAndGates, createHomeWalkWorld, createLanternfallWalkWorld, gateCrossed, launchRelease, skyWorld,
  type Gate, launcherBox } from "./outpost";
import { createSkyPlane, stepSkyPlane } from "./skyFlight";
import { createHillTownWalkWorld } from "./walkWorld";

const BEARING = 70 * Math.PI / 180;
const ALLOWED_KEYS = new Set<string>([
  "ground", "terrace", "paving", "stone", "rock", "strata", "wall0", "wall1", "wall2", "roof0", "roof1", "roof2",
  "ink", "trunk", "leaf0", "leaf1", "leaf2", "brass", "copper", "face",
  // Window glass, painted doors and iron railings and lamps, from the shared house and furniture kit.
  "glass", "coat", "leather", "iron",
]);

/** A real palette that remembers which keys were requested. */
function recordingPalette() {
  const palette = new Palette();
  const keys = new Set<string>();
  const source: MaterialSource = { get: (key: MaterialKey) => { keys.add(key); return palette.get(key); } };
  return { source, keys };
}

const meshesOf = (root: THREE.Object3D) => {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
  return meshes;
};
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3, scale = 1): Vec3 => ({ x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale });
const toLocal = (world: Vec3) => sub(world, LANTERNFALL_CENTER);

describe("layout launch site", () => {
  it("exports the home launcher site", () => {
    expect(HOME_LAUNCH_SITE).toEqual({ bearing: Math.PI / 2, radius: 444, clear: 26 });
  });

  it("keeps trees clear of the launcher", () => {
    const site = polarToXZ(HOME_LAUNCH_SITE.bearing, HOME_LAUNCH_SITE.radius);
    for (const tree of createCityLayout().trees) {
      expect(Math.hypot(tree.x - site.x, tree.z - site.z)).toBeGreaterThanOrEqual(HOME_LAUNCH_SITE.clear);
    }
  });
});

describe("constants", () => {
  it("places Lanternfall 2400 away at bearing 70 degrees and 120 up", () => {
    expect(LANTERNFALL_RADIUS).toBe(230);
    expect(LANTERNFALL_CENTER.x).toBeCloseTo(Math.sin(BEARING) * 2400, 6);
    expect(LANTERNFALL_CENTER.z).toBeCloseTo(-Math.cos(BEARING) * 2400, 6);
    expect(LANTERNFALL_CENTER.y).toBe(120);
  });

  it("puts the home pad at the launch site on the ground, facing east", () => {
    const site = polarToXZ(HOME_LAUNCH_SITE.bearing, HOME_LAUNCH_SITE.radius);
    expect(HOME_PAD.island).toBe("home");
    expect(HOME_PAD.position.x).toBeCloseTo(site.x, 6);
    expect(HOME_PAD.position.z).toBeCloseTo(site.z, 6);
    expect(HOME_PAD.position.y).toBe(0);
    expect(HOME_PAD.yaw).toBeCloseTo(Math.PI / 2, 9);
  });

  it("puts the Lanternfall pad on the home-facing side at local radius 200, facing home", () => {
    const local = toLocal(LANTERNFALL_PAD.position);
    expect(LANTERNFALL_PAD.island).toBe("lanternfall");
    expect(local.y).toBeCloseTo(0, 9);
    expect(Math.hypot(local.x, local.z)).toBeCloseTo(200, 6);
    // The island centre lies on the far side of the pad from home.
    const towardHome = { x: -LANTERNFALL_CENTER.x, y: 0, z: -LANTERNFALL_CENTER.z };
    const homeLength = Math.hypot(towardHome.x, towardHome.z);
    expect(dot(local, towardHome) / homeLength).toBeCloseTo(200, 6);
    const forward = { x: Math.sin(LANTERNFALL_PAD.yaw), y: 0, z: -Math.cos(LANTERNFALL_PAD.yaw) };
    // The pad faces home, so the return launch heads straight for the home gate.
    expect(dot(forward, towardHome) / homeLength).toBeCloseTo(1, 6);
    expect(Math.abs(LANTERNFALL_PAD.yaw)).toBeLessThanOrEqual(Math.PI);
  });

  it("describes the Lanternfall gate on the line from the home pad, 90 before the rim and 45 above the ground", () => {
    const line = { x: LANTERNFALL_CENTER.x - HOME_PAD.position.x, z: LANTERNFALL_CENTER.z - HOME_PAD.position.z };
    const length = Math.hypot(line.x, line.z);
    const u = { x: line.x / length, z: line.z / length };
    const gate = LANTERNFALL_GATE;
    expect(gate.radius).toBe(40);
    expect(gate.center.y).toBeCloseTo(165, 9);
    expect(gate.direction.y).toBe(0);
    expect(gate.direction.x).toBeCloseTo(u.x, 9);
    expect(gate.direction.z).toBeCloseTo(u.z, 9);
    expect(Math.hypot(gate.center.x - LANTERNFALL_CENTER.x, gate.center.z - LANTERNFALL_CENTER.z)).toBeCloseTo(230 + 90, 6);
    expect(gate.center.x).toBeCloseTo(LANTERNFALL_CENTER.x - u.x * 320, 6);
    expect(gate.center.z).toBeCloseTo(LANTERNFALL_CENTER.z - u.z * 320, 6);
  });

  it("describes the home gate on the line from the Lanternfall pad, 90 outside the home rim at y 60", () => {
    const gate = HOME_GATE;
    const pad = LANTERNFALL_PAD.position;
    const length = Math.hypot(pad.x, pad.z);
    expect(gate.radius).toBe(40);
    expect(gate.center.y).toBeCloseTo(60, 9);
    expect(gate.direction.y).toBe(0);
    expect(gate.direction.x).toBeCloseTo(-pad.x / length, 9);
    expect(gate.direction.z).toBeCloseTo(-pad.z / length, 9);
    expect(Math.hypot(gate.center.x, gate.center.z)).toBeCloseTo(560, 6);
    expect(gate.center.x * pad.z - gate.center.z * pad.x).toBeCloseTo(0, 3);
  });

  it("is hit by flying straight from each pad at the other island", () => {
    const flat = (from: Vec3, to: Vec3, y: number) => [{ ...from, y }, { ...to, y }] as const;
    const [out0, out1] = flat(HOME_PAD.position, LANTERNFALL_CENTER, LANTERNFALL_GATE.center.y);
    expect(gateCrossed(LANTERNFALL_GATE, out0, out1)).toBe(true);
    const [back0, back1] = flat(LANTERNFALL_PAD.position, { x: 0, y: 0, z: 0 }, HOME_GATE.center.y);
    expect(gateCrossed(HOME_GATE, back0, back1)).toBe(true);
  });

  it("parks each gate on its own island's pad", () => {
    expect(LANTERNFALL_GATE.island).toBe("lanternfall");
    expect(LANTERNFALL_GATE.parkAt).toBe(LANTERNFALL_PAD);
    expect(HOME_GATE.island).toBe("home");
    expect(HOME_GATE.parkAt).toBe(HOME_PAD);
  });

  it("puts the keeper's door on the path between the pad and the lighthouse", () => {
    const door = toLocal(KEEPER_DOOR);
    const pad = toLocal(LANTERNFALL_PAD.position);
    expect(door.y).toBeCloseTo(0, 9);
    const doorRadius = Math.hypot(door.x, door.z);
    expect(doorRadius).toBeGreaterThan(20);
    expect(doorRadius).toBeLessThan(60);
    // Collinear with the centre and the pad, on the pad's side.
    expect(door.x * pad.z - door.z * pad.x).toBeCloseTo(0, 4);
    expect(dot(door, pad)).toBeGreaterThan(0);
  });
});

describe("gateCrossed", () => {
  const gate: Gate = LANTERNFALL_GATE;
  const along = (distance: number, side = 0, lift = 0): Vec3 => {
    const sideways = { x: -gate.direction.z, y: 0, z: gate.direction.x };
    return add(add(add(gate.center, gate.direction, distance), sideways, side), { x: 0, y: 1, z: 0 }, lift);
  };

  it("is true through the centre along the direction", () => {
    expect(gateCrossed(gate, along(-5), along(5))).toBe(true);
  });

  it("is true near the edge of the ring and false just outside it", () => {
    expect(gateCrossed(gate, along(-5, 39), along(5, 39))).toBe(true);
    expect(gateCrossed(gate, along(-5, 0, -39), along(5, 0, -39))).toBe(true);
    expect(gateCrossed(gate, along(-5, 41), along(5, 41))).toBe(false);
    expect(gateCrossed(gate, along(-5, 30, 30), along(5, 30, 30))).toBe(false);
  });

  it("is false in the reverse direction", () => {
    expect(gateCrossed(gate, along(5), along(-5))).toBe(false);
  });

  it("is false for segments that stop short of, or start beyond, the plane", () => {
    expect(gateCrossed(gate, along(-20), along(-1))).toBe(false);
    expect(gateCrossed(gate, along(1), along(20))).toBe(false);
  });

  it("is false for a segment that runs parallel to the plane", () => {
    expect(gateCrossed(gate, along(-5, -10), along(-5, 10))).toBe(false);
  });

  it("counts a segment that ends exactly on the plane, and only once", () => {
    expect(gateCrossed(gate, along(-5), along(0))).toBe(true);
    expect(gateCrossed(gate, along(0), along(5))).toBe(false);
  });

  it("is false for non-finite input", () => {
    expect(gateCrossed(gate, along(-5), { x: Number.NaN, y: 0, z: 0 })).toBe(false);
    expect(gateCrossed(gate, { x: 0, y: Number.POSITIVE_INFINITY, z: 0 }, along(5))).toBe(false);
  });

  it("works for the home gate with its own direction", () => {
    const back = (distance: number): Vec3 => add(HOME_GATE.center, HOME_GATE.direction, distance);
    expect(gateCrossed(HOME_GATE, back(-5), back(5))).toBe(true);
    expect(gateCrossed(HOME_GATE, back(5), back(-5))).toBe(false);
  });
});

describe("skyWorld", () => {
  const world = skyWorld();

  it("describes the three solids and the world limits", () => {
    expect(world.edgeRadius).toBe(4200);
    expect(world.floor).toBe(-700);
    expect(world.ceiling).toBe(800);
    expect(world.islands).toEqual([
      { x: 0, y: 0, z: 0, radius: 470, top: 80, depth: 500 },
      { x: 0, y: 0, z: 0, radius: 22, top: 260, depth: 0 },
      { x: LANTERNFALL_CENTER.x, y: 120, z: LANTERNFALL_CENTER.z, radius: 230, top: 70, depth: 260 },
    ]);
  });

  it("keeps every island inside [floor, ceiling]", () => {
    for (const island of world.islands) {
      expect(world.floor).toBeLessThan(island.y - island.depth);
      expect(island.y + island.top + 6).toBeLessThan(world.ceiling);
    }
  });

  it("returns a fresh object each call", () => {
    expect(skyWorld()).not.toBe(skyWorld());
  });

  it("keeps both gate rings outside every island's push-out zone", () => {
    for (const gate of [LANTERNFALL_GATE, HOME_GATE]) {
      for (const island of world.islands) {
        const distance = Math.hypot(gate.center.x - island.x, gate.center.z - island.z);
        expect(distance - gate.radius).toBeGreaterThan(island.radius + 4);
      }
    }
  });

  it("releases a launched plane 60 ahead of the pad and 100 up", () => {
    for (const pad of [HOME_PAD, LANTERNFALL_PAD]) {
      const release = launchRelease(pad);
      expect(release.x).toBeCloseTo(pad.position.x + Math.sin(pad.yaw) * 60, 9);
      expect(release.y).toBeCloseTo(pad.position.y + 100, 9);
      expect(release.z).toBeCloseTo(pad.position.z - Math.cos(pad.yaw) * 60, 9);
    }
  });

  it.each([["home", HOME_PAD], ["Lanternfall", LANTERNFALL_PAD]] as const)(
    "lets a plane released from the %s pad fly 3 seconds without touching an island", (_name, pad) => {
      const plane = createSkyPlane(launchRelease(pad), pad.yaw);
      const input = { aimX: 0, aimY: -0.3, throttle: 1, fineRoll: 0, boost: false };
      for (let tick = 0; tick < 3 * 60; tick += 1) {
        const step = stepSkyPlane(plane, input, 1 / 60, world);
        expect(step.bumped).toBe(false);
        expect(step.contact).toBe(false);
      }
    });
});

describe("home ground", () => {
  it("leaves the home pad on walkable, unblocked ground", () => {
    const world = createHillTownWalkWorld(createHillTownLayout());
    const { x, z } = HOME_PAD.position;
    expect(world.surfaceAt(x, z)).toEqual({ height: 0, walkable: true });
    expect(world.blocked(x, z, 1.5)).toBe(false);
  });

  describe("createHomeWalkWorld", () => {
    const town = createHillTownWalkWorld(createHillTownLayout());
    const world = createHomeWalkWorld();
    const { x, z } = HOME_PAD.position;
    const forward = { x: Math.sin(HOME_PAD.yaw), z: -Math.cos(HOME_PAD.yaw) };
    const right = { x: Math.cos(HOME_PAD.yaw), z: Math.sin(HOME_PAD.yaw) };

    it("blocks the launcher uprights behind the pad but not the pad centre or the gap between them", () => {
      for (const side of [-4, 4]) {
        expect(world.blocked(x - forward.x * 8 + right.x * side, z - forward.z * 8 + right.z * side, 0.5)).toBe(true);
      }
      expect(world.blocked(x, z, 1.5)).toBe(false);
      expect(world.blocked(x - forward.x * 8, z - forward.z * 8, 0.5)).toBe(false);
    });

    it("otherwise behaves as the hill town", () => {
      for (const [px, pz] of [[0, 0], [100, 40], [-300, 200], [440, 0], [468, 0]] as const) {
        expect(world.surfaceAt(px, pz)).toEqual(town.surfaceAt(px, pz));
        const post = Math.hypot(px - (x - forward.x * 8), pz - (z - forward.z * 8)) < 8;
        if (!post) expect(world.blocked(px, pz, 1.5)).toBe(town.blocked(px, pz, 1.5));
      }
    });

    it("fails closed on non-finite input", () => {
      expect(world.blocked(Number.NaN, 0, 1.5)).toBe(true);
      expect(world.surfaceAt(Number.NaN, 0).walkable).toBe(false);
    });
  });
});

describe("buildLanternfall", () => {
  const { source, keys } = recordingPalette();
  const built = buildLanternfall(source);
  const meshes = meshesOf(built.group);

  it("sits at the island centre", () => {
    expect(built.group.position.toArray()).toEqual([LANTERNFALL_CENTER.x, LANTERNFALL_CENTER.y, LANTERNFALL_CENTER.z]);
  });

  it("stays within about 25 meshes", () => {
    expect(meshes.length).toBeGreaterThan(8);
    expect(meshes.length).toBeLessThanOrEqual(25);
  });

  it("uses only existing palette keys", () => {
    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) expect(ALLOWED_KEYS.has(key)).toBe(true);
  });

  it("uses the lighthouse stripe, lamp and cap materials", () => {
    for (const key of ["wall0", "roof0", "ink", "face", "brass", "copper", "stone", "paving", "strata", "rock", "ground"]) {
      expect(keys.has(key)).toBe(true);
    }
  });

  it("is compatible with the multiple render target pass", () => {
    for (const mesh of meshes) {
      const material = mesh.material as THREE.ShaderMaterial;
      expect(material.fragmentShader).toContain("location = 1");
    }
  });

  it("spins the rim gear every 1/72 turn and the lamp every eighth of a turn", () => {
    expect(built.spinners).toHaveLength(2);
    const steps = built.spinners.map((spinner) => spinner.step).sort((a, b) => a - b);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toBeCloseTo(2 * Math.PI / 72, 9);
    expect(steps[1]).toBeCloseTo(Math.PI / 4, 9);
    for (const spinner of built.spinners) {
      expect(spinner.axis).toBe("y");
      expect(meshes).toContain(spinner.object);
    }
  });

  it("offers every static mesh for picking and none of the moving ones", () => {
    const moving = new Set(built.spinners.map((spinner) => spinner.object));
    expect(built.pickables.length).toBe(meshes.length - moving.size);
    for (const mesh of built.pickables) expect(moving.has(mesh)).toBe(false);
  });

  it("rises to about 60 units at the lighthouse", () => {
    const box = new THREE.Box3();
    for (const mesh of meshes) {
      if (mesh.name === "rock" || mesh.name === "strata") continue;
      mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrix));
    }
    expect(box.max.y).toBeGreaterThan(55);
    expect(box.max.y).toBeLessThan(75);
  });

  it("builds about a dozen cottages and some trees inside the rim", () => {
    expect(LANTERNFALL_LAYOUT.houses).toHaveLength(12);
    expect(LANTERNFALL_LAYOUT.trees.length).toBeGreaterThan(6);
    for (const house of LANTERNFALL_LAYOUT.houses) {
      expect(house.r).toBeGreaterThanOrEqual(140);
      expect(house.r).toBeLessThanOrEqual(175);
      expect(house.y).toBe(0);
    }
    for (const tree of LANTERNFALL_LAYOUT.trees) {
      const radius = Math.hypot(tree.x, tree.z);
      expect(radius).toBeGreaterThanOrEqual(180);
      expect(radius).toBeLessThanOrEqual(215);
    }
  });

  it("is deterministic", () => {
    const again = buildLanternfall(recordingPalette().source);
    expect(meshesOf(again.group).map((mesh) => mesh.name)).toEqual(meshes.map((mesh) => mesh.name));
  });
});

describe("buildLaunchersAndGates", () => {
  const { source, keys } = recordingPalette();
  const built = buildLaunchersAndGates(source);
  const meshes = meshesOf(built.group);

  it("stays within about 6 meshes, none of them moving", () => {
    expect(meshes.length).toBeGreaterThan(2);
    expect(meshes.length).toBeLessThanOrEqual(6);
    expect(built.spinners).toEqual([]);
  });

  it("uses only existing palette keys", () => {
    for (const key of keys) expect(ALLOWED_KEYS.has(key)).toBe(true);
    for (const key of ["stone", "copper", "brass", "ink"]) expect(keys.has(key)).toBe(true);
  });

  it("is compatible with the multiple render target pass", () => {
    for (const mesh of meshes) expect((mesh.material as THREE.ShaderMaterial).fragmentShader).toContain("location = 1");
  });

  it("lives in world space, covering the home pad and both gate centres", () => {
    expect(built.group.position.toArray()).toEqual([0, 0, 0]);
    const box = new THREE.Box3().setFromObject(built.group);
    for (const point of [HOME_PAD.position, HOME_GATE.center, LANTERNFALL_GATE.center]) {
      expect(box.containsPoint(new THREE.Vector3(point.x, point.y, point.z))).toBe(true);
    }
  });

  it("opens each gate ring along its travel direction", () => {
    const brass = meshes.find((mesh) => mesh.name === "brass")!;
    const position = brass.geometry.getAttribute("position");
    const vertex = new THREE.Vector3();
    for (const gate of [LANTERNFALL_GATE, HOME_GATE]) {
      let near = 0;
      let offPlane = 0;
      for (let index = 0; index < position.count; index += 1) {
        vertex.fromBufferAttribute(position, index);
        if (Math.hypot(vertex.x - gate.center.x, vertex.z - gate.center.z, vertex.y - gate.center.y) > gate.radius + 3) continue;
        near += 1;
        const along = dot(sub(vertex, gate.center), gate.direction);
        if (Math.abs(along) > 2) offPlane += 1;
      }
      expect(near).toBeGreaterThan(50);
      expect(offPlane).toBe(0);
    }
  });

  it("holds the pads, launchers and rings as pickables", () => {
    expect(built.pickables).toHaveLength(meshes.length);
  });
});

describe("Lanternfall walk world", () => {
  const world = createLanternfallWalkWorld();
  const polar = (bearing: number, radius: number) => polarToXZ(bearing, radius);

  it("is walkable at height 0 inside the rim margin and not beyond it", () => {
    for (const bearing of [0.3, 1.7, 3.1, 5.2]) {
      const inside = polar(bearing, 223);
      expect(world.surfaceAt(inside.x, inside.z)).toEqual({ height: 0, walkable: true });
      const outside = polar(bearing, 225);
      expect(world.surfaceAt(outside.x, outside.z).walkable).toBe(false);
    }
    expect(world.surfaceAt(0, 0)).toEqual({ height: 0, walkable: true });
  });

  it("fails closed on non-finite input", () => {
    expect(world.surfaceAt(Number.NaN, 0).walkable).toBe(false);
    expect(world.surfaceAt(0, Number.POSITIVE_INFINITY).walkable).toBe(false);
    expect(world.blocked(Number.NaN, 0, 1.5)).toBe(true);
    expect(world.blocked(0, Number.NEGATIVE_INFINITY, 1.5)).toBe(true);
    expect(world.blocked(30, 30, Number.NaN)).toBe(true);
  });

  it("blocks the lighthouse base out to about 9 units", () => {
    expect(world.blocked(0, 0, 1.5)).toBe(true);
    expect(world.blocked(8, 0, 1.5)).toBe(true);
    expect(world.blocked(0, -9.5, 1)).toBe(true);
    expect(world.blocked(0, 11.5, 1.5)).toBe(false);
    expect(world.blocked(-12, 0, 1.5)).toBe(false);
  });

  it("blocks the keeper cottage and every ring cottage, but not the ground just in front of the door", () => {
    for (const house of LANTERNFALL_LAYOUT.houses) {
      const { x, z } = polar(house.theta, house.r);
      expect(world.blocked(x, z, 1.5)).toBe(true);
      const out = polar(house.theta, house.r + house.depth / 2 + 3);
      expect(world.blocked(out.x, out.z, 1.5)).toBe(false);
    }
    const keeper = LANTERNFALL_LAYOUT.keeper;
    const centre = polar(keeper.theta, keeper.r);
    expect(world.blocked(centre.x, centre.z, 1.5)).toBe(true);
    const door = toLocal(KEEPER_DOOR);
    expect(world.blocked(door.x, door.z, 1.5)).toBe(false);
  });

  it("blocks along the cottage's width as well as its depth", () => {
    const house = LANTERNFALL_LAYOUT.houses[0]!;
    const side = { x: Math.cos(house.theta), z: Math.sin(house.theta) };
    const centre = polar(house.theta, house.r);
    const inside = house.width / 2 + 1.5 - 0.1;
    const outside = house.width / 2 + 1.5 + 0.1;
    expect(world.blocked(centre.x + side.x * inside, centre.z + side.z * inside, 1.5)).toBe(true);
    expect(world.blocked(centre.x + side.x * outside, centre.z + side.z * outside, 1.5)).toBe(false);
  });

  it("blocks tree trunks (radius 1.5) and nothing right beside them", () => {
    for (const tree of LANTERNFALL_LAYOUT.trees) {
      expect(world.blocked(tree.x, tree.z, 0.5)).toBe(true);
      // 1.5 + 0.5 = 2.0 reach: 1.9 away overlaps, 2.1 away does not.
      expect(world.blocked(tree.x + 1.9, tree.z, 0.5)).toBe(true);
    }
    const tree = LANTERNFALL_LAYOUT.trees[0]!;
    expect(world.blocked(tree.x + 2.1, tree.z, 0.5)).toBe(false);
  });

  it("blocks the island rim", () => {
    expect(world.blocked(224, 0, 0.5)).toBe(true);
    expect(world.blocked(0, -223, 1.5)).toBe(true);
  });

  it("keeps the pad's walkable centre free but blocks the launcher frame behind it", () => {
    const pad = toLocal(LANTERNFALL_PAD.position);
    expect(world.surfaceAt(pad.x, pad.z)).toEqual({ height: 0, walkable: true });
    expect(world.blocked(pad.x, pad.z, 1.5)).toBe(false);
    // A point 8 units behind the pad centre, at either upright (x = +/-4), is frame.
    const yaw = LANTERNFALL_PAD.yaw;
    const forward = { x: Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: Math.cos(yaw), z: Math.sin(yaw) };
    for (const side of [-4, 4]) {
      const x = pad.x - forward.x * 8 + right.x * side;
      const z = pad.z - forward.z * 8 + right.z * side;
      expect(world.blocked(x, z, 0.5)).toBe(true);
    }
    // Between the uprights is open.
    expect(world.blocked(pad.x - forward.x * 8, pad.z - forward.z * 8, 0.5)).toBe(false);
  });

  it("keeps every tree and cottage clear of the pad", () => {
    const pad = toLocal(LANTERNFALL_PAD.position);
    for (const tree of LANTERNFALL_LAYOUT.trees) expect(Math.hypot(tree.x - pad.x, tree.z - pad.z)).toBeGreaterThan(20);
    for (const house of LANTERNFALL_LAYOUT.houses) {
      const { x, z } = polar(house.theta, house.r);
      expect(Math.hypot(x - pad.x, z - pad.z)).toBeGreaterThan(30);
    }
  });

  it("lets a courier walk in a straight line from beside the pad to the keeper's door", () => {
    const pad = toLocal(LANTERNFALL_PAD.position);
    const door = toLocal(KEEPER_DOOR);
    const forward = { x: Math.sin(LANTERNFALL_PAD.yaw), z: -Math.cos(LANTERNFALL_PAD.yaw) };
    const start = { x: pad.x - forward.z * 8, z: pad.z + forward.x * 8 };
    const length = Math.hypot(door.x - start.x, door.z - start.z);
    expect(length).toBeGreaterThan(100);
    const steps = Math.ceil(length);
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const x = start.x + (door.x - start.x) * t;
      const z = start.z + (door.z - start.z) * t;
      expect(world.surfaceAt(x, z).walkable).toBe(true);
      expect(world.blocked(x, z, 1.5), `blocked at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(false);
    }
  });
});

describe("launcherBox", () => {
  it("covers the launcher arch behind each pad, in its island's coordinates", () => {
    for (const [pad, origin] of [[HOME_PAD, { x: 0, y: 0, z: 0 }], [LANTERNFALL_PAD, LANTERNFALL_CENTER]] as const) {
      const box = launcherBox(pad, origin);
      // The arch stands 8 behind the pad, against its launch direction.
      const forward = { x: Math.sin(pad.yaw), z: -Math.cos(pad.yaw) };
      const arch = { x: pad.position.x - origin.x - forward.x * 8, z: pad.position.z - origin.z - forward.z * 8 };
      const angle = Math.PI - box.theta;
      const dx = arch.x - box.x;
      const dz = arch.z - box.z;
      const lx = dx * Math.cos(angle) - dz * Math.sin(angle);
      const lz = dx * Math.sin(angle) + dz * Math.cos(angle);
      expect(Math.abs(lx)).toBeLessThan(box.halfX);
      expect(Math.abs(lz)).toBeLessThan(box.halfZ);
      expect(box.top - (pad.position.y - origin.y)).toBeGreaterThan(6.5);
      // The pad centre itself (where the plane parks) stays outside the box.
      const px = pad.position.x - origin.x - box.x;
      const pz = pad.position.z - origin.z - box.z;
      expect(Math.abs(px * Math.sin(angle) + pz * Math.cos(angle))).toBeGreaterThan(box.halfZ);
    }
  });
});
