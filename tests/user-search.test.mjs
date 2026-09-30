import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../app/hr-app.tsx", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("function normalizeSearchText("), source.indexOf("function useRowFilter("));
const filter = source.match(/const shownUsers=([^;]+);/)[1];
const code = ts.transpileModule(`${helpers}\nfunction search(users, needle) { const data = { users }; const filter = { needle }; return ${filter}; }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const search = vm.runInNewContext(`${code}\nsearch`);
const user = { email: "ahmed@example.com", employee_name: "Ahmed Khaled Elshewy", employee_name_ar: "أحمد خالد سلامة الشيوى", role_name: "Employee", role_name_ar: "موظف", department_name_ar: "الدعم الفني" };

test("users search matches Arabic fragments and normalized multi-word names", () => {
  for (const query of ["يوي", "احمد", "سلامه", "  يوي   احمد ", "أَحْمَد", "موظ", "الفني"]) {
    assert.equal(search([user], query).length, 1, query);
  }
});

test("users search preserves email, English, empty and nonmatching searches", () => {
  for (const query of ["AHMED@", "khal", "employee", "", "   "]) {
    assert.equal(search([user], query).length, 1, query);
  }
  assert.equal(search([user], "محمد علي").length, 0);
  assert.equal(search([{ email: "other@example.com" }], "يوي").length, 0);
});
