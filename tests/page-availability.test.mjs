import test from "node:test";
import assert from "node:assert/strict";
import { filterAvailablePages, validatePageToggle } from "../app/page-availability.ts";

for (const role of ["Super Admin", "HR Manager", "Department Manager", "Employee"]) {
  test(`closed pages stay hidden for ${role}, reopening preserves grants`, () => {
    const granted = ["dashboard", "portal"];
    assert.deepEqual(filterAvailablePages(granted, role, { dashboard: false, payroll: true }), ["portal"]);
    assert.deepEqual(filterAvailablePages(granted, role, { dashboard: true, payroll: true }), granted);
    assert.deepEqual(filterAvailablePages(granted, role, { dashboard: false, portal: false }), []);
  });
}

test("only Super Admin retains settings when globally closed", () => {
  assert.deepEqual(filterAvailablePages(["settings"], "Super Admin", { settings: false }), ["settings"]);
  assert.deepEqual(filterAvailablePages(["settings"], "HR Manager", { settings: false }), []);
});

test("unset availability leaves existing access unchanged", () => {
  assert.deepEqual(filterAvailablePages(["portal", "learning"], "Employee", {}), ["portal", "learning"]);
});

test("HR settings sidebar preserves role, scope and availability restrictions", () => {
  assert.deepEqual(filterAvailablePages(["hr_settings"], "HR Manager", {}, "all"), ["hr_settings"]);
  assert.deepEqual(filterAvailablePages(["settings", "hr_settings"], "HR Manager", {}, "assigned"), ["settings"]);
  assert.deepEqual(filterAvailablePages(["hr_settings"], "Employee", {}, "all"), []);
  assert.deepEqual(filterAvailablePages(["hr_settings"], "Super Admin", { hr_settings: false }), []);
  assert.deepEqual(filterAvailablePages([], "HR Manager", { hr_settings: true }, "all"), []);
});

test("only Super Admin may change availability, even for roles with settings rights", () => {
  for (const role of ["HR Manager", "Department Manager", "Employee", "Custom administrator"]) {
    assert.throws(() => validatePageToggle(role, "dashboard", false), error => error instanceof Response && error.status === 403);
  }
  assert.deepEqual(validatePageToggle("Super Admin", "dashboard", false), { page: "dashboard", enabled: false });
});

test("reject unknown pages and non-boolean switch values", () => {
  for (const [page, enabled] of [["bogus", true], ["__proto__", false], ["dashboard", "false"], ["dashboard", null]]) {
    assert.throws(() => validatePageToggle("Super Admin", page, enabled), error => error instanceof Response && error.status === 400);
  }
});
