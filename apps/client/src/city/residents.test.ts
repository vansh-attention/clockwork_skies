import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createHillTownWalkWorld } from "../courier/walkWorld";
import { Palette } from "./kit";
import { createCityLayout, createHillTownLayout, polarToXZ } from "./layout";
import { RESIDENT_CLEARANCE, buildResidents, createResidentAgents, type ResidentRoute } from "./residents";

const layout = createCityLayout();
const residents = buildResidents(new Palette(), layout);
/** Each resident's root (placed and turned) and its skinned figure. */
const people = residents.group.children as THREE.Group[];
const figureOf = (index: number) => people[index]!.children[0] as THREE.SkinnedMesh;
const positionAt = (index: number) => people[index]!.position.clone();
const boneAngles = (index: number) => figureOf(index).skeleton.bones.map((bone) => bone.rotation.toArray().slice(0, 3).join(","));

function sampleRoute(route: ResidentRoute): { x: number; z: number }[] {
  if (route.kind === "arc") {
    const count = Math.max(1, Math.ceil(route.halfArc * 2 / 0.1));
    return Array.from({ length: count + 1 }, (_, i) => polarToXZ(route.bearing + (route.radius ? (i / count * 2 - 1) * route.halfArc / route.radius : 0), route.radius));
  }
  if (route.points.length === 1) return [...route.points];
  return route.points.slice(1).flatMap((b, i) => {
    const a = route.points[i]!;
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1));
    return Array.from({ length: count + 1 }, (_, sample) => ({ x: a.x + (b.x - a.x) * sample / count, z: a.z + (b.z - a.z) * sample / count }));
  });
}

function distanceToPolyline(p: { x: number; z: number }, points: readonly { x: number; z: number }[]): number {
  const target = new THREE.Vector3(p.x, 0, p.z);
  return Math.min(...points.slice(1).map((b, i) => {
    const a = points[i]!;
    return new THREE.Line3(new THREE.Vector3(a.x, 0, a.z), new THREE.Vector3(b.x, 0, b.z))
      .closestPointToPoint(target, true, new THREE.Vector3()).distanceTo(target);
  }));
}

function checkRoutes(source: ReturnType<typeof createCityLayout>) {
  const world = createHillTownWalkWorld(source);
  const agents = createResidentAgents(source);
  for (const agent of agents) {
    const { route } = agent;
    for (const point of sampleRoute(route)) {
      expect(world.blocked(point.x, point.z, RESIDENT_CLEARANCE - 0.15), agent.id).toBe(false);
      const surface = world.surfaceAt(point.x, point.z);
      expect(surface.walkable, agent.id).toBe(true);
      expect(surface.height, agent.id).toBeCloseTo(route.height, 5);
      if (source.plan) {
        const own = source.landmarks.find((site) => site.district === agent.district)!;
        const distance = Math.hypot(point.x - own.x, point.z - own.z);
        for (const other of source.landmarks) expect(distance, agent.id).toBeLessThanOrEqual(Math.hypot(point.x - other.x, point.z - other.z) + 1e-6);
      }
    }
  }
}

describe("London residents", () => {
  it("inhabits all eight neighbourhoods with walkers and stationary browsers, without interaction hooks", () => {
    expect(layout.plan).toBeDefined();
    expect(residents.agents).toHaveLength(32);
    expect(residents.agents.every((agent) => agent.route.kind === "path")).toBe(true);
    expect(new Set(residents.agents.map((agent) => agent.id)).size).toBe(residents.agents.length);
    for (let district = 0; district < 8; district += 1) {
      const neighbours = residents.agents.filter((agent) => agent.district === district);
      expect(neighbours).toHaveLength(4);
      expect(neighbours.some((agent) => !agent.stationary)).toBe(true);
      expect(neighbours.some((agent) => agent.stationary)).toBe(true);
    }
    expect(residents.agents.filter((agent) => agent.district === 6 && agent.stationary).length).toBeGreaterThanOrEqual(2);
    expect(residents.group.userData).toMatchObject({ cosmetic: true, interactive: false });
  });

  it("validates complete nonradial sidewalk paths against the actual buildings, props, river and ground", () => {
    checkRoutes(layout);
    checkRoutes(createCityLayout(7));
  });

  it("keeps moving residents on actual polyline pavements and out of every intersecting carriageway", () => {
    for (const agent of residents.agents.filter((agent) => !agent.stationary)) {
      expect(agent.route.kind).toBe("path");
      if (agent.route.kind !== "path") continue;
      const route = agent.route;
      const owner = layout.plan!.streets.find((candidate) => candidate.id === route.streetId)!;
      expect(owner).toBeDefined();
      for (const point of sampleRoute(route)) {
        const distance = distanceToPolyline(point, owner.points);
        expect(distance).toBeGreaterThan(owner.width / 2);
        expect(distance).toBeLessThan(owner.width / 2 + owner.pavement);
        for (const other of layout.plan!.streets) expect(distanceToPolyline(point, other.points)).toBeGreaterThan(other.width / 2);
      }
    }
  });

  it("retains collision-validated arc routes for explicitly supplied legacy hill towns", () => {
    const legacy = createHillTownLayout();
    const agents = createResidentAgents(legacy);
    expect(legacy.plan).toBeUndefined();
    expect(agents.length).toBeGreaterThan(16);
    expect(agents.every((agent) => agent.route.kind === "arc")).toBe(true);
    checkRoutes(legacy);
  });

  it("draws every resident as a skinned person in one shared material, culled one by one", () => {
    expect(people).toHaveLength(residents.agents.length);
    const material = figureOf(0).material as THREE.ShaderMaterial;
    expect(material.fragmentShader).toContain("location = 1");
    expect(Object.keys(material.defines ?? {})).toEqual(expect.arrayContaining(["ILLUSTRATED_CHARACTER", "ILLUSTRATED_VERTEX_COLORS"]));
    people.forEach((_, index) => {
      const figure = figureOf(index);
      expect(figure).toBeInstanceOf(THREE.SkinnedMesh);
      expect(figure.material).toBe(material);
      expect(figure.castShadow).toBe(true);
      expect(figure.receiveShadow).toBe(true);
      // A fixed sphere round a standing or striding figure keeps frustum culling cheap and safe.
      expect(figure.frustumCulled).toBe(true);
      expect(figure.boundingSphere?.radius).toBeGreaterThan(2);
    });
    // Dress varies across the population.
    const colours = new Set(people.map((_, index) => Array.from(figureOf(index).geometry.getAttribute("color").array.slice(0, 3)).join(",")));
    expect(colours.size).toBeGreaterThan(3);
  });

  it("walks, turns and moves its legs while the market browsers stay at their stalls", () => {
    residents.update(2, false);
    const before = residents.agents.map((_, i) => positionAt(i));
    const legsBefore = residents.agents.map((_, i) => boneAngles(i).join(";"));
    for (let t = 2; t <= 5; t += 1 / 30) residents.update(t, false);
    const walked = residents.agents.filter((agent, index) => !agent.stationary && positionAt(index).distanceTo(before[index]!) > 0.5);
    expect(walked.length).toBeGreaterThan(8);
    residents.agents.forEach((agent, index) => {
      if (agent.stationary) expect(positionAt(index).distanceTo(before[index]!)).toBeLessThan(1e-6);
    });
    const posed = residents.agents.filter((agent, index) => !agent.stationary && boneAngles(index).join(";") !== legsBefore[index]);
    expect(posed.length).toBeGreaterThan(8);
  });

  it("holds every pose still with reduced motion and never produces mirrored or invalid bones", () => {
    residents.update(40, true);
    const before = residents.agents.map((_, i) => boneAngles(i).join(";") + positionAt(i).toArray().join(","));
    residents.update(83, true);
    residents.agents.forEach((_, i) => expect(boneAngles(i).join(";") + positionAt(i).toArray().join(",")).toBe(before[i]));
    for (const time of [0, 5, 12, 30, 67, 100]) {
      residents.update(time, false);
      residents.group.updateMatrixWorld(true);
      people.forEach((_, index) => {
        for (const bone of figureOf(index).skeleton.bones) {
          expect(bone.matrixWorld.elements.every(Number.isFinite)).toBe(true);
          expect(bone.matrixWorld.determinant()).toBeGreaterThan(0);
        }
      });
    }
  });

  it("rests and hides residents far beyond the street haze, and shows them again nearby", () => {
    const far = new THREE.Vector3(5000, 0, 5000);
    residents.update(10, false, far);
    expect(people.every((person) => !person.visible)).toBe(true);
    const at = positionAt(0);
    residents.update(10.1, false, at);
    expect(people[0]!.visible).toBe(true);
    residents.update(10.2, false);
    expect(people.every((person) => person.visible)).toBe(true);
  });

  it("produces the same residents from the same seed while allowing dress and pace variation", () => {
    expect(createResidentAgents(layout, 4)).toEqual(createResidentAgents(layout, 4));
    expect(createResidentAgents(layout, 4)).not.toEqual(createResidentAgents(layout, 5));
  });
});
