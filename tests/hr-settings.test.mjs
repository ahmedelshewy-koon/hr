import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deleteHrSetting, documentTypeCode, overlappingRule, saveHrSetting, validateAttendanceType, validateDeductionRule, validateDocumentType, validateMedicalPlan } from '../app/hr-settings/catalog.ts';

const code = fn => { try { fn(); return null; } catch (error) { return error.issue?.code ?? error.message; } };
const names = { name_en: 'Name', name_ar: 'اسم' };

/** Fake transaction: `rows` answers SELECTs by table, every statement is recorded. */
function fakeDb({ before = null, rows = {}, clash = null, used = 0 } = {}) {
  const statements = [];
  return { statements, prepare(sql) { let params = []; return {
    bind(...args) { params = args; return this; },
    async run() { statements.push({ sql, params }); return {}; },
    async all() { statements.push({ sql, params }); const table = Object.keys(rows).find(name => sql.includes(`FROM ${name}`)); return { results: table ? rows[table] : [] }; },
    async first() {
      statements.push({ sql, params });
      if (sql.includes('FOR UPDATE')) return before;
      if (sql.includes('COUNT(*)')) return { count: used };
      if (sql.startsWith('SELECT id')) return clash;
      if (sql.includes('RETURNING')) return { id: before?.id ?? 99, ...Object.fromEntries(params.map((value, i) => [i, value])) };
      return null;
    },
  }; } };
}

test('document types need both names; mandatory and status are normalized', () => {
  assert.equal(code(() => validateDocumentType({ name_ar: 'عقد' })), 'REQUIRED_FIELD');
  assert.deepEqual(validateDocumentType({ name_en: ' Contract ', name_ar: 'عقد', required_document: true }), { name_en: 'Contract', name_ar: 'عقد', required_document: 1, status: 'active', description: null });
  assert.equal(code(() => validateDocumentType({ ...names, status: 'deleted' })), 'INVALID_STATUS');
});

test('a new document type gets a stable unique code from its English name', () => {
  assert.equal(documentTypeCode('Driving License', new Set()), 'driving_license');
  assert.equal(documentTypeCode('Passport', new Set(['passport', 'passport_2'])), 'passport_3');
  assert.equal(documentTypeCode('***', new Set()), 'document_type');
});

test('deduction rules: absence/late need a deduction type and value, overtime needs a multiplier', () => {
  assert.equal(code(() => validateDeductionRule({ ...names, rule_type: 'late_arrival', min_minutes: 16, max_minutes: 30 })), 'INVALID_SELECTION');
  assert.equal(code(() => validateDeductionRule({ ...names, rule_type: 'late_arrival', min_minutes: 16, deduction_type: 'daily_wage_percent' })), 'REQUIRED_FIELD');
  assert.equal(code(() => validateDeductionRule({ ...names, rule_type: 'late_arrival', min_minutes: 0, deduction_type: 'daily_wage_percent', value: 150 })), 'INVALID_NUMBER');
  assert.equal(code(() => validateDeductionRule({ ...names, rule_type: 'late_arrival', min_minutes: 30, max_minutes: 10, deduction_type: 'fixed_amount', value: 5 })), 'INVALID_RANGE');
  assert.equal(code(() => validateDeductionRule({ ...names, rule_type: 'overtime', min_minutes: 0 })), 'REQUIRED_FIELD');
  const overtime = validateDeductionRule({ ...names, rule_type: 'overtime', min_minutes: 0, overtime_multiplier: 1.5, deduction_type: 'fixed_amount', value: 9 });
  assert.equal(overtime.deduction_type, 'hourly', 'legacy overtime inputs become hourly rules');
  assert.equal(overtime.value, 1);
  assert.equal(validateDeductionRule({ ...names, rule_type: 'absence', min_minutes: 0, max_minutes: '', deduction_type: 'days_of_wage', value: 1 }).max_minutes, null);
  assert.equal(code(() => validateDeductionRule({ ...names, rule_type: 'bonus', min_minutes: 0 })), 'INVALID_SELECTION');
});

test('absence supports 200 percent and notice conditions without a minute range', () => {
  const rule = validateDeductionRule({ ...names, rule_type: 'absence', absence_notice: 'without_notice', deduction_type: 'daily_wage_percent', value: 200 });
  assert.equal(rule.value, 200);
  assert.equal(rule.absence_notice, 'without_notice');
  assert.equal(rule.min_minutes, null);
  assert.equal(rule.max_minutes, null);
  assert.equal(code(() => validateDeductionRule({ ...rule, absence_notice: 'invalid' })), 'INVALID_SELECTION');
  const existing = { ...rule, id: 1 };
  assert.equal(overlappingRule([existing], { ...rule, absence_notice: 'with_notice' }), null);
  assert.equal(overlappingRule([existing], { ...rule, absence_notice: 'without_notice' })?.id, 1);
  assert.equal(overlappingRule([existing], { ...rule, absence_notice: null })?.id, 1, 'all absences intersects both notice conditions');
});

test('hourly overtime retains its quantity and multiplier, without a minute range', () => {
  const rule = validateDeductionRule({ ...names, rule_type: 'overtime', deduction_type: 'hourly', value: 1, overtime_multiplier: 1.5 });
  assert.equal(rule.deduction_type, 'hourly');
  assert.equal(rule.value, 1);
  assert.equal(rule.overtime_multiplier, 1.5);
  assert.equal(rule.min_minutes, null);
  assert.equal(code(() => validateDeductionRule({ ...rule, value: 0 })), 'INVALID_NUMBER');
  assert.equal(code(() => validateDeductionRule({ ...names, rule_type: 'late_arrival', deduction_type: 'hourly', value: 1, min_minutes: 1 })), 'INVALID_SELECTION');
});

test('zero-value late rules may overlap, but a nonzero deduction still conflicts', () => {
  const rule = { id: 1, rule_type: 'late_arrival', min_minutes: 61, max_minutes: null, deduction_type: 'daily_wage_percent', value: 0, status: 'active' };
  const candidate = { ...rule, id: 2, max_minutes: 90 };
  assert.equal(overlappingRule([rule], candidate), null);
  assert.equal(overlappingRule([rule], { ...candidate, value: 10 })?.id, 1);
  assert.equal(overlappingRule([{ ...rule, value: 10 }], candidate)?.id, 1);
  assert.equal(overlappingRule([{ ...rule, value: null }], candidate)?.id, 1, 'missing values are not free deductions');
});

test('active rules of the same type may not overlap; inactive rules and other types are ignored', () => {
  const rules = [{ id: 1, rule_type: 'late_arrival', min_minutes: 1, max_minutes: 15, status: 'active' }, { id: 2, rule_type: 'late_arrival', min_minutes: 31, max_minutes: null, status: 'active' }, { id: 3, rule_type: 'overtime', min_minutes: 0, max_minutes: null, status: 'active' }, { id: 4, rule_type: 'late_arrival', min_minutes: 16, max_minutes: 30, status: 'inactive' }];
  assert.equal(overlappingRule(rules, { rule_type: 'late_arrival', min_minutes: 16, max_minutes: 30, status: 'active' }), null);
  assert.equal(overlappingRule(rules, { rule_type: 'late_arrival', min_minutes: 15, max_minutes: 20, status: 'active' })?.id, 1, 'ranges are inclusive');
  assert.equal(overlappingRule(rules, { rule_type: 'late_arrival', min_minutes: 100, max_minutes: 200, status: 'active' })?.id, 2, 'open-ended rule covers everything above');
  assert.equal(overlappingRule(rules, { id: 1, rule_type: 'late_arrival', min_minutes: 1, max_minutes: 20, status: 'active' }), null, 'a rule does not overlap itself');
  assert.equal(overlappingRule(rules, { rule_type: 'late_arrival', min_minutes: 1, max_minutes: 15, status: 'inactive' }), null);
});

test('medical plans: provider, coverage type and a 100% contribution split are required', () => {
  const plan = { ...names, provider: 'Bupa', coverage_type: 'premium', max_coverage: 500000, employee_contribution: 20, company_contribution: 80 };
  assert.equal(validateMedicalPlan(plan).currency, 'SAR');
  assert.equal(code(() => validateMedicalPlan({ ...plan, company_contribution: 70 })), 'CONTRIBUTION_TOTAL');
  assert.equal(code(() => validateMedicalPlan({ ...plan, provider: '' })), 'REQUIRED_FIELD');
  assert.equal(code(() => validateMedicalPlan({ ...plan, coverage_type: 'gold' })), 'INVALID_SELECTION');
  assert.equal(code(() => validateMedicalPlan({ ...plan, max_coverage: 0 })), 'INVALID_NUMBER');
  assert.equal(code(() => validateMedicalPlan({ ...plan, currency: 'EUR' })), 'INVALID_SELECTION');
  assert.equal(validateMedicalPlan({ ...plan, family_coverage: 'true' }).family_coverage, 1);
});

test('attendance types: code format, shift times and late allowance', () => {
  assert.equal(validateAttendanceType({ ...names, code: 'night-shift', shift_based: 1, start_time: '22:00', end_time: '06:00' }).code, 'NIGHT-SHIFT', 'overnight shifts are allowed');
  assert.equal(code(() => validateAttendanceType({ ...names, code: 'دوام' })), 'INVALID_CODE');
  assert.equal(code(() => validateAttendanceType({ ...names, code: 'SHIFT', shift_based: true, start_time: '08:00' })), 'REQUIRED_FIELD');
  assert.equal(validateAttendanceType({ ...names, code: 'SHIFT', shift_based: true }).start_time, null, 'a shift type may leave its times to the roster');
  assert.equal(code(() => validateAttendanceType({ ...names, code: 'OFFICE', start_time: '08:00' })), 'REQUIRED_FIELD');
  assert.equal(code(() => validateAttendanceType({ ...names, code: 'OFFICE', start_time: '25:00', end_time: '17:00' })), 'INVALID_TIME');
  assert.equal(code(() => validateAttendanceType({ ...names, code: 'OFFICE', start_time: '09:00', end_time: '09:00' })), 'INVALID_TIME');
  assert.equal(code(() => validateAttendanceType({ ...names, code: 'OFFICE', late_allowance_minutes: 500 })), 'INVALID_NUMBER');
  assert.deepEqual(validateAttendanceType({ ...names, code: 'REMOTE' }), { code: 'REMOTE', ...names, shift_based: 0, start_time: null, end_time: null, late_allowance_minutes: 0, status: 'active' });
});

test('saving creates a record with an audit row; duplicate names and stale edits are refused', async () => {
  const db = fakeDb();
  await saveHrSetting(db, 'attendanceTypes', { ...names, code: 'office' }, 7);
  assert.ok(db.statements.some(s => s.sql.startsWith('INSERT INTO attendance_types') && s.params.includes('OFFICE')));
  assert.ok(db.statements.some(s => s.sql.startsWith('INSERT INTO audit_logs') && s.params[0] === 7 && s.params[1] === 'hr_settings_created'));
  await assert.rejects(saveHrSetting(fakeDb({ clash: { id: 3, name_en: 'Name', name_ar: 'اسم' } }), 'medicalPlans', { ...names, provider: 'Bupa', coverage_type: 'basic', max_coverage: 1, employee_contribution: 0, company_contribution: 100 }, 7), error => error.issue.code === 'DUPLICATE_NAME');
  const before = { id: 5, ...names, status: 'active', version: '1791100263758' };
  await assert.rejects(saveHrSetting(fakeDb({ before }), 'documentTypes', { ...before, version: 1791100263000 }, 7), error => error.issue.code === 'STALE_RECORD');
  await assert.rejects(saveHrSetting(fakeDb(), 'payroll', {}, 7), error => error.issue.code === 'INVALID_ENTITY');
});

test('an overlapping deduction rule is refused on save', async () => {
  const db = fakeDb({ rows: { deduction_rules: [{ id: 1, rule_type: 'absence', min_minutes: 0, max_minutes: null, status: 'active', name_en: 'Absence', name_ar: 'غياب' }] } });
  await assert.rejects(saveHrSetting(db, 'deductionRules', { ...names, rule_type: 'absence', min_minutes: 10, deduction_type: 'days_of_wage', value: 1 }, 7), error => error.issue.code === 'RANGE_OVERLAP');
});

test('a document type is generated a code on create but keeps its code on update', async () => {
  const create = fakeDb({ rows: { document_categories: [{ code: 'driving_license' }] } });
  await saveHrSetting(create, 'documentTypes', { name_en: 'Driving License', name_ar: 'رخصة القيادة' }, 7);
  assert.ok(create.statements.some(s => s.sql.startsWith('INSERT INTO document_categories') && s.params.includes('driving_license_2')));
  const update = fakeDb({ before: { id: 1, code: 'passport', status: 'active' } });
  await saveHrSetting(update, 'documentTypes', { id: 1, name_en: 'Passport', name_ar: 'جواز السفر' }, 7);
  const sql = update.statements.find(s => s.sql.startsWith('UPDATE document_categories')).sql;
  assert.ok(!sql.includes('code='), 'code is never rewritten');
});

test('a document type used by documents cannot be deleted; unused records delete with an audit row', async () => {
  await assert.rejects(deleteHrSetting(fakeDb({ before: { id: 1, code: 'passport', status: 'active' }, used: 3 }), 'documentTypes', 1, 7), error => error.issue.code === 'IN_USE' && error.issue.status === 409);
  const db = fakeDb({ before: { id: 4, code: 'OFFICE', status: 'active' } });
  await deleteHrSetting(db, 'attendanceTypes', 4, 7);
  assert.ok(db.statements.some(s => s.sql === 'DELETE FROM attendance_types WHERE id=?' && s.params[0] === 4));
  assert.ok(db.statements.some(s => s.sql.startsWith('INSERT INTO audit_logs') && s.params[1] === 'hr_settings_deleted'));
  await assert.rejects(deleteHrSetting(fakeDb(), 'medicalPlans', 9, 7), error => error.issue.code === 'NOT_FOUND');
});

test('the API requires whole-company HR scope, Settings view to read and manage_settings to write', () => {
  const route = fs.readFileSync(new URL('../app/api/hr-settings/route.ts', import.meta.url), 'utf8');
  const [get, post] = route.split('export async function POST');
  assert.match(get, /seesWholeCompany\(actor\)/);
  assert.match(get, /requireModule\(db, actor, 'system_settings', 'view'\)/);
  assert.match(post, /enforceWriteOrigin\(request\)/);
  assert.match(post, /seesWholeCompany\(actor\)/);
  assert.match(post, /requireModule\(db, actor, 'system_settings', 'manage_settings'\)/);
  assert.ok(post.indexOf('manage_settings') < post.indexOf('db.transaction'), 'permission is checked before any write');
});

test('HR sidebar page shows catalogs and responsibility only to Settings viewers with whole-company scope', () => {
  const app = fs.readFileSync(new URL('../app/hr-app.tsx', import.meta.url), 'utf8');
  assert.match(app, /visiblePage === "hr_settings" && <HrSettingsPage/);
  assert.match(app, /canView=Boolean\(data\)&&access\.canView&&data\?\.hrDataScope!=="assigned"/);
  assert.match(app, /canView&&<HrSettings/);
  assert.match(app, /hrResponsibility=\{/);
  assert.match(app, /<HrResponsibilitySettings/);
  const shell = fs.readFileSync(new URL('../app/hr-settings.tsx', import.meta.url), 'utf8');
  for (const section of ['DocumentTypesSection', 'DeductionRulesSection', 'MedicalPlansSection', 'AttendanceTypesSection']) assert.match(shell, new RegExp(`<${section} `));
});
