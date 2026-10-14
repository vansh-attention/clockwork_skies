import {expect,it} from "vitest";
import {Encoder,Decoder} from "@colyseus/schema";
import {MatchStateSchema,PlayerSchema} from "../src/schema.js";
import {createAircraft} from "@clockwork/shared";
it("encodes join and nested movement patches under the actual TS test transform",()=>{
 const state=new MatchStateSchema(),decoded=new MatchStateSchema(),encoder=new Encoder(state),decoder=new Decoder(decoded);
 state.players.set("pilot",new PlayerSchema({id:"pilot",callsign:"PILOT",paint:"cream-copper",bot:false,connected:true,status:"active",redeploysRemaining:1,kills:0,aircraft:createAircraft({x:0,y:430,z:0},{x:0,y:0,z:-1})}));
 decoder.decode(encoder.encodeAll());expect(decoded.players.get("pilot")!.aircraft.position.y).toBe(430);
 encoder.discardChanges();state.players.get("pilot")!.aircraft.position.x=12;decoder.decode(encoder.encode());expect(decoded.players.get("pilot")!.aircraft.position.x).toBe(12);
});
