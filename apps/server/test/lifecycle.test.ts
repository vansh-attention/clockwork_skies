import { describe, expect, it } from "vitest";
import { MATCH_RULES, NEUTRAL_INPUT, V } from "@clockwork/shared";
import { MatchRoom } from "../src/MatchRoom.js";
import { schemaToMatchState } from "../src/schema.js";

const rules = { ...MATCH_RULES, lobbySeconds:0.1, deploymentSeconds:0.1, redeployDelaySeconds:0.2,
 maxPlayers:4, phases:MATCH_RULES.phases.map(p=>({...p,durationSeconds:1,stormDamagePerSecond:150})) };
function room() { const r = new MatchRoom(); r.initializeSimulation({manual:true,rules,seed:42,startTime:100000}); return r; }
function join(r:MatchRoom,id:string) { const c:any={sessionId:id,auth:{callsign:id}};r.onJoin(c,{});return c; }
function steps(r:MatchRoom,n:number) { for(let i=0;i<n;i++)r.advanceSimulationForTest(0.05); }

describe("authoritative mechanics",()=>{
 it("has a repeatable full bot lifecycle with a winner",()=>{
  const run=()=>{ const r=room(); steps(r,400); const state=schemaToMatchState(r.state);r.clock.clear();r.onDispose();return state; };
  const a=run(),b=run();expect(a.phase).toBe("complete");expect(a.winnerId).toBeTruthy();expect(a.players).toEqual(b.players);expect(a.storm).toEqual(b.storm);
 });
 it("expires stale control without rolling acknowledgements backwards",()=>{
  const r=room(),c=join(r,"human");steps(r,4);
  (r as any).receiveInput(c,{...NEUTRAL_INPUT,sequence:7,boost:true,cannon:true,ping:"danger"});steps(r,2);
  expect(r.state.players.get(c.sessionId)!.aircraft.lastInputSequence).toBe(7);
  (r as any).receiveInput(c,{...NEUTRAL_INPUT,sequence:6}); steps(r,12);
  const p=r.state.players.get(c.sessionId)!;expect(p.aircraft.lastInputSequence).toBe(7);
  const heat=p.aircraft.cannonHeat;steps(r,3);expect(p.aircraft.cannonHeat).toBeLessThanOrEqual(heat);r.clock.clear();r.onDispose();
 });
 it("routes combat, pickups, redeployment, final elimination and spectator restrictions",()=>{
  const r=room(),a=join(r,"a"),b=join(r,"b");steps(r,4);
  const shooter=r.state.players.get("a")!,victim=r.state.players.get("b")!;
  shooter.aircraft.position.set({x:0,y:430,z:0});shooter.aircraft.forward.set({x:0,y:0,z:-1});
  victim.aircraft.position.set({x:0,y:430,z:-40});victim.aircraft.spawnProtection=0;victim.aircraft.shield=30;
  (r as any).fireCannon(shooter,{...NEUTRAL_INPUT,cannon:true},r.state.serverTime);
  expect(victim.aircraft.shield).toBe(22);expect(victim.aircraft.hull).toBe(100);
  (r as any).fireRocket(shooter,{...NEUTRAL_INPUT,rocket:true,rocketTargetId:"b"},r.state.serverTime);
  (r as any).fireRocket(shooter,{...NEUTRAL_INPUT,rocket:true,rocketTargetId:"b"},r.state.serverTime+MATCH_RULES.rocket.lockSeconds*1000);
  expect(r.state.projectiles.size).toBe(1);
  for(let i=0;i<40;i++)(r as any).updateProjectiles(0.05,r.state.serverTime+i*50);
  expect(r.state.projectiles.size).toBe(0);expect(victim.aircraft.hull).toBeLessThan(100);
  const pickup=[...r.state.pickups.values()][0]!;shooter.aircraft.position.set(pickup.position.toVec3());shooter.aircraft.hull=50;
  (r as any).collectPickup(shooter,r.state.serverTime);expect(pickup.active).toBe(false);
  (r as any).updatePickups(pickup.respawnAt);expect(pickup.active).toBe(true);
  (r as any).damage(victim,1000,"a",r.state.serverTime);expect(victim.status).toBe("redeploying");steps(r,5);
  expect(victim.status).toBe("active");expect(victim.redeploysRemaining).toBe(0);expect(victim.aircraft.rockets).toBe(0);
  r.state.phase="close-combat";victim.aircraft.spawnProtection=0;(r as any).damage(victim,1000,"a",r.state.serverTime);
  expect(victim.status).toBe("spectating");(r as any).receiveInput(b,{...NEUTRAL_INPUT,sequence:500,cannon:true});
  expect((r as any).latestInputs.get("b")?.sequence ?? 0).toBeLessThan(500);r.clock.clear();r.onDispose();
 });
});
