import type { Vec3 } from "@clockwork/shared";
import { DISTRICTS, type DistrictKind } from "../city/districts";
import type { HouseSpec } from "../city/kit";
import { FURNITURE_SIZE, ISLAND_RADIUS, SUMMIT, createCityLayout, createStreetFurniture, polarToXZ, type CityLayout } from "../city/layout";
import type { WalkWorld } from "./walkWorld";

/**
 * What the follow camera may not pass through, built from the same layout data as the town: house boxes (walls and
 * roof), tree canopies and trunks, tall columns (the clock tower, landmarks, the lighthouse) and the ground itself
 * (terraces included, via the walk world). Pure; island-local coordinates, like the walk worlds.
 */
export type CameraWorld = {
  /**
   * How far (0..1) along the segment `from` → `to` the camera may go: up to the last clear sample before the first
   * hard occluder (ground, walls, roofs, trunks, columns), then back out of any soft one (a tree canopy: the view may
   * pass through leaves, but the camera must not sit inside them). 1 when nothing is in the way. The first
   * `ignoreNear` units are not tested.
   */
  clearFraction(from: Readonly<Vec3>, to: Readonly<Vec3>, ignoreNear?: number): number;
  /** The lowest height the camera may sit at (x, z): the ground plus clearance on the island, -Infinity off it. */
  floorAt(x: number, z: number): number;
};

type Box = { kind: "box"; x: number; z: number; cos: number; sin: number; halfX: number; halfZ: number; bottom: number; top: number };
type Column = { kind: "column"; x: number; z: number; r: number; bottom: number; top: number };
/** A tree canopy: soft (see clearFraction). */
type Ball = { kind: "ball"; x: number; y: number; z: number; r: number };
type Shape = Box | Column | Ball;

export type CameraWorldParts = {
  ground: Pick<WalkWorld, "surfaceAt">;
  /** Beyond this radius from the island's centre there is no ground, only sky. */
  islandRadius: number;
  houses?: readonly HouseVolume[];
  /** Plain boxes (launchers and the like), rotated like a house at bearing `theta`. */
  boxes?: readonly BoxVolume[];
  trees?: readonly TreeVolume[];
  columns?: readonly Omit<Column, "kind">[];
};
export type HouseVolume = { x: number; z: number; theta: number; y: number; width: number; depth: number; height: number };
export type TreeVolume = { x: number; y: number; z: number; height: number; round: boolean };
export type BoxVolume = { x: number; z: number; theta: number; halfX: number; halfZ: number; bottom: number; top: number };

const CELL = 20;
/** Sample spacing along the segment; thinner than any wall, trunk or canopy. */
const SAMPLE = 0.6;
const MAX_SAMPLES = 160;
/** Extra clearance around houses (the roof overhangs by about 0.7) and above the ground. */
const HOUSE_PAD = 0.75;
const GROUND_CLEARANCE = 0.8;

/** The roof height addHouse (city/kit.ts) gives a house of this depth. */
const roofHeightOf = (depth: number) => Math.min(7, Math.max(4.5, depth * 0.55)) * 1.15;

function houseBox(house: HouseVolume): Box {
  // The house frame is rotated by PI - bearing about Y (kit `frame`): local +X runs along the street.
  const angle = Math.PI - house.theta;
  return {
    kind: "box", x: house.x, z: house.z, cos: Math.cos(angle), sin: Math.sin(angle),
    halfX: house.width / 2 + HOUSE_PAD, halfZ: house.depth / 2 + HOUSE_PAD,
    bottom: house.y - 1, top: house.y + house.height + roofHeightOf(house.depth) + HOUSE_PAD,
  };
}

function treeShapes(tree: TreeVolume): Shape[] {
  // Mirrors addTree: a 5-tall trunk and a canopy (round: icosahedron r = 0.33h at 4 + 0.3h; else a cone 0.32h wide, h tall).
  const canopy: Ball = tree.round
    ? { kind: "ball", x: tree.x, y: tree.y + 4 + tree.height * 0.3, z: tree.z, r: tree.height * 0.33 + 0.5 }
    : { kind: "ball", x: tree.x, y: tree.y + 4 + tree.height * 0.45, z: tree.z, r: tree.height * 0.36 + 0.5 };
  return [canopy, { kind: "column", x: tree.x, z: tree.z, r: 1.6, bottom: tree.y - 1, top: tree.y + 5.5 }];
}

function radiusOf(shape: Shape): number {
  return shape.kind === "box" ? Math.hypot(shape.halfX, shape.halfZ) : shape.r;
}

function inside(shape: Shape, x: number, y: number, z: number): boolean {
  if (shape.kind === "ball") {
    const dx = x - shape.x;
    const dy = y - shape.y;
    const dz = z - shape.z;
    return dx * dx + dy * dy + dz * dz < shape.r * shape.r;
  }
  if (y < shape.bottom || y > shape.top) return false;
  const dx = x - shape.x;
  const dz = z - shape.z;
  if (shape.kind === "column") return dx * dx + dz * dz < shape.r * shape.r;
  // Into the box's local frame (inverse of its rotation about Y).
  const lx = dx * shape.cos - dz * shape.sin;
  const lz = dx * shape.sin + dz * shape.cos;
  return Math.abs(lx) < shape.halfX && Math.abs(lz) < shape.halfZ;
}

export function createCameraWorld(parts: CameraWorldParts): CameraWorld {
  const shapes: Shape[] = [
    ...(parts.houses ?? []).map(houseBox),
    ...(parts.boxes ?? []).map((box): Box => {
      const angle = Math.PI - box.theta;
      return { kind: "box", x: box.x, z: box.z, cos: Math.cos(angle), sin: Math.sin(angle), halfX: box.halfX, halfZ: box.halfZ, bottom: box.bottom, top: box.top };
    }),
    ...(parts.trees ?? []).flatMap(treeShapes),
    ...(parts.columns ?? []).map((column): Column => ({ kind: "column", ...column })),
  ];
  const grid = new Map<number, Shape[]>();
  // Cells within ±4096 of the origin (far beyond any island) pack into one number.
  const key = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
  for (const shape of shapes) {
    const reach = radiusOf(shape);
    for (let cx = Math.floor((shape.x - reach) / CELL); cx <= Math.floor((shape.x + reach) / CELL); cx += 1) {
      for (let cz = Math.floor((shape.z - reach) / CELL); cz <= Math.floor((shape.z + reach) / CELL); cz += 1) {
        const cell = grid.get(key(cx, cz));
        if (cell) cell.push(shape);
        else grid.set(key(cx, cz), [shape]);
      }
    }
  }
  const rim = parts.islandRadius;

  /**
   * Hard occluders at a point; or, with `soft`, a canopy at the point. Either way a canopy or a column that also holds
   * `origin` (the courier's head) is skipped: columns stand in roughly for landmarks whose plazas the courier walks
   * into, and a shape the courier is standing in cannot be what hides it (counting it would collapse the camera).
   */
  function blocked(x: number, y: number, z: number, soft: boolean, origin?: Readonly<Vec3>): boolean {
    if (!soft && Math.hypot(x, z) <= rim) {
      const ground = parts.ground.surfaceAt(x, z).height;
      if (Number.isFinite(ground) && y < ground + GROUND_CLEARANCE) return true;
    }
    const cell = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!cell) return false;
    for (const shape of cell) {
      if ((shape.kind === "ball") !== soft || !inside(shape, x, y, z)) continue;
      // Standing under a canopy (or in a landmark's column), the camera may share it rather than collapse onto the courier.
      if ((soft || shape.kind === "column") && origin && inside(shape, origin.x, origin.y, origin.z)) continue;
      return true;
    }
    return false;
  }

  return {
    floorAt(x, z) {
      if (!(Math.hypot(x, z) <= rim)) return Number.NEGATIVE_INFINITY;
      const ground = parts.ground.surfaceAt(x, z).height;
      return Number.isFinite(ground) ? ground + GROUND_CLEARANCE : Number.NEGATIVE_INFINITY;
    },
    clearFraction(from, to, ignoreNear = 0) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dz = to.z - from.z;
      const length = Math.hypot(dx, dy, dz);
      if (!Number.isFinite(length) || length === 0) return 1;
      const samples = Math.min(MAX_SAMPLES, Math.ceil(length / SAMPLE));
      const start = Math.max(0, Math.min(1, ignoreNear / length));
      const step = (1 - start) / samples;
      // Out along the line of sight until a hard occluder...
      let reach = 1;
      for (let i = 1; i <= samples; i += 1) {
        const t = start + step * i;
        if (blocked(from.x + dx * t, from.y + dy * t, from.z + dz * t, false, from)) { reach = t - step; break; }
      }
      // ...then back in until the camera is out of the leaves.
      let t = reach;
      while (t > start && blocked(from.x + dx * t, from.y + dy * t, from.z + dz * t, true, from)) t -= step;
      return Math.max(start, t);
    },
  };
}

/**
 * What is solid in each kind of landmark (buildCity buildLandmark), in the landmark's frame (x along the street, z away
 * from the tower; heights above its ground): `col` [x, z, r, top] for round parts, `box` [x, z, halfX, halfZ, bottom,
 * top] for the rest. Each sits inside the walk world's blockers for that landmark (walkWorld BLOCKERS) plus the
 * courier's radius, so the courier can never stand inside one; open plazas (the market's aisles, the port) stay open
 * to the camera. Thin animated parts (rotors, the escapement wheel) are slabs in their own plane.
 */
type Solid = { col: readonly [number, number, number, number] } | { box: readonly [number, number, number, number, number, number] };
const LANDMARK_SOLIDS: Record<DistrictKind, readonly Solid[]> = {
  windpumps: [-18, 0, 18].flatMap((x, i) => {
    const z = i === 1 ? -6 : 4;
    return [{ box: [x, z, 5, 5, 0, 11.5] }, { box: [x, z, 1.8, 1.8, 0, 41] }, { box: [x, z + 2.4, 15, 1, 27, 57] }] as Solid[];
  }),
  observatory: [{ col: [0, 0, 16.4, 29.5] }, { box: [0, 8, 2.7, 9.5, 12, 35] }, { box: [-21, 6, 4.5, 4.5, 0, 13.5] }],
  port: [],
  workshops: ([[-16, -4], [0, 4], [16, -4]] as const).flatMap(([x, z]) => [
    { box: [x, z, 7.3, 6.7, 0, 12.6] }, { box: [x + 5, z - 3, 2.3, 2.3, 0, 26] },
  ] as Solid[]),
  escapement: [{ box: [0, -10, 6, 4.5, 0, 44] }, { box: [0, -6, 1.2, 1.2, 0, 74] }, { box: [0, 0, 28, 1.6, 6, 62] }],
  farm: [{ box: [15, -2, 5.9, 5.7, 0, 21] }],
  market: [-15, -5, 5, 15].flatMap((x) => [-6, 6].map((z): Solid => ({ box: [x, z, 3.8, 2.7, 0, 9] }))),
  orchard: [
    { col: [0, 0, 6.4, 11.4] },
    ...[-18, -6, 6, 18].flatMap((x) => [-10, 0, 10].filter((z) => !(z === 0 && Math.abs(x) === 6)).map((z): Solid => ({ col: [x, z, 1.2, 6] }))),
  ],
};

function landmarkSolids(layout: CityLayout): { boxes: BoxVolume[]; columns: Omit<Column, "kind">[] } {
  const boxes: BoxVolume[] = [];
  const columns: Omit<Column, "kind">[] = [];
  for (const landmark of layout.landmarks) {
    const kind = DISTRICTS[landmark.district]?.kind;
    if (!kind) continue;
    const angle = Math.PI - landmark.bearing;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const world = (lx: number, lz: number) => ({ x: landmark.x + lx * cos + lz * sin, z: landmark.z - lx * sin + lz * cos });
    for (const solid of LANDMARK_SOLIDS[kind]) {
      if ("col" in solid) {
        const [lx, lz, r, top] = solid.col;
        columns.push({ ...world(lx, lz), r, bottom: landmark.y - 1, top: landmark.y + top });
      } else {
        const [lx, lz, halfX, halfZ, bottom, top] = solid.box;
        boxes.push({ ...world(lx, lz), theta: landmark.bearing, halfX, halfZ, bottom: landmark.y + bottom - (bottom === 0 ? 1 : 0), top: landmark.y + top });
      }
    }
  }
  return { boxes, columns };
}
/**
 * The clock tower as the boxes it is built from (buildCity buildTower), padded a little: the stepped plinth (36 square,
 * 13 high) and the shaft with its buttresses, clock surrounds and spire above it. Boxes, not one round column, so the
 * paving the courier walks round the plinth is never inside the tower's occluder.
 */
const TOWER_BOXES: readonly BoxVolume[] = [
  { x: 0, z: 0, theta: 0, halfX: 18.75, halfZ: 18.75, bottom: -10, top: SUMMIT.top + 13.75 },
  // Shaft, clock stage (faces and gilt surrounds out to about 15) and belfry, up to the spire's base at floor + 140.4.
  { x: 0, z: 0, theta: 0, halfX: 15.75, halfZ: 15.75, bottom: -10, top: SUMMIT.top + 141 },
  // The four-sided spire (12.4 half-wide at its base) with its finial, to about floor + 200.
  { x: 0, z: 0, theta: 0, halfX: 13, halfZ: 13, bottom: SUMMIT.top + 140, top: SUMMIT.top + 202 },
];

/** The hill town's camera world. */
export function createHomeCameraWorld(
  ground: Pick<WalkWorld, "surfaceAt">,
  layout: CityLayout = createCityLayout(),
  boxes: readonly BoxVolume[] = [],
): CameraWorld {
  // Market stalls and telephone kiosks stand taller than the camera's lowest swoop: it must not pass through them.
  const furniture = createStreetFurniture(layout)
    .filter((item) => item.kind === "stall" || item.kind === "kiosk")
    .map((item): BoxVolume => {
      const size = FURNITURE_SIZE[item.kind];
      return { x: item.x, z: item.z, theta: item.bearing, halfX: size.halfX + 0.3, halfZ: size.halfZ + 0.3, bottom: item.y - 1, top: item.y + size.height + 0.3 };
    });
  const landmarks = landmarkSolids(layout);
  return createCameraWorld({
    ground,
    islandRadius: ISLAND_RADIUS,
    houses: layout.houses,
    boxes: [...boxes, ...TOWER_BOXES, ...furniture, ...landmarks.boxes],
    trees: layout.trees,
    columns: landmarks.columns,
  });
}

/** Lanternfall's camera world, island-local; the lighthouse is a column at the centre. */
export function createOutpostCameraWorld(
  ground: Pick<WalkWorld, "surfaceAt">,
  islandRadius: number,
  houses: readonly HouseSpec[],
  trees: readonly TreeVolume[],
  lighthouse: { r: number; height: number },
  boxes: readonly BoxVolume[] = [],
): CameraWorld {
  return createCameraWorld({
    ground,
    islandRadius,
    houses: houses.map((house) => ({ ...house, ...polarToXZ(house.theta, house.r) })),
    boxes,
    trees,
    columns: [{ x: 0, z: 0, r: lighthouse.r, bottom: -1, top: lighthouse.height }],
  });
}
