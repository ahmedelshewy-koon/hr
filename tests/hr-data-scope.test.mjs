import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isBranchScopedHr, normalizeHrDataScope, seesWholeCompany, branchHrEmployeeSql } from "../app/employees/hr-data-scope.ts";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("only an HR Manager set to 'assigned' is a branch HR; Super Admin and the default HR manager see everyone", () => {
  assert.equal(normalizeHrDataScope(undefined), "all");
  assert.equal(normalizeHrDataScope("anything"), "all");
  assert.equal(normalizeHrDataScope("assigned"), "assigned");
  assert.equal(seesWholeCompany({ roleName: "Super Admin", hrDataScope: "assigned" }), true);
  assert.equal(seesWholeCompany({ roleName: "HR Manager", hrDataScope: null }), true);
  assert.equal(seesWholeCompany({ roleName: "HR Manager", hrDataScope: "assigned" }), false);
  assert.equal(isBranchScopedHr({ roleName: "HR Manager", hrDataScope: "assigned" }), true);
  assert.equal(isBranchScopedHr({ roleName: "Super Admin", hrDataScope: "assigned" }), false);
  assert.equal(isBranchScopedHr({ roleName: "Department Manager", hrDataScope: "assigned" }), false);
  assert.equal(seesWholeCompany({ roleName: "Department Manager", hrDataScope: "all" }), false);
});

test("a branch HR's predicate is the shared HR resolver matched to the account, plus its own record", async () => {
  const db = { prepare: () => ({ first: async () => ({ ready: false }) }) };
  assert.equal(await branchHrEmployeeSql(db, { id: 7, roleName: "HR Manager", employeeId: 12, hrDataScope: "all" }), null);
  assert.equal(await branchHrEmployeeSql(db, { id: 7, roleName: "HR Manager", employeeId: 12, hrDataScope: "assigned" }), "(e.hr_user_id=7 OR e.id=12)");
  assert.equal(await branchHrEmployeeSql(db, { id: 7, roleName: "HR Manager", employeeId: null, hrDataScope: "assigned" }), "(e.hr_user_id=7 OR e.id=-1)");
});

test("every employee-facing read path applies the branch HR scope", async () => {
  const [security, hr, dashboard, reports, overview, profile, learning, assets, options, attendance, biometric, lifecycle, organization, transfer, notifications] = await Promise.all([
    "app/api/api-security.ts", "app/api/hr/route.ts", "app/api/dashboard/route.ts", "app/api/reports/route.ts", "app/reports/report-overview-service.ts",
    "app/api/employees/[id]/route.ts", "app/api/learning/route.ts", "app/api/assets/route.ts", "app/api/talent/options/route.ts", "app/api/attendance-report/route.ts",
    "app/api/biometric-export/route.ts", "app/api/lifecycle/route.ts", "app/api/organization/route.ts", "app/api/organization/team-transfer/route.ts", "app/notifications/notification-service.ts",
  ].map(read));
  assert.match(security, /if \(seesWholeCompany\(actor\)\) return true;[\s\S]*if \(isBranchScopedHr\(actor\)\) return branchHrCanSee\(db, actor, employeeId\);/);
  assert.match(hr, /return branchHrCanSee\(d1,scopeActor\(user\),employeeId\)/);
  assert.match(hr, /const employeeScope=fullCompany\?\(branchHrSql\?\?"TRUE"\):/);
  assert.match(hr, /const payrollScope=branchHrSql\?/);
  for (const source of [dashboard, reports, overview, learning, assets, options, attendance, biometric]) assert.match(source, /branchHrEmployeeIds\(/);
  assert.match(profile, /if\(isBranchScopedHr\(scopeActor\)\)return branchHrCanSee\(db,scopeActor,employeeId\);/);
  assert.match(lifecycle, /if\(!seesWholeCompany\(actor\)\)\{const scoped=/);
  for (const source of [organization, transfer]) assert.doesNotMatch(source, /\['Super Admin','HR Manager'\]\.includes\(actor\.roleName\)/);
  assert.match(notifications, /WHERE r\.name='Super Admin' OR COALESCE\(u\.hr_data_scope,'all'\)='all' OR u\.id=\$\{hrSql\}/);
});

test("per-employee HR writes check scope and only Super Admin changes an account's HR visibility", async () => {
  const hr = await read("app/api/hr/route.ts");
  assert.ok((hr.match(/await assertEmployeeInScope\(d1,user,/g) || []).length >= 9);
  assert.match(hr, /if\(hrDataScope!==null&&user\.role_name!=="Super Admin"\)throw new Response\("Only the system administrator can change HR visibility"/);
  assert.match(hr, /hr_data_scope=COALESCE\(\?,hr_data_scope\)/);
  assert.match(hr, /action==="save_company"\|\|action==="save_hr_responsible"\)\{[\s\S]{0,200}assertNotBranchHr\(user\);/);
});
