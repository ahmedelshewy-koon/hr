import type { TransactionDatabase } from '../../db/postgres';
import type { Row } from '../ui-types';

/**
 * Settings → HR Settings: four independent catalogs (document types, deduction & overtime rules, medical insurance
 * plans, attendance types). Validation is pure and shared by the API and the tests; the same rules run on every save.
 * Document types are the live `document_categories` catalog used by employee documents; the others are stand-alone.
 */
export type HrSettingsEntity = 'documentTypes' | 'deductionRules' | 'medicalPlans' | 'attendanceTypes';
export const HR_SETTINGS_ENTITIES: HrSettingsEntity[] = ['documentTypes', 'deductionRules', 'medicalPlans', 'attendanceTypes'];
export const RULE_TYPES = ['absence', 'late_arrival', 'overtime'] as const;
export const DEDUCTION_TYPES = ['fixed_amount', 'daily_wage_percent', 'days_of_wage'] as const;
export const ABSENCE_NOTICE = ['with_notice', 'without_notice'] as const;
export const COVERAGE_TYPES = ['basic', 'standard', 'premium', 'vip'] as const;
export const CURRENCIES = ['SAR', 'EGP'] as const;
const STATUSES = ['active', 'inactive'];
const MAX_MINUTES = 1440;

export type HrSettingsIssue = { code: string; field: string | null; message_ar: string; message_en: string; status?: number };
export class HrSettingsError extends Error {
  issue: HrSettingsIssue;
  constructor(issue: HrSettingsIssue) { super(issue.message_en); this.name = 'HrSettingsError'; this.issue = issue; }
}
const fail = (code: string, field: string | null, ar: string, en: string, status = 400): never => { throw new HrSettingsError({ code, field, message_ar: ar, message_en: en, status }); };

const text = (value: unknown) => String(value ?? '').trim();
const optionalText = (value: unknown, field: string, max: number) => {
  const result = text(value);
  if (result.length > max) fail('TOO_LONG', field, 'القيمة طويلة جدًا', 'Value is too long');
  return result || null;
};
const flag = (value: unknown) => (value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0);
const status = (value: unknown) => {
  const result = text(value) || 'active';
  if (!STATUSES.includes(result)) fail('INVALID_STATUS', 'status', 'حالة غير صالحة', 'Invalid status');
  return result;
};
function names(input: Row) {
  const name_en = text(input.name_en), name_ar = text(input.name_ar);
  if (!name_en) fail('REQUIRED_FIELD', 'name_en', 'الاسم بالإنجليزية مطلوب', 'English name is required');
  if (!name_ar) fail('REQUIRED_FIELD', 'name_ar', 'الاسم بالعربية مطلوب', 'Arabic name is required');
  if (name_en.length > 200 || name_ar.length > 200) fail('TOO_LONG', null, 'الاسم طويل جدًا', 'Name is too long');
  return { name_en, name_ar };
}
/** Optional number within [min, max]; '' and null mean "not set". */
function number(value: unknown, field: string, label: [string, string], min: number, max: number, integer = false): number | null {
  if (value === null || value === undefined || text(value) === '') return null;
  const result = Number(value);
  if (!Number.isFinite(result) || (integer && !Number.isInteger(result)) || result < min || result > max)
    fail('INVALID_NUMBER', field, `${label[0]}: أدخل رقمًا بين ${min} و${max}`, `${label[1]}: enter a number between ${min} and ${max}`);
  return result;
}
function required<T>(value: T | null, field: string, label: [string, string]): T {
  if (value === null) fail('REQUIRED_FIELD', field, `${label[0]} مطلوب`, `${label[1]} is required`);
  return value as T;
}
const oneOf = <T extends string>(value: unknown, list: readonly T[], field: string, label: [string, string]): T => {
  const result = text(value) as T;
  if (!list.includes(result)) fail('INVALID_SELECTION', field, `${label[0]}: اختيار غير صالح`, `${label[1]}: invalid selection`);
  return result;
};

/* ------------------------------------------------------------------ pure validation */

export function validateDocumentType(input: Row) {
  return { ...names(input), required_document: flag(input.required_document), status: status(input.status), description: optionalText(input.description, 'description', 1000) };
}

export function validateDeductionRule(input: Row) {
  const rule_type = oneOf(input.rule_type, RULE_TYPES, 'rule_type', ['نوع القاعدة', 'Rule type']);
  const start = number(input.min_minutes, 'min_minutes', ['من (دقيقة)', 'From (minutes)'], 0, MAX_MINUTES, true);
  const min_minutes = rule_type === 'late_arrival' ? required(start, 'min_minutes', ['بداية النطاق', 'Range start']) : start;
  const max_minutes = number(input.max_minutes, 'max_minutes', ['إلى (دقيقة)', 'To (minutes)'], 0, MAX_MINUTES, true);
  if (max_minutes !== null && (min_minutes === null || max_minutes < min_minutes)) fail('INVALID_RANGE', 'max_minutes', 'نهاية النطاق يجب ألا تقل عن بدايته', 'Range end must not be less than its start');
  const absence_notice = rule_type === 'absence' && text(input.absence_notice)
    ? oneOf(input.absence_notice, ABSENCE_NOTICE, 'absence_notice', ['الإشعار', 'Notice']) : null;
  const base = { ...names(input), rule_type, min_minutes, max_minutes, absence_notice, status: status(input.status) };
  if (rule_type === 'overtime') {
    const overtime_multiplier = required(number(input.overtime_multiplier, 'overtime_multiplier', ['معامل الإضافي', 'Overtime multiplier'], 1, 10), 'overtime_multiplier', ['معامل الإضافي', 'Overtime multiplier']);
    const value = input.deduction_type === 'hourly'
      ? required(number(input.value, 'value', ['عدد الساعات', 'Hours'], 0.01, 24), 'value', ['عدد الساعات', 'Hours']) : 1;
    return { ...base, deduction_type: 'hourly', value, overtime_multiplier };
  }
  const deduction_type = oneOf(input.deduction_type, DEDUCTION_TYPES, 'deduction_type', ['نوع الخصم', 'Deduction type']);
  const max = deduction_type === 'daily_wage_percent' ? (rule_type === 'absence' ? 3100 : 100) : deduction_type === 'days_of_wage' ? 31 : 10_000_000;
  const value = required(number(input.value, 'value', ['القيمة', 'Value'], 0, max), 'value', ['القيمة', 'Value']);
  return { ...base, deduction_type, value, overtime_multiplier: null };
}

/** Inclusive ranges. Distinct absence notices and zero-cost late rules do not conflict. */
export function overlappingRule(rules: Row[], candidate: Row): Row | null {
  if (candidate.status !== 'active') return null;
  const end = (row: Row) => (row.max_minutes === null || row.max_minutes === undefined ? Infinity : Number(row.max_minutes));
  return rules.find(rule => Number(rule.id) !== Number(candidate.id || 0) && rule.status === 'active' && rule.rule_type === candidate.rule_type
    && !(rule.rule_type === 'absence' && rule.absence_notice && candidate.absence_notice && rule.absence_notice !== candidate.absence_notice)
    && !(rule.rule_type === 'late_arrival' && rule.value === 0 && candidate.value === 0)
    && Number(rule.min_minutes) <= end(candidate) && Number(candidate.min_minutes) <= end(rule)) ?? null;
}

export function validateMedicalPlan(input: Row) {
  const provider = text(input.provider);
  if (!provider) fail('REQUIRED_FIELD', 'provider', 'شركة التأمين مطلوبة', 'Insurance provider is required');
  if (provider.length > 200) fail('TOO_LONG', 'provider', 'القيمة طويلة جدًا', 'Value is too long');
  const employee_contribution = required(number(input.employee_contribution, 'employee_contribution', ['مساهمة الموظف', 'Employee contribution'], 0, 100), 'employee_contribution', ['مساهمة الموظف', 'Employee contribution']);
  const company_contribution = required(number(input.company_contribution, 'company_contribution', ['مساهمة الشركة', 'Company contribution'], 0, 100), 'company_contribution', ['مساهمة الشركة', 'Company contribution']);
  if (Math.abs(employee_contribution + company_contribution - 100) > 0.001) fail('CONTRIBUTION_TOTAL', 'company_contribution', 'مجموع مساهمة الموظف والشركة يجب أن يساوي 100٪', 'Employee and company contributions must add up to 100%');
  return {
    ...names(input), provider,
    coverage_type: oneOf(input.coverage_type, COVERAGE_TYPES, 'coverage_type', ['نوع التغطية', 'Coverage type']),
    max_coverage: required(number(input.max_coverage, 'max_coverage', ['الحد الأقصى للتغطية', 'Maximum coverage'], 1, 1_000_000_000), 'max_coverage', ['الحد الأقصى للتغطية', 'Maximum coverage']),
    currency: oneOf(input.currency || 'SAR', CURRENCIES, 'currency', ['العملة', 'Currency']),
    employee_contribution, company_contribution, family_coverage: flag(input.family_coverage),
    description: optionalText(input.description, 'description', 1000), status: status(input.status),
  };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export function validateAttendanceType(input: Row) {
  const code = text(input.code).toUpperCase();
  if (!code) fail('REQUIRED_FIELD', 'code', 'الرمز مطلوب', 'Code is required');
  if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(code)) fail('INVALID_CODE', 'code', 'الرمز: حروف إنجليزية وأرقام و- أو _ فقط (حتى 20 حرفًا)', 'Code: English letters, digits, - or _ only (up to 20 characters)');
  const shift_based = flag(input.shift_based);
  const start_time = text(input.start_time) || null, end_time = text(input.end_time) || null;
  for (const [field, value] of [['start_time', start_time], ['end_time', end_time]] as const)
    if (value && !TIME.test(value)) fail('INVALID_TIME', field, 'أدخل الوقت بصيغة HH:MM', 'Enter the time as HH:MM');
  if (Boolean(start_time) !== Boolean(end_time)) fail('REQUIRED_FIELD', start_time ? 'end_time' : 'start_time', 'أدخل وقتي البداية والنهاية معًا', 'Enter both the start and end time');
  if (start_time && start_time === end_time) fail('INVALID_TIME', 'end_time', 'وقت النهاية يجب أن يختلف عن البداية', 'End time must differ from the start time');
  const late_allowance_minutes = number(input.late_allowance_minutes, 'late_allowance_minutes', ['سماحية التأخير', 'Late allowance'], 0, 240, true) ?? 0;
  return { code, ...names(input), shift_based, start_time, end_time, late_allowance_minutes, status: status(input.status) };
}

const VALIDATORS: Record<HrSettingsEntity, (input: Row) => Row> = { documentTypes: validateDocumentType, deductionRules: validateDeductionRule, medicalPlans: validateMedicalPlan, attendanceTypes: validateAttendanceType };
const TABLES: Record<HrSettingsEntity, string> = { documentTypes: 'document_categories', deductionRules: 'deduction_rules', medicalPlans: 'medical_insurance_plans', attendanceTypes: 'attendance_types' };
/** Optimistic-lock token computed in SQL, so no runtime has to parse Postgres timestamps. */
const VERSION = 'floor(extract(epoch FROM updated_at)*1000)::bigint AS version';
const COLUMNS: Record<HrSettingsEntity, string> = {
  documentTypes: 'id,code,name_en,name_ar,required_document,status,description,' + VERSION,
  deductionRules: 'id,name_en,name_ar,rule_type,min_minutes,max_minutes,deduction_type,value,overtime_multiplier,absence_notice,status,' + VERSION,
  medicalPlans: 'id,name_en,name_ar,provider,coverage_type,max_coverage,currency,employee_contribution,company_contribution,family_coverage,description,status,' + VERSION,
  attendanceTypes: 'id,code,name_en,name_ar,shift_based,start_time,end_time,late_allowance_minutes,status,' + VERSION,
};
export function entityOf(value: unknown): HrSettingsEntity {
  if (!HR_SETTINGS_ENTITIES.includes(value as HrSettingsEntity)) fail('INVALID_ENTITY', null, 'نوع الإعداد غير معروف', 'Unknown settings type');
  return value as HrSettingsEntity;
}

/** Stable machine code for a new document type, derived from its English name; documents reference it forever. */
export function documentTypeCode(nameEn: string, taken: Set<string>): string {
  const base = nameEn.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'document_type';
  let code = base;
  for (let n = 2; taken.has(code); n++) code = `${base}_${n}`;
  return code;
}

/* ------------------------------------------------------------------ persistence */

type Db = Pick<TransactionDatabase, 'prepare'>;
const all = async (db: Db, sql: string, ...args: unknown[]) => ((await db.prepare(sql).bind(...args).all()).results ?? []) as Row[];

export async function readHrSettings(db: Db) {
  const [documentTypes, deductionRules, medicalPlans, attendanceTypes, documentUsage] = await Promise.all([
    all(db, `SELECT ${COLUMNS.documentTypes} FROM document_categories WHERE status<>'deleted' ORDER BY name_en,id`),
    all(db, `SELECT ${COLUMNS.deductionRules} FROM deduction_rules ORDER BY id`),
    all(db, `SELECT ${COLUMNS.medicalPlans} FROM medical_insurance_plans ORDER BY name_en,id`),
    all(db, `SELECT ${COLUMNS.attendanceTypes} FROM attendance_types ORDER BY code,id`),
    all(db, 'SELECT category AS code,COUNT(*)::int AS documents FROM documents GROUP BY category'),
  ]);
  const usage = Object.fromEntries(documentUsage.map(row => [String(row.code), Number(row.documents)]));
  return { documentTypes: documentTypes.map(row => ({ ...row, documents: usage[String(row.code)] ?? 0 })), deductionRules, medicalPlans, attendanceTypes };
}

async function audit(db: Db, actorId: number | null, action: string, entity: HrSettingsEntity, id: unknown, before: Row | null, after: Row | null) {
  await db.prepare('INSERT INTO audit_logs (user_id,action,module,record_type,record_id,previous_value,new_value,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)')
    .bind(actorId, action, 'hr_settings', TABLES[entity], String(id), before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null).run();
}

async function assertUniqueNames(db: Db, entity: HrSettingsEntity, values: Row, id: number | null) {
  const table = TABLES[entity];
  const clash = await db.prepare(`SELECT id,name_en,name_ar FROM ${table} WHERE id<>? AND ${entity === 'documentTypes' ? "status<>'deleted' AND " : ''}(lower(btrim(name_en))=lower(?) OR btrim(name_ar)=?) LIMIT 1`)
    .bind(id ?? 0, values.name_en, values.name_ar).first<Row>();
  if (clash) fail('DUPLICATE_NAME', String(clash.name_ar).trim() === values.name_ar ? 'name_ar' : 'name_en', 'يوجد سجل بالاسم نفسه', 'A record with the same name already exists', 409);
}

/** Create (no id) or update one record inside the caller's transaction, with an audit row. */
export async function saveHrSetting(db: Db, entityName: unknown, input: Row, actorId: number | null) {
  const entity = entityOf(entityName);
  await db.prepare('SELECT pg_advisory_xact_lock(78241)').run();
  const table = TABLES[entity];
  const id = Number(input.id) || null;
  const before = id ? await db.prepare(`SELECT ${COLUMNS[entity]} FROM ${table} WHERE id=? FOR UPDATE`).bind(id).first<Row>() : null;
  if (id && (!before || before.status === 'deleted')) fail('NOT_FOUND', 'id', 'السجل غير موجود', 'Record not found', 404);
  if (before && input.version !== undefined && input.version !== null && Number(before.version) !== Number(input.version))
    fail('STALE_RECORD', null, 'عدّل مستخدم آخر هذا السجل؛ أعد فتحه وحاول مرة أخرى', 'Someone else changed this record; reopen it and try again', 409);
  const values = VALIDATORS[entity](input);
  await assertUniqueNames(db, entity, values, id);
  if (entity === 'deductionRules') {
    const overlap = overlappingRule(await all(db, 'SELECT id,rule_type,min_minutes,max_minutes,absence_notice,value,status,name_en,name_ar FROM deduction_rules'), { ...values, id });
    if (overlap) fail('RANGE_OVERLAP', 'min_minutes', `نطاق الدقائق يتداخل مع قاعدة نشطة أخرى من النوع نفسه (${overlap.name_ar})`, `The minute range overlaps another active rule of the same type (${overlap.name_en})`, 409);
  }
  if (entity === 'attendanceTypes') {
    const clash = await db.prepare('SELECT id FROM attendance_types WHERE id<>? AND upper(code)=? LIMIT 1').bind(id ?? 0, values.code).first();
    if (clash) fail('DUPLICATE_CODE', 'code', 'الرمز مستخدم لنوع حضور آخر', 'This code is already used by another attendance type', 409);
  }
  if (entity === 'documentTypes' && !id) {
    const taken = new Set((await all(db, 'SELECT code FROM document_categories')).map(row => String(row.code)));
    values.code = documentTypeCode(String(values.name_en), taken);
  }
  const keys = Object.keys(values);
  const saved = id
    ? await db.prepare(`UPDATE ${table} SET ${keys.map(key => `${key}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING ${COLUMNS[entity]}`).bind(...keys.map(key => values[key]), id).first<Row>()
    : await db.prepare(`INSERT INTO ${table} (${keys.join(',')},created_at,updated_at) VALUES (${keys.map(() => '?').join(',')},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING ${COLUMNS[entity]}`).bind(...keys.map(key => values[key])).first<Row>();
  await audit(db, actorId, id ? 'hr_settings_updated' : 'hr_settings_created', entity, saved!.id, before, values);
  return saved!;
}

/** Permanent delete. A document type that employee documents still use can only be deactivated. */
export async function deleteHrSetting(db: Db, entityName: unknown, idValue: unknown, actorId: number) {
  const entity = entityOf(entityName);
  await db.prepare('SELECT pg_advisory_xact_lock(78241)').run();
  const id = Number(idValue);
  const before = id ? await db.prepare(`SELECT ${COLUMNS[entity]} FROM ${TABLES[entity]} WHERE id=? FOR UPDATE`).bind(id).first<Row>() : null;
  if (!before || before.status === 'deleted') fail('NOT_FOUND', 'id', 'السجل غير موجود', 'Record not found', 404);
  if (entity === 'documentTypes') {
    const used = await db.prepare('SELECT COUNT(*)::int AS count FROM documents WHERE category=?').bind(before!.code).first<{ count: number }>();
    if (Number(used?.count)) fail('IN_USE', null, `نوع المستند مستخدم في ${used!.count} مستند؛ عطّله بدلًا من حذفه`, `This document type is used by ${used!.count} document(s); deactivate it instead`, 409);
  }
  await db.prepare(`DELETE FROM ${TABLES[entity]} WHERE id=?`).bind(id).run();
  await audit(db, actorId, 'hr_settings_deleted', entity, id, before, null);
  return { id };
}
