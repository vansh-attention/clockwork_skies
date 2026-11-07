import * as THREE from "three";
import type { MaterialSource } from "../city/kit";

/**
 * Little puffs of dust kicked up by the courier: a ring on landing, a few on take-off, one at the heel now and then
 * while running. A fixed pool of instanced puffs (one draw call) in the town's smoke colour; each swells, drifts
 * outward, rises a little and shrinks away over its short life.
 */
export type Dust = {
  readonly mesh: THREE.InstancedMesh;
  /** Puff `count` times around (x, y, z), spreading out over about `radius`. */
  spawn(x: number, y: number, z: number, count: number, radius: number): void;
  update(dt: number): void;
  /** Puffs currently alive. */
  readonly alive: number;
  clear(): void;
  dispose(): void;
};

export const DUST_POOL = 18;
const LIFE = 0.55;
const RISE = 1.1;
const SIZE = 0.5;

type Puff = { x: number; y: number; z: number; dx: number; dz: number; age: number; life: number };

export function createDust(palette: MaterialSource): Dust {
  // Detail 1 has smooth normals, so the line pass draws each puff's outline only, never its facets.
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), palette.get("smoke"), DUST_POOL);
  mesh.name = "Courier dust";
  // Instances wander far from the mesh origin; the pool is tiny, so skip culling rather than refit bounds.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const puffs: Puff[] = [];
  let next = 0;
  let angle = 0;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  const write = () => {
    for (let i = 0; i < DUST_POOL; i += 1) {
      const puff = puffs[i];
      if (!puff || puff.age >= puff.life) {
        mesh.setMatrixAt(i, hidden);
        continue;
      }
      const t = puff.age / puff.life;
      const ease = 1 - (1 - t) * (1 - t);
      position.set(puff.x + puff.dx * ease, puff.y + RISE * t, puff.z + puff.dz * ease);
      scale.setScalar(Math.max(1e-4, Math.sin(Math.PI * Math.min(1, t * 1.25)) * SIZE * (0.7 + 0.6 * t)));
      mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  write();
  return {
    mesh,
    get alive() {
      let count = 0;
      for (const puff of puffs) if (puff && puff.age < puff.life) count += 1;
      return count;
    },
    spawn(x, y, z, count, radius) {
      if (![x, y, z, count, radius].every(Number.isFinite) || count <= 0) return;
      for (let i = 0; i < Math.min(count, DUST_POOL); i += 1) {
        angle += 2.399963; // the golden angle: consecutive puffs never bunch on one side
        const spread = radius * (0.6 + 0.2 * (i % 3));
        puffs[next] = {
          x: x + Math.cos(angle) * spread * 0.4, y: y + 0.25, z: z + Math.sin(angle) * spread * 0.4,
          dx: Math.cos(angle) * spread, dz: Math.sin(angle) * spread, age: 0, life: LIFE * (0.8 + 0.13 * (i % 4)),
        };
        next = (next + 1) % DUST_POOL;
      }
      write();
    },
    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      let any = false;
      for (const puff of puffs) {
        if (puff && puff.age < puff.life) {
          puff.age += dt;
          any = true;
        }
      }
      if (any) write();
    },
    clear() {
      puffs.length = 0;
      next = 0;
      write();
    },
    dispose() {
      mesh.geometry.dispose();
      mesh.dispose();
    },
  };
}
