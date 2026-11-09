import { describe, expect, it } from "vitest";
import { CLOCKWORK_WORLD } from "@clockwork/content";
import { DISTRICTS } from "./districts";
import { CANAL, FURNITURE_SIZE, ISLAND_RADIUS, ROAD_LIFT, STAIR_BEARINGS, STREET, SUMMIT, TERRACES, angularGap, createHillTownLayout as createCityLayout, createCityLayout as createIslandLayout, createStreetFurniture, districtAt, groundHeight, polarToXZ } from "./layout";
import { createHillTownWalkWorld } from "../courier/walkWorld";

it("builds the same town from the same seed", () => {
  expect(createCityLayout(7)).toEqual(createCityLayout(7));
  expect(createCityLayout(7)).not.toEqual(createCityLayout(8));
});

it("places London's eight neighbourhoods in compass order while retaining landmark identities", () => {
  expect(DISTRICTS.map((district) => district.name)).toEqual([
    "Regent's Park", "St Paul's", "Tower Wharf", "Battersea", "Westminster", "Kew Gardens", "Covent Garden", "Bloomsbury",
  ]);
  expect(DISTRICTS.map((district) => district.id)).toEqual(CLOCKWORK_WORLD.landmarks.map((landmark) => landmark.id));
  expect(DISTRICTS.map((district) => district.compass)).toEqual(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
});

it("keeps every house clear of its neighbours", () => {
  const { houses } = createCityLayout();
  expect(houses.length).toBeGreaterThan(250);
  const overlaps: string[] = [];
  for (let i = 0; i < houses.length; i += 1) {
    for (let j = i + 1; j < houses.length; j += 1) {
      const a = houses[i]!, b = houses[j]!;
      // Same row: compare the gap along the street. Different rows: compare the gap across it.
      const clear = a.r === b.r
        ? angularGap(a.theta, b.theta) * a.r >= (a.width + b.width) / 2 + 2
        : Math.abs(a.r - b.r) >= (a.depth + b.depth) / 2;
      if (!clear) overlaps.push(`${i}/${j}`);
    }
  }
  expect(overlaps).toEqual([]);
});

it("sits every house on its own terrace, clear of walls, streets and landmarks", () => {
  const layout = createCityLayout();
  const inner = (index: number) => TERRACES[index]?.radius ?? 0;
  const bands: Record<number, [number, number]> = {
    0: [CANAL.outer + 4, ISLAND_RADIUS - 20],
    1: [inner(1) + 4, inner(0) - STREET.inset],
    2: [inner(2) + 4, inner(1) - STREET.inset],
    3: [inner(3) + 4, inner(2) - STREET.inset],
  };
  const misplaced = layout.houses.filter((house) => {
    const [low, high] = bands[house.terrace]!;
    const blocked = layout.landmarks.some((landmark) => Math.hypot(landmark.x - house.x, landmark.z - house.z) < landmark.clearRadius);
    return house.r - house.depth / 2 < low || house.r + house.depth / 2 > high || house.y !== groundHeight(house.r) || blocked;
  });
  expect(misplaced).toEqual([]);
});

it("assigns a clicked ground point to the district under it", () => {
  createIslandLayout().landmarks.forEach((point, index) => {
    expect(districtAt(point.x, point.z)).toBe(index);
  });
  expect(districtAt(0, 0)).toBeNull();
});

describe("createStreetFurniture", () => {
  const layout = createCityLayout();
  const items = createStreetFurniture(layout);
  const world = createHillTownWalkWorld(layout);

  it("lines the streets with lamps and a few pillar boxes, standing on the ground they are drawn on", () => {
    const lamps = items.filter((item) => item.kind === "lamp");
    const boxes = items.filter((item) => item.kind === "postbox");
    expect(lamps.length).toBeGreaterThan(80);
    expect(boxes.length).toBeGreaterThan(8);
    for (const item of items) {
      expect(world.surfaceAt(item.x, item.z).walkable || Math.hypot(item.x, item.z) < SUMMIT.radius).toBe(true);
      const roadLift = item.kind === "bus" || item.kind === "taxi" || item.kind === "beacon" ? ROAD_LIFT : 0;
      expect(item.y).toBeCloseTo(world.surfaceAt(item.x, item.z).height + roadLift, 5);
    }
  });

  it("keeps clear of stairways, bridges and landmark plazas", () => {
    for (const item of items) {
      const r = Math.hypot(item.x, item.z);
      if (item.kind === "beacon") {
        const terrace = TERRACES.find((terrace) => Math.abs(terrace.top + ROAD_LIFT - item.y) < 1e-9)!;
        const road = terrace.radius - STREET.inset + STREET.width / 2;
        const crossing = STAIR_BEARINGS.find((bearing) => {
          const lateral = -item.x * Math.cos(bearing) - item.z * Math.sin(bearing);
          const outward = item.x * Math.sin(bearing) - item.z * Math.cos(bearing);
          return Math.abs(Math.abs(lateral) - 4.6) < 1e-6 && Math.abs(outward - road - 4.7) < 1e-6;
        });
        expect(crossing, "beacons must flank a real zebra crossing, outside its walking lane").toBeDefined();
        const centre = polarToXZ(crossing!, road + 4.7);
        expect(world.blocked(centre.x, centre.z, 1.5)).toBe(false);
      } else if (r > SUMMIT.radius) {
        for (const stair of STAIR_BEARINGS) expect(angularGap(item.bearing, stair) * r).toBeGreaterThanOrEqual(9 - 1e-9);
      }
      for (const landmark of layout.landmarks) expect(Math.hypot(item.x - landmark.x, item.z - landmark.z)).toBeGreaterThanOrEqual(landmark.clearRadius + 3);
    }
  });

  it("places a pair of solid Belisha beacon posts at all 24 zebra crossings", () => {
    expect(items.filter((item) => item.kind === "beacon")).toHaveLength(STAIR_BEARINGS.length * 2 * 3);
  });

  it("is solid to the courier", () => {
    for (const item of items) expect(world.blocked(item.x, item.z, 0.3)).toBe(true);
  });

  describe("the summit plaza", () => {
    const summit = items.filter((item) => Math.hypot(item.x, item.z) < SUMMIT.radius);
    const count = (kind: string) => summit.filter((item) => item.kind === kind).length;

    it("is dressed like a London square: markets, phone kiosks, benches, planters and lamps, all placed", () => {
      expect(count("stall")).toBe(6);
      expect(count("kiosk")).toBe(2);
      expect(count("bench")).toBe(11);
      expect(count("planter")).toBe(2);
      // Seven round the edge (the south one gives way to the Great Escapement's plaza) and four on the diagonals.
      expect(count("lamp")).toBe(11);
      expect(summit.filter((item) => item.kind === "lamp" && Math.hypot(item.x, item.z) < 40)).toHaveLength(4);
      for (const item of summit) expect(item.y).toBe(SUMMIT.top);
    });

    it("keeps every piece clear of the others, the plaza trees and the tower plinth", () => {
      const solids = [
        ...summit.map((item) => ({ x: item.x, z: item.z, r: Math.hypot(FURNITURE_SIZE[item.kind].halfX, FURNITURE_SIZE[item.kind].halfZ) })),
        ...layout.trees.filter((tree) => tree.y === SUMMIT.top).map((tree) => ({ x: tree.x, z: tree.z, r: 1.5 })),
      ];
      for (let i = 0; i < solids.length; i += 1) {
        const a = solids[i]!;
        expect(Math.max(Math.abs(a.x), Math.abs(a.z)) - a.r).toBeGreaterThan(18 + 2);
        for (let j = i + 1; j < solids.length; j += 1) {
          const b = solids[j]!;
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(a.r + b.r + 0.3);
        }
      }
    });

    it("leaves the courier's spawn, its first steps and every stairway lane open, plinth to stair head", () => {
      const spawn = polarToXZ(270 * Math.PI / 180, 50);
      expect(world.blocked(spawn.x, spawn.z, 1.5)).toBe(false);
      // Ten units of open paving all round the spawn point (the west plaza tree stands 12 out).
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
        for (let d = 1; d <= 9; d += 1) expect(world.blocked(spawn.x + Math.cos(angle) * d, spawn.z + Math.sin(angle) * d, 1.5)).toBe(false);
      }
      for (const bearing of STAIR_BEARINGS) {
        for (let r = 30; r <= SUMMIT.radius - 2; r += 1) {
          const { x, z } = polarToXZ(bearing, r);
          expect(world.blocked(x, z, 1.5)).toBe(false);
        }
      }
    });

    it("blocks each piece by its real footprint, turned with it", () => {
      // Stalls at 38 and 52 degrees (and kiosks at 313/317) put both signs of the rotation to work.
      expect(summit.some((item) => item.kind === "stall" && Math.abs(item.bearing - 38 * Math.PI / 180) < 1e-9)).toBe(true);
      for (const item of summit) {
        const size = FURNITURE_SIZE[item.kind];
        if (size.round) continue;
        // Into the world from the piece's own frame (kit frame / walkWorld toWorld): x along, z outward.
        const angle = Math.PI - item.bearing;
        const point = (lx: number, lz: number) => ({ x: item.x + lx * Math.cos(angle) + lz * Math.sin(angle), z: item.z - lx * Math.sin(angle) + lz * Math.cos(angle) });
        // Just inside each face is solid; just beyond it (by more than the probe) is clear, along both local axes.
        for (const sign of [-1, 1]) {
          const insideX = point(sign * (size.halfX - 0.1), 0);
          const outsideX = point(sign * (size.halfX + 0.5), 0);
          const insideZ = point(0, sign * (size.halfZ - 0.1));
          const outsideZ = point(0, sign * (size.halfZ + 0.5));
          expect(world.blocked(insideX.x, insideX.z, 0.05)).toBe(true);
          expect(world.blocked(outsideX.x, outsideX.z, 0.05)).toBe(false);
          expect(world.blocked(insideZ.x, insideZ.z, 0.05)).toBe(true);
          expect(world.blocked(outsideZ.x, outsideZ.z, 0.05)).toBe(false);
        }
      }
    });
  });
});
