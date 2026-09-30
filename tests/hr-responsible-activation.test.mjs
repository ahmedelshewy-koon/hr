import test from "node:test";
import assert from "node:assert/strict";
import { saveCompanyHrCatalog } from "../app/employees/company-hr-catalog.ts";

// Minimal recording double: `candidate` is what the eligibility lookup returns.
function database(candidate) {
  const queries = [];
  const db = {
    prepare(sql) {
      queries.push(sql);
      return {
        bind() { return this; },
        async first() { return /SELECT u\.id FROM users u/.test(sql) ? candidate : null; },
        async run() { return { results: [] }; },
      };
    },
  };
  return { db, queries };
}

test("activating an HR responsible requires an account linked to a current employee", async () => {
  const { db, queries } = database(null);
  await assert.rejects(
    saveCompanyHrCatalog(db, "save_hr_responsible", { hrUserId: 40 }),
    (error) => error instanceof Response && error.status === 400,
  );
  const lookup = queries.find((sql) => /SELECT u\.id FROM users u/.test(sql));
  assert.match(lookup, /(?<!LEFT )JOIN employees e ON e\.id=u\.employee_id/);
  assert.match(lookup, /r\.name IN \('HR Manager','Super Admin'\)/);
  assert.match(lookup, /e\.employment_status IN \('active','probation','notice_period'\)/);
  assert.doesNotMatch(lookup, /u\.employee_id IS NULL/);
  assert.ok(!queries.some((sql) => /INSERT INTO hr_responsibles/.test(sql)), "an unlinked account must never be written");
});

test("an eligible linked account is still activated, and deactivation is unaffected", async () => {
  const active = database({ id: 7 });
  assert.deepEqual(await saveCompanyHrCatalog(active.db, "save_hr_responsible", { hrUserId: 7 }), { userId: 7 });
  assert.ok(active.queries.some((sql) => /INSERT INTO hr_responsibles/.test(sql)));

  const inactive = database(null);
  await saveCompanyHrCatalog(inactive.db, "save_hr_responsible", { hrUserId: 7, active: false });
  assert.ok(!inactive.queries.some((sql) => /SELECT u\.id FROM users u/.test(sql)), "deactivation does not need eligibility");
});
