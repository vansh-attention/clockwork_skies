import { Vector3 } from "three";
import { RULES, type Obstacle, type Ship } from "./types";
export type Hit = { t: number; normal: Vector3; id: string; kind: "solid" | "ship" };
export function sphereTime(a: Vector3, d: Vector3, x: number, y: number, z: number, r: number): number | null {
  const px = a.x - x, py = a.y - y, pz = a.z - z;
  const cc = px * px + py * py + pz * pz - r * r;
  if (cc <= 0) return 0;
  const aa = d.lengthSq(); if (aa < 1e-12) return null;
  const bb = 2 * (px * d.x + py * d.y + pz * d.z);
  const disc = bb * bb - 4 * aa * cc;
  if (disc < 0) return null;
  const t = (-bb - Math.sqrt(disc)) / (2 * aa);
  return t >= 0 && t <= 1 ? t : null;
}
export function obstacleHit(a: Vector3, d: Vector3, radius: number, o: Obstacle): Hit | null {
  if (o.kind === "sphere") {
    const t = sphereTime(a, d, ...o.center, o.radius + radius);
    if (t === null) return null;
    const normal = new Vector3(a.x + d.x * t - o.center[0], a.y + d.y * t - o.center[1], a.z + d.z * t - o.center[2]);
    if (normal.lengthSq() < 1e-10) normal.set(0, 1, 0);
    return { t, normal: normal.normalize(), id: o.id, kind: "solid" };
  }
  let enter = 0, exit = 1, axis = 0, sign = 1;
  const start = [a.x, a.y, a.z], direction = [d.x, d.y, d.z];
  let inside = true, nearestFace = Infinity;
  for (let i = 0; i < 3; i++) {
    const lo = o.center[i]! - o.half[i]! - radius;
    const hi = o.center[i]! + o.half[i]! + radius;
    const s = start[i]!, v = direction[i]!;
    if (s < lo || s > hi) inside = false;
    const face = Math.min(Math.abs(s - lo), Math.abs(hi - s));
    if (face < nearestFace) { nearestFace = face; if (inside) { axis = i; sign = s < o.center[i]! ? -1 : 1; } }
    if (Math.abs(v) < 1e-12) { if (s < lo || s > hi) return null; continue; }
    let near = (lo - s) / v, far = (hi - s) / v;
    const nearSign = v > 0 ? -1 : 1;
    if (near > far) [near, far] = [far, near];
    if (near > enter) { enter = near; axis = i; sign = nearSign; }
    exit = Math.min(exit, far); if (enter > exit) return null;
  }
  if (exit < 0 || enter > 1) return null;
  const normal = new Vector3(); normal.setComponent(axis, sign);
  return { t: inside ? 0 : enter, normal, id: o.id, kind: "solid" };
}
export function firstHit(a: Vector3, d: Vector3, radius: number,
  obstacles: readonly Obstacle[], ships: readonly Ship[] = [], ignore = ""): Hit | null {
  let hit: Hit | null = null;
  for (const o of obstacles) {
    const candidate = obstacleHit(a, d, radius, o);
    if (candidate && (!hit || candidate.t < hit.t)) hit = candidate;
  }
  for (const s of ships) {
    if (s.id === ignore || s.hull <= 0) continue;
    const t = sphereTime(a, d, s.p.x, s.p.y, s.p.z, radius + RULES.radius);
    if (t === null || hit && t >= hit.t) continue;
    const normal = new Vector3(a.x + d.x * t - s.p.x, a.y + d.y * t - s.p.y, a.z + d.z * t - s.p.z).normalize();
    hit = { t, normal, id: s.id, kind: "ship" };
  }
  return hit;
}
