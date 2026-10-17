import { Vector3 } from "three";
import { Combat } from "./combat";
import { createShip, stepShip } from "./flight";
import { moveWithCollisions } from "./collision";
import { DRONE_SPAWNS, EXTENT, GATES, OBSTACLES, PICKUPS, SPAWN, TARGETS } from "./map";
import type { Controls, Event, Mode, Ship, XYZ } from "./types";

const pickupPosition = new Vector3();

export class SpaceSession {
  readonly player = createShip("player", SPAWN);
  readonly drones = Array.from({ length: 6 }, (_, i) => createShip(`drone-${i}`));
  readonly ships: Ship[] = [this.player, ...this.drones];
  readonly combat = new Combat();
  readonly events: Event[] = [];
  readonly pickupAt = new Float64Array(PICKUPS.length);
  mode: Mode = "training";
  time = 0; gate = 0; result: "playing" | "won" | "lost" = "playing";
  warning = false; flashUntil = 0; benchmark = false;
  private activeCount = 3;
  readonly emit = (event: Event) => {
    if (this.events.length < 32) this.events.push(event);
    if (event.target === "player" && event.kind === "hit") this.flashUntil = this.time + 0.15;
  };
  reset(mode: Mode, count = 3, _seed = 42, benchmark = false): void {
    this.mode = mode; this.time = 0; this.gate = 0; this.result = "playing";
    this.warning = false; this.benchmark = benchmark; this.flashUntil = 0;
    this.events.length = 0; this.combat.reset(); this.pickupAt.fill(0);
    const resetShip = (ship: Ship, at: XYZ, hull: number) => {
      ship.p.set(...at); ship.prevP.copy(ship.p); ship.v.set(0, 0, 0);
      ship.q.identity(); ship.prevQ.copy(ship.q);
      ship.hull = hull; ship.heat = 0; ship.energy = 100; ship.rockets = 2;
      ship.lastShot = -Infinity; ship.nextRocket = 0;
      ship.lockId = null; ship.lockTime = 0; ship.impactAt = -Infinity;
    };
    resetShip(this.player, SPAWN, 100);
    this.activeCount = mode === "training" ? 3 : Math.max(1, Math.min(6, count));
    this.drones.forEach((ship, index) => resetShip(ship,
      (mode === "training" ? TARGETS[index % 3] : DRONE_SPAWNS[index])!,
      index < this.activeCount ? mode === "training" ? 30 : 60 : 0));
  }
  get remaining(): number { return this.drones.reduce((count, ship) => count + Number(ship.hull > 0), 0); }
  get objective(): string {
    if (this.mode === "training" && this.gate < GATES.length) return `Fly gate ${this.gate + 1} / ${GATES.length}`;
    return `Destroy ${this.remaining} ${this.mode === "training" ? "stationary targets" : "drones"}`;
  }
  tick(dt: number, controls: Controls): void {
    if (this.result !== "playing" || !Number.isFinite(dt) || dt <= 0) return;
    this.events.length = 0; this.time += dt;
    if (this.player.hull <= 0 && !this.benchmark) { this.result = "lost"; return; }
    stepShip(this.player, controls, dt); moveWithCollisions(this.player, OBSTACLES, this.time);
    this.combat.weapon(this.player, controls, dt, this.time, this.ships, OBSTACLES, this.emit);
    this.combat.advance(dt, this.ships, OBSTACLES, this.emit);
    if (this.player.hull <= 0 && !this.benchmark) { this.result = "lost"; return; }
    this.objectives(dt);
    if (this.player.hull <= 0 && !this.benchmark) this.result = "lost";
    else if (!this.remaining && (this.mode === "skirmish" || this.gate === GATES.length)) this.result = "won";
  }
  private objectives(dt: number): void {
    const ship = this.player;
    this.warning = Math.abs(ship.p.x) + 3 > EXTENT[0] * 0.9 ||
      Math.abs(ship.p.y) + 3 > EXTENT[1] * 0.9 || Math.abs(ship.p.z) + 3 > EXTENT[2] * 0.9;
    if (Math.abs(ship.p.x) + 3 > EXTENT[0] || Math.abs(ship.p.y) + 3 > EXTENT[1] ||
      Math.abs(ship.p.z) + 3 > EXTENT[2]) ship.hull = Math.max(0, ship.hull - 20 * dt);
    const gate = this.mode === "training" ? GATES[this.gate] : undefined;
    if (gate && ship.prevP.z > gate[2] && ship.p.z <= gate[2]) {
      const t = (gate[2] - ship.prevP.z) / (ship.p.z - ship.prevP.z);
      const x = ship.prevP.x + (ship.p.x - ship.prevP.x) * t;
      const y = ship.prevP.y + (ship.p.y - ship.prevP.y) * t;
      if (t > 0 && t <= 1 && (x - gate[0]) ** 2 + (y - gate[1]) ** 2 < 18 ** 2) {
        this.gate++; this.emit({ kind: "gate", owner: "player" });
      }
    }
    PICKUPS.forEach((pickup, index) => {
      if (this.pickupAt[index]! > this.time || ship.p.distanceToSquared(pickupPosition.set(...pickup.at)) > 10 ** 2) return;
      if (pickup.kind === "repair") ship.hull = Math.min(100, ship.hull + 25);
      if (pickup.kind === "energy") ship.energy = Math.min(100, ship.energy + 40);
      if (pickup.kind === "ammo") ship.rockets = Math.min(4, ship.rockets + 1);
      this.pickupAt[index] = this.time + 10;
      this.emit({ kind: "pickup", owner: "player", target: pickup.kind });
    });
  }
}
