import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { requirePayrollPage, PAYROLL_PAGE_PERMISSIONS, payrollPageForAction, payrollPageGrants } from "../app/payroll/permissions.ts";
import { timesheetAccess } from "../app/timesheet/access.ts";

const actor = { id: 8, roleId: 3, roleName: "HR Manager" };
function fakeDb(roleAllowed, personalAllowed) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("FROM permissions")) return roleAllowed == null ? null : { allowed: roleAllowed };
              if (sql.includes("FROM user_permissions")) return personalAllowed == null ? null : { allowed: personalAllowed };
              throw Error(sql);
            },
          };
        },
      };
    },
  };
}

test("all specified Payroll and attendance routes have distinct permission keys", () => {
  assert.equal(PAYROLL_PAGE_PERMISSIONS["/payroll/run"], "payrollRun");
  assert.equal(PAYROLL_PAGE_PERMISSIONS["/wfh-checkin"], "wfhCheckin");
  assert.equal(PAYROLL_PAGE_PERMISSIONS["/saved-attendance"], "savedAttendance");
  assert.equal(new Set(Object.values(PAYROLL_PAGE_PERMISSIONS)).size, Object.keys(PAYROLL_PAGE_PERMISSIONS).length);
  for(const route of Object.keys(PAYROLL_PAGE_PERMISSIONS)) assert.ok(existsSync(`app${route}/page.tsx`),`Missing route ${route}`);
});

test("personal denial overrides a role grant, and a role denial cannot be elevated by a personal grant", async () => {
  await assert.rejects(() => requirePayrollPage(fakeDb(1, 0), actor, "payrollRun", "view"), e => e instanceof Response && e.status === 403);
  await assert.rejects(() => requirePayrollPage(fakeDb(0, 1), actor, "payrollRun", "view"), e => e instanceof Response && e.status === 403);
  await requirePayrollPage(fakeDb(1, 1), actor, "payrollRun", "view");
  await requirePayrollPage(fakeDb(1, null), actor, "payrollRun", "view");
});

test("each Payroll API mutation maps to its own page rather than a general Payroll grant", () => {
  assert.equal(payrollPageForAction("save_element"), "payrollElementSetup");
  assert.equal(payrollPageForAction("calculate_run"), "payrollRun");
  assert.equal(payrollPageForAction("save_erp"), "sajelErpSetup");
  assert.equal(payrollPageForAction("assign_business_unit"), "businessUnitSetup");
  assert.equal(payrollPageForAction("delete_business_unit"), "businessUnitSetup");
  assert.equal(payrollPageForAction("import_cost_centers"), "costCenterSetup");
  assert.equal(payrollPageForAction("bulk_delete_cost_centers"), "costCenterSetup");
  assert.equal(payrollPageForAction("unknown"), null);
});

test("workspace grants are reported per page, including explicit personal denial", async () => {
  const grants = await payrollPageGrants(fakeDb(1, 0), actor);
  assert.equal(grants.payrollRun, false);
  assert.equal(grants.payrollElementSetup, false);
  assert.equal(grants.wfhCheckin, false);
});

test("Timesheet gate requires an active listed HR manager and respects the latest personal denial", async () => {
  function db(listed, personal) {
    return {prepare(sql) {return {
      async first() {if(sql.includes("to_regclass")) return {ready:true};throw Error(sql);},
      bind() {return {
        async first() {if(sql.includes("FROM hr_managers")) return listed?{listed:1}:null;if(sql.includes("FROM user_permissions")) return personal==null?null:{allowed:personal};throw Error(sql);},
        async all() {if(sql.includes("FROM permissions")) return {results:[{action:"view"},{action:"edit"},{action:"approve"}]};throw Error(sql);},
      };},
    };}};
  }
  assert.equal((await timesheetAccess(db(true,1),actor)).canEdit,true);
  assert.equal((await timesheetAccess(db(true,0),actor)).canView,false);
  assert.equal((await timesheetAccess(db(false,1),actor)).canView,false);
});
