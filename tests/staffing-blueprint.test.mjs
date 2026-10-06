import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BLUEPRINT_SIZES, BlueprintError, SENIORITY_LEVELS, assertCompanyBlueprintEditable, assertTemplateTransition, blueprintAccess, buildHierarchy, departmentSubtreeIds, flattenHierarchy, generateTree, normalizeName, planApply,
  positionWouldCycle, removeDepartment, removePosition, totalHeadcount, validateDepartmentInput, validateGenerateInput, validatePositionInput, validateTemplateInput,
} from '../app/blueprint/policy.ts';
import { DEFAULT_TYPES, SIZE_FLOORS, defaultTemplates, expandDefault } from '../app/blueprint/defaults.ts';
import { TITLES, UNITS } from '../app/blueprint/default-titles.ts';
import { PAGE_MODULES } from '../app/page-availability.ts';
import { PAGE_LABELS } from '../app/navigation-labels.ts';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const rejects = (fn, code) => assert.throws(fn, error => error instanceof BlueprintError && (!code || error.issue.code === code), code);
const spec = code => DEFAULT_TYPES.find(t => t.code === code);
const names = tree => tree.departments.map(d => d.name.en);
const titles = tree => tree.positions.map(p => p.title.en);
const name = (en, ar = en) => ({ en, ar });

/** A tiny hand-built tree used by the editing tests. */
function sample() {
  return {
    departments: [
      { id: 1, parentId: null, kind: 'department', name: name('Engineering', 'الهندسة'), required: true, sortOrder: 0 },
      { id: 2, parentId: 1, kind: 'team', name: name('Backend', 'الخلفية'), required: true, sortOrder: 0 },
      { id: 3, parentId: null, kind: 'department', name: name('HR', 'الموارد البشرية'), required: false, sortOrder: 1 },
    ],
    positions: [
      { id: 10, departmentId: 1, parentPositionId: null, title: name('Head of Engineering', 'رئيس الهندسة'), headcount: 1, seniority: 'director', required: true, perBranch: false, description: null, sortOrder: 0 },
      { id: 11, departmentId: 2, parentPositionId: 10, title: name('Tech Lead', 'قائد فني'), headcount: 1, seniority: 'lead', required: true, perBranch: false, description: null, sortOrder: 0 },
      { id: 12, departmentId: 2, parentPositionId: 11, title: name('Backend Developer', 'مطور خلفية'), headcount: 3, seniority: 'mid', required: true, perBranch: false, description: null, sortOrder: 1 },
      { id: 13, departmentId: 3, parentPositionId: null, title: name('HR Specialist', 'أخصائي موارد بشرية'), headcount: 1, seniority: 'mid', required: false, perBranch: false, description: null, sortOrder: 0 },
    ],
  };
}

/* ---------- Generation by company type and size ---------- */

test('every required company type ships a template for every size', () => {
  assert.deepEqual(DEFAULT_TYPES.map(t => t.code).sort(), ['construction', 'ecommerce', 'general_trading', 'healthcare', 'hospitality', 'it_services', 'logistics', 'manufacturing', 'marketing_agency', 'professional_services', 'retail', 'software'].sort());
  const templates = defaultTemplates();
  assert.equal(templates.length, DEFAULT_TYPES.length * BLUEPRINT_SIZES.length);
  for (const type of DEFAULT_TYPES) for (const size of BLUEPRINT_SIZES) assert.ok(templates.some(t => t.type.code === type.code && t.size === size && t.tree.positions.length > 0), `${type.code}/${size}`);
});

test('a software company gets the departments and positions of the brief', () => {
  const tree = expandDefault(spec('software'), 'medium');
  for (const dept of ['Executive Management', 'Software Engineering', 'Product & Design', 'IT', 'Human Resources', 'Finance', 'Sales', 'Marketing']) assert.ok(names(tree).includes(dept), dept);
  for (const title of ['CEO', 'COO', 'CTO / Head of Engineering', 'Engineering Manager', 'Tech Lead', 'Senior Backend Developer', 'Backend Developer', 'Senior Frontend Developer', 'Frontend Developer', 'Mobile Developer', 'QA Engineer', 'DevOps Engineer', 'Product Manager', 'Product Owner', 'UI/UX Designer', 'Business Analyst', 'IT Manager', 'System Administrator', 'IT Support', 'HR Manager', 'HR Specialist', 'Recruiter', 'Finance Manager', 'Accountant', 'Sales Manager', 'Sales Executive', 'Marketing Manager', 'Digital Marketing Specialist', 'Content Creator']) assert.ok(titles(tree).includes(title), title);
  const count = key => tree.positions.find(p => p.title.en === key).headcount;
  assert.deepEqual([count('CEO'), count('COO'), count('CTO / Head of Engineering')], [1, 1, 1]);
});

test('different company types produce different structures', () => {
  const software = titles(expandDefault(spec('software'), 'medium')), retail = titles(expandDefault(spec('retail'), 'medium')), construction = titles(expandDefault(spec('construction'), 'medium'));
  assert.ok(software.includes('Backend Developer') && !retail.includes('Backend Developer'));
  assert.ok(retail.includes('Store Manager') && retail.includes('Cashier') && !software.includes('Cashier'));
  assert.ok(construction.includes('Site Engineer') && construction.includes('Quantity Surveyor'));
  assert.ok(titles(expandDefault(spec('healthcare'), 'medium')).includes('Nurse'));
  assert.ok(titles(expandDefault(spec('hospitality'), 'medium')).includes('Head Chef'));
});

test('company size changes the result: smaller companies are flatter, larger ones add teams, specialists and departments', () => {
  const totals = BLUEPRINT_SIZES.map(size => totalHeadcount(defaultTemplates().find(t => t.type.code === 'software' && t.size === size).tree));
  assert.ok(totals[0] < totals[1] && totals[1] < totals[2] && totals[2] < totals[3], totals.join('/'));
  assert.ok(totals[0] <= 10 && totals[1] >= SIZE_FLOORS.small && totals[2] >= SIZE_FLOORS.medium - 2 && totals[3] >= 250);
  const small = expandDefault(spec('software'), 'small'), large = expandDefault(spec('software'), 'large');
  assert.ok(!small.departments.some(d => d.kind === 'team'), 'small companies have no teams: combined responsibilities in flat departments');
  assert.ok(large.departments.some(d => d.kind === 'team' && d.name.en === 'Backend Team'));
  assert.ok(!titles(small).includes('Site Reliability Engineer') && titles(large).includes('Site Reliability Engineer'));
  assert.ok(titles(large).includes('Security Engineer') && !titles(small).includes('Security Engineer'));
  assert.ok(large.departments.length > small.departments.length);
  assert.ok(!titles(small).includes('CFO') && titles(large).includes('CFO'));
  assert.ok(small.positions.length < large.positions.length);
  const micro = expandDefault(spec('software'), 'micro');
  assert.ok(!titles(micro).includes('Engineering Manager') && !names(micro).includes('Human Resources'));
});

test('every default department, team, title and description exists in Arabic and English', () => {
  for (const [key, [en, ar]] of Object.entries(UNITS)) assert.ok(en && ar && /[؀-ۿ]/.test(ar), `unit ${key}`);
  for (const [key, [en, ar, level, descEn, descAr]] of Object.entries(TITLES)) {
    assert.ok(en && /[؀-ۿ]/.test(ar) && descEn && /[؀-ۿ]/.test(descAr), `title ${key}`);
    assert.ok(SENIORITY_LEVELS.includes(level), `seniority of ${key}`);
  }
  for (const t of defaultTemplates()) {
    assert.ok(/[؀-ۿ]/.test(t.name.ar) && t.name.en);
    for (const p of t.tree.positions) assert.ok(p.description?.en && p.description?.ar && p.title.ar, `${t.type.code}:${p.title.en}`);
  }
  for (const type of DEFAULT_TYPES) assert.ok(/[؀-ۿ]/.test(type.ar), type.code);
});

test('every generated position has a valid department and reporting line inside the same blueprint, with no loops', () => {
  for (const t of defaultTemplates()) {
    const ids = new Set(t.tree.departments.map(d => d.id)), pos = new Map(t.tree.positions.map(p => [p.id, p]));
    for (const p of t.tree.positions) {
      assert.ok(ids.has(p.departmentId), `${t.type.code}/${t.size} department`);
      assert.ok(p.parentPositionId === null || pos.has(p.parentPositionId), 'parent exists');
      assert.ok(!positionWouldCycle(p.id, p.parentPositionId ?? -1, new Map(t.tree.positions.map(x => [x.id, x.parentPositionId]))) || p.parentPositionId === null, 'no loop');
    }
    assert.equal(t.tree.positions.filter(p => p.parentPositionId === null).length, 1, `${t.type.code}/${t.size} has exactly one top position`);
  }
});

test('expected employee count rescales non-leadership seats and never touches executive seats', () => {
  const base = expandDefault(spec('software'), 'medium');
  const scaled = generateTree(base, { expectedEmployees: 120 });
  assert.ok(Math.abs(totalHeadcount(scaled) - 120) <= 12, String(totalHeadcount(scaled)));
  const ceo = tree => tree.positions.find(p => p.title.en === 'CEO').headcount;
  assert.equal(ceo(scaled), 1);
  assert.equal(ceo(generateTree(base, { expectedEmployees: 4000 })), 1);
  const small = generateTree(base, { expectedEmployees: 25 });
  assert.ok(small.positions.filter(p => p.required).every(p => p.headcount >= 1), 'required roles never drop below one');
  assert.ok(small.positions.length < base.positions.length, 'optional roles that round to zero are dropped');
  for (const p of small.positions) assert.ok(p.parentPositionId === null || small.positions.some(x => x.id === p.parentPositionId));
  assert.deepEqual(generateTree(base, {}), generateTree(base, { expectedEmployees: null, branches: null }), 'no options means an exact copy');
});

test('per-branch positions multiply by the number of branches', () => {
  const retail = expandDefault(spec('retail'), 'small');
  const one = retail.positions.find(p => p.title.en === 'Store Manager').headcount;
  const three = generateTree(retail, { branches: 3 }).positions.find(p => p.title.en === 'Store Manager').headcount;
  assert.equal(three, one * 3);
  assert.equal(generateTree(retail, { branches: 1 }).positions.find(p => p.title.en === 'Store Manager').headcount, one);
  assert.equal(generateTree(retail, { branches: 3 }).positions.find(p => p.title.en === 'CEO').headcount, 1, 'company-wide seats do not multiply');
});

test('generation input is validated: type, size and optional numbers', () => {
  const ok = validateGenerateInput({ companyTypeId: '3', size: 'medium', companyId: '', expectedEmployees: '80', branches: '2', country: ' Egypt ', businessModel: 'SaaS' });
  assert.deepEqual([ok.companyTypeId, ok.size, ok.companyId, ok.expectedEmployees, ok.branches, ok.country], [3, 'medium', null, 80, 2, 'Egypt']);
  rejects(() => validateGenerateInput({ size: 'small' }), 'TYPE_REQUIRED');
  rejects(() => validateGenerateInput({ companyTypeId: 1, size: 'huge' }), 'INVALID_VALUE');
  rejects(() => validateGenerateInput({ companyTypeId: 1, size: 'small', expectedEmployees: -5 }), 'INVALID_VALUE');
  rejects(() => validateGenerateInput({ companyTypeId: 1, size: 'small', branches: 0.5 }), 'INVALID_VALUE');
  assert.equal(validateTemplateInput({ nameEn: 'X', companyTypeId: 1, size: 'small' }).name.ar, 'X', 'a name in one language mirrors into the other');
  rejects(() => validateTemplateInput({ companyTypeId: 1, size: 'small' }), 'NAME_REQUIRED');
});

/* ---------- Editing: headcount, departments, positions, hierarchy, required/optional ---------- */

test('recommended headcount is edited as a whole number between 0 and 10000', () => {
  const tree = sample();
  const edit = headcount => validatePositionInput({ departmentId: 2, titleEn: 'Backend Developer', headcount, seniority: 'mid' }, tree, 12);
  assert.equal(edit(5).headcount, 5);
  assert.equal(edit('7').headcount, 7);
  assert.equal(edit(0).headcount, 0);
  for (const bad of [-1, 1.5, 'abc', '', null, 10001]) rejects(() => edit(bad), 'HEADCOUNT_INVALID');
});

test('departments can be added and removed; removing one removes its teams and positions only', () => {
  const tree = sample();
  const section = validateDepartmentInput({ nameEn: 'Platform', kind: 'section', parentId: 1 }, tree);
  assert.deepEqual([section.kind, section.parentId, section.name.ar], ['section', 1, 'Platform']);
  assert.deepEqual([...departmentSubtreeIds(tree, 1)].sort(), [1, 2]);
  const after = removeDepartment(tree, 1);
  assert.deepEqual(after.departments.map(d => d.id), [3]);
  assert.deepEqual(after.positions.map(p => p.id), [13], 'HR is untouched');
  assert.equal(removeDepartment(tree, 3).positions.length, 3);
  // positions elsewhere that reported into a removed department become top-level
  const cross = { ...sample(), positions: [...sample().positions, { id: 14, departmentId: 3, parentPositionId: 10, title: name('HR Manager'), headcount: 1, seniority: 'manager', required: true, perBranch: false, description: null, sortOrder: 1 }] };
  assert.equal(removeDepartment(cross, 1).positions.find(p => p.id === 14).parentPositionId, null);
});

test('unit kinds follow the real organization: department → section → team, a team may sit under a department', () => {
  const tree = { ...sample(), departments: [...sample().departments, { id: 4, parentId: 1, kind: 'section', name: name('Platform'), required: true, sortOrder: 2 }] };
  assert.equal(validateDepartmentInput({ nameEn: 'Infra', kind: 'team', parentId: 4 }, tree).kind, 'team');
  assert.equal(validateDepartmentInput({ nameEn: 'Ops', kind: 'team', parentId: 1 }, tree).parentId, 1);
  rejects(() => validateDepartmentInput({ nameEn: 'X', kind: 'team', parentId: 2 }, tree), 'PARENT_INVALID');
  rejects(() => validateDepartmentInput({ nameEn: 'X', kind: 'department', parentId: 1 }, tree), 'PARENT_INVALID');
  rejects(() => validateDepartmentInput({ nameEn: 'X', kind: 'section', parentId: 4 }, tree), 'PARENT_INVALID');
  rejects(() => validateDepartmentInput({ nameEn: 'X', kind: 'team', parentId: 99 }, tree), 'PARENT_INVALID');
  rejects(() => validateDepartmentInput({ kind: 'department' }, tree), 'NAME_REQUIRED');
  // moving a unit under its own child is a loop
  rejects(() => validateDepartmentInput({ nameEn: 'Engineering', kind: 'team', parentId: 4 }, tree, 1), 'PARENT_CYCLE');
});

test('positions can be added and removed; removing one releases the positions that reported to it', () => {
  const tree = sample();
  const added = validatePositionInput({ departmentId: 2, titleEn: 'QA Engineer', titleAr: 'مهندس جودة', headcount: 2, seniority: 'mid', required: false, parentPositionId: 11 }, tree);
  assert.deepEqual([added.title.ar, added.required, added.parentPositionId, added.perBranch], ['مهندس جودة', false, 11, false]);
  const after = removePosition(tree, 11);
  assert.ok(!after.positions.some(p => p.id === 11));
  assert.equal(after.positions.find(p => p.id === 12).parentPositionId, null);
  assert.equal(after.positions.length, 3, 'only the removed position is gone');
  rejects(() => validatePositionInput({ departmentId: 99, titleEn: 'X', headcount: 1 }, tree), 'DEPARTMENT_INVALID');
  rejects(() => validatePositionInput({ titleEn: 'X', headcount: 1 }, tree), 'DEPARTMENT_REQUIRED');
  rejects(() => validatePositionInput({ departmentId: 1, headcount: 1 }, tree), 'NAME_REQUIRED');
  rejects(() => validatePositionInput({ departmentId: 1, titleEn: 'X', headcount: 1, seniority: 'god' }, tree), 'INVALID_VALUE');
});

test('reporting hierarchy: positions nest under the position they report to; loops and self-reports are refused', () => {
  const tree = sample();
  const root = buildHierarchy(tree, name('Acme', 'أكمي'));
  assert.deepEqual([root.level, root.label.ar], ['company', 'أكمي']);
  const eng = root.children.find(c => c.label.en === 'Engineering');
  assert.deepEqual(eng.children.map(c => [c.level, c.label.en]), [['position', 'Head of Engineering'], ['team', 'Backend']]);
  const backend = eng.children.find(c => c.level === 'team');
  assert.equal(backend.children[0].label.en, 'Tech Lead');
  assert.equal(backend.children[0].children[0].label.en, 'Backend Developer');
  assert.equal(backend.children[0].children[0].reportsTo.en, 'Tech Lead');
  assert.equal(backend.children[0].reportsTo.en, 'Head of Engineering', 'a cross-unit manager is still named');
  assert.equal(root.headcount, 6);
  assert.equal(eng.headcount, 5);
  assert.equal(flattenHierarchy(root).filter(n => n.level === 'position').length, 4, 'every position appears once');
  rejects(() => validatePositionInput({ departmentId: 2, titleEn: 'Tech Lead', headcount: 1, parentPositionId: 12 }, tree, 11), 'PARENT_CYCLE');
  rejects(() => validatePositionInput({ departmentId: 2, titleEn: 'Tech Lead', headcount: 1, parentPositionId: 11 }, tree, 11), 'PARENT_INVALID');
  rejects(() => validatePositionInput({ departmentId: 2, titleEn: 'X', headcount: 1, parentPositionId: 999 }, tree), 'PARENT_INVALID');
  // a looping hierarchy in stored data still shows every position exactly once
  const loop = { departments: [tree.departments[0]], positions: [{ ...tree.positions[0], parentPositionId: 99 }, { ...tree.positions[0], id: 99, parentPositionId: 10 }] };
  assert.equal(flattenHierarchy(buildHierarchy(loop, name('X'))).filter(n => n.level === 'position').length, 2);
});

test('required and optional positions and units are kept and shown', () => {
  const tree = sample();
  const root = buildHierarchy(tree, name('Acme'));
  const hr = root.children.find(c => c.label.en === 'HR');
  assert.equal(hr.required, false);
  assert.equal(hr.children[0].required, false);
  assert.equal(root.children.find(c => c.label.en === 'Engineering').required, true);
  // optional units/positions emptied by sizing are dropped, required ones stay
  const trimmed = generateTree({ departments: tree.departments, positions: tree.positions.map(p => ({ ...p, headcount: p.id === 13 ? 0 : p.headcount })) }, {});
  assert.ok(!trimmed.positions.some(p => p.id === 13) && !trimmed.departments.some(d => d.id === 3));
  const keep = generateTree({ departments: [{ ...tree.departments[2], required: true }], positions: [] }, {});
  assert.equal(keep.departments.length, 1, 'a required unit stays even when empty');
});

/* ---------- Applying a blueprint ---------- */

const deptRow = (id, nameEn, nameAr, kind = 'department', parentId = null) => ({ id, parentId, kind, nameEn, nameAr });

test('applying to a new company creates every unit and job title and needs no extra confirmation', () => {
  const plan = planApply(sample(), [], []);
  assert.equal(plan.hasExistingStructure, false);
  assert.deepEqual(plan.units.map(u => u.action), ['create', 'create', 'create']);
  assert.deepEqual(plan.counts, { unitsToCreate: 3, unitsReused: 0, titlesToCreate: 4, titlesReused: 0, seats: 6 });
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.positions.find(p => p.positionId === 12).topDepartmentId, 1, 'a job title is bound to its top-level department');
});

test('conflicts with an existing structure are detected, matches are reused and nothing is overwritten', () => {
  const plan = planApply(sample(), [deptRow(100, 'engineering', 'الهندسة'), deptRow(101, 'Backend', 'الخلفية', 'team', 100), deptRow(200, 'Legal', 'القانونية')], [{ id: 900, departmentId: 100, nameEn: 'Head of Engineering', nameAr: 'رئيس الهندسة' }]);
  assert.equal(plan.hasExistingStructure, true);
  assert.equal(plan.conflicts[0].type, 'existing_structure');
  assert.deepEqual(plan.units.map(u => [u.departmentId, u.action, u.existingId]), [[1, 'reuse', 100], [3, 'create', null], [2, 'reuse', 101]]);
  assert.deepEqual(plan.positions.find(p => p.positionId === 10), { positionId: 10, departmentId: 1, topDepartmentId: 1, title: name('Head of Engineering', 'رئيس الهندسة'), headcount: 1, action: 'reuse', existingId: 900 });
  assert.equal(plan.positions.find(p => p.positionId === 11).action, 'create');
  assert.ok(plan.conflicts.some(c => c.type === 'unit_exists') && plan.conflicts.some(c => c.type === 'title_exists'));
  assert.equal(plan.counts.unitsReused, 2);
});

test('name matching ignores case, spacing, punctuation and Arabic letter variants; same name under a different parent is not a match', () => {
  assert.equal(normalizeName(' Human   Resources! '), normalizeName('human resources'));
  assert.equal(normalizeName('إدارة المُحاسبة'), normalizeName('ادارة المحاسبه'));
  const tree = { departments: [{ id: 1, parentId: null, kind: 'department', name: name('Sales', 'المبيعات'), required: true, sortOrder: 0 }, { id: 2, parentId: 1, kind: 'team', name: name('Support', 'الدعم'), required: true, sortOrder: 0 }], positions: [] };
  const other = planApply(tree, [deptRow(10, 'Finance', 'المالية'), deptRow(11, 'Support', 'الدعم', 'team', 10)], []);
  assert.equal(other.units.find(u => u.departmentId === 2).action, 'create', 'a team with the same name under another department is a different team');
  assert.equal(planApply(tree, [deptRow(10, 'sales', 'x')], []).units[0].action, 'reuse');
  assert.equal(planApply(tree, [deptRow(10, 'x', 'المبيعات')], []).units[0].action, 'reuse', 'either language matches');
});

test('several seats with one title share a single job title', () => {
  const tree = { departments: [{ id: 1, parentId: null, kind: 'department', name: name('Ops'), required: true, sortOrder: 0 }, { id: 2, parentId: 1, kind: 'team', name: name('A'), required: true, sortOrder: 0 }, { id: 3, parentId: 1, kind: 'team', name: name('B'), required: true, sortOrder: 1 }],
    positions: [2, 3].map(d => ({ id: d * 10, departmentId: d, parentPositionId: null, title: name('Coordinator', 'منسق'), headcount: 2, seniority: 'junior', required: true, perBranch: false, description: null, sortOrder: 0 }))};
  const plan = planApply(tree, [], []);
  assert.deepEqual(plan.positions.map(p => p.action), ['create', 'reuse']);
  assert.equal(plan.counts.titlesToCreate, 1);
});

test('apply is explicit, confirmed and never creates employees', () => {
  const service = read('app/blueprint/service.ts');
  const apply = service.split('export async function applyBlueprint')[1];
  assert.match(apply, /Approve the blueprint before applying it/);
  assert.match(apply, /plan\.hasExistingStructure && !confirmExisting/);
  assert.match(apply, /EXISTING_STRUCTURE/);
  assert.match(apply, /saveOrganizationEntity\(tx as TransactionDatabase, 'departments'/, 'units go through the validated organization service');
  assert.match(apply, /saveJobTitle\(tx as TransactionDatabase/, 'job titles go through the validated job-title service');
  assert.match(apply, /status='applied'/);
  assert.doesNotMatch(apply, /INSERT INTO employees|UPDATE employees|DELETE FROM (departments|job_titles|employees|positions)/i);
  assert.doesNotMatch(service, /INSERT INTO employees|UPDATE employees/i);
  assert.match(service, /preview.*[\s\S]*readExisting/, 'a read-only preview exists');
  const route = read('app/api/blueprint/route.ts');
  assert.match(route, /case 'apply': need\(access\.canApply\)/);
  assert.match(route, /confirmExisting === true/);
});

/* ---------- Status rules ---------- */

test('approved, applied and archived company blueprints are frozen; templates move between draft, active and archived', () => {
  assertCompanyBlueprintEditable('draft');
  rejects(() => assertCompanyBlueprintEditable('approved'), 'BLUEPRINT_APPROVED');
  rejects(() => assertCompanyBlueprintEditable('applied'), 'BLUEPRINT_APPLIED');
  rejects(() => assertCompanyBlueprintEditable('archived'), 'BLUEPRINT_ARCHIVED');
  assertTemplateTransition('draft', 'activate'); assertTemplateTransition('active', 'archive'); assertTemplateTransition('archived', 'draft');
  rejects(() => assertTemplateTransition('active', 'activate'), 'ALREADY_ACTIVE');
  rejects(() => assertTemplateTransition('archived', 'archive'), 'ALREADY_ARCHIVED');
});

/* ---------- RBAC ---------- */

test('permissions: Admin manages the library; HR designs and applies; managers read only; employees nothing', () => {
  const all = { view: true, create: true, edit: true, approve: true, delete: true, manage_settings: true };
  const none = { view: false, create: false, edit: false, approve: false, delete: false, manage_settings: false };
  const admin = blueprintAccess({ roleName: 'Super Admin' }, all);
  assert.deepEqual([admin.canView, admin.canGenerate, admin.canEdit, admin.canApply, admin.canArchive, admin.canManageLibrary], [true, true, true, true, true, true]);
  const hr = blueprintAccess({ roleName: 'HR Manager', hrDataScope: 'all' }, { view: true, create: true, edit: true, approve: true, delete: true, manage_settings: false });
  assert.deepEqual([hr.canView, hr.canGenerate, hr.canEdit, hr.canApply, hr.canArchive, hr.canManageLibrary], [true, true, true, true, true, false]);
  assert.equal(blueprintAccess({ roleName: 'HR Manager' }, all).canManageLibrary, false, 'only Super Admin manages the library, whatever grants HR carries');
  const noApply = blueprintAccess({ roleName: 'HR Manager' }, { ...all, approve: false });
  assert.deepEqual([noApply.canGenerate, noApply.canApply], [true, false], 'applying can be withheld from HR');
  const manager = blueprintAccess({ roleName: 'Department Manager' }, { ...none, view: true });
  assert.deepEqual([manager.canView, manager.canGenerate, manager.canEdit, manager.canApply, manager.canManageLibrary], [true, false, false, false, false]);
  const overGranted = blueprintAccess({ roleName: 'Department Manager' }, all);
  assert.deepEqual([overGranted.canView, overGranted.canGenerate, overGranted.canEdit, overGranted.canApply, overGranted.canArchive, overGranted.canManageLibrary], [true, false, false, false, false, false], 'write grants without whole-company scope do nothing');
  const branchHr = blueprintAccess({ roleName: 'HR Manager', hrDataScope: 'assigned' }, all);
  assert.deepEqual([branchHr.canView, branchHr.canGenerate, branchHr.canApply], [true, false, false]);
  const employee = blueprintAccess({ roleName: 'Employee' }, none);
  assert.deepEqual([employee.canView, employee.canGenerate, employee.canManageLibrary], [false, false, false]);
  assert.equal(blueprintAccess({ roleName: 'HR Manager' }, { ...all, view: false }).canEdit, false, 'write grants never apply without view');
});

test('the API enforces the view grant, per-action grants, same-origin writes and a company-scoped read for non-HR viewers', () => {
  const route = read('app/api/blueprint/route.ts');
  assert.match(route, /if \(!access\.canView\) throw new Response\('Permission denied', \{ status: 403 \}\)/);
  assert.match(route, /enforceWriteOrigin\(request\)/);
  for (const [action, flag] of [['saveType', 'canManageLibrary'], ['createTemplate', 'canManageLibrary'], ['updateTemplate', 'canManageLibrary'], ['templateStatus', 'canManageLibrary'], ['generate', 'canGenerate'], ['updateBlueprint', 'canEdit'], ['apply', 'canApply']]) {
    assert.match(route, new RegExp(`case '${action}': need\\(access\\.${flag}\\)`), `${action} requires ${flag}`);
  }
  assert.match(route, /kind === 'template' \? access\.canManageLibrary : access\.canEdit/, 'tree edits: library for templates, edit grant for company blueprints');
  // The single connection means nothing may query `db` from inside `db.transaction` (it would wait on itself): the kind is read first.
  const inside = route.split('return await db.transaction(async tx => {')[1];
  assert.doesNotMatch(inside, /\bdb\.prepare|await db\./, 'no outer-connection query inside the transaction');
  assert.match(route, /Blueprint is outside your scope/);
  assert.match(route, /if \(access\.wholeCompany\) await ensureDefaults\(db\)/);
  const service = read('app/blueprint/service.ts');
  assert.match(service, /Only a Super Admin can edit the template library/);
});

test('RBAC wiring: module, page, role defaults and migration grants', () => {
  assert.deepEqual(PAGE_MODULES.blueprint, ['staffing_blueprint']);
  assert.equal(PAGE_LABELS.blueprint.en, 'Company Staffing Blueprint');
  assert.ok(/[؀-ۿ]/.test(PAGE_LABELS.blueprint.ar));
  const hr = read('app/api/hr/route.ts');
  assert.match(hr, /"HR Manager": \{[\s\S]*staffing_blueprint:\["view","create","edit","approve","delete"\]/);
  assert.doesNotMatch(hr, /workforce_planning/);
  const defaults = hr.match(/const ROLE_DEFAULTS[\s\S]*?\n\};/)[0];
  assert.doesNotMatch(defaults.split('"Department Manager"')[1] ?? '', /staffing_blueprint/, 'managers have no default access');
  const sql = read('drizzle-postgres/0042_staffing_blueprint.sql');
  assert.match(sql, /WHEN r\."name" = 'HR Manager' AND a\."action" IN \('view','create','edit','approve','delete'\) THEN 1 ELSE 0 END/);
  assert.match(sql, /ON CONFLICT \("role_id","module","action"\) DO NOTHING/);
  assert.match(sql, /VALUES \('view'\),\('create'\),\('edit'\),\('approve'\),\('delete'\),\('manage_settings'\)/);
  const app = read('app/hr-app.tsx');
  assert.match(app, /visiblePage === "blueprint" && <BlueprintWorkspace rtl=\{rtl\} notify=\{notify\} \/>/);
  assert.match(app, /gate:\["staffing_blueprint","view"\],grants:\[\{module:"staffing_blueprint",actions:\["view"\]\}\]/);
  assert.doesNotMatch(app, /WorkforcePlanning|workforce_planning/);
});

/* ---------- Migration ---------- */

test('migration 0042 removes only the superseded workforce tables (guarded) and adds the blueprint tables', () => {
  const sql = read('drizzle-postgres/0042_staffing_blueprint.sql');
  assert.match(sql, /RAISE EXCEPTION 'Table % still has % row\(s\)/, 'refuses to drop a table that holds data');
  assert.match(sql, /DROP TABLE IF EXISTS "workforce_plan_events"[\s\S]*DROP TABLE IF EXISTS "workforce_plan_lines"[\s\S]*DROP TABLE IF EXISTS "workforce_plans"/);
  const drops = [...sql.matchAll(/DROP TABLE IF EXISTS "([a-z_]+)"/g)].map(m => m[1]);
  assert.deepEqual(drops.sort(), ['workforce_plan_events', 'workforce_plan_lines', 'workforce_plans']);
  assert.doesNotMatch(sql, /DROP TABLE[^;]*"(employees|departments|job_titles|companies|branches|positions|company_branches)"/);
  assert.match(sql, /DELETE FROM "permissions" WHERE "module" = 'workforce_planning'/);
  for (const table of ['blueprint_company_types', 'staffing_blueprints', 'blueprint_departments', 'blueprint_positions']) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  assert.doesNotMatch(sql, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
  assert.match(sql, /CHECK \("headcount" >= 0 AND "headcount" <= 10000\)/);
  assert.match(sql, /CHECK \("size" IN \('micro','small','medium','large'\)\)/);
  assert.match(read('drizzle-postgres/meta/_journal.json'), /0042_staffing_blueprint/);
  assert.ok(fs.existsSync(new URL('../drizzle-postgres/meta/0042_snapshot.json', import.meta.url)));
});

test('nothing of the superseded Workforce Planning implementation remains in the app', () => {
  for (const path of ['app/workforce', 'app/api/workforce', 'app/workforce-planning.tsx', 'app/workforce-plans.tsx', 'app/workforce-chart.tsx', 'app/workforce-report.tsx', 'app/workforce-structure.tsx', 'app/workforce-planning.css']) assert.ok(!fs.existsSync(new URL(`../${path}`, import.meta.url)), path);
  assert.doesNotMatch(read('db/schema.ts'), /workforcePlans|workforce_plan/);
  assert.doesNotMatch(read('app/navigation-labels.ts') + read('app/page-availability.ts'), /workforce/i);
});

test('the blueprint defaults are seeded into the database, not hardcoded in the screens', () => {
  const service = read('app/blueprint/service.ts');
  assert.match(service, /export async function ensureDefaults/);
  assert.match(service, /INSERT INTO blueprint_company_types/);
  assert.match(service, /is_default/);
  for (const file of ['app/blueprint-workspace.tsx', 'app/blueprint-editor.tsx']) assert.doesNotMatch(read(file), /defaults\.ts|default-titles|expandDefault|DEFAULT_TYPES/, `${file} reads templates from the API`);
  assert.match(service, /status='active'[\s\S]*ORDER BY is_default ASC,updated_at DESC/, 'an edited template wins over the built-in one');
});

/* ---------- Rendering: Arabic, English, RTL ---------- */

test('the screens render both languages and switch direction', () => {
  for (const file of ['app/blueprint-workspace.tsx', 'app/blueprint-editor.tsx']) {
    const source = read(file);
    assert.match(source, /const t = \(ar: string, en: string\) => \(rtl \? ar : en\)/, `${file} localizes through one helper`);
    assert.ok((source.match(/t\('[^']*[؀-ۿ][^']*', '/g) ?? []).length > 20, `${file} has Arabic copy`);
  }
  const editor = read('app/blueprint-editor.tsx');
  assert.match(editor, /dir=\{rtl \? 'rtl' : 'ltr'\}/, 'boxes follow the language');
  assert.match(editor, /dir="rtl"/, 'Arabic inputs are right-to-left');
  const css = read('app/blueprint.css');
  assert.match(css, /\.bp-scroll\{direction:ltr/, 'connector geometry stays left-to-right');
  assert.match(css, /\[dir=rtl\] \.bp-flip/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.deepEqual(css.match(/#[0-9a-fA-F]{6}/g)?.sort(), ['#6B3A00', '#8A4B00'], 'only two AA-contrast warning text colours are literal; the rest are SANA tokens');
  // the hierarchy labels resolve to Arabic or English from the same data
  const root = buildHierarchy(sample(), name('Acme', 'أكمي'));
  const pick = (n, rtl) => (rtl ? n.ar || n.en : n.en || n.ar);
  assert.equal(pick(root.children[0].label, true), 'الهندسة');
  assert.equal(pick(root.children[0].label, false), 'Engineering');
  assert.equal(pick({ en: 'Only English', ar: '' }, true), 'Only English');
});

test('the main view is a visual hierarchy with expand/collapse, zoom and in-place editing; the table is secondary', () => {
  const editor = read('app/blueprint-editor.tsx');
  assert.match(editor, /useState<'tree' \| 'table'>\('tree'\)/);
  assert.match(editor, /className="bp-tree"/);
  assert.match(editor, /aria-expanded=\{!closed\}/);
  assert.match(editor, /style=\{\{ zoom \}\}/);
  assert.match(editor, /Apply Structure to Company/);
  assert.match(editor, /PositionPanel/);
  for (const field of ['headcount', 'seniority', 'required', 'parentPositionId', 'descriptionEn']) assert.match(editor, new RegExp(field), field);
  const workspace = read('app/blueprint-workspace.tsx');
  assert.match(workspace, /Blueprint library/);
  for (const action of ['duplicate', 'templateStatus', 'createTemplate', 'saveType']) assert.match(workspace + editor, new RegExp(action), action);
});
