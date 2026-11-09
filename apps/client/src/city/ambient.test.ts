import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createHillTownWalkWorld } from "../courier/walkWorld";
import { buildAmbient } from "./ambient";
import { Palette, addHouse } from "./kit";
import { STREET, TERRACES, createCityLayout, createHillTownLayout } from "./layout";
import { frontageApron, onFrontage } from "./londonDetails";

const layout = createCityLayout();
const world = createHillTownWalkWorld(layout);
const ambient = buildAmbient(new Palette(), world, layout);

const instancePosition = (mesh: THREE.InstancedMesh, index: number) => {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
};
const instanceScale = (mesh: THREE.InstancedMesh, index: number) => {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixScale(matrix);
};

describe("buildAmbient", () => {
  it("costs four draw calls, all drawn into both illustration buffers", () => {
    const meshes: THREE.Mesh[] = [];
    ambient.group.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
    expect(meshes).toHaveLength(4);
    for (const mesh of meshes) {
      const material = mesh.material as THREE.ShaderMaterial;
      expect(material.fragmentShader).toContain("location = 1");
    }
  });

  it("grows grass only off the actual river, polyline streets, paved squares and buildings", () => {
    expect(layout.plan).toBeDefined();
    const plan = layout.plan!;
    const frontages = plan.houses.map((house) => frontageApron(house, plan)).filter((apron) => apron !== null);
    const distance = (p: THREE.Vector3, points: readonly { x: number; z: number }[]) => Math.min(...points.slice(1).map((b, index) => {
      const a = points[index]!;
      return new THREE.Line3(new THREE.Vector3(a.x, 0, a.z), new THREE.Vector3(b.x, 0, b.z))
        .closestPointToPoint(new THREE.Vector3(p.x, 0, p.z), true, new THREE.Vector3()).distanceTo(new THREE.Vector3(p.x, 0, p.z));
    }));
    expect(ambient.grass.count).toBeGreaterThan(400);
    for (let i = 0; i < ambient.grass.count; i += 1) {
      const p = instancePosition(ambient.grass, i);
      expect(frontages.some((apron) => onFrontage(p.x, p.z, apron, 0.29))).toBe(false);
      expect(distance(p, plan.river.points)).toBeGreaterThanOrEqual(plan.river.halfWidth + 3.99);
      for (const street of plan.streets) expect(distance(p, street.points)).toBeGreaterThanOrEqual(street.width / 2 + street.pavement + 1.49);
      for (const square of plan.squares) {
        const local = p.clone().sub(new THREE.Vector3(square.x, 0, square.z)).applyAxisAngle(new THREE.Vector3(0, 1, 0), -square.rotation);
        expect(Math.abs(local.x) < square.width / 2 + 1.49 && Math.abs(local.z) < square.depth / 2 + 1.49).toBe(false);
      }
      expect(world.blocked(p.x, p.z, 1)).toBe(false);
      expect(p.y).toBeCloseTo(world.surfaceAt(p.x, p.z).height, 6);
    }
  });

  it("keeps the radial lawn exclusions only for legacy layouts without a London plan", () => {
    const legacy = createHillTownLayout();
    const legacyWorld = createHillTownWalkWorld(legacy);
    const life = buildAmbient(new Palette(), legacyWorld, legacy);
    expect(life.grass.count).toBeGreaterThan(800);
    for (let i = 0; i < life.grass.count; i += 1) {
      const p = instancePosition(life.grass, i);
      const radius = Math.hypot(p.x, p.z);
      for (const terrace of TERRACES) expect(radius > terrace.radius - STREET.inset && radius < terrace.radius - STREET.inset + STREET.width).toBe(false);
      expect(legacyWorld.blocked(p.x, p.z, 1)).toBe(false);
    }
  });

  it("keeps the wind weights on grass tips and pennant ends (roots and poles stay still)", () => {
    const tuftSway = ambient.grass.geometry.getAttribute("sway");
    const tuftY = ambient.grass.geometry.getAttribute("position");
    for (let i = 0; i < tuftSway.count; i += 1) if (tuftY.getY(i) < 1e-6) expect(tuftSway.getX(i)).toBeCloseTo(0, 6);
    expect(Math.max(...Array.from(tuftSway.array as Float32Array))).toBeGreaterThan(0.4);
    const pennantSway = ambient.pennants.geometry.getAttribute("sway");
    expect(pennantSway).toBeDefined();
    const weights = Array.from(pennantSway.array as Float32Array);
    expect(weights.filter((weight) => weight === 0).length).toBeGreaterThan(0);
    expect(Math.max(...weights)).toBeGreaterThan(0.5);
  });

  it("flies the birds well above the town, flapping", () => {
    ambient.update(3, false);
    const first = instanceScale(ambient.birds, 0).y;
    for (let i = 0; i < ambient.birds.count; i += 1) expect(instancePosition(ambient.birds, i).y).toBeGreaterThan(100);
    const before = instancePosition(ambient.birds, 0);
    ambient.update(3.4, false);
    expect(instancePosition(ambient.birds, 0).distanceTo(before)).toBeGreaterThan(1);
    expect(instanceScale(ambient.birds, 0).y).not.toBeCloseTo(first, 3);
  });

  it("never mirrors a bird mid-flap (a mirrored instance would draw inside out)", () => {
    for (let t = 0; t < 2; t += 0.05) {
      ambient.update(t, false);
      for (let i = 0; i < ambient.birds.count; i += 1) {
        const matrix = new THREE.Matrix4();
        ambient.birds.getMatrixAt(i, matrix);
        expect(matrix.determinant()).toBeGreaterThan(0);
      }
    }
  });

  it("puts the smoke over the chimneys addHouse actually builds", () => {
    // The chimney pots are the clay ("roof2") cylinders addHouse puts highest; the smoke rises from between them.
    const batch = { parts: [] as THREE.BufferGeometry[], add(key: string, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4) {
      if (key === "roof2" && matrix && geometry.type === "CylinderGeometry") this.parts.push(geometry.applyMatrix4(matrix));
    } };
    const house = layout.houses.find((candidate) => candidate.chimney)!;
    addHouse(batch as never, house);
    expect(batch.parts).toHaveLength(2);
    const pots = batch.parts.map((part) => { part.computeBoundingBox(); return part.boundingBox!; });
    const pair = pots[0]!.clone().union(pots[1]!);
    const top = ambient.chimneys[layout.houses.filter((candidate) => candidate.chimney).indexOf(house)]!;
    expect(top.y).toBeCloseTo(pair.max.y, 3);
    expect(top.x).toBeCloseTo((pair.min.x + pair.max.x) / 2, 3);
    expect(top.z).toBeCloseTo((pair.min.z + pair.max.z) / 2, 3);
  });

  it("keeps chimney smoke attached to an explicitly translated and rotated street house, independent of polar metadata", () => {
    const source = layout.houses.find((house) => house.chimney)!;
    const house = { ...source, x: 135, z: -91, rotation: 0.43, r: 17, theta: 2.8 };
    const custom = { ...layout, houses: [house] };
    const life = buildAmbient(new Palette(), createHillTownWalkWorld(custom), custom);
    const pots: THREE.BufferGeometry[] = [];
    addHouse({ add(key: string, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4) {
      if (key === "roof2" && matrix && geometry.type === "CylinderGeometry") pots.push(geometry.applyMatrix4(matrix));
    } } as never, house);
    expect(pots).toHaveLength(2);
    const bounds = new THREE.Box3();
    for (const pot of pots) { pot.computeBoundingBox(); bounds.union(pot.boundingBox!); }
    const top = life.chimneys[0]!;
    expect(top.x).toBeCloseTo((bounds.min.x + bounds.max.x) / 2, 3);
    expect(top.z).toBeCloseTo((bounds.min.z + bounds.max.z) / 2, 3);
    expect(top.y).toBeCloseTo(bounds.max.y, 3);
  });

  it("raises a smoke plume from every chimney top, flowing with time, in one draw that inks nothing", () => {
    expect(ambient.chimneys.length).toBe(layout.houses.filter((house) => house.chimney).length);
    // One ribbon per chimney, every vertex at its chimney top (the shader lifts each by how far along the plume it is).
    const geometry = ambient.smoke.mesh.geometry;
    const position = geometry.getAttribute("position");
    const along = geometry.getAttribute("aAlong");
    expect(position.count % ambient.chimneys.length).toBe(0);
    const perPlume = position.count / ambient.chimneys.length;
    const top = ambient.chimneys[0]!;
    for (let i = 0; i < perPlume; i += 1) expect(new THREE.Vector3().fromBufferAttribute(position, i).distanceTo(top)).toBeLessThan(1e-4);
    expect(along.getX(0)).toBe(0);
    expect(along.getX(perPlume - 1)).toBe(1);
    // It flows with time.
    const material = ambient.smoke.mesh.material as THREE.ShaderMaterial;
    ambient.update(2, false);
    const earlier = material.uniforms.uTime!.value as number;
    ambient.update(3, false);
    expect(material.uniforms.uTime!.value).toBeGreaterThan(earlier);
    // As the reference's smoke: translucent flat fill, hidden behind nearer things, and leaving the ids, depth, normals
    // and ink mask beneath exactly as they were, so no ink is drawn round it.
    expect(material.uniforms.uOpacity!.value).toBeCloseTo(0.35, 6);
    expect(material.transparent).toBe(true);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.blending).toBe(THREE.CustomBlending);
    expect(material.blendSrcAlpha).toBe(THREE.ZeroFactor);
    expect(material.blendDstAlpha).toBe(THREE.OneFactor);
    expect(material.fragmentShader).toContain("outInfo = vec4(0.0)");
  });

  it("holds a still frame under reduced motion", () => {
    ambient.update(10, true);
    const birds = Array.from({ length: ambient.birds.count }, (_, i) => instancePosition(ambient.birds, i));
    const material = ambient.smoke.mesh.material as THREE.ShaderMaterial;
    const smokeTime = material.uniforms.uTime!.value as number;
    ambient.update(55, true);
    birds.forEach((p, i) => expect(instancePosition(ambient.birds, i).distanceTo(p)).toBeLessThan(1e-9));
    expect(material.uniforms.uTime!.value).toBe(smokeTime);
  });
});
