import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { illustratedEnvironment } from "@clockwork/render";
import { CANAL, HOME_LAUNCH_SITE, ISLAND_RADIUS, STAIR_BEARINGS, STREET, SUMMIT, TERRACES, angularGap, bearingOf, createCityLayout, polarToXZ, type CityLayout } from "./layout";
import { CHIMNEY_POT_HEIGHT, frame, local, merge, type MaterialSource } from "./kit";
import type { WalkWorld } from "../courier/walkWorld";

/**
 * The town's ambient life, four draw calls in all, using the town palette's own materials:
 * - grass tufts on the lawns (instanced, swaying in the wind through the material's `sway` attribute);
 * - copper pennants flanking the stair heads on the summit plaza (fluttering the same way);
 * - three small flocks of birds circling the clock tower (instanced, flapping);
 * - smoke puffs from every chimney, one rising per tick of the town clock (instanced).
 */
export type BuiltAmbient = {
  group: THREE.Group;
  grass: THREE.InstancedMesh;
  pennants: THREE.Mesh;
  birds: THREE.InstancedMesh;
  puffs: THREE.InstancedMesh;
  /** Chimney tops, in world space (one entry per chimney; three puffs each). */
  chimneys: readonly THREE.Vector3[];
  /** `time` in seconds; `ticks` is the town tick value (city/clockwork tickValue). Reduced motion holds a still frame. */
  update(time: number, ticks: number, reduced: boolean): void;
};

const GRASS_TARGET = 1500;
const GRASS_ATTEMPTS = 24000;
export const PUFFS_PER_CHIMNEY = 3;
/** Each puff takes this many ticks to rise and fade; with three per chimney, a new one starts every tick. */
const PUFF_TICKS = 3;
const FLOCKS = [
  { count: 6, radius: 150, height: 150, speed: 0.09 },
  { count: 5, radius: 215, height: 178, speed: -0.07 },
  { count: 5, radius: 118, height: 128, speed: 0.11 },
] as const;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Adds sway weights: 0 at or below `from` along `axis`, rising to `scale` at `to`. Call after kit `merge`, which keeps
 * only position, normal and uv.
 */
function withSway(geometry: THREE.BufferGeometry, axis: "x" | "y", from: number, to: number, scale = 1): THREE.BufferGeometry {
  const position = geometry.getAttribute("position");
  const weights = new Float32Array(position.count);
  for (let i = 0; i < position.count; i += 1) {
    const value = axis === "x" ? position.getX(i) : position.getY(i);
    weights[i] = Math.min(1, Math.max(0, (value - from) / (to - from))) * scale;
  }
  geometry.setAttribute("sway", new THREE.BufferAttribute(weights, 1));
  return geometry;
}

/** Three crossed blades, 1.4 tall, each with a back face (the palette's materials are single-sided): tips sway, roots stay put. */
function tuftGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  for (let blade = 0; blade < 3; blade += 1) {
    for (const turn of [0, Math.PI]) {
      blades.push(new THREE.PlaneGeometry(0.55, 1.4, 1, 2).translate(0, 0.7, 0).rotateY((blade / 3) * Math.PI + turn));
    }
  }
  return withSway(merge(blades), "y", 0, 1.4, 0.55);
}

function isLawn(x: number, z: number, layout: CityLayout, world: WalkWorld): boolean {
  const r = Math.hypot(x, z);
  if (r < SUMMIT.radius + 2 || r > ISLAND_RADIUS - 8) return false;
  if (r > CANAL.inner - 4 && r < CANAL.outer + 30) return false; // the canal and its promenade
  for (const terrace of TERRACES) {
    if (r > terrace.radius - STREET.inset - 1.5 && r < terrace.radius - STREET.inset + STREET.width + 1.5) return false; // ring streets
    if (Math.abs(r - terrace.radius) < 3) return false; // terrace edges and walls
  }
  const bearing = bearingOf(x, z);
  if (STAIR_BEARINGS.some((stair) => angularGap(bearing, stair) * r < 8)) return false; // stairways and bridges
  if (angularGap(bearing, HOME_LAUNCH_SITE.bearing) * r < HOME_LAUNCH_SITE.clear && Math.abs(r - HOME_LAUNCH_SITE.radius) < HOME_LAUNCH_SITE.clear) return false;
  if (layout.landmarks.some((landmark) => Math.hypot(x - landmark.x, z - landmark.z) < landmark.clearRadius * 0.85)) return false;
  return world.surfaceAt(x, z).walkable && !world.blocked(x, z, 1.4);
}

function buildGrass(palette: MaterialSource, layout: CityLayout, world: WalkWorld, random: () => number): THREE.InstancedMesh {
  const matrices: THREE.Matrix4[] = [];
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const inner = (SUMMIT.radius + 2) ** 2;
  const outer = (ISLAND_RADIUS - 8) ** 2;
  for (let attempt = 0; attempt < GRASS_ATTEMPTS && matrices.length < GRASS_TARGET; attempt += 1) {
    // Even over area: radius from the square root of a uniform pick.
    const r = Math.sqrt(inner + random() * (outer - inner));
    const { x, z } = polarToXZ(random() * Math.PI * 2, r);
    if (!isLawn(x, z, layout, world)) continue;
    position.set(x, world.surfaceAt(x, z).height, z);
    rotation.setFromAxisAngle(up, random() * Math.PI * 2);
    const size = 0.7 + random() * 0.7;
    scale.set(size, size * (0.8 + random() * 0.5), size);
    matrices.push(new THREE.Matrix4().compose(position, rotation, scale));
  }
  const grass = new THREE.InstancedMesh(tuftGeometry(), palette.get("leaf1"), matrices.length);
  matrices.forEach((matrix, index) => grass.setMatrixAt(index, matrix));
  grass.name = "Grass tufts";
  grass.receiveShadow = true;
  grass.computeBoundingSphere();
  return grass;
}

/** A pole with a pennant on it: a thin extruded triangle that sways more toward its free end. */
function pennantGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.12, 0.16, 8, 6).translate(0, 4, 0);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(4.4, -1.1);
  shape.lineTo(0, -2.2);
  shape.closePath();
  const flag = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false }).translate(0.15, 7.9, -0.04);
  // The pole (x within ±0.16) stays still; the flag sways by how far out along it a vertex is.
  return withSway(merge([pole, flag]), "x", 0.2, 4.55, 0.9);
}

function buildPennants(palette: MaterialSource): THREE.Mesh {
  const base = pennantGeometry();
  const parts: THREE.BufferGeometry[] = [];
  for (const stair of STAIR_BEARINGS) {
    for (const side of [-1, 1]) {
      const bearing = stair + side * 0.075;
      parts.push(base.clone().applyMatrix4(local(frame(bearing, SUMMIT.radius - 3, SUMMIT.top), 0, 0, 0, Math.PI / 2)));
    }
  }
  base.dispose();
  // mergeGeometries (not kit merge) so the sway weights survive.
  const merged = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  if (!merged) throw new Error("Could not merge the pennants");
  const mesh = new THREE.Mesh(merged, palette.get("copper"));
  mesh.name = "Summit pennants";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A small V: wings up at the tips. Squashing y flattens the V and letting go lifts it again, which is the flap. */
function birdGeometry(): THREE.BufferGeometry {
  const wing = (side: -1 | 1) => new THREE.BoxGeometry(2.2, 0.12, 0.7).translate(side * 1.1, 0, 0).rotateZ(side * 0.35);
  return merge([wing(-1), wing(1), new THREE.BoxGeometry(0.45, 0.3, 1.2)]);
}

type Bird = { flock: number; angle: number; radius: number; height: number; phase: number };

function chimneyTops(layout: CityLayout): THREE.Vector3[] {
  return layout.houses.filter((house) => house.chimney).map((house) => {
    const roofHeight = Math.min(7, Math.max(4.5, house.depth * 0.55));
    // Matches addHouse: the stack (roofHeight + 1.5 tall, centred at height + roofHeight / 2 + 0.6) plus its pots.
    const top = local(frame(house.theta, house.r, house.y), house.width / 4, house.height + roofHeight + 1.35 + CHIMNEY_POT_HEIGHT, -house.depth / 5);
    return new THREE.Vector3().setFromMatrixPosition(top);
  });
}

export function buildAmbient(palette: MaterialSource, world: WalkWorld, layout: CityLayout = createCityLayout(), seed = 0xa1b1e): BuiltAmbient {
  const random = seeded(seed);
  const group = new THREE.Group();
  group.name = "Ambient life";

  const grass = buildGrass(palette, layout, world, random);
  const pennants = buildPennants(palette);

  const birdList: Bird[] = FLOCKS.flatMap((flock, index) => Array.from({ length: flock.count }, () => ({
    flock: index,
    angle: random() * 0.5,
    radius: flock.radius + (random() - 0.5) * 22,
    height: flock.height + (random() - 0.5) * 14,
    phase: random() * Math.PI * 2,
  })));
  const birds = new THREE.InstancedMesh(birdGeometry(), palette.get("ink"), birdList.length);
  birds.name = "Birds";
  birds.frustumCulled = false;

  const chimneys = chimneyTops(layout);
  const puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), palette.get("smoke"), Math.max(1, chimneys.length * PUFFS_PER_CHIMNEY));
  puffs.name = "Chimney puffs";
  puffs.frustumCulled = false;

  group.add(grass, pennants, birds, puffs);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const wind = illustratedEnvironment.uWind.value;

  function update(time: number, ticks: number, reduced: boolean): void {
    const t = reduced ? 0 : time;
    birdList.forEach((bird, index) => {
      const flock = FLOCKS[bird.flock]!;
      const angle = bird.angle + t * flock.speed + bird.flock * 2.1;
      position.set(Math.sin(angle) * bird.radius, bird.height + Math.sin(t * 0.6 + bird.phase) * 3, -Math.cos(angle) * bird.radius);
      // Face along the circle (the bird's nose is -Z), banked a little into the turn.
      const heading = angle + (flock.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
      rotation.setFromEuler(euler.set(0, -heading, Math.sign(flock.speed) * 0.25, "YXZ"));
      // Never below zero: a mirrored instance would be drawn inside out (three flips winding per object, not per instance).
      const flap = reduced ? 1 : 0.15 + 0.85 * (0.5 + 0.5 * Math.cos(t * 7 + bird.phase));
      scale.set(1.3, 1.3 * flap, 1.3);
      birds.setMatrixAt(index, matrix.compose(position, rotation, scale));
    });
    birds.instanceMatrix.needsUpdate = true;

    chimneys.forEach((top, chimney) => {
      for (let k = 0; k < PUFFS_PER_CHIMNEY; k += 1) {
        // Reduced motion: one still puff over each chimney.
        const age = reduced ? (k === 0 ? 0.45 : 0) : (((ticks + k + chimney * 0.37) / PUFF_TICKS) % 1 + 1) % 1;
        // Small and soft: the puff swells as it rises and drifts downwind, then shrinks away.
        const size = age <= 0 ? 0 : Math.sin(Math.PI * age) * (0.45 + 0.6 * age) * 0.85;
        position.set(top.x + wind.x * age * 6, top.y + 0.4 + age * 9, top.z + wind.z * age * 6);
        rotation.identity();
        scale.setScalar(Math.max(1e-4, size));
        puffs.setMatrixAt(chimney * PUFFS_PER_CHIMNEY + k, matrix.compose(position, rotation, scale));
      }
    });
    puffs.instanceMatrix.needsUpdate = true;
  }

  update(0, 0, false);
  return { group, grass, pennants, birds, puffs, chimneys, update };
}
