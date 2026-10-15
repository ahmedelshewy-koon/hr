import test from "node:test";
import assert from "node:assert/strict";
import { redactPayrollPreview, redactPayrollWorkspace, redactPayrollRunDetail, filterPayrollWorkspace } from "../app/payroll/privacy.ts";

test("a non-privileged payroll manager cannot derive basic salary from preview totals or formula lines", () => {
  const result = redactPayrollPreview({
    periodKey: "2026-10",
    people: [{ employee_id: 3, basic: 12000, gross: 15000, deductions: 1000, employer: 500, net: 14000, currency: "SAR" }],
    lines: [{ employee_id: 3, element_code: "BASIC", amount: 12000 }, { employee_id: 3, element_code: "BONUS", amount: 3000 }],
    employees: [{ id: 3, basic_salary: 12000, salary: 12000, salary_currency: "SAR" }],
    elements: [{ id: 1, name_en: "Basic" }],
  });
  assert.equal(result.people[0].basic, null);
  assert.equal(result.people[0].gross, null);
  assert.equal(result.people[0].net, null);
  assert.equal(result.lines[0].amount, null);
  assert.equal(result.lines[1].amount, null);
  assert.equal(result.employees[0].basic_salary, null);
  assert.equal(result.employees[0].salary, null);
});

test("run and workspace metadata remain visible without any monetary totals", () => {
  const run = { id: 1, total_gross: 12000, total_deductions: 500, total_net: 11500, sar_currency_rate: 1 };
  const view = redactPayrollWorkspace({ employees: [{ basic_salary: 12000 }], runs: [run], variables: [{ amount: 500 }], recurring: [{ amount: 12000 }] });
  assert.equal(view.runs[0].total_net, null);
  assert.equal(view.employees[0].basic_salary, null);
  assert.equal(view.variables[0].amount, null);
  assert.equal(view.recurring[0].amount, null);
  const detail = redactPayrollRunDetail({ run, lines: [{ amount: 12000, element_code: "BASIC" }] });
  assert.equal(detail.run.total_gross, null);
  assert.equal(detail.lines[0].amount, null);
});

test("workspace excludes a denied section's rows before sending the API response", () => {
  const view = filterPayrollWorkspace({
    employees: [{ id: 1 }], elements: [{ id: 2 }], recurring: [{ id: 3 }],
    variables: [{ id: 4 }], runs: [{ id: 5 }], eligibility: [{ id: 6 }],
    managers: [{ id: 7 }], users: [{ id: 8 }], erp: { id: 9 },
  }, { payrollRun: true });
  assert.deepEqual(view.runs, [{ id: 5 }]);
  assert.deepEqual(view.variables, []);
  assert.deepEqual(view.recurring, []);
  assert.deepEqual(view.managers, []);
  assert.equal(view.erp, null);
});
