import assert from "node:assert/strict";
import test from "node:test";

import {
  isCompanyOrganizationUnit,
  organizationManagerLabel,
} from "../app/organization/organization-labels.ts";

test("the three organization companies use the general manager title", () => {
  for (const unit of [
    { name_ar: "كون برمجة", name_en: "Koon Software" },
    { name_ar: "اسس كارد", name_en: "Asus cards" },
    { name_ar: "وكالة كون", name_en: "Koon Agency" },
  ]) {
    assert.equal(isCompanyOrganizationUnit(unit), true);
    assert.equal(organizationManagerLabel(unit, true), "المدير العام");
    assert.equal(organizationManagerLabel(unit, false, true), "GENERAL MANAGER");
  }
});

test("departments beneath companies keep the department manager title", () => {
  for (const unit of [
    { name_ar: "برمجة", name_en: "Software Development" },
    { name_ar: "الحسابات", name_en: "Accounting" },
    { name_ar: "تسويق رقمي", name_en: "Digital marketing" },
  ]) {
    assert.equal(isCompanyOrganizationUnit(unit), false);
    assert.equal(organizationManagerLabel(unit, true), "مدير القسم");
    assert.equal(organizationManagerLabel(unit, false, true), "DEPARTMENT MANAGER");
  }
});

test("the stored entity type overrides name-based compatibility detection", () => {
  assert.equal(isCompanyOrganizationUnit({ name_ar: "وكالة كون", unit_type: "department" }), false);
  assert.equal(organizationManagerLabel({ name_ar: "الحسابات", unit_type: "company" }, true), "المدير العام");
});
