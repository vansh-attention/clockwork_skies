import type { MatchPhase, PickupType } from "./types.js";

export type PhaseRule = {
  phase: MatchPhase;
  durationSeconds: number;
  targetAngularRadius: number;
  stormDamagePerSecond: number;
  redeployAllowed: boolean;
};

export type MatchRules = {
  maxPlayers: number;
  tickRate: number;
  snapshotRate: number;
  lobbySeconds: number;
  deploymentSeconds: number;
  reconnectGraceSeconds: number;
  redeployDelaySeconds: number;
  planetRadius: number;
  minAltitude: number;
  maxAltitude: number;
  aircraft: {
    hull: number;
    cruiseSpeed: number;
    minSpeed: number;
    maxSpeed: number;
    acceleration: number;
    turnRate: number;
    pitchRate: number;
    rollRate: number;
    boostCapacity: number;
    boostDrainPerSecond: number;
    boostRechargePerSecond: number;
    boostMultiplier: number;
  };
  cannon: { damage: number; range: number; shotsPerSecond: number; heatPerShot: number; coolPerSecond: number; maxHeat: number };
  rocket: { damage: number; speed: number; ttlSeconds: number; lockSeconds: number; lockRange: number; cooldownSeconds: number };
  pickups: Record<PickupType, { amount: number; respawnSeconds: number }>;
  phases: PhaseRule[];
};

export const MATCH_RULES: MatchRules = {
  maxPlayers: 16,
  tickRate: 20,
  snapshotRate: 10,
  lobbySeconds: 30,
  deploymentSeconds: 12,
  reconnectGraceSeconds: 60,
  redeployDelaySeconds: 10,
  planetRadius: 350,
  minAltitude: 25,
  maxAltitude: 160,
  aircraft: {
    hull: 100,
    cruiseSpeed: 50,
    minSpeed: 30,
    maxSpeed: 72,
    acceleration: 18,
    turnRate: 1.05,
    pitchRate: 0.72,
    rollRate: 1.25,
    boostCapacity: 100,
    boostDrainPerSecond: 28,
    boostRechargePerSecond: 9,
    boostMultiplier: 1.42,
  },
  cannon: { damage: 8, range: 180, shotsPerSecond: 8, heatPerShot: 12, coolPerSecond: 24, maxHeat: 100 },
  rocket: { damage: 36, speed: 92, ttlSeconds: 5, lockSeconds: 1.2, lockRange: 150, cooldownSeconds: 2.5 },
  pickups: {
    repair: { amount: 25, respawnSeconds: 40 },
    rockets: { amount: 2, respawnSeconds: 35 },
    boost: { amount: 40, respawnSeconds: 30 },
    shield: { amount: 30, respawnSeconds: 45 },
  },
  phases: [
    { phase: "open", durationSeconds: 180, targetAngularRadius: Math.PI * 0.78, stormDamagePerSecond: 4, redeployAllowed: true },
    { phase: "closing-1", durationSeconds: 150, targetAngularRadius: Math.PI * 0.55, stormDamagePerSecond: 6, redeployAllowed: true },
    { phase: "closing-2", durationSeconds: 135, targetAngularRadius: Math.PI * 0.35, stormDamagePerSecond: 9, redeployAllowed: true },
    { phase: "close-combat", durationSeconds: 120, targetAngularRadius: Math.PI * 0.18, stormDamagePerSecond: 14, redeployAllowed: false },
    { phase: "final", durationSeconds: 100, targetAngularRadius: 0.025, stormDamagePerSecond: 30, redeployAllowed: false },
  ],
};
