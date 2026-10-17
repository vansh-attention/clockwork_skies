import { expect, it } from "vitest";
import { createShip } from "./flight";

it("creates a stopped, normalized spacecraft at the spawn", () => {
  const ship = createShip("player");
  expect(ship.p.toArray()).toEqual([0, 0, 650]);
  expect(ship.prevP.toArray()).toEqual(ship.p.toArray());
  expect(ship.v.length()).toBe(0);
  expect(ship.q.length()).toBeCloseTo(1);
});
