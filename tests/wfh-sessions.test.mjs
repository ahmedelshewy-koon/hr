import test from "node:test";
import assert from "node:assert/strict";
import { validateWfhTransition } from "../app/wfh/rules.ts";

test("WFH supports another session after checkout but never two open sessions", () => {
  assert.equal(validateWfhTransition("check_in", null, new Date("2026-10-13T07:00:00Z")), true);
  assert.throws(() => validateWfhTransition("check_in", { checked_in_at: "2026-10-13T07:00:00Z" }, new Date("2026-10-13T08:00:00Z")), /already open/);
  assert.equal(validateWfhTransition("check_in", null, new Date("2026-10-13T09:00:00Z")), true);
});

test("checkout requires an open session and cannot precede checkin", () => {
  assert.throws(() => validateWfhTransition("check_out", null, new Date("2026-10-13T08:00:00Z")), /No open/);
  assert.throws(() => validateWfhTransition("force_checkout", { checked_in_at: "2026-10-13T09:00:00Z" }, new Date("2026-10-13T08:00:00Z")), /after check-in/);
  assert.equal(validateWfhTransition("force_checkout", { checked_in_at: "2026-10-13T07:00:00Z" }, new Date("2026-10-13T08:00:00Z")), true);
});
