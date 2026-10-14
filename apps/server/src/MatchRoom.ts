import { randomUUID } from "node:crypto";
import { Room, type AuthContext, type Client } from "@colyseus/core";
import {
  MATCH_RULES,
  NEUTRAL_INPUT,
  SeededRandom,
  V,
  angularDistance,
  applyDamage,
  applyPickup,
  createAircraft,
  inputCommandSchema,
  stepAircraft,
  stormCenterAt,
  stormRadiusAt,
  type MatchRules,
  type InputCommand,
  type MatchEvent,
  type MatchPhase,
  type PlayerState,
} from "@clockwork/shared";
import { BOT_CALLSIGNS, CLOCKWORK_WORLD, PAINTS } from "@clockwork/content";
import { BotPilot } from "./BotPilot.js";
import { getInviteSecret, verifyGuestToken } from "./invite.js";
import { metrics } from "./metrics.js";
import { MatchStateSchema, PickupSchema, PlayerSchema, ProjectileSchema } from "./schema.js";

type AuthData = { guestId: string; callsign: string; inviteNonce: string };
type JoinOptions = { token?: string; sessionToken?: string; callsign?: string; paint?: string };

export type SimulationOptions = { rules?: MatchRules; seed?: number; startTime?: number; manual?: boolean };

const validPaint = (id: string | undefined) => PAINTS.some((paint) => paint.id === id) ? id! : PAINTS[0].id;

export class MatchRoom extends Room<{ state: MatchStateSchema }> {
  maxClients = MATCH_RULES.maxPlayers;
  patchRate = 1000 / MATCH_RULES.snapshotRate;
  maxMessagesPerSecond = 120;
  private readonly latestInputs = new Map<string, InputCommand>();
  private readonly bots = new Map<string, BotPilot>();
  private readonly lastCannonAt = new Map<string, number>();
  private readonly lastRocketAt = new Map<string, number>();
  private readonly rocketLocks = new Map<string, { targetId:string; since:number }>();
  private readonly redeployAt = new Map<string, number>();
  private rng = new SeededRandom(1);
  private rules: MatchRules = MATCH_RULES;
  private inputReceivedAt = new Map<string, number>();
  private lastSignalSequence = new Map<string, number>();
  private eliminatedAt = new Map<string, number>();
  private rocketCounter = 0;
  private manualSimulation = false;
  private phaseIndex = -1;

  onCreate() { this.initializeSimulation(); }

  /** Trusted server-side harness only: never accepts matchmaking/join options. dt is seconds, time is ms. */
  initializeSimulation(options: SimulationOptions = {}) {
    this.rules = options.rules ?? MATCH_RULES;
    this.manualSimulation = options.manual ?? false;
    this.maxClients = this.rules.maxPlayers;
    this.patchRate = 1000 / this.rules.snapshotRate;
    const now = options.startTime ?? Date.now();
    const seed = options.seed ?? Math.floor(Math.random() * 0xffffffff);
    this.rng = new SeededRandom(seed);
    const configuredDelay = Number(process.env.MATCH_START_DELAY_SECONDS ?? this.rules.lobbySeconds);
    const startDelay = Number.isFinite(configuredDelay) && configuredDelay > 0 ? configuredDelay : this.rules.lobbySeconds;
    const state = new MatchStateSchema();
    state.id = this.roomId;
    state.seed = seed >>> 0;
    state.serverTime = now;
    state.phase = "lobby";
    state.phaseStartedAt = now;
    state.phaseEndsAt = now + startDelay * 1000;
    state.storm.phaseStartedAt = now;
    state.storm.phaseEndsAt = state.phaseEndsAt;
    this.setState(state);
    this.initializePickups();
    this.onMessage("input", (client, payload) => this.receiveInput(client, payload));
    if (!options.manual) this.setFixedTimestep(({ dt }) => this.advanceSimulationForTest(dt), this.rules.tickRate);
    metrics.rooms += 1;
    console.log(JSON.stringify({ level: "info", event: "room_created", roomId: this.roomId, at: now }));
  }

  onAuth(_client: Client, options: JoinOptions, _context: AuthContext): AuthData | false {
    const secret = getInviteSecret();
    if (!options || typeof options !== "object") return false;
    const token = options.sessionToken ?? options.token ?? "";
    if (typeof token !== "string" || token.length > 4096) return false;
    const verified = verifyGuestToken(secret, token);
    if (verified) return verified;
    if (process.env.NODE_ENV !== "production" && token === "ALPHA-LOCAL") {
      return { guestId: `local_${randomUUID()}`, callsign: typeof options.callsign === "string" ? options.callsign.trim().slice(0,18) : "TEST PILOT", inviteNonce: "local" };
    }
    return false;
  }

  onJoin(client: Client, options: JoinOptions) {
    const auth = client.auth as AuthData;
    if (this.state.phase !== "lobby") throw new Error("Match already in progress");
    const direction = this.spawnDirection(this.state.players.size);
    const position = V.scale(direction, this.rules.planetRadius + 125);
    const forward = V.normalize(V.cross(direction, { x: 0, y: 1, z: 0 }), { x: 0, y: 0, z: -1 });
    const player: PlayerState = {
      id: client.sessionId,
      callsign: (auth.callsign || options.callsign || "PILOT").slice(0, 18).toUpperCase(),
      paint: validPaint(options.paint),
      bot: false,
      connected: true,
      status: "lobby",
      redeploysRemaining: 1,
      kills: 0,
      aircraft: createAircraft(position, forward, this.rules),
    };
    this.state.players.set(client.sessionId, new PlayerSchema(player));
    this.latestInputs.set(client.sessionId, { ...NEUTRAL_INPUT });
    metrics.joins += 1;
    console.log(JSON.stringify({ level: "info", event: "pilot_joined", roomId: this.roomId, playerId: client.sessionId }));
  }

  async onDrop(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    this.latestInputs.delete(client.sessionId);
    this.inputReceivedAt.delete(client.sessionId);
    metrics.disconnects += 1;
    try {
      await this.allowReconnection(client, this.rules.reconnectGraceSeconds);
    } catch {
      this.onLeave(client);
    }
  }

  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = true;
      this.latestInputs.set(client.sessionId, { ...NEUTRAL_INPUT, sequence: player.aircraft.lastInputSequence });
    }
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false;
      if (this.state.phase === "lobby") this.state.players.delete(client.sessionId);
      else if (player.status !== "winner") { player.status = "spectating"; this.redeployAt.delete(player.id); }
    }
    this.latestInputs.delete(client.sessionId);
    this.inputReceivedAt.delete(client.sessionId);
  }

  onDispose() {
    metrics.rooms = Math.max(0, metrics.rooms - 1);
  }

  private receiveInput(client: Client, payload: unknown) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.connected || !["lobby", "active"].includes(player.status)) return;
    const result = inputCommandSchema.safeParse(payload);
    if (!result.success) return;
    const previous = this.latestInputs.get(client.sessionId);
    if (previous && result.data.sequence <= previous.sequence) return;
    if (result.data.sequence <= player.aircraft.lastInputSequence) return;
    this.latestInputs.set(client.sessionId, result.data);
    this.inputReceivedAt.set(client.sessionId, this.state.serverTime);
  }

  advanceSimulationForTest(dt: number, now = this.state.serverTime + dt * 1000) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25 || !Number.isFinite(now) || now < this.state.serverTime) throw new Error("Invalid simulation step");
    const started = performance.now();
    this.state.serverTime = now;
    this.advancePhase(now);
    if (this.state.phase !== "lobby" && this.state.phase !== "complete") {
      this.updateStorm(now);
      this.updatePlayers(dt, now);
      this.updateProjectiles(dt, now);
      this.updatePickups(now);
      this.checkWinner(now);
    }
    const duration = performance.now() - started;
    metrics.ticks += 1;
    metrics.tickDurationTotalMs += duration;
    metrics.tickDurationMaxMs = Math.max(metrics.tickDurationMaxMs, duration);
  }

  private advancePhase(now: number) {
    if (now < this.state.phaseEndsAt || this.state.phase === "complete") return;
    if (this.state.phase === "lobby") {
      this.fillWithBots();
      if (!this.manualSimulation) void this.lock();
      this.state.phase = "deploying";
      this.state.phaseStartedAt = now;
      this.state.phaseEndsAt = now + this.rules.deploymentSeconds * 1000;
      this.state.players.forEach((player) => { player.status = "active"; });
      this.emit({ type: "phase", phase: "deploying" });
      return;
    }
    this.phaseIndex += 1;
    const rule = this.rules.phases[this.phaseIndex];
    if (!rule) {
      this.phaseIndex = this.rules.phases.length - 1;
      this.state.phase = "final";
      this.state.phaseEndsAt = now + 30_000;
      return;
    }
    const previousCenter = this.state.storm.center.toVec3();
    const nextCenter = this.randomDirectionNear(previousCenter, Math.min(0.7, this.state.storm.angularRadius * 0.5));
    this.state.phase = rule.phase;
    this.state.phaseStartedAt = now;
    this.state.phaseEndsAt = now + rule.durationSeconds * 1000;
    this.state.storm.startCenter.set(previousCenter);
    this.state.storm.nextCenter.set(nextCenter);
    this.state.storm.startRadius = this.state.storm.angularRadius;
    this.state.storm.targetRadius = rule.targetAngularRadius;
    this.state.storm.phaseStartedAt = now;
    this.state.storm.phaseEndsAt = this.state.phaseEndsAt;
    this.emit({ type: "phase", phase: rule.phase });
  }

  private updateStorm(now: number) {
    const storm = {
      center: this.state.storm.center.toVec3(), startCenter: this.state.storm.startCenter.toVec3(), nextCenter: this.state.storm.nextCenter.toVec3(),
      angularRadius: this.state.storm.angularRadius, startRadius: this.state.storm.startRadius, targetRadius: this.state.storm.targetRadius,
      phaseStartedAt: this.state.storm.phaseStartedAt, phaseEndsAt: this.state.storm.phaseEndsAt,
    };
    this.state.storm.angularRadius = stormRadiusAt(storm, now);
    this.state.storm.center.set(stormCenterAt(storm, now));
  }

  private updatePlayers(dt: number, now: number) {
    const plainPlayers = this.playerStates();
    const currentPhase = this.rules.phases.find((rule) => rule.phase === this.state.phase);
    this.state.players.forEach((player, id) => {
      if (player.status === "redeploying") {
        const readyAt = this.redeployAt.get(id) ?? Infinity;
        if (currentPhase && !currentPhase.redeployAllowed) { player.status = "spectating"; this.redeployAt.delete(id); }
        else if (now >= readyAt) this.redeploy(player, now);
        return;
      }
      if (player.status !== "active") return;
      const plain = this.toPlayerState(player);
      const input = player.bot
        ? this.bots.get(id)!.think(plain, { players: plainPlayers, storm: this.stormState(), now })
        : player.connected && now - (this.inputReceivedAt.get(id) ?? -Infinity) <= 500
          ? this.latestInputs.get(id) ?? NEUTRAL_INPUT
          : { ...NEUTRAL_INPUT, sequence: player.aircraft.lastInputSequence };
      const result = stepAircraft(plain.aircraft, input, dt, this.stormState(), this.rules);
      player.aircraft.set(plain.aircraft);
      if (result.collided) this.damage(player, result.collisionDamage, id, now);
      if (result.outsideStorm && currentPhase) this.damage(player, currentPhase.stormDamagePerSecond * dt, "storm", now);
      if (player.status !== "active") return;
      this.collectPickup(player, now);
      this.fireCannon(player, input, now);
      this.fireRocket(player, input, now);
      const newSignal = input.sequence > (this.lastSignalSequence.get(id) ?? 0);
      if (newSignal) this.lastSignalSequence.set(id, input.sequence);
      if (newSignal && input.ping && !player.bot) this.emit({ type: "ping", playerId: id, kind: input.ping, position: player.aircraft.position.toVec3() });
      if (newSignal && input.emote > 0 && !player.bot) this.emit({ type: "emote", playerId: id, emote: input.emote });
    });
  }

  private fireCannon(shooter: PlayerSchema, input: InputCommand, now: number) {
    if (!input.cannon || shooter.aircraft.cannonHeat + this.rules.cannon.heatPerShot > this.rules.cannon.maxHeat) return;
    const last = this.lastCannonAt.get(shooter.id) ?? 0;
    if (now - last < 1000 / this.rules.cannon.shotsPerSecond) return;
    this.lastCannonAt.set(shooter.id, now);
    shooter.aircraft.cannonHeat = Math.min(this.rules.cannon.maxHeat, shooter.aircraft.cannonHeat + this.rules.cannon.heatPerShot);
    const origin = shooter.aircraft.position.toVec3(); const direction = V.normalize(shooter.aircraft.forward.toVec3());
    let victim: PlayerSchema | null = null; let closest = this.rules.cannon.range;
    this.state.players.forEach((target) => {
      if (target.id === shooter.id || target.status !== "active") return;
      const offset = V.sub(target.aircraft.position.toVec3(), origin);
      const along = V.dot(offset, direction);
      const miss = V.length(V.sub(offset, V.scale(direction, along)));
      if (along > 0 && along < closest && miss < 7) { victim = target; closest = along; }
    });
    this.emit({ type: "shot", playerId: shooter.id });
    if (victim) this.damage(victim, this.rules.cannon.damage, shooter.id, now);
  }

  private fireRocket(shooter: PlayerSchema, input: InputCommand, now: number) {
    if (!input.rocketTargetId || shooter.aircraft.rockets <= 0) { this.rocketLocks.delete(shooter.id); return; }
    const target = this.state.players.get(input.rocketTargetId);
    if (!target || target.id === shooter.id || target.status !== "active") { this.rocketLocks.delete(shooter.id); return; }
    const offset = V.sub(target.aircraft.position.toVec3(), shooter.aircraft.position.toVec3());
    if (V.length(offset) > this.rules.rocket.lockRange || V.dot(V.normalize(offset), V.normalize(shooter.aircraft.forward.toVec3())) < 0.91) { this.rocketLocks.delete(shooter.id); return; }
    let lock = this.rocketLocks.get(shooter.id);
    if (!lock || lock.targetId !== target.id) { lock = {targetId:target.id,since:now};this.rocketLocks.set(shooter.id,lock); }
    if (!input.rocket || now-lock.since < this.rules.rocket.lockSeconds*1000) return;
    const last = this.lastRocketAt.get(shooter.id) ?? -Infinity;
    if (now-last < this.rules.rocket.cooldownSeconds*1000) return;
    this.lastRocketAt.set(shooter.id, now);
    shooter.aircraft.rockets -= 1;
    const id = `rocket_${++this.rocketCounter}`;
    const projectile = new ProjectileSchema({ id, ownerId: shooter.id, targetId: target.id, position: shooter.aircraft.position.toVec3(),
      velocity: V.scale(V.normalize(shooter.aircraft.forward.toVec3()), this.rules.rocket.speed), ttl: this.rules.rocket.ttlSeconds });
    this.state.projectiles.set(id, projectile);
    this.emit({ type: "rocket-fired", playerId: shooter.id, projectileId: id, targetId: target.id });
  }

  private updateProjectiles(dt: number, now: number) {
    const remove: string[] = [];
    this.state.projectiles.forEach((projectile, id) => {
      projectile.ttl -= dt;
      const target = this.state.players.get(projectile.targetId);
      let velocity = projectile.velocity.toVec3();
      if (target?.status === "active") {
        const desired = V.scale(V.normalize(V.sub(target.aircraft.position.toVec3(), projectile.position.toVec3())), this.rules.rocket.speed);
        velocity = V.lerp(velocity, desired, 1 - Math.exp(-3.6 * dt));
      }
      projectile.velocity.set(velocity);
      projectile.position.set(V.add(projectile.position.toVec3(), V.scale(velocity, dt)));
      if (target?.status === "active" && V.distance(projectile.position.toVec3(), target.aircraft.position.toVec3()) < 7) {
        this.damage(target, this.rules.rocket.damage, projectile.ownerId, now); remove.push(id);
      } else if (projectile.ttl <= 0 || V.length(projectile.position.toVec3()) < this.rules.planetRadius + 5) remove.push(id);
    });
    remove.forEach((id) => this.state.projectiles.delete(id));
  }

  private collectPickup(player: PlayerSchema, now: number) {
    this.state.pickups.forEach((pickup) => {
      if (!pickup.active || V.distance(player.aircraft.position.toVec3(), pickup.position.toVec3()) > 10) return;
      const aircraft = player.aircraft.toAircraft();
      applyPickup(aircraft, { id: pickup.id, type: pickup.pickupType as "repair", position: pickup.position.toVec3(), active: true, respawnAt: 0 }, this.rules);
      player.aircraft.set(aircraft); pickup.active = false; pickup.respawnAt = now + this.rules.pickups[pickup.pickupType as "repair"].respawnSeconds * 1000;
      this.emit({ type: "pickup", playerId: player.id, pickupId: pickup.id, pickupType: pickup.pickupType as "repair" });
    });
  }

  private updatePickups(now: number) { this.state.pickups.forEach((pickup) => { if (!pickup.active && pickup.respawnAt <= now) pickup.active = true; }); }

  private damage(player: PlayerSchema, amount: number, sourceId: string, now: number) {
    if (player.status !== "active") return;
    const aircraft = player.aircraft.toAircraft(); const applied = applyDamage(aircraft, amount); player.aircraft.set(aircraft);
    if (applied > 0) this.emit({ type: "damage", playerId: player.id, sourceId, amount: applied });
    if (aircraft.hull <= 0) this.destroy(player, sourceId, now);
  }

  private destroy(player: PlayerSchema, sourceId: string, now: number) {
    if (player.status !== "active") return;
    const phase = this.rules.phases.find((rule) => rule.phase === this.state.phase);
    if (sourceId !== player.id) { const source = this.state.players.get(sourceId); if (source) source.kills += 1; }
    this.rocketLocks.delete(player.id);
    this.eliminatedAt.set(player.id, now);
    this.emit({ type: "destroyed", playerId: player.id, sourceId });
    if (player.redeploysRemaining > 0 && phase?.redeployAllowed) {
      player.redeploysRemaining -= 1; player.status = "redeploying";
      const at = now + this.rules.redeployDelaySeconds * 1000; this.redeployAt.set(player.id, at);
      this.emit({ type: "redeploy", playerId: player.id, at });
    } else player.status = "spectating";
  }

  private redeploy(player: PlayerSchema, now: number) {
    const center = this.state.storm.center.toVec3();
    const direction = this.randomDirectionNear(center, Math.max(0.08, this.state.storm.angularRadius * 0.78));
    const tangent = V.normalize(V.cross(direction, { x: 0, y: 1, z: 0 }), { x: 0, y: 0, z: -1 });
    const aircraft = createAircraft(V.scale(direction, this.rules.planetRadius + 135), tangent, this.rules);
    aircraft.rockets = 0; aircraft.spawnProtection = 3;
    aircraft.lastInputSequence = player.aircraft.lastInputSequence;
    this.latestInputs.delete(player.id); this.inputReceivedAt.delete(player.id); this.rocketLocks.delete(player.id);
    player.aircraft.set(aircraft); player.status = "active"; this.redeployAt.delete(player.id);
    console.log(JSON.stringify({ level: "info", event: "redeploy", roomId: this.roomId, playerId: player.id, at: now }));
  }

  private checkWinner(now: number) {
    if (["lobby", "deploying", "complete"].includes(this.state.phase)) return;
    const contenders = [...this.state.players.values()].filter((player) => player.status === "active" || player.status === "redeploying");
    if (contenders.length > 1) return;
    // Simultaneous final elimination: latest elimination, then kills, then stable id.
    const winner = contenders[0] ?? [...this.state.players.values()].sort((a,b) =>
      (this.eliminatedAt.get(b.id) ?? 0) - (this.eliminatedAt.get(a.id) ?? 0) || b.kills - a.kills || a.id.localeCompare(b.id))[0];
    if (!winner) return;
     winner.status = "winner"; this.state.winnerId = winner.id; this.state.phase = "complete"; this.state.phaseEndsAt = now;
    metrics.matchesCompleted += 1; this.emit({ type: "winner", playerId: winner.id });
  }

  private initializePickups() {
    for (const node of CLOCKWORK_WORLD.pickupNodes) {
      const position = V.scale(node.direction, CLOCKWORK_WORLD.planetRadius + node.altitude);
      this.state.pickups.set(node.id, new PickupSchema({ id: node.id, type: node.type, position, active: true, respawnAt: 0 }));
    }
  }

  private fillWithBots() {
    const missing = this.rules.maxPlayers - this.state.players.size;
    for (let index = 0; index < missing; index += 1) {
      const id = `bot_${String(index + 1).padStart(2, "0")}_${this.roomId}`;
      const direction = this.spawnDirection(this.state.players.size); const position = V.scale(direction, this.rules.planetRadius + 125);
      const forward = V.normalize(V.cross(direction, { x: 0, y: 1, z: 0 }), { x: 0, y: 0, z: -1 });
      this.state.players.set(id, new PlayerSchema({ id, callsign: BOT_CALLSIGNS[index % BOT_CALLSIGNS.length]!, paint: PAINTS[index % PAINTS.length]!.id,
        bot: true, connected: true, status: "active", redeploysRemaining: 1, kills: 0, aircraft: createAircraft(position, forward, this.rules) }));
      this.bots.set(id, new BotPilot(id, this.state.seed + index * 101)); metrics.botsCreated += 1;
    }
  }

  private spawnDirection(index: number) {
    const angle = index / this.rules.maxPlayers * Math.PI * 2;
    return V.normalize({ x: Math.cos(angle), y: 0.22 * Math.sin(angle * 3), z: Math.sin(angle) });
  }

  private randomDirectionNear(center: { x: number; y: number; z: number }, angularRange: number) {
    const basis = V.normalize(V.cross(center, Math.abs(center.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }));
    const axis = V.normalize(V.cross(center, basis));
    const offset = this.rng.range(0, angularRange); const bearing = this.rng.range(0, Math.PI * 2);
    return V.normalize(V.add(V.scale(center, Math.cos(offset)), V.scale(V.add(V.scale(basis, Math.cos(bearing)), V.scale(axis, Math.sin(bearing))), Math.sin(offset))));
  }

  private toPlayerState(player: PlayerSchema): PlayerState {
    return { id: player.id, callsign: player.callsign, paint: player.paint, bot: player.bot, connected: player.connected,
      status: player.status as PlayerState["status"], redeploysRemaining: player.redeploysRemaining, kills: player.kills, aircraft: player.aircraft.toAircraft() };
  }
  private playerStates() { return [...this.state.players.values()].map((player) => this.toPlayerState(player)); }
  private stormState() { return { center: this.state.storm.center.toVec3(), startCenter: this.state.storm.startCenter.toVec3(), nextCenter: this.state.storm.nextCenter.toVec3(),
    angularRadius: this.state.storm.angularRadius, startRadius: this.state.storm.startRadius, targetRadius: this.state.storm.targetRadius,
    phaseStartedAt: this.state.storm.phaseStartedAt, phaseEndsAt: this.state.storm.phaseEndsAt }; }
  private emit(event: MatchEvent) { this.broadcast("event", event); }
}

