import { expect, it } from "vitest";
import { applyDamage, createAircraft, NEUTRAL_INPUT, stepAircraft, stormRadiusAt } from "./simulation.js";
import { inputCommandSchema } from "./types.js";
it("preserves spawn immunity then expires it in seconds", () => {
 const a = createAircraft({x:0,y:410,z:0},{x:0,y:0,z:-1});
 expect(applyDamage(a,40)).toBe(0);
 for(let i=0;i<61;i++) stepAircraft(a,NEUTRAL_INPUT,0.05);
 expect(a.spawnProtection).toBe(0); expect(applyDamage(a,40)).toBe(40);
});
it("rejects nonrepresentable input sequence",()=>expect(inputCommandSchema.safeParse({...NEUTRAL_INPUT,sequence:2**32}).success).toBe(false));
it("ignores nonfinite damage and reports actual damage only",()=>{
 const a=createAircraft({x:0,y:410,z:0},{x:0,y:0,z:-1}); a.spawnProtection=0;
 expect(applyDamage(a,NaN)).toBe(0); expect(a.hull).toBe(100);
 expect(applyDamage(a,1000)).toBe(100);
});
it("interpolates storm on millisecond phase timestamps",()=>{
 const s={center:{x:0,y:1,z:0},startCenter:{x:0,y:1,z:0},nextCenter:{x:0,y:1,z:0},angularRadius:3,startRadius:3,targetRadius:1,phaseStartedAt:1000,phaseEndsAt:3000};
 expect(stormRadiusAt(s,2000)).toBe(2);
});
