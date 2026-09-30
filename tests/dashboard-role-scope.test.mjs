import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("employee dashboard scope is self-only and manager scope includes self plus the recursive team", async () => {
  const [hr, dashboard] = await Promise.all([
    read("app/api/hr/route.ts"),
    read("app/api/dashboard/route.ts"),
  ]);
  assert.match(hr, /Department Manager.*\(e\.id=.*OR e\.department_id IN/s);
  assert.match(hr, /:`e\.id=\$\{Number\(user\.employee_id\)\|\|-1\}`/);
  assert.match(dashboard, /MANAGED_DEPARTMENTS_CTE/);
  assert.match(dashboard, /new Set\(\[actor\.employeeId,\.\.\.rows\.map/);
});

test("manager dashboard renders personal and team summaries together without a scope filter", async () => {
  const ui = await read("app/hr-app.tsx");
  assert.match(ui, /showPersonal=isManager\|\|isEmployee/);
  assert.match(ui, /teamEmployees=isManager\?.*Number\(row\.id\)!==selfEmployeeId/);
  assert.match(ui, /rtl\?"ملخصي الشخصي":"My personal summary"/);
  assert.match(ui, /rtl\?"ملخص الموظفين التابعين لي":"My reporting team overview"/);
  assert.doesNotMatch(ui, /dashboardScopeFilter/);
});

test("dashboard workforce and attendance statistics count full-time employees only", async () => {
  const [ui, dashboard] = await Promise.all([read("app/hr-app.tsx"), read("app/api/dashboard/route.ts")]);
  // Only full-time staff punch in and out; part-time and contract staff log shifts.
  assert.match(ui, /attendanceEmployees=isEmployee\?dashboardEmployees:dashboardEmployees\.filter\(row=>\(row\.employment_type\|\|"full_time"\)==="full_time"\)/);
  assert.match(ui, /totalEmployees=attendanceEmployees\.length/);
  assert.match(ui, /attendanceToday=allAttendanceToday\.filter\(row=>attendanceEmployeeIds\.has/);
  // Pending approvals still cover every employee in scope.
  assert.match(ui, /pendingRequests=.*dashboardEmployeeIds\.has/);
  assert.match(dashboard, /fullTime=actor\.roleName==="Employee"\?"":" AND COALESCE\(e\.employment_type,'full_time'\)='full_time'"/);
  // Headcount, check-ins, leave, absence candidates and attendance exceptions all use the predicate.
  for (const marker of ["AS active FROM employees", "AS present,", "AS on_leave", "AND EXTRACT(DOW", "FROM attendance_exceptions"]) {
    const line = dashboard.split("\n").find(row => row.includes(marker));
    assert.ok(line?.includes("${scoped}${fullTime}"), `${marker} must be limited to full-time employees`);
  }
  assert.equal((dashboard.match(/\$\{scoped\}\$\{fullTime\}/g) ?? []).length, 5);
});
