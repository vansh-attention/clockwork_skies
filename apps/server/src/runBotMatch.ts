import { MATCH_RULES, type MatchEvent, type MatchRules } from "@clockwork/shared";
import { MatchRoom } from "./MatchRoom.js";
import { schemaToMatchState } from "./schema.js";

/** Fast, explicit harness rules; production MatchRoom never reads these from client options. */
export function fastMatchRules(maxPlayers = 16): MatchRules {
 return { ...MATCH_RULES, maxPlayers, lobbySeconds:0.1, deploymentSeconds:0.2, redeployDelaySeconds:0.3,
  phases:MATCH_RULES.phases.map(p=>({...p,durationSeconds:2,stormDamagePerSecond:p.stormDamagePerSecond*8})) };
}

/** Runs EXACTLY the MatchRoom lifecycle/physics/combat in fixed seconds, without sockets. */
export function runBotMatch(options: { seed?:number; rules?:MatchRules; maxSeconds?:number } = {}) {
 const rules = options.rules ?? fastMatchRules();
 const room = new MatchRoom(); room.roomId = "simulation";
 const events:MatchEvent[] = [];
 room.broadcast = ((_type:unknown, event:MatchEvent) => { events.push(event); }) as typeof room.broadcast;
 room.initializeSimulation({manual:true,rules,seed:options.seed ?? 42,startTime:1000000});
 let ticks=0;
 try {
  const maxTicks = Math.ceil((options.maxSeconds ?? 1200)*rules.tickRate);
  while(room.state.phase!=="complete" && ticks<maxTicks) { room.advanceSimulationForTest(1/rules.tickRate);ticks++; }
  const state=schemaToMatchState(room.state);
  if(state.phase!=="complete") throw new Error(`Match did not complete after ${ticks} ticks`);
  return { state, events, ticks, simulatedSeconds:ticks/rules.tickRate };
 } finally { room.clock.clear(); room.onDispose(); }
}
