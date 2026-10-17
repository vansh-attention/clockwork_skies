import { Quaternion, Vector3 } from "three";
import { RULES, type Controls, type Ship, type XYZ } from "./types";
const rotation = new Quaternion();
const desired = new Vector3();
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
  const requestedBoost = c.boost && c.forward > 0 && !c.brake;
  const boosting = requestedBoost && s.energy >= RULES.energyDrain * dt;
  const speed = boosting ? RULES.boostSpeed : c.forward < 0 ? RULES.reverse : RULES.speed;
  desired.set(c.strafe, c.lift, -c.forward);
  if (desired.lengthSq() > 1) desired.normalize();
  desired.multiplyScalar(speed).applyQuaternion(s.q);
  if (c.brake) desired.set(0, 0, 0);
  s.v.lerp(desired, 1 - Math.exp(-(c.brake ? RULES.brake : RULES.assist) * dt));
  s.p.addScaledVector(s.v, dt);
  s.energy = Math.max(0, Math.min(100, s.energy +
    (boosting ? -RULES.energyDrain : requestedBoost ? 0 : RULES.energyRecover) * dt));
  s.heat = Math.max(0, s.heat - RULES.heatCool * dt);
}

export function forwardOf(s: Ship, out: Vector3): Vector3 {
  return out.set(0, 0, -1).applyQuaternion(s.q);
}

export function eyeOf(s: Ship, out: Vector3): Vector3 {
  return out.set(0, 0.8, -1.5).applyQuaternion(s.q).add(s.p);
}
