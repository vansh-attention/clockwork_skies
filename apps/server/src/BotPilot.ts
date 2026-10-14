import { angularDistance, NEUTRAL_INPUT, SeededRandom, tangentBasis, V, type InputCommand, type PlayerState, type StormState } from "@clockwork/shared";
import { BOT_PROFILES } from "@clockwork/content";

export type BotWorld = { players: PlayerState[]; storm: StormState; now: number };

export class BotPilot {
  private readonly rng: SeededRandom;
  private sequence = 0;
  private nextDecisionAt = 0;
  private targetId: string | null = null;
  private wander = 0;
  readonly profile = BOT_PROFILES[1]!;

  constructor(private readonly id: string, seed: number) { this.rng = new SeededRandom(seed); }

  think(self: PlayerState, world: BotWorld): InputCommand {
    if (world.now >= this.nextDecisionAt) {
      this.nextDecisionAt = world.now + this.profile.reactionSeconds * 1000;
      const candidates = world.players.filter((player) => player.id !== this.id && player.status === "active");
      candidates.sort((a, b) => V.distance(self.aircraft.position, a.aircraft.position) - V.distance(self.aircraft.position, b.aircraft.position));
      this.targetId = candidates[0]?.id ?? null;
      this.wander = this.rng.range(-0.65, 0.65);
    }

    const target = world.players.find((player) => player.id === this.targetId);
    const basis = tangentBasis(self.aircraft.position, self.aircraft.forward);
    let aimX = this.wander; let aimY = angularDistance(self.aircraft.position, world.storm.center) > world.storm.angularRadius * 0.86 ? 0.25 : -0.03;
    let distance = Infinity; let alignment = 0;
    if (target) {
      const toTarget = V.normalize(V.sub(target.aircraft.position, self.aircraft.position));
      distance = V.distance(target.aircraft.position, self.aircraft.position);
      aimX = Math.atan2(V.dot(toTarget, basis.right), V.dot(toTarget, basis.forward)) * 1.2 + this.rng.range(-this.profile.aimError, this.profile.aimError);
      aimY = -V.dot(toTarget, basis.up) * 1.25 + this.rng.range(-this.profile.aimError, this.profile.aimError);
      alignment = V.dot(toTarget, basis.forward);
    }
    const outside = angularDistance(self.aircraft.position, world.storm.center) > world.storm.angularRadius * 0.86;
    if (outside) {
      const inward = V.normalize(V.projectOnPlane(world.storm.center, basis.up), basis.forward);
      aimX = Math.atan2(V.dot(inward, basis.right), V.dot(inward, basis.forward)) * 1.6;
      aimY = 0.03;
    }
    const endangered = self.aircraft.hull < this.profile.evadeHullThreshold;
    return {
      ...NEUTRAL_INPUT,
      sequence: ++this.sequence,
      clientTime: world.now,
      aimX: Math.max(-1, Math.min(1, endangered && !outside ? -aimX : aimX)),
      aimY: Math.max(-1, Math.min(1, endangered && !outside ? -0.6 : aimY)),
      throttle: 0.72,
      fineRoll: Math.max(-1,Math.min(1,aimX)),
      cannon: !outside && distance < 150 && alignment > 0.92 && !endangered,
      rocket: !outside && distance < 130 && alignment > 0.96 && self.aircraft.rockets > 0 && !endangered,
      rocketTargetId: target?.id ?? null,
      boost: endangered || distance > 180,
    };
  }
}
