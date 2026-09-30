import test from 'node:test';
import assert from 'node:assert/strict';
import { previewJobTitle, saveJobTitle } from '../app/organization/job-title-service.ts';

test('moving an active job title to another department saves immediately even when another title has the same name', async () => {
  const before = { id: 4, name_en: 'IT Manager', name_ar: 'مدير تقنية', department_id: 1, status: 'active' };
  const catalog = {
    companies: [], branches: [], company_branches: [], departments: [{ id: 1, company_id: 1, status: 'active' }, { id: 2, company_id: 1, status: 'active' }],
    positions: [{ id: 8, name_en: 'IT Manager position', job_title_id: 4, department_id: 1, status: 'active' }],
    job_titles: [before], employees: [{ id: 9, job_title_id: 4, department_id: 1, employment_status: 'active' }],
  };
  const writes = [];
  const db = { prepare(sql) { let params = []; return {
    bind(...args) { params = args; return this; },
    async run() { writes.push({ sql, params }); },
    async first() {
      if (sql.includes('to_regclass')) return { ready: true };
      if (sql.startsWith('SELECT id FROM departments')) return { id: 2 };
      if (sql.startsWith('SELECT id FROM job_titles WHERE (lower')) return { id: 5 };
      if (sql.startsWith('SELECT * FROM job_titles WHERE id=?')) return before;
      return null;
    },
    async all() {
      const table = /^SELECT \* FROM (\w+) ORDER BY/.exec(sql)?.[1];
      if (table) return { results: catalog[table] ?? [] };
      if (sql.includes('FROM employees ORDER BY id')) return { results: catalog.employees };
      return { results: [] };
    },
  }; } };
  const change = { jobTitleId: 4, nameEn: 'IT Manager', nameAr: 'مدير تقنية', departmentId: 2, status: 'active' };
  const preview = await previewJobTitle(db, change);
  assert.equal(preview.ok, true);
  assert.equal(preview.confirmationToken, null);
  await assert.doesNotReject(saveJobTitle(db, change, { id: 1 }));
  assert.ok(writes.some(write => write.sql.startsWith('UPDATE job_titles') && write.params[2] === 2));
});
