export type Vec3 = { x: number; y: number; z: number };

export const V = {
  create: (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z }),
  clone: (a: Vec3): Vec3 => ({ ...a }),
  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
  lengthSq: (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z,
  length: (a: Vec3): number => Math.sqrt(V.lengthSq(a)),
  normalize: (a: Vec3, fallback: Vec3 = { x: 0, y: 1, z: 0 }): Vec3 => {
    const length = V.length(a);
    return length > 1e-8 ? V.scale(a, 1 / length) : V.clone(fallback);
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  }),
  projectOnPlane: (a: Vec3, normal: Vec3): Vec3 => V.sub(a, V.scale(normal, V.dot(a, normal))),
  distance: (a: Vec3, b: Vec3): number => V.length(V.sub(a, b)),
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const damp = (current: number, target: number, sharpness: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-sharpness * dt));

export function rotateAroundAxis(vector: Vec3, axisValue: Vec3, angle: number): Vec3 {
  const axis = V.normalize(axisValue);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return V.add(
    V.add(V.scale(vector, cosine), V.scale(V.cross(axis, vector), sine)),
    V.scale(axis, V.dot(axis, vector) * (1 - cosine)),
  );
}

export function angularDistance(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(V.dot(V.normalize(a), V.normalize(b)), -1, 1));
}

export function tangentBasis(position: Vec3, forwardValue: Vec3) {
  const up = V.normalize(position);
  let forward = V.normalize(V.projectOnPlane(forwardValue, up), { x: 0, y: 0, z: -1 });
  if (Math.abs(V.dot(forward, up)) > 0.99) forward = V.normalize(V.cross({ x: 1, y: 0, z: 0 }, up));
  const right = V.normalize(V.cross(forward, up), { x: 1, y: 0, z: 0 });
  return { up, forward, right };
}

export class SeededRandom {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0 || 0x9e3779b9; }
  next() {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number) { return min + (max - min) * this.next(); }
  int(min: number, maxInclusive: number) { return Math.floor(this.range(min, maxInclusive + 1)); }
}
