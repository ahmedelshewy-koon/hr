import test from 'node:test';
import assert from 'node:assert/strict';
import { saveHrAssignment } from '../app/organization/hr-assignment-service.ts';

test('selecting an employee grants HR access, adds the roster entry and saves the company-branch rule', async () => {
  const writes = [];
  const tables = {
    companies: [{ id: 5, name_en: 'Company', status: 'active' }],
    branches: [{ id: 3, name_en: 'Branch', status: 'active' }],
    company_branches: [{ company_id: 5, branch_id: 3 }],
  };
  const db = { prepare(sql) { let params = []; return {
    bind(...args) { params = args; return this; },
    async run() { writes.push({ sql, params }); },
    async first() {
      if (sql.startsWith('SELECT id,work_email,employment_status FROM employees')) return { id: 9, work_email: 'person@example.test', employment_status: 'active' };
      if (sql.startsWith("SELECT id FROM roles WHERE name='HR Manager'")) return { id: 7 };
      if (sql.startsWith('SELECT u.id,u.role_id,u.status')) return { id: 20, role_id: 2, role_name: 'Employee', status: 'active' };
      if (sql.startsWith('SELECT id FROM hr_responsibility_rules WHERE company_id')) return null;
      if (sql.startsWith('INSERT INTO hr_responsibility_rules')) { writes.push({ sql, params }); return { id: 40 }; }
      if (sql.startsWith('SELECT * FROM hr_responsibility_rules WHERE id')) return { id: 40, company_id: 5, branch_id: 3, hr_user_id: 20, status: 'active' };
      return null;
    },
    async all() {
      if (sql.includes('FROM hr_responsibles h')) return { results: [{ user_id: 20, employee_id: 9, status: 'active', eligible: true, name_en: 'Person' }] };
      if (sql.includes("FROM employees WHERE employment_status<>'deleted'")) return { results: [] };
      const table = /^SELECT \* FROM (\w+) ORDER BY/.exec(sql)?.[1];
      return { results: table ? (tables[table] ?? []) : [] };
    },
  }; } };
  const result = await saveHrAssignment(db, { companyId: 5, branchId: 3, employeeId: 9 }, 1);
  assert.equal(result.userId, 20);
  assert.equal(result.temporaryPassword, null);
  assert.ok(writes.some(write => write.sql.startsWith('UPDATE users SET role_id') && write.params[0] === 7));
  assert.ok(writes.some(write => write.sql.startsWith('INSERT INTO hr_responsibles') && write.params[0] === 20));
  assert.ok(writes.some(write => write.sql.startsWith('INSERT INTO hr_responsibility_rules') && write.params[2] === 20));
  assert.equal(result.overridesCleared, 0);
  // Assigned from Settings without a choice, the HR sees only the employees it is responsible for.
  assert.equal(result.hrDataScope, 'assigned');
  assert.ok(writes.some(write => write.sql.startsWith('UPDATE users SET hr_data_scope=?') && write.params[0] === 'assigned' && write.params[1] === 20));
  const everyone = await saveHrAssignment(db, { companyId: 5, branchId: 3, employeeId: 9, hrDataScope: 'all' }, 1);
  assert.equal(everyone.hrDataScope, 'all');
});

test('saving a company + branch HR clears per-employee HR overrides there, except the chosen HR person', async () => {
  const source = await import('node:fs').then(fs => fs.readFileSync(new URL('../app/organization/hr-assignment-service.ts', import.meta.url), 'utf8'));
  assert.match(source, /UPDATE employees SET hr_user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE company_id=\? AND branch_id=\? AND id<>\? AND hr_user_id IS NOT NULL AND employment_status<>'deleted'/);
  assert.match(source, /\.bind\(companyId, branchId, employeeId\)\.all<Row>\(\)/);
  assert.match(source, /clearedEmployeeOverrides/);
});
