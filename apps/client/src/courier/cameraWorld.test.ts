import { describe, expect, it } from "vitest";
import { createCityLayout, createStreetFurniture } from "../city/layout";
import { createCameraWorld, createHomeCameraWorld } from "./cameraWorld";
import { createHillTownWalkWorld } from "./walkWorld";

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

  it("keeps the camera out of tree canopies (seeing through leaves is fine) and stops at trunks", () => {
    const world = createCameraWorld({ ground: flat, islandRadius: 500, trees: [{ x: 0, y: 0, z: -20, height: 15, round: true }] });
    // The canopy (r about 5.5 around y 8.5) is soft: a view through it to clear air beyond is fine...
    expect(world.clearFraction(p(0, 8.5, 0), p(0, 8.5, -40))).toBe(1);
    // ...but a camera that would end inside it is pulled back out in front of it.
    const inLeaves = world.clearFraction(p(0, 8.5, 0), p(0, 8.5, -20));
    expect(inLeaves * 20).toBeLessThan(14.6);
    expect(inLeaves * 20).toBeGreaterThan(13.5);
    // The trunk is hard: the view stops in front of it.
    expect(world.clearFraction(p(0, 2, 0), p(0, 2, -40))).toBeLessThan(0.5);
    expect(world.clearFraction(p(0, 20, 0), p(0, 20, -40))).toBe(1);
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

describe("createHomeCameraWorld", () => {
  const layout = createCityLayout();
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

  it("never collapses onto a courier standing in a landmark's plaza (Rivet Market's parcel spot)", () => {
    const market = layout.landmarks[6]!;
    const walk = createHillTownWalkWorld(layout);
    // The courier at the market's centre, head height; the camera wants to sit 14 behind (toward the tower) and up.
    const head = p(market.x, walk.surfaceAt(market.x, market.z).height + 2.5, market.z);
    const r = Math.hypot(market.x, market.z);
    const behind = p(market.x - (market.x / r) * 14, head.y + 6, market.z - (market.z / r) * 14);
    expect(world.clearFraction(head, behind, 1.5)).toBeGreaterThan(0.6);
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
