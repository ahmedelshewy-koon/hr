import test from 'node:test';
import assert from 'node:assert/strict';
import { saveOrganizationEntity } from '../app/organization/catalog-service.ts';
import { readOrganizationInsights } from '../app/organization/settings-insights.ts';

const emptyCatalog = { companies: [], branches: [], companyBranches: [], departments: [], branchScopes: [], positions: [], grades: [], workLocations: [], hrRules: [], jobTitles: [] };
const tables = { companies: 'companies', branches: 'branches', company_branches: 'companyBranches', departments: 'departments', organization_branch_scopes: 'branchScopes', positions: 'positions', job_grades: 'grades', work_locations: 'workLocations', hr_responsibility_rules: 'hrRules', job_titles: 'jobTitles', employees: 'employees' };
/** Records every write; `counts` is returned for each reference the usage map inspects. */
function serviceDb(before = null, catalog = emptyCatalog, counts = { total: 0, active: 0 }) {
  const writes = [];
  return { writes, prepare(sql) { let params = []; return { bind(...args) { params = args; return this; }, async run() { writes.push({ sql, params }); }, async first() { if (sql.includes('FOR UPDATE')) return before; if (/^(UPDATE|INSERT)/.test(sql)) { writes.push({ sql, params }); return { id: before?.id || 7 }; } return null; }, async all() { if (sql.includes('count(*)')) return { results: [{ record_id: 7, ...counts }] }; const table = sql.match(/FROM (\w+)/)?.[1]; return { results: catalog[tables[table]] || [] }; } }; } };
}
const branch = { id: 7, name_ar: 'فرع', name_en: 'Branch', code: 'B7', country: 'Egypt', city: 'Cairo', status: 'active' };
const company = (id, status = 'active') => ({ id, name: 'C' + id, name_en: 'C' + id, name_ar: 'ش' + id, status });
const linkWrites = db => db.writes.filter(w => w.sql.includes('company_branches'));

test('an occupied position can change its job title and save directly', async () => {
  const position = { id: 7, name_ar: 'مطور ويب', name_en: 'Web Developer', code: 'WEB', company_id: 1, department_id: null, section_id: null, team_id: null, grade_id: null, job_title_id: null, is_ceo: 0, status: 'active' };
  const catalog = { ...emptyCatalog, companies: [company(1)], branches: [branch], companyBranches: [{ company_id: 1, branch_id: 7 }], positions: [position], jobTitles: [{ id: 3, name_ar: 'مطور', name_en: 'Developer', department_id: null, status: 'active' }] };
  const db = serviceDb(position, catalog, { total: 1, active: 1 });
  await assert.doesNotReject(saveOrganizationEntity(db, 'positions', { ...position, job_title_id: 3 }));
  assert.ok(db.writes.some(write => write.sql.startsWith('UPDATE positions') && write.params.includes(3)));
});

test('a branch can serve several companies: associations are replaced with the submitted set', async () => {
  const catalog = { ...emptyCatalog, companies: [company(1), company(2)] };
  const db = serviceDb(branch, catalog);
  await saveOrganizationEntity(db, 'branches', { ...branch, companyIds: [1, 2, 2] });
  const writes = linkWrites(db);
  assert.equal(writes[0].sql, 'DELETE FROM company_branches WHERE branch_id=?');
  assert.deepEqual(writes.slice(1).map(w => w.params), [[1, 7], [2, 7]], 'duplicates collapse; one row per company');
});

test('branch associations are optional in the payload and untouched when omitted', async () => {
  const db = serviceDb(branch, { ...emptyCatalog, companies: [company(1)] });
  await saveOrganizationEntity(db, 'branches', { ...branch, city: 'Giza' });
  assert.equal(linkWrites(db).length, 0);
});

test('new associations must point at active companies, but existing links to inactive ones may stay', async () => {
  const catalog = { ...emptyCatalog, companies: [company(1), company(3, 'inactive')], companyBranches: [{ company_id: 3, branch_id: 7 }] };
  await assert.rejects(saveOrganizationEntity(serviceDb(branch, { ...catalog, companyBranches: [] }), 'branches', { ...branch, companyIds: [3] }), e => e.status === 400);
  await assert.doesNotReject(saveOrganizationEntity(serviceDb(branch, catalog), 'branches', { ...branch, companyIds: [1, 3] }));
});

test('removing a company↔branch link is blocked only by what uses that exact pair; adding one is not', async () => {
  const catalog = { ...emptyCatalog, companies: [company(1), company(2)], companyBranches: [{ company_id: 1, branch_id: 7 }] };
  const pairUser = { id: 40, employment_status: 'active', company_id: 1, branch_id: 7 };
  const blocked = await saveOrganizationEntity(serviceDb(branch, { ...catalog, employees: [pairUser] }), 'branches', { ...branch, companyIds: [2] }).then(() => null, e => e);
  assert.equal(blocked?.status, 409);
  const detail = await blocked.json();
  assert.equal(detail.code, 'REFERENCED_ENTITY_CONFLICT');
  assert.deepEqual(detail.details.issues[0].details.employees.map(e => e.id), [40], 'the exact employees are listed');
  await assert.doesNotReject(saveOrganizationEntity(serviceDb(branch, { ...catalog, employees: [pairUser] }), 'branches', { ...branch, companyIds: [1, 2] }), 'adding a company is always allowed');
  await assert.doesNotReject(saveOrganizationEntity(serviceDb(branch, { ...catalog, employees: [{ ...pairUser, branch_id: 8 }] }, { total: 3, active: 3 }), 'branches', { ...branch, companyIds: [2] }), 'company usage in another branch does not block this link');
  await assert.doesNotReject(saveOrganizationEntity(serviceDb(branch, catalog, { total: 0, active: 0 }), 'branches', { ...branch, companyIds: [2] }), 'an unused branch may be re-linked freely');
});

test('the audit trail records the association change', async () => {
  const db = serviceDb(branch, { ...emptyCatalog, companies: [company(1)] });
  await saveOrganizationEntity(db, 'branches', { ...branch, companyIds: [1] }, 9);
  const audit = db.writes.find(w => w.sql.includes('audit_logs'));
  assert.deepEqual(JSON.parse(audit.params[4]).companyIds, [1]);
});

test('insights: occupants group by position, HR scopes and legacy work locations are normalised', async () => {
  const answers = [
    [{ position_id: 3, id: 198, employee_code: 'E1', name_ar: 'ا', name_en: 'A', employment_status: 'active' }, { position_id: 3, id: 199, employee_code: 'E2', name_ar: 'ب', name_en: 'B', employment_status: 'probation' }, { position_id: 4, id: 200, employee_code: 'E3', name_ar: 'ج', name_en: 'C', employment_status: 'active' }],
    [{ company_id: 5, branch_id: 3, employees: '4', overrides: '1' }, { company_id: null, branch_id: 4, employees: 2, overrides: 0 }],
    [{ text: 'Egypt', employees: '29' }, { text: 'Saudi Arabia', employees: 7 }],
  ];
  const seen = [];
  const db = { prepare(sql) { seen.push(sql); return { async all() { return { results: answers[seen.length - 1] ?? [] }; } }; } };
  const result = await readOrganizationInsights(db);
  assert.deepEqual(Object.keys(result.occupants), ['3', '4']);
  assert.deepEqual(result.occupants[3].map(person => person.id), [198, 199]);
  assert.deepEqual(result.hrScopes, [{ company_id: 5, branch_id: 3, employees: 4, overrides: 1 }, { company_id: null, branch_id: 4, employees: 2, overrides: 0 }]);
  assert.deepEqual(result.legacyWorkLocations, [{ text: 'Egypt', employees: 29 }, { text: 'Saudi Arabia', employees: 7 }]);
  for (const sql of seen) assert.match(sql, /^SELECT/, 'insights only read');
  assert.match(seen[0], /employment_status IN \('active','probation','notice_period'\)/);
  assert.match(seen[2], /work_location_id IS NULL/, 'only unmapped free-text locations are reported');
});
