import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { employeePayrollCountry, normalizePayrollCountry, payrollCountrySql } from "../app/payroll/country.ts";
import { employeePayrollCountry as timesheetEmployeePayrollCountry } from "../app/timesheet/time.ts";
import { payrollRegionChain } from "../app/approvals/payroll-region.ts";

test("stored payroll country spellings normalize to Egypt or KSA", () => {
  for (const value of ["KSA", "ksa", "Saudi Arabia", " saudi  arabia ", "SA", "السعودية", "المملكة العربية السعودية"]) assert.equal(normalizePayrollCountry(value), "KSA", value);
  for (const value of ["Egypt", "EGYPT", "eg", "مصر"]) assert.equal(normalizePayrollCountry(value), "Egypt", value);
  for (const value of [null, undefined, "", "  ", "Jordan", "UAE", "Riyadh"]) assert.equal(normalizePayrollCountry(value), null, String(value));
});

test("an employee's payroll country comes from the stored value only, never from work country", () => {
  assert.equal(employeePayrollCountry({ salary_country: "Saudi Arabia", country: "Egypt" }), "KSA");
  assert.equal(employeePayrollCountry({ salary_country: "Egypt", country: "Saudi Arabia" }), "Egypt");
  assert.equal(employeePayrollCountry({ salary_country: null, country: "Saudi Arabia" }), null);
  assert.equal(employeePayrollCountry({ salary_country: "", country: "Egypt" }), null);
  assert.equal(timesheetEmployeePayrollCountry({ salary_country: null, country: "Egypt" }), null, "Timesheet uses the same rule");
});

test("the SQL expression mirrors the aliases and has no fallback branch", () => {
  const sql = payrollCountrySql("e.salary_country");
  assert.match(sql, /THEN 'Egypt'/);
  assert.match(sql, /'saudi arabia'/);
  assert.doesNotMatch(sql, /ELSE/, "unresolved values must stay NULL");
  assert.doesNotMatch(sql, /e\.country\b/, "work country is never consulted");
});

test("no payroll-country fallback to work country remains in the app", () => {
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full); } };
  walk("app");
  const offenders = files.filter(file => {
    const text = fs.readFileSync(file, "utf8");
    return /country\s*===\s*"Saudi Arabia"\s*\?\s*"KSA"\s*:\s*"Egypt"/.test(text) || /salary_country IN \('Egypt','KSA'\) THEN e\.salary_country WHEN e\.country/.test(text);
  });
  assert.deepEqual(offenders, []);
});

test("an approval for an employee without payroll country gets no regional chain", async () => {
  const db = { prepare: sql => ({ bind: () => ({ first: async () => /to_regclass/.test(sql) ? { ready: true } : { id: 7, country: "Saudi Arabia", salary_country: null, working_business_unit_id: null }, all: async () => { throw new Error("managers must not be queried"); } }), first: async () => ({ ready: true, configured: true }) }) };
  assert.deepEqual(await payrollRegionChain(db, 7), []);
});
