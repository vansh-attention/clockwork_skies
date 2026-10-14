import { expect,it } from "vitest";
import { angularDistance, createAircraft, stepAircraft, V, type PlayerState } from "@clockwork/shared";
import { BotPilot } from "../src/BotPilot.js";
const player=(id:string,pos={x:0,y:430,z:0}):PlayerState=>({id,callsign:id,paint:"cream-copper",bot:true,connected:true,status:"active",redeploysRemaining:1,kills:0,aircraft:createAircraft(pos,{x:0,y:0,z:-1})});
const storm={center:{x:0,y:1,z:0},startCenter:{x:0,y:1,z:0},nextCenter:{x:0,y:1,z:0},angularRadius:Math.PI,startRadius:Math.PI,targetRadius:Math.PI,phaseStartedAt:0,phaseEndsAt:10000};
it("turns toward an enemy on its right, not away",()=>{
 const self=player("self"),target=player("target",{x:40,y:430,z:-80});const pilot=new BotPilot("self",10);
 const input=pilot.think(self,{players:[self,target],storm,now:1000});expect(input.aimX).toBeGreaterThan(0);
 const before=V.dot(self.aircraft.forward,V.normalize(V.sub(target.aircraft.position,self.aircraft.position)));
 stepAircraft(self.aircraft,input,0.05);expect(V.dot(self.aircraft.forward,V.normalize(V.sub(target.aircraft.position,self.aircraft.position)))).toBeGreaterThan(before);
});
it("steers inward when outside the safe storm cap",()=>{
 const self=player("self"),pilot=new BotPilot("self",10);const s={...storm,center:V.normalize({x:1,y:1,z:0}),angularRadius:0.5};
 const before=angularDistance(self.aircraft.position,s.center);
 for(let i=0;i<180;i++)stepAircraft(self.aircraft,pilot.think(self,{players:[self],storm:s,now:1000+i*50}),0.05,s);
 expect(angularDistance(self.aircraft.position,s.center)).toBeLessThan(before);
});
