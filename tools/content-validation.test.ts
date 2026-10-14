import assert from "node:assert/strict";
import test from "node:test";
import { CLOCKWORK_WORLD } from "@clockwork/content";
import { validateWorld } from "./validate-content.ts";

test("accepts the original world with 40 unique pickup nodes", () => {
  const world = validateWorld(CLOCKWORK_WORLD);
  assert.equal(world.pickupNodes.length, 40);
  assert.equal(world.landmarks.length, 8);
});

test("rejects duplicate pickup identifiers", () => {
  const bad = structuredClone(CLOCKWORK_WORLD);
  bad.pickupNodes[1]!.id = bad.pickupNodes[0]!.id;
  assert.throws(() => validateWorld(bad), /unique/);
});

test("rejects pickup nodes outside the playable shell", () => {
  const bad = structuredClone(CLOCKWORK_WORLD);
  bad.pickupNodes[0]!.altitude = 1000;
  assert.throws(() => validateWorld(bad), /altitude/);
});

test("rejects unnormalised directions and unknown pickup types", () => {
  const bad = structuredClone(CLOCKWORK_WORLD);
  bad.landmarks[0]!.direction = { x: 10, y: 0, z: 0 };
  assert.throws(() => validateWorld(bad), /normalised/);
  assert.throws(() => validateWorld({ ...CLOCKWORK_WORLD, pickupNodes: [{ ...CLOCKWORK_WORLD.pickupNodes[0], type: "free-money" }] }));
});
