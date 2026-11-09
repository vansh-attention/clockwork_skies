import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Batch, Palette, frame, local } from "./kit";
import { addLondonRoads, addLondonTransport, buildLondonSigns } from "./londonStreets";
import { createHillTownLayout as createCityLayout, createStreetFurniture, FURNITURE_SIZE, ROAD_LIFT, STREET, TAXI_ROOF, TERRACES, polarToXZ, type Furniture } from "./layout";

function dispose(meshes: THREE.Mesh[]) {
  for (const mesh of meshes) {
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
  }
}

function transportBounds(item: Furniture, maxHeight = Infinity, material?: string): THREE.Box3 {
  const batch = new Batch();
  expect(addLondonTransport(batch, item)).toBe(true);
  const meshes = batch.build(new Palette(), new THREE.Group());
  const inverse = local(frame(item.bearing, Math.hypot(item.x, item.z), item.y), 0, 0, 0, item.turn ?? 0).invert();
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const mesh of meshes) {
    if (material !== undefined && mesh.name !== material) continue;
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(inverse);
      expect(Number.isFinite(point.x + point.y + point.z)).toBe(true);
      if (point.y <= maxHeight) bounds.expandByPoint(point);
    }
  }
  dispose(meshes);
  return bounds;
}

const transport = (kind: Furniture["kind"], turn = 0): Furniture => {
  const bearing = 0.53;
  return { kind, ...polarToXZ(bearing, 274), y: 14, bearing, turn };
};

describe("London street geometry and layout integration", () => {
  it("keeps bumpers, wheels and roof signs inside the shared bus/taxi collision footprints", () => {
    for (const kind of ["bus", "taxi"] as const) {
      const bounds = transportBounds(transport(kind));
      const size = FURNITURE_SIZE[kind];
      expect(bounds.max.x).toBeGreaterThan(size.halfX * 0.9);
      expect(bounds.min.x).toBeGreaterThanOrEqual(-size.halfX - 0.0001);
      expect(bounds.max.x).toBeLessThanOrEqual(size.halfX + 0.0001);
      expect(bounds.min.z).toBeGreaterThanOrEqual(-size.halfZ - 0.0001);
      expect(bounds.max.z).toBeLessThanOrEqual(size.halfZ + 0.0001);
      expect(bounds.max.y).toBeLessThanOrEqual(size.height + 0.0001);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-0.0001);
      // The cab's camera box stops at its drawn body roof (cameraWorld), so that roof must be where the (ink) body is;
      // only the small roof sign stands above it.
      if (kind === "taxi") {
        expect(transportBounds(transport(kind), Infinity, "ink").max.y).toBeCloseTo(TAXI_ROOF, 4);
        expect(bounds.max.y).toBeGreaterThan(TAXI_ROOF);
        expect(bounds.max.y).toBeLessThan(TAXI_ROOF + 0.5);
      }
    }
  });

  it("turns vehicle geometry with the same local frame used by its walking/camera footprint", () => {
    for (const kind of ["bus", "taxi", "bus-stop", "beacon"] as const) {
      const original = transportBounds(transport(kind));
      for (const turn of [Math.PI / 2, Math.PI]) {
        const rotated = transportBounds(transport(kind, turn));
        expect(rotated.min.distanceTo(original.min)).toBeLessThan(0.0001);
        expect(rotated.max.distanceTo(original.max)).toBeLessThan(0.0001);
      }
    }
  });

  it("places every parked vehicle over rendered asphalt, with its full footprint inside the carriageway", () => {
    const layout = createCityLayout();
    const vehicles = createStreetFurniture(layout).filter((item) => item.kind === "bus" || item.kind === "taxi");
    expect(vehicles.some((item) => item.kind === "bus")).toBe(true);
    expect(vehicles.some((item) => item.kind === "taxi")).toBe(true);
    const batch = new Batch();
    addLondonRoads(batch, layout);
    const meshes = batch.build(new Palette(), new THREE.Group());
    const ray = new THREE.Raycaster();
    for (const vehicle of vehicles) {
      ray.set(new THREE.Vector3(vehicle.x, 100, vehicle.z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObjects(meshes.filter((mesh) => mesh.name === "ink"), false)[0];
      expect(hit?.point.y).toBeCloseTo(vehicle.y, 5);
      const wheelBottom = transportBounds(vehicle).min.y + vehicle.y;
      expect(wheelBottom).toBeGreaterThanOrEqual(hit!.point.y - 0.0001);
      expect(wheelBottom - hit!.point.y).toBeLessThan(0.06);
      const road = TERRACES.find((terrace) => Math.abs(terrace.top + ROAD_LIFT - vehicle.y) < 1e-6)!.radius - STREET.inset + STREET.width / 2;
      const size = FURNITURE_SIZE[vehicle.kind];
      const matrix = local(frame(vehicle.bearing, Math.hypot(vehicle.x, vehicle.z), vehicle.y), 0, 0, 0, vehicle.turn ?? 0);
      for (const x of [-size.halfX, size.halfX]) for (const z of [-size.halfZ, size.halfZ]) {
        const point = new THREE.Vector3(x, 0, z).applyMatrix4(matrix);
        expect(Math.abs(Math.hypot(point.x, point.z) - road)).toBeLessThan(3.8);
      }
    }
    dispose(meshes);
  });

  it("renders shared beacon posts within their true walking footprint and keeps the high globe above head height", () => {
    const beacon = transport("beacon");
    const post = transportBounds(beacon, 3.8);
    const full = transportBounds(beacon);
    const size = FURNITURE_SIZE.beacon;
    expect(post.min.y).toBeCloseTo(0, 4);
    expect(Math.max(Math.abs(post.min.x), Math.abs(post.max.x))).toBeLessThanOrEqual(size.halfX);
    expect(Math.max(Math.abs(post.min.z), Math.abs(post.max.z))).toBeLessThanOrEqual(size.halfZ);
    expect(full.max.y).toBeLessThanOrEqual(size.height);
    expect(full.max.y).toBeGreaterThan(4.5);
    expect(full.max.x).toBeGreaterThan(size.halfX); // broad globe is handled separately by the camera, above the path
  });

  it("has a renderer-free sign fallback for the Node content pipeline", () => {
    expect(typeof document).toBe("undefined");
    const signs = buildLondonSigns(createCityLayout());
    expect(signs.name).toBe("London street names and shop signs");
    expect(signs.children).toEqual([]);
  });
});
