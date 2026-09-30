import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAssignment, assignmentIssues, assignmentDiagnostics, assignmentGroupIssues, validateAssignmentGroup, changeAssignmentForm, assignmentChanges, assertAssignmentReviewCurrent, assignmentOptions } from '../app/organization/assignment-policy.ts';
import { jobTitleImpact, unitScopeImpact, linkRemovalImpact, legacyAdoptionImpact, reactivationImpact, unitManagerIssue } from '../app/organization/impact-policy.ts';
import { saveOrganizationEntity, deleteOrganizationEntity, forceDeleteDepartment, forceDeleteOrganizationEntity, previewOrganizationEntity } from '../app/organization/catalog-service.ts';
import { OrganizationError, organizationMessage, organizationResponse } from '../app/organization/org-errors.ts';

// Fixture: company 5 (Cairo 3, Riyadh 2), company 6 (Riyadh 2); legacy unit 4 with a legacy-bound title 14.
const catalog = {
  companies: [{ id: 5, status: 'active', name_en: 'KOON' }, { id: 6, status: 'active', name_en: 'Asus' }],
  branches: [{ id: 2, status: 'active', name_en: 'Riyadh' }, { id: 3, status: 'active', name_en: 'Cairo' }],
  companyBranches: [{ company_id: 5, branch_id: 3 }, { company_id: 5, branch_id: 2 }, { company_id: 6, branch_id: 2 }],
  departments: [
    { id: 1, company_id: 5, organization_kind: 'department', status: 'active', branch_scope: 'all', name_en: 'Software' },
    { id: 11, company_id: 5, organization_kind: 'department', status: 'active', branch_scope: 'selected', name_en: 'UX' },
    { id: 4, company_id: null, organization_kind: null, status: 'active', branch_scope: 'all', name_en: 'Koon Software (legacy)' },
    { id: 14, company_id: null, organization_kind: null, status: 'active', branch_scope: 'all', name_en: 'Asas Company (legacy)' },
  ],
  branchScopes: [{ department_id: 11, branch_id: 3 }],
  positions: [
    { id: 1, company_id: 5, department_id: 1, job_title_id: 1, status: 'active', is_ceo: 0, name_en: 'Developer' },
    { id: 7, company_id: 5, department_id: null, job_title_id: null, status: 'active', is_ceo: 1, name_en: 'KOON CEO' },
  ],
  grades: [{ id: 1, status: 'inactive', name_en: 'Old grade' }], workLocations: [], hrRules: [],
  jobTitles: [
    { id: 1, department_id: 1, status: 'active', name_en: 'Software Developer' },
    { id: 14, department_id: 4, status: 'active', name_en: 'Technology Director' },
    { id: 26, department_id: 14, status: 'active', name_en: 'Chief Executive Officer' },
    { id: 40, department_id: null, status: 'active', name_en: 'Executive (generic)' },
  ],
};
const legacyEmployee = { id: 19, company_id: null, branch_id: null, department_id: 4, job_title_id: 14, manager_id: null, employment_status: 'active' };

/* ---------------------------------------------------------------- employee migration */

test('legacy Department + legacy-bound Title move to new Company/Branch/Department/Position/Title in one save', () => {
  const next = { ...legacyEmployee, company_id: 5, branch_id: 3, department_id: 1, position_id: 1, job_title_id: 1 };
  assert.doesNotThrow(() => validateAssignment(catalog, next, legacyEmployee));
  assert.deepEqual(assignmentChanges({ companyId: 5, branchId: 3, departmentId: 1, positionId: 1, jobTitleId: 1 }, legacyEmployee).map(c => c.key), ['companyId', 'branchId', 'departmentId', 'positionId', 'jobTitleId'], 'every changing field appears in one review');
});

test('an intermediate state is rejected with a precise code; the final state is what is judged', () => {
  const onlyCompany = { ...legacyEmployee, company_id: 5, branch_id: 3 };
  assert.throws(() => validateAssignment(catalog, onlyCompany, legacyEmployee), e => e instanceof OrganizationError && e.code === 'LEGACY_UNIT' && e.field === 'department_id');
  const deptWithoutTitle = { ...onlyCompany, department_id: 1 };
  assert.throws(() => validateAssignment(catalog, deptWithoutTitle, legacyEmployee), e => e.code === 'JOB_TITLE_DEPARTMENT_MISMATCH' && e.blocking_entity.legacy_binding === true);
});

test('CEO legacy record moves to a company-level Position with no Department', () => {
  const ceo = { id: 33, company_id: 5, branch_id: null, department_id: 14, job_title_id: 26, position_id: null, manager_id: null, employment_status: 'active' };
  assert.doesNotThrow(() => validateAssignment(catalog, { ...ceo, branch_id: 3, department_id: null, position_id: 7, job_title_id: 40 }, ceo), 'generic title, no department');
  assert.doesNotThrow(() => validateAssignment(catalog, { ...ceo, branch_id: 3, department_id: null, position_id: 7, job_title_id: null }, ceo), 'no title');
  assert.throws(() => validateAssignment(catalog, { ...ceo, branch_id: 3, department_id: null, position_id: 7 }, ceo), e => e.code === 'JOB_TITLE_DEPARTMENT_MISMATCH', 'a retained legacy-bound title cannot survive a department change');
  assert.throws(() => validateAssignment(catalog, { ...ceo, branch_id: 3, department_id: null, position_id: 7, job_title_id: 40, manager_id: 19 }, ceo), e => e.code === 'CEO_HAS_MANAGER');
});

test('company-level Position survives clearing the department or changing the branch; unit-bound positions do not', () => {
  const form = { companyId: '5', branchId: '3', departmentId: '14', positionId: '7', jobTitleId: '26' };
  assert.equal(changeAssignmentForm(form, 'departmentId', '', catalog).positionId, '7');
  assert.equal(changeAssignmentForm(form, 'branchId', '2', catalog).positionId, '7');
  assert.throws(() => changeAssignmentForm(form, 'companyId', '6', catalog), e => e.code === 'POSITION_CONTRADICTION', 'the position defines the company: clear it first');
  const developer = { companyId: '5', branchId: '3', departmentId: '1', positionId: '1', jobTitleId: '1' };
  assert.equal(changeAssignmentForm(developer, 'branchId', '2', catalog).positionId, '');
});

test('stale review is rejected with STALE_REVIEW (409)', () => {
  assert.throws(() => assertAssignmentReviewCurrent({ ...legacyEmployee, company_id: 6 }, legacyEmployee), e => e.code === 'STALE_REVIEW' && e.status === 409);
  assert.doesNotThrow(() => assertAssignmentReviewCurrent(legacyEmployee, legacyEmployee));
});

/* ---------------------------------------------------------------- team transfer */

const manager = { id: 19, company_id: null, manager_id: null, employment_status: 'active', department_id: 1, job_title_id: 1 };
const report = { id: 2, company_id: null, manager_id: 19, employment_status: 'active', department_id: 1, job_title_id: 1 };
const rows = [manager, report, { id: 90, company_id: null, manager_id: 19, employment_status: 'deleted' }];
const move = (row, company = 5) => ({ id: row.id, before: row, next: { ...row, company_id: company, branch_id: 3 } });

test('manager and direct report move Company atomically; manager_id is never touched', () => {
  const changes = [move(manager), move(report)];
  assert.deepEqual(assignmentGroupIssues(catalog, rows, changes, { teamTransfer: true }), []);
  assert.equal(changes[1].next.manager_id, 19);
});

test('a manager can move alone from their profile; team transfers still validate completeness', () => {
  const single = assignmentGroupIssues(catalog, rows, [move(manager)]);
  assert.deepEqual(single, []);
  assert.equal(rows.find(row => row.id === report.id).manager_id, manager.id);
  const partial = assignmentGroupIssues(catalog, rows, [move(manager)], { teamTransfer: true });
  assert.equal(partial[0].code, 'PARTIAL_TEAM_TRANSFER');
  assert.equal(assignmentGroupIssues(catalog, rows, [move(report)])[0].code, 'MANAGER_COMPANY_MISMATCH', 'a report cannot move ahead of its manager');
});

test('reporting cycles and self-management are rejected with structured codes', () => {
  const cycle = { id: 19, before: manager, next: { ...manager, manager_id: 2 } };
  assert.throws(() => validateAssignmentGroup(catalog, rows, [cycle]), e => e.code === 'REPORTING_CYCLE');
  assert.throws(() => validateAssignmentGroup(catalog, rows, [{ id: 2, before: report, next: { ...report, manager_id: 2 } }]), e => e.code === 'SELF_MANAGEMENT');
});

test('CEO occupancy conflicts inside a group are detected', () => {
  const a = { id: 50, company_id: 5, manager_id: null, employment_status: 'active', position_id: 7 };
  const b = { id: 51, company_id: 5, manager_id: null, employment_status: 'active', position_id: null };
  const issues = assignmentGroupIssues(catalog, [a, b], [{ id: 51, before: b, next: { ...b, position_id: 7 } }]);
  assert.ok(issues.some(i => i.code === 'CEO_OCCUPIED'));
});

/* ---------------------------------------------------------------- settings impact */

const staff = [
  { id: 1, employment_status: 'active', job_title_id: 14, department_id: 4, company_id: null, branch_id: null, name_en: 'Legacy user' },
  { id: 2, employment_status: 'active', job_title_id: 14, department_id: 1, company_id: 5, branch_id: 2, name_en: 'Mismatched' },
  { id: 3, employment_status: 'inactive', job_title_id: 14, department_id: 4, name_en: 'Former' },
];

test('job title rebinding reports usage, created/resolved mismatches and legacy usage; requires confirmation', () => {
  const plan = jobTitleImpact({ catalog, employees: staff }, 14, { department_id: 1, status: 'active' });
  assert.deepEqual(plan.impact.employees, { total: 3, current: 2, historical: 1 });
  assert.deepEqual(plan.impact.mismatch.created.map(e => e.id), [1]);
  assert.deepEqual(plan.impact.mismatch.resolved.map(e => e.id), [2]);
  assert.deepEqual(plan.impact.legacy.map(e => e.id), [1]);
  assert.equal(plan.blocking.length, 0);
  assert.ok(plan.confirmationToken, 'mismatches created → explicit confirmation');
  const generic = jobTitleImpact({ catalog, employees: staff }, 14, { department_id: null, status: 'active' });
  assert.equal(generic.confirmationToken, null, 'making a title generic creates no mismatch');
  assert.deepEqual(generic.impact.mismatch.resolved.map(e => e.id), [2], 'only previously mismatched employees are resolved');
});

test('job title rebinding is blocked by active positions and by legacy targets; archiving by current users', () => {
  assert.equal(jobTitleImpact({ catalog, employees: [] }, 1, { department_id: 11, status: 'active' }).blocking[0].code, 'POSITION_CONTRADICTION');
  assert.equal(jobTitleImpact({ catalog, employees: [] }, 40, { department_id: 14, status: 'active' }).blocking[0].code, 'LEGACY_UNIT');
  assert.equal(jobTitleImpact({ catalog, employees: staff }, 14, { department_id: 4, status: 'archived' }).blocking[0].code, 'ACTIVE_DEPENDENTS');
});

test('department branch scope: removing a branch where current unit employees work is blocked', () => {
  const people = [{ id: 8, employment_status: 'active', department_id: 1, branch_id: 2 }, { id: 9, employment_status: 'active', department_id: 1, branch_id: 3 }];
  const plan = unitScopeImpact({ catalog, employees: people }, 1, { company_id: 5, branch_scope: 'selected', branchIds: [3] });
  assert.equal(plan.blocking[0].code, 'UNIT_OUTSIDE_BRANCH_SCOPE');
  assert.deepEqual(plan.blocking[0].details.employees.map(e => e.id), [8]);
  assert.equal(unitScopeImpact({ catalog, employees: people }, 1, { company_id: 5, branch_scope: 'selected', branchIds: [2, 3] }).blocking.length, 0);
});

test('company↔branch link removal lists employees, HR rules and unit scopes of that exact pair', () => {
  const ctx = { catalog: { ...catalog, hrRules: [{ id: 3, company_id: 5, branch_id: 3, status: 'active' }] }, employees: [{ id: 8, employment_status: 'active', company_id: 5, branch_id: 3 }, { id: 9, employment_status: 'active', company_id: 5, branch_id: 2 }] };
  const plan = linkRemovalImpact(ctx, 5, 3);
  assert.equal(plan.blocking.length, 3, 'employee, HR rule, unit scope');
  assert.deepEqual(plan.impact.link.employees.map(e => e.id), [8]);
  assert.equal(linkRemovalImpact({ catalog, employees: [] }, 5, 2).blocking.length, 0);
});

test('unit manager accepts any existing employee outside the unit company', () => {
  assert.equal(unitManagerIssue({ id: 6, employment_status: 'active', company_id: null }, 7), null);
  assert.equal(unitManagerIssue({ id: 6, employment_status: 'active', company_id: 5 }, 6, catalog.companies), null);
  assert.equal(unitManagerIssue({ id: 6, employment_status: 'inactive', company_id: 6 }, 6), null);
  assert.equal(unitManagerIssue({ id: 6, employment_status: 'active', company_id: 6 }, 6), null);
  assert.equal(unitManagerIssue({ id: 6, employment_status: 'deleted' }, 6).code, 'INVALID_UNIT_MANAGER');
});

test('legacy adoption requires every current user to be in the company; reactivation requires scope review', () => {
  const unit = catalog.departments.find(d => d.id === 4);
  assert.equal(legacyAdoptionImpact({ catalog, employees: staff }, unit, 5).blocking[0].code, 'UNIT_OUTSIDE_COMPANY');
  const ok = legacyAdoptionImpact({ catalog, employees: [{ id: 1, employment_status: 'active', department_id: 4, company_id: 5 }] }, unit, 5);
  assert.equal(ok.blocking.length, 0); assert.ok(ok.confirmationToken);
  const plan = reactivationImpact({ id: 65 }, { branch_scope: 'all', branchIds: [] });
  assert.equal(plan.warnings[0].code, 'SCOPE_REVIEW_REQUIRED'); assert.ok(plan.confirmationToken);
});

/* ---------------------------------------------------------------- legacy display */

test('retained legacy values stay readable with reasons; no silent auto-mapping', () => {
  assert.deepEqual(assignmentIssues(catalog, legacyEmployee, legacyEmployee), [], 'an untouched legacy assignment still saves unrelated edits');
  const diagnostics = assignmentDiagnostics(catalog, { ...legacyEmployee, grade_id: 1 }, []);
  const codes = diagnostics.map(d => d.code);
  assert.ok(codes.includes('LEGACY_UNIT') && codes.includes('INACTIVE_RETAINED_VALUE'));
  const options = assignmentOptions(catalog, { companyId: '5', branchId: '3', departmentId: '' }, []);
  assert.ok(options.departmentId.every(u => u.company_id === 5), 'legacy units are never offered as replacements');
  assert.ok(options.departmentId.length > 0, 'valid replacements are offered');
  assert.ok(!options.jobTitleId.some(t => t.id === 14), 'legacy-bound titles are not offered for a new department');
});

test('messages resolve per language from structured errors', () => {
  const error = new OrganizationError({ code: 'BRANCH_NOT_LINKED', field: 'branch_id', message_ar: 'الفرع غير مرتبط', message_en: 'Branch does not belong' });
  assert.equal(organizationMessage(error, true), 'الفرع غير مرتبط');
  assert.equal(organizationMessage(error, false), 'Branch does not belong');
  assert.equal(error.message, 'الفرع غير مرتبط / Branch does not belong', 'legacy "ar / en" message kept');
});

test('API boundary keeps the machine-readable fields', async () => {
  const response = organizationResponse(new OrganizationError({ code: 'JOB_TITLE_DEPARTMENT_MISMATCH', field: 'job_title_id', message_ar: 'أ', message_en: 'b', blocking_entity: { type: 'job_title', id: 14 } }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.deepEqual([body.code, body.field, body.message_en, body.blocking_entity.id], ['JOB_TITLE_DEPARTMENT_MISMATCH', 'job_title_id', 'b', 14]);
  assert.ok(body.error);
});

/* ---------------------------------------------------------------- catalog service (mocked DB) */

const tables = { companies: 'companies', branches: 'branches', company_branches: 'companyBranches', departments: 'departments', organization_branch_scopes: 'branchScopes', positions: 'positions', job_grades: 'grades', work_locations: 'workLocations', hr_responsibility_rules: 'hrRules', job_titles: 'jobTitles', employees: 'employees' };
function serviceDb(before, data, counts = { total: 0, active: 0 }, employeeRow = null) {
  const writes = [];
  return { writes, prepare(sql) { let params = []; return { bind(...args) { params = args; return this; }, async run() { writes.push({ sql, params }); }, async first() { if (sql.includes('FOR UPDATE')) return before; if (/^(UPDATE|INSERT)/.test(sql)) { writes.push({ sql, params }); return { id: before?.id || 7 }; } if (sql.includes('FROM employees WHERE id=?')) return employeeRow; return null; }, async all() { if (sql.includes('count(*)')) return { results: counts.total ? [{ record_id: before?.id ?? 7, ...counts }] : [] }; const table = sql.match(/FROM (\w+)/)?.[1]; return { results: data[tables[table]] || [] }; } }; } };
}
const unitBefore = { id: 1, name_ar: 'برمجيات', name_en: 'Software', company_id: 5, organization_kind: 'department', parent_id: null, branch_scope: 'all', status: 'active', manager_employee_id: null };

test('unit manager from another company can be saved', async () => {
  await assert.doesNotReject(saveOrganizationEntity(serviceDb(unitBefore, catalog, undefined, { id: 6, employment_status: 'active', company_id: 9 }), 'departments', { ...unitBefore, manager_employee_id: 6 }));
});

test('deactivation is blocked by active dependents with an exact breakdown', async () => {
  const error = await saveOrganizationEntity(serviceDb(unitBefore, catalog, { total: 11, active: 8 }), 'departments', { ...unitBefore, status: 'inactive' }).catch(e => e);
  assert.equal(error.status, 409);
  const body = await error.json();
  assert.equal(body.code, 'ACTIVE_DEPENDENTS');
  assert.match(body.message_en, /active employee/);
});

test('reactivating a mapped inactive unit needs the reviewed scope token; the preview returns it', async () => {
  const inactive = { ...unitBefore, status: 'inactive' };
  const refused = await saveOrganizationEntity(serviceDb(inactive, catalog), 'departments', { ...inactive, status: 'active' }).catch(e => e);
  assert.equal((await refused.json()).code, 'IMPACT_NOT_CONFIRMED');
  const preview = await previewOrganizationEntity(serviceDb(inactive, catalog), 'departments', { ...inactive, status: 'active' });
  assert.equal(preview.warnings[0].code, 'SCOPE_REVIEW_REQUIRED');
  const db = serviceDb(inactive, catalog);
  await saveOrganizationEntity(db, 'departments', { ...inactive, status: 'active', confirmImpact: preview.confirmationToken });
  const audit = db.writes.find(w => w.sql.includes('audit_logs'));
  assert.deepEqual(JSON.parse(audit.params[4]).statusChange, { before: 'inactive', after: 'active' });
});

test('delete is refused for referenced records and allowed (with audit) for never-used ones', async () => {
  const grade = { id: 3, name_ar: 'د', name_en: 'G', code: 'G', sort_order: 0, status: 'active' };
  const refused = await deleteOrganizationEntity(serviceDb(grade, catalog, { total: 2, active: 0 }), 'grades', 3).catch(e => e);
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).code, 'REFERENCED_ENTITY_CONFLICT');
  const db = serviceDb(grade, catalog);
  assert.deepEqual(await deleteOrganizationEntity(db, 'grades', 3, 9), { id: 3, deleted: true });
  assert.ok(db.writes.some(w => w.sql.startsWith('DELETE FROM job_grades')));
  assert.ok(db.writes.some(w => w.sql.includes("'delete','system_settings'")));
});

test('force delete removes a referenced unit and its sub-units, deepest first, clearing references with an audit per unit', async () => {
  const units = [{ id: 1, name_en: 'Dept', company_id: 5, parent_id: null }, { id: 2, name_en: 'Section', company_id: 5, parent_id: 1 }, { id: 3, name_en: 'Team', company_id: 5, parent_id: 2 }, { id: 4, name_en: 'Other', company_id: 5, parent_id: null }];
  const writes = [];
  const db = { prepare(sql) { const q = values => ({ bind: (...v) => q(v), async first() { return null; }, async run() { writes.push({ sql, values }); return { results: [] }; },
    async all() { if (sql.startsWith('SELECT * FROM departments')) return { results: units }; if (sql.startsWith('SELECT branch_id')) return { results: [] };
      writes.push({ sql, values }); return { results: sql.startsWith('UPDATE employees SET department_id') && values[0] === 1 ? [{ id: 33 }] : [] }; } }); return q([]); } };
  assert.deepEqual(await forceDeleteDepartment(db, 1, 9), { id: 1, deleted: true, forced: true, deletedUnitIds: [1, 2, 3] });
  const deletes = writes.filter(w => w.sql.startsWith('DELETE FROM departments')).map(w => w.values[0]);
  assert.deepEqual(deletes, [3, 2, 1], 'children are removed before their parent; unrelated units untouched');
  assert.ok(writes.some(w => w.sql.startsWith('UPDATE employees SET section_id=NULL') && w.values[0] === 2));
  assert.ok(writes.some(w => w.sql.startsWith('UPDATE positions SET team_id=NULL') && w.values[0] === 3));
  assert.ok(writes.some(w => w.sql.startsWith('UPDATE job_titles SET department_id=NULL') && w.values[0] === 1));
  const audits = writes.filter(w => w.sql.includes("'delete','system_settings','departments'"));
  assert.equal(audits.length, 3);
  assert.deepEqual(JSON.parse(audits[2].values[3]).detached, { 'employees:department_id': [33] });
  assert.equal((await forceDeleteDepartment(db, 99, 9).catch(e => e)).status, 404);
});

test('force delete of a job title clears employees, positions and openings before deleting, with audit', async () => {
  const writes = [];
  const db = { prepare(sql) { const q = values => ({ bind: (...v) => q(v), async first() { return sql.startsWith('SELECT * FROM job_titles') ? { id: 14, name_en: 'Dev' } : null; }, async run() { writes.push({ sql, values }); return { results: [] }; },
    async all() { writes.push({ sql, values }); return { results: sql.startsWith('UPDATE employees') ? [{ id: 7 }, { id: 8 }] : [] }; } }); return q([]); } };
  assert.deepEqual(await forceDeleteOrganizationEntity(db, 'jobTitles', 14, 9), { id: 14, deleted: true, forced: true });
  const order = writes.map(w => w.sql.split(' SET ')[0].split(' WHERE ')[0]);
  assert.deepEqual(order.filter(s => /^(UPDATE|DELETE)/.test(s)), ['UPDATE employees', 'UPDATE positions', 'UPDATE job_openings', 'DELETE FROM job_titles']);
  assert.ok(!writes.find(w => w.sql.startsWith('UPDATE job_openings')).sql.includes('updated_at'));
  assert.deepEqual(JSON.parse(writes.find(w => w.sql.includes('audit_logs')).values[4]).detached, { 'employees:job_title_id': [7, 8] });
  assert.equal((await forceDeleteOrganizationEntity(db, 'grades', 1, 9).catch(e => e)).status, 400);
});

test('positions: conflicting unit/title definitions are rejected with the underlying code', async () => {
  const error = await saveOrganizationEntity(serviceDb(null, catalog), 'positions', { name_ar: 'و', name_en: 'P', code: 'P9', company_id: 5, department_id: 1, job_title_id: 14 }).catch(e => e);
  assert.equal(error.status, 400);
  assert.equal((await error.json()).code, 'JOB_TITLE_DEPARTMENT_MISMATCH');
  await assert.doesNotReject(saveOrganizationEntity(serviceDb(null, catalog), 'positions', { name_ar: 'و', name_en: 'CEO', code: 'CEO6', company_id: 6, is_ceo: 1 }), 'company-level CEO position needs no department');
});
