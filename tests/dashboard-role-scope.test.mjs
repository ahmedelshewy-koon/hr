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
  assert.match(dashboard, /WITH RECURSIVE managed/);
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
