import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseAttendanceReportFilters } from "../app/attendance/attendance-report.ts";

const parse = query => parseAttendanceReportFilters(new URL("https://hr.example/api/attendance-report?" + query));
const rejects = query => assert.throws(() => parse(query), error => error instanceof Response && error.status === 400);

test("attendance report accepts one employee or everyone for a valid period", () => {
  assert.deepEqual(parse("employeeId=12&from=2026-09-01&to=2026-09-19"), { employeeId: 12, from: "2026-09-01", to: "2026-09-19", country: "" });
  assert.deepEqual(parse("employeeId=&from=2026-09-01&to=2026-09-01"), { employeeId: 0, from: "2026-09-01", to: "2026-09-01", country: "" });
  assert.deepEqual(parse("country=Saudi+Arabia&from=2026-09-01&to=2026-09-30"), { employeeId: 0, from: "2026-09-01", to: "2026-09-30", country: "Saudi Arabia" });
});

test("attendance report rejects bad dates, reversed and oversized periods, and bad employees", () => {
  rejects("from=2026-09-01");
  rejects("from=2026-02-31&to=2026-03-05");
  rejects("from=2026-09-19&to=2026-09-01");
  rejects("from=2025-01-01&to=2026-09-19");
  rejects("employeeId=-3&from=2026-09-01&to=2026-09-19");
  rejects("employeeId=abc&from=2026-09-01&to=2026-09-19");
  rejects("country=" + "x".repeat(61) + "&from=2026-09-01&to=2026-09-19");
  assert.doesNotThrow(() => parse("from=2026-01-01&to=2026-12-31"));
});

test("attendance report is HR-only, audited when exported, and reachable from the biometric tabs", async () => {
  const read = file => readFile(new URL(file, import.meta.url), "utf8");
  const [route, service, workspace] = await Promise.all([read("../app/api/attendance-report/route.ts"), read("../app/attendance/attendance-report.ts"), read("../app/biometric-workspace.tsx")]);
  assert.match(route, /\["Super Admin", "HR Manager"\]\.includes\(actor\.roleName\)/);
  assert.match(route, /attendance_report_exported/);
  assert.match(service, /overtime_minutes/);
  assert.match(service, /late_minutes/);
  assert.match(service, /\^\[=\+\\-@/);
  assert.match(workspace, /<AttendanceReportPanel/);
});
