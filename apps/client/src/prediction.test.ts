import { describe, expect, it } from "vitest";
import { createAircraft, NEUTRAL_INPUT, stepAircraft } from "@clockwork/shared";
import { LocalPredictor } from "./prediction";

describe("prediction reconciliation", () => {
  it("replays unacknowledged input exactly once from the authoritative baseline", () => {
    const server = createAircraft({ x: 0, y: 430, z: 0 }, { x: 0, y: 0, z: -1 });
    const predictor = new LocalPredictor();
    predictor.reconcile(server);
    const command = { ...NEUTRAL_INPUT, sequence: 1, aimX: 0.5, boost: true };
    predictor.push(command);
    const expected = structuredClone(server);
    stepAircraft(expected, command, 1 / 30);
    predictor.reconcile(server);
    expect(predictor.value).toEqual(expected);
    predictor.reconcile(server);
    expect(predictor.value).toEqual(expected);
    expect(server.lastInputSequence).toBe(0);
  });
});
