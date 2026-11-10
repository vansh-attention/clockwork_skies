import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createIllustratedMaterial } from "@clockwork/render";
import { createHillTownWalkWorld, type WalkWorld } from "../courier/walkWorld";
import { createCityLayout, type CityLayout } from "./layout";
import { landmarkPoint } from "./londonSolids";
import { nearestOnPolyline } from "./londonPlan";
import { createResidentAgents, type ResidentRoute } from "./residents";
import type { MaterialSource } from "./kit";

export type AnimalAgent = Readonly<{
  id: string; name: string; species: "cat" | "dog"; breed: "ginger" | "tuxedo" | "corgi" | "spaniel";
  district: number; x: number; y: number; z: number; position: Readonly<{ x: number; y: number; z: number }>; heading: number; scale: number; phase: number;
}>;
export type BuiltAnimals = {
  group: THREE.Group;
  agents: readonly AnimalAgent[];
  update(time: number, reduced: boolean, viewpoint?: THREE.Vector3): void;
  /** Physical body only (not the ears or tail): the courier walks around a nearby pet. */
  blocks(x: number, z: number, radius: number): boolean;
  /** Only releases skeleton/bone textures. The owning scene disposes mesh geometry/material during world traversal. */
  dispose(): void;
};
/** Includes the nose, tail sweep and a margin around every pet's ground projection. */
export const ANIMAL_CLEARANCE = 1.55;
export const ANIMAL_VIEW_DISTANCE = 160;
const BONE_NAMES = ["root", "body", "head", "earL", "earR", "tail0", "tail1", "tail2", "eyes"] as const;
type BoneName = typeof BONE_NAMES[number];
type AnimalRig = { group: THREE.Group; mesh: THREE.SkinnedMesh; bones: Record<BoneName, THREE.Bone>; bodyY: number };
const INK = "#302f3a", CREAM = "#f3e7cf", PINK = "#cc8d87";

function routeNear(x: number, z: number, route: ResidentRoute): boolean {
  if (route.kind === "path") return nearestOnPolyline({ x, z }, route.points).distance < 2.4;
  const count = Math.max(1, Math.ceil(route.halfArc * 2));
  for (let i = 0; i <= count; i += 1) {
    const angle = route.bearing + (i / count * 2 - 1) * route.halfArc / Math.max(1, route.radius);
    if (Math.hypot(x - Math.sin(angle) * route.radius, z + Math.cos(angle) * route.radius) < 2.4) return true;
  }
  return false;
}
function safeSpot(x: number, z: number, world: WalkWorld): boolean {
  const centre = world.surfaceAt(x, z);
  if (!centre.walkable || world.blocked(x, z, ANIMAL_CLEARANCE)) return false;
  for (let i = 0; i < 12; i += 1) {
    const angle = i / 12 * Math.PI * 2;
    const edge = world.surfaceAt(x + Math.cos(angle) * ANIMAL_CLEARANCE, z + Math.sin(angle) * ANIMAL_CLEARANCE);
    if (!edge.walkable || Math.abs(edge.height - centre.height) > 0.08) return false;
  }
  return true;
}
/** Four deterministic, collision-validated neighbourhood perches; no pets are added to legacy island fixtures. */
export function createAnimalAgents(layout: CityLayout = createCityLayout()): readonly AnimalAgent[] {
  if (!layout.plan) return [];
  const world = createHillTownWalkWorld(layout);
  const residents = createResidentAgents(layout);
  const agents: AnimalAgent[] = [];
  const specs = [
    { name: "Marmalade", species: "cat", breed: "ginger", district: 6, scale: 0.82 },
    { name: "Socks", species: "cat", breed: "tuxedo", district: 7, scale: 0.86 },
    { name: "Pippin", species: "dog", breed: "corgi", district: 0, scale: 0.83 },
    { name: "Mabel", species: "dog", breed: "spaniel", district: 5, scale: 0.9 },
  ] as const;
  for (const [index, spec] of specs.entries()) {
    const landmark = layout.landmarks.find((item) => item.district === spec.district);
    if (!landmark) continue;
    const candidates: { x: number; z: number }[] = [];
    for (const distance of [10, 14, 18, 22, 26, 30]) {
      for (const side of [-1, 1]) for (const x of [5, 9, 13, 17]) candidates.push(landmarkPoint(landmark, side * x, distance));
    }
    for (let radius = 7; radius <= 34; radius += 3) for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12)
      candidates.push({ x: landmark.x + Math.cos(angle) * radius, z: landmark.z + Math.sin(angle) * radius });
    const point = candidates.find(({ x, z }) => safeSpot(x, z, world)
      && residents.every((person) => !routeNear(x, z, person.route))
      && agents.every((animal) => Math.hypot(x - animal.position.x, z - animal.position.z) > ANIMAL_CLEARANCE * 2 + 1)
      && layout.plan!.streets.every((street) => nearestOnPolyline({ x, z }, street.points).distance > street.width / 2 + ANIMAL_CLEARANCE));
    if (!point) continue;
    agents.push({ ...spec, ...point, y: world.surfaceAt(point.x, point.z).height, id: `animal-${spec.breed}`, position: { ...point, y: world.surfaceAt(point.x, point.z).height },
      heading: Math.atan2(landmark.x - point.x, -(landmark.z - point.z)) + (index % 2 ? -0.6 : 0.6), phase: index * 1.73 });
  }
  return agents;
}

/** Smooth, low-ring authored silhouettes instead of a stack of disconnected primitive balls. */
function loft(rings: readonly (readonly [y: number, radiusX: number, radiusZ: number, z: number])[]): THREE.BufferGeometry {
  const segments = 16, positions: number[] = [], uv: number[] = [], indices: number[] = [];
  rings.forEach(([y, rx, rz, z], row) => {
    for (let i = 0; i <= segments; i += 1) {
      const angle = i / segments * Math.PI * 2;
      positions.push(Math.sin(angle) * rx, y, z + Math.cos(angle) * rz); uv.push(i / segments, row / (rings.length - 1));
      if (row && i) { const a = (row - 1) * (segments + 1) + i - 1, b = row * (segments + 1) + i - 1; indices.push(a, a + 1, b, b, a + 1, b + 1); }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
function ear(width: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0); shape.quadraticCurveTo(-width * 0.4, height * 0.6, 0, height);
  shape.quadraticCurveTo(width * 0.35, height * 0.65, width / 2, 0); shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 1, curveSegments: 4 }).translate(0, 0, -0.04);
}
/** Flat drawn eye shapes share a normal, so the outline pass does not turn nested eye layers into goggle rims. */
function eyePatch(width: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.quadraticCurveTo(-width * 0.24, height * 0.62, width * 0.08, height * 0.48);
  shape.quadraticCurveTo(width * 0.35, height * 0.44, width / 2, 0);
  shape.quadraticCurveTo(width * 0.22, -height * 0.5, -width * 0.08, -height * 0.44);
  shape.quadraticCurveTo(-width * 0.35, -height * 0.4, -width / 2, 0);
  return new THREE.ShapeGeometry(shape, 10).rotateY(Math.PI);
}
function eyeDisc(rx: number, ry: number): THREE.BufferGeometry {
  return new THREE.CircleGeometry(1, 20).scale(rx, ry, 1).rotateY(Math.PI);
}

function animalModel(agent: AnimalAgent, material: THREE.ShaderMaterial): AnimalRig {
  const cat = agent.species === "cat", floppy = agent.breed === "spaniel";
  const fur = agent.breed === "ginger" ? "#ca8e53" : agent.breed === "tuxedo" ? "#4b5260" : agent.breed === "corgi" ? "#bd8752" : "#967052";
  const darkFur = agent.breed === "ginger" ? "#9a623b" : agent.breed === "tuxedo" ? "#343c4a" : agent.breed === "corgi" ? "#99633e" : "#614939";
  const bodyY = cat ? 0.5 : 0.64, headY = cat ? 0.88 : 1.07, headZ = cat ? -0.36 : -0.55;
  const eyeY = cat ? 1.08 : 1.35, faceZ = cat ? -0.665 : -0.89;
  const rest: Record<BoneName, THREE.Vector3> = {
    root: new THREE.Vector3(), body: new THREE.Vector3(0, bodyY, 0), head: new THREE.Vector3(0, headY, headZ),
    earL: new THREE.Vector3(cat ? -0.19 : -0.25, cat ? 1.23 : 1.53, headZ),
    earR: new THREE.Vector3(cat ? 0.19 : 0.25, cat ? 1.23 : 1.53, headZ),
    tail0: new THREE.Vector3(0, bodyY + 0.1, cat ? 0.46 : 0.65),
    tail1: new THREE.Vector3(0, cat ? 0.99 : 0.86, cat ? 0.81 : 0.94),
    tail2: new THREE.Vector3(0.04, cat ? 1.28 : 1.08, cat ? 0.89 : 1.12),
    eyes: new THREE.Vector3(0, eyeY, faceZ),
  };
  const parents: Record<BoneName, BoneName | null> = { root: null, body: "root", head: "body", earL: "head", earR: "head", tail0: "body", tail1: "tail0", tail2: "tail1", eyes: "head" };
  const parts: THREE.BufferGeometry[] = [];
  const add = (geometry: THREE.BufferGeometry, color: string, bone: BoneName = "body", id = 0) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    const count = flat.getAttribute("position").count, c = new THREE.Color(color);
    const colors = new Float32Array(count * 3), skinIndex = new Uint16Array(count * 4), weights = new Float32Array(count * 4), ids = new Float32Array(count);
    for (let i = 0; i < count; i += 1) { colors.set([c.r, c.g, c.b], i * 3); skinIndex[i * 4] = BONE_NAMES.indexOf(bone); weights[i * 4] = 1; ids[i] = (id === 2 ? 0 : id) * 0.003; }
    flat.setAttribute("color", new THREE.BufferAttribute(colors, 3)); flat.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
    flat.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4)); flat.setAttribute("idShift", new THREE.BufferAttribute(ids, 1)); parts.push(flat);
  };
  const blob = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, bone: BoneName = "body", id = 0) =>
    add(new THREE.SphereGeometry(1, 12, 8).scale(sx, sy, sz).translate(x, y, z), color, bone, id);
  add(cat ? loft([[0.24, 0.08, 0.18, 0.07], [0.36, 0.25, 0.48, 0.04], [0.6, 0.3, 0.54, 0], [0.81, 0.22, 0.38, -0.06], [0.88, 0.03, 0.08, -0.1]])
    : loft([[0.31, 0.12, 0.25, 0.03], [0.45, 0.34, 0.65, 0.03], [0.75, 0.42, 0.73, 0], [0.98, 0.31, 0.57, -0.06], [1.04, 0.03, 0.1, -0.12]]), fur);
  // The pale bib is painted into the torso, rather than a separate oval intersecting it like a chest plate.
  {
    const body = parts[parts.length - 1]!, position = body.getAttribute("position"), colors = body.getAttribute("color");
    const cream = new THREE.Color(CREAM), base = new THREE.Color(fur), shaded = new THREE.Color();
    for (let i = 0; i < position.count; i += 1) {
      const front = THREE.MathUtils.smoothstep(-position.getZ(i), cat ? 0.25 : 0.36, cat ? 0.43 : 0.6);
      const belowChin = 1 - THREE.MathUtils.smoothstep(position.getY(i), cat ? 0.67 : 0.8, cat ? 0.84 : 1.01);
      shaded.copy(base).lerp(cream, front * belowChin);
      colors.setXYZ(i, shaded.r, shaded.g, shaded.b);
    }
  }
  // Four furry tapered limbs flow from a rounded shoulder into a broad planted paw. The pale toe is vertex colour,
  // so there is no cylindrical cut end or separate bright joint seam between fur and foot.
  for (const side of [-1, 1]) for (const back of [-1, 1]) {
    const x = side * (cat ? 0.18 : 0.26), z = back * (cat ? 0.31 : 0.46);
    const rings: readonly (readonly [number, number, number, number])[] = cat
      ? [[0, 0.045, 0.07, z - 0.035], [0.045, 0.105, 0.15, z - 0.035], [0.12, 0.125, 0.17, z - 0.02], [0.2, 0.09, 0.11, z], [0.36, 0.085, 0.095, z + 0.02], [0.52, 0.115, 0.125, z + 0.04], [0.61, 0.09, 0.1, z * 0.8], [0.69, 0.035, 0.045, z * 0.65], [0.72, 0.01, 0.015, z * 0.6]]
      : [[0, 0.06, 0.1, z - 0.05], [0.055, 0.14, 0.2, z - 0.05], [0.14, 0.165, 0.22, z - 0.03], [0.24, 0.12, 0.145, z], [0.44, 0.11, 0.13, z + 0.025], [0.65, 0.145, 0.16, z + 0.05], [0.8, 0.12, 0.13, z * 0.85], [0.88, 0.055, 0.065, z * 0.7], [0.93, 0.01, 0.015, z * 0.65]];
    add(loft(rings).translate(x, 0, 0), fur, "root");
    const limb = parts[parts.length - 1]!, position = limb.getAttribute("position"), colors = limb.getAttribute("color");
    const base = new THREE.Color(fur), cream = new THREE.Color(CREAM), shaded = new THREE.Color();
    for (let i = 0; i < position.count; i += 1) {
      const paleToe = 1 - THREE.MathUtils.smoothstep(position.getY(i), 0.11, 0.22);
      shaded.copy(base).lerp(cream, paleToe);
      colors.setXYZ(i, shaded.r, shaded.g, shaded.b);
    }
  }
  add(cat ? loft([[0.79, 0.04, 0.08, headZ], [0.88, 0.23, 0.2, headZ], [1.07, 0.29, 0.27, headZ], [1.24, 0.23, 0.22, headZ], [1.29, 0.03, 0.05, headZ]])
    : loft([[0.93, 0.05, 0.09, headZ], [1.07, 0.27, 0.24, headZ], [1.34, 0.37, 0.33, headZ], [1.55, 0.28, 0.27, headZ], [1.62, 0.04, 0.07, headZ]]), fur, "head");
  // Drawn, bright eyes: dark upper lids, warm irises, pupils and a small unlit highlight.
  for (const side of [-1, 1]) {
    const x = side * (cat ? 0.145 : 0.19), sx = cat ? 0.087 : 0.11, sy = cat ? 0.08 : 0.1;
    add(eyePatch(sx * 2, sy * 2).translate(x, eyeY, faceZ - 0.005), CREAM, "eyes", 2);
    add(eyeDisc(sx * 0.69, sy * 0.83).translate(x, eyeY - 0.005, faceZ - 0.007), agent.breed === "tuxedo" ? "#819c91" : "#97754c", "eyes", 2);
    add(eyeDisc(sx * (cat ? 0.28 : 0.4), sy * 0.72).translate(x, eyeY - 0.004, faceZ - 0.009), INK, "eyes", 2);
    add(eyeDisc(0.016, 0.021).translate(x - 0.017, eyeY + 0.025, faceZ - 0.011), "#fff6de", "eyes", 2);
    const lid = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x - sx, eyeY + 0.003, faceZ - 0.013),
      new THREE.Vector3(x, eyeY + sy * 1.12, faceZ - 0.014), new THREE.Vector3(x + sx, eyeY, faceZ - 0.013));
    add(new THREE.TubeGeometry(lid, 8, 0.0065, 4, false), "#57463d", "head", 2);
    // A few delicate drawn cheek strokes replace the raised oval blush pads.
    for (let mark = 0; mark < (cat ? 3 : 2); mark += 1) {
      const x = side * ((cat ? 0.18 : 0.24) + mark * 0.018);
      const stroke = new THREE.LineCurve3(new THREE.Vector3(x - 0.004, eyeY - 0.12, faceZ - 0.002),
        new THREE.Vector3(x + 0.004, eyeY - 0.145, faceZ - 0.002));
      add(new THREE.TubeGeometry(stroke, 1, 0.0027, 3, false), "#b98c7b", "head");
    }
    blob(side * 0.075, eyeY - 0.16, faceZ - 0.015, cat ? 0.105 : 0.14, 0.082, 0.08, CREAM, "head", 1);
    const pivot = rest[side < 0 ? "earL" : "earR"];
    if (floppy) {
      blob(pivot.x + side * 0.07, pivot.y - 0.19, pivot.z + 0.02, 0.17, 0.32, 0.11, darkFur, side < 0 ? "earL" : "earR");
      blob(pivot.x + side * 0.07, pivot.y - 0.17, pivot.z - 0.09, 0.075, 0.19, 0.016, PINK, side < 0 ? "earL" : "earR", 1);
    } else {
      const height = cat ? 0.28 : 0.39, width = cat ? 0.2 : 0.3;
      add(ear(width, height).translate(pivot.x, pivot.y, pivot.z), fur, side < 0 ? "earL" : "earR");
      add(ear(width * 0.57, height * 0.65).translate(pivot.x, pivot.y + 0.04, pivot.z - 0.073), PINK, side < 0 ? "earL" : "earR", 1);
    }
  }
  blob(0, eyeY - 0.11, faceZ - 0.107, cat ? 0.035 : 0.069, cat ? 0.024 : 0.048, 0.035, INK, "head", 3);
  for (const side of [-1, 1]) add(new THREE.TorusGeometry(cat ? 0.042 : 0.055, 0.008, 4, 10, Math.PI).rotateZ(Math.PI).translate(side * 0.037, eyeY - 0.19, faceZ - 0.085), INK, "head", 2);
  // A collar and small brass tag give each silhouette a little London colour.
  add(new THREE.TorusGeometry(cat ? 0.21 : 0.28, 0.036, 5, 16).rotateX(Math.PI / 2).translate(0, headY - 0.06, headZ), agent.breed === "tuxedo" || floppy ? "#6d9291" : "#b75d50", "body", 3);
  blob(0, headY - 0.1, headZ - (cat ? 0.23 : 0.3), 0.04, 0.05, 0.018, "#d3b46f", "body", 3);
  if (agent.breed === "ginger") for (const side of [-1, 0, 1]) blob(side * 0.09, 1.2, headZ - 0.2, 0.022, 0.075, 0.025, darkFur, "head");
  // A three-joint tapered tail; overlapping ends keep it continuous as it swishes.
  const tail = [rest.tail0, rest.tail1, rest.tail2, rest.tail2.clone().add(new THREE.Vector3(0.03, cat ? 0.19 : 0.08, 0.08))];
  for (let i = 0; i < 3; i += 1) {
    const a = tail[i]!, b = tail[i + 1]!, delta = b.clone().sub(a);
    const radius = cat ? 0.075 - i * 0.014 : 0.11 - i * 0.022;
    add(new THREE.CapsuleGeometry(radius, Math.max(0.01, delta.length() - radius * 2), 3, 8)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()))
      .translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), i === 2 ? darkFur : fur, `tail${i}` as BoneName);
  }
  const geometry = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  if (!geometry) throw new Error("Could not merge animal geometry");
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const name of BONE_NAMES) { bones[name] = new THREE.Bone(); bones[name].name = name; }
  for (const name of BONE_NAMES) {
    const parent = parents[name];
    bones[name].position.copy(rest[name]);
    if (parent) { bones[name].position.sub(rest[parent]); bones[parent].add(bones[name]); }
  }
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = `${agent.breed}-figure`; mesh.add(bones.root); mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(BONE_NAMES.map((name) => bones[name])));
  mesh.scale.setScalar(agent.scale); mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.9); mesh.frustumCulled = true;
  const group = new THREE.Group(); group.name = agent.id; group.userData = { species: agent.species, breed: agent.breed, name: agent.name, groundClearance: ANIMAL_CLEARANCE };
  group.add(mesh);
  return { group, mesh, bones, bodyY };
}

/** Four original pets, four draw calls, one shared cel/painterly material. */
export function buildAnimals(_palette: MaterialSource, layout: CityLayout = createCityLayout()): BuiltAnimals {
  const agents = createAnimalAgents(layout), group = new THREE.Group();
  group.name = "London cats and dogs";
  group.userData = { cosmetic: true, interactive: false };
  if (!agents.length) return { group, agents, update() {}, blocks: () => false, dispose() {} };
  const material = createIllustratedMaterial({ color: "#ffffff", lighting: "world", vertexColors: true, character: true, softCharacter: true, surfaceId: 0.984, outline: 0.68, grain: 0 });
  material.name = "LondonAnimalMaterial";
  const animals = agents.map((agent) => { const rig = animalModel(agent, material); group.add(rig.group); return { agent, rig }; });
  const update = (time: number, reduced: boolean, viewpoint?: THREE.Vector3) => {
    const t = reduced || !Number.isFinite(time) ? 0 : time;
    for (const { agent, rig } of animals) {
      const near = !viewpoint || Math.hypot(viewpoint.x - agent.position.x, viewpoint.z - agent.position.z) < ANIMAL_VIEW_DISTANCE;
      rig.group.visible = near;
      rig.group.position.set(agent.position.x, agent.position.y, agent.position.z);
      rig.group.rotation.y = -agent.heading;
      if (!near && !reduced) continue;
      const phase = t + agent.phase, b = rig.bones;
      b.body.scale.y = 1 + Math.sin(phase * 1.7) * 0.013;
      b.head.rotation.set(Math.sin(phase * 0.63) * 0.055, Math.sin(phase * 0.41) * 0.13, Math.sin(phase * 0.37) * 0.045);
      b.earL.rotation.z = Math.sin(phase * 1.13) * 0.055;
      b.earR.rotation.z = -Math.sin(phase * 1.13 + 0.9) * 0.055;
      const wag = agent.species === "dog" ? 0.22 : 0.1;
      for (const [index, name] of (["tail0", "tail1", "tail2"] as const).entries()) {
        b[name].rotation.y = Math.sin(phase * (agent.species === "dog" ? 2.9 : 0.85) - index * 0.45) * wag;
        b[name].rotation.x = Math.sin(phase * 0.7 - index * 0.35) * 0.035;
      }
      const blink = phase % 5.3;
      b.eyes.scale.y = blink < 0.13 ? 0.14 + 0.86 * Math.abs(blink / 0.13 * 2 - 1) : 1;
    }
  };
  update(0, false);
  return { group, agents, update,
    blocks(x, z, radius) {
      return animals.some(({ agent, rig }) => rig.group.visible
        && Math.hypot(x - agent.position.x, z - agent.position.z) < radius + (agent.species === "cat" ? 0.55 : 0.72) * agent.scale);
    },
    dispose() { animals.forEach(({ rig }) => rig.mesh.skeleton.dispose()); },
  };
}
