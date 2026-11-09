import type { DistrictKind } from "./districts";
import { TOWER_BRIDGE } from "./layout";

/**
 * Collision envelopes for the original London studies in buildCity. Coordinates are local to a landmark:
 * X along the street, Z away from the clock tower; bottom/top are heights above its paving. Keeping these in one
 * place gives the walker and follow camera the same walls, open door approaches and pedestrian passages.
 * Low paving/plinths are intentionally omitted. Elevated roofs/walkways stop the camera without closing paths.
 */
export type LandmarkSolid =
  | { box: readonly [x: number, z: number, halfX: number, halfZ: number, bottom: number, top: number] }
  | { col: readonly [x: number, z: number, radius: number, bottom: number, top: number] };

const box = (x: number, z: number, halfX: number, halfZ: number, bottom: number, top: number): LandmarkSolid => ({ box: [x, z, halfX, halfZ, bottom, top] });
const col = (x: number, z: number, radius: number, bottom: number, top: number): LandmarkSolid => ({ col: [x, z, radius, bottom, top] });

/** Tower Bridge in its authored model frame (long X, road y=.47); the flat London plan supplies its own frame/lift. */
export const LONDON_PORT_SOLIDS: readonly LandmarkSolid[] = [
  // Four tower piers leave a 7.4-unit passage along the road (Z=0).
  ...[-14, 14].flatMap((x) => [-5.8, 5.8].map((z) => box(x, z, 3.65, 2.1, 0, 25))),
  ...[-14, 14].map((x) => box(x, 0, 3.65, 5.8, 14, 18.5)),
  ...[-4.7, 4.7].map((z) => box(0, z, 14, 0.65, 15, 18.3)),
  ...[-4.5, 4.5].flatMap((z) => [box(0, z, 10.35, 0.18, 0, 2.95), box(-22.3, z, 4.65, 0.18, 0, 2.95), box(22.3, z, 4.65, 0.18, 0, 2.95)]),
  ...[-25, 25].flatMap((x) => [-8, 8].map((z) => col(x, z, 0.53, 0, 1.3))),
];

export const LONDON_LANDMARK_SOLIDS: Readonly<Record<DistrictKind, readonly LandmarkSolid[]>> = {
  windpumps: [
    // The bandstand's raised stage is not an enterable building. Its envelope includes the iron roof.
    col(0, 0, 12, 0, 16.2), col(0, 0, 0.8, 16, 19.4),
    ...[-21, 21].flatMap((x) => [-13, 13].map((z) => box(x, z, 3.15, 3.15, 0, 6.1))),
  ],
  observatory: [
    box(0, -2, 13.5, 12, 0, 19), box(0, -2, 20, 5.5, 0, 12.2),
    // Portico and towers; the parcel approach at (0, 19) is in the square beyond them.
    box(0, 12.8, 13.5, 2.5, 0, 15.2),
    ...[-18, 18].flatMap((x) => [box(x, 10, 3.65, 3.9, 0, 17), col(x, 10, 3.1, 17, 27.7)]),
    col(0, -3, 10.1, 14.5, 34.3), col(0, -3, 2.7, 33.6, 42.1),
  ],
  port: LONDON_PORT_SOLIDS.map((solid): LandmarkSolid => {
    // The legacy hill-town crossing uses a quarter-turn and a two-unit raised deck.
    if ("col" in solid) {
      const [x, z, radius, bottom, top] = solid.col;
      return col(z, -x, radius, bottom, top);
    }
    const [x, z, halfX, halfZ, bottom, top] = solid.box;
    return box(z, -x, halfZ, halfX, bottom + TOWER_BRIDGE.modelLift, top + TOWER_BRIDGE.modelLift);
  }),
  workshops: [
    box(0, 0, 21, 12, 0, 14.8), box(0, 0, 22, 13, 13.6, 14.8), box(0, 0, 13.5, 10.5, 14, 21.6),
    ...[-18, 18].flatMap((x) => [-9, 9].flatMap((z) => [box(x, z, 3, 3, 0, 22), col(x, z, 2, 22, 45.2)])),
  ],
  escapement: [
    box(0, -7, 23.5, 7, 0, 20.3),
    ...[-22, 22].map((x) => box(x, -7, 3.5, 4, 0, 30)),
    ...Array.from({ length: 13 }, (_, i) => box(-21 + i * 3.5, 0.3, 0.3, 0.5, 0, 18)),
  ],
  farm: [
    box(0, 0, 12.5, 9, 0, 14.8), box(-18, 0, 5, 6.5, 0, 11.3), box(18, 0, 5, 6.5, 0, 11.3),
    box(0, 10.5, 3, 1.75, 0, 9.7),
    ...[-18, -10, 10, 18].map((x) => box(x, 17, 2.1, 2.1, 0, 4.25)),
  ],
  market: [
    ...[-14, 14].flatMap((x) => [
      ...[-7.5, 0, 7.5].map((z) => box(x, z, 3, 2.3, 0, 5.3)),
      ...[-7.4, 7.4].flatMap((dx) => [-12, -6, 0, 6, 12].map((z) => col(x + dx, z, 0.26, 0, 9.5))),
      box(x, 0, 8.5, 14.5, 9.3, 14),
    ]),
    ...[-13.5, 13.5].map((z) => box(0, z, 22.5, 1, 8.6, 10.35)),
  ],
  orchard: [
    col(0, 0, 6.2, 0, 6.7),
    ...[-19, 19].flatMap((x) => [-11, 11].map((z) => col(x, z, 0.6, 0, 9.5))),
    ...[-12, 12].flatMap((x) => [-17, 17].map((z) => box(x, z, 2.73, 2.73, 0, 5.4))),
    ...[-22, 22].flatMap((z) => [-13, 13].map((x) => box(x, z, 8, 0.1, 0, 3.1))),
  ],
};

/** Same frame as kit.frame(), without depending on Three.js in the collision systems. */
export function landmarkPoint(landmark: { x: number; z: number; bearing: number; rotation?: number }, x: number, z: number) {
  const angle = landmark.rotation ?? Math.PI - landmark.bearing;
  return {
    x: landmark.x + x * Math.cos(angle) + z * Math.sin(angle),
    z: landmark.z - x * Math.sin(angle) + z * Math.cos(angle),
  };
}

/** The explicit plan frame uses authored bridge coordinates; radial fixtures retain their historical transform. */
export function getLandmarkSolids(kind: DistrictKind, landmark: { rotation?: number; scale?: number }): readonly LandmarkSolid[] {
  const solids = kind === "port" && landmark.rotation !== undefined ? LONDON_PORT_SOLIDS : LONDON_LANDMARK_SOLIDS[kind];
  const size = landmark.scale ?? 1;
  if (size === 1) return solids;
  return solids.map((solid): LandmarkSolid => "col" in solid
    ? { col: solid.col.map((value) => value * size) as unknown as Extract<LandmarkSolid, { col: unknown }>['col'] }
    : { box: solid.box.map((value) => value * size) as unknown as Extract<LandmarkSolid, { box: unknown }>['box'] });
}
