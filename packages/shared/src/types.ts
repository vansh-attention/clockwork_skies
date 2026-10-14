import { z } from "zod";
import type { Vec3 } from "./math.js";

export const PROTOCOL_VERSION = 1 as const;

export const inputCommandSchema = z.object({
  version: z.literal(PROTOCOL_VERSION),
  sequence: z.number().int().nonnegative().max(0xffffffff),
  clientTime: z.number().finite(),
  aimX: z.number().min(-1).max(1),
  aimY: z.number().min(-1).max(1),
  throttle: z.number().min(-1).max(1),
  fineRoll: z.number().min(-1).max(1),
  cannon: z.boolean(),
  rocket: z.boolean(),
  rocketTargetId: z.string().max(64).nullable(),
  boost: z.boolean(),
  rearView: z.boolean(),
  ping: z.enum(["enemy", "pickup", "danger", "destination"]).nullable(),
  emote: z.number().int().min(0).max(4),
});
export type InputCommand = z.infer<typeof inputCommandSchema>;

export type AircraftState = {
  position: Vec3;
  velocity: Vec3;
  forward: Vec3;
  speed: number;
  throttle: number;
  hull: number;
  shield: number;
  cannonHeat: number;
  rockets: number;
  boost: number;
  spawnProtection: number;
  lastInputSequence: number;
};

export type PlayerStatus = "lobby" | "active" | "redeploying" | "spectating" | "winner";

export type PlayerState = {
  id: string;
  callsign: string;
  paint: string;
  bot: boolean;
  connected: boolean;
  status: PlayerStatus;
  redeploysRemaining: number;
  kills: number;
  aircraft: AircraftState;
};

export type ProjectileState = {
  id: string;
  ownerId: string;
  targetId: string | null;
  position: Vec3;
  velocity: Vec3;
  ttl: number;
};

export type PickupType = "repair" | "rockets" | "boost" | "shield";
export type PickupState = { id: string; type: PickupType; position: Vec3; active: boolean; respawnAt: number };

export type MatchPhase = "lobby" | "deploying" | "open" | "closing-1" | "closing-2" | "close-combat" | "final" | "complete";

export type StormState = {
  center: Vec3;
  startCenter: Vec3;
  nextCenter: Vec3;
  angularRadius: number;
  startRadius: number;
  targetRadius: number;
  phaseStartedAt: number;
  phaseEndsAt: number;
};

export type MatchState = {
  version: typeof PROTOCOL_VERSION;
  id: string;
  seed: number;
  serverTime: number;
  phase: MatchPhase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  winnerId: string | null;
  players: Record<string, PlayerState>;
  projectiles: Record<string, ProjectileState>;
  pickups: Record<string, PickupState>;
  storm: StormState;
};

export type MatchEvent =
  | { type: "shot"; playerId: string }
  | { type: "rocket-fired"; playerId: string; projectileId: string; targetId: string }
  | { type: "damage"; playerId: string; sourceId: string; amount: number }
  | { type: "destroyed"; playerId: string; sourceId: string }
  | { type: "redeploy"; playerId: string; at: number }
  | { type: "pickup"; playerId: string; pickupId: string; pickupType: PickupType }
  | { type: "phase"; phase: MatchPhase }
  | { type: "ping"; playerId: string; kind: NonNullable<InputCommand["ping"]>; position: Vec3 }
  | { type: "emote"; playerId: string; emote: number }
  | { type: "winner"; playerId: string };

export const guestSessionSchema = z.object({
  token: z.string().min(16),
  guestId: z.string().min(1),
  callsign: z.string().min(2).max(18),
  expiresAt: z.number().int().positive(),
});
export type GuestSession = z.infer<typeof guestSessionSchema>;

export type BotProfile = {
  id: string;
  reactionSeconds: number;
  aimError: number;
  aggression: number;
  lootBias: number;
  evadeHullThreshold: number;
};

export type WorldManifest = {
  id: string;
  planetRadius: number;
  minAltitude: number;
  maxAltitude: number;
  landmarks: Array<{ id: string; name: string; direction: Vec3; radius: number; accent: string }>;
  pickupNodes: Array<{ id: string; direction: Vec3; altitude: number; type: PickupType }>;
};
