import { schema, t } from "@colyseus/schema";
import type { AircraftState, MatchState, PickupState, PlayerState, ProjectileState, StormState, Vec3 } from "@clockwork/shared";

export class Vec3Schema extends schema({
 x: t.float32().default(0), y: t.float32().default(0), z: t.float32().default(0)
}, "Vec3Schema") {
  constructor(value?: any) { super(); if (value) this.set(value as Vec3); }
  set(value: Vec3) { this.x = value.x; this.y = value.y; this.z = value.z; return this; }
  toVec3(): Vec3 { return { x: this.x, y: this.y, z: this.z }; }
}

export class AircraftSchema extends schema({
 position: t.ref(Vec3Schema).default(() => new Vec3Schema()), velocity: t.ref(Vec3Schema).default(() => new Vec3Schema()),
 forward: t.ref(Vec3Schema).default(() => new Vec3Schema({x:0,y:0,z:-1})),
 speed:t.float32().default(0), throttle:t.float32().default(0), hull:t.float32().default(100), shield:t.float32().default(0),
 cannonHeat:t.float32().default(0), rockets:t.uint8().default(2), boost:t.float32().default(100),
 spawnProtection:t.float32().default(0), lastInputSequence:t.uint32().default(0)
}, "AircraftSchema") {
  set(value: AircraftState) {
    this.position.set(value.position); this.velocity.set(value.velocity); this.forward.set(value.forward);
    this.speed = value.speed; this.throttle = value.throttle; this.hull = value.hull; this.shield = value.shield;
    this.cannonHeat = value.cannonHeat; this.rockets = value.rockets; this.boost = value.boost;
    this.spawnProtection = value.spawnProtection; this.lastInputSequence = value.lastInputSequence;
  }
  toAircraft(): AircraftState {
    return { position: this.position.toVec3(), velocity: this.velocity.toVec3(), forward: this.forward.toVec3(), speed: this.speed,
      throttle: this.throttle, hull: this.hull, shield: this.shield, cannonHeat: this.cannonHeat, rockets: this.rockets,
      boost: this.boost, spawnProtection: this.spawnProtection, lastInputSequence: this.lastInputSequence };
  }
}

export class PlayerSchema extends schema({
 id:t.string().default(""), callsign:t.string().default(""), paint:t.string().default("cream-copper"), bot:t.boolean().default(false), connected:t.boolean().default(true), status:t.string().default("lobby"),
 redeploysRemaining:t.uint8().default(1), kills:t.uint8().default(0), aircraft:t.ref(AircraftSchema).default(() => new AircraftSchema())
}, "PlayerSchema") {
  constructor(value?: any) { super(); if (value) this.set(value as PlayerState); }
  set(value: PlayerState) {
    this.id = value.id; this.callsign = value.callsign; this.paint = value.paint; this.bot = value.bot;
    this.connected = value.connected; this.status = value.status; this.redeploysRemaining = value.redeploysRemaining;
    this.kills = value.kills; this.aircraft.set(value.aircraft);
  }
}

export class ProjectileSchema extends schema({
 id:t.string().default(""), ownerId:t.string().default(""), targetId:t.string().default(""), position:t.ref(Vec3Schema).default(() => new Vec3Schema()), velocity:t.ref(Vec3Schema).default(() => new Vec3Schema()), ttl:t.float32().default(0)
}, "ProjectileSchema") {
  constructor(value?: any) { super(); if (value) this.set(value as ProjectileState); }
  set(value: ProjectileState) {
    this.id = value.id; this.ownerId = value.ownerId; this.targetId = value.targetId ?? "";
    this.position.set(value.position); this.velocity.set(value.velocity); this.ttl = value.ttl;
  }
}

export class PickupSchema extends schema({
 id:t.string().default(""), pickupType:t.string().default("repair"), position:t.ref(Vec3Schema).default(() => new Vec3Schema()), active:t.boolean().default(true), respawnAt:t.float64().default(0)
}, "PickupSchema") {
  constructor(value?: any) { super(); if (value) this.set(value as PickupState); }
  set(value: PickupState) { this.id = value.id; this.pickupType = value.type; this.position.set(value.position); this.active = value.active; this.respawnAt = value.respawnAt; }
}

export class StormSchema extends schema({
 center:t.ref(Vec3Schema).default(() => new Vec3Schema({x:0,y:1,z:0})),startCenter:t.ref(Vec3Schema).default(() => new Vec3Schema({x:0,y:1,z:0})),nextCenter:t.ref(Vec3Schema).default(() => new Vec3Schema({x:0,y:1,z:0})),
 angularRadius:t.float32().default(Math.PI),startRadius:t.float32().default(Math.PI),targetRadius:t.float32().default(Math.PI),phaseStartedAt:t.float64().default(0),phaseEndsAt:t.float64().default(0)
}, "StormSchema") {
  set(value: StormState) {
    this.center.set(value.center); this.startCenter.set(value.startCenter); this.nextCenter.set(value.nextCenter);
    this.angularRadius = value.angularRadius; this.startRadius = value.startRadius; this.targetRadius = value.targetRadius;
    this.phaseStartedAt = value.phaseStartedAt; this.phaseEndsAt = value.phaseEndsAt;
  }
}

export class MatchStateSchema extends schema({
 version:t.uint8().default(1),id:t.string().default(""),seed:t.uint32().default(0),serverTime:t.float64().default(0),phase:t.string().default("lobby"),phaseStartedAt:t.float64().default(0),phaseEndsAt:t.float64().default(0),winnerId:t.string().default(""),
 players:t.map(PlayerSchema),projectiles:t.map(ProjectileSchema),pickups:t.map(PickupSchema),storm:t.ref(StormSchema).default(() => new StormSchema())
}, "MatchStateSchema") {

}

export function schemaToMatchState(state: MatchStateSchema): MatchState {
  const players: MatchState["players"] = {};
  state.players.forEach((player, id) => {
    players[id] = { id, callsign: player.callsign, paint: player.paint, bot: player.bot, connected: player.connected,
      status: player.status as PlayerState["status"], redeploysRemaining: player.redeploysRemaining, kills: player.kills,
      aircraft: player.aircraft.toAircraft() };
  });
  const projectiles: MatchState["projectiles"] = {};
  state.projectiles.forEach((projectile, id) => { projectiles[id] = { id, ownerId: projectile.ownerId, targetId: projectile.targetId || null, position: projectile.position.toVec3(), velocity: projectile.velocity.toVec3(), ttl: projectile.ttl }; });
  const pickups: MatchState["pickups"] = {};
  state.pickups.forEach((pickup, id) => { pickups[id] = { id, type: pickup.pickupType as PickupState["type"], position: pickup.position.toVec3(), active: pickup.active, respawnAt: pickup.respawnAt }; });
  return { version: 1, id: state.id, seed: state.seed, serverTime: state.serverTime, phase: state.phase as MatchState["phase"], phaseStartedAt: state.phaseStartedAt,
    phaseEndsAt: state.phaseEndsAt, winnerId: state.winnerId || null, players, projectiles, pickups,
    storm: { center: state.storm.center.toVec3(), startCenter: state.storm.startCenter.toVec3(), nextCenter: state.storm.nextCenter.toVec3(), angularRadius: state.storm.angularRadius,
      startRadius: state.storm.startRadius, targetRadius: state.storm.targetRadius, phaseStartedAt: state.storm.phaseStartedAt, phaseEndsAt: state.storm.phaseEndsAt } };
}

