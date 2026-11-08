import * as THREE from "three";
import { buildLondonGround } from "./londonTerrain";
import { addLondonRoads, addLondonShopfronts, addLondonTransport, buildLondonSigns } from "./londonStreets";
import { SeededRandom } from "@clockwork/shared";
import { DISTRICTS, type DistrictKind } from "./districts";
import {
  BRIDGE_BEARINGS, CANAL, ISLAND_RADIUS, STAIR_BEARINGS, STREET, SUMMIT, TERRACES, TOWER_BRIDGE, angularGap, createCityLayout, createStreetFurniture, polarToXZ,
  type CityLayout, type Furniture, type Landmark,
} from "./layout";
import {
  Batch, Palette, addHouse, addTree, at, frame, gableRoof, gearGeometry, local, merge, normalize, pyramidRoof, underside, wedge,
  type MaterialKey, type Scale,
} from "./kit";

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

export type Spinner = { object: THREE.Object3D; axis: "x" | "y" | "z"; step: number };
export type ClockFace = { center: THREE.Vector3; normal: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 };
export type BuiltCity = {
  group: THREE.Group;
  /** Static surfaces a click can land on; clouds and chimney smoke are left out. */
  pickables: THREE.Mesh[];
  hands: THREE.Mesh;
  faces: ClockFace[];
  /** Everything that advances one tick per second. */
  spinners: Spinner[];
  anchor: THREE.Object3D | null;
  clouds: THREE.Object3D;
  /** One ground point per district, in DISTRICTS order. */
  focusPoints: THREE.Vector3[];
  /** The palette every city material came from, so later scenes can share its surface ids. */
  palette: Palette;
};

/** The escape wheel: thirty hooked teeth, one released per second. */
function escapementWheel(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(21, 1.6, 5, 60)];
  for (let index = 0; index < 30; index += 1) {
    parts.push(new THREE.BoxGeometry(2, 7.5, 2.6).translate(0, 3.4, 0).rotateZ(-0.5).translate(0, 21.5, 0).rotateZ(index / 30 * TAU));
  }
  for (let index = 0; index < 6; index += 1) parts.push(new THREE.BoxGeometry(1.6, 21, 1.6).translate(0, 10.5, 0).rotateZ(index / 6 * TAU));
  parts.push(new THREE.CylinderGeometry(3.4, 3.4, 3.2, 12).rotateX(Math.PI / 2));
  return merge(parts);
}

/** The pallet fork that rocks over the escape wheel, pivoting at its origin. */
function anchorGeometry(): THREE.BufferGeometry {
  return merge([
    new THREE.CylinderGeometry(2.2, 2.2, 3, 10).rotateX(Math.PI / 2),
    new THREE.BoxGeometry(2.4, 7, 2.4).translate(0, -3.5, 0),
    new THREE.BoxGeometry(30, 2.6, 2.6).translate(0, -7, 0),
    new THREE.BoxGeometry(2.6, 9, 2.6).translate(0, -4.5, 0).rotateZ(0.3).translate(-14, -7, 0),
    new THREE.BoxGeometry(2.6, 9, 2.6).translate(0, -4.5, 0).rotateZ(-0.3).translate(14, -7, 0),
  ]);
}

function rotorGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(1.6, 1.6, 1.8, 8).rotateX(Math.PI / 2)];
  for (let blade = 0; blade < 4; blade += 1) parts.push(new THREE.BoxGeometry(2.6, 14, 0.7).translate(0, 8, 0).rotateZ(blade * Math.PI / 2));
  return merge(parts);
}

function loomWheel(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(8.6, 0.8, 5, 32), new THREE.CylinderGeometry(1.8, 1.8, 1.6, 10).rotateX(Math.PI / 2)];
  for (let paddle = 0; paddle < 8; paddle += 1) parts.push(new THREE.BoxGeometry(2.8, 3.6, 1).translate(0, 9.6, 0).rotateZ(paddle / 8 * TAU));
  for (let spoke = 0; spoke < 4; spoke += 1) parts.push(new THREE.BoxGeometry(0.9, 17.2, 0.6).rotateZ(spoke / 4 * Math.PI));
  return merge(parts);
}

type Animate = (key: MaterialKey, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, spin?: Omit<Spinner, "object">) => THREE.Mesh;

function buildIsland(batch: Batch, animated: Animate, layout: CityLayout) {
  if (layout.plan) {
    buildLondonGround(batch, layout.plan);
    batch.add("sea", new THREE.CircleGeometry(1600, 128).rotateX(-Math.PI / 2).translate(0, -3.15, 0));
    // A low natural shoreline replaces the suspended rock and clockwork rim.
    batch.add("strata", new THREE.CylinderGeometry(layout.plan.radius, layout.plan.radius - 3, 3, 96, 1, true).translate(0, -1.7, 0));
    return;
  }
  else {
    batch.add("ground", new THREE.CircleGeometry(ISLAND_RADIUS, 96).rotateX(-Math.PI / 2));
    batch.add("water", new THREE.RingGeometry(CANAL.inner, CANAL.outer, 96, 1).rotateX(-Math.PI / 2).translate(0, 0.35, 0));
    batch.add("paving", new THREE.RingGeometry(CANAL.outer + 14, CANAL.outer + 26, 96, 1).rotateX(-Math.PI / 2).translate(0, 0.25, 0));
  }
  batch.add("strata", new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS - 14, 18, 96, 1, true).translate(0, -9, 0));
  batch.add("rock", underside(ISLAND_RADIUS, layout.plan ? 220 : 500));
  animated("brass", gearGeometry(ISLAND_RADIUS + 16, { teeth: 120, tooth: 8, tube: 3, thickness: 5, spokes: 0 }).rotateX(Math.PI / 2),
    at(0, -7, 0), { axis: "y", step: TAU / 120 });
}

function buildTerraces(batch: Batch, layout: CityLayout) {
  TERRACES.forEach((terrace, index) => {
    batch.add("stone", new THREE.CylinderGeometry(terrace.radius, terrace.radius + 1.5, terrace.top, 96, 1, true).translate(0, terrace.top / 2, 0));
    const inner = TERRACES[index + 1];
    if (inner) {
      batch.add("terrace", new THREE.RingGeometry(inner.radius, terrace.radius, 96, 1).rotateX(-Math.PI / 2).translate(0, terrace.top, 0));
      batch.add("paving", new THREE.RingGeometry(terrace.radius - STREET.inset, terrace.radius - STREET.inset + STREET.width, 96, 1)
        .rotateX(-Math.PI / 2).translate(0, terrace.top + 0.25, 0));
    } else {
      batch.add("paving", new THREE.CircleGeometry(terrace.radius, 64).rotateX(-Math.PI / 2).translate(0, terrace.top, 0));
    }
  });
  const bridgeRadius = (CANAL.inner + CANAL.outer) / 2;
  for (const stair of layout.stairs) {
    for (const step of stair.steps) {
      batch.add("stone", new THREE.BoxGeometry(9, step.top - step.bottom, 2.6), frame(stair.bearing, step.r, (step.top + step.bottom) / 2));
    }
    // Deck from bridgeRadius − 26 to + 22, then three steps down to the promenade (matches the walk surface's ramp).
    batch.add("stone", new THREE.BoxGeometry(10, 1.6, 48), frame(stair.bearing, bridgeRadius - 2, 1.2));
    for (const [index, top] of [1.5, 1, 0.5].entries()) {
      batch.add("stone", new THREE.BoxGeometry(10, top, 4 / 3), frame(stair.bearing, bridgeRadius + 22 + (index + 0.5) * 4 / 3, top / 2));
    }
    for (const side of [-4.8, 4.8]) batch.add("brass", new THREE.BoxGeometry(0.7, 1.8, 48), local(frame(stair.bearing, bridgeRadius - 2, 0), side, 2.9, 0));
  }
}

/** A black iron lamp post with a cream lantern, or a red pillar box with its slot facing the street. */
/** Awning stripes per stall colourway: pillar-box red, grocer's green and mustard, each with cream. */
const AWNINGS = [["copper", "face"], ["fieldA", "face"], ["fieldB", "face"]] as const;
/** Fruit and veg on a stall counter, by colourway position: apples, oranges, greens. */
const PRODUCE = ["copper", "brass", "fieldA"] as const;

function addFurniture(batch: Batch, item: Furniture) {
  if (addLondonTransport(batch, item)) return;
  const base = at(item.x, item.y, item.z, (item.rotation ?? Math.PI - item.bearing) + (item.turn ?? 0));
  if (item.kind === "bin") {
    // A black street litter bin with a gilt band and a domed lid.
    batch.add("ink", new THREE.CylinderGeometry(0.44, 0.38, 1.45, 12), local(base, 0, 0.73, 0));
    batch.add("brass", new THREE.CylinderGeometry(0.455, 0.455, 0.12, 12), local(base, 0, 1.22, 0));
    batch.add("ink", new THREE.SphereGeometry(0.46, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), local(base, 0, 1.46, 0));
    return;
  }
  if (item.kind === "bollard") {
    // A black cast-iron bollard with a gilt ring and a rounded cap.
    batch.add("ink", new THREE.CylinderGeometry(0.2, 0.26, 1.2, 10), local(base, 0, 0.6, 0));
    batch.add("brass", new THREE.CylinderGeometry(0.23, 0.23, 0.08, 10), local(base, 0, 1.05, 0));
    batch.add("ink", new THREE.SphereGeometry(0.22, 10, 6), local(base, 0, 1.24, 0));
    return;
  }
  if (item.kind === "bench") {
    // A London park bench facing -Z: cast-iron ends and arms, two seat slats and a raked back.
    for (const side of [-1, 1]) {
      batch.add("ink", new THREE.BoxGeometry(0.12, 0.82, 0.86), local(base, side * 1.2, 0.41, 0.02));
      batch.add("ink", new THREE.BoxGeometry(0.12, 0.08, 0.62), local(base, side * 1.2, 0.74, -0.08));
    }
    for (const z of [-0.2, 0.14]) batch.add("trunk", new THREE.BoxGeometry(2.5, 0.08, 0.3), local(base, 0, 0.5, z));
    batch.add("trunk", new THREE.BoxGeometry(2.5, 0.42, 0.07).rotateX(-0.22), local(base, 0, 0.86, 0.38));
    return;
  }
  if (item.kind === "stall") {
    // A market stall facing -Z: a timber counter of produce under a striped awning on iron posts.
    const [stripe, cream] = AWNINGS[(item.variant ?? 0) % AWNINGS.length]!;
    batch.add("trunk", new THREE.BoxGeometry(4.0, 1.0, 1.3), local(base, 0, 0.5, -0.35));
    batch.add("trunk", new THREE.BoxGeometry(4.0, 0.5, 0.9), local(base, 0, 0.25, 0.75));
    for (let i = 0; i < 9; i += 1) {
      const kind = PRODUCE[(i + (item.variant ?? 0)) % PRODUCE.length]!;
      batch.add(kind, new THREE.IcosahedronGeometry(0.2, 0), local(base, -1.6 + i * 0.4, 1.17, -0.6 + (i % 2) * 0.35));
    }
    for (const x of [-1.95, 1.95]) for (const z of [-0.95, 0.95]) {
      batch.add("ink", new THREE.CylinderGeometry(0.06, 0.06, z < 0 ? 2.5 : 3.05, 6), local(base, x, z < 0 ? 1.25 : 1.52, z));
    }
    for (let i = 0; i < 6; i += 1) {
      // Each stripe runs front to back, raked down toward the counter.
      batch.add(i % 2 === 0 ? stripe : cream, new THREE.BoxGeometry(0.7, 0.06, 2.3).rotateX(-0.26), local(base, -1.75 + i * 0.7, 2.82, 0));
    }
    batch.add(stripe, new THREE.BoxGeometry(4.2, 0.28, 0.05), local(base, 0, 2.38, -1.13));
    return;
  }
  if (item.kind === "kiosk") {
    // A red telephone kiosk: plinth, body, glazed sides (pale panes behind red glazing bars, so it reads red from
    // across the square), a TELEPHONE strip on each face and a shallow domed roof with a gilt crown.
    batch.add("copper", new THREE.BoxGeometry(1.44, 0.16, 1.44), local(base, 0, 0.08, 0));
    batch.add("copper", new THREE.BoxGeometry(1.2, 2.5, 1.2), local(base, 0, 1.41, 0));
    for (let side = 0; side < 4; side += 1) {
      const face = local(base, 0, 0, 0, side * Math.PI / 2);
      batch.add("face", new THREE.BoxGeometry(0.86, 1.62, 0.04), local(face, 0, 1.3, -0.61));
      for (const x of [-0.15, 0.15]) batch.add("copper", new THREE.BoxGeometry(0.05, 1.62, 0.06), local(face, x, 1.3, -0.63));
      for (let row = 1; row < 6; row += 1) batch.add("copper", new THREE.BoxGeometry(0.86, 0.05, 0.06), local(face, 0, 0.49 + row * 0.27, -0.63));
      batch.add("face", new THREE.BoxGeometry(0.86, 0.17, 0.05), local(face, 0, 2.33, -0.62));
    }
    batch.add("copper", new THREE.BoxGeometry(1.36, 0.18, 1.36), local(base, 0, 2.75, 0));
    batch.add("copper", new THREE.SphereGeometry(0.7, 12, 4, 0, TAU, 0, Math.PI / 2).scale(1, 0.42, 1), local(base, 0, 2.84, 0));
    batch.add("brass", new THREE.BoxGeometry(0.22, 0.2, 0.22), local(base, 0, 3.22, 0));
    return;
  }
  if (item.kind === "planter") {
    // A Portland-stone planter with a clipped shrub.
    batch.add("stone", new THREE.BoxGeometry(2.2, 0.85, 2.2), local(base, 0, 0.43, 0));
    batch.add("stone", new THREE.BoxGeometry(2.4, 0.12, 2.4), local(base, 0, 0.9, 0));
    batch.add("leaf1", new THREE.IcosahedronGeometry(0.95, 1), local(base, 0, 1.7, 0, 0, [1, 0.95, 1]));
    return;
  }
  if (item.kind === "lamp") {
    batch.add("ink", new THREE.BoxGeometry(0.75, 0.6, 0.75), local(base, 0, 0.3, 0));
    batch.add("ink", new THREE.CylinderGeometry(0.13, 0.2, 6.2, 8), local(base, 0, 3.6, 0));
    batch.add("ink", new THREE.BoxGeometry(1.1, 0.16, 0.16), local(base, 0, 6.4, 0));
    batch.add("face", new THREE.BoxGeometry(0.8, 1.05, 0.8), local(base, 0, 7.15, 0));
    batch.add("ink", new THREE.ConeGeometry(0.72, 0.75, 4).rotateY(Math.PI / 4), local(base, 0, 8.05, 0));
    return;
  }
  batch.add("ink", new THREE.CylinderGeometry(0.66, 0.66, 0.16, 14), local(base, 0, 0.08, 0));
  batch.add("copper", new THREE.CylinderGeometry(0.55, 0.58, 1.55, 14), local(base, 0, 0.93, 0));
  batch.add("copper", new THREE.SphereGeometry(0.6, 14, 6, 0, TAU, 0, Math.PI / 2).scale(1, 0.55, 1), local(base, 0, 1.7, 0));
  batch.add("ink", new THREE.BoxGeometry(0.55, 0.1, 0.14), local(base, 0, 1.3, 0.52));
}

/** How high the summit's granite setts sit on its flagstones (just proud, so they never fight the paving). */
export const SETT_LIFT = 0.06;

/**
 * Granite sett walkways across the summit's pale flagstones, as in a London square: a frame round the tower plinth
 * and a path from it to the head of each stairway (the lanes the plaza furniture keeps clear). Darker and coursed
 * (slate swatch), they break up the plaza and mark the ways down.
 */
function addSummitSetts(batch: Batch) {
  const y = SUMMIT.top + SETT_LIFT;
  const flat = (width: number, length: number) => new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2);
  // The frame: four strips, each running the full outer width on two sides and between them on the other two.
  for (const side of [-1, 1]) {
    batch.add("roof0", flat(44, 4), at(0, y, side * 20));
    batch.add("roof0", flat(4, 36), at(side * 20, y, 0));
  }
  // Paths out from just beyond the frame to the summit's edge, 6 wide.
  const from = 22 / Math.cos(Math.PI / 8) + 0.5;
  for (const bearing of STAIR_BEARINGS) {
    const length = SUMMIT.radius - from;
    batch.add("roof0", flat(6, length), frame(bearing, from + length / 2, y));
  }
}

/** A low Portland-stone parapet along both river banks, open where the bridges cross. */
function addRiverParapets(batch: Batch) {
  for (const r of [CANAL.inner + 0.35, CANAL.outer - 0.35]) {
    const count = Math.floor((TAU * r) / 5);
    for (let i = 0; i < count; i += 1) {
      const bearing = ((i + 0.5) / count) * TAU;
      if (BRIDGE_BEARINGS.some((bridge) => angularGap(bearing, bridge) * r < 7)) continue;
      batch.add("stone", new THREE.BoxGeometry((TAU * r) / count + 0.05, 1.3, 0.7), frame(bearing, r, 0.65));
    }
  }
}

/**
 * The clock tower on the summit, in a Gothic-revival spirit: a Portland-stone shaft with corner buttresses, string
 * courses and tiers of pointed lancet windows; a clock stage whose four faces sit in gilded square surrounds; an open
 * belfry with the bell and the ticking crown gear; gilt-tipped pinnacles; and a tall slate spire with gilt bands and a
 * finial. Returns its four clock faces (centre, normal, right, up) for the hands.
 */
function buildTower(batch: Batch, animated: Animate, floor: number = SUMMIT.top): ClockFace[] {
  // A stepped plinth.
  batch.add("stone", new THREE.BoxGeometry(36, 10, 36), at(0, floor + 5, 0));
  batch.add("stone", new THREE.BoxGeometry(30, 3, 30), at(0, floor + 11.5, 0));

  // The shaft, with a buttress up each corner and string courses between the tiers.
  batch.add("stone", new THREE.BoxGeometry(24, 80, 24), at(0, floor + 50, 0));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    batch.add("stone", new THREE.BoxGeometry(3.6, 79, 3.6), at(x * 12, floor + 50.5, z * 12));
  }
  for (const y of [floor + 31, floor + 61]) batch.add("stone", new THREE.BoxGeometry(26.4, 1.3, 26.4), at(0, y, 0));
  batch.add("brass", new THREE.BoxGeometry(26.8, 1.8, 26.8), at(0, floor + 89, 0));

  // Pointed lancet windows: two per side in each of three tiers, a dark slot with a pointed head.
  for (let side = 0; side < 4; side += 1) {
    const bearing = side * Math.PI / 2;
    for (const [tier, y] of [[0, floor + 22], [1, floor + 46], [2, floor + 74]] as const) {
      for (const along of [-4.2, 4.2]) {
        const height = tier === 1 ? 13 : 10;
        batch.add("ink", new THREE.BoxGeometry(2.2, height, 0.8), local(frame(bearing, 12.05, y), along, 0, 0));
        batch.add("ink", new THREE.ConeGeometry(1.56, 2.6, 4).rotateY(Math.PI / 4).scale(1, 1, 0.36), local(frame(bearing, 12.05, y + height / 2 + 1.3), along, 0, 0));
      }
    }
  }

  const stage = floor + 104;
  batch.add("stone", new THREE.BoxGeometry(29, 28, 29), at(0, stage, 0));

  const faces: ClockFace[] = [];
  for (let side = 0; side < 4; side += 1) {
    const bearing = side * Math.PI / 2;
    const normal = new THREE.Vector3(Math.sin(bearing), 0, -Math.cos(bearing));
    const up = UP.clone();
    const right = new THREE.Vector3().crossVectors(up, normal);
    const basis = new THREE.Matrix4().makeBasis(right, up, normal);
    const center = new THREE.Vector3(0, stage, 0).addScaledVector(normal, 14.5);
    const onFace = (offset: number) => basis.clone().setPosition(center.clone().addScaledVector(normal, offset));
    batch.add("face", new THREE.CylinderGeometry(11, 11, 1, 40).rotateX(Math.PI / 2), onFace(0.5));
    batch.add("ink", new THREE.TorusGeometry(11, 0.9, 5, 40), onFace(1));
    for (let mark = 0; mark < 12; mark += 1) {
      batch.add("ink", new THREE.BoxGeometry(0.9, mark % 3 === 0 ? 2.6 : 1.6, 0.5).translate(0, 8.4, 0).rotateZ(-mark / 12 * TAU), onFace(1.1));
    }
    // The gilded square surround, with a gilt boss in each corner.
    for (const y of [-12.4, 12.4]) batch.add("brass", new THREE.BoxGeometry(26.2, 1.4, 0.9).translate(0, y, 0), onFace(0.45));
    for (const x of [-12.4, 12.4]) batch.add("brass", new THREE.BoxGeometry(1.4, 26.2, 0.9).translate(x, 0, 0), onFace(0.45));
    for (const [x, y] of [[-9.6, -9.6], [9.6, -9.6], [-9.6, 9.6], [9.6, 9.6]] as const) {
      batch.add("brass", new THREE.SphereGeometry(1.1, 8, 6).translate(x, y, 0), onFace(0.55));
    }
    faces.push({ center: center.clone().addScaledVector(normal, 1.3), normal, right, up });
  }

  // The open belfry: deck, corner posts, the bell and the crown gear.
  const deck = stage + 14;
  batch.add("stone", new THREE.BoxGeometry(30, 2, 30), at(0, deck + 1, 0));
  for (const [x, z] of [[-12.5, -12.5], [12.5, -12.5], [-12.5, 12.5], [12.5, 12.5]] as const) {
    batch.add("stone", new THREE.BoxGeometry(3, 18, 3), at(x, deck + 11, z));
  }
  batch.add("brass", new THREE.CylinderGeometry(3.5, 7, 9, 14), at(0, deck + 9.5, 0));
  batch.add("brass", new THREE.SphereGeometry(2.4, 10, 8), at(0, deck + 15, 0));
  batch.add("stone", new THREE.BoxGeometry(32, 2.4, 32), at(0, deck + 21.2, 0));

  // Gilt-tipped pinnacles at the corners of the belfry roof.
  for (const [x, z] of [[-14, -14], [14, -14], [-14, 14], [14, 14]] as const) {
    batch.add("stone", new THREE.BoxGeometry(2.6, 7, 2.6), at(x, deck + 25.9, z));
    batch.add("brass", new THREE.ConeGeometry(1.9, 7.5, 4).rotateY(Math.PI / 4), at(x, deck + 33.1, z));
  }

  // The slate spire, banded in gilt, with a small lantern and a finial.
  const spireBase = deck + 22.4;
  batch.add("roof0", new THREE.ConeGeometry(17.5, 56, 4).rotateY(Math.PI / 4), at(0, spireBase + 28, 0));
  // Sized to sit just proud of the spire at their heights (its half-diagonal there plus 0.4).
  for (const [y, size] of [[spireBase + 12, 28.4], [spireBase + 30, 17.1]] as const) {
    batch.add("brass", new THREE.CylinderGeometry(size / 2, size / 2, 0.9, 4, 1, true).rotateY(Math.PI / 4), at(0, y, 0));
  }
  batch.add("brass", new THREE.BoxGeometry(3.4, 4, 3.4), at(0, spireBase + 50, 0));
  batch.add("ink", new THREE.CylinderGeometry(0.45, 0.45, 9, 6), at(0, spireBase + 58, 0));
  batch.add("brass", new THREE.SphereGeometry(2.1, 10, 8), at(0, spireBase + 62, 0));

  // The belfry crown gear, held off the posts by four brackets.
  for (let corner = 0; corner < 4; corner += 1) batch.add("brass", new THREE.BoxGeometry(1.2, 1.2, 5), frame(Math.PI / 4 + corner * Math.PI / 2, 19.5, deck + 3.5));
  animated("brass", gearGeometry(25, { teeth: 24, tooth: 2.8, tube: 1.3, thickness: 1.8, spokes: 0 }).rotateX(Math.PI / 2),
    at(0, deck + 3.5, 0), { axis: "y", step: TAU / 24 });
  return faces;
}

/** Original, compact architectural studies of London landmarks. Geometry is batched with the street palette. */
function buildDistrict(batch: Batch, landmark: Landmark, kind: DistrictKind, animated: Animate): THREE.Object3D | null {
  const urban = landmark.rotation !== undefined;
  const size = landmark.scale ?? 1;
  const base = urban ? at(landmark.x, landmark.y, landmark.z, landmark.rotation, [size, size, size])
    : local(frame(landmark.bearing, landmark.radius, landmark.y), 0, kind === "port" ? TOWER_BRIDGE.modelLift : 0, 0, kind === "port" ? TOWER_BRIDGE.rotation : 0);
  const put = (key: MaterialKey, geometry: THREE.BufferGeometry, x: number, y: number, z: number, rotationY = 0, scale?: Scale) =>
    batch.add(key, geometry, local(base, x, y, z, rotationY, scale));
  const box = (key: MaterialKey, w: number, h: number, d: number, x: number, y: number, z: number) =>
    put(key, new THREE.BoxGeometry(w, h, d), x, y, z);
  const column = (key: MaterialKey, radius: number, height: number, x: number, y: number, z: number) =>
    put(key, new THREE.CylinderGeometry(radius, radius * 1.08, height, 12), x, y, z);
  const beam = (key: MaterialKey, from: THREE.Vector3, to: THREE.Vector3, thickness: number) => {
    const direction = to.clone().sub(from);
    const geometry = new THREE.CylinderGeometry(thickness, thickness, direction.length(), 6);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()));
    const middle = from.clone().add(to).multiplyScalar(0.5);
    put(key, geometry, middle.x, middle.y, middle.z);
  };
  const window = (x: number, y: number, z: number, w = 1.7, h = 3.2) => {
    box("stone", w + 0.7, h + 0.65, 0.38, x, y, z);
    box("ink", w, h, 0.48, x, y, z + 0.1);
    box("stone", 0.16, h, 0.54, x, y, z + 0.12);
    box("stone", w, 0.16, 0.54, x, y, z + 0.12);
    box("stone", w + 1, 0.25, 0.8, x, y - h / 2 - 0.3, z + 0.2);
  };
  const shrub = (x: number, z: number, size = 2.5) => {
    box("stone", size * 2.1, 0.65, size * 2.1, x, 0.33, z);
    put("leaf1", new THREE.IcosahedronGeometry(size, 1), x, size * 0.8 + 0.65, z, x);
  };
  const tree = (x: number, z: number, height = 14) => {
    column("trunk", 0.55, height * 0.55, x, height * 0.275, z);
    for (const [dx, dy, dz, radius] of [[0, 0, 0, 4.6], [-2, -1, 1, 3.2], [2, 1, -1, 3.4]] as const)
      put("leaf1", new THREE.IcosahedronGeometry(radius, 1), x + dx, height * 0.65 + dy, z + dz, x + z);
  };

  switch (kind) {
    case "windpumps": {
      // Regent's Park: an octagonal iron bandstand with a copper roof and ornamental beds.
      column("stone", 12, 0.7, 0, 0.35, 0);
      column("stone", 10.8, 1, 0, 1.1, 0);
      for (let i = 0; i < 8; i += 1) {
        const angle = i / 8 * TAU;
        const x = Math.cos(angle) * 9.4;
        const z = Math.sin(angle) * 9.4;
        column("ink", 0.22, 10, x, 6.5, z);
        column("stone", 0.48, 0.5, x, 1.9, z);
        put("brass", new THREE.SphereGeometry(0.36, 8, 6), x, 11.8, z);
        const next = (i + 1) / 8 * TAU;
        if (i !== 1) {
          beam("ink", new THREE.Vector3(x, 3.7, z), new THREE.Vector3(Math.cos(next) * 9.4, 3.7, Math.sin(next) * 9.4), 0.1);
          for (let rail = 1; rail <= 5; rail += 1) {
            const t = rail / 6;
            const rx = THREE.MathUtils.lerp(x, Math.cos(next) * 9.4, t);
            const rz = THREE.MathUtils.lerp(z, Math.sin(next) * 9.4, t);
            column("ink", 0.06, 1.7, rx, 2.85, rz);
          }
        }
      }
      put("roof0", new THREE.ConeGeometry(12, 5, 8), 0, 13.5, 0);
      column("brass", 0.4, 3, 0, 17, 0);
      put("brass", new THREE.SphereGeometry(0.8, 10, 6), 0, 18.6, 0);
      for (const x of [-21, 21]) for (const z of [-13, 13]) shrub(x, z, 3);
      for (const z of [-18, 18]) {
        box("trunk", 7, 0.35, 1.2, 0, 1.1, z);
        for (const x of [-2.6, 2.6]) box("ink", 0.24, 1, 1.1, x, 0.5, z);
      }
      return null;
    }
    case "observatory": {
      // St Paul's: Portland stone nave, west portico, paired towers and the ribbed lead dome.
      box("stone", 33, 1.2, 29, 0, 0.6, 0);
      box("stone", 27, 13, 24, 0, 7.7, -2);
      box("stone", 40, 11, 11, 0, 6.7, -2);
      box("wall0", 28, 1.1, 25, 0, 14.4, -2);
      put("roof1", gableRoof(), 0, 15, -2, Math.PI / 2, [24, 4, 28]);
      column("stone", 9.4, 6, 0, 18, -3);
      for (let i = 0; i < 16; i += 1) {
        const a = i / 16 * TAU;
        column("wall0", 0.45, 5.6, Math.cos(a) * 9.1, 18, -3 + Math.sin(a) * 9.1);
      }
      column("stone", 10.1, 1, 0, 21.5, -3);
      put("roof0", new THREE.SphereGeometry(9.6, 32, 12, 0, TAU, 0, Math.PI / 2).scale(1, 1.25, 1), 0, 22, -3);
      for (let i = 0; i < 12; i += 1) {
        const a = i / 12 * TAU;
        const points = Array.from({ length: 13 }, (_, k) => {
          const t = k / 12 * Math.PI / 2;
          return new THREE.Vector3(Math.cos(a) * 9.65 * Math.sin(t), 22 + 12.1 * Math.cos(t), -3 + Math.sin(a) * 9.65 * Math.sin(t));
        });
        for (let k = 1; k < points.length; k += 1) beam("stone", points[k - 1]!, points[k]!, 0.12);
      }
      column("stone", 2.1, 3.5, 0, 35, -3);
      put("roof1", new THREE.ConeGeometry(2.7, 2.8, 12), 0, 38, -3);
      box("brass", 0.35, 3.8, 0.35, 0, 41.1, -3);
      box("brass", 2.3, 0.35, 0.35, 0, 41.7, -3);
      // The west facade faces the square; the doorway remains accessible at local (0, 19).
      box("stone", 27, 9, 4, 0, 5.7, 12);
      for (const x of [-10, -6, -2, 2, 6, 10]) {
        column("wall0", 0.65, 7.2, x, 5.2, 14.5);
        box("stone", 1.8, 0.5, 1.8, x, 1.45, 14.5);
      }
      box("stone", 27, 1, 5, 0, 9.7, 12.8);
      put("stone", gableRoof(), 0, 10.2, 12.8, 0, [27, 5, 5]);
      box("ink", 3.3, 5.2, 0.5, 0, 3.8, 14.15);
      for (const x of [-18, 18]) {
        box("stone", 6.5, 15, 7, x, 8.7, 10);
        box("stone", 7.3, 0.8, 7.8, x, 16.5, 10);
        column("stone", 2.6, 6, x, 20, 10);
        for (const dx of [-1.5, 1.5]) window(x + dx, 12, 13.65, 0.8, 3.8);
        put("roof1", new THREE.SphereGeometry(3.1, 12, 6, 0, TAU, 0, Math.PI / 2), x, 23.4, 10);
        column("brass", 0.28, 3, x, 26.2, 10);
      }
      for (const x of [-10, -5, 5, 10]) window(x, 8, -14.15, 1.3, 4.8);
      return null;
    }
    case "port": {
      // Tower Bridge in miniature: paired Gothic towers, pale blue suspension chains and high-level walkways.
      // The long axis crosses the canal radially. A road at y=2 and two ramps match the walk surface exactly.
      box("paving", 44, 0.3, 10, 0, 0.15, 0);
      box("roof1", 44, 0.18, 7, 0, 0.38, 0);
      for (const sign of [-1, 1]) {
        if (!urban) put("stone", wedge(4, 2, 10), sign * 22, -TOWER_BRIDGE.modelLift, 0, sign < 0 ? Math.PI : 0);
      }
      for (const z of [-4.5, 4.5]) {
        box("stone", 44, 0.25, 1.4, 0, 0.65, z);
        box("water", 44, 0.3, 0.28, 0, 2.8, z);
        for (let x = -22; x <= 22; x += 2) column("water", 0.08, 2.1, x, 1.65, z);
        for (const sign of [-1, 1]) {
          beam("water", new THREE.Vector3(sign * 22, 2.8, z), new THREE.Vector3(sign * 26, 0.8, z), 0.14);
          for (const distance of [24, 26]) column("water", 0.08, 2.1, sign * distance, 1.65 - (distance - 22) / 2, z);
        }
      }
      for (const x of [-14, 14]) {
        for (const z of [-5.8, 5.8]) {
          box("stone", 7.8, 3, 4.8, x, -0.5, z);
          box("stone", 7.3, 18, 4.2, x, 9, z);
          box("stone", 8, 1, 5, x, 18, z);
          put("roof0", pyramidRoof(), x, 18.6, z, 0, [8.3, 6.4, 5.4]);
          for (const dx of [-2.6, 2.6]) {
            column("stone", 0.55, 21, x + dx, 10.5, z);
            put("roof1", new THREE.ConeGeometry(0.8, 3.2, 4), x + dx, 22.5, z);
          }
          window(x, 13.5, z + 2.2, 2.1, 5);
        }
        box("stone", 7.3, 3, 11.6, x, 15.5, 0);
        box("water", 6.8, 1, 12, x, 18, 0);
      }
      for (const z of [-4.7, 4.7]) {
        box("water", 28, 1.3, 1, 0, 15.6, z);
        box("water", 28, 0.5, 1.3, 0, 18, z);
        for (let x = -12; x <= 12; x += 3) {
          beam("water", new THREE.Vector3(x, 16, z), new THREE.Vector3(x + 2.6, 17.7, z), 0.12);
          beam("water", new THREE.Vector3(x, 17.7, z), new THREE.Vector3(x + 2.6, 16, z), 0.12);
        }
        for (const sign of [-1, 1]) {
          for (let k = 1; k <= 8; k += 1) {
            const t = k / 8;
            const prev = (k - 1) / 8;
            const point = (u: number) => new THREE.Vector3(sign * (14 + u * 13), 18 - 15.3 * Math.sin(u * Math.PI / 2), z);
            beam("water", point(prev), point(t), 0.2);
            column("water", 0.075, Math.max(0.1, point(t).y - 2.8), point(t).x, (point(t).y + 2.8) / 2, z);
          }
        }
      }
      // Quayside bollards and mooring ropes sit outside the central road.
      for (const x of [-25, 25]) for (const z of [-8, 8]) {
        column("ink", 0.35, 1.2, x, 0.6 - (urban ? 0 : TOWER_BRIDGE.modelLift), z);
        box("ink", 1.05, 0.2, 0.3, x, 1.2 - (urban ? 0 : TOWER_BRIDGE.modelLift), z);
      }
      return null;
    }
    case "workshops": {
      // Battersea's monumental brick turbine hall and four cream chimneys.
      box("wall2", 42, 14, 24, 0, 7, 0);
      box("wall1", 44, 1.2, 26, 0, 14.2, 0);
      box("wall2", 26, 6, 20, 0, 17.8, 0);
      box("roof1", 27, 0.8, 21, 0, 21.2, 0);
      for (const x of [-18, 18]) for (const z of [-9, 9]) {
        box("wall1", 5.4, 21, 5.4, x, 10.5, z);
        box("stone", 6, 1, 6, x, 21.5, z);
        put("wall0", new THREE.CylinderGeometry(1.1, 2, 23, 16), x, 33.5, z);
        for (const y of [24, 29, 34, 39, 44]) column("stone", 1.4 - (y - 24) * 0.018, 0.35, x, y, z);
        column("ink", 1.05, 0.2, x, 45.1, z);
      }
      for (const z of [-12.2, 12.2]) {
        for (let x = -15; x <= 15; x += 3) {
          box("stone", 0.7, 12, 0.6, x, 7, z);
          box("ink", 1.1, 7, 0.5, x + 1.4, 8.2, z);
          for (const y of [5.5, 8, 10.5]) box("stone", 1.1, 0.13, 0.6, x + 1.4, y, z);
        }
      }
      box("ink", 3.8, 5, 0.5, 0, 2.5, 12.3);
      return null;
    }
    case "escapement": {
      // Westminster Palace: an intricate Gothic facade, pinnacles and Victoria Tower.
      box("stone", 48, 1.2, 17, 0, 0.6, -7);
      box("wall1", 47, 14, 14, 0, 8, -7);
      box("stone", 48, 0.7, 15, 0, 15.4, -7);
      put("roof1", gableRoof(), 0, 15.8, -7, 0, [45, 4.5, 14]);
      for (let x = -21; x <= 21; x += 3.5) {
        box("stone", 0.6, 17.2, 1, x, 9.1, 0.3);
        put("stone", new THREE.ConeGeometry(0.85, 3.5, 4), x, 19.5, 0.3);
        window(x + 1.6, 5.2, 0.15, 1.4, 4.7);
        window(x + 1.6, 11.4, 0.15, 1.4, 4.5);
      }
      for (const x of [-22, 22]) {
        box("stone", 7, 23, 8, x, 11.5, -7);
        box("stone", 7.8, 1, 8.8, x, 23.5, -7);
        for (const dx of [-2.8, 2.8]) for (const dz of [-3.2, 3.2]) {
          column("stone", 0.55, 27, x + dx, 13.5, -7 + dz);
          put("stone", new THREE.ConeGeometry(0.85, 3, 4), x + dx, 28.5, -7 + dz);
        }
        for (const y of [6, 13, 20]) window(x, y, -2.8, 2.1, 4);
      }
      box("ink", 3.4, 5.6, 0.5, 0, 3.4, 0.6);
      if (!urban) {
      // The retired clockwork scene retains its service hatch only in explicit legacy fixtures.
      box("ink", 4.8, 4.8, 0.4, 8, 3.5, 1);
      for (const x of [5.4, 10.6]) box("stone", 0.35, 5.4, 0.55, x, 3.5, 1);
      box("stone", 5.5, 0.35, 0.55, 8, 6.2, 1);
      animated("brass", gearGeometry(1.5, { teeth: 12, tooth: 0.35, tube: 0.2, thickness: 0.25, spokes: 4 }),
        local(base, 8, 3.5, 1.35), { axis: "z", step: TAU / 12 });
      }
      // A gilded portcullis above the door carries the clockwork motif at human scale.
      for (let x = -1.5; x <= 1.5; x += 0.75) box("brass", 0.12, 2.7, 0.12, x, 8, 0.75);
      for (const y of [7.3, 8, 8.7]) box("brass", 3.2, 0.12, 0.12, 0, y, 0.75);
      return null;
    }
    case "farm": {
      // Kew Palm House: a curved, glazed nave with slender white iron ribs and lower side wings.
      const shell = (x: number, width: number, depth: number, height: number) => {
        box("stone", width + 0.8, 0.8, depth + 0.8, x, 0.4, 0);
        box("water", width, 5, depth, x, 3.3, 0);
        put("water", new THREE.CylinderGeometry(depth / 2, depth / 2, width, 16, 1, true, 0, Math.PI).rotateZ(Math.PI / 2), x, 5.8, 0, 0, [1, height / (depth / 2), 1]);
        for (let rx = -width / 2; rx <= width / 2 + 0.01; rx += width / Math.ceil(width / 3)) {
          for (let i = 1; i <= 16; i += 1) {
            const point = (k: number) => new THREE.Vector3(x + rx, 5.8 + Math.sin(k / 16 * Math.PI) * height, Math.cos(k / 16 * Math.PI) * depth / 2);
            beam("wall0", point(i - 1), point(i), 0.13);
          }
          for (const z of [-depth / 2, depth / 2]) column("wall0", 0.14, 5.2, x + rx, 3.2, z);
        }
        for (const z of [-depth / 2, depth / 2]) for (const y of [1, 3.4, 5.8]) box("wall0", width, 0.2, 0.22, x, y, z);
      };
      shell(0, 25, 18, 9);
      shell(-18, 10, 13, 5.5);
      shell(18, 10, 13, 5.5);
      box("stone", 6, 7, 3.5, 0, 3.5, 10.5);
      box("ink", 3.4, 5.7, 0.4, 0, 2.9, 12.4);
      put("stone", gableRoof(), 0, 7, 10.5, 0, [6.8, 2.7, 4]);
      for (const x of [-18, -10, 10, 18]) shrub(x, 17, 2);
      return null;
    }
    case "market": {
      // Covent Garden's iron-roofed market, with a clear pedestrian aisle between its two halls.
      for (const x of [-14, 14]) {
        box("stone", 17, 1, 28, x, 0.5, 0);
        for (const dx of [-7.4, 7.4]) for (const z of [-12, -6, 0, 6, 12]) {
          column("leaf0", 0.24, 8.6, x + dx, 5.2, z);
          box("stone", 0.9, 0.5, 0.9, x + dx, 1.2, z);
        }
        put("roof0", gableRoof(), x, 9.5, 0, Math.PI / 2, [29, 4.5, 17]);
        for (const z of [-12, -6, 0, 6, 12]) {
          beam("leaf0", new THREE.Vector3(x - 8, 9.3, z), new THREE.Vector3(x, 13.7, z), 0.18);
          beam("leaf0", new THREE.Vector3(x + 8, 9.3, z), new THREE.Vector3(x, 13.7, z), 0.18);
        }
        for (const z of [-7.5, 0, 7.5]) {
          box("trunk", 6, 2, 4.6, x, 2, z);
          for (let stripe = 0; stripe < 6; stripe += 1)
            box(stripe % 2 ? "face" : "copper", 1.15, 0.15, 5.8, x - 2.85 + stripe * 1.14, 5.2, z);
          for (let fruit = 0; fruit < 10; fruit += 1) put(fruit % 2 ? "brass" : "copper", new THREE.IcosahedronGeometry(0.34, 0), x - 2.4 + (fruit % 5) * 1.2, 3.35, z - 1.1 + Math.floor(fruit / 5) * 1.6);
        }
      }
      for (const z of [-13.5, 13.5]) {
        box("stone", 45, 1, 1.6, 0, 9.1, z);
        box("leaf0", 45, 0.5, 2, 0, 10.1, z);
      }
      return null;
    }
    case "orchard": {
      // Bloomsbury: plane trees, clipped hedges, iron railings and a little formal fountain.
      put("paving", new THREE.CircleGeometry(24, 40).rotateX(-Math.PI / 2), 0, 0.08, 0);
      column("stone", 6.2, 0.6, 0, 0.3, 0);
      column("stone", 5.7, 0.9, 0, 1, 0);
      column("water", 5.1, 0.1, 0, 1.4, 0);
      column("stone", 0.75, 3.2, 0, 2.8, 0);
      put("stone", new THREE.CylinderGeometry(3.4, 1.2, 1, 20), 0, 4.6, 0);
      column("water", 2.9, 0.1, 0, 5.15, 0);
      column("stone", 0.4, 1.6, 0, 5.5, 0);
      put("brass", new THREE.SphereGeometry(0.55, 10, 8), 0, 6.5, 0);
      for (const x of [-19, 19]) for (const z of [-11, 11]) tree(x, z, 14 + (x + z) % 3);
      for (const x of [-12, 12]) for (const z of [-17, 17]) shrub(x, z, 2.6);
      for (const z of [-22, 22]) {
        for (const sign of [-1, 1]) {
          box("ink", 16, 0.14, 0.14, sign * 13, 2.3, z);
          for (let x = 5.5; x <= 21; x += 1.3) {
            column("ink", 0.06, 2.7, sign * x, 1.35, z);
            put("ink", new THREE.ConeGeometry(0.17, 0.4, 4), sign * x, 2.9, z);
          }
        }
      }
      return null;
    }
  }
}

function buildClouds(palette: Palette): THREE.Group {
  const rng = new SeededRandom(0xc10d);
  const parts: THREE.BufferGeometry[] = [];
  for (let index = 0; index < 18; index += 1) {
    const bearing = rng.range(0, TAU);
    const radius = rng.range(560, 900);
    const y = index < 13 ? rng.range(40, 175) : rng.range(-330, -150);
    const { x, z } = polarToXZ(bearing, radius);
    const puffs = 3 + rng.int(0, 2);
    for (let puff = 0; puff < puffs; puff += 1) {
      const size = rng.range(9, 18);
      const offset = (puff - (puffs - 1) / 2) * size * 1.15;
      parts.push(new THREE.IcosahedronGeometry(size, 1)
        .applyMatrix4(at(x, y + rng.range(-3, 4), z, bearing + Math.PI / 2).multiply(at(offset, 0, rng.range(-4, 4)))));
    }
  }
  const group = new THREE.Group();
  group.name = "Drifting clouds";
  const mesh = new THREE.Mesh(merge(parts), palette.get("cloud"));
  mesh.name = "cloud";
  group.add(mesh);
  return group;
}

/** Hour and minute hands for all four faces as one mesh; rebuilt once a minute. */
export function handsGeometry(faces: readonly ClockFace[], hour: number, minute: number): THREE.BufferGeometry {
  if (faces.length === 0) return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([], 3));
  const parts: THREE.BufferGeometry[] = [];
  for (const face of faces) {
    const place = new THREE.Matrix4().makeBasis(face.right, face.up, face.normal).setPosition(face.center);
    parts.push(new THREE.BoxGeometry(1.7, 6.6, 0.5).translate(0, 2.1, 0.3).rotateZ(-hour).applyMatrix4(place));
    parts.push(new THREE.BoxGeometry(1.15, 9.6, 0.5).translate(0, 3.6, 0.8).rotateZ(-minute).applyMatrix4(place));
    parts.push(new THREE.CylinderGeometry(1.1, 1.1, 1.6, 10).rotateX(Math.PI / 2).translate(0, 0, 0.6).applyMatrix4(place));
  }
  return merge(parts);
}

export function buildCity(layout: CityLayout = createCityLayout()): BuiltCity {
  const palette = new Palette((index) => DISTRICTS[index]?.accent);
  const batch = new Batch();
  const group = new THREE.Group();
  group.name = layout.plan ? "Little London island" : "Clockwork hill town";
  const spinners: Spinner[] = [];
  const animated: Animate = (key, geometry, matrix, spin) => {
    const mesh = new THREE.Mesh(normalize(geometry), palette.get(key));
    mesh.name = `${key} (moving)`;
    mesh.applyMatrix4(matrix);
    group.add(mesh);
    if (spin) spinners.push({ object: mesh, ...spin });
    return mesh;
  };

  buildIsland(batch, animated, layout);
  if (!layout.plan) buildTerraces(batch, layout);
  addLondonRoads(batch, layout);
  if (!layout.plan) { addRiverParapets(batch); addSummitSetts(batch); }
  for (const item of createStreetFurniture(layout)) addFurniture(batch, item);
  for (const house of layout.houses) addHouse(batch, house);
  addLondonShopfronts(batch, layout);
  for (const tree of layout.trees) addTree(batch, tree);
  const faces = layout.plan ? [] : buildTower(batch, animated);
  let anchor: THREE.Object3D | null = null;
  for (const landmark of layout.landmarks) {
    const district = DISTRICTS[landmark.district];
    if (district) anchor = buildDistrict(batch, landmark, district.kind, animated) ?? anchor;
  }

  const statics = batch.build(palette, group);
  group.add(buildLondonSigns(layout));
  const clouds = buildClouds(palette);
  group.add(clouds);
  const hands = new THREE.Mesh(handsGeometry(faces, 0, 0), palette.get("ink"));
  hands.name = "clock hands";
  if (faces.length) group.add(hands);

  return {
    group,
    pickables: statics.filter((mesh) => mesh.name !== "smoke"),
    hands,
    faces,
    spinners,
    anchor,
    clouds,
    palette,
    focusPoints: layout.landmarks.map((landmark) => new THREE.Vector3(landmark.x, landmark.y, landmark.z)),
  };
}
