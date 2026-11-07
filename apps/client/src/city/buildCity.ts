import * as THREE from "three";
import { SeededRandom } from "@clockwork/shared";
import { DISTRICTS, type DistrictKind } from "./districts";
import {
  CANAL, ISLAND_RADIUS, STAIR_BEARINGS, STREET, SUMMIT, TERRACES, angularGap, createCityLayout, createStreetFurniture, polarToXZ,
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
  anchor: THREE.Object3D;
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

function buildIsland(batch: Batch, animated: Animate) {
  batch.add("ground", new THREE.CircleGeometry(ISLAND_RADIUS, 96).rotateX(-Math.PI / 2));
  batch.add("water", new THREE.RingGeometry(CANAL.inner, CANAL.outer, 96, 1).rotateX(-Math.PI / 2).translate(0, 0.35, 0));
  batch.add("paving", new THREE.RingGeometry(CANAL.outer + 14, CANAL.outer + 26, 96, 1).rotateX(-Math.PI / 2).translate(0, 0.25, 0));
  batch.add("strata", new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS - 14, 18, 96, 1, true).translate(0, -9, 0));
  batch.add("rock", underside(ISLAND_RADIUS));
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
  const base = local(frame(item.bearing, Math.hypot(item.x, item.z), item.y), 0, 0, 0, item.turn ?? 0);
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
      if (STAIR_BEARINGS.some((stair) => angularGap(bearing, stair) * r < 7)) continue;
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
function buildTower(batch: Batch, animated: Animate): ClockFace[] {
  const floor = SUMMIT.top;
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

/** One district's signature landmark. Returns the escapement anchor when it builds one. */
function buildDistrict(batch: Batch, landmark: Landmark, kind: DistrictKind, animated: Animate): THREE.Object3D | null {
  const accent: MaterialKey = `accent${landmark.district}`;
  const base = frame(landmark.bearing, landmark.radius, landmark.y);
  const put = (key: MaterialKey, geometry: THREE.BufferGeometry, x: number, y: number, z: number, rotationY = 0, scale?: Scale) =>
    batch.add(key, geometry, local(base, x, y, z, rotationY, scale));

  switch (kind) {
    case "windpumps":
      for (const [x, z] of [[-18, 4], [0, -6], [18, 4]] as const) {
        put("wall1", new THREE.BoxGeometry(9, 7, 9), x, 3.5, z);
        put(accent, pyramidRoof(), x, 7, z, 0, [10, 4.5, 10]);
        put("copper", new THREE.CylinderGeometry(1.1, 1.8, 34, 6), x, 24, z);
        animated(accent, rotorGeometry(), local(base, x, 42, z + 2.4), { axis: "z", step: Math.PI / 6 });
      }
      return null;
    case "observatory":
      put("wall0", new THREE.CylinderGeometry(15, 16, 14, 20), 0, 7, 0);
      put("ink", new THREE.TorusGeometry(16.4, 0.7, 4, 40).rotateX(Math.PI / 2), 0, 14, 0);
      put(accent, new THREE.SphereGeometry(15.4, 20, 10, 0, TAU, 0, Math.PI / 2), 0, 14, 0);
      put("ink", new THREE.CylinderGeometry(2.1, 2.7, 26, 10).rotateX(0.8), 0, 25, 6);
      put("wall1", new THREE.BoxGeometry(8, 9, 8), -21, 4.5, 6);
      put(accent, pyramidRoof(), -21, 9, 6, 0, [9, 4.5, 9]);
      return null;
    case "port": {
      put("paving", new THREE.CircleGeometry(24, 40).rotateX(-Math.PI / 2), 0, 0.45, 0);
      // A real sundial: the gnomon points true north whatever the camera does.
      batch.add("ink", wedge(14, 9, 1.2).rotateY(Math.PI / 2), at(landmark.x, 0.45, landmark.z + 7));
      for (let hour = 0; hour < 9; hour += 1) {
        batch.add("ink", new THREE.BoxGeometry(0.5, 0.2, 13).translate(0, 0, -6.5), at(landmark.x, 0.6, landmark.z + 7, (hour - 4) * 0.36));
      }
      batch.add("stone", new THREE.BoxGeometry(7, 1.4, 26), frame(landmark.bearing, 347, 1));
      [-0.05, 0.036, 0.078].forEach((offset, index) => {
        const boat = frame(landmark.bearing + offset, 332, 0.4);
        batch.add("wall1", new THREE.BoxGeometry(13, 2.6, 5), local(boat, 0, 1.3, 0));
        batch.add("wall2", new THREE.BoxGeometry(4, 2.6, 3.6), local(boat, -3, 3.9, 0));
        batch.add("ink", new THREE.CylinderGeometry(0.35, 0.35, 10, 5), local(boat, 2.5, 7.6, 0));
        batch.add(index === 1 ? "wall0" : accent, wedge(6, 8, 0.4), local(boat, 2.8, 3.2, 0));
      });
      return null;
    }
    case "workshops":
      for (const [x, z] of [[-16, -4], [0, 4], [16, -4]] as const) {
        put("wall2", new THREE.BoxGeometry(14, 9, 13), x, 4.5, z);
        for (const offset of [-4.3, 0, 4.3]) put(accent, gableRoof(), x, 9, z + offset, 0, [14.6, 3.6, 4.4]);
        put("ink", new THREE.CylinderGeometry(1.8, 2.3, 26, 8), x + 5, 13, z - 3);
        for (let puff = 0; puff < 3; puff += 1) put("smoke", new THREE.IcosahedronGeometry(2.6 + puff, 1), x + 5 + puff * 1.6, 28 + puff * 4.5, z - 3 - puff);
      }
      return null;
    case "escapement":
      put("stone", new THREE.BoxGeometry(12, 44, 9), 0, 22, -10);
      put("ink", new THREE.BoxGeometry(2.4, 30, 2.4), 0, 59, -6);
      put("ink", new THREE.BoxGeometry(2.4, 2.4, 7), 0, 72, -2.5);
      put("ink", new THREE.CylinderGeometry(1.6, 1.6, 12, 8).rotateX(Math.PI / 2), 0, 34, -4);
      animated(accent, escapementWheel(), local(base, 0, 34, 0), { axis: "z", step: TAU / 30 });
      return animated("ink", anchorGeometry(), local(base, 0, 72, 1.6));
    case "farm":
      for (let stripe = 0; stripe < 4; stripe += 1) put(stripe % 2 ? "fieldB" : "fieldA", new THREE.BoxGeometry(26, 0.6, 5.6), -9, 0.3, -9 + stripe * 6);
      put("wall1", new THREE.BoxGeometry(11, 15, 10), 15, 7.5, -2);
      put(accent, gableRoof(), 15, 15, -2, 0, [11.8, 6, 11.4]);
      animated(accent, loomWheel(), local(base, 15, 13, 3.6), { axis: "z", step: TAU / 16 });
      return null;
    case "market":
      [-15, -5, 5, 15].forEach((x, column) => [-6, 6].forEach((z, row) => {
        put("wall2", new THREE.BoxGeometry(6.5, 3, 4), x, 1.5, z);
        for (const postX of [-3, 3]) for (const postZ of [-2, 2]) put("ink", new THREE.BoxGeometry(0.5, 6.6, 0.5), x + postX, 3.3, z + postZ);
        put((column + row) % 2 ? "wall0" : accent, gableRoof(), x, 6.6, z, 0, [7.6, 2.4, 5.4]);
      }));
      return null;
    case "orchard":
      for (const x of [-18, -6, 6, 18]) for (const z of [-10, 0, 10]) {
        if (Math.abs(x) === 6 && z === 0) continue;
        put("trunk", new THREE.CylinderGeometry(0.8, 1.2, 6, 5), x, 3, z);
        put("brass", new THREE.IcosahedronGeometry(4.6, 0), x, 9.2, z, (x + z) * 0.4);
      }
      put("stone", new THREE.CylinderGeometry(6, 6, 0.8, 12), 0, 0.4, 0);
      for (let post = 0; post < 6; post += 1) {
        const angle = post / 6 * TAU;
        put("ink", new THREE.BoxGeometry(0.6, 6, 0.6), Math.cos(angle) * 4.8, 3.8, Math.sin(angle) * 4.8);
      }
      put(accent, new THREE.ConeGeometry(6.4, 4.6, 6), 0, 9.1, 0);
      return null;
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
  group.name = "Clockwork hill town";
  const spinners: Spinner[] = [];
  const animated: Animate = (key, geometry, matrix, spin) => {
    const mesh = new THREE.Mesh(normalize(geometry), palette.get(key));
    mesh.name = `${key} (moving)`;
    mesh.applyMatrix4(matrix);
    group.add(mesh);
    if (spin) spinners.push({ object: mesh, ...spin });
    return mesh;
  };

  buildIsland(batch, animated);
  buildTerraces(batch, layout);
  addRiverParapets(batch);
  addSummitSetts(batch);
  for (const item of createStreetFurniture(layout)) addFurniture(batch, item);
  for (const house of layout.houses) addHouse(batch, house);
  for (const tree of layout.trees) addTree(batch, tree);
  const faces = buildTower(batch, animated);
  let anchor: THREE.Object3D | null = null;
  for (const landmark of layout.landmarks) {
    const district = DISTRICTS[landmark.district];
    if (district) anchor = buildDistrict(batch, landmark, district.kind, animated) ?? anchor;
  }

  const statics = batch.build(palette, group);
  const clouds = buildClouds(palette);
  group.add(clouds);
  const hands = new THREE.Mesh(handsGeometry(faces, 0, 0), palette.get("ink"));
  hands.name = "clock hands";
  group.add(hands);

  return {
    group,
    pickables: statics.filter((mesh) => mesh.name !== "smoke"),
    hands,
    faces,
    spinners,
    anchor: anchor ?? new THREE.Object3D(),
    clouds,
    palette,
    focusPoints: layout.landmarks.map((landmark) => new THREE.Vector3(landmark.x, landmark.y, landmark.z)),
  };
}
