import test from 'node:test';
import assert from 'node:assert/strict';
import {
  organizationSettingsAccess, usageBreakdown, usageOf, lockState, unitNeedsReview, deriveCompanyCeo, HR_PRECEDENCE,
  resolveHrScope, attributeRuleEmployees, sortHrRules, hrRuleRank, bilingualMessage, branchScopeLabel, companyIncomplete, hrResponsibleUsable,
} from '../app/organization/settings-model.ts';
import { sortGrades, titlesForDepartment, sectionsOf, teamsOf, parentUnitChoices, optionsFor, branchesOfCompany, nameOf } from '../app/organization/selectors.ts';

const grant = (role_id, module, action, allowed = 1) => ({ role_id, module, action, allowed });
const hr = { role_id: 4, role_name: 'HR Manager' };

/* ---------------------------------------------------------------- permissions */

test('settings access needs the role AND system_settings/view; manage needs manage_settings', () => {
  assert.deepEqual(organizationSettingsAccess({ role_id: 2, role_name: 'Super Admin' }, []), { canView: true, canManage: true, canCreateJobTitles: true, canEditJobTitles: true, canForceDelete: true });
  const viewOnly = organizationSettingsAccess(hr, [grant(4, 'system_settings', 'view')]);
  assert.equal(viewOnly.canView, true); assert.equal(viewOnly.canManage, false); assert.equal(viewOnly.canEditJobTitles, false);
  const manager = organizationSettingsAccess(hr, [grant(4, 'system_settings', 'view'), grant(4, 'system_settings', 'manage_settings')]);
  assert.equal(manager.canManage, true);
  assert.equal(manager.canForceDelete, false, 'force delete is Super Admin only');
  assert.equal(manager.canCreateJobTitles, false, 'job titles also need their own catalog permission');
  const withTitles = organizationSettingsAccess(hr, [grant(4, 'system_settings', 'view'), grant(4, 'system_settings', 'manage_settings'), grant(4, 'job_titles', 'create'), grant(4, 'job_titles', 'edit')]);
  assert.equal(withTitles.canCreateJobTitles && withTitles.canEditJobTitles, true);
  assert.equal(organizationSettingsAccess(hr, [grant(4, 'system_settings', 'view', 0)]).canView, false, 'a denied grant is not a grant');
});

test('department and job-title permissions never expose organizational settings', () => {
  const everythingExceptSettings = [grant(1031, 'departments', 'view'), grant(1031, 'departments', 'manage_settings'), grant(1031, 'job_titles', 'view'), grant(1031, 'job_titles', 'edit'), grant(4, 'departments', 'edit'), grant(4, 'job_titles', 'edit')];
  assert.equal(organizationSettingsAccess({ role_id: 4, role_name: 'HR Manager' }, everythingExceptSettings).canView, false);
  // Even a full system_settings grant does not cross the Super Admin / HR Manager role boundary.
  const stray = [grant(1031, 'system_settings', 'view'), grant(1031, 'system_settings', 'manage_settings')];
  for (const role_name of ['Department Manager', 'Employee']) assert.deepEqual(organizationSettingsAccess({ role_id: 1031, role_name }, stray), { canView: false, canManage: false, canCreateJobTitles: false, canEditJobTitles: false, canForceDelete: false });
  assert.equal(organizationSettingsAccess(null, undefined).canView, false);
});

/* ---------------------------------------------------------------- usage and locks */

const usage = references => {
  const total = Object.values(references).reduce((sum, r) => sum + r.total, 0), active = Object.values(references).reduce((sum, r) => sum + r.active, 0);
  return { total, active, historical: total - active, references };
};

test('usage is grouped by table and counts come straight from the server figures', () => {
  const u = usage({ 'employees:department_id': { total: 8, active: 6 }, 'employees:section_id': { total: 2, active: 2 }, 'positions:department_id': { total: 3, active: 1 }, 'company_branches:company_id': { total: 2, active: 0 } });
  const lines = usageBreakdown(u);
  assert.deepEqual(lines.map(l => [l.group, l.total, l.active]), [['employees', 10, 8], ['positions', 3, 1], ['company_branches', 2, 0]]);
  assert.deepEqual(usageOf({ companies: { 5: u } }, 'companies', 5), u);
  assert.deepEqual(usageOf({}, 'companies', 9), { total: 0, active: 0, historical: 0, references: {} });
});

test('deactivation is locked only by ACTIVE dependents and the message says why', () => {
  const locks = lockState(usage({ 'employees:company_id': { total: 15, active: 12 }, 'positions:company_id': { total: 2, active: 2 } }));
  assert.equal(locks.deactivate.en, 'Locked: used by 12 active employees, 2 active positions');
  assert.match(locks.deactivate.ar, /^مقفل/);
  assert.equal(lockState(usage({ 'employees:company_id': { total: 1, active: 1 } })).deactivate.en, 'Locked: used by 1 active employee');
  const historicalOnly = lockState(usage({ 'employees:department_id': { total: 4, active: 0 } }));
  assert.equal(historicalOnly.deactivate, null, 'historical references do not block status-only deactivation');
  assert.match(historicalOnly.structural.en, /^Structural fields are locked: referenced by 4 employees/);
});

test('company/branch link rows alone never lock structural fields', () => {
  const linksOnly = lockState(usage({ 'company_branches:branch_id': { total: 3, active: 0 } }));
  assert.equal(linksOnly.structural, null);
  assert.equal(linksOnly.deactivate, null);
  assert.equal(lockState(usage({})).structural, null);
});

test('lock messages honour the number formatter (Arabic digits on Arabic screens)', () => {
  const arabic = new Intl.NumberFormat('ar-SA-u-nu-arab');
  const locks = lockState(usage({ 'employees:company_id': { total: 12, active: 12 } }), value => arabic.format(value));
  assert.match(locks.deactivate.ar, /١٢/);
});

/* ---------------------------------------------------------------- legacy review */

test('legacy units without a company are flagged for review; deleted ones are not', () => {
  assert.equal(unitNeedsReview({ id: 1, company_id: null, status: 'active' }), true);
  assert.equal(unitNeedsReview({ id: 2, company_id: null, status: 'inactive' }), true);
  assert.equal(unitNeedsReview({ id: 3, company_id: null, status: 'deleted' }), false);
  assert.equal(unitNeedsReview({ id: 4, company_id: 7, status: 'active' }), false);
  assert.equal(companyIncomplete({ name: 'Legacy', name_ar: null, name_en: null, code: null }), true);
  assert.equal(companyIncomplete({ name_ar: 'ا', name_en: 'A', code: 'A' }), false);
});

/* ---------------------------------------------------------------- CEO */

const ceoPosition = (id, company_id, extra = {}) => ({ id, company_id, is_ceo: 1, status: 'active', ...extra });
test('the CEO is derived from the occupant of the active CEO position', () => {
  const occupants = { 10: [{ id: 1, name_en: 'Layla' }], 11: [{ id: 2, name_en: 'Someone' }] };
  const positions = [ceoPosition(10, 5), { id: 11, company_id: 5, is_ceo: 0, status: 'active' }, ceoPosition(12, 6)];
  const occupied = deriveCompanyCeo(5, positions, occupants);
  assert.equal(occupied.state, 'occupied'); assert.equal(occupied.ceo.name_en, 'Layla');
  assert.equal(deriveCompanyCeo(6, positions, occupants).state, 'vacant');
  assert.equal(deriveCompanyCeo(7, positions, occupants).state, 'none');
  assert.equal(deriveCompanyCeo(5, [ceoPosition(10, 5, { status: 'inactive' })], occupants).state, 'none', 'an inactive CEO position does not count');
  assert.equal(deriveCompanyCeo(5, positions, { 10: [{ id: 1 }, { id: 3 }] }).state, 'conflict');
  assert.equal(deriveCompanyCeo(5, positions, undefined).state, 'vacant');
});

/* ---------------------------------------------------------------- HR responsibility */

const catalog = (extra = {}) => ({ companies: [], branches: [], companyBranches: [], departments: [], branchScopes: [], positions: [], grades: [], workLocations: [], hrRules: [], jobTitles: [], ...extra });
const rule = (id, company_id, branch_id, hr_user_id, status = 'active') => ({ id, company_id, branch_id, hr_user_id, status });
const roster = [{ user_id: 20, status: 'active', eligible: true, name_en: 'Huda' }, { user_id: 21, status: 'active', eligible: true, name_en: 'Second' }, { user_id: 22, status: 'inactive', eligible: true }, { user_id: 23, status: 'active', eligible: false }];

test('precedence is employee override, then company+branch, then branch fallback', () => {
  assert.deepEqual(HR_PRECEDENCE.map(step => [step.rank, step.source]), [[1, 'employee_override'], [2, 'company_branch'], [3, 'branch_fallback']]);
  assert.equal(hrRuleRank(rule(1, 5, 3, 20)), 2);
  assert.equal(hrRuleRank(rule(2, null, 3, 20)), 3);
});

test('resolution tester picks the company+branch rule over the branch fallback and names its source', () => {
  const c = catalog({ hrRules: [rule(1, null, 3, 21), rule(2, 5, 3, 20)] });
  const specific = resolveHrScope(c, roster, 5, 3);
  assert.equal(specific.source, 'company_branch'); assert.equal(specific.rank, 2); assert.equal(specific.hr.user_id, 20); assert.equal(specific.unavailable, false);
  const fallback = resolveHrScope(c, roster, 6, 3);
  assert.equal(fallback.source, 'branch_fallback'); assert.equal(fallback.rank, 3); assert.equal(fallback.hr.user_id, 21);
  assert.equal(resolveHrScope(c, roster, 5, 4).source, 'none');
  assert.equal(resolveHrScope(c, roster, '', 3).source, 'none');
});

test('inactive rules are ignored and an unavailable HR is reported rather than hidden', () => {
  const c = catalog({ hrRules: [rule(1, 5, 3, 20, 'inactive'), rule(2, null, 3, 21)] });
  assert.equal(resolveHrScope(c, roster, 5, 3).source, 'branch_fallback');
  const gone = catalog({ hrRules: [rule(3, 5, 3, 22), rule(4, 6, 3, 23)] });
  assert.equal(resolveHrScope(gone, roster, 5, 3).unavailable, true, 'inactive roster entry');
  assert.equal(resolveHrScope(gone, roster, 6, 3).unavailable, true, 'ineligible roster entry');
  assert.equal(hrResponsibleUsable(roster[0]), true); assert.equal(hrResponsibleUsable(roster[3]), false); assert.equal(hrResponsibleUsable(undefined), false);
});

test('rules list company+branch rules before branch fallbacks', () => {
  const c = catalog({ branches: [{ id: 3, name_en: 'Cairo' }, { id: 4, name_en: 'Riyadh' }], companies: [{ id: 5, name_en: 'KOON' }], hrRules: [rule(1, null, 3, 20), rule(2, 5, 4, 20), rule(3, 5, 3, 20)] });
  assert.deepEqual(sortHrRules(c.hrRules, c, false).map(r => r.id), [3, 2, 1]);
});

test('routed-employee counts follow the rule that wins and keep explicit overrides separate', () => {
  const c = catalog({ hrRules: [rule(1, 5, 3, 20), rule(2, null, 4, 21)] });
  const result = attributeRuleEmployees(c, [{ company_id: 5, branch_id: 3, employees: 10, overrides: 2 }, { company_id: 9, branch_id: 4, employees: 4, overrides: 0 }, { company_id: 5, branch_id: 8, employees: 3, overrides: 1 }]);
  assert.deepEqual(result.perRule, { 1: 8, 2: 4 });
  assert.equal(result.overrides, 3); assert.equal(result.unrouted, 2);
});

/* ---------------------------------------------------------------- grades, titles, units */

test('grades sort by sort_order, then English name, then id — never by a hard-coded list', () => {
  const grades = [{ id: 4, name_en: 'Senior', sort_order: 20 }, { id: 2, name_en: 'Junior', sort_order: 10 }, { id: 9, name_en: 'Alpha', sort_order: 20 }, { id: 5, name_en: 'alpha', sort_order: 20 }, { id: 1, name_en: 'Director', sort_order: '5' }, { id: 7, name_en: 'Zed', sort_order: 0 }];
  const sorted = sortGrades(grades);
  assert.deepEqual(sorted.map(g => g.id), [7, 1, 2, 5, 9, 4]);
  assert.equal(grades[0].id, 4, 'the input array is not mutated');
});

test('generic titles are offered to every department; department titles only to their own', () => {
  const c = catalog({ jobTitles: [{ id: 1, status: 'active', department_id: null }, { id: 2, status: 'active', department_id: 10 }, { id: 3, status: 'active', department_id: 11 }, { id: 4, status: 'deleted', department_id: null }] });
  assert.deepEqual(titlesForDepartment(c, 10).map(t => t.id), [1, 2]);
  assert.deepEqual(titlesForDepartment(c, 11).map(t => t.id), [1, 3]);
  assert.deepEqual(titlesForDepartment(c, null).map(t => t.id), [1], 'before a department is chosen only generic titles apply');
});

test('archived titles render as inactive: hidden from choices unless already selected, then disabled', () => {
  const rows = [{ id: 1, name_en: 'Active', status: 'active' }, { id: 2, name_en: 'Old', status: 'archived' }];
  assert.deepEqual(optionsFor(rows, false).map(o => o.label), ['Active']);
  const kept = optionsFor(rows, false, 2);
  assert.equal(kept[1].label, 'Old (inactive)'); assert.equal(kept[1].disabled, true);
  assert.equal(optionsFor(rows, true, 2)[1].label, 'Old (غير نشط)');
});

const units = [
  { id: 1, company_id: 5, organization_kind: 'department', status: 'active' }, { id: 2, company_id: 5, organization_kind: 'department', status: 'active' },
  { id: 3, company_id: 5, organization_kind: 'section', parent_id: 1, status: 'active' }, { id: 4, company_id: 5, organization_kind: 'team', parent_id: 3, status: 'active' },
  { id: 5, company_id: 5, organization_kind: 'team', parent_id: 1, status: 'active' }, { id: 6, company_id: 6, organization_kind: 'department', status: 'active' },
];
test('sections and teams are optional and follow their parent rules', () => {
  const c = catalog({ departments: units });
  assert.deepEqual(sectionsOf(c, 5, 2), [], 'a department without sections offers none');
  assert.deepEqual(sectionsOf(c, 5, 1).map(u => u.id), [3]);
  assert.deepEqual(teamsOf(c, 5, 1).map(u => u.id), [5], 'without a section, teams directly under the department');
  assert.deepEqual(teamsOf(c, 5, 1, 3).map(u => u.id), [4], 'with a section, only that section’s teams');
  assert.deepEqual(teamsOf(c, 5, null), []);
});

test('parent choices: departments have none, sections take departments, teams take departments or sections, same company only', () => {
  const c = catalog({ departments: units });
  assert.deepEqual(parentUnitChoices(c, 'department', 5), []);
  assert.deepEqual(parentUnitChoices(c, 'section', 5).map(u => u.id), [1, 2]);
  assert.deepEqual(parentUnitChoices(c, 'team', 5).map(u => u.id), [1, 2, 3]);
  assert.deepEqual(parentUnitChoices(c, 'section', 5, 1).map(u => u.id), [2], 'a unit is never its own parent');
  assert.deepEqual(parentUnitChoices(c, 'section', 6).map(u => u.id), [6]);
  assert.deepEqual(parentUnitChoices(c, 'section', ''), []);
});

test('branch scope labels and company branch lookups', () => {
  const c = catalog({ branches: [{ id: 3, name_en: 'Cairo', name_ar: 'القاهرة', status: 'active' }, { id: 4, name_en: 'Riyadh', name_ar: 'الرياض', status: 'active' }], companyBranches: [{ company_id: 5, branch_id: 3 }], branchScopes: [{ department_id: 1, branch_id: 3 }, { department_id: 1, branch_id: 4 }] });
  assert.equal(branchScopeLabel({ id: 2, branch_scope: 'all' }, c, false), 'All company branches');
  assert.equal(branchScopeLabel({ id: 1, branch_scope: 'selected' }, c, false), 'Cairo, Riyadh');
  assert.equal(branchScopeLabel({ id: 1, branch_scope: 'selected' }, c, true), 'القاهرة، الرياض');
  assert.deepEqual(branchesOfCompany(c, 5).map(b => b.id), [3]);
  assert.equal(nameOf({ name_ar: 'ع', name_en: 'E' }, true), 'ع');
  assert.equal(nameOf({ name: 'Legacy' }, true), 'Legacy');
});

test('bilingual server messages resolve to the interface language', () => {
  const message = 'الرمز مستخدم بالفعل / This code already exists';
  assert.equal(bilingualMessage(message, true), 'الرمز مستخدم بالفعل');
  assert.equal(bilingualMessage(message, false), 'This code already exists');
  assert.equal(bilingualMessage('Forbidden', false), null);
});
