import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEPTH_PREPASS_LAYER } from "@clockwork/render";
import { Batch, Palette, disposeMesh, enableShadows, type MaterialKey, type MaterialSource } from "./kit";

const idOf = <E extends string>(palette: MaterialSource<E>, key: MaterialKey<E>) => palette.get(key).uniforms.uSurfaceId!.value as number;

it("gives an extended swatch a surface id no existing material uses", () => {
  const palette = new Palette();
  const ids = [palette.get("ground"), palette.get("ink"), palette.get("brass")].map((material) => material.uniforms.uSurfaceId!.value as number);
  const extended = palette.extend({ lantern: { color: "#f0c060", shadow: "#8a5a20" } });
  const lantern = extended.get("lantern").uniforms.uSurfaceId!.value as number;
  expect(ids).not.toContain(lantern);
  expect(lantern).toBeCloseTo(0.05 + 3 * 0.027);
  expect(idOf(extended, "ground")).toBe(ids[0]);
});

it("creates no materials until a key is asked for", () => {
  const palette = new Palette().extend({ lantern: { color: "#f0c060" } });
  expect(idOf(palette, "ground")).toBeCloseTo(0.05);
});

it("resolves accents through the supplied lookup, with a fallback", () => {
  const palette = new Palette((index) => (index === 0 ? "#102030" : undefined));
  expect(palette.get("accent0").uniforms.uColor!.value.getHexString()).toBe("102030");
  expect(palette.get("accent9").uniforms.uColor!.value.getHexString()).toBe("c45f45");
});

it("rejects duplicate and accent-prefixed keys, and unknown lookups", () => {
  const palette = new Palette();
  expect(() => palette.extend({ brass: { color: "#fff" } })).toThrow();
  expect(() => palette.extend({ accentX: { color: "#fff" } })).toThrow();
  expect(() => palette.get("nope" as never)).toThrow();
  expect(() => palette.get("toString" as never)).toThrow();
});

it("accepts re-registering an identical swatch but not a different one under the same key", () => {
  const palette = new Palette().extend({ lantern: { color: "#f0c060" } });
  expect(() => palette.extend({ lantern: { color: "#f0c060" } })).not.toThrow();
  expect(() => palette.extend({ lantern: { color: "#000000" } })).toThrow();
});

it("refuses at compile time to build a batch whose extra keys the palette lacks", () => {
  const batch = new Batch<"stripe">();
  const plain = new Palette(); // Palette<never>: declared on its own so nothing infers "stripe" for it.
  // @ts-expect-error: a plain palette was never extended with "stripe".
  const build = () => batch.build(plain, new THREE.Group());
  expect(typeof build).toBe("function");
  const extended = new Palette().extend({ stripe: { color: "#ffffff" } });
  expect(batch.build(extended, new THREE.Group())).toEqual([]);
});

describe("enableShadows", () => {
  it("lets flat and hidden surfaces only receive, and everything else cast too", () => {
    const root = new THREE.Group();
    for (const name of ["ground", "rock", "cloud", "wall0", "trunk", "boiler"]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry());
      mesh.name = name;
      root.add(mesh);
    }
    enableShadows(root);
    const byName = (name: string) => root.getObjectByName(name) as THREE.Mesh;
    for (const name of ["ground", "rock", "cloud"]) expect([byName(name).castShadow, byName(name).receiveShadow]).toEqual([false, true]);
    for (const name of ["wall0", "trunk", "boiler"]) expect([byName(name).castShadow, byName(name).receiveShadow]).toEqual([true, true]);
  });
});

describe("Batch chunks", () => {
  const place = (x: number, z: number) => new THREE.Matrix4().makeTranslation(x, 1, z);
  /** Three boxes far apart (three chunks) and a long strip of paving running past all of them (the wide chunk). */
  function town() {
    const batch = new Batch();
    for (const x of [-150, 0, 150]) batch.add("stone", new THREE.BoxGeometry(2, 2, 2), place(x, 0));
    batch.add("stone", new THREE.PlaneGeometry(400, 4).rotateX(-Math.PI / 2));
    batch.add("brass", new THREE.BoxGeometry(1, 1, 1), place(3, 3));
    const group = new THREE.Group();
    const meshes = batch.build(new Palette(), group);
    return { group, stone: meshes.find((mesh) => mesh.name === "stone")!, brass: meshes.find((mesh) => mesh.name === "brass")! };
  }
  /** One pass of the renderer's "about to draw you" call, with the camera's matrices brought up to date as it does. */
  function drawnChunks(mesh: THREE.Mesh, camera: THREE.PerspectiveCamera): number {
    camera.updateMatrixWorld(true);
    mesh.onBeforeRender(null as never, new THREE.Scene(), camera, mesh.geometry, mesh.material as THREE.Material, null as never);
    return (mesh as unknown as { _multiDrawCount: number })._multiDrawCount;
  }
  const lookingAt = (x: number, z: number, fromZ: number) => {
    const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 60);
    camera.position.set(x, 2, fromZ);
    camera.lookAt(x, 1, z);
    return camera;
  };

  it("keeps a material that sits in one place as a plain mesh, and one spread over the town as a single batched mesh", () => {
    const { group, stone, brass } = town();
    expect(group.children).toHaveLength(2);
    expect(brass).toBeInstanceOf(THREE.Mesh);
    expect(brass).not.toBeInstanceOf(THREE.BatchedMesh);
    expect(stone).toBeInstanceOf(THREE.BatchedMesh);
    // Every vertex is there, shared between a face's triangles (24 a box, not 36), with an index throughout.
    expect(stone.geometry.getAttribute("position").count).toBe(3 * 24 + 4);
    expect(stone.geometry.index!.count).toBe(3 * 36 + 6);
    expect(brass.geometry.index).not.toBeNull();
  });

  it("culls each chunk on its own: only what the camera can see is drawn", () => {
    const { stone } = town();
    // The first pass is three's own (it readies the batch); the passes after it are the light ones.
    drawnChunks(stone, lookingAt(150, 0, 20));
    // The box at x = 150 and the long strip passing under the camera.
    expect(drawnChunks(stone, lookingAt(150, 0, 20))).toBe(2);
    // Looking away from the town: no box, only the strip (it is long enough that its bounds reach round the camera).
    expect(drawnChunks(stone, lookingAt(150, 100, 20))).toBe(1);
    // Standing well beyond its end and looking further out: nothing at all.
    expect(drawnChunks(stone, lookingAt(400, 100, 20))).toBe(0);
    // From far above with a long reach: all three boxes and the strip.
    const above = new THREE.PerspectiveCamera(60, 2, 1, 2000);
    above.position.set(0, 400, 0);
    above.lookAt(0, 0, 0);
    expect(drawnChunks(stone, above)).toBe(4);
  });

  it("can still be picked with a ray, chunk by chunk", () => {
    const { group, stone } = town();
    group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(150, 50, 0), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(stone, false)[0];
    expect(hit?.point.y).toBeCloseTo(2, 5);
    ray.set(new THREE.Vector3(75, 50, 0), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(stone, false)[0]?.point.y).toBeCloseTo(0, 5);
  });

  it("puts static scenery on the depth-prepass layer, and releases a batch only once", () => {
    const { stone, brass } = town();
    expect(stone.layers.isEnabled(DEPTH_PREPASS_LAYER)).toBe(true);
    expect(brass.layers.isEnabled(DEPTH_PREPASS_LAYER)).toBe(true);
    let released = 0;
    stone.geometry.addEventListener("dispose", () => { released += 1; });
    disposeMesh(stone);
    expect(() => disposeMesh(stone)).not.toThrow();
    expect(released).toBe(1);
    disposeMesh(brass);
  });
});
