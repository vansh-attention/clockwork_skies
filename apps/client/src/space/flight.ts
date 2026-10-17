import { Quaternion, Vector3 } from "three";
import { RULES, type Ship, type XYZ } from "./types";

export function createShip(id: string, at: XYZ = [0, 0, 650]): Ship {
  const p = new Vector3(...at);
  return { id, team: id === "player" ? "pilot" : "drone", p, prevP: p.clone(),
    v: new Vector3(), q: new Quaternion(), prevQ: new Quaternion(),
    hull: RULES.hull, heat: 0, energy: 100, rockets: 2,
    lastShot: -Infinity, nextRocket: 0, lockId: null, lockTime: 0, impactAt: -Infinity };
}
