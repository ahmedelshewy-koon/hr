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
  assert.match(api, /INSERT INTO departments \(name_en,name_ar,parent_id,manager_employee_id,unit_type/);
  assert.match(api, /UPDATE departments SET parent_id=\?,manager_employee_id=\?,unit_type=\?/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS unit_type/);
  assert.match(migration, /SET unit_type = 'company'/);
  assert.match(migration, /departments_unit_type_check/);
});
