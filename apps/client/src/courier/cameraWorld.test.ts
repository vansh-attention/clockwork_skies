import { describe, expect, it } from "vitest";
import { createCityLayout, createHillTownLayout, createStreetFurniture, FURNITURE_SIZE } from "../city/layout";
import * as THREE from "three";
import { FOLLOW, FollowCamera } from "./followCamera";
import { landmarkPoint } from "../city/londonSolids";
import { hasLondonShopAwning } from "../city/londonDetails";
import { createCameraWorld, createHomeCameraWorld } from "./cameraWorld";
import { planeTreeCrown } from "../city/kit";
import { createHillTownWalkWorld } from "./walkWorld";
import { WALK } from "./walker";

const flat = { surfaceAt: () => ({ height: 0, walkable: true }) };
const p = (x: number, y: number, z: number) => ({ x, y, z });

describe("createCameraWorld", () => {
  it("is clear over open ground", () => {
    const world = createCameraWorld({ ground: flat, islandRadius: 500 });
    expect(world.clearFraction(p(0, 4, 0), p(0, 12, 30))).toBe(1);
  });

  it("stops just before a house wall", () => {
    // A 10 x 10 house centred 20 units north (bearing 0 → -Z), 8 tall: its near wall (plus padding) is at z = -14.
    const world = createCameraWorld({
      ground: flat, islandRadius: 500,
      houses: [{ x: 0, z: -20, theta: 0, y: 0, width: 10, depth: 10, height: 8 }],
    });
    const fraction = world.clearFraction(p(0, 4, 0), p(0, 4, -30));
    expect(fraction * 30).toBeGreaterThan(13);
    expect(fraction * 30).toBeLessThan(14.01);
    // Over the roof is clear (8 tall + roof about 6.3 + padding).
    expect(world.clearFraction(p(0, 4, 0), p(0, 24, -30))).toBeLessThan(1);
    expect(world.clearFraction(p(0, 30, 0), p(0, 30, -30))).toBe(1);
  });

  it("respects a house's rotation", () => {
    // Long (40) along its street, shallow (6) away from the tower; at bearing 90° the street runs north-south.
    const world = createCameraWorld({
      ground: flat, islandRadius: 500,
      houses: [{ x: 50, z: 0, theta: Math.PI / 2, y: 0, width: 40, depth: 6, height: 8 }],
    });
    expect(world.clearFraction(p(50, 4, 30), p(50, 4, 10))).toBeLessThan(1);
    expect(world.clearFraction(p(40, 4, 30), p(40, 4, -30))).toBe(1);
  });

  // A 15-tall London plane (kit planeTreeCrown): a clear trunk under a crown carried high.
  const crown = planeTreeCrown(15);

  it("keeps opaque tree crowns out of the sight line and stops at trunks", () => {
    const world = createCameraWorld({ ground: flat, islandRadius: 500, trees: [{ x: 0, y: 0, z: -20, height: 15, round: true }] });
    const y = crown.centre;
    const nearEdge = 20 - crown.radius;
    // The crown blocks the view even when the desired endpoint is clear air beyond it.
    expect(world.clearFraction(p(0, y, 0), p(0, y, -40)) * 40).toBeLessThan(nearEdge + 0.05);
    // A camera that would end inside it is also pulled back out in front of it.
    const inLeaves = world.clearFraction(p(0, y, 0), p(0, y, -20));
    expect(inLeaves * 20).toBeLessThan(nearEdge + 0.05);
    expect(inLeaves * 20).toBeGreaterThan(nearEdge - 1.1);
    // The trunk is hard: the view stops in front of it.
    expect(world.clearFraction(p(0, 2, 0), p(0, 2, -40))).toBeLessThan(0.5);
    expect(world.clearFraction(p(0, crown.centre + crown.halfHeight + 1, 0), p(0, crown.centre + crown.halfHeight + 1, -40))).toBe(1);
  });

  it("lets a street-level camera pass under a plane tree's crown, as people do", () => {
    const world = createCameraWorld({ ground: flat, islandRadius: 500, trees: [{ x: 0, y: 0, z: -20, height: 15, round: true }] });
    // The walking camera rides about 5.7 above the street; beside the trunk it sees under the leaves.
    expect(crown.centre - crown.halfHeight).toBeGreaterThan(6.2);
    expect(world.clearFraction(p(3, 5.7, 0), p(3, 5.7, -40))).toBe(1);
  });

  it("stops before the first of two overlapping crowns even when the camera endpoint is beyond both", () => {
    const trees = [{ x: 0, y: 0, z: -14, height: 15, round: true }, { x: 0, y: 0, z: -21, height: 15, round: true }];
    const world = createCameraWorld({ ground: flat, islandRadius: 500, trees });
    const from = p(0, crown.centre, 0);
    const desired = p(0, crown.centre, -40);
    const distance = world.clearFraction(from, desired) * 40;
    const firstEdge = 14 - crown.radius;
    expect(distance).toBeGreaterThan(firstEdge - 0.7);
    expect(distance).toBeLessThan(firstEdge + 0.05);
    // Every point between subject and returned camera position stays in front of both opaque crowns.
    for (let step = 0; step <= 40; step += 1) {
      const z = -distance * step / 40;
      for (const tree of trees) expect(Math.abs(z - tree.z)).toBeGreaterThanOrEqual(crown.radius - 0.05);
    }
  });

  it("ignores a crown containing the subject without ignoring a second overlapping crown", () => {
    const ownCanopy = { x: 0, y: 0, z: 0, height: 15, round: true };
    const from = p(0, crown.centre, 0);
    const to = p(0, crown.centre, -30);
    const own = createCameraWorld({ ground: flat, islandRadius: 500, trees: [ownCanopy] });
    expect(own.clearFraction(from, to)).toBe(1);
    const overlapping = createCameraWorld({ ground: flat, islandRadius: 500, trees: [ownCanopy, { ...ownCanopy, z: -9 }] });
    const distance = overlapping.clearFraction(from, to) * 30;
    const secondEdge = 9 - crown.radius;
    expect(distance).toBeGreaterThan(secondEdge - 0.7);
    expect(distance).toBeLessThan(secondEdge + 0.05);
  });

  it("lets the walking camera look over a parked cab from right beside it", () => {
    // Found walking the game: standing beside a parked cab, the camera collapsed onto the courier's back because the
    // cab's camera box was padded above its roof. A real-size cab's roof is a little above the courier's eyes, but the
    // sight line to the camera rises over it. For every cab on the island, stand just clear of either side (where the
    // walk world lets the courier stand) with the camera behind, across the cab: exactly as the follow camera tests
    // it, the view must stay clear at least to the cab's far side.
    const layout = createCityLayout();
    const walk = createHillTownWalkWorld(layout);
    const world = createHomeCameraWorld(walk, layout);
    const cabs = createStreetFurniture(layout).filter((item) => item.kind === "taxi");
    expect(cabs.length).toBeGreaterThan(0);
    const size = FURNITURE_SIZE.taxi;
    let checked = 0;
    for (const cab of cabs) {
      // The cab's local +Z (its side) in world space, for the frame its geometry and walk box share.
      const rotation = (cab.rotation ?? Math.PI - cab.bearing) + (cab.turn ?? 0);
      for (const sign of [-1, 1]) {
        const side = { x: sign * Math.sin(rotation), z: sign * Math.cos(rotation) };
        const stand = size.halfZ + WALK.radius + 0.1;
        const x = cab.x + side.x * stand, z = cab.z + side.z * stand;
        if (!walk.surfaceAt(x, z).walkable || walk.blocked(x, z, WALK.radius)) continue;
        const y = walk.surfaceAt(x, z).height;
        // The real follow camera, the courier facing away from the cab so the camera stands across it.
        const camera = new THREE.PerspectiveCamera(FOLLOW.fov, 16 / 9, FOLLOW.near, 5000);
        const follow = new FollowCamera(camera);
        follow.setWorld(world, { x: 0, y: 0, z: 0 });
        const subject = { x, y, z, heading: Math.atan2(side.x, -side.z), vx: 0, vz: 0 };
        follow.snapBehind(subject);
        for (let i = 0; i < 90; i += 1) follow.update(1 / 60, subject, false);
        // Not pulled in onto the courier's back: the camera keeps (nearly) its full distance from the eyes.
        const eyes = new THREE.Vector3(x, y + FOLLOW.sightLift, z);
        expect(camera.position.distanceTo(eyes), `cab at ${cab.x.toFixed(1)},${cab.z.toFixed(1)}`).toBeGreaterThan(FOLLOW.distance * 0.85);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(cabs.length);
  });

  it("gives the camera a floor: the ground plus clearance on the island, nothing beyond it", () => {
    const terrace = { surfaceAt: (x: number) => ({ height: x > 10 ? 6 : 0, walkable: true }) };
    const world = createCameraWorld({ ground: terrace, islandRadius: 40 });
    expect(world.floorAt(0, 0)).toBeCloseTo(0.8, 9);
    expect(world.floorAt(20, 0)).toBeCloseTo(6.8, 9);
    expect(world.floorAt(60, 0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("blocks below the ground (a terrace in the way) and ignores the ground beyond the rim", () => {
    const terrace = { surfaceAt: (x: number) => ({ height: x > 10 ? 6 : 0, walkable: true }) };
    const world = createCameraWorld({ ground: terrace, islandRadius: 40 });
    expect(world.clearFraction(p(0, 3, 0), p(30, 3, 0))).toBeLessThan(0.4);
    expect(world.clearFraction(p(0, 10, 0), p(30, 10, 0))).toBe(1);
    // Past the island's edge there is only sky, even below the ground's height.
    expect(world.clearFraction(p(45, 3, 0), p(80, 3, 0))).toBe(1);
  });

  it("skips the first `ignoreNear` units, so a target just inside something solid still sees out", () => {
    const world = createCameraWorld({ ground: flat, islandRadius: 500, boxes: [{ x: 0, z: 0, theta: 0, halfX: 2, halfZ: 2, bottom: 0, top: 10 }] });
    expect(world.clearFraction(p(0, 4, 0), p(0, 4, 20))).toBe(0);
    expect(world.clearFraction(p(0, 4, 0), p(0, 4, 20), 3)).toBe(1);
  });

  it("ignores a column the target stands in (a landmark plaza), but still stops at one it does not", () => {
    const world = createCameraWorld({ ground: flat, islandRadius: 500, columns: [{ x: 0, z: 0, r: 6, bottom: 0, top: 10 }] });
    expect(world.clearFraction(p(0, 4, 0), p(0, 4, 20))).toBe(1);
    expect(world.clearFraction(p(0, 4, -20), p(0, 4, 20))).toBeLessThan(0.4);
  });

  it("treats a degenerate or non-finite segment as clear", () => {
    const world = createCameraWorld({ ground: flat, islandRadius: 500 });
    expect(world.clearFraction(p(1, 2, 3), p(1, 2, 3))).toBe(1);
    expect(world.clearFraction(p(0, 0, 0), p(Number.NaN, 0, 0))).toBe(1);
  });
});

describe("legacy createHomeCameraWorld", () => {
  const layout = createHillTownLayout();
  const world = createHomeCameraWorld(createHillTownWalkWorld(layout), layout);

  it("blocks the view into a real house and through the clock tower", () => {
    const house = layout.houses[0]!;
    const outward = { x: Math.sin(house.theta), z: -Math.cos(house.theta) };
    const street = p(house.x + outward.x * (house.depth / 2 + 8), house.y + 3, house.z + outward.z * (house.depth / 2 + 8));
    expect(world.clearFraction(street, p(house.x, house.y + 3, house.z))).toBeLessThan(1);
    expect(world.clearFraction(p(-60, 80, 0), p(60, 80, 0))).toBeLessThan(0.5);
  });

  it("is clear high above the town, the spire's tip included, and blocked through the spire itself", () => {
    expect(world.clearFraction(p(-300, 290, 0), p(300, 290, 0))).toBe(1);
    expect(world.clearFraction(p(-300, 220, 0), p(300, 220, 0))).toBeLessThan(0.5);
    expect(world.clearFraction(p(-300, 220, 60), p(300, 220, 60))).toBe(1);
  });

  it("never has the courier standing inside a camera occluder, anywhere around a landmark or on the summit", () => {
    const walk = createHillTownWalkWorld(layout);
    const centres = [...layout.landmarks.map((landmark) => ({ x: landmark.x, z: landmark.z, reach: 42 })), { x: 0, z: 0, reach: 82 }];
    let checked = 0;
    const trapped: string[] = [];
    for (const centre of centres) {
      for (let dx = -centre.reach; dx <= centre.reach; dx += 1.5) {
        for (let dz = -centre.reach; dz <= centre.reach; dz += 1.5) {
          const x = centre.x + dx;
          const z = centre.z + dz;
          const surface = walk.surfaceAt(x, z);
          if (!surface.walkable || walk.blocked(x, z, 1.5)) continue;
          checked += 1;
          // A short hop up from the head is only blocked when the head is already inside something solid.
          const head = p(x, surface.height + 2.5, z);
          if (world.clearFraction(head, p(x, head.y + 0.5, z)) < 1) trapped.push(`${x.toFixed(1)},${z.toFixed(1)}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
    expect(trapped).toEqual([]);
  });

  it("never collapses onto a courier standing in a landmark's plaza (Covent Garden's parcel spot)", () => {
    const market = layout.landmarks[6]!;
    const walk = createHillTownWalkWorld(layout);
    // The courier at the market's centre, head height; the camera wants to sit 14 behind (toward the tower) and up.
    const head = p(market.x, walk.surfaceAt(market.x, market.z).height + 2.5, market.z);
    const r = Math.hypot(market.x, market.z);
    const behind = p(market.x - (market.x / r) * 14, head.y + 6, market.z - (market.z / r) * 14);
    expect(world.clearFraction(head, behind, 1.5)).toBeGreaterThan(0.6);
  });

  it("stops at St Paul's dome, Battersea chimneys and Tower Bridge's upper walkway", () => {
    const local = (index: number, x: number, y: number, z: number) => {
      const landmark = layout.landmarks[index]!;
      const point = landmarkPoint(landmark, x, z);
      return p(point.x, landmark.y + y, point.z);
    };
    // These heights are above the old fantasy landmark shapes: the actual London silhouettes must be solid.
    expect(world.clearFraction(local(1, -16, 29, -3), local(1, 0, 29, -3))).toBeLessThan(1);
    expect(world.clearFraction(local(3, -25, 39, -9), local(3, -18, 39, -9))).toBeLessThan(1);
    expect(world.clearFraction(local(2, -12, 18.5, 0), local(2, 12, 18.5, 0))).toBeLessThan(1);
    // A walking camera still passes under that walkway, through the centre of the road.
    expect(world.clearFraction(local(2, 0, 5, -8), local(2, 0, 5, 8))).toBe(1);
    // Covent Garden's high roof is solid, while its lane stays open at courier head height.
    expect(world.clearFraction(local(6, 14, 17, 0), local(6, 14, 11, 0))).toBeLessThan(1);
    expect(world.clearFraction(local(6, 0, 3, -10), local(6, 0, 3, 10))).toBe(1);
  });

  it("keeps the follow camera outside both decks of a parked bus, across its long street-facing axis", () => {
    const buses = createStreetFurniture(layout).filter((item) => item.kind === "bus");
    expect(buses.length).toBeGreaterThan(0);
    for (const bus of buses) {
      const angle = Math.PI - bus.bearing + (bus.turn ?? 0);
      const local = (x: number, y: number, z: number) => p(bus.x + x * Math.cos(angle) + z * Math.sin(angle), bus.y + y, bus.z - x * Math.sin(angle) + z * Math.cos(angle));
      for (const height of [1.5, 5.2]) {
        expect(world.clearFraction(local(0, height, 9), local(0, height, 0))).toBeLessThan(1);
        expect(world.clearFraction(local(9, height, 0), local(4, height, 0))).toBeLessThan(1);
      }
    }
  });

  it("stops at shop awnings while leaving the pavement beneath them open", () => {
    const shops = layout.houses.filter((house, index) => hasLondonShopAwning(house, index));
    expect(shops.length).toBeGreaterThan(10);
    for (const house of shops.slice(0, 8)) {
      const local = (y: number, z: number) => {
        const point = landmarkPoint({ x: house.x, z: house.z, bearing: house.theta }, 0, house.depth / 2 + z);
        return p(point.x, house.y + y, point.z);
      };
      expect(world.clearFraction(local(4, 5), local(4, 1.5))).toBeLessThan(1);
      expect(world.clearFraction(local(2.5, 5), local(2.5, 1.5))).toBe(1);
    }
  });

  it("collides with a bus-stop sign at sign height without inventing a wide wall below it", () => {
    const stops = createStreetFurniture(layout).filter((item) => item.kind === "bus-stop");
    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) {
      const local = (y: number, z: number) => {
        const point = landmarkPoint({ x: stop.x, z: stop.z, bearing: stop.bearing }, 0.65, z);
        return p(point.x, stop.y + y, point.z);
      };
      expect(world.clearFraction(local(4.8, 3), local(4.8, 0))).toBeLessThan(1);
      expect(world.clearFraction(local(2.8, 3), local(2.8, 0))).toBe(1);
    }
  });

  it("stops at a crossing beacon's post and high globe, leaving the shoulder-height space beside its post clear", () => {
    const beacons = createStreetFurniture(layout).filter((item) => item.kind === "beacon");
    expect(beacons).toHaveLength(48);
    for (const beacon of beacons) {
      const local = (x: number, y: number, z: number) => {
        const point = landmarkPoint({ x: beacon.x, z: beacon.z, bearing: beacon.bearing }, x, z);
        return p(point.x, beacon.y + y, point.z);
      };
      expect(world.clearFraction(local(0, 2.5, 3), local(0, 2.5, 0))).toBeLessThan(1);
      expect(world.clearFraction(local(0.3, 4.2, 3), local(0.3, 4.2, 0))).toBeLessThan(1);
      expect(world.clearFraction(local(0.3, 2.5, 3), local(0.3, 2.5, 0))).toBe(1);
    }
  });

  it("stops the camera at the tower's stone, but never counts the paving round the plinth as inside the tower", () => {
    const walk = createHillTownWalkWorld(layout);
    for (const [x, z, outX, outZ] of [[0, -20, 0, -1], [20, 0, 1, 0], [15, -15, 0.7071, -0.7071]] as const) {
      if (walk.blocked(x, z, 1.5)) continue; // only spots the courier can actually stand on
      const head = p(x, walk.surfaceAt(x, z).height + 2.5, z);
      // Looking away from the tower: clear. Swinging the camera round toward the tower: stopped short of the plinth.
      expect(world.clearFraction(head, p(x + outX * 14, head.y + 6, z + outZ * 14), 1.5)).toBe(1);
      const toward = world.clearFraction(head, p(x - outX * 14, head.y + 4, z - outZ * 14), 1.5);
      expect(toward).toBeLessThan(0.5);
      expect(toward).toBeGreaterThan(0);
    }
    expect(walk.blocked(0, -20, 1.5)).toBe(false);
  });

  it("keeps the camera out of the summit's market stalls and phone kiosks, but not off the benches", () => {
    const furniture = createStreetFurniture(layout);
    const tall = furniture.filter((item) => item.kind === "stall" || item.kind === "kiosk");
    expect(tall).toHaveLength(8);
    for (const item of tall) {
      // A swoop toward the piece from the tower side, at awning height, stops short of it.
      const r = Math.hypot(item.x, item.z);
      const from = p(item.x * (r - 10) / r, item.y + 2.2, item.z * (r - 10) / r);
      expect(world.clearFraction(from, p(item.x, item.y + 2.2, item.z))).toBeLessThan(1);
    }
    const bench = furniture.find((item) => item.kind === "bench")!;
    const r = Math.hypot(bench.x, bench.z);
    expect(world.clearFraction(p(bench.x * (r - 6) / r, bench.y + 2.5, bench.z * (r - 6) / r), p(bench.x, bench.y + 2.5, bench.z))).toBe(1);
  });
});
