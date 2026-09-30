import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Renders the real Settings components (no browser, no database) to static markup. The TSX modules are bundled
 * with esbuild — already present through Vite — into the ignored node_modules cache so `react` resolves normally.
 */
const root = path.resolve(import.meta.dirname, '..');
let ui;
let bundle;
after(() => { if (bundle) rmSync(bundle, { force: true }); });
before(async () => {
  const outdir = path.join(root, 'node_modules/.cache/organization-settings-tests');
  mkdirSync(outdir, { recursive: true });
  const outfile = path.join(outdir, `ui-${process.pid}-${Date.now()}.mjs`);
  await build({
    stdin: {
      contents: [
        "export * from './app/settings/settings-ui.tsx';",
        "export { OrganizationSettingsContext } from './app/settings/organization/context.ts';",
        "export * from './app/settings/organization/companies-branches.tsx';",
        "export * from './app/settings/organization/departments.tsx';",
        "export * from './app/settings/organization/positions.tsx';",
        "export * from './app/settings/organization/work-locations.tsx';",
        "export * from './app/settings/organization/hr-responsibility.tsx';",
        "export * from './app/settings/organization/simple-hr-responsibility.tsx';",
        "export { OrganizationSettings } from './app/organization-settings.tsx';",
        "export { OrganizationAssignmentFields } from './app/organization-assignment-fields.tsx';",
      ].join('\n'),
      resolveDir: root, loader: 'ts', sourcefile: 'entry.ts',
    },
    bundle: true, format: 'esm', platform: 'node', outfile, jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'lucide-react'], tsconfig: path.join(root, 'tsconfig.json'),
  });
  bundle = outfile;
  ui = await import(pathToFileURL(outfile).href);
});

const h = React.createElement;
const noop = async () => {};
const usage = (references) => { const total = Object.values(references).reduce((s, r) => s + r.total, 0), active = Object.values(references).reduce((s, r) => s + r.active, 0); return { total, active, historical: total - active, references }; };

const catalog = {
  companies: [
    { id: 5, name: 'KOON Software', name_en: 'KOON Software', name_ar: 'كون للبرمجة', code: 'KOON-SW', status: 'active' },
    { id: 6, name: 'Asus Cards', name_en: 'Asus Cards', name_ar: 'أسس كارد', code: 'ASUS', status: 'active' },
    { id: 7, name: 'Legacy Agency', name_en: null, name_ar: null, code: null, status: 'active' },
  ],
  branches: [
    { id: 3, name_en: 'Cairo Branch', name_ar: 'فرع القاهرة', code: 'CAI', country: 'Egypt', city: 'Cairo', status: 'active' },
    { id: 4, name_en: 'Riyadh Branch', name_ar: 'فرع الرياض', code: 'RUH', country: 'Saudi Arabia', city: 'Riyadh', status: 'active' },
  ],
  companyBranches: [{ company_id: 5, branch_id: 3 }, { company_id: 5, branch_id: 4 }, { company_id: 6, branch_id: 4 }],
  departments: [
    { id: 1, name_en: 'IT', name_ar: 'تقنية المعلومات', company_id: 5, organization_kind: 'department', parent_id: null, branch_scope: 'selected', status: 'active' },
    { id: 2, name_en: 'Backend', name_ar: 'الخلفي', company_id: 5, organization_kind: 'section', parent_id: 1, branch_scope: 'all', status: 'active' },
    { id: 3, name_en: 'Platform', name_ar: 'المنصة', company_id: 5, organization_kind: 'team', parent_id: 2, branch_scope: 'all', status: 'active' },
    { id: 10, name_en: 'Legacy Sales', name_ar: 'مبيعات قديمة', company_id: null, organization_kind: null, unit_type: 'department', branch_scope: 'all', status: 'active' },
    { id: 11, name_en: 'Legacy Group', name_ar: 'مجموعة قديمة', company_id: null, organization_kind: null, unit_type: 'company', branch_scope: 'all', status: 'active' },
    { id: 12, name_en: 'Removed Legacy', name_ar: 'محذوف', company_id: null, organization_kind: null, status: 'deleted' },
  ],
  branchScopes: [{ department_id: 1, branch_id: 3 }, { department_id: 1, branch_id: 4 }],
  positions: [
    { id: 1, name_en: 'Chief Executive Officer', name_ar: 'الرئيس التنفيذي', code: 'KOON-CEO', company_id: 5, is_ceo: 1, job_title_id: 1, grade_id: 3, status: 'active' },
    { id: 2, name_en: 'Backend Engineer', name_ar: 'مهندس خلفي', code: 'BE-1', company_id: 5, department_id: 1, section_id: 2, team_id: 3, job_title_id: 2, grade_id: 2, is_ceo: 0, status: 'active' },
  ],
  grades: [
    { id: 3, name_en: 'Grade 3', name_ar: 'الثالثة', code: 'G3', sort_order: 30, status: 'active' },
    { id: 2, name_en: 'Grade 2 Beta', name_ar: 'الثانية ب', code: 'G2B', sort_order: 20, status: 'active' },
    { id: 1, name_en: 'Grade 1', name_ar: 'الأولى', code: 'G1', sort_order: 10, status: 'active' },
    { id: 4, name_en: 'Grade 2 Alpha', name_ar: 'الثانية أ', code: 'G2A', sort_order: 20, status: 'inactive' },
  ],
  workLocations: [{ id: 1, name_en: 'Riyadh HQ', name_ar: 'مقر الرياض', code: 'RUH-HQ', branch_id: 4, status: 'active' }, { id: 2, name_en: 'Remote', name_ar: 'عن بعد', code: 'REMOTE', branch_id: null, status: 'active' }],
  hrRules: [{ id: 1, company_id: null, branch_id: 4, hr_user_id: 20, status: 'active' }, { id: 2, company_id: 5, branch_id: 3, hr_user_id: 20, status: 'active' }],
  jobTitles: [
    { id: 1, name_en: 'Manager', name_ar: 'مدير', department_id: null, status: 'active' },
    { id: 2, name_en: 'Software Engineer', name_ar: 'مهندس برمجيات', department_id: 1, status: 'active' },
    { id: 3, name_en: 'Retired Title', name_ar: 'مسمى قديم', department_id: 1, status: 'archived' },
  ],
};
const usageIndex = {
  companies: { 5: usage({ 'employees:company_id': { total: 15, active: 13 }, 'positions:company_id': { total: 2, active: 2 } }) },
  positions: { 2: usage({ 'employees:position_id': { total: 2, active: 2 } }) },
  grades: { 3: usage({ 'employees:grade_id': { total: 1, active: 1 } }) },
  jobTitles: { 2: usage({ 'employees:job_title_id': { total: 1, active: 0 } }) },
};
const roster = [{ user_id: 20, employee_id: 30, status: 'active', eligible: true, name_en: 'Huda Mostafa', name_ar: 'هدى مصطفى', email: 'huda@example.invalid' }, { user_id: 21, status: 'inactive', eligible: true, name_en: 'Old HR', email: 'old@example.invalid' }];
const manager = { canView: true, canManage: true, canCreateJobTitles: true, canEditJobTitles: true, canForceDelete: false };
const viewer = { canView: true, canManage: false, canCreateJobTitles: false, canEditJobTitles: false, canForceDelete: false };
const value = (rtl, access = manager) => ({
  rtl, access, catalog, usage: usageIndex, occupants: { 1: [{ id: 9, name_en: 'Layla Hassan', name_ar: 'ليلى حسن' }], 2: [{ id: 10, name_en: 'Omar Nabil', name_ar: 'عمر نبيل' }] },
  hrScopes: [{ company_id: 5, branch_id: 3, employees: 3, overrides: 1 }, { company_id: 9, branch_id: 4, employees: 4, overrides: 0 }], legacyWorkLocations: [{ text: 'Egypt', employees: 29 }],
  employees: [], hrResponsibles: roster, hrCandidates: [], saveEntity: noop, saveJobTitle: noop, saveHrResponsible: noop, goTo() {},
  saveHrAssignment: noop,
});
const render = (component, rtl = false, access = manager, props = {}) => renderToStaticMarkup(h(ui.OrganizationSettingsContext.Provider, { value: value(rtl, access) }, h(component, props)));
const position = (markup, text) => { const index = markup.indexOf(text); assert.notEqual(index, -1, `missing "${text}"`); return index; };

test('shell renders right-to-left with Arabic navigation, and left-to-right in English', () => {
  const props = { access: manager, employees: [], hrResponsibles: [], hrCandidates: [], onSaveJobTitle: noop, onSaveHrResponsible: noop, onChanged: noop, notify() {} };
  const arabic = renderToStaticMarkup(h(ui.OrganizationSettings, { rtl: true, ...props }));
  assert.match(arabic, /class="panel settings-panel" dir="rtl"/);
  for (const label of ['الهيكل التنظيمي', 'الشركات والفروع', 'الإدارات', 'الوظائف', 'مقار العمل', 'مسؤولية الموارد البشرية']) assert.ok(arabic.includes(label), label);
  assert.ok(!arabic.includes('الوظائف والدرجات') && !arabic.includes('الأقسام والفرق'));
  const english = renderToStaticMarkup(h(ui.OrganizationSettings, { rtl: false, ...props }));
  assert.match(english, /class="panel settings-panel" dir="ltr"/);
  for (const label of ['Organizational Structure', 'Companies &amp; Branches', 'Departments', 'Positions', 'Work Locations', 'HR Responsibility']) assert.ok(english.includes(label), label);
  assert.equal((english.match(/settings-subnav-primary/g) || []).length, 1, 'one grouped navigation, not nine top-level tabs');
  assert.equal((english.match(/<button type="button"/g) || []).length, 5);
});

test('read-only viewers see a badge, no add/edit controls, and View instead of Edit', () => {
  const editable = render(ui.CompaniesTab);
  assert.ok(editable.includes('Add company') && editable.includes('>Edit<'));
  const readOnly = render(ui.CompaniesTab, false, viewer);
  assert.ok(!readOnly.includes('Add company'), 'no create control');
  assert.ok(!readOnly.includes('>Edit<') && readOnly.includes('>View<'));
  const shell = renderToStaticMarkup(h(ui.OrganizationSettings, { rtl: false, access: viewer, employees: [], hrResponsibles: [], hrCandidates: [], onSaveJobTitle: noop, onSaveHrResponsible: noop, onChanged: noop, notify() {} }));
  assert.ok(shell.includes('View only'));
});

test('companies list shows names, codes, branch associations, derived CEO and server usage', () => {
  const html = render(ui.CompaniesTab);
  for (const text of ['KOON Software', 'KOON-SW', 'Cairo Branch', 'Riyadh Branch']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('Layla Hassan'), 'CEO comes from the occupant of the CEO position');
  assert.ok(html.includes('Chief Executive Officer'));
  assert.ok(html.includes('15 active') && html.includes('2 historical'), 'total/active/historical from the server');
  assert.ok(html.includes('No CEO position'), 'a company without a CEO position says so');
  assert.ok(html.includes('Names and code need completing') && html.includes('No code'), 'legacy company flagged incomplete');
  const arabic = render(ui.CompaniesTab, true);
  assert.ok(arabic.includes('كون للبرمجة') && arabic.includes('ليلى حسن') && arabic.includes('١٥ نشط'), 'Arabic names and Arabic-Indic numerals');
});

test('branches show country, city and the companies they serve', () => {
  const html = render(ui.BranchesTab);
  assert.ok(html.includes('Egypt · Cairo') && html.includes('Saudi Arabia · Riyadh'));
  assert.ok(html.includes('KOON Software') && html.includes('Asus Cards'));
});

test('legacy units are marked Needs review, never mapped by name, and open for a reviewed adoption or deactivation; removed legacy units are hidden', () => {
  const html = render(ui.UnitsTab, false, manager, { kind: 'department' });
  assert.equal((html.match(/Needs review/g) || []).length >= 3, true, 'two legacy units plus the filter option');
  assert.ok(html.includes('Legacy Sales') && html.includes('Legacy Group') && html.includes('legacy company-type unit'));
  assert.ok(!html.includes('Removed Legacy'));
  assert.ok(html.includes('2 legacy units have no company and need review. They are never mapped by name'));
  assert.ok(html.includes('Unmapped'));
  assert.ok(!html.includes('>View<'), 'managers can open legacy units (adoption/deactivation go through the server impact review)');
  const arabic = render(ui.UnitsTab, true, manager, { kind: 'department' });
  assert.ok(arabic.includes('يحتاج مراجعة'));
});

test('every unit row has a Delete button for managers; in-use and legacy units are marked blocked with the reason', () => {
  const used = { ...value(false), usage: { ...usageIndex, departments: { 1: usage({ 'employees:department_id': { total: 9, active: 9 } }) } } };
  const html = renderToStaticMarkup(h(ui.OrganizationSettingsContext.Provider, { value: used }, h(ui.UnitsTab, { kind: 'department' })));
  assert.ok(html.includes('aria-label="Delete IT"') && html.includes('aria-label="Delete Legacy Sales"'));
  assert.ok(html.includes('class="outline danger is-blocked" aria-label="Delete IT" title="“IT” cannot be deleted because it is in use (9 employees). Move what uses it, or deactivate it instead."'));
  assert.ok(html.includes('title="“Legacy Sales” cannot be deleted: legacy units are never deleted.'));
  const free = render(ui.UnitsTab, false, manager, { kind: 'department' });
  assert.ok(free.includes('class="outline danger" aria-label="Delete IT"'), 'an unused unit can be deleted');
  assert.ok(render(ui.UnitsTab, true, manager, { kind: 'department' }).includes('حذف'));
  assert.ok(!render(ui.UnitsTab, false, viewer, { kind: 'department' }).includes('aria-label="Delete'), 'viewers get no Delete button');
});

test('department branch scope shows all-branches or the selected branches without duplicating the unit', () => {
  const html = render(ui.UnitsTab, false, manager, { kind: 'department' });
  assert.ok(html.includes('Cairo Branch, Riyadh Branch'), 'IT is one unit scoped to two branches');
  assert.equal(html.split('<b>IT </b>').length - 1, 1, 'one shared unit, not one copy per branch');
});

test('sections list their parent and remain optional', () => {
  const sections = render(ui.UnitsTab, false, manager, { kind: 'section' });
  assert.ok(sections.includes('Backend') && sections.includes('>IT<'));
  const noSections = renderToStaticMarkup(h(ui.OrganizationSettingsContext.Provider, { value: { ...value(false), catalog: { ...catalog, departments: catalog.departments.filter(d => d.organization_kind !== 'section') } } }, h(ui.UnitsTab, { kind: 'section' })));
  assert.ok(noSections.includes('This level is optional'), 'an empty optional level explains itself');
});

test('positions show job title, visible unit path, occupants and the CEO marker', () => {
  const html = render(ui.PositionsTab);
  assert.ok(html.includes('Backend Engineer') && html.includes('BE-1') && html.includes('Omar Nabil'));
  assert.ok(html.includes('IT › Backend'));
  assert.ok(!html.includes('Department › Section › Team') && !html.includes('>Grade<'));
  assert.ok(html.includes('settings-chip accent">CEO<'));
  assert.ok(html.includes('Layla Hassan'));
});

test('job titles: generic titles are labelled, archived titles render as inactive, filter offers generic', () => {
  const html = render(ui.JobTitlesTab);
  assert.ok(html.includes('Generic — all departments'));
  const retired = html.slice(position(html, 'Retired Title'));
  assert.ok(retired.slice(0, 700).includes('Inactive'), 'archived is shown as inactive');
  assert.ok(html.includes('Generic titles'));
  const noPermission = render(ui.JobTitlesTab, false, { ...manager, canCreateJobTitles: false, canEditJobTitles: false });
  assert.ok(!noPermission.includes('Add job title') && noPermission.includes('also requires the job-title permission'));
});

test('organizational settings hide teams and grades', () => {
  const departments = render(ui.DepartmentsSection);
  const positions = render(ui.PositionsSection);
  assert.ok(!departments.includes('>Teams<'));
  assert.ok(!positions.includes('>Grades<'));
});

test('unit manager choices include employees from every company and employment status', () => {
  const people = [
    { id: 1, name_en: 'Same company', employee_code: 'E1', company_id: 5, employment_status: 'active' },
    { id: 2, name_en: 'Other company', employee_code: 'E2', company_id: 6, employment_status: 'active' },
    { id: 3, name_en: 'Former employee', employee_code: 'E3', company_id: null, employment_status: 'inactive' },
  ];
  assert.deepEqual(ui.unitManagerOptions(people, false).map(option => option.value), ['1', '2', '3']);
});

test('employee assignment hides team and grade controls', () => {
  const shuffled = { ...catalog, grades: [catalog.grades[0], catalog.grades[3], catalog.grades[1], catalog.grades[2], { id: 9, name_en: 'Grade 0', name_ar: 'صفر', code: 'G0', sort_order: 0, status: 'active' }] };
  const props = { rtl: false, form: {}, onChange() {}, catalog: shuffled, employees: [], hrResponsibles: [] };
  const html = renderToStaticMarkup(h(ui.OrganizationAssignmentFields, props));
  assert.ok(!html.includes('Job grade / level') && !html.includes('Team (optional)'));
});

test('work locations are separate from branches and report preserved legacy free text', () => {
  const html = render(ui.WorkLocationsSection);
  assert.ok(html.includes('Riyadh HQ') && html.includes('Riyadh Branch') && html.includes('Any branch'));
  assert.ok(html.includes('29 employees still carry a legacy free-text work location') && html.includes('never auto-mapped'));
});

test('HR responsibility shows the precedence steps and lists company+branch rules before fallbacks', () => {
  const legend = render(ui.PrecedenceLegend);
  assert.ok(position(legend, 'Employee-level override') < position(legend, 'Company + branch') && position(legend, 'Company + branch') < position(legend, 'Branch fallback') && position(legend, 'Branch fallback') < position(legend, 'No HR Responsible'));
  const rules = render(ui.RulesTab);
  for (const header of ['Company', 'Branch', 'HR Responsible', 'Rule Type', 'Employees Affected', 'Status']) assert.ok(rules.includes(header), header);
  assert.ok(position(rules, 'Company + Branch') < position(rules, 'Branch Fallback'), 'rank 2 rows come first');
  assert.ok(rules.includes('Huda Mostafa') && rules.includes('Any company'));
  assert.ok(rules.includes('Add HR Responsibility Rule') && rules.includes('Deactivate'));
  assert.ok(!render(ui.RulesTab, false, viewer).includes('Add HR Responsibility Rule'), 'viewers cannot add rules');
  const tester = render(ui.ResolutionTester);
  assert.ok(tester.includes('Test HR Responsibility') && tester.includes('Select employee'));
  const arabic = render(ui.PrecedenceLegend, true);
  assert.ok(arabic.includes('استثناء على مستوى الموظف') && arabic.includes('الفرع (احتياطي)'));
});

test('HR responsibility page: summary, empty state and the no-eligible-HR blocker', () => {
  const page = (overrides, access = manager) => renderToStaticMarkup(h(ui.OrganizationSettingsContext.Provider, { value: { ...value(false, access), ...overrides } }, h(ui.HrResponsibilitySection)));
  const empty = page({ catalog: { ...catalog, hrRules: [] }, hrRoster: [], hrEmployees: [{ id: 1, company_id: 5, branch_id: 3, employment_status: 'active' }], unlinkedHrAccounts: [{ user_id: 1, email: 'admin@example.invalid', role_name: 'Super Admin' }] });
  assert.ok(empty.includes('No HR responsibility rules configured yet.') && empty.includes('Add a Company + Branch rule'));
  assert.ok(empty.includes('No eligible HR Responsible is available. Link an HR-capable user account to an active employee first.'));
  assert.ok(empty.includes('admin@example.invalid'), 'unlinked HR accounts are named');
  assert.ok(!empty.includes('Add HR Responsibility Rule'), 'no add button without an eligible HR responsible');
  for (const label of ['Active Rules', 'Employees Resolved', 'Employees With Overrides', 'Needs HR Setup']) assert.ok(empty.includes(label), label);
  const ready = page({ hrRoster: roster, hrEmployees: [{ id: 1, company_id: 5, branch_id: 3, employment_status: 'active' }, { id: 2, company_id: 9, branch_id: 4, employment_status: 'active' }, { id: 3, company_id: 5, branch_id: 3, hr_user_id: 20, employment_status: 'active' }], unlinkedHrAccounts: [] });
  assert.ok(ready.includes('Add HR Responsibility Rule') && !ready.includes('No eligible HR Responsible'));
  assert.ok(ready.includes('Employees Resolved</dt><dd>3<'));
  assert.ok(ready.includes('Employees With Overrides</dt><dd>1<'));
});

test('simple HR assignment shows company, branch and every employee without setup widgets', () => {
  const person = { id: 88, employee_code: 'EMP88', name_en: 'Noura Ali', name_ar: 'نورة علي', employment_status: 'active' };
  const html = renderToStaticMarkup(h(ui.OrganizationSettingsContext.Provider, { value: { ...value(false), hrEmployees: [person], hrRoster: [] } }, h(ui.SimpleHrResponsibility)));
  assert.ok(html.includes('Company') && html.includes('Branch') && html.includes('HR responsible'));
  assert.ok(html.includes('Noura Ali') && html.includes('EMP88'));
  assert.ok(!html.includes('Routing precedence') && !html.includes('Test HR Responsibility') && !html.includes('Eligible roster'));
});

test('HR roster explains eligibility without lock banners and lets managers only', () => {
  const html = render(ui.RosterTab);
  assert.ok(html.includes('Huda Mostafa') && html.includes('Eligible') && html.includes('Deactivate'));
  assert.ok(!html.includes('Locked: used by 2 active rules') && !html.includes('settings-lock'));
  assert.ok(!render(ui.RosterTab, false, viewer).includes('Deactivate'));
});

test('usage notice shows counts without lock banners', () => {
  const u = usage({ 'employees:company_id': { total: 15, active: 12 } });
  const html = renderToStaticMarkup(h(ui.UsageNotice, { usage: u, rtl: false }));
  assert.ok(!html.includes('Locked: used by') && !html.includes('Structural fields are locked') && !html.includes('settings-lock'));
  assert.ok(html.includes('>15<') && html.includes('>12<') && html.includes('>3<'));
  const arabic = renderToStaticMarkup(h(ui.UsageNotice, { usage: u, rtl: true }));
  assert.ok(!arabic.includes('مقفل') && arabic.includes('١٢'));
  const unused = renderToStaticMarkup(h(ui.UsageNotice, { usage: { total: 0, active: 0, historical: 0, references: {} }, rtl: false }));
  assert.ok(unused.includes('Not used anywhere yet'));
});

test('drawer is a labelled dialog; read-only mode disables the form and drops the save button', () => {
  const editable = renderToStaticMarkup(h(ui.MasterDataDrawer, { rtl: true, eyebrow: 'شركة', title: 'كون', onClose() {}, onSubmit() {} }, h('p', null, 'x')));
  assert.ok(editable.includes('role="dialog"') && editable.includes('aria-modal="true"') && editable.includes('dir="rtl"') && editable.includes('type="submit"'));
  const readOnly = renderToStaticMarkup(h(ui.MasterDataDrawer, { rtl: false, eyebrow: 'X', title: 'Y', onClose() {}, readOnly: true }, h('p', null, 'x')));
  assert.ok(!readOnly.includes('type="submit"') && readOnly.includes('<fieldset class="settings-fieldset" disabled=""'));
});

test('bilingual fields keep Arabic right-to-left and English left-to-right', () => {
  const html = renderToStaticMarkup(h(ui.BilingualFields, { rtl: true, nameAr: 'ش', nameEn: 'C', onChange() {} }));
  assert.match(html, /dir="rtl" lang="ar"/); assert.match(html, /dir="ltr" lang="en"/);
  assert.ok(html.includes('الاسم بالعربية') && html.includes('الاسم بالإنجليزية'));
});
