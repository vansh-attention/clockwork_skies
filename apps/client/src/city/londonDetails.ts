import type { House } from "./layout";
import { nearestOnPolyline, nearestStreet, type LondonPlan, type PlanHouse, type PlanSquare } from "./londonPlan";

export type FrontageApron = Pick<PlanSquare, "x" | "z" | "rotation" | "width" | "depth">;

/** A real connection from the front wall to its street's kerb: shop forecourt or narrow garden path. */
export function frontageApron(house: PlanHouse, plan: LondonPlan): FrontageApron | null {
  const fx = Math.sin(house.rotation); const fz = Math.cos(house.rotation);
  const front = { x: house.x + fx * (house.depth / 2 + 0.03), z: house.z + fz * (house.depth / 2 + 0.03) };
  const owner = plan.streets.find((street) => street.id === house.streetId);
  const nearest = owner ? { ...nearestOnPolyline(front, owner.points), street: owner } : nearestStreet(front.x, front.z, plan);
  if (!nearest || nearest.distance < 1e-6) return null;
  const facing = ((nearest.x - front.x) * fx + (nearest.z - front.z) * fz) / nearest.distance;
  const reach = nearest.distance - nearest.street.width / 2 + 0.1;
  // Do not paint a diagonal shortcut through another plot when a house sits beside a junction.
  if (facing < 0.98 || reach <= 0 || reach > 7) return null;
  return { x: front.x + fx * reach / 2, z: front.z + fz * reach / 2, rotation: house.rotation,
    width: house.shop ? house.width + 0.2 : 2.2, depth: reach };
}

export function onFrontage(x: number, z: number, apron: FrontageApron, margin = 0): boolean {
  const dx = x - apron.x; const dz = z - apron.z;
  return Math.abs(dx * Math.cos(apron.rotation) - dz * Math.sin(apron.rotation)) < apron.width / 2 + margin
    && Math.abs(dx * Math.sin(apron.rotation) + dz * Math.cos(apron.rotation)) < apron.depth / 2 + margin;
}

/** Shared shop selection for street geometry, signs and the follow camera. No renderer dependency. */
export function isLondonShopfront(house: Pick<House, "r" | "shop">, index: number): boolean {
  if (house.shop !== undefined) return house.shop;
  return (house.r === 258 || house.r === 192 || house.r === 384) && index % 3 !== 0;
}

export function hasLondonShopAwning(house: Pick<House, "r" | "shop">, index: number): boolean {
  return isLondonShopfront(house, index) && index % 2 === 0;
}
