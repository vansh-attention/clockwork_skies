import type { BotProfile } from "@clockwork/shared";

export const BOT_PROFILES: BotProfile[] = [
  { id: "cadet", reactionSeconds: 0.7, aimError: 0.16, aggression: 0.42, lootBias: 0.8, evadeHullThreshold: 38 },
  { id: "wingman", reactionSeconds: 0.45, aimError: 0.1, aggression: 0.58, lootBias: 0.62, evadeHullThreshold: 30 },
  { id: "ace", reactionSeconds: 0.25, aimError: 0.055, aggression: 0.76, lootBias: 0.42, evadeHullThreshold: 24 },
];

export const PAINTS = [
  { id: "cream-copper", name: "Copper Courier", body: "#f0eadc", accent: "#b95f43", ink: "#374541" },
  { id: "sage-gold", name: "Garden Ace", body: "#d9dec5", accent: "#d29b44", ink: "#3e5147" },
  { id: "teal-coral", name: "Cloud Harbor", body: "#bad8d4", accent: "#c96150", ink: "#34494d" },
  { id: "blue-brass", name: "Observatory", body: "#c4d0dc", accent: "#c38b44", ink: "#36414d" },
] as const;

export const BOT_CALLSIGNS = [
  "BRASS FINCH", "RIVET", "KETTLE", "CLOUD MOTH", "TICKTOCK", "SPANNER", "SUNSPRING", "WINDUP",
  "COPPER FOX", "BLUE BELL", "CORKSCREW", "THIMBLE", "LANTERN", "GEARLING", "PAPER WASP", "NORTHSTAR",
];
