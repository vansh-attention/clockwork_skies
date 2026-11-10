import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createCityLayout, createStreetFurniture, districtAt } from "./layout";
import { buildCity } from "./buildCity";
import { createHillTownWalkWorld } from "../courier/walkWorld";
import { createHomeCameraWorld } from "../courier/cameraWorld";
import { riverAt } from "./londonPlan";
import { createCourierModel } from "../courier/models";
import { Batch, Palette } from "./kit";
import { chooseIslandSpawn } from "../courier/CourierController";
import { FRONT_AREA, nearestStreet } from "./londonPlan";
import { LONDON_SURFACE, buildLondonStreetNetwork } from "./londonTerrain";
import { frontageApron } from "./londonDetails";

const layout = createCityLayout();
const world = createHillTownWalkWorld(layout);
const plan = layout.plan!;

describe("the default compact London island", () => {
  it("has independent streets, London frontages and a through-river rather than a radial Clockwork town", () => {
    expect(plan.radius).toBeLessThanOrEqual(200);
    expect(layout.stairs).toEqual([]);
    expect(layout.houses.length).toBeGreaterThanOrEqual(60);
    expect(layout.landmarks).toHaveLength(8);
    expect(plan.streets.length).toBeGreaterThan(20);
    expect(plan.bridges).toHaveLength(3);
    expect(plan.river.points[0]!.x).toBeLessThan(-170);
    expect(plan.river.points.at(-1)!.x).toBeGreaterThan(170);
    for (const house of layout.houses) {
      expect(house.rotation).toBeTypeOf("number");
      expect(house.y).toBe(0);
      expect(world.blocked(house.x, house.z, 0.2)).toBe(true);
      expect(Math.hypot(house.x, house.z)).toBeLessThan(plan.radius - 8);
      expect(riverAt(house.x, house.z, plan).distance).toBeGreaterThan(plan.river.halfWidth + house.depth / 2);
    }
    layout.landmarks.forEach((site, i) => expect(districtAt(site.x, site.z)).toBe(i));
  });

  it("removes all clockwork geometry and keeps every rendered surface compatible with the painted renderer", () => {
    const city = buildCity(layout);
    expect(city.group.name).toBe("Little London island");
    expect(city.faces).toHaveLength(0);
    expect(city.spinners).toHaveLength(0);
    expect(city.anchor).toBeNull();
    let calls = 0;
    city.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      calls += 1;
      expect(object.material).toBeInstanceOf(THREE.ShaderMaterial);
      expect((object.material as THREE.ShaderMaterial).fragmentShader).toContain("location = 1");
      // Overlapping scenery is resolved by depth, never by a camera-dependent hole in shared foliage.
      const material = object.material as THREE.ShaderMaterial;
      expect(material.defines.ILLUSTRATED_SEE_THROUGH).toBeUndefined();
      expect(material.transparent).toBe(false);
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(true);
    });
    expect(calls).toBeLessThan(40);
    // The removed tower must not survive as an invisible camera/walker obstacle in the square.
    expect(world.blocked(0, 0, 1.5)).toBe(false);
    expect(createHomeCameraWorld(world, layout).clearFraction({ x: 0, y: 2, z: 0 }, { x: 0, y: 12, z: 0 })).toBe(1);
  });

  it("supports every bridge continuously and keeps the whole walking body away from water and the shore", () => {
    for (const bridge of plan.bridges) {
      for (let d = -bridge.length / 2 + 2; d <= bridge.length / 2 - 2; d += 0.25) {
        const x = bridge.x + Math.cos(bridge.rotation) * d;
        const z = bridge.z - Math.sin(bridge.rotation) * d;
        expect(world.surfaceAt(x, z).walkable).toBe(true);
        expect(world.blocked(x, z, 1.5), `${bridge.id} at ${d}`).toBe(false);
      }
    }
    for (const point of plan.river.points.slice(1, -1)) {
      if (plan.bridges.some((b) => Math.hypot(b.x - point.x, b.z - point.z) < b.length)) continue;
      expect(world.surfaceAt(point.x, point.z).walkable).toBe(false);
      expect(world.blocked(point.x, point.z, 1.5)).toBe(true);
    }
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) expect(world.blocked(Math.cos(a) * (plan.radius - 6), Math.sin(a) * (plan.radius - 6), 1.5)).toBe(true);
  });

  it("connects all London neighbourhood approaches with real body-clear routes", () => {
    // Flood the real collision world with a 1.5-unit body, not a simplified street graph.
    const step = 1;
    const limit = Math.ceil(plan.radius / step);
    const width = limit * 2 + 1;
    const seen = new Set<number>();
    const key = (x: number, z: number) => (x + limit) * width + z + limit;
    const free = (x: number, z: number) => world.surfaceAt(x * step, z * step).walkable && !world.blocked(x * step, z * step, 1.5);
    const queue: [number, number][] = [[0, 0]];
    seen.add(key(0, 0));
    for (let head = 0; head < queue.length; head += 1) {
      const [x, z] = queue[head]!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx!; const nz = z + dz!;
        if (Math.abs(nx) > limit || Math.abs(nz) > limit || seen.has(key(nx, nz)) || !free(nx, nz)) continue;
        if (world.blocked((x + nx) * step / 2, (z + nz) * step / 2, 1.5)) continue;
        seen.add(key(nx, nz)); queue.push([nx, nz]);
      }
    }
    for (const site of layout.landmarks) {
      expect(queue.some(([x, z]) => Math.hypot(x * step - site.x, z * step - site.z) < Math.max(6, site.clearRadius + 3)), `district ${site.district} is isolated`).toBe(true);
    }
    expect(createStreetFurniture(layout).some((item) => item.kind === "bus")).toBe(true);
  });

  it("uses an ordinary clothed walker with no visible key, clock dial or boiler", () => {
    const person = createCourierModel(new Palette(), true);
    expect(person.rig.key.visible).toBe(false);
    expect(person.group.getObjectByName("trim")).toBeUndefined();
    expect(person.group.getObjectByName("boiler")).toBeUndefined();
    expect(person.group.getObjectByName("visor")).toBeUndefined();
    // A skinned person: one figure mesh, with a head, two arms and two legs on its skeleton.
    expect(person.figure?.mesh).toBeInstanceOf(THREE.SkinnedMesh);
    const figure = person.figure!;
    expect(figure.mesh.skeleton.bones).toEqual(expect.arrayContaining([
      figure.bones.head, ...figure.bones.hand, ...figure.bones.foot,
    ]));
  });

  it("starts on a connected pavement with seven clear metres ahead, rather than behind a house", () => {
    const spawn = chooseIslandSpawn(layout, world);
    const street = nearestStreet(spawn.x, spawn.z, plan)!;
    expect(street.distance).toBeGreaterThan(street.street.width / 2);
    expect(street.distance).toBeLessThan(street.street.width / 2 + street.street.pavement);
    for (let d = 0; d <= 7; d += 0.2) {
      const x = spawn.x + Math.sin(spawn.heading) * d;
      const z = spawn.z - Math.cos(spawn.heading) * d;
      expect(world.blocked(x, z, 1.5)).toBe(false);
      expect(world.surfaceAt(x, z).walkable).toBe(true);
    }
  });

  it("renders a continuous paved connection from every front door and shop to its owning street", () => {
    const batch = new Batch();
    buildLondonStreetNetwork(batch, plan);
    const group = new THREE.Group();
    const meshes = batch.build(new Palette(), group);
    const pavement = group.getObjectByName("paving") as THREE.Mesh;
    const ray = new THREE.Raycaster();
    let shops = 0;
    for (const house of plan.houses) {
      const apron = frontageApron(house, plan);
      expect(apron, `no frontage path for ${house.streetId}`).not.toBeNull();
      if (!apron) continue;
      if (house.shop) { shops += 1; expect(apron.width).toBeGreaterThan(house.width); }
      // Probe the emitted triangles along the path, beyond the house step and before the kerb.
      for (const distance of [0.35, 0.6, 0.85]) {
        const along = (distance - 0.5) * apron.depth;
        ray.set(new THREE.Vector3(apron.x + Math.sin(apron.rotation) * along, 5, apron.z + Math.cos(apron.rotation) * along), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(pavement)[0];
        expect(hit, `paving gap before ${house.streetId}`).toBeDefined();
        expect(hit!.point.y).toBeGreaterThan(0.04);
        expect(hit!.point.y).toBeLessThan(0.08);
      }
    }
    expect(shops).toBeGreaterThan(5);
    const materials = new Set<THREE.Material>();
    for (const mesh of meshes) { mesh.geometry.dispose(); materials.add(mesh.material as THREE.Material); }
    materials.forEach((material) => material.dispose());
  });

  it("paves each terrace's whole front area, so streets read as hard corridors rather than lawns between frontages", () => {
    const batch = new Batch();
    buildLondonStreetNetwork(batch, plan);
    const group = new THREE.Group();
    const meshes = batch.build(new Palette(), group);
    const pavement = group.getObjectByName("paving") as THREE.Mesh;
    const ray = new THREE.Raycaster();
    let probes = 0, paved = 0;
    for (const house of plan.houses) {
      // Across the whole frontage (not just the door path): the middle of the front area, at each end and the middle.
      const fx = Math.sin(house.rotation), fz = Math.cos(house.rotation);
      const out = house.depth / 2 + FRONT_AREA / 2;
      for (const across of [-0.4, 0, 0.4]) {
        const x = house.x + fx * out + fz * across * house.width, z = house.z + fz * out - fx * across * house.width;
        ray.set(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
        probes += 1;
        if (ray.intersectObject(pavement)[0]) paved += 1;
      }
    }
    expect(probes).toBeGreaterThan(300);
    expect(paved / probes).toBeGreaterThan(0.97);
    const materials = new Set<THREE.Material>();
    for (const mesh of meshes) { mesh.geometry.dispose(); materials.add(mesh.material as THREE.Material); }
    materials.forEach((material) => material.dispose());
  });

  it("stands people on the very surfaces it draws: the road's top, kerb stones, squares, aprons and paving", () => {
    // Found in game: the road is drawn 0.28 above the ground, but the walk world stood everyone at 0, so feet sank into
    // every road. Probe the drawn street meshes from above, across and along every street, and compare.
    const batch = new Batch();
    buildLondonStreetNetwork(batch, plan);
    const group = new THREE.Group();
    const meshes = batch.build(new Palette(), group);
    const surfaces = meshes.filter((mesh) => ["road", "paving", "stone"].includes(mesh.name));
    expect(surfaces.map((mesh) => mesh.name).sort()).toEqual(["paving", "road", "stone"]);
    group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    let probed = 0, onRoad = 0, onKerb = 0, onPaving = 0;
    for (const street of plan.streets) {
      for (let i = 1; i < street.points.length; i += 1) {
        const a = street.points[i - 1]!, b = street.points[i]!;
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const tx = (b.x - a.x) / length, tz = (b.z - a.z) / length;
        const half = street.width / 2;
        const across = [0, half - 0.06, half + 0.06, half + 0.12, half + 0.18, half + 0.3, half + street.pavement * 0.5, half + street.pavement + FRONT_AREA * 0.5];
        for (let d = 2; d < length - 2; d += 10) {
          for (const offset of across) for (const side of [-1, 1]) {
            const x = a.x + tx * d - tz * offset * side, z = a.z + tz * d + tx * offset * side;
            const surface = world.surfaceAt(x, z);
            if (!surface.walkable || riverAt(x, z, plan).distance <= plan.river.halfWidth + 2) continue;
            ray.set(new THREE.Vector3(x, 5, z), down);
            const hit = ray.intersectObjects(surfaces, false)[0];
            const drawn = hit ? hit.point.y : LONDON_SURFACE.ground;
            expect(surface.height, `${street.id} at ${x.toFixed(2)},${z.toFixed(2)}`).toBeCloseTo(drawn, 3);
            probed += 1;
            if (Math.abs(drawn - LONDON_SURFACE.road) < 1e-3) onRoad += 1;
            if (Math.abs(drawn - LONDON_SURFACE.kerb) < 1e-3) onKerb += 1;
            if (Math.abs(drawn - LONDON_SURFACE.paving) < 1e-3) onPaving += 1;
          }
        }
      }
    }
    // Every kind of surface was actually probed.
    expect(probed).toBeGreaterThan(500);
    expect(onRoad).toBeGreaterThan(100);
    expect(onKerb).toBeGreaterThan(20);
    expect(onPaving).toBeGreaterThan(100);
    const materials = new Set<THREE.Material>();
    for (const mesh of meshes) { mesh.geometry.dispose(); materials.add(mesh.material as THREE.Material); }
    materials.forEach((material) => material.dispose());
  }, 20000);
});
