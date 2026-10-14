import { expect, it } from "vitest";
import { createAircraft, NEUTRAL_INPUT, stepAircraft } from "./simulation.js";
import { V } from "./math.js";

it("integrates held pitch identically at server and command rates", () => {
  const a = createAircraft({x:0,y:475,z:0},{x:0,y:0,z:-1}); const b = structuredClone(a);
  const input = {...NEUTRAL_INPUT, aimY:0.6};
  for(let i=0;i<80;i++) stepAircraft(a,input,1/20);
  for(let i=0;i<120;i++) stepAircraft(b,input,1/30);
  expect(V.distance(a.position,b.position)).toBeLessThan(0.01);
  expect(V.distance(a.forward,b.forward)).toBeLessThan(0.0001);
});

it("held pitch changes altitude rather than discarding pitch every tick", () => {
  const a = createAircraft({x:0,y:475,z:0},{x:0,y:0,z:-1});
  for(let i=0;i<20;i++) stepAircraft(a,{...NEUTRAL_INPUT,aimY:0.6},1/20);
  expect(V.length(a.position)).toBeLessThan(470);
});

it("fine roll controls have server-visible steering effect", () => {
  const a = createAircraft({x:0,y:475,z:0},{x:0,y:0,z:-1}); const b = structuredClone(a);
  for(let i=0;i<20;i++) { stepAircraft(a,{...NEUTRAL_INPUT,fineRoll:1},1/20); stepAircraft(b,NEUTRAL_INPUT,1/20); }
  expect(V.distance(a.forward,b.forward)).toBeGreaterThan(0.1);
});
