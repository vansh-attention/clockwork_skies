import { describe, expect, it } from "vitest";
import { angularDistance, V } from "./math.js";
import { MATCH_RULES } from "./rules.js";
import { applyDamage, applyPickup, createAircraft, NEUTRAL_INPUT, stepAircraft } from "./simulation.js";

describe("flight simulation", () => {
  it("keeps an aircraft within the configured flight shell", () => {
    const aircraft = createAircraft({ x: 0, y: MATCH_RULES.planetRadius + 60, z: 0 }, { x: 0, y: 0, z: -1 });
    for (let i = 0; i < 1200; i += 1) stepAircraft(aircraft, { ...NEUTRAL_INPUT, sequence: i }, 1 / 20);
    const radius = V.length(aircraft.position);
    expect(radius).toBeGreaterThanOrEqual(MATCH_RULES.planetRadius + MATCH_RULES.minAltitude - 0.01);
    expect(radius).toBeLessThanOrEqual(MATCH_RULES.planetRadius + MATCH_RULES.maxAltitude + 0.01);
  });

  it("uses shields before hull", () => {
    const aircraft = createAircraft({ x: 0, y: 410, z: 0 }, { x: 0, y: 0, z: -1 });
    aircraft.spawnProtection = 0; // Shield routing is tested after spawn immunity expires.
    aircraft.shield = 30;
    applyDamage(aircraft, 40);
    expect(aircraft.shield).toBe(0);
    expect(aircraft.hull).toBe(90);
  });

  it("applies pickup limits", () => {
    const aircraft = createAircraft({ x: 0, y: 410, z: 0 }, { x: 0, y: 0, z: -1 });
    aircraft.hull = 70;
    applyPickup(aircraft, { id: "repair", type: "repair", position: V.create(), active: true, respawnAt: 0 });
    expect(aircraft.hull).toBe(95);
  });

  it("computes geodesic angles", () => {
    expect(angularDistance({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(Math.PI / 2);
  });
});
