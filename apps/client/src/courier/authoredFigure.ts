import * as THREE from "three";
import { AUTHORED_GEOMETRIES, AUTHORED_IDLE_POSE, AUTHORED_RIG, type AuthoredGeometryName } from "./authoredAssets";
import { COURIER_LOOK, createFigure, createFigurePose, poseFigure, type Figure, type FigureBones, type LegDimensions } from "./figure";
import { COURIER_HEIGHT, FITTED_HEIGHT } from "./size";
import { WALK } from "./walker";

const PARTS: readonly AuthoredGeometryName[] = ["base", "hair3", "top2", "bottom2", "shoes3"];
const ATTRIBUTES = ["position", "normal", "uv", "surfaceId", "skinIndex", "skinWeight"] as const;

/** Preserve the source's indexed topology, palette UVs, normals and garment IDs. */
function mergedAvatarGeometry(): THREE.BufferGeometry {
  const arrays = Object.fromEntries(ATTRIBUTES.map((name) => [name, [] as number[]])) as Record<(typeof ATTRIBUTES)[number], number[]>;
  const indices: number[] = [], slots: number[] = [];
  let offset = 0;
  for (let slot = 0; slot < PARTS.length; slot += 1) {
    const source = AUTHORED_GEOMETRIES[PARTS[slot]!];
    const count = source.attributes.position.array.length / 3;
    const kneeY = AUTHORED_RIG.bones[15]!.worldPosition[1]!;
    const hipY = AUTHORED_RIG.bones[14]!.worldPosition[1]!;
    const hemY = AUTHORED_GEOMETRIES.shoes3.bounds.max[1]! - 0.035;
    const lowerLegStretch = (kneeY - hemY) / (kneeY - source.bounds.min[1]!);
    const trouserWidth = (y: number) => {
      const u = THREE.MathUtils.clamp((hipY - y) / (hipY - kneeY), 0, 1);
      return { scale: 1 - 0.25 * u * u * (3 - 2 * u), derivative: 0.25 * 6 * u * (1 - u) / (hipY - kneeY) };
    };
    const thighCenter = (x: number) => x === 0 ? 0 : AUTHORED_RIG.bones[x > 0 ? 14 : 18]!.worldPosition[0]!;
    for (const name of ATTRIBUTES) {
      const values = source.attributes[name].array;
      for (let i = 0; i < values.length; i += 1) {
        let value = values[i]!;
        if (source.name === "bottom2" && name === "position" && i % 3 === 0) {
          const width = trouserWidth(values[i + 1]!);
          const center = thighCenter(value);
          value = center + (value - center) * width.scale;
        }
        if (source.name === "bottom2" && name === "position" && i % 3 === 1 && value < kneeY) {
          // Lengthen the cropped source trousers into jeans without moving the
          // knee rows or the skin's actual joint pivots.
          value = kneeY + (value - kneeY) * lowerLegStretch;
        }
        arrays[name].push(name === "skinIndex" ? Math.round(value) : value);
      }
      if (source.name === "bottom2" && name === "normal") {
        // Use the narrowing/stretch Jacobian's inverse transpose. The authored
        // facet normals remain distinct, including across the soft hip blend.
        const start = arrays.normal.length - values.length;
        for (let vertex = 0; vertex < count; vertex += 1) {
          const px = source.attributes.position.array[vertex * 3]!, py = source.attributes.position.array[vertex * 3 + 1]!;
          const width = trouserWidth(py);
          const shear = (px - thighCenter(px)) * width.derivative;
          const at = start + vertex * 3;
          const x = arrays.normal[at]! / width.scale;
          const y = (arrays.normal[at + 1]! - shear * x) / (py < kneeY ? lowerLegStretch : 1);
          const z = arrays.normal[at + 2]!;
          const length = Math.hypot(x, y, z) || 1;
          arrays.normal[at] = x / length;
          arrays.normal[at + 1] = y / length;
          arrays.normal[at + 2] = z / length;
        }
      }
    }
    for (let i = 0; i < source.indices.length; i += 3) {
      const triangle = source.indices.slice(i, i + 3);
      // These disconnected base shins/socks/feet sit inside the full jeans and
      // shoes. Removing covered triangles prevents pale surfaces clipping out.
      if (source.name === "base" && triangle.every((index) => source.attributes.position.array[index * 3 + 1]! < 0.6)) continue;
      for (const index of triangle) indices.push(offset + index);
    }
    for (let i = 0; i < count; i += 1) slots.push(slot);
    offset += count;
  }
  const geometry = new THREE.BufferGeometry();
  for (const name of ATTRIBUTES) {
    const itemSize = AUTHORED_GEOMETRIES.base.attributes[name].itemSize;
    const values = arrays[name];
    geometry.setAttribute(name, name === "skinIndex" ? new THREE.Uint16BufferAttribute(values, itemSize) : new THREE.Float32BufferAttribute(values, itemSize));
  }
  geometry.setAttribute("partSlot", new THREE.Float32BufferAttribute(slots, 1));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(offset * 3).fill(1), 3));
  geometry.setAttribute("sway", new THREE.Float32BufferAttribute(new Float32Array(offset), 1));
  geometry.setAttribute("idShift", new THREE.Float32BufferAttribute(arrays.surfaceId.map((id) => id * 0.7), 1));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** The shoe's lower convex profile, expressed as forward/up offsets from the ankle. */
function soleProfile(ankle: THREE.Vector3): LegDimensions["sole"] {
  const positions = AUTHORED_GEOMETRIES.shoes3.attributes.position.array;
  const unique = new Map<string, [number, number]>();
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i]! < 0) continue;
    const point: [number, number] = [positions[i + 2]! - ankle.z, positions[i + 1]! - ankle.y];
    unique.set(`${point[0].toFixed(6)},${point[1].toFixed(6)}`, point);
  }
  const points = [...unique.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const hull: [number, number][] = [];
  const cross = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (const point of points) {
    while (hull.length > 1 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, point) <= 0) hull.pop();
    hull.push(point);
  }
  return hull;
}

/** Original modular avatar, animated by the existing Figure/humanGait pose contract. */
export function createAuthoredFigure(material: THREE.ShaderMaterial): Figure {
  const geometry = mergedAvatarGeometry();
  const bounds = geometry.boundingBox!;
  const floor = bounds.min.y;
  const referenceHeight = bounds.max.y - floor;
  const scale = COURIER_HEIGHT / referenceHeight;
  const bones = AUTHORED_RIG.bones.map((source) => {
    const bone = new THREE.Bone();
    bone.name = source.name;
    bone.position.fromArray(source.position);
    bone.quaternion.fromArray(source.quaternion).normalize();
    bone.scale.fromArray(source.scale);
    return bone;
  });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = "authoredCourier";
  for (const source of AUTHORED_RIG.bones) {
    (source.parent < 0 ? mesh : bones[source.parent]!).add(bones[source.index]!);
  }
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  mesh.normalizeSkinWeights();
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const restWorld = bones.map((bone) => bone.getWorldQuaternion(new THREE.Quaternion()));
  const restPositions = bones.map((bone) => bone.position.clone());
  const restScales = bones.map((bone) => bone.scale.clone());
  const thigh = new THREE.Vector3().fromArray(AUTHORED_RIG.bones[14]!.worldPosition);
  const knee = new THREE.Vector3().fromArray(AUTHORED_RIG.bones[15]!.worldPosition);
  const ankle = new THREE.Vector3().fromArray(AUTHORED_RIG.bones[16]!.worldPosition);
  const leg: LegDimensions = {
    hip: thigh.y - floor,
    thigh: thigh.distanceTo(knee),
    shin: knee.distanceTo(ankle),
    walkKneeLift: 14.75 * Math.PI / 180,
    ankle: ankle.y - floor,
    sole: soleProfile(ankle),
    strideTargets: { jog: 0.871212 * WALK.walkSpeed / scale, run: 0.871212 * WALK.runSpeed / scale },
    translationScale: referenceHeight / FITTED_HEIGHT,
  };

  // Capture the idle arm chains on the unchanged rest torso, so the relaxed A-pose
  // adjustment contributes no authored idle lean, pelvis shift or leg motion.
  for (let i = 6; i <= 13; i += 1) {
    const idle = AUTHORED_IDLE_POSE.bones[i]!;
    bones[i]!.position.fromArray(idle.position);
    bones[i]!.quaternion.fromArray(idle.quaternion).normalize();
    bones[i]!.scale.fromArray(idle.scale);
    restPositions[i]!.copy(bones[i]!.position);
    restScales[i]!.copy(bones[i]!.scale);
  }
  mesh.updateMatrixWorld(true);
  const neutralWorld = bones.map((bone, i) => i >= 6 && i <= 13 ? bone.getWorldQuaternion(new THREE.Quaternion()) : restWorld[i]!.clone());
  const neutralPositions = bones.map((bone) => bone.getWorldPosition(new THREE.Vector3()));

  // The original points face +Z. This one fixed authoring transform aligns the
  // runtime's −Z forward convention and places the source shoe sole at y=0.
  const authoringSpace = new THREE.Group();
  authoringSpace.name = "avatarAuthoringSpace";
  authoringSpace.rotation.y = Math.PI;
  authoringSpace.position.y = -floor;
  authoringSpace.add(mesh);
  const group = new THREE.Group();
  group.name = "figureRoot";
  group.scale.setScalar(scale);
  group.add(authoringSpace);

  const eyes = new THREE.Bone(), bag = new THREE.Bone();
  eyes.name = "eyesHelper";
  bag.name = "bagHelper";
  bones[5]!.add(eyes);
  bones[0]!.add(bag);
  const actual: FigureBones = {
    hips: bones[0]!, spine: bones[1]!, chest: bones[3]!, neck: bones[4]!, head: bones[5]!, eyes, bag,
    clavicle: [bones[6]!, bones[10]!], upperArm: [bones[7]!, bones[11]!], foreArm: [bones[8]!, bones[12]!], hand: [bones[9]!, bones[13]!],
    thigh: [bones[14]!, bones[18]!], shin: [bones[15]!, bones[19]!], foot: [bones[16]!, bones[20]!],
  };

  // Use the established Euler/pose API only as a rotation driver. Its generated
  // mesh never enters the scene and its vertex buffers are released immediately.
  const driver = createFigure(COURIER_LOOK, material);
  driver.group.visible = false;
  driver.mesh.geometry.dispose();
  driver.group.updateMatrixWorld(true);
  const db = driver.bones;
  const mapped: THREE.Bone[] = [db.hips, db.spine, db.spine, db.chest, db.neck, db.head,
    db.clavicle[0], db.upperArm[0], db.foreArm[0], db.hand[0], db.clavicle[1], db.upperArm[1], db.foreArm[1], db.hand[1],
    db.thigh[0], db.shin[0], db.foot[0], db.foot[0], db.thigh[1], db.shin[1], db.foot[1], db.foot[1]];
  const driverRestInverse = mapped.map((bone) => bone.getWorldQuaternion(new THREE.Quaternion()).invert());
  const desired = bones.map(() => new THREE.Quaternion());
  const alignment = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const inverseAlignment = alignment.clone().invert();

  // The imported spine's bind positions lean forward even at zero rotation.
  // Align its neutral neck over the pelvis around the first spine pivot, keeping
  // every authored segment length and all hip/leg bind axes unchanged.
  const pelvis = neutralPositions[0]!, spinePivot = neutralPositions[1]!, neutralNeck = neutralPositions[4]!;
  const neckFromSpine = neutralNeck.clone().sub(spinePivot);
  const horizontalSq = (pelvis.x - spinePivot.x) ** 2 + (pelvis.z - spinePivot.z) ** 2;
  const uprightNeck = new THREE.Vector3(pelvis.x, spinePivot.y + Math.sqrt(Math.max(0, neckFromSpine.lengthSq() - horizontalSq)), pelvis.z);
  const uprightSpine = new THREE.Quaternion().setFromUnitVectors(neckFromSpine.normalize(), uprightNeck.sub(spinePivot).normalize());
  for (let i = 1; i <= 13; i += 1) neutralWorld[i]!.premultiply(uprightSpine);

  // An idle clip already contains elbow flex and shoulder abduction. Adding the
  // gait's full flexion to that pose bends twice and shortens the hand swing.
  // Use its twist as the starting frame, then align each segment to the shared
  // driver's neutral segment direction before applying any movement delta.
  for (const [upper, fore, hand] of [[7, 8, 9], [11, 12, 13]] as const) {
    for (const [current, child] of [[upper, fore], [fore, hand]] as const) {
      const referenceDirection = neutralPositions[child]!.clone().sub(neutralPositions[current]!).applyQuaternion(uprightSpine).normalize();
      const driverDirection = mapped[child]!.getWorldPosition(new THREE.Vector3()).sub(mapped[current]!.getWorldPosition(new THREE.Vector3())).applyQuaternion(inverseAlignment).normalize();
      const correction = new THREE.Quaternion().setFromUnitVectors(referenceDirection, driverDirection);
      neutralWorld[current]!.premultiply(correction);
      if (current === fore) neutralWorld[hand]!.premultiply(correction);
    }
  }
  const delta = new THREE.Quaternion(), inverseParent = new THREE.Quaternion();
  const translation = new THREE.Vector3();
  const driverPose = createFigurePose();
  const driverArms = driverPose.arms;
  const applyAuthoredPose = (pose: Parameters<typeof poseFigure>[1]) => {
    Object.assign(driverPose, pose);
    driverPose.motion = pose.motion;
    driverPose.arms = driverArms;
    const motion = pose.motion;
    const armGain = 1 + 1.75 * (motion ? THREE.MathUtils.clamp(motion.move, 0, 1) * (1 - THREE.MathUtils.clamp(motion.air, 0, 1)) : 0);
    const meanSwing = (pose.arms[0].swing + pose.arms[1].swing) * 0.5;
    for (const side of [0, 1] as const) {
      Object.assign(driverArms[side], pose.arms[side]);
      // Source run/sprint upper-arm arcs are about 2.75 times the original
      // procedural arcs. Preserve their shared bias and all elbow motion.
      driverArms[side].swing = meanSwing + (pose.arms[side].swing - meanSwing) * armGain;
    }
    poseFigure(driver, driverPose);
    driver.group.updateMatrixWorld(true);
    for (let i = 0; i < bones.length; i += 1) {
      mapped[i]!.getWorldQuaternion(delta).multiply(driverRestInverse[i]!);
      desired[i]!.copy(inverseAlignment).multiply(delta).multiply(alignment).multiply(neutralWorld[i]!);
      const parent = AUTHORED_RIG.bones[i]!.parent;
      bones[i]!.quaternion.copy(parent < 0 ? desired[i]! : inverseParent.copy(desired[parent]!).invert().multiply(desired[i]!));
      bones[i]!.position.copy(restPositions[i]!);
      bones[i]!.scale.copy(restScales[i]!);
    }
    translation.set(pose.hips.x, pose.hips.y, pose.hips.z).applyQuaternion(inverseAlignment);
    bones[0]!.position.add(translation);
    eyes.scale.set(1, Math.max(0.08, Math.min(1, pose.eyes)), 1);
    bag.rotation.set(pose.bag.pitch, 0, pose.bag.roll);
    if (material.uniforms.uAvatarBlink) material.uniforms.uAvatarBlink.value = pose.eyes < 0.18 ? 2 : pose.eyes < 0.65 ? 1 : -1;
    group.updateMatrixWorld(true);
  };
  const figure: Figure = {
    group, mesh, bones: actual, hipsRest: restPositions[0]!.clone(),
    scale, height: COURIER_HEIGHT, pace: COURIER_HEIGHT / FITTED_HEIGHT, leg,
    eyesRest: eyes.position.clone(), expression: COURIER_LOOK.expression ?? "bright", applyAuthoredPose,
  };
  applyAuthoredPose(createFigurePose());
  return figure;
}
