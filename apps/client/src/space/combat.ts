import { Vector3 } from "three";
import { eyeOf, forwardOf } from "./flight";
import { firstHit } from "./collision";
import { RULES } from "./types";
import type { Controls, Event, Obstacle, Ship } from "./types";

export type Trace = { active: boolean; a: Vector3; b: Vector3; ttl: number };
export type Rocket = { active: boolean; p: Vector3; prev: Vector3; v: Vector3;
  owner: string; target: string; ttl: number };
const origin = new Vector3(), direction = new Vector3(), segment = new Vector3();

export class Combat {
  readonly traces: Trace[] = Array.from({ length: 24 }, () => ({ active: false, a: new Vector3(), b: new Vector3(), ttl: 0 }));
  readonly rockets: Rocket[] = Array.from({ length: 8 }, () => ({ active: false, p: new Vector3(), prev: new Vector3(),
    v: new Vector3(), owner: "", target: "", ttl: 0 }));
  private traceCursor = 0;
  reset(): void { for (const trace of this.traces) trace.active = false; for (const rocket of this.rockets) rocket.active = false; this.traceCursor = 0; }
  weapon(s: Ship, c: Controls, _dt: number, now: number, ships: readonly Ship[],
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
  }
  advance(_dt: number, _ships: readonly Ship[], _obstacles: readonly Obstacle[], _emit: (event: Event) => void): void {}
  private damage(target: Ship, amount: number, owner: string, emit: (event: Event) => void): void {
    target.hull = Math.max(0, target.hull - amount); emit({ kind: "hit", owner, target: target.id });
    if (target.hull === 0) emit({ kind: "destroyed", owner, target: target.id });
  }
}
