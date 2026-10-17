import { Combat } from "./combat";
import { createShip } from "./flight";
import { DRONE_SPAWNS, GATES, SPAWN, TARGETS } from "./map";
import type { Event, Mode, Ship, XYZ } from "./types";

export class SpaceSession {
  readonly player = createShip("player", SPAWN);
  readonly drones = Array.from({ length: 6 }, (_, i) => createShip(`drone-${i}`));
  readonly ships: Ship[] = [this.player, ...this.drones];
  readonly combat = new Combat();
  readonly events: Event[] = [];
  mode: Mode = "training";
  time = 0; gate = 0; result: "playing" | "won" | "lost" = "playing";
  warning = false; flashUntil = 0; benchmark = false;
  private activeCount = 3;
  reset(mode: Mode, count = 3, _seed = 42, benchmark = false): void {
    this.mode = mode; this.time = 0; this.gate = 0; this.result = "playing";
    this.warning = false; this.benchmark = benchmark; this.flashUntil = 0;
    this.events.length = 0; this.combat.reset();
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
}
