import type { Vec3 } from "@clockwork/shared";
import { DISTRICTS } from "../city/districts";
import { getLandmarkSolids, landmarkPoint } from "../city/londonSolids";
import type { HouseSpec } from "../city/kit";
import { hasLondonShopAwning } from "../city/londonDetails";
import { FURNITURE_SIZE, ISLAND_RADIUS, SUMMIT, TAXI_ROOF, createCityLayout, createStreetFurniture, polarToXZ, type CityLayout } from "../city/layout";
import { planeTreeCrown } from "../city/kit";
import type { WalkWorld } from "./walkWorld";

/**
 * What the follow camera may not pass through, built from the same layout data as the town: house boxes (walls and
 * roof), tree canopies and trunks, tall columns (the clock tower, landmarks, the lighthouse) and the ground itself
 * (terraces included, via the walk world). Pure; island-local coordinates, like the walk worlds.
 */
export type CameraWorld = {
  /**
   * How far (0..1) along the segment `from` → `to` the camera may go: up to the last clear sample before the first
   * opaque occluder (ground, walls, roofs, trunks, columns or tree canopies). Stopping before the first canopy
   * keeps opaque leaves out of the full sight line, even when the intended endpoint lies beyond them. The first
   * `ignoreNear` units are not tested.
   */
  clearFraction(from: Readonly<Vec3>, to: Readonly<Vec3>, ignoreNear?: number): number;
  /** The lowest height the camera may sit at (x, z): the ground plus clearance on the island, -Infinity off it. */
  floorAt(x: number, z: number): number;
};

type Box = { kind: "box"; x: number; z: number; cos: number; sin: number; halfX: number; halfZ: number; bottom: number; top: number };
type Column = { kind: "column"; x: number; z: number; r: number; bottom: number; top: number };
/** An opaque tree canopy, round or (with `ry`) squashed into an ellipsoid; skipped only when it contains the subject. */
type Ball = { kind: "ball"; x: number; y: number; z: number; r: number; ry?: number };
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
export type HouseVolume = { x: number; z: number; theta: number; rotation?: number; y: number; width: number; depth: number; height: number };
export type TreeVolume = { x: number; y: number; z: number; height: number; round: boolean };
export type BoxVolume = { x: number; z: number; theta: number; rotation?: number; halfX: number; halfZ: number; bottom: number; top: number };

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
  const angle = house.rotation ?? Math.PI - house.theta;
  return {
    kind: "box", x: house.x, z: house.z, cos: Math.cos(angle), sin: Math.sin(angle),
    halfX: house.width / 2 + HOUSE_PAD, halfZ: house.depth / 2 + HOUSE_PAD,
    bottom: house.y - 1, top: house.y + house.height + roofHeightOf(house.depth) + HOUSE_PAD,
  };
}

function treeShapes(tree: TreeVolume): Shape[] {
  // Mirrors kit addTree. A round tree is a London plane: a tall clear trunk under a crown (planeTreeCrown, the same
  // numbers the geometry uses), so a street-level camera passes under it. A fir is a 5.5-tall trunk under its cones.
  if (tree.round) {
    const crown = planeTreeCrown(tree.height);
    return [
      { kind: "ball", x: tree.x, y: tree.y + crown.centre, z: tree.z, r: crown.radius, ry: crown.halfHeight },
      { kind: "column", x: tree.x, z: tree.z, r: 1.6, bottom: tree.y - 1, top: tree.y + crown.trunkTop + 0.5 },
    ];
  }
  return [
    { kind: "ball", x: tree.x, y: tree.y + 4 + tree.height * 0.45, z: tree.z, r: tree.height * 0.36 + 0.5 },
    { kind: "column", x: tree.x, z: tree.z, r: 1.6, bottom: tree.y - 1, top: tree.y + 5.5 },
  ];
}

function radiusOf(shape: Shape): number {
  if (shape.kind === "box") return Math.hypot(shape.halfX, shape.halfZ);
  return shape.kind === "ball" ? Math.max(shape.r, shape.ry ?? shape.r) : shape.r;
}

function inside(shape: Shape, x: number, y: number, z: number): boolean {
  if (shape.kind === "ball") {
    const dx = (x - shape.x) / shape.r;
    const dy = (y - shape.y) / (shape.ry ?? shape.r);
    const dz = (z - shape.z) / shape.r;
    return dx * dx + dy * dy + dz * dz < 1;
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
      const angle = box.rotation ?? Math.PI - box.theta;
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
   * Opaque occluders at a point. A canopy or column containing `origin` (the courier's head) is skipped: columns
   * stand in for landmark volumes, and a shape the courier already stands inside cannot hide it without collapsing
   * the camera. Other canopies remain solid along the whole sight line.
   */
  function blocked(x: number, y: number, z: number, origin?: Readonly<Vec3>): boolean {
    if (Math.hypot(x, z) <= rim) {
      const ground = parts.ground.surfaceAt(x, z).height;
      if (Number.isFinite(ground) && y < ground + GROUND_CLEARANCE) return true;
    }
    const cell = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!cell) return false;
    for (const shape of cell) {
      if (!inside(shape, x, y, z)) continue;
      // Standing under a canopy (or in a landmark's column), the camera may share it rather than collapse onto the courier.
      if ((shape.kind === "ball" || shape.kind === "column") && origin && inside(shape, origin.x, origin.y, origin.z)) continue;
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
      // Stop at the first opaque surface, including leaves. Checking only whether the endpoint is in a canopy
      // would allow an opaque tree (or overlapping trees) to sit between a clear endpoint and the courier.
      for (let i = 1; i <= samples; i += 1) {
        const t = start + step * i;
        if (blocked(from.x + dx * t, from.y + dy * t, from.z + dz * t, from)) return Math.max(start, t - step);
      }
      return 1;
    },
  };
}

function landmarkSolids(layout: CityLayout): { boxes: BoxVolume[]; columns: Omit<Column, "kind">[] } {
  const boxes: BoxVolume[] = [];
  const columns: Omit<Column, "kind">[] = [];
  for (const landmark of layout.landmarks) {
    const kind = DISTRICTS[landmark.district]?.kind;
    if (!kind) continue;
    for (const solid of getLandmarkSolids(kind, landmark)) {
      if ("col" in solid) {
        const [lx, lz, r, bottom, top] = solid.col;
        columns.push({ ...landmarkPoint(landmark, lx, lz), r, bottom: landmark.y + bottom - (bottom === 0 ? 1 : 0), top: landmark.y + top });
      } else {
        const [lx, lz, halfX, halfZ, bottom, top] = solid.box;
        boxes.push({ ...landmarkPoint(landmark, lx, lz), theta: landmark.bearing, rotation: landmark.rotation, halfX, halfZ, bottom: landmark.y + bottom - (bottom === 0 ? 1 : 0), top: landmark.y + top });
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
  // Tall street furniture and vehicles must also stop a low follow-camera swoop.
  const streetFurniture = createStreetFurniture(layout);
  const furniture = streetFurniture
    .filter((item) => item.kind === "stall" || item.kind === "kiosk" || item.kind === "bus" || item.kind === "taxi")
    .map((item): BoxVolume => {
      const size = FURNITURE_SIZE[item.kind];
      // Padded round the sides but not above, and a cab only as tall as its drawn body (its small roof sign aside):
      // from anywhere the courier can stand beside a cab, the sight line from its eyes rises over that roof, and a
      // camera looking over a parked cab must not be pulled in against the courier's back.
      const top = item.kind === "taxi" ? TAXI_ROOF : size.height;
      return { x: item.x, z: item.z, theta: item.bearing - (item.turn ?? 0), rotation: item.rotation !== undefined ? item.rotation + (item.turn ?? 0) : undefined, halfX: size.halfX + 0.3, halfZ: size.halfZ + 0.3, bottom: item.y - 1, top: item.y + top };
    });
  // Bus-stop heads are wider than their posts. Keep the low pole narrow so a high enamel sign does not create
  // an invisible shoulder-height wall, and give the head its own elevated envelope.
  const stops = streetFurniture.filter((item) => item.kind === "bus-stop");
  const stopHeads: BoxVolume[] = stops.map((item) => ({
    x: item.x, z: item.z, theta: item.bearing - (item.turn ?? 0), rotation: item.rotation !== undefined ? item.rotation + (item.turn ?? 0) : undefined, halfX: 0.8, halfZ: 0.2,
    bottom: item.y + 4, top: item.y + 5.6,
  }));
  const stopPosts = stops.map((item) => ({ x: item.x, z: item.z, r: 0.18, bottom: item.y - 1, top: item.y + 4.8 }));
  const beacons = streetFurniture.filter((item) => item.kind === "beacon");
  const beaconPosts = beacons.map((item) => ({ x: item.x, z: item.z, r: 0.14, bottom: item.y - 0.05, top: item.y + 4.1 }));
  const beaconGlobes = beacons.map((item) => ({ x: item.x, z: item.z, r: 0.4, bottom: item.y + 3.8, top: item.y + 4.6 }));
  const awnings: BoxVolume[] = layout.houses.flatMap((house, index) => {
    if (!hasLondonShopAwning(house, index)) return [];
    const position = landmarkPoint({ x: house.x, z: house.z, bearing: house.theta, rotation: house.rotation }, 0, house.depth / 2 + 1.3);
    return [{ ...position, theta: house.theta, rotation: house.rotation, halfX: (house.width + 0.6) / 2, halfZ: 1,
      bottom: house.y + 3.65, top: house.y + 4.25 }];
  });
  const bridgeRails: BoxVolume[] = (layout.plan?.bridges ?? []).flatMap((bridge) => [-1, 1].map((side) => {
    const lateral = side * (bridge.width / 2 - 0.2);
    return { x: bridge.x + Math.sin(bridge.rotation) * lateral, z: bridge.z + Math.cos(bridge.rotation) * lateral,
      theta: 0, rotation: bridge.rotation, halfX: bridge.length / 2, halfZ: 0.15, bottom: 0, top: 2.2 };
  }));
  const landmarks = landmarkSolids(layout);
  return createCameraWorld({
    ground,
    islandRadius: layout.plan?.radius ?? ISLAND_RADIUS,
    houses: layout.houses,
    boxes: [...boxes, ...(layout.plan ? [] : TOWER_BOXES), ...furniture, ...stopHeads, ...awnings, ...bridgeRails, ...landmarks.boxes],
    trees: layout.trees,
    columns: [...landmarks.columns, ...stopPosts, ...beaconPosts, ...beaconGlobes],
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
