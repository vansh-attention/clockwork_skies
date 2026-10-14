import { expect, it } from "vitest";
import { MatchRoom } from "../src/MatchRoom.js";
import { MATCH_RULES, NEUTRAL_INPUT } from "@clockwork/shared";

it("requires enough heat headroom to fire another cannon shot", () => {
  const room = new MatchRoom(); room.initializeSimulation({manual:true});
  room.onJoin({sessionId:"pilot",auth:{callsign:"TEST"}} as any,{});
  const player = room.state.players.get("pilot")!; player.status="active";
  player.aircraft.cannonHeat=95;
  const events:unknown[]=[]; room.broadcast=((_:unknown,event:unknown)=>events.push(event)) as any;
  (room as any).fireCannon(player,{...NEUTRAL_INPUT,cannon:true},100000);
  expect(events).toHaveLength(0);
  player.aircraft.cannonHeat=MATCH_RULES.cannon.maxHeat-MATCH_RULES.cannon.heatPerShot;
  (room as any).fireCannon(player,{...NEUTRAL_INPUT,cannon:true},100000);
  expect(events).toHaveLength(1);
  room.clock.clear(); room.onDispose();
});
