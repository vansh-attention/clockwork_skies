import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SeededRandom } from "@clockwork/shared";
import { ROCKS, STATIONS } from "./map";

export class Resources {
  private readonly values = new Set<{ dispose(): void }>();

  own<R extends { dispose(): void }>(value: R): R {
    this.values.add(value);
    return value;
  }

  get size(): number { return this.values.size; }

  dispose(): void {
    for (const value of this.values) value.dispose();
    this.values.clear();
  }
}

function bake(geometry: T.BufferGeometry, colour: number): T.BufferGeometry {
  const normal = geometry.getAttribute("normal");
  const colours = new Float32Array(normal.count * 3);
  const base = new T.Color(colour);
  for (let i = 0; i < normal.count; i++) {
    const light = normal.getX(i) * 0.35 + normal.getY(i) * 0.7 + normal.getZ(i) * 0.4;
    const shade = light > 0.25 ? 1 : light > -0.25 ? 0.7 : 0.42;
    colours[i * 3] = base.r * shade;
    colours[i * 3 + 1] = base.g * shade;
    colours[i * 3 + 2] = base.b * shade;
  }
  geometry.setAttribute("color", new T.BufferAttribute(colours, 3));
  return geometry;
}

export function buildSector(resources: Resources) {
  const temporary: T.BufferGeometry[] = [];
  try {
    const world = new T.Scene();
    world.background = new T.Color(0x070c17);
    const camera = new T.PerspectiveCamera(75, 1, 0.1, 3500);
    world.add(camera);
    const material = resources.own(new T.MeshBasicMaterial({ vertexColors: true }));
    for (const [i, solid] of STATIONS.entries()) {
      if (solid.kind !== "box") throw new Error("Station proxy must be a box");
      temporary.push(bake(new T.BoxGeometry(solid.half[0] * 2, solid.half[1] * 2, solid.half[2] * 2),
        i < 2 ? 0xd6ddcf : i < 4 ? 0xc77b50 : 0x77becb).translate(...solid.center));
    }
    const merged = mergeGeometries(temporary);
    if (!merged) throw new Error("Station geometry merge failed");
    const station = new T.Mesh(resources.own(merged), material);
    station.name = "Relay Hub / Dock / Broken Truss";
    world.add(station);

    const rocks = new T.InstancedMesh(
      resources.own(bake(new T.IcosahedronGeometry(1, 1), 0xa7b2bd)), material, ROCKS.length);
    const pose = new T.Object3D();
    ROCKS.forEach((rock, i) => {
      if (rock.kind !== "sphere") throw new Error("Rock proxy must be a sphere");
      pose.position.set(...rock.center);
      pose.scale.setScalar(rock.radius);
      pose.rotation.set(i * 0.37, i * 0.21, i * 0.13);
      pose.updateMatrix();
      rocks.setMatrixAt(i, pose.matrix);
    });
    rocks.computeBoundingSphere();
    rocks.name = "Asteroid clusters";
    world.add(rocks);

    const rng = new SeededRandom(451);
    const positions = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      const y = rng.range(-1, 1), angle = rng.range(0, Math.PI * 2);
      const radius = Math.sqrt(1 - y * y) * 2400;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = y * 2400;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const starGeometry = resources.own(new T.BufferGeometry());
    starGeometry.setAttribute("position", new T.BufferAttribute(positions, 3));
    const stars = new T.Points(starGeometry, resources.own(new T.PointsMaterial({
      color: 0xc3d0dc, size: 1.1, sizeAttenuation: false, depthWrite: false,
    })));
    stars.frustumCulled = false;
    stars.renderOrder = -1;
    world.add(stars);
    return { world, camera, station, rocks, stars };
  } catch (error) {
    resources.dispose();
    throw error;
  } finally {
    for (const geometry of temporary) geometry.dispose();
  }
}
