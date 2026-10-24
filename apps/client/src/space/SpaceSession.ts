import { Vector3 } from "three";
import { SeededRandom } from "@clockwork/shared";
import { Combat } from "./combat";
import { createShip, forwardOf, stepShip } from "./flight";
import { firstHit, moveWithCollisions } from "./collision";
import { DRONE_SPAWNS, EXTENT, GATES, OBSTACLES, PICKUPS, SPAWN, TARGETS } from "./map";
import { neutral, type Controls, type Event, type Mode, type Ship, type XYZ } from "./types";

const pickupPosition = new Vector3();
const to = new Vector3(), forward = new Vector3(), right = new Vector3(), up = new Vector3(), probe = new Vector3();

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
  private nextFire = new Float64Array(6);
  private aimError = new Float64Array(6);
  private nextThink = new Float64Array(6);
  private sensed = Array.from({ length: 6 }, () => new Vector3());
  private seenUntil = new Float64Array(6);
  private rng = new SeededRandom(42);
  readonly emit = (event: Event) => {
    if (this.events.length < 32) this.events.push(event);
    if (event.target === "player" && event.kind === "hit") this.flashUntil = this.time + 0.15;
  };
  reset(mode: Mode, count = 3, seed = 42, benchmark = false): void {
    this.mode = mode; this.time = 0; this.gate = 0; this.result = "playing";
    this.warning = false; this.benchmark = benchmark; this.flashUntil = 0;
    this.events.length = 0; this.combat.reset(); this.pickupAt.fill(0);
    this.rng = new SeededRandom(seed);
    this.nextFire.fill(3); this.nextThink.fill(0); this.aimError.fill(0); this.seenUntil.fill(0);
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
    if (this.mode === "skirmish") this.drones.forEach((drone, index) => {
      if (drone.hull <= 0) return;
      const input = this.droneInput(drone, index, dt);
      stepShip(drone, input, dt); moveWithCollisions(drone, OBSTACLES, this.time);
      this.combat.weapon(drone, input, dt, this.time, this.ships, OBSTACLES, this.emit);
    });
    this.combat.advance(dt, this.ships, OBSTACLES, this.emit);
    if (this.player.hull <= 0 && !this.benchmark) { this.result = "lost"; return; }
    this.objectives(dt);
    if (this.benchmark) {
      this.player.hull = 100;
      for (let index = 0; index < this.activeCount; index++) {
        const drone = this.drones[index]!;
        if (drone.hull <= 0) {
          drone.p.set(...(this.mode === "training" ? TARGETS[index % 3]! : DRONE_SPAWNS[index]!));
          drone.prevP.copy(drone.p); drone.v.set(0, 0, 0); drone.q.identity(); drone.prevQ.copy(drone.q);
          drone.hull = this.mode === "training" ? 30 : 60;
          this.nextFire[index] = this.time + 3;
        }
      }
      return;
    }
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
  private droneInput(drone: Ship, index: number, dt: number): Controls {
    const controls = neutral();
    if (this.time >= this.nextThink[index]!) {
      to.subVectors(this.player.p, drone.p);
      if (to.lengthSq() <= 450 ** 2 && !firstHit(drone.p, to, 0, OBSTACLES)) {
        this.sensed[index]!.copy(this.player.p); this.seenUntil[index] = this.time + 1;
      }
      this.aimError[index] = this.rng.range(-0.035, 0.035);
      this.nextThink[index] = this.time + 0.25;
    }
    const hasTarget = this.time < this.seenUntil[index]!;
    if (hasTarget) to.copy(this.sensed[index]!);
    else to.set(...DRONE_SPAWNS[(index + 1) % 6]!);
    to.sub(drone.p); const distance = to.length(); to.normalize();
    forwardOf(drone, forward);
    right.set(1, 0, 0).applyQuaternion(drone.q);
    up.set(0, 1, 0).applyQuaternion(drone.q);
    const clampTurn = (angle: number) => Math.max(-1.2 * dt, Math.min(1.2 * dt, angle));
    controls.yaw = clampTurn(-Math.atan2(to.dot(right), to.dot(forward)) + this.aimError[index]!);
    controls.pitch = clampTurn(Math.asin(Math.max(-1, Math.min(1, to.dot(up)))) + this.aimError[index]! * 0.5);
    controls.forward = distance > 90 ? 0.65 : -0.2;
    controls.strafe = Math.sin(this.time * 0.7 + index) * 0.2;
    const avoid = firstHit(drone.p, probe.copy(forward).multiplyScalar(30), 3, OBSTACLES);
    if (avoid) {
      const side = avoid.normal.dot(right) >= 0 ? 1 : -1;
      controls.forward = 0.15; controls.strafe = side * 0.65;
      controls.lift = avoid.normal.dot(up) * 0.6;
      controls.yaw = clampTurn(controls.yaw - side * 0.8 * dt);
    }
    if (hasTarget && !avoid && distance < 250 &&
      to.dot(forward) > Math.cos(7 * Math.PI / 180) && this.time >= this.nextFire[index]!) {
      probe.subVectors(this.player.p, drone.p);
      if (!firstHit(drone.p, probe, 0, OBSTACLES)) {
        controls.fire = true; this.nextFire[index] = this.time + 1.2;
      }
    }
    return controls;
  }
}
