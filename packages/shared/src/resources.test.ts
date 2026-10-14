import {expect,it} from "vitest";
import {MATCH_RULES} from "./rules.js";
import {applyPickup,createAircraft,NEUTRAL_INPUT,stepAircraft} from "./simulation.js";
import {V} from "./math.js";
it("bounds every pickup resource",()=>{
 const a=createAircraft({x:0,y:430,z:0},{x:0,y:0,z:-1});
 for(let i=0;i<100;i++)for(const type of ["repair","rockets","boost","shield"] as const) applyPickup(a,{id:type,type,position:V.create(),active:true,respawnAt:0});
 expect(a.hull).toBe(100);expect(a.rockets).toBe(6);expect(a.boost).toBe(100);expect(a.shield).toBe(60);
});
it("replays flight deterministically and drains/recharges boost in seconds",()=>{
 const run=()=>{const a=createAircraft({x:0,y:430,z:0},{x:0,y:0,z:-1});for(let i=1;i<=20;i++)stepAircraft(a,{...NEUTRAL_INPUT,sequence:i,boost:true,aimX:0.4},0.05);return a;};
 const a=run();expect(a).toEqual(run());expect(a.boost).toBeCloseTo(100-MATCH_RULES.aircraft.boostDrainPerSecond);
 for(let i=0;i<20;i++)stepAircraft(a,NEUTRAL_INPUT,0.05);expect(a.boost).toBeCloseTo(100-MATCH_RULES.aircraft.boostDrainPerSecond+MATCH_RULES.aircraft.boostRechargePerSecond);
});
