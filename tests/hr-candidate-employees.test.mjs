import test from "node:test";
import assert from "node:assert/strict";
import { readCompanyHrCatalog } from '../app/employees/company-hr-catalog.ts';

test("HR candidates require a linked employee and an eligible active account", async () => {
  const queries = [];
  const db = { prepare(sql) { queries.push(sql); return { async all() { return { results: [] }; } }; } };
  await readCompanyHrCatalog(db, true);
  const candidates = queries[2];
  assert.match(candidates, /(?<!LEFT )JOIN employees e ON e.id=u.employee_id/);
  assert.match(candidates, /u.status='active'/);
  assert.match(candidates, /r.name IN \('HR Manager','Super Admin'\)/);
  assert.match(candidates, /e.employment_status IN \('active','probation','notice_period'\)/);
  assert.doesNotMatch(candidates, /u.employee_id IS NULL/);
});
