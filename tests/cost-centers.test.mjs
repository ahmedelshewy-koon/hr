import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PAGE_MODULES, filterAvailablePages } from '../app/page-availability.ts';
import { PAGE_LABELS } from '../app/navigation-labels.ts';
import { deleteCostCenter, resolveEmployeeCostCenter, saveCostCenter, validateCostCenter } from '../app/cost-centers/catalog.ts';

const good = { code: '06', name_en: 'Software Development', name_ar: 'البرمجة و التطوير', debit_account: '601100' };
const code = fn => { try { fn(); return null; } catch (error) { return error.issue?.code ?? error.message; } };
const codeAsync = async fn => { try { await fn(); return null; } catch (error) { return error.issue?.code ?? error.message; } };

/** Fake transaction: answers by statement text and records every statement. */
function fakeDb({ before = null, clash = null, used = 0, center = null } = {}) {
  const statements = [];
  return { statements, prepare(sql) { let params = []; return {
    bind(...args) { params = args; return this; },
    async run() { statements.push({ sql, params }); return {}; },
    async all() { statements.push({ sql, params }); return { results: [] }; },
    async first() {
      statements.push({ sql, params });
      if (sql.includes('FOR UPDATE')) return before;
      if (sql.includes('COUNT(*)')) return { count: used };
      if (sql.includes('FROM companies')) return { id: 1 };
      if (sql.startsWith('SELECT id FROM cost_centers')) return clash;
      if (sql.startsWith('SELECT id,status FROM cost_centers')) return center;
      return { id: 9, ...good };
    },
  }; } };
}

test('cost center validation requires a code and both names; the debit account is optional but must be numeric-like', () => {
  assert.deepEqual(validateCostCenter({ ...good, code: ' 06 ' }), { ...good, company_id: null, description: null, status: 'active' });
  assert.equal(code(() => validateCostCenter({ ...good, code: '' })), 'REQUIRED_FIELD');
  assert.equal(code(() => validateCostCenter({ ...good, code: 'bad code' })), 'INVALID_CODE');
  assert.equal(code(() => validateCostCenter({ ...good, name_ar: '' })), 'REQUIRED_FIELD');
  assert.equal(validateCostCenter({ ...good, debit_account: '' }).debit_account, null, 'the debit account is optional');
  assert.equal(code(() => validateCostCenter({ ...good, debit_account: '60 11' })), 'INVALID_ACCOUNT');
  assert.equal(code(() => validateCostCenter({ ...good, status: 'deleted' })), 'INVALID_STATUS');
  assert.equal(code(() => validateCostCenter({ ...good, company_id: 'x' })), 'INVALID_SELECTION');
  assert.equal(validateCostCenter({ ...good, company_id: '3' }).company_id, 3);
});

test('saving a cost center rejects a duplicate code, a stale record and a missing record', async () => {
  assert.equal(await codeAsync(() => saveCostCenter(fakeDb({ clash: { id: 2 } }), good, 1)), 'DUPLICATE_CODE');
  assert.equal(await codeAsync(() => saveCostCenter(fakeDb({ before: { id: 5, version: 10 } }), { ...good, id: 5, version: 9 }, 1)), 'STALE_RECORD');
  assert.equal(await codeAsync(() => saveCostCenter(fakeDb(), { ...good, id: 5 }, 1)), 'NOT_FOUND');
  const db = fakeDb();
  await saveCostCenter(db, good, 7);
  assert.ok(db.statements.some(s => s.sql.startsWith('INSERT INTO cost_centers')));
  assert.ok(db.statements.some(s => s.sql.includes('INSERT INTO audit_logs') && s.params.includes('cost_center_created')));
});

test('a cost center that employees use cannot be deleted', async () => {
  assert.equal(await codeAsync(() => deleteCostCenter(fakeDb({ before: { id: 4 }, used: 3 }), 4, 1)), 'IN_USE');
  const db = fakeDb({ before: { id: 4 }, used: 0 });
  await deleteCostCenter(db, 4, 1);
  assert.ok(db.statements.some(s => s.sql.startsWith('DELETE FROM cost_centers')));
});

test('an employee can be assigned an active cost center, keep an inactive one it already has, or clear it', async () => {
  assert.equal(await resolveEmployeeCostCenter(fakeDb(), ''), null);
  assert.equal(await resolveEmployeeCostCenter(fakeDb({ center: { id: 4, status: 'active' } }), '4'), 4);
  await assert.rejects(() => resolveEmployeeCostCenter(fakeDb({ center: { id: 4, status: 'inactive' } }), '4', null));
  assert.equal(await resolveEmployeeCostCenter(fakeDb({ center: { id: 4, status: 'inactive' } }), '4', 4), 4);
  await assert.rejects(() => resolveEmployeeCostCenter(fakeDb({ center: null }), '4'));
  await assert.rejects(() => resolveEmployeeCostCenter(fakeDb(), 'abc'));
});

test('the Cost Centers page is registered, payroll-gated and limited to Super Admin and HR Manager', () => {
  assert.deepEqual(PAGE_MODULES.cost_centers, ['payroll']);
  assert.deepEqual(PAGE_LABELS.cost_centers, { en: 'Cost Centers', ar: 'مراكز التكلفة' });
  assert.deepEqual(filterAvailablePages(['payroll', 'cost_centers'], 'HR Manager', {}), ['payroll', 'cost_centers']);
  assert.deepEqual(filterAvailablePages(['payroll', 'cost_centers'], 'Department Manager', {}), ['payroll']);
});

test('the migration, schema and employee save path carry cost center and payroll country', () => {
  const migration = fs.readFileSync(new URL('../drizzle-postgres/0043_cost_centers.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "cost_centers"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "cost_center_id"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "salary_country"/);
  assert.match(fs.readFileSync(new URL('../drizzle-postgres/meta/_journal.json', import.meta.url), 'utf8'), /0043_cost_centers/);
  assert.match(fs.readFileSync(new URL('../app/employees/profile-update.ts', import.meta.url), 'utf8'), /resolveEmployeeCostCenter/);
  const route = fs.readFileSync(new URL('../app/api/hr/route.ts', import.meta.url), 'utf8');
  assert.match(route, /salary_country=\?,cost_center_id=\?/);
  assert.match(route, /FROM cost_centers/);
});

test('opening a cost center lists its current employees', async () => {
  const { readFile } = await import('node:fs/promises');
  const catalog = await readFile(new URL('../app/cost-centers/catalog.ts', import.meta.url), 'utf8');
  assert.match(catalog, /WHERE e\.cost_center_id IS NOT NULL AND e\.employment_status<>'deleted'/);
  assert.match(catalog, /return \{ costCenters, companies, members \}/);
  const page = await readFile(new URL('../app/cost-centers-workspace.tsx', import.meta.url), 'utf8');
  assert.match(page, /onClick=\{\(\) => setViewing\(row\)\}/);
  assert.match(page, /<CostCenterMembers rtl=\{rtl\} costCenter=\{viewing\} members=\{membersOf\(viewing\)\}/);
});
