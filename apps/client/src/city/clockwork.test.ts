import { expect, it } from "vitest";
import { anchorSwing, handAngles, tickValue } from "./clockwork";

const TAU = Math.PI * 2;

it("points the tower hands at the real time", () => {
  const three = handAngles(new Date(2026, 10, 6, 15, 0, 0));
  expect(three.hour).toBeCloseTo(Math.PI / 2);
  expect(three.minute).toBeCloseTo(0);
  const halfPastNine = handAngles(new Date(2026, 10, 6, 9, 30, 45));
  expect(halfPastNine.minute).toBeCloseTo(Math.PI);
  expect(halfPastNine.hour).toBeCloseTo(9.5 / 12 * TAU);
});

it("moves the gears in one short kick per second, then holds them still", () => {
  expect(tickValue(1000)).toBeCloseTo(0);
  const kicking = tickValue(1075);
  expect(kicking).toBeGreaterThan(0);
  expect(kicking).toBeLessThan(1);
  expect(tickValue(1150)).toBe(1);
  expect(tickValue(1999)).toBe(1);
  expect(tickValue(2150)).toBe(2);
});

it("rocks the escapement anchor to the opposite side on each tick", () => {
  expect(Math.abs(anchorSwing(1500))).toBeCloseTo(0.14);
  expect(anchorSwing(1500)).toBeCloseTo(-anchorSwing(2500));
  expect(anchorSwing(2000)).toBeCloseTo(anchorSwing(1999));
});
