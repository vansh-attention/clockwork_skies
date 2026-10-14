import { createServer } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import express from "express";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "@colyseus/sdk";
import { MATCH_RULES, NEUTRAL_INPUT } from "@clockwork/shared";
import { MatchRoom } from "../src/MatchRoom.js";

const fast = { ...MATCH_RULES, lobbySeconds:1.5, deploymentSeconds:0.2, reconnectGraceSeconds:2,
 redeployDelaySeconds:0.2,maxPlayers:4,phases:MATCH_RULES.phases.map(p=>({...p,durationSeconds:1.2,stormDamagePerSecond:160})) };
class FastRoom extends MatchRoom { onCreate() { this.initializeSimulation({rules:fast,seed:123}); } }
let server:Server,client:Client;
let rooms:Room[]=[];
const wait=async(predicate:()=>boolean,timeout=10000)=>{
 const start=Date.now(); while(!predicate()) { if(Date.now()-start>timeout)throw new Error("State wait timed out"); await new Promise(r=>setTimeout(r,20)); }
};
beforeAll(async()=>{
 const http=createServer(express()); server=new Server({transport:new WebSocketTransport({server:http}),greet:false,gracefullyShutdown:false});
 server.define("test_match",FastRoom);await server.listen(0,"127.0.0.1");
 const addr=http.address();if(!addr||typeof addr==="string")throw new Error("No port");client=new Client(`http://127.0.0.1:${addr.port}`);
});
afterAll(async()=>{for(const r of rooms)if(r.connection.isOpen)await r.leave();await server.gracefullyShutdown(false);});
it("serializes joins for two SDK clients, accepts inputs, fills bots, reconnects and reaches winner",async()=>{
 const a=await client.joinOrCreate("test_match",{token:"ALPHA-LOCAL",callsign:"ALPHA"});rooms.push(a);
 const b=await client.joinOrCreate("test_match",{token:"ALPHA-LOCAL",callsign:"BRAVO",rules:{maxPlayers:99}});rooms.push(b);
 const events:any[]=[];a.onMessage("event",e=>events.push(e));b.onMessage("event",()=>{});
 expect(a.roomId).toBe(b.roomId);await wait(()=>a.state?.players?.size===2&&b.state?.players?.size===2);
 expect(a.state.players.get(a.sessionId).callsign).toBe("ALPHA");
 await wait(()=>a.state.players.size===4&&a.state.phase!=="lobby");
 expect([...a.state.players.values()].filter((p:any)=>p.bot)).toHaveLength(2);
 a.send("input",{...NEUTRAL_INPUT,sequence:9,boost:true,cannon:true});
 await wait(()=>a.state.players.get(a.sessionId).aircraft.lastInputSequence===9);
 a.send("input",{...NEUTRAL_INPUT,sequence:8});a.send("input",{...NEUTRAL_INPUT,sequence:2**32});a.send("input",{...NEUTRAL_INPUT,sequence:10,aimX:NaN});
 await new Promise(r=>setTimeout(r,200));expect(a.state.players.get(a.sessionId).aircraft.lastInputSequence).toBe(9);
 const token=a.reconnectionToken,id=a.sessionId;a.reconnection.enabled=false;a.connection.close(4001,"test interruption");
 await wait(()=>b.state.players.get(id).connected===false);
 const restored=await client.reconnect(token);rooms.push(restored);restored.onMessage("event",e=>events.push(e));
 expect(restored.sessionId).toBe(id);expect(restored.roomId).toBe(b.roomId);
 await wait(()=>b.state.players.get(id).connected===true&&restored.state?.players?.size===4);
 restored.send("input",{...NEUTRAL_INPUT,sequence:10});
 await wait(()=>restored.state.players.get(id).aircraft.lastInputSequence===10);
 await wait(()=>restored.state.phase==="complete",14000);
 await wait(()=>b.state.phase==="complete");
 expect(restored.state.winnerId).toBe(b.state.winnerId);expect(restored.state.players.get(restored.state.winnerId).status).toBe("winner");
 expect(events.some(e=>e.type==="winner")).toBe(true);
 expect([...b.state.players.values()].filter((p:any)=>p.status==="spectating")).toHaveLength(3);
});

it("final-eliminates a disconnected pilot after reconnect grace",async()=>{
 const a=await client.joinOrCreate("test_match",{token:"ALPHA-LOCAL",callsign:"DROP"});rooms.push(a);a.onMessage("event",()=>{});
 const b=await client.joinOrCreate("test_match",{token:"ALPHA-LOCAL",callsign:"WATCH"});rooms.push(b);b.onMessage("event",()=>{});
 await wait(()=>b.state?.players?.size===4);const id=a.sessionId;
 a.reconnection.enabled=false;a.connection.close(4001,"expired test");
 await wait(()=>b.state.players.get(id).connected===false);
 await wait(()=>b.state.players.get(id).status==="spectating",5000);
 expect(b.state.players.get(id).connected).toBe(false);
 await a.connection.close();await b.leave();
});
