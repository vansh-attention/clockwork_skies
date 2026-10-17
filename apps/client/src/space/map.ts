import { SeededRandom } from "@clockwork/shared";
import type { Obstacle, XYZ } from "./types";
export const EXTENT: XYZ = [900, 320, 1200];
export const SPAWN: XYZ = [0, 0, 650];
export const GATES: readonly XYZ[] = [
  [0, 0, 460], [130, 40, 290], [-130, 0, 120], [-180, -40, -100], [0, 20, -290],
];
export const TARGETS: readonly XYZ[] = [[-65, 20, -420], [0, -15, -520], [75, 30, -440]];
export const DRONE_SPAWNS: readonly XYZ[] = [
  [40, 15, 370], [-130, -30, 330], [150, 50, 300],
  [-240, 40, 180], [240, -40, 140], [20, 100, 90],
];
export const STATIONS: readonly Obstacle[] = [
  { id: "relay-base", kind: "box", center: [0, -95, 0], half: [70, 18, 70] },
  { id: "relay-spine", kind: "box", center: [0, -45, 0], half: [12, 30, 12] },
  { id: "dock", kind: "box", center: [-310, 0, -80], half: [70, 22, 35] },
  { id: "dock-arm", kind: "box", center: [-365, 45, -80], half: [10, 30, 35] },
  { id: "truss-low", kind: "box", center: [260, 20, 80], half: [75, 8, 12] },
  { id: "truss-high", kind: "box", center: [320, 60, 80], half: [10, 40, 12] },
];
export const PICKUPS = [
  { kind: "repair" as const, at: [110, 40, 240] as XYZ },
  { kind: "energy" as const, at: [-140, 10, 110] as XYZ },
  { kind: "ammo" as const, at: [-200, -10, -90] as XYZ },
  { kind: "repair" as const, at: [10, 20, -270] as XYZ },
];
function segmentDistanceSq(p: XYZ, a: XYZ, b: XYZ): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const length = dx * dx + dy * dy + dz * dz;
  const t = length ? Math.max(0, Math.min(1,
    ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / length)) : 0;
  return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2 + (p[2] - a[2] - t * dz) ** 2;
}
export function makeRocks(seed = 42): Obstacle[] {
  const rng = new SeededRandom(seed), rocks: Obstacle[] = [];
  const clusters: readonly XYZ[] = [[-420, 110, 320], [410, -90, 80], [-350, -110, -500], [180, 100, -650]];
  const route = [SPAWN, ...GATES, ...TARGETS];
  for (let attempt = 0; attempt < 4096 && rocks.length < 72; attempt++) {
    const centre = clusters[rocks.length % clusters.length]!;
    const p: XYZ = [rng.range(centre[0] - 160, centre[0] + 160),
      rng.range(centre[1] - 70, centre[1] + 70), rng.range(centre[2] - 160, centre[2] + 160)];
    const radius = rng.range(8, 22);
    if (route.some((a, i) => i && segmentDistanceSq(p, route[i - 1]!, a) < (radius + 60) ** 2)) continue;
    if ([SPAWN, ...DRONE_SPAWNS, ...TARGETS, ...PICKUPS.map(x => x.at)].some(a => segmentDistanceSq(p, a, a) < (radius + 45) ** 2)) continue;
    if (STATIONS.some(o => o.kind === "box" &&
      Math.abs(p[0] - o.center[0]) < o.half[0] + radius + 15 &&
      Math.abs(p[1] - o.center[1]) < o.half[1] + radius + 15 &&
      Math.abs(p[2] - o.center[2]) < o.half[2] + radius + 15)) continue;
    if (rocks.some(o => o.kind === "sphere" && segmentDistanceSq(p, o.center, o.center) < (radius + o.radius + 5) ** 2)) continue;
    rocks.push({ id: `rock-${rocks.length}`, kind: "sphere", center: p, radius });
  }
  if (rocks.length !== 72) throw new Error("Unable to place 72 safe asteroid proxies");
  return rocks;
}
export const ROCKS = makeRocks();
export const OBSTACLES: readonly Obstacle[] = [...STATIONS, ...ROCKS];
