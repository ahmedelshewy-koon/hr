import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../app/hr-app.tsx", import.meta.url), "utf8");
const drawer = fs.readFileSync(new URL("../app/employee-drawer.tsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../app/api/hr/route.ts", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../drizzle-postgres/0021_organization_unit_type.sql", import.meta.url), "utf8");

test("organization forms expose and persist company or department selection", () => {
  assert.match(app, /نوع الكيان/);
  assert.match(app, /<option value="company">/);
  assert.match(app, /<option value="department">/);
  assert.match(app, /action:"save_department_structure"[^\n]+unitType/);
  assert.match(drawer, /unitType:record\?\.unit_type\|\|"department"/);
  assert.match(drawer, /نوع الكيان/);
});

test("department APIs store unit type and migration backfills existing companies", () => {
  assert.match(api, /unitType=clean\(payload\.unitType\)==="company"\?"company":"department"/);
  assert.match(api, /INSERT INTO departments \(name_en,name_ar,parent_id,unit_type/);
  // Retired department-structure actions answer with a structured bilingual ACTION_RETIRED error.
  assert.match(api, /if\(action==="save_department_hierarchy"\) \{ throw retiredOrganizationAction\(\); \}/);
  assert.match(api, /if\(await organizationReady\(d1\)\)throw retiredOrganizationAction\(409\);/);
  assert.match(fs.readFileSync(new URL("../app/organization/org-errors.ts", import.meta.url), "utf8"), /'ACTION_RETIRED', null, 'استخدم إعدادات الهيكل وملف الموظف', 'Use organization settings and Employee Profile'/);
  assert.doesNotMatch(api, /UPDATE employees SET department_id=\?,manager_id=\?/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS unit_type/);
  assert.match(migration, /SET unit_type = 'company'/);
  assert.match(migration, /departments_unit_type_check/);
});
