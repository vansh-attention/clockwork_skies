import assert from "node:assert/strict";
import test from "node:test";
import { parseInviteOptions } from "./generate-invite.ts";

test("invite CLI accepts bounded uses and expiry", () => {
  assert.deepEqual(parseInviteOptions(["--uses=20", "--hours=72"]), { uses: 20, hours: 72 });
});

test("invite CLI rejects invalid, fractional and unknown options", () => {
  for (const args of [["--uses=0"], ["--uses=1.5"], ["--hours=NaN"], ["--hours=9000"], ["--use=1"]]) {
    assert.throws(() => parseInviteOptions(args));
  }
});
