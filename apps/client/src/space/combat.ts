import { Vector3 } from "three";
import { eyeOf, forwardOf } from "./flight";
import { firstHit } from "./collision";
import { RULES } from "./types";
import type { Controls, Event, Obstacle, Ship } from "./types";

export type Trace = { active: boolean; a: Vector3; b: Vector3; ttl: number };
export type Rocket = { active: boolean; p: Vector3; prev: Vector3; v: Vector3;
  owner: string; target: string; ttl: number };
const origin = new Vector3(), direction = new Vector3(), segment = new Vector3(), desired = new Vector3();

export class Combat {
  readonly traces: Trace[] = Array.from({ length: 24 }, () => ({ active: false, a: new Vector3(), b: new Vector3(), ttl: 0 }));
  readonly rockets: Rocket[] = Array.from({ length: 8 }, () => ({ active: false, p: new Vector3(), prev: new Vector3(),
    v: new Vector3(), owner: "", target: "", ttl: 0 }));
  private traceCursor = 0;
  reset(): void { for (const trace of this.traces) trace.active = false; for (const rocket of this.rockets) rocket.active = false; this.traceCursor = 0; }
  select(shooter: Ship, ships: readonly Ship[], obstacles: readonly Obstacle[]): Ship | null {
    eyeOf(shooter, origin); forwardOf(shooter, direction);
    let selected: Ship | null = null, best = RULES.rocketRange;
    for (const target of ships) {
      if (target.team === shooter.team || target.hull <= 0) continue;
      segment.subVectors(target.p, origin); const distance = segment.length();
      if (!distance || distance > best || direction.dot(desired.copy(segment).normalize()) < Math.cos(8 * Math.PI / 180)) continue;
      const hit = firstHit(origin, segment, 0, obstacles, ships, shooter.id);
      if (hit?.kind !== "ship" || hit.id !== target.id) continue;
      selected = target; best = distance;
    }
    return selected;
  }
  weapon(s: Ship, c: Controls, dt: number, now: number, ships: readonly Ship[],
    obstacles: readonly Obstacle[], emit: (event: Event) => void): void {
    if (s.hull <= 0) return;
    if (c.fire && now - s.lastShot >= RULES.cannonInterval && s.heat + RULES.heatPerShot <= 100) {
      s.lastShot = now; s.heat += RULES.heatPerShot;
      eyeOf(s, origin); forwardOf(s, direction); segment.copy(direction).multiplyScalar(RULES.cannonRange);
      const hit = firstHit(origin, segment, 0, obstacles, ships, s.id);
      const trace = this.traces[this.traceCursor++ % this.traces.length]!;
      trace.active = true; trace.ttl = 0.08; trace.a.copy(origin);
      trace.b.copy(origin).addScaledVector(segment, hit?.t ?? 1);
      emit({ kind: "shot", owner: s.id });
      const target = hit?.kind === "ship" ? ships.find((ship) => ship.id === hit.id) : undefined;
      if (target && target.team !== s.team) this.damage(target, s.team === "pilot" ? RULES.cannonDamage : RULES.droneDamage, s.id, emit);
    }
    const target = c.rocket ? this.select(s, ships, obstacles) : null;
    if (!target) { s.lockId = null; s.lockTime = 0; return; }
    if (s.lockId !== target.id) { s.lockId = target.id; s.lockTime = 0; }
    s.lockTime += dt;
    const rocket = this.rockets.find((item) => !item.active);
    if (s.lockTime < RULES.lockSeconds || s.rockets <= 0 || now < s.nextRocket || !rocket) return;
    rocket.active = true; eyeOf(s, rocket.p); rocket.prev.copy(rocket.p);
    forwardOf(s, rocket.v).multiplyScalar(RULES.rocketSpeed);
    rocket.owner = s.id; rocket.target = target.id; rocket.ttl = RULES.rocketLife;
    s.rockets--; s.nextRocket = now + RULES.rocketInterval; s.lockTime = 0;
    emit({ kind: "rocket", owner: s.id, target: target.id });
  }
  advance(dt: number, ships: readonly Ship[], obstacles: readonly Obstacle[], emit: (event: Event) => void): void {
    for (const trace of this.traces) { trace.ttl -= dt; if (trace.ttl <= 0) trace.active = false; }
    for (const rocket of this.rockets) {
      if (!rocket.active) continue;
      rocket.prev.copy(rocket.p);
      const travelTime = Math.max(0, Math.min(dt, rocket.ttl));
      rocket.ttl -= dt;
      if (!travelTime) { rocket.active = false; continue; }
      const target = ships.find((ship) => ship.id === rocket.target && ship.hull > 0);
      if (target) {
        desired.subVectors(target.p, rocket.p).normalize().multiplyScalar(RULES.rocketSpeed);
        rocket.v.lerp(desired, 1 - Math.exp(-3 * travelTime)).normalize().multiplyScalar(RULES.rocketSpeed);
      }
      segment.copy(rocket.v).multiplyScalar(travelTime);
      const hit = firstHit(rocket.p, segment, 1.2, obstacles, ships, rocket.owner);
      rocket.p.addScaledVector(segment, hit?.t ?? 1);
      if (hit || rocket.ttl <= 0) rocket.active = false;
      if (hit?.kind === "ship") {
        const victim = ships.find((ship) => ship.id === hit.id);
        const owner = ships.find((ship) => ship.id === rocket.owner);
        if (victim && victim.team !== owner?.team) this.damage(victim, RULES.rocketDamage, rocket.owner, emit);
      }
    }
  }
  private damage(target: Ship, amount: number, owner: string, emit: (event: Event) => void): void {
    target.hull = Math.max(0, target.hull - amount); emit({ kind: "hit", owner, target: target.id });
    if (target.hull === 0) emit({ kind: "destroyed", owner, target: target.id });
  }
}
