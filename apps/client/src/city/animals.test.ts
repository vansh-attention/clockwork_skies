import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ANIMAL_CLEARANCE, buildAnimals, createAnimalAgents } from "./animals";
import { Palette } from "./kit";
import { createCityLayout, createHillTownLayout } from "./layout";
import { createHillTownWalkWorld } from "../courier/walkWorld";

const layout = createCityLayout();
const world = createHillTownWalkWorld(layout);
const built = buildAnimals(new Palette(), layout);
const meshes = built.group.children.map((group) => group.children[0] as THREE.SkinnedMesh);

describe("London cats and dogs", () => {
  it("adds two distinct cats and two distinct dogs to the compact plan, without changing legacy fixtures", () => {
    expect(built.agents).toHaveLength(4);
    expect(built.agents.map((animal) => animal.breed)).toEqual(["ginger", "tuxedo", "corgi", "spaniel"]);
    expect(built.agents.filter((animal) => animal.species === "cat")).toHaveLength(2);
    expect(built.agents.filter((animal) => animal.species === "dog")).toHaveLength(2);
    expect(createAnimalAgents(layout)).toEqual(createAnimalAgents(layout));
    const alternate = createCityLayout(7), alternateWorld = createHillTownWalkWorld(alternate);
    const alternatePets = createAnimalAgents(alternate);
    expect(alternatePets).toHaveLength(4);
    for (const pet of alternatePets) expect(alternateWorld.blocked(pet.x, pet.z, ANIMAL_CLEARANCE), pet.id).toBe(false);
    const legacy = buildAnimals(new Palette(), createHillTownLayout());
    expect(legacy.agents).toEqual([]); expect(legacy.group.children).toEqual([]);
    expect(legacy.blocks(0, 0, 1)).toBe(false);
    expect(() => { legacy.update(100, false); legacy.dispose(); }).not.toThrow();
  });

  it("validates the whole idle footprint against buildings, river, kerbs and roads, keeping paws on the drawn floor", () => {
    for (const animal of built.agents) {
      expect(world.blocked(animal.x, animal.z, ANIMAL_CLEARANCE), animal.id).toBe(false);
      expect(world.surfaceAt(animal.x, animal.z)).toEqual({ height: animal.y, walkable: true });
    }
    for (const time of [0, 1.3, 7.7, 22]) {
      built.update(time, false); built.group.updateMatrixWorld(true);
      meshes.forEach((mesh, index) => {
        const agent = built.agents[index]!;
        const point = new THREE.Vector3();
        let minY = Infinity, maxRadius = 0;
        for (let i = 0; i < mesh.geometry.getAttribute("position").count; i += 1) {
          point.fromBufferAttribute(mesh.geometry.getAttribute("position"), i);
          mesh.applyBoneTransform(i, point); point.applyMatrix4(mesh.matrixWorld);
          expect(Number.isFinite(point.x + point.y + point.z)).toBe(true);
          minY = Math.min(minY, point.y);
          maxRadius = Math.max(maxRadius, Math.hypot(point.x - agent.x, point.z - agent.z));
        }
        expect(minY, agent.id).toBeCloseTo(agent.y, 5);
        expect(maxRadius, agent.id).toBeLessThan(ANIMAL_CLEARANCE);
      });
    }
  });

  it("uses four skinned draw calls and one opaque character material compatible with both render attachments", () => {
    const material = meshes[0]!.material as THREE.ShaderMaterial;
    expect(material.defines.ILLUSTRATED_CHARACTER).toBeDefined();
    expect(material.defines.ILLUSTRATED_SOFT_CHARACTER).toBeDefined();
    expect(material.uniforms.uOutline!.value).toBe(0.68);
    expect(material.uniforms.uGrain!.value).toBe(0);
    expect(material.defines.ILLUSTRATED_VERTEX_COLORS).toBeDefined();
    expect(material.defines.ILLUSTRATED_SEE_THROUGH).toBeUndefined();
    expect(material.fragmentShader).toContain("location = 1");
    expect(material.transparent).toBe(false);
    let triangles = 0;
    for (const mesh of meshes) {
      expect(mesh).toBeInstanceOf(THREE.SkinnedMesh); expect(mesh.material).toBe(material);
      expect(mesh.skeleton.bones).toHaveLength(9);
      expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
      const geometry = mesh.geometry;
      const eyes = mesh.skeleton.bones.findIndex((bone) => bone.name === "eyes");
      const indices = geometry.getAttribute("skinIndex"), surfaces = geometry.getAttribute("idShift");
      let paintedEyes = 0;
      for (let vertex = 0; vertex < indices.count; vertex += 1) if (indices.getX(vertex) === eyes) {
        expect(surfaces.getX(vertex)).toBe(0); paintedEyes += 1;
      }
      expect(paintedEyes).toBeGreaterThan(100); // iris/white/glint paint has no separate outline surface
      triangles += geometry.getAttribute("position").count / 3;
      for (const attribute of ["color", "normal", "uv", "skinIndex", "skinWeight", "idShift"]) expect(geometry.getAttribute(attribute).count).toBe(geometry.getAttribute("position").count);
    }
    expect(triangles).toBeLessThan(22000);
  });

  it("gives ears, tails and faces independent gentle idle motion, with a fully deterministic reduced-motion pose", () => {
    const pose = () => meshes.map((mesh) => mesh.skeleton.bones.map((bone) => [...bone.rotation.toArray().slice(0, 3), ...bone.scale.toArray()].join(",")).join(";"));
    built.update(1, false); const before = pose(); built.update(2.2, false);
    pose().forEach((value, index) => expect(value).not.toBe(before[index]));
    built.update(20, true); const held = pose(); built.update(60, true);
    expect(pose()).toEqual(held);
    for (const mesh of meshes) for (const bone of mesh.skeleton.bones) expect(bone.scale.x * bone.scale.y * bone.scale.z).toBeGreaterThan(0);
  });

  it("has solid pet bodies without making their swept tails into invisible walls", () => {
    built.update(0, false);
    for (const animal of built.agents) {
      expect(built.blocks(animal.x, animal.z, 0.2)).toBe(true);
      expect(built.blocks(animal.x + 1.3, animal.z, 0.1)).toBe(false);
    }
    built.update(1, false, new THREE.Vector3(10000, 0, 10000));
    expect(built.group.children.every((animal) => !animal.visible)).toBe(true);
    built.update(1, false);
    expect(built.group.children.every((animal) => animal.visible)).toBe(true);
  });

  it("releases bone textures on disposal while leaving geometry/material ownership with the scene", () => {
    const separate = buildAnimals(new Palette(), layout);
    let disposedGeometry = 0, disposedMaterial = 0;
    for (const animal of separate.group.children) {
      const mesh = animal.children[0] as THREE.SkinnedMesh;
      mesh.skeleton.computeBoneTexture();
      mesh.geometry.addEventListener("dispose", () => { disposedGeometry += 1; });
    }
    const material = (separate.group.children[0]!.children[0] as THREE.SkinnedMesh).material as THREE.Material;
    material.addEventListener("dispose", () => { disposedMaterial += 1; });
    separate.dispose();
    expect(disposedGeometry).toBe(0); expect(disposedMaterial).toBe(0);
    for (const animal of separate.group.children) {
      const mesh = animal.children[0] as THREE.SkinnedMesh;
      expect(mesh.skeleton.boneTexture).toBeNull(); expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(0);
    }
  });
});
