import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cleanEmployeeCode, formatEmployeeCode, suggestedCodePrefix } from "../app/employees/employee-code.ts";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("company prefixes come from the company name initials", () => {
  assert.equal(suggestedCodePrefix("KOON Software"), "KS");
  assert.equal(suggestedCodePrefix("Asus Cards"), "AC");
  assert.equal(suggestedCodePrefix("KOON Agency"), "KA");
  assert.equal(suggestedCodePrefix("Acme"), "ACM");
  assert.equal(suggestedCodePrefix("شركة"), "EMP");
});

test("codes are short, padded and keep growing past 999", () => {
  assert.equal(formatEmployeeCode("KS", 7), "KS-007");
  assert.equal(formatEmployeeCode("AC", 1000), "AC-1000");
});

test("HR-typed codes are trimmed, upper-cased and validated", () => {
  assert.equal(cleanEmployeeCode("  ks-012 "), "KS-012");
  assert.throws(() => cleanEmployeeCode(""), Response);
  assert.throws(() => cleanEmployeeCode("KS 012"), Response);
});

test("new employees get the next code of their company, and HR can edit it in the profile", async () => {
  const service = await read("../app/employees/employee-service.ts"), profile = await read("../app/employees/profile-update.ts"), drawer = await read("../app/employee-drawer.tsx");
  assert.match(service, /nextEmployeeCode\(tx,assignment\.company_id\?\?input\.companyId\)/);
  assert.doesNotMatch(service, /padStart\(5/);
  assert.match(profile, /assertEmployeeCodeFree\(db,code,employeeId\)/);
  assert.match(drawer, /update\("employeeCode"/);
  assert.match(drawer, /legacy_employee_code/);
});
