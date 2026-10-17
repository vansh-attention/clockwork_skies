import { expect, it } from "vitest";
import { FixedClock } from "./clock";

it("simulates equal ticks at 30, 60 and 120 rendered FPS", () => {
  const count = (fps: number) => {
    const clock = new FixedClock(); let ticks = 0;
    for (let i = 0; i < fps * 4; i++) clock.step(1 / fps, () => ticks++);
    return ticks;
  };
  expect(count(30)).toBe(240);
  expect(count(60)).toBe(240);
  expect(count(120)).toBe(240);
});

it("caps catch-up to five steps and reports dropped time", () => {
  const clock = new FixedClock(); let ticks = 0;
  clock.step(2, () => ticks++);
  expect(ticks).toBe(5);
  expect(clock.dropped).toBeGreaterThan(1);
});

it("clears pending simulation time on pause reset", () => {
  const clock = new FixedClock(); let ticks = 0;
  clock.step(1 / 120, () => ticks++);
  clock.reset();
  clock.step(1 / 120, () => ticks++);
  expect(ticks).toBe(0);
});
