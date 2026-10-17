import { Quaternion, Vector3 } from "three";
import { RULES, type Controls, type Ship, type XYZ } from "./types";
const rotation = new Quaternion();
const up = new Vector3(0, 1, 0), right = new Vector3(1, 0, 0);
const forward = new Vector3(0, 0, -1);

export function createShip(id: string, at: XYZ = [0, 0, 650]): Ship {
  const p = new Vector3(...at);
  return { id, team: id === "player" ? "pilot" : "drone", p, prevP: p.clone(),
    v: new Vector3(), q: new Quaternion(), prevQ: new Quaternion(),
    hull: RULES.hull, heat: 0, energy: 100, rockets: 2,
    lastShot: -Infinity, nextRocket: 0, lockId: null, lockTime: 0, impactAt: -Infinity };
}

export function stepShip(s: Ship, c: Controls, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0 || s.hull <= 0) return;
  s.prevP.copy(s.p); s.prevQ.copy(s.q);
  s.q.multiply(rotation.setFromAxisAngle(up, c.yaw));
  s.q.multiply(rotation.setFromAxisAngle(right, c.pitch));
  s.q.multiply(rotation.setFromAxisAngle(forward, c.roll * RULES.rollRate * dt)).normalize();
}
