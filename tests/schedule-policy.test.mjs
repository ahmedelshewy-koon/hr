import test from "node:test";
import assert from "node:assert/strict";
import { scheduledDailyMinutes } from "../app/employees/schedule-policy.ts";

test("daily hours are derived from check-in and check-out",()=>{
  assert.equal(scheduledDailyMinutes("09:00","17:00"),480);
  assert.equal(scheduledDailyMinutes("08:30","16:45"),495);
  assert.equal(scheduledDailyMinutes("22:00","06:00"),480);
  assert.equal(scheduledDailyMinutes("09:00:00","17:00:00"),480);
});

test("incomplete or identical times leave daily hours undefined",()=>{
  assert.equal(scheduledDailyMinutes("","17:00"),null);
  assert.equal(scheduledDailyMinutes("09:00",undefined),null);
  assert.equal(scheduledDailyMinutes("09:00","09:00"),null);
  assert.equal(scheduledDailyMinutes("25:00","17:00"),null);
});
