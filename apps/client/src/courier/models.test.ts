import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildCity } from "../city/buildCity";
import { Palette } from "../city/kit";
import { animateBeacon, animateCourier, createBeacon, createCourierModel, disposeModel } from "./models";
import { createGait, createPose, gaitPose, updateGait } from "./gait";
import { COURIER_LOOK, createFigure, createFigureMaterial, createFigurePose, poseFigure, type FigureLook } from "./figure";
import { createResidentAgents, residentLook } from "../city/residents";
import { createHumanGait, humanPose, updateHumanGait } from "./humanGait";
import { COURIER_HEIGHT } from "./size";
import { WALK } from "./walker";

const ALLOWED = ["wall0", "copper", "ink", "water", "brass"] as const;

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

describe("human London courier", () => {
  const model = () => createCourierModel(setup().spy, true);
  /** The figure's vertices where its bones put them now (skinned, in the model's space). */
  const skinned = (mesh: THREE.SkinnedMesh, filter: (i: number) => boolean = () => true) => {
    mesh.updateMatrixWorld(true);
    mesh.skeleton.update();
    const position = mesh.geometry.getAttribute("position");
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < position.count; i += 1) {
      if (!filter(i)) continue;
      const v = new THREE.Vector3().fromBufferAttribute(position, i);
      mesh.applyBoneTransform(i, v);
      out.push(v.applyMatrix4(mesh.matrixWorld));
    }
    return out;
  };
  const garment = (mesh: THREE.SkinnedMesh) => {
    const shift = mesh.geometry.getAttribute("idShift");
    const base = Math.min(...Array.from(shift.array as Float32Array));
    const step = 0.0062;
    return (i: number) => Math.round((shift.getX(i) - base) / step);
  };
  const HAIR = 1, SHOES = 7, STRAP = 9;

  it("is one skinned, outlined girl with the reference character's cute proportions, not a chibi's", () => {
    const { group, figure, key } = model();
    expect(figure).toBeDefined();
    const meshes = meshesOf(group);
    expect(meshes).toHaveLength(1);
    const mesh = meshes[0] as THREE.SkinnedMesh;
    expect(mesh).toBeInstanceOf(THREE.SkinnedMesh);
    const material = mesh.material as THREE.ShaderMaterial;
    expect(Object.keys(material.defines ?? {})).toEqual(expect.arrayContaining(["ILLUSTRATED_CHARACTER", "ILLUSTRATED_VERTEX_COLORS", "ILLUSTRATED_WORLD"]));
    expect(material.fragmentShader).toContain("location = 1");
    const points = skinned(mesh);
    const bounds = new THREE.Box3().setFromPoints(points);
    const height = bounds.max.y - bounds.min.y;
    // Short: about 1.5 m against a 6-unit (2.8 m) storey, the height the camera and pace are scaled to (size.ts).
    expect(Math.abs(height - COURIER_HEIGHT)).toBeLessThan(0.03);
    expect(Math.abs(figure!.height - COURIER_HEIGHT)).toBeLessThan(0.001);
    expect(height).toBeLessThan(3.4);
    expect(Math.abs(bounds.min.y)).toBeLessThan(0.02);
    // Stubby and cute, as the reference's character is: a big head (about 4.2 heads tall) on short legs, but not a
    // chibi's 3 heads. The chin is the lowest point of the face (skin, in front, above the hands).
    const isSkin = garment(mesh);
    const position = mesh.geometry.getAttribute("position");
    let chin = Infinity;
    points.forEach((p, i) => {
      if (isSkin(i) === 0 && position.getZ(i) < -0.12 && p.y > 0.6 * height) chin = Math.min(chin, p.y);
    });
    const heads = height / (bounds.max.y - chin);
    expect(heads).toBeGreaterThan(3.8);
    expect(heads).toBeLessThan(4.6);
    const legs = figure!.bones.thigh[0].getWorldPosition(new THREE.Vector3()).y / height;
    expect(legs).toBeGreaterThan(0.38);
    expect(legs).toBeLessThan(0.46);
    // Each garment is its own outlined surface; the whole person stays a modest mesh.
    expect(new Set(Array.from(mesh.geometry.getAttribute("idShift").array as Float32Array)).size).toBeGreaterThanOrEqual(10);
    expect((mesh.geometry.getIndex()?.count ?? 0) / 3).toBeLessThan(12000);
    expect(key.visible).toBe(false);
    expect(group.getObjectByName("boiler")).toBeUndefined();
  });

  it("bends smoothly at the joints: weights sum to one and blend across knees and elbows", () => {
    const mesh = meshesOf(model().group)[0] as THREE.SkinnedMesh;
    const weights = mesh.geometry.getAttribute("skinWeight");
    let blended = 0;
    for (let i = 0; i < weights.count; i += 1) {
      const sum = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
      expect(sum).toBeCloseTo(1, 5);
      if (weights.getX(i) > 0.05 && weights.getY(i) > 0.05) blended += 1;
    }
    expect(blended).toBeGreaterThan(150);
  });

  it("keeps its soles on the ground through walking, jogging and running, and lifts them in the swing", () => {
    const { group, figure } = model();
    const mesh = figure!.mesh;
    const isShoe = garment(mesh);
    for (const speed of [2.2, WALK.walkSpeed, WALK.runSpeed]) {
      const gait = createHumanGait();
      let lowestEver = Infinity, highestSupport = -Infinity, highestSwing = -Infinity;
      for (let frame = 0; frame < 180; frame += 1) {
        updateHumanGait(gait, { dt: 1 / 60, distance: speed / 60, speed, heading: 0, y: 0, reduced: false, pace: figure!.pace, leg: figure!.leg });
        poseFigure(figure!, humanPose(gait, createFigurePose(), figure!.leg));
        if (frame < 120 || frame % 4) continue;
        group.updateMatrixWorld(true);
        const soles = [0, 1].map((side) => {
          const points = skinned(mesh, (i) => isShoe(i) === SHOES && Math.sign(mesh.geometry.getAttribute("position").getX(i)) === (side ? 1 : -1));
          return Math.min(...points.map((p) => p.y));
        });
        lowestEver = Math.min(lowestEver, ...soles);
        highestSupport = Math.max(highestSupport, Math.min(...soles));
        highestSwing = Math.max(highestSwing, Math.max(...soles));
      }
      expect(lowestEver, `speed ${speed}`).toBeGreaterThan(-0.06);
      // Walking, a foot is always down; jogging and running float only briefly, a hand's breadth at most.
      expect(highestSupport, `speed ${speed}`).toBeLessThan(speed < 3 ? 0.06 : 0.3);
      // The swing lifts the foot clear, a hand's breadth or more (scaled to her size when jogging and running).
      expect(highestSwing, `speed ${speed}`).toBeGreaterThan(speed < 3 ? 0.15 : 0.3 * figure!.pace);
    }
  });

  it("swings each arm forward with the opposite leg", () => {
    const { figure } = model();
    const gait = createHumanGait();
    for (let i = 0; i < 120; i += 1) updateHumanGait(gait, { dt: 1 / 60, distance: WALK.walkSpeed / 60, speed: WALK.walkSpeed, heading: 0, y: 0, reduced: false, pace: figure!.pace, leg: figure!.leg });
    // Late in the left leg's swing it reaches forward while the right leg pushes back.
    gait.phase = 0.82;
    poseFigure(figure!, humanPose(gait, createFigurePose(), figure!.leg));
    figure!.group.updateMatrixWorld(true);
    const z = (bone: THREE.Object3D) => bone.getWorldPosition(new THREE.Vector3()).z;
    // Forward is -Z: the left foot leads, so the right hand does.
    expect(z(figure!.bones.foot[0])).toBeLessThan(z(figure!.bones.foot[1]) - 0.8);
    expect(z(figure!.bones.hand[1])).toBeLessThan(z(figure!.bones.hand[0]) - 0.3);
  });

  it("wears its satchel strap outside the jacket, across the chest, and across the back under her long hair", () => {
    const { figure } = model();
    const mesh = figure!.mesh;
    mesh.updateMatrixWorld(true);
    const isGarment = garment(mesh);
    const index = mesh.geometry.getIndex()!;
    // Across the chest and the back of her short trunk.
    for (const side of [-1, 1]) for (const [x, y] of [[0.05, 2.22], [-0.18, 1.91]]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, y, side * 3), new THREE.Vector3(0, 0, -side));
      const hits = ray.intersectObject(mesh);
      expect(hits[0], `${side} ${x},${y}`).toBeDefined();
      const worn = hits.map((hit) => isGarment(index.getX(hit.faceIndex! * 3)));
      if (side < 0) {
        // In front, the strap is the first thing the eye meets.
        expect(worn[0], `${side} ${x},${y}`).toBe(STRAP);
      } else {
        // Behind, her hair falls over it; under the hair, the strap still lies outside the jumper.
        expect(worn[0], `${side} ${x},${y}`).toBe(HAIR);
        expect(worn.find((g) => g !== HAIR), `${side} ${x},${y}`).toBe(STRAP);
      }
    }
  });

  it("holds one calm pose under reduced motion", () => {
    const { figure } = model();
    const gait = createHumanGait();
    const bones = () => {
      figure!.group.updateMatrixWorld(true);
      return figure!.mesh.skeleton.bones.map((bone) => bone.matrixWorld.elements.map((e) => e.toFixed(6)).join(","));
    };
    updateHumanGait(gait, { dt: 1 / 60, distance: 0.2, speed: 12, heading: 0, y: 0, reduced: true });
    poseFigure(figure!, humanPose(gait, createFigurePose(), figure!.leg));
    const before = bones();
    for (let i = 0; i < 90; i += 1) updateHumanGait(gait, { dt: 1 / 60, distance: 0.2, speed: 12, heading: i * 0.01, y: 0, reduced: true });
    poseFigure(figure!, humanPose(gait, createFigurePose(), figure!.leg));
    expect(bones()).toEqual(before);
  });

  it("disposes its own figure material and bones, never the shared palette", () => {
    const { palette, spy } = setup();
    const { group, figure } = createCourierModel(spy, true);
    const material = figure!.mesh.material as THREE.Material;
    let disposed = 0;
    material.addEventListener("dispose", () => { disposed += 1; });
    disposeModel(group);
    expect(disposed).toBe(1);
    expect(palette.get("ink").userData.ownedByModel).toBeUndefined();
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

describe("drawn faces, the reference's way", () => {
  const material = createFigureMaterial();
  const SKIN = 0, HAIR = 1, EYES = 10, CAP = 11;
  const build = (look: FigureLook) => {
    const figure = createFigure({ ...look, scale: 1 }, material);
    const geometry = figure.mesh.geometry;
    const position = geometry.getAttribute("position");
    const shift = geometry.getAttribute("idShift");
    const base = Math.min(...Array.from(shift.array as Float32Array));
    const garment = (i: number) => Math.round((shift.getX(i) - base) / 0.0062);
    return { figure, position, garment };
  };
  const residents = createResidentAgents().map((agent, index) => residentLook(agent, index));

  it("paints every resident's features flush: no bump of a nose, no ball eyes", () => {
    expect(residents.length).toBeGreaterThan(10);
    for (const [index, look] of residents.entries()) {
      const { position, garment } = build(look);
      // The frontmost point of the face between the chin and the hairline, hair and a cap's peak aside.
      let front = Infinity;
      for (let i = 0; i < position.count; i += 1) {
        const y = position.getY(i);
        if (y < 3.22 || y > 3.56 || Math.abs(position.getX(i)) > 0.15 || garment(i) === HAIR || garment(i) === CAP) continue;
        front = Math.min(front, position.getZ(i));
      }
      // The face itself comes to about -0.2; drawn features add only a few millimetres.
      expect(front, `resident ${index}`).toBeGreaterThan(-0.215);
      expect(front, `resident ${index}`).toBeLessThan(-0.19);
    }
  });

  it("covers every crown: hair (or a cap) down to a hairline above the brow, never a bare scalp", () => {
    for (const [index, look] of residents.entries()) {
      const { figure, garment } = build(look);
      figure.group.updateMatrixWorld(true);
      const hits = new THREE.Raycaster(new THREE.Vector3(0, 3.68, -3), new THREE.Vector3(0, 0, 1)).intersectObject(figure.mesh);
      expect(hits[0], `resident ${index}`).toBeDefined();
      const first = garment(figure.mesh.geometry.getIndex()!.getX(hits[0]!.faceIndex! * 3));
      expect([HAIR, CAP], `resident ${index} (${look.hairStyle})`).toContain(first);
    }
  });

  it("gives the courier a calm anime face: half-lidded eyes and brows drawn flush, no blush", () => {
    const { figure, position, garment } = build(COURIER_LOOK);
    const s = COURIER_LOOK.head ?? 1;
    let front = Infinity, eyes = 0, pink = 0;
    const color = figure.mesh.geometry.getAttribute("color");
    for (let i = 0; i < position.count; i += 1) {
      const g = garment(i);
      if (position.getY(i) < 0.8 * figure.height || Math.abs(position.getX(i)) > 0.18 * s) continue;
      if (g === EYES) eyes += 1;
      if (g !== SKIN && g !== EYES) continue;
      front = Math.min(front, position.getZ(i));
      // Blush would be a light, saturated pink on the cheeks (colours are linear: skin keeps green at about 0.7 of red).
      const r = color.getX(i), gr = color.getY(i);
      if (g === SKIN && r > 0.6 && gr / r < 0.55) pink += 1;
    }
    expect(eyes).toBeGreaterThan(100);
    expect(front).toBeGreaterThan(-0.215 * s);
    expect(pink).toBe(0);
  });
});

