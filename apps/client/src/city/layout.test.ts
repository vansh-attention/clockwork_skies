import { expect, it } from "vitest";
import { CLOCKWORK_WORLD } from "@clockwork/content";
import { DISTRICTS } from "./districts";
import { CANAL, ISLAND_RADIUS, STREET, TERRACES, angularGap, createCityLayout, districtAt, groundHeight, polarToXZ } from "./layout";

it("builds the same town from the same seed", () => {
  expect(createCityLayout(7)).toEqual(createCityLayout(7));
  expect(createCityLayout(7)).not.toEqual(createCityLayout(8));
});

it("names one district after each landmark, in compass order", () => {
  expect(DISTRICTS.map((district) => district.name)).toEqual(CLOCKWORK_WORLD.landmarks.map((landmark) => landmark.name));
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
  DISTRICTS.forEach((district, index) => {
    const point = polarToXZ(district.bearing * Math.PI / 180, 200);
    expect(districtAt(point.x, point.z)).toBe(index);
  });
  expect(districtAt(0, 10)).toBeNull();
});
