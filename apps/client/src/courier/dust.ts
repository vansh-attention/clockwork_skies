import * as THREE from "three";
import type { MaterialSource } from "../city/kit";

/**
 * Little puffs of dust kicked up by the courier's feet (when and how many is the controller's call: as the reference's
 * footstep particles, a pair on landing and one now and then while moving briskly). A fixed pool of instanced puffs
 * (one draw call) in a mid-grey dust; each swells, drifts outward, rises a little and shrinks away over its short
 * life. The reference's particles are about a ninth of its character's height across and show for about 0.4 s; these
 * are the same against the courier.
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
/** Seconds; a puff shows for the first four-fifths of it (about 0.4 s). */
const LIFE = 0.5;
const RISE = 0.55;
/** Radius at full swell: about 0.4 across, a ninth of the 3.79-tall courier. */
const SIZE = 0.22;

type Puff = { x: number; y: number; z: number; dx: number; dz: number; age: number; life: number; spin: number };

/** Each puff turns its lumps a different way about this axis, so no two outlines match. */
const SPIN_AXIS = new THREE.Vector3(0.3, 1, 0.2).normalize();

/**
 * A lumpy puff: a ball whose radius wanders with direction (about ±0.3), so its outline is ragged like the reference's
 * noise-broken particles rather than a clean circle. Detail 1 has smooth normals, and scaling each corner along its own
 * direction keeps them, so the line pass draws the puff's outline only, never its facets.
 */
function puffGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const position = geometry.getAttribute("position");
  const corner = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    corner.fromBufferAttribute(position, i).normalize();
    // Depends on the direction only, so a corner shared by several faces moves the same way in each.
    const lump = Math.sin(corner.x * 5.1 + 1.3) * Math.sin(corner.y * 4.3 + 0.7) * Math.sin(corner.z * 4.7 + 2.1);
    corner.multiplyScalar(1 + 0.32 * lump);
    position.setXYZ(i, corner.x, corner.y, corner.z);
  }
  position.needsUpdate = true;
  return geometry;
}

export function createDust(palette: MaterialSource): Dust {
  const mesh = new THREE.InstancedMesh(puffGeometry(), palette.get("dust"), DUST_POOL);
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
      rotation.setFromAxisAngle(SPIN_AXIS, puff.spin);
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
          dx: Math.cos(angle) * spread, dz: Math.sin(angle) * spread, age: 0, life: LIFE * (0.8 + 0.13 * (i % 4)), spin: angle * 1.7,
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
