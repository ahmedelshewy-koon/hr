import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChartFilters, computeChartDiagnostics, computeContextNodes, deriveOrganizationView, deriveReportingForest, deriveReportingView, directReportCount, reviewItems, chartFilterOptions, searchEmployees, ancestorPath, reportingCycleIds, NOT_ASSIGNED } from '../app/organization/chart-model.ts';
import { createLatestLoader, onHrDataChanged, HR_DATA_CHANGED } from '../app/organization/latest-loader.ts';

// Fixture shaped like the partially migrated live data: KOON Software (5), Asus Cards (6), KOON Agency (7, inactive units).
const catalog = {
  companies: [{ id: 5, name: 'KOON Software', status: 'active' }, { id: 6, name: 'Asus Cards', status: 'active' }, { id: 7, name: 'KOON Agency', status: 'active' }],
  branches: [{ id: 2, name_en: 'Riyadh', name_ar: 'الرياض', status: 'active' }, { id: 3, name_en: 'Cairo', name_ar: 'القاهرة', status: 'active' }],
  companyBranches: [{ company_id: 6, branch_id: 2 }, { company_id: 6, branch_id: 3 }, { company_id: 5, branch_id: 3 }],
  departments: [
    { id: 1, company_id: 5, organization_kind: 'department', parent_id: null, status: 'active', name_en: 'Software Development', branch_scope: 'all' },
    { id: 18, company_id: 5, organization_kind: 'team', parent_id: 1, status: 'active', name_en: 'Mobile App Development', branch_scope: 'all' },
    { id: 31, company_id: 5, organization_kind: 'section', parent_id: 1, status: 'active', name_en: 'Backend', branch_scope: 'all' },
    { id: 32, company_id: 5, organization_kind: 'team', parent_id: 31, status: 'active', name_en: 'API', branch_scope: 'all' },
    { id: 2, company_id: 6, organization_kind: 'department', parent_id: null, status: 'active', name_en: 'Sales', branch_scope: 'all' },
    { id: 3, company_id: 6, organization_kind: 'department', parent_id: null, status: 'active', name_en: 'Human Resources', branch_scope: 'all' },
    { id: 10, company_id: 6, organization_kind: 'department', parent_id: null, status: 'active', name_en: 'Contracts', branch_scope: 'all' },
    { id: 4, company_id: null, organization_kind: null, parent_id: 20, status: 'active', name_en: 'Koon Software' },
    { id: 20, company_id: null, organization_kind: null, parent_id: 14, status: 'active', name_en: 'Asas Egypt Branch' },
    { id: 65, company_id: 7, organization_kind: 'department', parent_id: null, status: 'inactive', name_en: 'Marketing', branch_scope: 'all' },
  ],
  branchScopes: [],
  positions: [{ id: 5, company_id: 6, department_id: null, job_title_id: null, is_ceo: 1, status: 'active', name_en: 'Chief Executive Officer', name_ar: 'الرئيس التنفيذي' }, { id: 1, company_id: 5, department_id: 1, job_title_id: 1, is_ceo: 0, status: 'active', name_en: 'Lead Developer' }],
  grades: [], workLocations: [], hrRules: [],
  jobTitles: [{ id: 1, department_id: 1, status: 'active', name_en: 'Developer' }, { id: 26, department_id: 4, status: 'active', name_en: 'General Manager' }, { id: 9, department_id: null, status: 'active', name_en: 'Accountant' }, { id: 40, department_id: 2, status: 'active', name_en: 'Sales Rep' }],
};
const E = (id, extra) => ({ id, employee_code: `E${String(id).padStart(3, '0')}`, name_en: `Emp ${id}`, name_ar: `موظف ${id}`, employment_status: 'active', company_id: null, branch_id: null, department_id: null, section_id: null, team_id: null, position_id: null, job_title_id: null, manager_id: null, ...extra });
const employees = [
  E(1, { name_en: 'Nawaf CEO', company_id: 6, branch_id: 2, position_id: 5 }),
  E(2, { name_en: 'Sales Manager', company_id: 6, branch_id: 2, department_id: 2, manager_id: 1, job_title_id: 40 }),
  E(3, { name_en: 'Cairo Seller', company_id: 6, branch_id: 3, department_id: 2, manager_id: 2, job_title_id: 40 }),
  E(4, { name_en: 'Riyadh Seller', company_id: 6, branch_id: 2, department_id: 2, manager_id: 2 }),
  E(5, { name_en: 'Koon Lead', company_id: 5, branch_id: 3, department_id: 1, position_id: 1, job_title_id: 1 }),
  E(6, { name_en: 'Mobile Dev', company_id: 5, branch_id: 3, department_id: 1, team_id: 18, manager_id: 5, job_title_id: 1 }),
  E(7, { name_en: 'Legacy Person', department_id: 4, job_title_id: 26, manager_id: 1 }),
  E(8, { name_en: 'Cross Company', company_id: 5, branch_id: 3, department_id: 1, section_id: 31, team_id: 32, manager_id: 2 }),
  E(9, { name_en: 'Orphan', company_id: 6, branch_id: 2, department_id: 3, manager_id: 999, manager_scope: 'missing' }),
  E(10, { name_en: 'Reports To Leaver', company_id: 6, branch_id: 2, department_id: 3, manager_id: 11 }),
  E(11, { name_en: 'Leaver', company_id: 6, branch_id: 2, department_id: 3, employment_status: 'terminated' }),
  E(12, { name_en: 'Loop A', company_id: 6, branch_id: 2, department_id: 3, manager_id: 13 }),
  E(13, { name_en: 'Loop B', company_id: 6, branch_id: 2, department_id: 3, manager_id: 12 }),
  E(14, { name_en: 'Deleted Person', company_id: 6, branch_id: 2, department_id: 2, manager_id: 1, employment_status: 'deleted' }),
  E(15, { name_en: 'Agency Person', company_id: 7, department_id: 65 }),
  E(16, { name_en: 'Contracts No Branch', company_id: 6, department_id: 10, manager_id: 1, job_title_id: 9 }),
];
const input = { employees, catalog, fullAccess: true };
const ids = nodes => nodes.map(node => node.id);
const find = (view, id) => view.nodes.get(id);
const issueCodes = (diagnostics, id) => (diagnostics.get(id) ?? []).map(issue => issue.code);

// ---------------------------------------------------------------- reporting tree

test('single root and manager → employee from manager_id only', () => {
  const { roots } = deriveReportingForest([E(1, {}), E(2, { manager_id: 1 })]);
  assert.deepEqual(ids(roots), [1]);
  assert.deepEqual(ids(roots[0].children), [2]);
});

test('multiple roots are kept; nobody is forced under a CEO', () => {
  const view = deriveReportingView(input, { status: 'current' });
  const roots = view.groups.flatMap(group => group.roots.map(root => root.id));
  for (const id of [1, 5, 9, 15]) assert.ok(roots.includes(id), `root ${id}`);
  assert.equal(find(view, 16).employee.manager_id, 1);
  assert.ok(!roots.includes(16));
});

test('multi-level reporting: CEO → manager → employee', () => {
  const view = deriveReportingView(input, { status: 'current' });
  assert.deepEqual(ancestorPath(view.parentOf, 3), [2, 1]);
  assert.ok(ids(find(view, 1).children).includes(2));
});

test('employees without Company or Branch stay visible under their stored manager', () => {
  const view = deriveReportingView(input, { status: 'current' });
  assert.equal(view.parentOf.get(7), 1, 'legacy/no-company employee still under manager 1');
  assert.equal(view.parentOf.get(16), 1, 'no-branch employee still visible');
  assert.ok(view.matchIds.has(7) && view.matchIds.has(16));
});

test('cross-company reporting line is kept as stored and flagged', () => {
  const view = deriveReportingView(input, { status: 'current' });
  assert.equal(view.parentOf.get(8), 2);
  assert.ok(issueCodes(computeChartDiagnostics(input), 8).includes('CROSS_COMPANY_REPORTING'));
});

test('missing manager: root with an error, never synthesized', () => {
  const view = deriveReportingView(input, { status: 'current' });
  assert.equal(view.parentOf.has(9), false);
  assert.equal(find(view, 9).managerState, 'missing');
  assert.ok(issueCodes(computeChartDiagnostics(input), 9).includes('MANAGER_NOT_FOUND'));
  assert.equal(view.nodes.has(999), false);
});

test('inactive manager stays as a labelled context node and the relationship is flagged', () => {
  const view = deriveReportingView(input, { status: 'current' });
  assert.equal(find(view, 11).kind, 'context');
  assert.deepEqual(find(view, 11).reasons, [{ type: 'status', status: 'terminated' }]);
  assert.equal(view.parentOf.get(10), 11);
  assert.equal(view.matchIds.has(11), false);
  assert.ok(issueCodes(computeChartDiagnostics(input), 10).includes('MANAGER_INACTIVE'));
});

test('reporting cycles terminate, render each member once and are diagnosed', () => {
  assert.deepEqual([...reportingCycleIds(employees)].sort(), [12, 13]);
  const view = deriveReportingView(input, { status: 'current' });
  assert.equal(find(view, 12).cycleBreak, true);
  assert.equal(view.parentOf.get(13), 12);
  const d = computeChartDiagnostics(input);
  assert.ok(issueCodes(d, 12).includes('REPORTING_CYCLE') && issueCodes(d, 13).includes('REPORTING_CYCLE'));
  assert.equal(d.get(12).find(i => i.code === 'REPORTING_CYCLE').severity, 'error');
  const self = deriveReportingForest([E(1, { manager_id: 1 })]);
  assert.deepEqual(ids(self.roots), [1]);
  assert.ok(issueCodes(computeChartDiagnostics({ ...input, employees: [E(1, { manager_id: 1 })] }), 1).includes('REPORTING_CYCLE'));
});

test('deleted employees never appear, even with status = all', () => {
  for (const status of ['current', 'all']) {
    const view = deriveReportingView(input, { status });
    assert.equal(view.nodes.has(14), false);
    assert.equal(view.matchIds.has(14), false);
  }
  assert.equal(directReportCount(employees, 1), 3, 'reports 2, 7 and 16 count; deleted report 14 does not');
});

test('1000-deep chain and wide trees derive iteratively', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => E(i + 1, { manager_id: i || null, company_id: 6 }));
  const view = deriveReportingView({ employees: rows, catalog, fullAccess: true }, { status: 'current' });
  assert.equal(view.matchCount, 1000);
  assert.equal(ancestorPath(view.parentOf, 1000).length, 999);
  assert.equal(view.groups[0].roots[0].size, 1000);
});

// ---------------------------------------------------------------- filters and context nodes

test('Company filter: external-company manager kept as context and excluded from counts', () => {
  const view = deriveReportingView(input, { company: '5', status: 'current' });
  assert.deepEqual([...view.matchIds].sort((a, b) => a - b), [5, 6, 8]);
  assert.equal(find(view, 2).kind, 'context');
  assert.deepEqual(find(view, 2).reasons, [{ type: 'company', companyId: 6 }]);
  assert.equal(view.parentOf.get(8), 2);
  assert.equal(view.nodes.has(1), false, 'context manager’s own superior is not needed');
  assert.equal(view.nodes.has(3) || view.nodes.has(4), false, 'context manager’s unrelated reports are not pulled in');
  assert.equal(view.matchCount, 3);
  assert.equal(view.groups.length, 1);
  assert.equal(view.groups[0].matchCount, 3);
});

test('Branch filter: manager in another branch is labelled context with their actual branch', () => {
  const view = deriveReportingView(input, { company: '6', branch: '3', status: 'current' });
  assert.deepEqual([...view.matchIds], [3]);
  assert.equal(find(view, 2).kind, 'context');
  assert.deepEqual(find(view, 2).reasons, [{ type: 'branch', branchId: 2 }]);
  assert.equal(view.parentOf.get(3), 2);
  assert.equal(view.matchCount, 1);
  assert.equal(view.contextCount, 1);
});

test('context chain is kept between a match and a matching ancestor further up', () => {
  const rows = [E(1, { branch_id: 3 }), E(2, { branch_id: 2, manager_id: 1 }), E(3, { branch_id: 2, manager_id: 2 }), E(4, { branch_id: 3, manager_id: 3 })];
  const { pool, matchIds } = applyChartFilters({ employees: rows, catalog, fullAccess: true }, { branch: '3', status: 'current' });
  assert.deepEqual([...computeContextNodes(pool, matchIds)].sort(), [2, 3]);
});

test('Department filter includes nested Sections/Teams; outside manager is context only', () => {
  const view = deriveReportingView(input, { department: '1', status: 'current' });
  assert.deepEqual([...view.matchIds].sort((a, b) => a - b), [5, 6, 8]);
  assert.equal(find(view, 2).kind, 'context');
  assert.deepEqual(find(view, 2).reasons, [{ type: 'department' }]);
  assert.equal(view.parentOf.get(8), 2);
});

test('combined filters: Company + Branch, Company + Department, Branch + Department', () => {
  const a = deriveReportingView(input, { company: '6', branch: '2', status: 'current' });
  assert.ok(!a.matchIds.has(3) && a.matchIds.has(4) && a.matchIds.has(2));
  const b = deriveReportingView(input, { company: '6', department: '2', status: 'current' });
  assert.deepEqual([...b.matchIds].sort(), [2, 3, 4]);
  assert.equal(find(b, 1).kind, 'context');
  const c = deriveReportingView(input, { branch: '3', department: '2', status: 'current' });
  assert.deepEqual([...c.matchIds], [3]);
  assert.deepEqual(find(c, 2).reasons.map(r => r.type), ['branch']);
});

test('"Not assigned" Company filter selects employees with no company without inferring one', () => {
  const view = deriveReportingView(input, { company: NOT_ASSIGNED, status: 'current' });
  assert.deepEqual([...view.matchIds], [7]);
  assert.equal(find(view, 1).kind, 'context');
  assert.equal(view.groups.length, 1);
  assert.equal(view.groups[0].companyId, null);
});

// ---------------------------------------------------------------- organization view

const flatten = roots => { const out = []; const stack = [...roots]; while (stack.length) { const n = stack.pop(); out.push(n); stack.push(...n.children); } return out; };
const placedIds = roots => flatten(roots).flatMap(node => node.employees.map(e => e.id));

test('By Department: Company → Department → Section → Team → Employees, leadership and legacy groups', () => {
  const view = deriveOrganizationView(input, { status: 'current' }, 'department');
  const koon = view.roots.find(n => n.key === 'company:5');
  const dev = koon.children.find(n => n.id === 1);
  assert.deepEqual(dev.employees.map(e => e.id), [5]);
  assert.deepEqual(dev.children.find(n => n.id === 18).employees.map(e => e.id), [6]);
  assert.deepEqual(dev.children.find(n => n.id === 31).children.find(n => n.id === 32).employees.map(e => e.id), [8]);
  const asus = view.roots.find(n => n.key === 'company:6');
  assert.equal(asus.children[0].type, 'leadership');
  assert.deepEqual(asus.children[0].employees.map(e => e.id), [1], 'CEO with no Department sits in Company leadership');
  const unassigned = view.roots.find(n => n.key === 'company:none');
  const legacy = unassigned.children.find(n => n.type === 'review');
  assert.equal(legacy.children[0].id, 4);
  assert.equal(legacy.children[0].legacy, true);
  assert.deepEqual(legacy.children[0].employees.map(e => e.id), [7]);
  assert.equal(view.roots.at(-1).key, 'company:none');
});

test('By Department: inactive retained unit is shown and marked; no employee duplicated', () => {
  const view = deriveOrganizationView(input, { status: 'current' }, 'department');
  const agency = view.roots.find(n => n.key === 'company:7');
  assert.equal(agency.children[0].id, 65);
  assert.equal(agency.children[0].inactive, true);
  const placed = placedIds(view.roots);
  assert.equal(new Set(placed).size, placed.length);
  assert.equal(placed.length, view.matchCount);
  assert.equal(view.roots.reduce((sum, root) => sum + root.count, 0), view.matchCount);
});

test('By Department: employee with Company but no Department and no company-level position is not forced into a unit', () => {
  const view = deriveOrganizationView({ ...input, employees: [E(40, { company_id: 6, branch_id: 2 })] }, { status: 'current' }, 'department');
  assert.equal(view.roots[0].children[0].type, 'no-department');
});

test('By Branch: Company → Branch → Department → Employees; no-branch bucket; branch never inferred', () => {
  const view = deriveOrganizationView(input, { status: 'current' }, 'branch');
  const asus = view.roots.find(n => n.key === 'company:6');
  const riyadh = asus.children.find(n => n.type === 'branch' && n.id === 2), cairo = asus.children.find(n => n.type === 'branch' && n.id === 3);
  assert.deepEqual(cairo.children.find(n => n.id === 2).employees.map(e => e.id), [3]);
  assert.ok(riyadh.children.find(n => n.id === 2).employees.some(e => e.id === 4));
  const noBranch = asus.children.find(n => n.type === 'no-branch');
  assert.deepEqual(placedIds([noBranch]), [16]);
  const placed = placedIds(view.roots);
  assert.equal(new Set(placed).size, placed.length);
});

test('Show empty units only for full-access viewers; default hides empty units', () => {
  const plain = deriveOrganizationView(input, { status: 'current' }, 'department');
  assert.equal(flatten(plain.roots).some(n => n.id === 3 && n.type === 'department' && n.count === 0), false);
  const empty = deriveOrganizationView({ ...input, employees: [] }, { status: 'current' }, 'department', { showEmpty: true });
  assert.ok(flatten(empty.roots).some(n => n.id === 3 && n.count === 0));
  assert.equal(flatten(empty.roots).some(n => n.id === 65), false, 'inactive empty units are not shown');
  const limited = deriveOrganizationView({ ...input, employees: [], fullAccess: false }, { status: 'current' }, 'department', { showEmpty: true });
  assert.equal(limited.roots.length, 0);
});

// ---------------------------------------------------------------- needs review

test('diagnostics: missing Company/Branch, legacy Department, title mismatch, Position problem', () => {
  const d = computeChartDiagnostics(input);
  assert.ok(issueCodes(d, 7).includes('NO_COMPANY') && issueCodes(d, 7).includes('NO_BRANCH'));
  assert.ok(issueCodes(d, 7).includes('LEGACY_UNIT'));
  assert.ok(issueCodes(d, 16).includes('NO_BRANCH'));
  const mismatch = computeChartDiagnostics({ ...input, employees: [E(50, { company_id: 5, branch_id: 3, department_id: 1, job_title_id: 40 })] });
  assert.ok(issueCodes(mismatch, 50).includes('JOB_TITLE_DEPARTMENT_MISMATCH'));
  assert.equal(mismatch.get(50).find(i => i.code === 'JOB_TITLE_DEPARTMENT_MISMATCH').severity, 'warning');
  const position = computeChartDiagnostics({ ...input, employees: [E(51, { company_id: 6, branch_id: 2, department_id: 2, position_id: 1 })] });
  assert.equal(position.get(51).find(i => i.code === 'POSITION_CONTRADICTION').severity, 'error');
  assert.ok(!issueCodes(d, 1).includes('NO_DEPARTMENT'), 'company-level CEO needs no Department');
  assert.equal(d.get(1)?.every(issue => issue.severity === 'info') ?? true, true);
});

test('severities: incomplete data is a warning, broken relationships are errors, optional setup is info', () => {
  const d = computeChartDiagnostics(input);
  const sev = (id, code) => d.get(id).find(i => i.code === code).severity;
  assert.equal(sev(7, 'NO_BRANCH'), 'warning');
  assert.equal(sev(9, 'MANAGER_NOT_FOUND'), 'error');
  assert.equal(sev(8, 'CROSS_COMPANY_REPORTING'), 'error');
  assert.equal(sev(7, 'MANAGER_COMPANY_INCOMPLETE'), 'warning');
  assert.equal(sev(3, 'NO_POSITION'), 'info');
});

test('Needs Review list respects filters and severity and links each item to its employee id', () => {
  const d = computeChartDiagnostics(input), view = deriveReportingView(input, { company: '5', status: 'current' });
  const items = reviewItems(d, employees, view.matchIds);
  assert.ok(items.every(item => view.matchIds.has(item.employee.id)));
  assert.ok(items.some(item => item.employee.id === 8 && item.issue.code === 'CROSS_COMPANY_REPORTING'));
  assert.equal(items[0].issue.severity, 'error');
  assert.ok(items.every(item => item.issue.severity !== 'info'));
  assert.ok(reviewItems(d, employees, view.matchIds, ['info']).every(item => item.issue.severity === 'info'));
});

// ---------------------------------------------------------------- permissions

test('restricted manager is never revealed: placeholder state only, no synthetic node', () => {
  const visible = [E(21, { company_id: 6, branch_id: 2, department_id: 2, manager_id: 20, manager_scope: 'restricted' }), E(22, { company_id: 6, branch_id: 2, department_id: 2, manager_id: 21 })];
  const view = deriveReportingView({ employees: visible, catalog, fullAccess: false }, { status: 'current' });
  assert.equal(view.nodes.has(20), false);
  assert.equal(find(view, 21).managerState, 'restricted');
  assert.deepEqual(ids(view.groups[0].roots), [21]);
  const d = computeChartDiagnostics({ employees: visible, catalog, fullAccess: false });
  assert.ok(!issueCodes(d, 21).includes('MANAGER_NOT_FOUND'), 'a limited viewer is not told the manager is missing');
  assert.equal(JSON.stringify([...view.nodes.values()].map(n => n.employee)).includes('"id":20,'), false);
});

test('a limited viewer cannot turn a "missing" hint into a leak; full viewers see deleted managers as errors', () => {
  const row = E(30, { manager_id: 31, manager_scope: 'deleted', company_id: 6 });
  assert.equal(deriveReportingView({ employees: [row], catalog, fullAccess: false }, {}).nodes.get(30).managerState, 'restricted');
  assert.ok(issueCodes(computeChartDiagnostics({ employees: [row], catalog, fullAccess: true }), 30).includes('MANAGER_DELETED'));
});

test('filter options for limited viewers only contain masters their visible employees use', () => {
  const limited = chartFilterOptions({ employees: [E(21, { company_id: 6, branch_id: 3, department_id: 2 })], catalog, fullAccess: false }, {});
  assert.deepEqual(limited.companies.map(c => c.id), [6]);
  assert.deepEqual(limited.branches.map(b => b.id), [3]);
  assert.deepEqual(limited.departments.map(d => d.id), [2]);
  const full = chartFilterOptions(input, { company: '5' });
  assert.deepEqual(full.companies.map(c => c.id), [5, 6, 7]);
  assert.ok(full.departments.every(d => !d.company_id || d.company_id === 5));
  assert.ok(full.departments.some(d => d.id === 4), 'referenced legacy unit stays filterable');
});

test('search covers name, code, job title and position within the current view only', () => {
  const view = deriveReportingView(input, { company: '6', status: 'current' });
  assert.deepEqual(searchEmployees(input, view.matchIds, 'chief').map(e => e.id), [1]);
  assert.deepEqual(searchEmployees(input, view.matchIds, 'E003').map(e => e.id), [3]);
  assert.deepEqual(searchEmployees(input, view.matchIds, 'sales rep').map(e => e.id).sort(), [2, 3]);
  assert.deepEqual(searchEmployees(input, view.matchIds, 'Koon Lead'), []);
});

// ---------------------------------------------------------------- refresh

test('latest loader: a stale response can never overwrite newer chart data', async () => {
  const resolvers = [], applied = [];
  const loader = createLatestLoader(() => new Promise(resolve => resolvers.push(resolve)), value => applied.push(value));
  const first = loader.load(), second = loader.load();
  resolvers[1]('new'); await second;
  resolvers[0]('old'); await first;
  assert.deepEqual(applied, ['new']);
  const third = loader.load(); loader.cancel(); resolvers[2]('after-unmount'); await third;
  assert.deepEqual(applied, ['new']);
});

test('hr-data-changed triggers a reload and changed profile data is reflected in the derived chart', async () => {
  const target = new EventTarget();
  let server = [E(1, { company_id: 6 }), E(2, { company_id: 6, manager_id: 1 }), E(3, { company_id: 6 })];
  let data = null, fetches = 0;
  const loader = createLatestLoader(async () => { fetches++; return server.map(row => ({ ...row })); }, value => { data = value; });
  const unsubscribe = onHrDataChanged(target, () => void loader.load());
  await loader.load();
  assert.equal(deriveReportingView({ employees: data, catalog, fullAccess: true }, {}).parentOf.get(2), 1);
  server = server.map(row => row.id === 2 ? { ...row, manager_id: 3 } : row); // an Employee Profile save
  target.dispatchEvent(new Event(HR_DATA_CHANGED));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fetches, 2);
  assert.equal(deriveReportingView({ employees: data, catalog, fullAccess: true }, {}).parentOf.get(2), 3);
  unsubscribe();
  target.dispatchEvent(new Event(HR_DATA_CHANGED));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fetches, 2);
});

test('derivation is pure: inputs are not mutated and no chart state is written back', () => {
  const snapshot = JSON.stringify(input);
  deriveReportingView(input, { company: '5', status: 'current' });
  deriveOrganizationView(input, { status: 'all' }, 'branch', { showEmpty: true });
  computeChartDiagnostics(input);
  assert.equal(JSON.stringify(input), snapshot);
});
