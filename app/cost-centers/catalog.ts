import type { TransactionDatabase } from '../../db/postgres';
import type { Row } from '../ui-types';

/**
 * Payroll cost centers. Each one carries the debit account payroll posts to, so an employee only picks the cost center
 * and the account follows. Validation is pure (shared by the API and the tests); a cost center used by employees can
 * be deactivated but never deleted.
 */
export type CostCenterIssue = { code: string; field: string | null; message_ar: string; message_en: string; status?: number };
export class CostCenterError extends Error {
  issue: CostCenterIssue;
  constructor(issue: CostCenterIssue) { super(issue.message_en); this.name = 'CostCenterError'; this.issue = issue; }
}
const fail = (code: string, field: string | null, ar: string, en: string, status = 400): never => { throw new CostCenterError({ code, field, message_ar: ar, message_en: en, status }); };

const text = (value: unknown) => String(value ?? '').trim();
const COLUMNS = 'id,code,name_en,name_ar,debit_account,company_id,description,status,floor(extract(epoch FROM updated_at)*1000)::bigint AS version';

export function validateCostCenter(input: Row) {
  const code = text(input.code).toUpperCase();
  if (!code) fail('REQUIRED_FIELD', 'code', 'رمز مركز التكلفة مطلوب', 'Cost center code is required');
  if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(code)) fail('INVALID_CODE', 'code', 'الرمز: حروف إنجليزية وأرقام و- أو _ فقط (حتى 20 حرفًا)', 'Code: English letters, digits, - or _ only (up to 20 characters)');
  const name_en = text(input.name_en), name_ar = text(input.name_ar);
  if (!name_en) fail('REQUIRED_FIELD', 'name_en', 'الاسم بالإنجليزية مطلوب', 'English name is required');
  if (!name_ar) fail('REQUIRED_FIELD', 'name_ar', 'الاسم بالعربية مطلوب', 'Arabic name is required');
  if (name_en.length > 200 || name_ar.length > 200) fail('TOO_LONG', null, 'الاسم طويل جدًا', 'Name is too long');
  // The debit account is optional: a cost center can exist before finance assigns its account.
  const debit_account = text(input.debit_account) || null;
  if (debit_account && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/.test(debit_account)) fail('INVALID_ACCOUNT', 'debit_account', 'رقم الحساب: أرقام أو حروف إنجليزية فقط (حتى 30 خانة)', 'Account number: digits or English letters only (up to 30 characters)');
  const description = text(input.description);
  if (description.length > 1000) fail('TOO_LONG', 'description', 'الوصف طويل جدًا', 'Description is too long');
  const status = text(input.status) || 'active';
  if (!['active', 'inactive'].includes(status)) fail('INVALID_STATUS', 'status', 'حالة غير صالحة', 'Invalid status');
  const company_id = text(input.company_id) ? Number(input.company_id) : null;
  if (company_id !== null && !(Number.isInteger(company_id) && company_id > 0)) fail('INVALID_SELECTION', 'company_id', 'الشركة: اختيار غير صالح', 'Company: invalid selection');
  return { code, name_en, name_ar, debit_account, company_id, description: description || null, status };
}

type Db = Pick<TransactionDatabase, 'prepare'>;
const all = async (db: Db, sql: string, ...args: unknown[]) => ((await db.prepare(sql).bind(...args).all()).results ?? []) as Row[];

export async function readCostCenters(db: Db) {
  const [costCenters, companies, members] = await Promise.all([
    all(db, `SELECT ${COLUMNS},(SELECT COUNT(*)::int FROM employees e WHERE e.cost_center_id=cost_centers.id AND e.employment_status<>'deleted') AS employees FROM cost_centers ORDER BY code,id`),
    all(db, "SELECT id,name_en,name_ar FROM companies ORDER BY name_en,id"),
    // The current employees of every cost center, listed when HR opens one.
    all(db, `SELECT e.id,e.cost_center_id,e.employee_code,e.name_en,e.name_ar,e.employment_status,co.name_en AS company_en,co.name_ar AS company_ar,d.name_en AS department_en,d.name_ar AS department_ar,j.name_en AS job_title_en,j.name_ar AS job_title_ar
      FROM employees e LEFT JOIN companies co ON co.id=e.company_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles j ON j.id=e.job_title_id
      WHERE e.cost_center_id IS NOT NULL AND e.employment_status<>'deleted' ORDER BY e.employee_code,e.id`),
  ]);
  return { costCenters, companies, members };
}

async function audit(db: Db, actorId: number | null, action: string, id: unknown, before: Row | null, after: Row | null) {
  await db.prepare('INSERT INTO audit_logs (user_id,action,module,record_type,record_id,previous_value,new_value,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)')
    .bind(actorId, action, 'payroll', 'cost_centers', String(id), before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null).run();
}

/** Create (no id) or update one cost center inside the caller's transaction, with an audit row. */
export async function saveCostCenter(db: Db, input: Row, actorId: number | null) {
  await db.prepare('SELECT pg_advisory_xact_lock(78251)').run();
  const id = Number(input.id) || null;
  const before = id ? await db.prepare(`SELECT ${COLUMNS} FROM cost_centers WHERE id=? FOR UPDATE`).bind(id).first<Row>() : null;
  if (id && !before) fail('NOT_FOUND', 'id', 'مركز التكلفة غير موجود', 'Cost center not found', 404);
  if (before && input.version !== undefined && input.version !== null && Number(before.version) !== Number(input.version))
    fail('STALE_RECORD', null, 'عدّل مستخدم آخر هذا السجل؛ أعد فتحه وحاول مرة أخرى', 'Someone else changed this record; reopen it and try again', 409);
  const values = validateCostCenter(input);
  const clash = await db.prepare('SELECT id FROM cost_centers WHERE id<>? AND upper(code)=? LIMIT 1').bind(id ?? 0, values.code).first();
  if (clash) fail('DUPLICATE_CODE', 'code', 'رمز مركز التكلفة مستخدم لمركز آخر', 'This code is already used by another cost center', 409);
  if (values.company_id !== null && !(await db.prepare('SELECT id FROM companies WHERE id=?').bind(values.company_id).first())) fail('INVALID_SELECTION', 'company_id', 'الشركة غير موجودة', 'Company not found');
  const keys = Object.keys(values) as (keyof typeof values)[];
  const saved = id
    ? await db.prepare(`UPDATE cost_centers SET ${keys.map(key => `${key}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING ${COLUMNS}`).bind(...keys.map(key => values[key]), id).first<Row>()
    : await db.prepare(`INSERT INTO cost_centers (${keys.join(',')},created_at,updated_at) VALUES (${keys.map(() => '?').join(',')},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING ${COLUMNS}`).bind(...keys.map(key => values[key])).first<Row>();
  await audit(db, actorId, id ? 'cost_center_updated' : 'cost_center_created', saved!.id, before, values);
  return saved!;
}

export async function deleteCostCenter(db: Db, idValue: unknown, actorId: number) {
  await db.prepare('SELECT pg_advisory_xact_lock(78251)').run();
  const id = Number(idValue);
  const before = id ? await db.prepare(`SELECT ${COLUMNS} FROM cost_centers WHERE id=? FOR UPDATE`).bind(id).first<Row>() : null;
  if (!before) fail('NOT_FOUND', 'id', 'مركز التكلفة غير موجود', 'Cost center not found', 404);
  const used = await db.prepare("SELECT COUNT(*)::int AS count FROM employees WHERE cost_center_id=?").bind(id).first<{ count: number }>();
  if (Number(used?.count)) fail('IN_USE', null, `مركز التكلفة مستخدم لدى ${used!.count} موظف؛ عطّله بدلًا من حذفه`, `This cost center is used by ${used!.count} employee(s); deactivate it instead`, 409);
  await db.prepare('DELETE FROM cost_centers WHERE id=?').bind(id).run();
  await audit(db, actorId, 'cost_center_deleted', id, before, null);
  return { id };
}

/**
 * An employee's cost center must exist and be active (an unchanged inactive one is allowed so old assignments still save).
 * Returns the id to store, or null to clear it.
 */
export async function resolveEmployeeCostCenter(db: Db, value: unknown, currentId: unknown = null): Promise<number | null> {
  if (value === null || value === undefined || text(value) === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Response('Invalid cost center', { status: 400 });
  const row = await db.prepare('SELECT id,status FROM cost_centers WHERE id=?').bind(id).first<{ id: number; status: string }>();
  if (!row) throw new Response('Cost center not found', { status: 400 });
  if (row.status !== 'active' && Number(currentId) !== id) throw new Response('Cost center is inactive', { status: 400 });
  return id;
}
