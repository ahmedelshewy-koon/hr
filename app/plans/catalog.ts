import type { TransactionDatabase } from '../../db/postgres';
import type { Row } from '../ui-types';

/**
 * System subscription plans (باقات النظام). Super Admin manages them on the Plans page; the active ones flagged
 * "show on landing" are served publicly to the landing page. Validation is pure so the API and tests share it.
 */
export type PlanIssue = { code: string; field: string | null; message_ar: string; message_en: string; status?: number };
export class PlanError extends Error {
  issue: PlanIssue;
  constructor(issue: PlanIssue) { super(issue.message_en); this.name = 'PlanError'; this.issue = issue; }
}
const fail = (code: string, field: string | null, ar: string, en: string, status = 400): never => { throw new PlanError({ code, field, message_ar: ar, message_en: en, status }); };

export const PLAN_CURRENCIES = ['SAR', 'EGP', 'AED', 'USD', 'EUR'] as const;
const text = (value: unknown) => String(value ?? '').trim();
const flag = (value: unknown) => (value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0);
const COLUMNS = 'id,code,name_ar,name_en,description_ar,description_en,features_ar,features_en,price,currency,duration_months,max_employees,is_featured,show_on_landing,sort_order,status,floor(extract(epoch FROM updated_at)*1000)::bigint AS version';
/** What the landing page may see: no internal columns. */
const PUBLIC_COLUMNS = 'id,code,name_ar,name_en,description_ar,description_en,features_ar,features_en,price,currency,duration_months,max_employees,is_featured';

function optionalInt(value: unknown, field: string, ar: string, en: string, min: number, max: number) {
  if (text(value) === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) fail('INVALID_NUMBER', field, ar, en);
  return number;
}

export function validatePlan(input: Row) {
  const code = text(input.code).toUpperCase();
  if (!code) fail('REQUIRED_FIELD', 'code', 'رمز الباقة مطلوب', 'Plan code is required');
  if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(code)) fail('INVALID_CODE', 'code', 'الرمز: حروف إنجليزية وأرقام و- أو _ فقط (حتى 20 حرفًا)', 'Code: English letters, digits, - or _ only (up to 20 characters)');
  const name_ar = text(input.name_ar), name_en = text(input.name_en);
  if (!name_ar) fail('REQUIRED_FIELD', 'name_ar', 'اسم الباقة بالعربية مطلوب', 'Arabic name is required');
  if (!name_en) fail('REQUIRED_FIELD', 'name_en', 'اسم الباقة بالإنجليزية مطلوب', 'English name is required');
  if (name_ar.length > 120 || name_en.length > 120) fail('TOO_LONG', null, 'الاسم طويل جدًا', 'Name is too long');
  const description_ar = text(input.description_ar), description_en = text(input.description_en);
  const features_ar = text(input.features_ar), features_en = text(input.features_en);
  if (description_ar.length > 1000 || description_en.length > 1000) fail('TOO_LONG', 'description_ar', 'الشرح طويل جدًا (حتى 1000 حرف)', 'Description is too long (up to 1000 characters)');
  if (features_ar.length > 3000 || features_en.length > 3000) fail('TOO_LONG', 'features_ar', 'قائمة المزايا طويلة جدًا', 'Features list is too long');
  // A blank price means "contact us" on the landing page.
  let price: number | null = null;
  if (text(input.price) !== '') {
    price = Number(input.price);
    if (!Number.isFinite(price) || price < 0 || price > 100_000_000) fail('INVALID_PRICE', 'price', 'السعر غير صالح', 'Invalid price');
    price = Math.round(price * 100) / 100;
  }
  const currency = text(input.currency).toUpperCase() || 'SAR';
  if (!(PLAN_CURRENCIES as readonly string[]).includes(currency)) fail('INVALID_CURRENCY', 'currency', 'العملة غير مدعومة', 'Unsupported currency');
  const duration_months = optionalInt(input.duration_months, 'duration_months', 'المدة بالأشهر: رقم صحيح من 1 إلى 120', 'Duration: whole months from 1 to 120', 1, 120);
  if (duration_months === null) fail('REQUIRED_FIELD', 'duration_months', 'مدة الباقة مطلوبة', 'Plan duration is required');
  const max_employees = optionalInt(input.max_employees, 'max_employees', 'الحد الأقصى للموظفين: رقم صحيح موجب', 'Max employees: a positive whole number', 1, 1_000_000);
  const sort_order = optionalInt(input.sort_order, 'sort_order', 'الترتيب: رقم صحيح', 'Order: a whole number', 0, 9999) ?? 0;
  const status = text(input.status) || 'active';
  if (!['active', 'inactive'].includes(status)) fail('INVALID_STATUS', 'status', 'حالة غير صالحة', 'Invalid status');
  return {
    code, name_ar, name_en, description_ar: description_ar || null, description_en: description_en || null,
    features_ar: features_ar || null, features_en: features_en || null, price, currency, duration_months, max_employees,
    is_featured: flag(input.is_featured), show_on_landing: flag(input.show_on_landing), sort_order, status,
  };
}

type Db = Pick<TransactionDatabase, 'prepare'>;
const all = async (db: Db, sql: string, ...args: unknown[]) => ((await db.prepare(sql).bind(...args).all()).results ?? []) as Row[];

export const readPlans = (db: Db) => all(db, `SELECT ${COLUMNS} FROM subscription_plans ORDER BY sort_order,id`);
export const readPublicPlans = (db: Db) => all(db, `SELECT ${PUBLIC_COLUMNS} FROM subscription_plans WHERE status='active' AND show_on_landing=1 ORDER BY sort_order,id`);

async function audit(db: Db, actorId: number | null, action: string, id: unknown, before: Row | null, after: Row | null) {
  await db.prepare('INSERT INTO audit_logs (user_id,action,module,record_type,record_id,previous_value,new_value,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)')
    .bind(actorId, action, 'system_settings', 'subscription_plans', String(id), before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null).run();
}

/** Create (no id) or update one plan inside the caller's transaction, with an audit row. */
export async function savePlan(db: Db, input: Row, actorId: number | null) {
  await db.prepare('SELECT pg_advisory_xact_lock(78252)').run();
  const id = Number(input.id) || null;
  const before = id ? await db.prepare(`SELECT ${COLUMNS} FROM subscription_plans WHERE id=? FOR UPDATE`).bind(id).first<Row>() : null;
  if (id && !before) fail('NOT_FOUND', 'id', 'الباقة غير موجودة', 'Plan not found', 404);
  if (before && input.version !== undefined && input.version !== null && Number(before.version) !== Number(input.version))
    fail('STALE_RECORD', null, 'عدّل مستخدم آخر هذه الباقة؛ أعد فتحها وحاول مرة أخرى', 'Someone else changed this plan; reopen it and try again', 409);
  const values = validatePlan(input);
  const clash = await db.prepare('SELECT id FROM subscription_plans WHERE id<>? AND upper(code)=? LIMIT 1').bind(id ?? 0, values.code).first();
  if (clash) fail('DUPLICATE_CODE', 'code', 'رمز الباقة مستخدم لباقة أخرى', 'This code is already used by another plan', 409);
  const keys = Object.keys(values) as (keyof typeof values)[];
  const saved = id
    ? await db.prepare(`UPDATE subscription_plans SET ${keys.map(key => `${key}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING ${COLUMNS}`).bind(...keys.map(key => values[key]), id).first<Row>()
    : await db.prepare(`INSERT INTO subscription_plans (${keys.join(',')},created_at,updated_at) VALUES (${keys.map(() => '?').join(',')},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING ${COLUMNS}`).bind(...keys.map(key => values[key])).first<Row>();
  await audit(db, actorId, id ? 'subscription_plan_updated' : 'subscription_plan_created', saved!.id, before, values);
  return saved!;
}

export async function deletePlan(db: Db, idValue: unknown, actorId: number) {
  await db.prepare('SELECT pg_advisory_xact_lock(78252)').run();
  const id = Number(idValue);
  const before = id ? await db.prepare(`SELECT ${COLUMNS} FROM subscription_plans WHERE id=? FOR UPDATE`).bind(id).first<Row>() : null;
  if (!before) fail('NOT_FOUND', 'id', 'الباقة غير موجودة', 'Plan not found', 404);
  await db.prepare('DELETE FROM subscription_plans WHERE id=?').bind(id).run();
  await audit(db, actorId, 'subscription_plan_deleted', id, before, null);
  return { id };
}
