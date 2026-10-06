import assert from 'node:assert/strict';
import test from 'node:test';
import { organizationIntegrityIssues, normalizeOrgName } from '../app/organization/integrity.ts';

const active = (id, extra = {}) => ({ id, status: 'active', ...extra });
const unit = (id, company_id, organization_kind, parent_id = null, names = {}) => active(id, { company_id, organization_kind, parent_id, branch_scope: 'all', name_ar: `وحدة ${id}`, name_en: `Unit ${id}`, ...names });
const hr = (user_id, employee_id) => ({ user_id, status: 'active', employee_id, account_status: 'active', role_name: 'HR Manager', employee_status: 'active', eligible: true });
// Two companies sharing both branches, each with its own department > section, like KOON Software and Asus Cards.
const base = () => ({
  companies: [active(5), active(6)], branches: [active(2), active(3)],
  companyBranches: [{ company_id: 5, branch_id: 2 }, { company_id: 5, branch_id: 3 }, { company_id: 6, branch_id: 2 }, { company_id: 6, branch_id: 3 }],
  departments: [unit(1, 5, 'department'), unit(73, 5, 'section', 1), unit(79, 6, 'department', null, { name_ar: 'المالية', name_en: 'Finance' }), unit(85, 6, 'section', 79, { name_ar: 'الحسابات', name_en: 'Accounting' })],
  branchScopes: [], grades: [], workLocations: [],
  positions: [active(13, { company_id: 6, is_ceo: 1 }), active(20, { company_id: 6, department_id: 79, section_id: 85, job_title_id: 25 })],
  jobTitles: [active(25, { department_id: 79, name_ar: 'محاسب', name_en: 'Accountant' }), active(50, { department_id: null, name_ar: 'الرئيس التنفيذي', name_en: 'Chief Executive Officer' }), active(26, { department_id: null, name_ar: 'الرئيس التنفيذي', name_en: 'Chief Executive Officer' })],
  hrRules: [active(1, { company_id: 5, branch_id: 3, hr_user_id: 9 }), active(2, { company_id: 6, branch_id: 2, hr_user_id: 18 })],
});
const roster = [hr(9, 109), hr(18, 20)];
const employees = [
  { id: 20, employment_status: 'active', company_id: 6, branch_id: 2, department_id: 79, section_id: null },
  { id: 28, employment_status: 'active', company_id: 6, branch_id: 3, department_id: 79, section_id: 85, position_id: 20, job_title_id: 25, manager_id: 20 },
  { id: 33, employment_status: 'active', company_id: 6, branch_id: 2, position_id: 13 },
  { id: 109, employment_status: 'active', company_id: 5, branch_id: 3, department_id: 1, section_id: 73 },
];
const check = catalog => organizationIntegrityIssues(catalog, [], roster);
const codes = issues => issues.map(i => `${i.code}#${i.id}`).sort();

test('the cleaned organization has no integrity issues', () => {
  assert.deepEqual(organizationIntegrityIssues(base(), employees, roster), []);
});

test('a unit can never be its own parent, and parent cycles are reported', () => {
  const catalog = base();
  catalog.departments.push(unit(91, 6, 'section', 91, { name_ar: 'الخدمات العامة', name_en: 'General Services' }));
  assert.ok(codes(check(catalog)).includes('SELF_PARENT#91'));
  const cyclic = base();
  cyclic.departments.push(unit(100, 6, 'section', 101), unit(101, 6, 'section', 100));
  assert.ok(codes(check(cyclic)).includes('HIERARCHY_CYCLE#100'));
});

test('department hierarchy follows department > section > team', () => {
  const catalog = base();
  catalog.departments.push(unit(12, 6, 'department', 79, { name_ar: 'قسم', name_en: 'Nested' }), unit(200, 6, 'section', 85, { name_ar: 'س', name_en: 'S' }), unit(201, 6, 'team', null, { name_ar: 'ف', name_en: 'T' }));
  assert.deepEqual(codes(check(catalog)), ['KIND_PARENT#12', 'KIND_PARENT#200', 'KIND_PARENT#201']);
});

test('duplicate active units within a company are caught despite spelling variants; inactive duplicates are ignored', () => {
  const catalog = base();
  catalog.departments.push(unit(80, 6, 'department', null, { name_ar: 'الماليه', name_en: 'Finance Dept' }), unit(81, 6, 'department', null, { name_ar: 'خزينة', name_en: 'finance' }));
  catalog.departments.push({ ...unit(12, 6, 'department', null, { name_ar: 'المالية', name_en: 'Finance' }), status: 'inactive' });
  assert.deepEqual(codes(check(catalog)), ['DUPLICATE_UNIT#80', 'DUPLICATE_UNIT#81']);
  assert.equal(normalizeOrgName(' أمن  الشبكات '), normalizeOrgName('امن الشبكات'));
  assert.equal(normalizeOrgName('الخدمات العامه'), normalizeOrgName('الخدمات العامة'));
});

test('company isolation: same names in different companies are allowed, cross-company links are not', () => {
  const catalog = base();
  catalog.departments.push(unit(97, 5, 'department', null, { name_ar: 'المالية', name_en: 'Finance' }));
  assert.deepEqual(check(catalog), []);
  catalog.departments.push(unit(300, 5, 'section', 79, { name_ar: 'عابر', name_en: 'Cross' }));
  catalog.positions.push(active(40, { company_id: 5, department_id: 79 }));
  assert.deepEqual(codes(check(catalog)), ['PARENT_INVALID#300', 'POSITION_UNIT#40']);
  const crossEmployee = [{ id: 1, employment_status: 'active', company_id: 5, branch_id: 3, department_id: 79 }];
  assert.ok(codes(organizationIntegrityIssues(base(), crossEmployee, roster)).includes('EMPLOYEE:UNIT_OUTSIDE_COMPANY#1'));
});

test('a unit manager must belong to the unit company', () => {
  const catalog = base();
  catalog.departments.push(unit(82, 6, 'department', null, { name_ar: 'تطوير الأعمال', name_en: 'Business Development', manager_employee_id: 109 }));
  assert.deepEqual(codes(organizationIntegrityIssues(catalog, employees, roster)), ['UNIT_MANAGER_COMPANY#82']);
  catalog.departments.at(-1).manager_employee_id = null;
  assert.deepEqual(organizationIntegrityIssues(catalog, employees, roster), []);
});

test('job titles bind to active departments only; company-level CEO titles may repeat; one CEO position per company', () => {
  const catalog = base();
  catalog.jobTitles.push(active(57, { department_id: 79, name_ar: 'محاسب', name_en: 'Accountant' }), active(60, { department_id: 85, name_ar: 'م', name_en: 'M' }));
  catalog.positions.push(active(14, { company_id: 6, is_ceo: 1 }));
  assert.deepEqual(codes(check(catalog)), ['DUPLICATE_CEO#14', 'DUPLICATE_TITLE#57', 'DUPLICATE_TITLE#57', 'TITLE_BINDING#60']);
});

test('HR responsibility rules must use a linked branch, an eligible HR and one active rule per company+branch', () => {
  const catalog = base();
  catalog.companyBranches = catalog.companyBranches.filter(l => !(l.company_id === 6 && l.branch_id === 2));
  assert.ok(codes(organizationIntegrityIssues(catalog, [], roster)).includes('HR_RULE:BRANCH_NOT_LINKED#2'));
  assert.ok(codes(organizationIntegrityIssues(base(), [], [hr(9, 109)])).includes('HR_RULE:HR_RESPONSIBLE_INVALID#2'));
  const duplicate = base();
  duplicate.hrRules.push(active(3, { company_id: 6, branch_id: 2, hr_user_id: 9 }));
  assert.ok(codes(organizationIntegrityIssues(duplicate, [], roster)).includes('HR_RULE:HR_RULE_DUPLICATE#3'));
});

test('employee assignments stay valid: company required, retired units and wrong sections are flagged, deleted employees skipped', () => {
  const catalog = base();
  catalog.departments.push({ ...unit(12, 6, 'department', null, { name_ar: 'قديم', name_en: 'Old' }), status: 'inactive' });
  const rows = [
    { id: 1, employment_status: 'active', company_id: null },
    { id: 2, employment_status: 'active', company_id: 6, branch_id: 3, department_id: 12 },
    { id: 3, employment_status: 'active', company_id: 6, branch_id: 3, department_id: 79, section_id: 73 },
    { id: 4, employment_status: 'deleted', company_id: null, department_id: 12 },
  ];
  const found = codes(organizationIntegrityIssues(catalog, rows, roster));
  assert.ok(found.includes('EMPLOYEE_COMPANY#1'));
  assert.ok(found.includes('EMPLOYEE:INACTIVE_RETAINED_VALUE#2'));
  assert.ok(found.some(c => c.endsWith('#3') && /UNIT_OUTSIDE_COMPANY|INVALID_PARENT/.test(c)));
  assert.ok(!found.some(c => c.endsWith('#4')));
});
