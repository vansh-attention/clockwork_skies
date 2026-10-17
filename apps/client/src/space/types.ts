import type { Quaternion, Vector3 } from "three";

export type Mode = "training" | "skirmish";
export type Phase = "menu" | "playing" | "paused" | "won" | "lost";
export type XYZ = readonly [number, number, number];
export type Obstacle = { id: string; center: XYZ } &
  ({ kind: "box"; half: XYZ } | { kind: "sphere"; radius: number });
export type Controls = {
  yaw: number; pitch: number; roll: number; forward: number; strafe: number;
  lift: number; boost: boolean; brake: boolean; fire: boolean; rocket: boolean;
};
export const neutral = (): Controls => ({ yaw: 0, pitch: 0, roll: 0, forward: 0,
  strafe: 0, lift: 0, boost: false, brake: false, fire: false, rocket: false });
export type Ship = {
  id: string; team: "pilot" | "drone"; p: Vector3; prevP: Vector3;
  v: Vector3; q: Quaternion; prevQ: Quaternion; hull: number; heat: number;
  energy: number; rockets: number; lastShot: number; nextRocket: number;
  lockId: string | null; lockTime: number; impactAt: number;
};
export type Event = { kind: "shot" | "hit" | "destroyed" | "pickup" | "gate" | "rocket";
  owner: string; target?: string };
export type HUD = {
  phase: Phase; mode: Mode; busy: boolean; hull: number; heat: number; energy: number;
  speed: number; rockets: number; remaining: number; gate: number;
  lock: number; warning: boolean; objective: string; flash: boolean;
  fps: number; p95: number; calls: number; triangles: number;
  markerX: number; markerY: number; markerBehind: boolean; markerDistance: number;
  markerOffscreen: boolean; markerBearing: number; markerKind: "gate" | "target" | "none";
  markerHull: number; notice: string;
};
export const RULES = {
  hz: 60, maxSteps: 5, speed: 60, reverse: 30, boostSpeed: 110,
  assist: 4, brake: 15, rollRate: 1.6, energyDrain: 25, energyRecover: 12,
  hull: 100, radius: 3, cannonRange: 500, cannonInterval: 1 / 7,
  heatPerShot: 16, heatCool: 25, cannonDamage: 10, droneDamage: 5,
  lockSeconds: 0.9, rocketRange: 320, rocketInterval: 1.8,
  rocketSpeed: 140, rocketLife: 3, rocketDamage: 35,
} as const;
