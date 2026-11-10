import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createHillTownWalkWorld } from "../courier/walkWorld";
import { Palette } from "./kit";
import { LONDON_SURFACE } from "./londonTerrain";
import { createCityLayout, createHillTownLayout, polarToXZ } from "./layout";
import { MAKE_WAY, RESIDENT_CLEARANCE, buildResidents, createResidentAgents, residentIdentity, residentLook, easedProgress, type ResidentRoute } from "./residents";
import { GAITS } from "../courier/humanGait";

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
      // London paths keep to pavement-level surfaces (paving, aprons, squares: never a road or a hole); a hill
      // town's arcs keep to one terrace.
      if (source.plan) {
        expect(surface.height, agent.id).toBeGreaterThanOrEqual(LONDON_SURFACE.ground);
        expect(surface.height, agent.id).toBeLessThanOrEqual(LONDON_SURFACE.square);
      } else {
        expect(surface.height, agent.id).toBeCloseTo(route.height, 5);
      }
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

  it("dresses all32 neighbours in the reference's relaxed knits and medium shag, with slender natural proportions", () => {
    const identities = residents.agents.map(residentIdentity);
    const looks = residents.agents.map(residentLook);
    expect(identities.filter((person) => person.gender === "woman")).toHaveLength(16);
    expect(identities.filter((person) => person.gender === "man")).toHaveLength(16);
    expect(new Set(identities.map((person) => person.age))).toEqual(new Set(["young", "adult", "older"]));
    expect(looks.filter((look) => look.garment === "hoodie")).toHaveLength(16);
    expect(looks.filter((look) => look.garment === "cardigan")).toHaveLength(16);
    expect(new Set(looks.map((look) => look.hairStyle))).toEqual(new Set(["layered"]));
    expect(new Set(looks.map((look) => look.hair)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(looks.map((look) => look.skin)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(looks.map((look) => JSON.stringify(look))).size).toBe(32);
    for (const [index, look] of looks.entries()) {
      expect(look.face).toBe("anime"); expect(look.head).toBeGreaterThanOrEqual(1.04); expect(look.head).toBeLessThanOrEqual(1.12);
      expect(look.build).toBeGreaterThanOrEqual(0.82); expect(look.build).toBeLessThan(0.96);
      expect(look.fit).toBeGreaterThanOrEqual(1.03); expect(look.fit).toBeLessThan(1.12);
      expect(look.trouserFit).toBeGreaterThanOrEqual(1.04); expect(look.trouserFit).toBeLessThan(1.12);
      expect(look.limbs).toBeGreaterThanOrEqual(0.75); expect(look.limbs).toBeLessThan(0.86);
      expect(look.hands).toBeGreaterThanOrEqual(0.74); expect(look.hands).toBeLessThan(0.82);
      // Fullness compounds with anatomy; bound their product to exclude the former balloon torso/sleeves.
      expect(look.build! * look.fit!).toBeLessThan(1.08);
      expect(look.limbs! * look.fit!).toBeLessThan(0.97);
      expect(look.hairLength).toBeGreaterThanOrEqual(1); expect(look.hairLength).toBeLessThan(1.4);
      expect(look.longTop).toBe(true); expect(look.legs).toBe("trousers");
      expect(look.cap).toBeUndefined(); expect(look.collar).toBeUndefined(); expect(look.pockets).toBe(false);
      // Every pair of trousers remains a muted denim blue, rather than the previous purple/khaki wardrobe.
      const denim = new THREE.Color(look.trousers);
      expect(denim.b).toBeGreaterThan(denim.g); expect(denim.g).toBeGreaterThan(denim.r);
      expect(["#a4c994", "#97bd8e", "#d09a83", "#dca993", "#e7dfc9", "#d7d3bd"]).toContain(look.jacket);
      expect(people[index]!.userData).toMatchObject(identities[index]!);
    }
  });

  it("keeps every variant's actual skinned soles on the floor in the held pose", () => {
    residents.update(0, true); residents.group.updateMatrixWorld(true);
    const point = new THREE.Vector3();
    people.forEach((person, index) => {
      const mesh = figureOf(index), positions = mesh.geometry.getAttribute("position");
      let sole = Infinity;
      for (let vertex = 0; vertex < positions.count; vertex += 1) {
        point.fromBufferAttribute(positions, vertex);
        mesh.applyBoneTransform(vertex, point).applyMatrix4(mesh.matrixWorld);
        sole = Math.min(sole, point.y);
      }
      expect(sole - person.position.y, person.name).toBeGreaterThanOrEqual(-0.005);
      expect(sole - person.position.y, person.name).toBeLessThan(0.01);
    });
  });

  it("staggers blinks across the crowd rather than closing every face on the same frame", () => {
    let maxClosed = 0, blinkSamples = 0;
    for (let frame = 0; frame < 264; frame += 1) {
      residents.update(frame / 60, false);
      const closed = people.filter((_, index) => figureOf(index).skeleton.bones.find((bone) => bone.name === "eyes")!.scale.y < 0.8).length;
      maxClosed = Math.max(maxClosed, closed); blinkSamples += closed;
    }
    expect(blinkSamples).toBeGreaterThan(40); // the clocks actually blink during this full cycle
    expect(maxClosed).toBeLessThan(8); // no synchronized whole-population blink
    residents.update(5, true);
    people.forEach((_, index) => expect(figureOf(index).skeleton.bones.find((bone) => bone.name === "eyes")!.scale.y).toBe(1));
  });

  it("stands every resident on the ground drawn where they are, as they walk", () => {
    const world = createHillTownWalkWorld(layout);
    let raised = 0;
    for (const time of [0, 3.7, 11.2, 26.5, 61]) {
      residents.update(time, false);
      for (const person of residents.group.children) {
        const ground = world.surfaceAt(person.position.x, person.position.z);
        expect(ground.walkable, person.name).toBe(true);
        expect(person.position.y, `${person.name} at ${time}s`).toBeCloseTo(ground.height, 6);
        if (ground.height > LONDON_SURFACE.ground) raised += 1;
      }
    }
    // Most of them are on paving or a square, not bare ground: the check above is not vacuous.
    expect(raised).toBeGreaterThan(residents.group.children.length);
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

describe("how residents move", () => {
  const forwardOf = (object: THREE.Object3D) => new THREE.Vector3(0, 0, -1).applyQuaternion(object.quaternion);

  it("walk facing the way they go (not backwards), and browsers face what they are looking at", () => {
    const built = buildResidents(new Palette(), layout);
    let walked = 0;
    for (const time of [4, 9.5, 17, 31, 48]) {
      built.update(time, false);
      for (let frame = 0; frame < 12; frame += 1) built.update(time + frame / 60, false);
      const before = built.group.children.map((person) => person.position.clone());
      built.update(time + 13 / 60, false);
      built.group.children.forEach((person, i) => {
        const move = person.position.clone().sub(before[i]!).setY(0);
        if (move.length() < 0.02) return;
        expect(forwardOf(person).dot(move.normalize()), `${person.name} at ${time}s`).toBeGreaterThan(0.9);
        walked += 1;
      });
    }
    expect(walked).toBeGreaterThan(30);
    built.update(0, true);
    built.group.children.forEach((person, i) => {
      const agent = built.agents[i]!;
      if (!agent.stationary) return;
      const landmark = layout.landmarks.find((site) => site.district === agent.district)!;
      const toward = new THREE.Vector3(landmark.x - person.position.x, 0, landmark.z - person.position.z).normalize();
      expect(forwardOf(person).dot(toward), person.name).toBeGreaterThan(0.99);
    });
    built.dispose();
  });

  it("ease up to their pace and down to a stop at each end, over the same time and distance", () => {
    for (const duration of [2.4, 6, 15]) {
      let last = 0, fastest = 0;
      const dt = duration / 600;
      for (let i = 1; i <= 600; i += 1) {
        const p = easedProgress(i * dt, duration);
        expect(p).toBeGreaterThanOrEqual(last - 1e-12);
        fastest = Math.max(fastest, (p - last) / dt);
        last = p;
      }
      expect(easedProgress(0, duration)).toBe(0);
      expect(easedProgress(duration, duration)).toBe(1);
      // Gentle at the very start and end: nowhere near full pace in the first and last twentieth of a second.
      expect(easedProgress(0.05, duration) * duration / 0.05).toBeLessThan(0.2);
      expect((1 - easedProgress(duration - 0.05, duration)) * duration / 0.05).toBeLessThan(0.2);
      // Never much faster than the even pace (so the stroll never tips into a jog).
      expect(fastest * duration).toBeLessThan(1.21);
    }
  });

  it("never stop dead or start at full pace: in the town, no walker goes from half its pace to a standstill in a frame", () => {
    const built = buildResidents(new Palette(), layout);
    const n = built.group.children.length;
    // Each walker's even pace, per 60 fps frame.
    const pace = built.agents.map((agent) => agent.speed / 60);
    let last = built.group.children.map((person) => person.position.clone());
    const previous = new Array<number>(n).fill(NaN);
    let stops = 0, jolts = 0;
    const log: string[] = [];
    for (let frame = 1; frame <= 60 * 45; frame += 1) {
      built.update(frame / 60, false);
      built.group.children.forEach((person, i) => {
        if (built.agents[i]!.stationary) return;
        const step = Math.hypot(person.position.x - last[i]!.x, person.position.z - last[i]!.z);
        const before = previous[i]!;
        if (Number.isFinite(before)) {
          const stopDead = before > 0.5 * pace[i]! && step < 0.05 * pace[i]!;
          const startFull = before < 0.05 * pace[i]! && step > 0.5 * pace[i]!;
          if (stopDead || startFull) { jolts += 1; log.push(`${person.name} f${frame} ${before.toFixed(4)} -> ${step.toFixed(4)}`); }
          if (before > 0 && step === 0) stops += 1;
        }
        // The first frame has no real previous step: walkers start mid-stride.
        previous[i] = frame > 1 ? step : NaN;
      });
      last = built.group.children.map((person) => person.position.clone());
    }
    expect(stops).toBeGreaterThan(10);
    expect(jolts, log.join(" | ")).toBe(0);
    built.dispose();
  });

  it("step at a natural walking cadence for their size: about 100–130 steps a minute", () => {
    for (const agent of createResidentAgents(layout)) {
      const figureScale = agent.scale * 0.97;
      const stepsPerMinute = (2 * 60 * agent.speed) / (figureScale * GAITS.walk.stride);
      expect(stepsPerMinute, agent.id).toBeGreaterThan(100);
      expect(stepsPerMinute, agent.id).toBeLessThan(130);
    }
  });

  it("turn about at the end of a stretch smoothly, never snapping round in a frame", () => {
    const built = buildResidents(new Palette(), layout);
    const headings = () => built.group.children.map((person) => person.rotation.y);
    built.update(0, false);
    let last = headings(), sharpest = 0;
    for (let frame = 1; frame <= 60 * 60; frame += 1) {
      built.update(frame / 60, false);
      const now = headings();
      now.forEach((h, i) => {
        const turn = Math.abs(Math.atan2(Math.sin(h - last[i]!), Math.cos(h - last[i]!)));
        sharpest = Math.max(sharpest, turn);
      });
      last = now;
    }
    // The about-turn takes 1.1 s, eased: at 60 fps no frame turns more than about 4 degrees.
    expect(sharpest).toBeLessThan(0.1);
    built.dispose();
  });

  it("make way: a walker stops short of the courier standing in its path, then walks on once she has gone", () => {
    const built = buildResidents(new Palette(), layout);
    const index = built.agents.findIndex((agent) => !agent.stationary);
    const person = built.group.children[index]!;
    let t = 2;
    for (; t < 3; t += 1 / 60) built.update(t, false);
    // Find it mid-stride, then stand the courier a little ahead of it.
    let guard = 0;
    const moving = () => {
      const before = person.position.clone();
      built.update(t += 1 / 60, false);
      return person.position.distanceTo(before) > 0.02;
    };
    while (!moving() && guard < 600) guard += 1;
    const ahead = forwardOf(person).multiplyScalar(MAKE_WAY.ahead * 0.6).add(person.position);
    const courier = { x: ahead.x, z: ahead.z };
    for (let i = 0; i < 90; i += 1) built.update(t += 1 / 60, false, undefined, courier);
    const stopped = person.position.clone();
    for (let i = 0; i < 60; i += 1) built.update(t += 1 / 60, false, undefined, courier);
    expect(person.position.distanceTo(stopped)).toBeLessThan(0.01);
    expect(Math.hypot(person.position.x - courier.x, person.position.z - courier.z)).toBeGreaterThan(0.8);
    // She steps away: it walks on.
    const waited = person.position.clone();
    for (let i = 0; i < 90; i += 1) built.update(t += 1 / 60, false, undefined, null);
    expect(person.position.distanceTo(waited)).toBeGreaterThan(0.5);
    built.dispose();
  });

  it("are solid to the courier: blocks() reports a body touching any resident", () => {
    const built = buildResidents(new Palette(), layout);
    built.update(5, false);
    const person = built.group.children[0]!;
    expect(built.blocks(person.position.x + 0.6, person.position.z, 0.3)).toBe(true);
    expect(built.blocks(person.position.x + 2, person.position.z, 0.3)).toBe(false);
    built.dispose();
  });
});

