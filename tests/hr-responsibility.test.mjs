import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.')) {
      const base = new URL(specifier, context.parentURL);
      for (const ext of ['', '.ts', '.tsx']) if (fs.existsSync(fileURLToPath(base) + ext) && fs.statSync(fileURLToPath(base) + ext).isFile()) return next(base.href + ext, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
    if (url.endsWith('.tsx')) return { format: 'module', source: ts.transpileModule("import React from 'react';\n" + fs.readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true };
    return next(url, context);
  },
});

const hr = await import('../app/organization/hr-responsibility.ts');
const { saveOrganizationEntity, previewOrganizationEntity } = await import('../app/organization/catalog-service.ts');
const { validateEmployeeWrite } = await import('../app/organization/assignment-service.ts');
const { saveEmployeeProfile } = await import('../app/employees/profile-update.ts');
const { OrganizationAssignmentFields, AssignmentReview } = await import('../app/organization-assignment-fields.tsx');
const { resolvedHrResponsibility } = await import('../app/organization/assignment-policy.ts');
const codeOf = async promise => { try { await promise; } catch (error) { return error instanceof Response ? (await error.json()).code : error.code; } return 'resolved'; };
const source = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

/* Fixture: Asus Cards (1) and KOON Software (2) share Cairo (10); Riyadh (11) serves Asus only; Branch 1 (12) is unlinked junk. */
const ASUS = 1, KOON = 2, AGENCY = 3, CAIRO = 10, RIYADH = 11, JUNK = 12;
const SARA = 100, MONA = 101, AHMED = 102, UNLINKED = 103, LEFT = 104;
const roster = [
  { user_id: SARA, employee_id: 900, status: 'active', eligible: true, name_en: 'Sara Ahmed', name_ar: 'سارة أحمد', employee_status: 'active' },
  { user_id: MONA, employee_id: 901, status: 'active', eligible: true, name_en: 'Mona Ali', name_ar: 'منى علي', employee_status: 'active' },
  { user_id: AHMED, employee_id: 902, status: 'active', eligible: true, name_en: 'Ahmed HR', name_ar: 'أحمد', employee_status: 'active' },
  { user_id: UNLINKED, employee_id: null, status: 'active', eligible: false, name_en: 'admin@example.invalid', email: 'admin@example.invalid' },
  { user_id: LEFT, employee_id: 903, status: 'active', eligible: false, name_en: 'Former HR', employee_status: 'terminated' },
];
const rule = (id, company_id, branch_id, hr_user_id, status = 'active') => ({ id, company_id, branch_id, hr_user_id, status });
const baseCatalog = (hrRules = []) => ({
  companies: [{ id: ASUS, name: 'Asus Cards', name_en: 'Asus Cards', status: 'active' }, { id: KOON, name: 'KOON Software', name_en: 'KOON Software', status: 'active' }, { id: AGENCY, name: 'KOON Agency', name_en: 'KOON Agency', status: 'active' }],
  branches: [{ id: CAIRO, name_en: 'Cairo', name_ar: 'القاهرة', status: 'active' }, { id: RIYADH, name_en: 'Riyadh', name_ar: 'الرياض', status: 'active' }, { id: JUNK, name_en: '0', name_ar: '0', status: 'active' }],
  companyBranches: [{ company_id: ASUS, branch_id: CAIRO }, { company_id: KOON, branch_id: CAIRO }, { company_id: AGENCY, branch_id: CAIRO }, { company_id: ASUS, branch_id: RIYADH }, { company_id: KOON, branch_id: RIYADH }],
  departments: [], branchScopes: [], positions: [], grades: [], workLocations: [], jobTitles: [], hrRules,
});
const resolve = (employee, catalog) => hr.resolveEmployeeHrResponsibility({ employee, catalog, roster });

/* ------------------------------------------------------------------ resolver (§29) */

test('resolver: employee override wins over every rule', () => {
  const catalog = baseCatalog([rule(1, ASUS, CAIRO, SARA), rule(2, null, CAIRO, AHMED)]);
  const r = resolve({ id: 5, company_id: ASUS, branch_id: CAIRO, hr_user_id: MONA }, catalog);
  assert.deepEqual([r.source, r.hrUserId, r.ruleId, r.available, r.overrideUserId, r.hrEmployeeId], ['employee_override', MONA, null, true, MONA, 901]);
});

test('resolver: Company + Branch wins over the Branch Fallback; the fallback serves other companies', () => {
  const catalog = baseCatalog([rule(2, null, CAIRO, AHMED), rule(1, ASUS, CAIRO, SARA)]);
  const specific = resolve({ id: 5, company_id: ASUS, branch_id: CAIRO }, catalog);
  assert.deepEqual([specific.source, specific.hrUserId, specific.ruleId, specific.reason], ['company_branch', SARA, 1, 'rule']);
  const fallback = resolve({ id: 6, company_id: KOON, branch_id: CAIRO }, catalog);
  assert.deepEqual([fallback.source, fallback.hrUserId, fallback.ruleId], ['branch_fallback', AHMED, 2]);
  assert.equal(hr.hrSourceText(fallback, catalog, false), 'Cairo Branch Fallback');
  assert.equal(hr.hrSourceText(specific, catalog, false), 'Asus Cards + Cairo rule');
});

test('resolver: no rule returns none ("Needs HR setup"), never a guess', () => {
  const r = resolve({ id: 5, company_id: ASUS, branch_id: RIYADH }, baseCatalog([rule(1, ASUS, CAIRO, SARA)]));
  assert.deepEqual([r.source, r.hrUserId, r.available, r.reason], ['none', null, false, 'no_rule']);
  assert.equal(hr.HR_SOURCE_LABEL.none.en, 'Needs HR setup');
});

test('resolver: inactive rules are ignored and the next valid rule applies', () => {
  const catalog = baseCatalog([rule(1, ASUS, CAIRO, SARA, 'inactive'), rule(2, null, CAIRO, AHMED)]);
  const r = resolve({ id: 5, company_id: ASUS, branch_id: CAIRO }, catalog);
  assert.deepEqual([r.source, r.hrUserId], ['branch_fallback', AHMED]);
  const none = resolve({ id: 5, company_id: ASUS, branch_id: CAIRO }, baseCatalog([rule(1, ASUS, CAIRO, SARA, 'inactive')]));
  assert.equal(none.source, 'none');
});

test('resolver: an invalid HR person is reported unavailable and never falls through to a lower rule', () => {
  const catalog = baseCatalog([rule(1, ASUS, CAIRO, UNLINKED), rule(2, null, CAIRO, AHMED)]);
  const r = resolve({ id: 5, company_id: ASUS, branch_id: CAIRO }, catalog);
  assert.deepEqual([r.source, r.hrUserId, r.available, r.reason], ['company_branch', UNLINKED, false, 'rule_hr_unavailable']);
  const override = resolve({ id: 5, company_id: ASUS, branch_id: CAIRO, hr_user_id: LEFT }, catalog);
  assert.deepEqual([override.source, override.available, override.reason], ['employee_override', false, 'override_unavailable']);
  const self = resolve({ id: 900, company_id: ASUS, branch_id: CAIRO }, baseCatalog([rule(1, ASUS, CAIRO, SARA)]));
  assert.equal(self.available, false, 'the HR person is never their own HR responsible');
});

test('resolver: missing company/branch is explained; a branch fallback still resolves without a company', () => {
  const catalog = baseCatalog([rule(1, ASUS, CAIRO, SARA)]);
  assert.equal(resolve({ id: 5 }, catalog).reason, 'missing_company_branch');
  assert.equal(resolve({ id: 5, company_id: ASUS }, catalog).reason, 'missing_branch');
  assert.equal(resolve({ id: 5, branch_id: CAIRO }, catalog).reason, 'missing_company');
  assert.match(hr.hrReasonText('missing_company_branch', false), /Company and Branch are required for the configured HR rule/);
  const withFallback = resolve({ id: 5, branch_id: CAIRO }, baseCatalog([rule(1, ASUS, CAIRO, SARA), rule(2, null, CAIRO, AHMED)]));
  assert.deepEqual([withFallback.source, withFallback.hrUserId], ['branch_fallback', AHMED]);
});

test('resolver: clearing the override falls back to the rules', () => {
  const catalog = baseCatalog([rule(1, ASUS, CAIRO, SARA)]);
  assert.equal(resolve({ id: 5, company_id: ASUS, branch_id: CAIRO, hr_user_id: MONA }, catalog).hrUserId, MONA);
  for (const cleared of [null, '', undefined]) assert.deepEqual([resolve({ id: 5, company_id: ASUS, branch_id: CAIRO, hr_user_id: cleared }, catalog).source, resolve({ id: 5, company_id: ASUS, branch_id: CAIRO, hr_user_id: cleared }, catalog).hrUserId], ['company_branch', SARA]);
});

/* ------------------------------------------------------------------ rules (§30) */

const issueCodes = (catalog, record) => hr.hrRuleIssues(catalog, roster, record).map(issue => issue.code);

test('rules: a valid Company + Branch rule; duplicates of the same scope are rejected with a structured code', () => {
  const catalog = baseCatalog([rule(1, ASUS, CAIRO, SARA)]);
  assert.deepEqual(issueCodes(baseCatalog(), { rule_type: 'company_branch', company_id: ASUS, branch_id: CAIRO, hr_user_id: SARA, status: 'active' }), []);
  const duplicate = hr.hrRuleIssues(catalog, roster, { rule_type: 'company_branch', company_id: ASUS, branch_id: CAIRO, hr_user_id: MONA, status: 'active' });
  assert.equal(duplicate[0].code, 'HR_RULE_DUPLICATE');
  assert.ok(duplicate[0].message_ar && duplicate[0].message_en);
  assert.deepEqual(issueCodes(catalog, { id: 1, rule_type: 'company_branch', company_id: ASUS, branch_id: CAIRO, hr_user_id: MONA, status: 'active' }), [], 'editing the rule itself is not a duplicate');
  assert.deepEqual(issueCodes(catalog, { rule_type: 'company_branch', company_id: ASUS, branch_id: CAIRO, hr_user_id: MONA, status: 'inactive' }), [], 'an inactive rule may share a scope');
});

test('rules: the same HR may serve several scopes, and companies in one branch may have different HR', () => {
  const catalog = baseCatalog([rule(1, ASUS, CAIRO, SARA), rule(2, AGENCY, CAIRO, SARA)]);
  assert.deepEqual(issueCodes(catalog, { rule_type: 'company_branch', company_id: ASUS, branch_id: RIYADH, hr_user_id: SARA, status: 'active' }), []);
  assert.deepEqual(issueCodes(catalog, { rule_type: 'company_branch', company_id: KOON, branch_id: CAIRO, hr_user_id: MONA, status: 'active' }), []);
  const next = { ...catalog, hrRules: [...catalog.hrRules, rule(3, KOON, CAIRO, MONA)] };
  assert.equal(resolve({ id: 5, company_id: ASUS, branch_id: CAIRO }, next).hrUserId, SARA);
  assert.equal(resolve({ id: 6, company_id: AGENCY, branch_id: CAIRO }, next).hrUserId, SARA);
  assert.equal(resolve({ id: 7, company_id: KOON, branch_id: CAIRO }, next).hrUserId, MONA);
});

test('rules: one active Branch Fallback per branch; rule types cannot be ambiguous', () => {
  const catalog = baseCatalog([rule(1, null, CAIRO, AHMED)]);
  assert.deepEqual(issueCodes(catalog, { rule_type: 'branch_fallback', branch_id: CAIRO, hr_user_id: SARA, status: 'active' }), ['HR_RULE_DUPLICATE']);
  assert.deepEqual(issueCodes(catalog, { rule_type: 'branch_fallback', branch_id: RIYADH, hr_user_id: SARA, status: 'active' }), []);
  assert.deepEqual(issueCodes(catalog, { branch_id: RIYADH, hr_user_id: SARA, status: 'active' }), ['HR_RULE_TYPE_INVALID'], 'no type and no company is ambiguous');
  assert.deepEqual(issueCodes(catalog, { rule_type: 'branch_fallback', company_id: ASUS, branch_id: RIYADH, hr_user_id: SARA, status: 'active' }), ['HR_RULE_TYPE_INVALID']);
  assert.deepEqual(issueCodes(catalog, { rule_type: 'company_branch', branch_id: RIYADH, hr_user_id: SARA, status: 'active' }), ['REQUIRED_FIELD']);
});

test('rules: branch choices follow the company; unlinked junk branches never appear', () => {
  const catalog = baseCatalog();
  assert.deepEqual(hr.hrRuleBranchChoices(catalog, 'company_branch', AGENCY).map(b => b.id), [CAIRO]);
  assert.deepEqual(hr.hrRuleBranchChoices(catalog, 'company_branch', ASUS).map(b => b.id), [CAIRO, RIYADH]);
  assert.deepEqual(hr.hrRuleBranchChoices(catalog, 'company_branch', '').map(b => b.id), []);
  assert.deepEqual(hr.hrRuleBranchChoices(catalog, 'branch_fallback').map(b => b.id), [CAIRO, RIYADH]);
  assert.deepEqual(issueCodes(catalog, { rule_type: 'company_branch', company_id: AGENCY, branch_id: RIYADH, hr_user_id: SARA, status: 'active' }), ['BRANCH_NOT_LINKED']);
  assert.deepEqual(issueCodes(catalog, { rule_type: 'branch_fallback', branch_id: JUNK, hr_user_id: SARA, status: 'active' }), ['BRANCH_NOT_LINKED']);
});

test('eligibility: unlinked, inactive-employee and unknown HR accounts are refused with specific codes', () => {
  const record = hr_user_id => ({ rule_type: 'company_branch', company_id: ASUS, branch_id: CAIRO, hr_user_id, status: 'active' });
  assert.deepEqual(issueCodes(baseCatalog(), record(UNLINKED)), ['HR_ACCOUNT_NOT_LINKED']);
  assert.deepEqual(issueCodes(baseCatalog(), record(LEFT)), ['HR_EMPLOYEE_INACTIVE']);
  assert.deepEqual(issueCodes(baseCatalog(), record(999)), ['HR_RESPONSIBLE_INVALID']);
  assert.equal(hr.hrUsableFor(roster[0]), true);
  assert.equal(hr.hrUsableFor(roster[0], 900), false, 'not for their own employee record');
  assert.equal(hr.hrUsableFor(roster[3]), false);
});

test('impact: changing the HR of a rule reports who moves and leaves overrides alone', () => {
  const catalog = baseCatalog([rule(1, ASUS, CAIRO, SARA)]);
  const employees = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: 10 + i, name_en: `E${i}`, company_id: ASUS, branch_id: CAIRO, employment_status: 'active' })),
    { id: 30, name_en: 'Override 1', company_id: ASUS, branch_id: CAIRO, hr_user_id: AHMED, employment_status: 'active' },
    { id: 31, name_en: 'Override 2', company_id: ASUS, branch_id: CAIRO, hr_user_id: AHMED, employment_status: 'active' },
    { id: 32, name_en: 'Elsewhere', company_id: KOON, branch_id: CAIRO, employment_status: 'active' },
    { id: 33, name_en: 'Terminated', company_id: ASUS, branch_id: CAIRO, employment_status: 'terminated' },
  ];
  const impact = hr.hrRuleImpact(catalog, roster, employees, { id: 1, company_id: ASUS, branch_id: CAIRO, hr_user_id: MONA, status: 'active' });
  assert.equal(impact.affected, 10);
  assert.equal(impact.toThisRule.length, 10);
  assert.equal(impact.overridesUnchanged.length, 2);
  assert.equal(impact.toOtherRule.length + impact.toNone.length, 0);
  assert.equal(hr.hrImpactChanges(impact), 10);
  const summary = hr.hrSetupSummary(catalog, roster, employees);
  assert.deepEqual([summary.activeRules, summary.resolved, summary.overrides, summary.needsSetup, summary.perRule['1']], [1, 12, 2, 1, 10]);
});

test('impact: deactivation splits employees into fallback and "Needs HR setup"; counts follow the resolver', () => {
  const catalog = baseCatalog([rule(1, ASUS, null, SARA), rule(2, ASUS, CAIRO, SARA), rule(3, null, CAIRO, AHMED)]);
  catalog.hrRules = [rule(2, ASUS, CAIRO, SARA), rule(3, null, CAIRO, AHMED), rule(4, ASUS, RIYADH, SARA)];
  const employees = [
    { id: 1, company_id: ASUS, branch_id: CAIRO, employment_status: 'active' },
    { id: 2, company_id: ASUS, branch_id: CAIRO, employment_status: 'probation' },
    { id: 3, company_id: ASUS, branch_id: RIYADH, employment_status: 'active' },
  ];
  const cairo = hr.hrRuleImpact(catalog, roster, employees, { id: 2, company_id: ASUS, branch_id: CAIRO, hr_user_id: SARA, status: 'inactive' });
  assert.deepEqual(cairo.toOtherRule.map(p => [p.id, p.hrUserId]), [[1, AHMED], [2, AHMED]]);
  const riyadh = hr.hrRuleImpact(catalog, roster, employees, { id: 4, company_id: ASUS, branch_id: RIYADH, hr_user_id: SARA, status: 'inactive' });
  assert.deepEqual(riyadh.toNone.map(p => p.id), [3]);
  const unchanged = hr.hrRuleImpact(catalog, roster, employees, { id: 4, company_id: ASUS, branch_id: RIYADH, hr_user_id: SARA, status: 'active' });
  assert.equal(hr.hrImpactChanges(unchanged), 0, 'saving without a change needs no confirmation');
});

/* ------------------------------------------------------------------ rule save through the service */

function ruleDb({ catalog, employees = [], before = null }) {
  const writes = [];
  const tables = { companies: 'companies', branches: 'branches', company_branches: 'companyBranches', departments: 'departments', organization_branch_scopes: 'branchScopes', positions: 'positions', job_grades: 'grades', work_locations: 'workLocations', hr_responsibility_rules: 'hrRules', job_titles: 'jobTitles' };
  return { writes, prepare(sql) { let params = []; return {
    bind(...args) { params = args; return this; },
    async run() { writes.push({ sql, params }); },
    async first() { if (sql.includes('FOR UPDATE')) return before; if (/^(UPDATE|INSERT)/.test(sql)) { writes.push({ sql, params }); return { id: before?.id || 77 }; } if (sql.startsWith('SELECT * FROM hr_responsibility_rules WHERE id')) return before; return null; },
    async all() {
      if (sql.includes('FROM hr_responsibles h')) return { results: roster };
      if (sql.includes("FROM employees WHERE employment_status<>'deleted'")) return { results: employees };
      const table = /^SELECT \* FROM (\w+) ORDER BY/.exec(sql)?.[1];
      return { results: table ? catalog[tables[table]] ?? [] : [] };
    },
  }; } };
}

test('service: a rule that changes nobody saves directly and is audited with before/after', async () => {
  const db = ruleDb({ catalog: baseCatalog() });
  await saveOrganizationEntity(db, 'hrRules', { rule_type: 'company_branch', company_id: ASUS, branch_id: CAIRO, hr_user_id: SARA, status: 'active' }, 5);
  const insert = db.writes.find(w => w.sql.startsWith('INSERT INTO hr_responsibility_rules'));
  assert.deepEqual(insert.params, [ASUS, CAIRO, SARA, 'active']);
  const audit = db.writes.find(w => w.sql.includes('INSERT INTO audit_logs'));
  assert.equal(audit.params[0], 5);
  assert.equal(audit.params[1], 'hr_responsibility_rules');
  assert.ok(!db.writes.some(w => /UPDATE employees/.test(w.sql)), 'rule saves never write employee records');
});

test('service: impactful rule changes need the preview token; a stale token is refused', async () => {
  const before = rule(1, ASUS, CAIRO, SARA);
  const employees = [{ id: 1, name_en: 'A', company_id: ASUS, branch_id: CAIRO, employment_status: 'active' }];
  const change = { id: 1, rule_type: 'company_branch', company_id: ASUS, branch_id: CAIRO, hr_user_id: MONA, status: 'active' };
  assert.equal(await codeOf(saveOrganizationEntity(ruleDb({ catalog: baseCatalog([before]), employees, before }), 'hrRules', change)), 'IMPACT_NOT_CONFIRMED');
  const preview = await previewOrganizationEntity(ruleDb({ catalog: baseCatalog([before]), employees, before }), 'hrRules', change);
  assert.equal(preview.ok, true);
  assert.equal(preview.impact.hr.toThisRule.length, 1);
  assert.equal(preview.warnings[0].code, 'HR_ROUTING_CHANGE');
  assert.equal(await codeOf(saveOrganizationEntity(ruleDb({ catalog: baseCatalog([before]), employees, before }), 'hrRules', { ...change, confirmImpact: 'hr:stale' })), 'STALE_REVIEW');
  const db = ruleDb({ catalog: baseCatalog([before]), employees, before });
  await saveOrganizationEntity(db, 'hrRules', { ...change, confirmImpact: preview.confirmationToken }, 5);
  assert.ok(db.writes.some(w => w.sql.startsWith('UPDATE hr_responsibility_rules')));
});

test('service: duplicates and invalid HR are structured bilingual errors; deactivation stays possible', async () => {
  const catalog = baseCatalog([rule(1, ASUS, CAIRO, SARA)]);
  const duplicate = await saveOrganizationEntity(ruleDb({ catalog }), 'hrRules', { rule_type: 'company_branch', company_id: ASUS, branch_id: CAIRO, hr_user_id: MONA, status: 'active' }).catch(error => error);
  assert.equal(duplicate.status, 409);
  const body = await duplicate.json();
  assert.equal(body.code, 'HR_RULE_DUPLICATE');
  assert.ok(body.message_ar && body.message_en && !/duplicate key|constraint/i.test(body.message_en));
  const unlinked = await saveOrganizationEntity(ruleDb({ catalog: baseCatalog() }), 'hrRules', { rule_type: 'company_branch', company_id: ASUS, branch_id: CAIRO, hr_user_id: UNLINKED, status: 'active' }).catch(error => error);
  assert.equal((await unlinked.json()).code, 'HR_ACCOUNT_NOT_LINKED');
  const stale = rule(9, ASUS, RIYADH, LEFT);
  await assert.doesNotReject(saveOrganizationEntity(ruleDb({ catalog: baseCatalog([stale]), before: stale }), 'hrRules', { ...stale, status: 'inactive' }), 'a rule whose HR left can still be deactivated');
});

/* ------------------------------------------------------------------ employee override (§31) */

test('profile: override validation uses the shared eligibility; self-HR is refused', async () => {
  const db = { prepare(sql) { return { bind() { return this; }, async run() {}, async first() { if (sql.includes('to_regclass')) return { ready: false }; return null; }, async all() { if (sql.includes('FROM hr_responsibles h')) return { results: roster }; return { results: [] }; } }; } };
  assert.equal(await codeOf(validateEmployeeWrite(db, 5, { hrUserId: UNLINKED }, { id: 5 })), 'HR_ACCOUNT_NOT_LINKED');
  assert.equal(await codeOf(validateEmployeeWrite(db, 900, { hrUserId: SARA }, { id: 900 })), 'HR_OVERRIDE_INVALID');
  const next = await validateEmployeeWrite(db, 5, { hrUserId: MONA }, { id: 5 });
  assert.equal(next.hr_user_id, MONA);
  const cleared = await validateEmployeeWrite(db, 5, { hrUserId: '' }, { id: 5, hr_user_id: MONA });
  assert.equal(cleared.hr_user_id, null, 'clearing stores NULL — never the rule result');
});

test('profile: an HR Manager cannot change the HR override on their own record', async () => {
  const db = { prepare(sql) { return { bind() { return this; }, async run() {}, async first() { if (sql.includes('FOR UPDATE')) return { id: 900, hr_user_id: null, employment_status: 'active' }; return null; }, async all() { return { results: [] }; } }; } };
  await assert.rejects(saveEmployeeProfile(db, 900, { hrUserId: MONA }, { id: SARA, employeeId: 900, roleName: 'HR Manager' }), e => e.status === 403);
});

const profileCatalog = baseCatalog([rule(1, ASUS, CAIRO, SARA), rule(2, KOON, CAIRO, MONA), rule(3, null, RIYADH, AHMED)]);
const render = props => renderToStaticMarkup(React.createElement(OrganizationAssignmentFields, { rtl: false, catalog: profileCatalog, employees: [], hrResponsibles: roster, onChange() {}, ...props }));

test('profile: optional override retains automatic HR resolution in the simplified form', () => {
  const form = { employeeId: 5, companyId: ASUS, branchId: CAIRO, hrUserId: '' };
  const html = render({ form });
  // The simplified editor omits the derived summary; the profile and review show it.
  assert.doesNotMatch(html, /Resolved HR Responsible \(derived — read only\)/);
  assert.match(html, />HR responsible</);
  // The HR is named right away in the automatic option, with no explanation under the field.
  assert.match(html, />Automatic: Sara[^<(]*</);
  assert.doesNotMatch(html, /Current HR responsible/);
  // Without the rule list (a limited viewer) the saved HR name from the server is used while company and branch are unchanged.
  const saved = render({ form, catalog: { ...profileCatalog, hrRules: [] }, before: { id: 5, company_id: ASUS, branch_id: CAIRO, hr_user_id: null, hr_name: 'Saved HR' } });
  assert.match(saved, />Automatic: Saved HR</);
  const automatic = resolvedHrResponsibility(profileCatalog, form, roster);
  assert.equal(automatic.userId, SARA);
  assert.match(hr.hrSourceText(automatic, profileCatalog, false), /Asus Cards \+ Cairo rule/);
  const overriddenForm = { ...form, hrUserId: String(MONA) };
  assert.match(render({ form: overriddenForm }), new RegExp(`value="${MONA}" selected="">Mona Ali`));
  const overridden = resolvedHrResponsibility(profileCatalog, overriddenForm, roster);
  assert.equal(overridden.userId, MONA);
  assert.match(hr.hrSourceText(overridden, profileCatalog, false), /Employee override/);
  assert.equal(resolvedHrResponsibility(profileCatalog, { ...form, companyId: '', branchId: '' }, roster).source, 'none');
  const fallback = resolvedHrResponsibility(profileCatalog, { ...form, branchId: RIYADH }, roster);
  assert.match(hr.hrSourceText(fallback, profileCatalog, true), /احتياطي فرع الرياض/);
});

test('profile review: Company and Branch changes recalculate HR in the before/after table', () => {
  const before = { id: 5, company_id: ASUS, branch_id: CAIRO, hr_user_id: null };
  const company = renderToStaticMarkup(React.createElement(AssignmentReview, { rtl: false, catalog: profileCatalog, employees: [], hrResponsibles: roster, before, form: { companyId: KOON, branchId: CAIRO, hrUserId: '' } }));
  assert.match(company, /Resolved HR Responsible \(derived\)/);
  assert.ok(company.indexOf('Sara Ahmed') < company.indexOf('Mona Ali'), 'before Sara, after Mona');
  assert.match(company, /is not stored on the employee/);
  const branch = renderToStaticMarkup(React.createElement(AssignmentReview, { rtl: false, catalog: profileCatalog, employees: [], hrResponsibles: roster, before, form: { companyId: ASUS, branchId: RIYADH, hrUserId: '' } }));
  assert.match(branch, /Riyadh Branch Fallback/);
  assert.match(branch, /Ahmed HR/);
  const cleared = renderToStaticMarkup(React.createElement(AssignmentReview, { rtl: false, catalog: profileCatalog, employees: [], hrResponsibles: roster, before: { ...before, hr_user_id: MONA }, form: { companyId: ASUS, branchId: CAIRO, hrUserId: '' } }));
  assert.ok(cleared.indexOf('Employee override') < cleared.indexOf('Asus Cards + Cairo rule'), 'clearing shows the rule result before save');
  const unchanged = renderToStaticMarkup(React.createElement(AssignmentReview, { rtl: false, catalog: profileCatalog, employees: [], hrResponsibles: roster, before, form: { companyId: ASUS, branchId: CAIRO, departmentId: '' } }));
  assert.doesNotMatch(unchanged, /Resolved HR Responsible/, 'no HR row when the result does not change');
});

/* ------------------------------------------------------------------ workflows (§32) */

test('workflows: routing, queues, notifications and reports use the effective resolver SQL, never only the raw override', () => {
  const assignment = source('../app/employees/hr-assignment.ts');
  assert.match(assignment, /COALESCE\(e\.hr_user_id,\(SELECT rule\.hr_user_id FROM hr_responsibility_rules rule WHERE rule\.status='active' AND rule\.branch_id=e\.branch_id AND \(rule\.company_id=e\.company_id OR rule\.company_id IS NULL\) ORDER BY \(rule\.company_id IS NOT NULL\) DESC/);
  assert.match(assignment, /JOIN users u ON u\.id=\$\{hrSql\}/);
  assert.match(assignment, /\$\{HR_ELIGIBLE_SQL\} AND u\.employee_id<>e\.id/);
  for (const file of ['../app/leave/leave-service.ts', '../app/attendance/attendance-service.ts']) assert.match(source(file), /requireEmployeeHr\(/, file);
  for (const file of ['../app/approvals/approval-aggregation.ts', '../app/notifications/notification-service.ts', '../app/api/dashboard/route.ts', '../app/api/reports/route.ts']) {
    const text = source(file);
    assert.match(text, /effectiveHrSql\(/, file);
    assert.doesNotMatch(text, /employee_id IS NULL OR/, `${file}: unlinked accounts are never eligible`);
  }
  assert.match(source('../app/api/reports/route.ts'), /\["hrUserId",`\(\$\{hrSql\}\)`\]/, 'report HR filter matches the effective HR');
  assert.match(source('../app/api/hr/route.ts'), /LEFT JOIN users hu ON hu\.id=\$\{hrSql\}/, 'employee list shows the effective HR');
  assert.match(source('../app/api/employees/[id]/route.ts'), /resolveEmployeeHrFromDb\(db,employeeId\)/, 'profile API uses the shared resolver');
});

test('workflows: the single eligibility rule requires a linked, current employee', () => {
  const rosterSql = source('../app/organization/hr-roster.ts');
  assert.match(rosterSql, /u\.employee_id IS NOT NULL AND he\.employment_status IN \('active','probation','notice_period'\)/);
  for (const file of ['../app/organization/assignment-service.ts', '../app/organization/catalog-service.ts', '../app/employees/company-hr-catalog.ts', '../app/employees/hr-assignment.ts']) assert.doesNotMatch(source(file), /employee_id IS NULL OR/, file);
  assert.doesNotMatch(source('../app/reports/missing-employee-data.ts'), /employee_id IS NULL OR/);
});

test('workflows: the SQL precedence agrees with the resolver on every scope combination', () => {
  // Evaluates the same ORDER BY/COALESCE semantics in JS to guard the two representations against drift.
  const sqlLike = (employee, rules) => employee.hr_user_id ?? rules.filter(r => r.status === 'active' && r.branch_id === employee.branch_id && (r.company_id === employee.company_id || r.company_id == null)).sort((a, b) => Number(b.company_id != null) - Number(a.company_id != null) || a.id - b.id)[0]?.hr_user_id ?? null;
  const rules = [rule(1, ASUS, CAIRO, SARA), rule(2, null, CAIRO, AHMED), rule(3, KOON, RIYADH, MONA, 'inactive'), rule(4, null, RIYADH, MONA)];
  for (const company_id of [null, ASUS, KOON, AGENCY]) for (const branch_id of [null, CAIRO, RIYADH, JUNK]) for (const hr_user_id of [null, MONA]) {
    const employee = { id: 5, company_id, branch_id, hr_user_id };
    assert.equal(resolve(employee, baseCatalog(rules)).hrUserId, sqlLike(employee, rules), JSON.stringify(employee));
  }
});
