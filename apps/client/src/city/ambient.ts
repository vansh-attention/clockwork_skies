import * as THREE from "three";
import { frontageApron, onFrontage, type FrontageApron } from "./londonDetails";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createChimneySmoke, type ChimneySmoke } from "./chimneySmoke";
import { CANAL, HOME_LAUNCH_SITE, ISLAND_RADIUS, STAIR_BEARINGS, STREET, SUMMIT, TERRACES, angularGap, bearingOf, createCityLayout, polarToXZ, type CityLayout } from "./layout";
import { CHIMNEY_POT_HEIGHT, at, frame, houseFrame, local, merge, type MaterialSource } from "./kit";
import { nearestOnPolyline } from "./londonPlan";
import type { WalkWorld } from "../courier/walkWorld";

/**
 * The town's ambient life, four draw calls in all, using the town palette's own materials:
 * - grass tufts on the lawns (instanced, swaying in the wind through the material's `sway` attribute);
 * - copper pennants flanking the stair heads on the summit plaza (fluttering the same way);
 * - three small flocks of birds circling the clock tower (instanced, flapping);
 * - a smoke plume from every chimney, flowing as the reference's smoke does (city/chimneySmoke.ts; its own material).
 */
export type BuiltAmbient = {
  group: THREE.Group;
  grass: THREE.InstancedMesh;
  pennants: THREE.Mesh;
  birds: THREE.InstancedMesh;
  smoke: ChimneySmoke;
  /** Chimney tops, in world space (one entry per chimney, one plume each). */
  chimneys: readonly THREE.Vector3[];
  /** `time` in seconds. Reduced motion holds a still frame. */
  update(time: number, reduced: boolean): void;
};

const GRASS_TARGET = 1500;
const GRASS_ATTEMPTS = 24000;
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
      const leaf = new THREE.Shape();
      leaf.moveTo(-0.14, 0); leaf.lineTo(0.05, 0.62); leaf.lineTo(0.12, 1.05); leaf.lineTo(-0.06, 0.55); leaf.closePath();
      blades.push(new THREE.ShapeGeometry(leaf).rotateY((blade / 3) * Math.PI + turn));
    }
  }
  return withSway(merge(blades), "y", 0, 1.4, 0.55);
}

function isLawn(x: number, z: number, layout: CityLayout, world: WalkWorld, frontages: readonly FrontageApron[]): boolean {
  const r = Math.hypot(x, z);
  if (layout.plan) {
    if (r > layout.plan.radius - 8) return false;
    if (frontages.some((apron) => onFrontage(x, z, apron, 0.3))) return false;
    const plan = layout.plan;
    if (nearestOnPolyline({ x, z }, plan.river.points).distance < plan.river.halfWidth + 4) return false;
    if (plan.streets.some((street) => nearestOnPolyline({ x, z }, street.points).distance < street.width / 2 + street.pavement + 1.5)) return false;
    if (plan.squares.some((square) => {
      const dx = x - square.x, dz = z - square.z;
      const lx = dx * Math.cos(square.rotation) - dz * Math.sin(square.rotation);
      const lz = dx * Math.sin(square.rotation) + dz * Math.cos(square.rotation);
      return Math.abs(lx) < square.width / 2 + 1.5 && Math.abs(lz) < square.depth / 2 + 1.5;
    })) return false;
    if (layout.landmarks.some((landmark) => Math.hypot(x - landmark.x, z - landmark.z) < landmark.clearRadius * 0.85)) return false;
    return world.surfaceAt(x, z).walkable && !world.blocked(x, z, 1.4);
  }
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
  const frontages = layout.plan ? layout.plan.houses.map((house) => frontageApron(house, layout.plan!)).filter((apron): apron is FrontageApron => apron !== null) : [];
  const matrices: THREE.Matrix4[] = [];
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const inner = layout.plan ? 0 : (SUMMIT.radius + 2) ** 2;
  const outer = ((layout.plan?.radius ?? ISLAND_RADIUS) - 8) ** 2;
  const target = layout.plan ? 600 : GRASS_TARGET;
  for (let attempt = 0; attempt < GRASS_ATTEMPTS && matrices.length < target; attempt += 1) {
    // Even over area: radius from the square root of a uniform pick.
    const r = Math.sqrt(inner + random() * (outer - inner));
    const { x, z } = polarToXZ(random() * Math.PI * 2, r);
    if (!isLawn(x, z, layout, world, frontages)) continue;
    position.set(x, world.surfaceAt(x, z).height, z);
    rotation.setFromAxisAngle(up, random() * Math.PI * 2);
    const size = 0.7 + random() * 0.7;
    scale.set(size, size * (0.8 + random() * 0.5), size);
    matrices.push(new THREE.Matrix4().compose(position, rotation, scale));
  }
  const grass = new THREE.InstancedMesh(tuftGeometry(), palette.get("tuft"), matrices.length);
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

function buildPennants(palette: MaterialSource, layout: CityLayout, world: WalkWorld): THREE.Mesh {
  const base = pennantGeometry();
  const parts: THREE.BufferGeometry[] = [];
  if (layout.plan) {
    for (const square of layout.plan.squares) for (const side of [-1, 1]) {
      // A pair flanks the square's outer corners, on the actual ground rather than the removed summit.
      for (const inset of [2, 5, 8]) {
        const placement = local(at(square.x, 0, square.z, square.rotation), side * (square.width / 2 - inset), 0, square.depth / 2 - 2, Math.PI / 2);
        const point = new THREE.Vector3().setFromMatrixPosition(placement);
        const surface = world.surfaceAt(point.x, point.z);
        if (!surface.walkable || world.blocked(point.x, point.z, 0.5)) continue;
        placement.setPosition(point.x, surface.height, point.z);
        parts.push(base.clone().applyMatrix4(placement));
        break;
      }
    }
  } else for (const stair of STAIR_BEARINGS) {
    for (const side of [-1, 1]) {
      const bearing = stair + side * 0.075;
      parts.push(base.clone().applyMatrix4(local(frame(bearing, SUMMIT.radius - 3, SUMMIT.top), 0, 0, 0, Math.PI / 2)));
    }
  }
  base.dispose();
  // mergeGeometries (not kit merge) so the sway weights survive.
  const merged = parts.length ? mergeGeometries(parts, false) : base.clone().scale(0, 0, 0);
  parts.forEach((part) => part.dispose());
  if (!merged) throw new Error("Could not merge the pennants");
  const mesh = new THREE.Mesh(merged, palette.get("copper"));
  mesh.name = layout.plan ? "London square pennants" : "Summit pennants";
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
    const top = local(houseFrame(house), house.width / 4, house.height + roofHeight + 1.35 + CHIMNEY_POT_HEIGHT, -house.depth / 5);
    return new THREE.Vector3().setFromMatrixPosition(top);
  });
}

export function buildAmbient(palette: MaterialSource, world: WalkWorld, layout: CityLayout = createCityLayout(), seed = 0xa1b1e): BuiltAmbient {
  const random = seeded(seed);
  const group = new THREE.Group();
  group.name = "Ambient life";

  const grass = buildGrass(palette, layout, world, random);
  const pennants = buildPennants(palette, layout, world);

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
  const smoke = createChimneySmoke(chimneys);

  group.add(grass, pennants, birds, smoke.mesh);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();

  function update(time: number, reduced: boolean): void {
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
    smoke.update(time, reduced);
  }

  update(0, false);
  return { group, grass, pennants, birds, smoke, chimneys, update };
}
