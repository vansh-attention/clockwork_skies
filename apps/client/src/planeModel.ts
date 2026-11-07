import * as THREE from "three";
import { PAINTS } from "@clockwork/content";
import { createIllustratedMaterial, type IllustratedLighting } from "@clockwork/render";

export type PlaneModel = { readonly group: THREE.Group; readonly propeller: THREE.Group };

/**
 * Builds the shared biplane-style aircraft model.
 *
 * - The nose points -Z; the propeller sits at z = -7 and spins about its local Z.
 * - Units are unscaled (about 11.7 long, 10 wide).
 * - The group holds 8 meshes (fuselage, nose, wings, tail, fin, 3 blades).
 * - The caller owns the result and must dispose geometry and materials.
 * - An unknown paint id falls back to PAINTS[0].
 * - `lighting` "world" lights it by the town's sun (with shadows and fog); the default suits the flight scenes.
 */
export function createPlaneModel(paintId: string, lighting: IllustratedLighting = "view"): PlaneModel {
  const paint = PAINTS.find((candidate) => candidate.id === paintId) ?? PAINTS[0];
  const group = new THREE.Group();
  const body = createIllustratedMaterial({ color: paint.body, shadow: "#7c8178", surfaceId: 0.62, lighting });
  const accent = createIllustratedMaterial({ color: paint.accent, shadow: "#64392f", surfaceId: 0.66, lighting });
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.7, 8, 8), body); fuselage.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3, 8), accent); nose.rotation.x = -Math.PI / 2; nose.position.z = -5.5;
  const wings = new THREE.Mesh(new THREE.BoxGeometry(10, 0.35, 3), body); wings.position.z = 0.5;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 1.8), accent); tail.position.z = 3.7;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 2), accent); fin.position.set(0, 1.4, 3.2);
  const prop = new THREE.Group(); prop.position.z = -7;
  for (let i = 0; i < 3; i += 1) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 0.2), accent); blade.rotation.z = i * Math.PI * 2 / 3; prop.add(blade); }
  group.add(fuselage, nose, wings, tail, fin, prop); group.userData.propeller = prop;
  return { group, propeller: prop };
}
