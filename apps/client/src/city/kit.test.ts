import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Batch, Palette, enableShadows, type MaterialKey, type MaterialSource } from "./kit";

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
