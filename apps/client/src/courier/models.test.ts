import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildCity } from "../city/buildCity";
import { Palette } from "../city/kit";
import { animateBeacon, animateCourier, createBeacon, createCourierModel, disposeModel } from "./models";
import { createGait, createPose, gaitPose, updateGait } from "./gait";

const ALLOWED = ["wall0", "copper", "ink", "accent2", "brass"] as const;

function setup() {
  const palette = new Palette((i) => ["#c45f45", "#e1a74f", "#4f9184"][i]);
  const requested: string[] = [];
  const spy = {
    get: (key: Parameters<Palette["get"]>[0]) => {
      requested.push(key);
      return palette.get(key);
    },
  };
  return { palette, spy, requested };
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  return meshes;
}

function snapshot(root: THREE.Object3D): string[] {
  const out: string[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => out.push(o.matrixWorld.elements.join(",")));
  return out;
}

describe("createCourierModel", () => {
  it("uses only shared illustrated materials from the palette", () => {
    const { palette, spy, requested } = setup();
    const { group } = createCourierModel(spy);
    expect(requested.length).toBeGreaterThan(0);
    for (const key of requested) expect(ALLOWED).toContain(key);
    const shared = new Set<THREE.Material>(ALLOWED.map((k) => palette.get(k)));
    const meshes = meshesOf(group);
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      const material = mesh.material;
      expect(material).toBeInstanceOf(THREE.ShaderMaterial);
      expect((material as THREE.ShaderMaterial).fragmentShader).toContain("location = 1");
      expect(shared.has(material as THREE.Material)).toBe(true);
    }
  });

  it("stays within 16 meshes and exposes every joint of the rig", () => {
    const { spy } = setup();
    const model = createCourierModel(spy);
    expect(meshesOf(model.group).length).toBeLessThanOrEqual(16);
    const { rig } = model;
    const joints = [rig.body, rig.torso, rig.head, rig.key, ...rig.arms, ...rig.legs.flatMap((leg) => [leg.thigh, leg.shin, leg.foot])];
    expect(new Set(joints).size).toBe(joints.length);
    for (const joint of joints) {
      let node: THREE.Object3D | null = joint;
      while (node && node !== model.group) node = node.parent;
      expect(node).toBe(model.group);
    }
    expect(model.leftLeg).toBe(rig.legs[0].thigh);
    expect(model.rightLeg).toBe(rig.legs[1].thigh);
    expect(model.key).toBe(rig.key);
    // The shins hang from the thighs and the boots from the shins, so a bent knee carries the foot with it.
    expect(rig.legs[0].shin.parent).toBe(rig.legs[0].thigh);
    expect(rig.legs[0].foot.parent).toBe(rig.legs[0].shin);
  });

  it("is 4 to 5.5 units tall with feet at y = 0", () => {
    const { spy } = setup();
    const { group } = createCourierModel(spy);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const height = box.max.y - box.min.y;
    expect(height).toBeGreaterThanOrEqual(4);
    expect(height).toBeLessThanOrEqual(5.5);
    expect(box.min.y).toBeCloseTo(0, 1);
  });

  it("puts the visor on the -Z side and the key on the +Z back", () => {
    const { spy } = setup();
    const model = createCourierModel(spy);
    model.group.updateMatrixWorld(true);
    const visor = model.group.getObjectByName("visor");
    expect(visor).toBeInstanceOf(THREE.Mesh);
    const visorBox = new THREE.Box3().setFromObject(visor!);
    expect(visorBox.min.z).toBeLessThan(-0.6);
    expect(visorBox.getCenter(new THREE.Vector3()).z).toBeLessThan(0);
    const keyPos = new THREE.Vector3().setFromMatrixPosition(model.key.matrixWorld);
    expect(keyPos.z).toBeGreaterThan(1);
  });

  it("names limbs by the character's own sides: left is at -X when facing -Z", () => {
    const { spy } = setup();
    const { rig } = createCourierModel(spy);
    expect(rig.legs[0].thigh.position.x).toBeLessThan(0);
    expect(rig.legs[1].thigh.position.x).toBeGreaterThan(0);
    expect(rig.arms[0].position.x).toBeLessThan(0);
    expect(rig.arms[1].position.x).toBeGreaterThan(0);
  });
});

describe("animateCourier", () => {
  it("puts each pose value on its joint", () => {
    const { spy } = setup();
    const model = createCourierModel(spy);
    const pose = createPose();
    Object.assign(pose, { hipsY: -0.2, hipsRoll: 0.05, squash: -0.1, torsoPitch: -0.15, torsoRoll: 0.08, headPitch: 0.07, headYaw: 0.3 });
    pose.legs[0].hip = 0.5; pose.legs[0].knee = -0.6;
    pose.legs[1].hip = -0.5; pose.legs[1].knee = -0.1;
    pose.arms[0].swing = -0.4; pose.arms[1].swing = 0.4;
    pose.arms[0].spread = 0.2; pose.arms[1].spread = 0.2;
    const restBody = model.rig.body.position.y;
    animateCourier(model, pose, 0);
    const { rig } = model;
    expect(rig.body.position.y).toBeCloseTo(restBody - 0.2, 9);
    expect(rig.body.rotation.z).toBeCloseTo(0.05, 9);
    expect(rig.body.scale.y).toBeCloseTo(0.9, 9);
    expect(rig.body.scale.x).toBeCloseTo(1.05, 9);
    expect(rig.torso.rotation.x).toBeCloseTo(-0.15, 9);
    expect(rig.torso.rotation.z).toBeCloseTo(0.08, 9);
    expect(rig.head.rotation.x).toBeCloseTo(0.07, 9);
    expect(rig.head.rotation.y).toBeCloseTo(0.3, 9);
    expect(rig.legs[0].thigh.rotation.x).toBeCloseTo(0.5, 9);
    expect(rig.legs[0].shin.rotation.x).toBeCloseTo(-0.6, 9);
    expect(rig.legs[1].thigh.rotation.x).toBeCloseTo(-0.5, 9);
    // The ankle takes back most of the leg's tilt, so the boot stays nearly level.
    expect(rig.legs[0].foot.rotation.x).toBeCloseTo(-(0.5 - 0.6) * 0.85, 9);
    expect(rig.arms[0].rotation.x).toBeCloseTo(-0.4, 9);
    // Spread swings each arm outward: the left (at -X) by a negative z turn, the right by a positive one.
    expect(rig.arms[0].rotation.z).toBeCloseTo(-0.2, 9);
    expect(rig.arms[1].rotation.z).toBeCloseTo(0.2, 9);
  });

  it("swings a leg forward (toward -Z) with a positive hip angle and folds the foot back with a bent knee", () => {
    const { spy } = setup();
    const model = createCourierModel(spy);
    const foot = (pose: ReturnType<typeof createPose>) => {
      animateCourier(model, pose, 0);
      model.group.updateMatrixWorld(true);
      const shin = model.rig.legs[0].shin;
      return new THREE.Box3().setFromObject(shin).getCenter(new THREE.Vector3());
    };
    const rest = foot(createPose());
    const forward = createPose();
    forward.legs[0].hip = 0.6;
    expect(foot(forward).z).toBeLessThan(rest.z - 0.3);
    const bent = createPose();
    bent.legs[0].knee = -1;
    expect(foot(bent).z).toBeGreaterThan(rest.z + 0.2);
  });

  it("keeps the feet out of the ground through a running stride", () => {
    const { spy } = setup();
    const model = createCourierModel(spy);
    const gait = createGait();
    const pose = createPose();
    let lowest = Infinity;
    for (let i = 0; i < 240; i += 1) {
      updateGait(gait, { dt: 1 / 60, distance: 18 / 60, speed: 18, heading: 0, y: 0, reduced: false });
      animateCourier(model, gaitPose(gait, pose), 0);
      model.group.updateMatrixWorld(true);
      for (const leg of model.rig.legs) lowest = Math.min(lowest, new THREE.Box3().setFromObject(leg.thigh, true).min.y);
    }
    expect(lowest).toBeGreaterThan(-0.05);
  });

  it("turns the key a quarter turn per tick, in whole ticks under reduced motion", () => {
    const { spy } = setup();
    const model = createCourierModel(spy);
    animateCourier(model, createPose(), 0);
    expect(model.key.rotation.z).toBeCloseTo(0, 9);
    animateCourier(model, createPose(), 1);
    expect(model.key.rotation.z).toBeCloseTo(Math.PI / 2, 9);
    animateCourier(model, createPose(), 2.5);
    expect(model.key.rotation.z).toBeCloseTo(2.5 * Math.PI / 2, 9);
    animateCourier(model, createPose(), 2.5, true);
    expect(model.key.rotation.z).toBeCloseTo(Math.PI, 9);
  });
});

describe("courier rig", () => {
  it("centres the key on its turning axis", () => {
    const { spy } = setup();
    const { key } = createCourierModel(spy);
    const geometry = (key as THREE.Mesh).geometry;
    geometry.computeBoundingBox();
    const center = (geometry.boundingBox as THREE.Box3).getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
  });

  it("disposes geometries but never materials", () => {
    const { palette, spy } = setup();
    const { group } = createCourierModel(spy);
    const geometries = meshesOf(group).map((m) => m.geometry);
    let geometryDisposed = 0;
    let materialDisposed = 0;
    geometries.forEach((g) => g.addEventListener("dispose", () => { geometryDisposed++; }));
    for (const key of ALLOWED) palette.get(key).addEventListener("dispose", () => { materialDisposed++; });
    disposeModel(group);
    expect(geometryDisposed).toBe(geometries.length);
    expect(materialDisposed).toBe(0);
  });

  it("builds after a fully populated town palette without creating materials or running out of ids", () => {
    const city = buildCity();
    const created = () => (city.palette as unknown as { created: number }).created;
    const before = created();
    expect(() => {
      createCourierModel(city.palette);
      createBeacon(city.palette);
    }).not.toThrow();
    expect(created()).toBe(before);
  });
});

describe("diamond", () => {
  it("has flat normals matching each face's cross product", () => {
    const { spy } = setup();
    const beacon = createBeacon(spy);
    const diamond = beacon.getObjectByName("diamond") as THREE.Mesh;
    const geometry = diamond.geometry;
    const pos = geometry.getAttribute("position");
    const nor = geometry.getAttribute("normal");
    expect(pos.count % 3).toBe(0);
    const [a, b, c, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      const face = b.sub(a).cross(c.sub(a)).normalize();
      for (let v = 0; v < 3; v++) {
        n.fromBufferAttribute(nor, i + v);
        expect(n.dot(face)).toBeGreaterThan(0.999);
      }
    }
  });
});

describe("beacon", () => {
  it("uses at most 2 shared illustrated meshes and a ring of about radius 7", () => {
    const { palette, spy, requested } = setup();
    const beacon = createBeacon(spy);
    for (const key of requested) expect(ALLOWED).toContain(key);
    const meshes = meshesOf(beacon);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThanOrEqual(2);
    const shared = new Set<THREE.Material>(ALLOWED.map((k) => palette.get(k)));
    for (const mesh of meshes) {
      expect(mesh.material).toBeInstanceOf(THREE.ShaderMaterial);
      expect((mesh.material as THREE.ShaderMaterial).fragmentShader).toContain("location = 1");
      expect(shared.has(mesh.material as THREE.Material)).toBe(true);
    }
    beacon.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(beacon);
    expect(box.max.x).toBeGreaterThan(6.5);
    expect(box.max.x).toBeLessThan(7.5);
    expect(box.min.x).toBeLessThan(-6.5);
  });

  it("hovers and spins when motion is allowed", () => {
    const { spy } = setup();
    const beacon = createBeacon(spy);
    const before = snapshot(beacon);
    animateBeacon(beacon, 1.3, false);
    expect(snapshot(beacon)).not.toEqual(before);
  });

  it("leaves every transform untouched when reducedMotion is true", () => {
    const { spy } = setup();
    const beacon = createBeacon(spy);
    const before = snapshot(beacon);
    animateBeacon(beacon, 1.3, true);
    animateBeacon(beacon, 99, true);
    expect(snapshot(beacon)).toEqual(before);
  });

  it("throws a clear error when the float child is missing", () => {
    expect(() => animateBeacon(new THREE.Group(), 1, false)).toThrow(/beaconFloat/);
  });

  it("does not move the position the caller placed the beacon at", () => {
    const { spy } = setup();
    const beacon = createBeacon(spy);
    beacon.position.set(10, 20, 30);
    animateBeacon(beacon, 2.1, false);
    expect(beacon.position.toArray()).toEqual([10, 20, 30]);
  });
});
