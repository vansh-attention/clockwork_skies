import { expect, it } from "vitest";
import { MatchRoom } from "../src/MatchRoom.js";
import { NEUTRAL_INPUT } from "@clockwork/shared";
it("neutralizes disconnected controls and removes consenting lobby leavers",()=>{
 const r=new MatchRoom(); r.initializeSimulation({manual:true});
 const c:any={sessionId:"human",auth:{callsign:"TEST"}};
 r.onJoin(c,{}); (r as any).receiveInput(c,{...NEUTRAL_INPUT,sequence:1,cannon:true}); r.onLeave(c);
 expect(r.state.players.has("human")).toBe(false);
 r.clock.clear(); r.onDispose();
});
it("resolves zero survivors rather than deadlocking",()=>{
 const r=new MatchRoom(); r.initializeSimulation({manual:true}); r.state.phase="final";
 const c:any={sessionId:"human",auth:{callsign:"TEST"}};
 r.state.phase="lobby";r.onJoin(c,{});r.state.phase="final";r.state.players.get("human")!.status="spectating";
 (r as any).checkWinner(100);expect(r.state.phase).toBe("complete");expect(r.state.winnerId).toBe("human");
 r.clock.clear(); r.onDispose();
});
