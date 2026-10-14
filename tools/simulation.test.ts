import assert from "node:assert/strict";
import test from "node:test";
import { runBotMatch } from "../apps/server/src/runBotMatch.js";

test("a fixed-seed 16-bot match completes deterministically on the authoritative room mechanics", () => {
  const a = runBotMatch({ seed: 123 });
  const b = runBotMatch({ seed: 123 });
  assert.equal(a.state.phase, "complete");
  assert.equal(Object.keys(a.state.players).length, 16);
  assert.ok(a.state.winnerId);
  assert.deepEqual(a.events, b.events);
  assert.equal(a.state.winnerId, b.state.winnerId);
  assert.equal(a.ticks, b.ticks);
  for (const player of Object.values(a.state.players)) {
    assert.ok(Number.isFinite(player.aircraft.position.x));
    assert.ok(player.aircraft.hull >= 0 && player.aircraft.hull <= 100);
  }
});
