import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { MATCH_RULES } from "@clockwork/shared";
import { fastMatchRules, runBotMatch } from "../apps/server/src/runBotMatch.js";

const options = { matches: 10, seed: 42, fast: false };
for (const arg of process.argv.slice(2)) {
  if (arg === "--fast") { options.fast = true; continue; }
  const match = /^--(matches|seed)=(\d+)$/.exec(arg);
  if (!match) throw new Error(`Unknown option ${arg}. Use --matches=N --seed=N [--fast].`);
  const key = match[1] as "matches" | "seed";
  const value = Number(match[2]);
  if (!Number.isSafeInteger(value) || value < 1 || value > (key === "matches" ? 1000 : 0xffffffff)) throw new Error(`${key} out of range`);
  options[key] = value;
}

const summaries = [];
const started = performance.now();
for (let i = 0; i < options.matches; i++) {
  const seed = (options.seed + i) >>> 0;
  const rules = options.fast ? fastMatchRules() : MATCH_RULES;
  const a = runBotMatch({ seed, rules });
  const b = runBotMatch({ seed, rules });
  assert.equal(Object.keys(a.state.players).length, 16);
  assert.equal(a.state.phase, "complete");
  assert.ok(a.state.winnerId);
  assert.deepEqual(a.events, b.events, `seed ${seed}: event sequence diverged`);
  assert.deepEqual(a.state, b.state, `seed ${seed}: final state diverged`);
  assert.equal(a.ticks, b.ticks);
  for (const player of Object.values(a.state.players)) {
    const aircraft = player.aircraft;
    for (const value of [...Object.values(aircraft.position), ...Object.values(aircraft.velocity), aircraft.hull, aircraft.boost]) assert.ok(Number.isFinite(value), `seed ${seed}: invalid numeric state`);
    assert.ok(aircraft.hull >= 0 && aircraft.hull <= rules.aircraft.hull);
  }
  summaries.push({ seed, winner: a.state.winnerId, ticks: a.ticks, simulatedSeconds: a.simulatedSeconds, events: a.events.length, eventHash: createHash("sha256").update(JSON.stringify(a.events)).digest("hex") });
}
const result = { ok: true, seeds: summaries.length, executions: summaries.length * 2, pilotsPerMatch: 16, rules: options.fast ? "accelerated-test" : "normal", elapsedMs: Math.round(performance.now() - started), summaries };
mkdirSync("test-results", { recursive: true });
writeFileSync("test-results/simulation-results.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
