import { expect,it } from "vitest";
import jwt from "jsonwebtoken";
import { createInvite,consumeInvite,verifyGuestToken } from "../src/invite.js";
import { MatchRoom } from "../src/MatchRoom.js";
import { MATCH_RULES,NEUTRAL_INPUT } from "@clockwork/shared";
it("rejects malformed signed guest claims",()=>{
 const token=jwt.sign({guestId:123,callsign:{},inviteNonce:"x"},"secret",{issuer:"clockwork-skies"});
 expect(verifyGuestToken("secret",token)).toBe(null);
});
it("rejects extra invite token components",()=>{
 const invite=createInvite("secret",1,Date.now()+10000);expect(consumeInvite(invite+".junk","secret")).toBe(null);
});
it("preserves monotonic acknowledgement across redeploy",()=>{
 const r=new MatchRoom();r.initializeSimulation({manual:true});const c:any={sessionId:"a",auth:{callsign:"a"}};r.onJoin(c,{});
 const p=r.state.players.get("a")!;p.aircraft.lastInputSequence=42;p.status="redeploying";(r as any).redeploy(p,r.state.serverTime);
 expect(p.aircraft.lastInputSequence).toBe(42);r.clock.clear();r.onDispose();
});
it("requires sustained server-side rocket lock",()=>{
 const r=new MatchRoom();r.initializeSimulation({manual:true});
 for(const id of ["a","b"])r.onJoin({sessionId:id,auth:{callsign:id}} as any,{});
 const a=r.state.players.get("a")!,b=r.state.players.get("b")!;a.status=b.status="active";
 a.aircraft.position.set({x:0,y:430,z:0});a.aircraft.forward.set({x:0,y:0,z:-1});b.aircraft.position.set({x:0,y:430,z:-40});
 const cmd={...NEUTRAL_INPUT,rocket:true,rocketTargetId:"b"};const t=r.state.serverTime;
 (r as any).fireRocket(a,cmd,t);expect(r.state.projectiles.size).toBe(0);
 (r as any).fireRocket(a,cmd,t+MATCH_RULES.rocket.lockSeconds*1000);expect(r.state.projectiles.size).toBe(1);
 r.clock.clear();r.onDispose();
});
