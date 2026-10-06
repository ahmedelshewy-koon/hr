import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeRemoteDays, remoteCheckInAllowed, scheduledWorkMode } from "../app/attendance/attendance-calculation.ts";

// 2026-10-06 is a Tuesday (2), 2026-10-08 a Thursday (4), 2026-10-09 a Friday (5).
test("remote days keep only valid working weekdays, sorted and unique", () => {
  assert.equal(normalizeRemoteDays("4,2,9,2,x", "0,1,2,3,4"), "2,4");
  assert.equal(normalizeRemoteDays("5,6", "0,1,2,3,4"), "");
  assert.equal(normalizeRemoteDays(null, "0,1,2,3,4"), "");
  assert.equal(normalizeRemoteDays(" 1 , 3 ", null), "1,3");
});

test("the schedule says office unless the weekday is a remote day", () => {
  assert.equal(scheduledWorkMode("2026-10-06", "2,4"), "remote");
  assert.equal(scheduledWorkMode("2026-10-07", "2,4"), "office");
  assert.equal(scheduledWorkMode("2026-10-06", ""), "office");
  assert.throws(() => scheduledWorkMode("not-a-date", ""));
});

test("device punchers check in from the portal only on remote days or rest days", () => {
  const base = { workDays: "0,1,2,3,4", remoteDays: "4", punchesOnDevice: true };
  assert.equal(remoteCheckInAllowed({ ...base, workDate: "2026-10-06" }), false, "office day");
  assert.equal(remoteCheckInAllowed({ ...base, workDate: "2026-10-08" }), true, "remote day");
  assert.equal(remoteCheckInAllowed({ ...base, workDate: "2026-10-09" }), true, "rest day");
  assert.equal(remoteCheckInAllowed({ ...base, punchesOnDevice: false, workDate: "2026-10-06" }), true, "no device");
});

test("the daily calculation and the portal check-in follow the schedule", async () => {
  const service = await readFile(new URL("../app/attendance/attendance-service.ts", import.meta.url), "utf8");
  assert.match(service, /SELECT id,work_days,remote_days,/);
  assert.match(service, /storedType=!hasEvent\|\|/);
  assert.match(service, /scheduledWorkMode\(attendanceDate,String\(employee\.remote_days\|\|""\)\)/);
  const route = await readFile(new URL("../app/api/hr/route.ts", import.meta.url), "utf8");
  assert.match(route, /eventType==="check_in"&&Number\(employeeId\)===Number\(user\.employee_id\)/);
  assert.match(route, /remoteCheckInAllowed\(\{workDate,/);
  const profile = await readFile(new URL("../app/employees/profile-update.ts", import.meta.url), "utf8");
  assert.match(profile, /updates\.remote_days=normalizeRemoteDays\(/);
  const drawer = await readFile(new URL("../app/employee-drawer.tsx", import.meta.url), "utf8");
  assert.match(drawer, /remoteDays:employee\.remote_days\|\|""/);
  assert.match(drawer, /<RemoteDaysField rtl=\{rtl\} form=\{form\} update=\{update\}\/>/);
});
