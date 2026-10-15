import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmployeePayrollChange } from "../app/payroll/employee-setup.ts";

test("employee Payroll setup keeps company and Working Business Unit independent", () => {
  const updates=normalizeEmployeePayrollChange({companyId:9,workingBusinessUnitId:3,salaryCountry:"Saudi Arabia",salaryCurrency:"sar"},{company_id:9},true);
  assert.equal(updates.working_business_unit_id,3);
  assert.equal(updates.salary_country,"KSA");
  assert.equal(updates.salary_currency,"SAR");
  assert.equal(normalizeEmployeePayrollChange({companyId:9},{company_id:9},true).working_business_unit_id,undefined);
});

test("only a privileged Payroll head can update basic salary or salary currency", () => {
  assert.throws(()=>normalizeEmployeePayrollChange({salary:9000},{},false),/salary privilege/i);
  assert.throws(()=>normalizeEmployeePayrollChange({salaryCurrency:"EGP"},{},false),/salary privilege/i);
  assert.deepEqual(normalizeEmployeePayrollChange({workingBusinessUnitId:""},{},false),{working_business_unit_id:null});
});
