import type { TransactionDatabase } from '../../db/postgres';
import { MANAGED_DEPARTMENTS_CTE } from '../organization/department-scope.ts';
import { branchHrEmployeeSql, isBranchScopedHr, type ScopeActor } from '../employees/hr-data-scope.ts';

/**
 * Administrative decisions (القرارات الإدارية): HR or a department head sends a decision to an exact list of employees.
 * Each recipient sees it as a blocking prompt on sign-in/refresh until they acknowledge it; acknowledgements appear in
 * the employee profile. The recipient list is frozen when the decision is sent.
 */
type Row = Record<string, unknown>;
type Db = Pick<TransactionDatabase, 'prepare'>;
export type DecisionActor = ScopeActor & { id: number };
export const DECISION_TYPES = ['administrative_decision', 'circular', 'policy'] as const;
export const CURRENT = "('active','probation','notice_period')";
const MAX_RECIPIENTS = 2000;

const fail = (ar: string, en: string, status = 400): never => { throw new Response(`${ar} / ${en}`, { status }); };
const text = (value: unknown) => String(value ?? '').trim();

export function validateDecision(input: Row) {
  const title = text(input.title), body = text(input.body), type = text(input.decisionType) || 'administrative_decision', effective = text(input.effectiveDate);
  if (!title || title.length > 200) fail('عنوان القرار مطلوب (حتى 200 حرف)', 'Decision title is required (up to 200 characters)');
  if (!body || body.length > 10000) fail('نص القرار مطلوب (حتى 10000 حرف)', 'Decision text is required (up to 10,000 characters)');
  if (!(DECISION_TYPES as readonly string[]).includes(type)) fail('نوع القرار غير صالح', 'Invalid decision type');
  if (effective && !/^\d{4}-\d{2}-\d{2}$/.test(effective)) fail('تاريخ السريان غير صالح', 'Invalid effective date');
  const ids = Array.isArray(input.employeeIds) ? [...new Set(input.employeeIds.map(Number))] : [];
  if (!ids.length) fail('اختر موظفًا واحدًا على الأقل', 'Select at least one employee');
  if (ids.length > MAX_RECIPIENTS) fail(`الحد الأقصى ${MAX_RECIPIENTS} موظف في القرار الواحد`, `A decision can have at most ${MAX_RECIPIENTS} recipients`);
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) fail('قائمة الموظفين غير صالحة', 'Invalid employee list');
  return { title, body, decisionType: type, effectiveDate: effective || null, employeeIds: ids };
}

/** Whole-company senders: Super Admin, or an HR Manager not limited to a branch. */
export const seesAllDecisions = (actor: DecisionActor) => actor.roleName === 'Super Admin' || (actor.roleName === 'HR Manager' && !isBranchScopedHr(actor));

/**
 * The employees this actor may send a decision to (current employees, never the sender):
 * whole-company HR → everyone; branch HR → the employees it is responsible for;
 * department head → employees of the departments/sections they manage plus their direct reports.
 */
export async function audienceIds(db: Db, actor: DecisionActor): Promise<number[]> {
  const self = Number(actor.employeeId) || 0;
  let rows: Row[] = [];
  if (seesAllDecisions(actor)) rows = (await db.prepare(`SELECT id FROM employees WHERE employment_status IN ${CURRENT} AND id<>?`).bind(self).all()).results as Row[];
  else if (actor.roleName === 'HR Manager') {
    const predicate = await branchHrEmployeeSql(db as never, actor);
    rows = predicate ? (await db.prepare(`SELECT e.id FROM employees e WHERE e.employment_status IN ${CURRENT} AND e.id<>? AND ${predicate}`).bind(self).all()).results as Row[] : [];
  } else if (actor.roleName === 'Department Manager' && self) {
    rows = (await db.prepare(`${MANAGED_DEPARTMENTS_CTE} SELECT e.id FROM employees e WHERE e.employment_status IN ${CURRENT} AND e.id<>? AND (e.department_id IN (SELECT id FROM managed) OR e.section_id IN (SELECT id FROM managed) OR e.team_id IN (SELECT id FROM managed) OR e.manager_id=?)`).bind(self, self, self).all()).results as Row[];
  }
  return rows.map(row => Number(row.id));
}

/** Picker data: the reachable employees with their company/branch/department, so the UI can add whole groups. */
export async function readAudience(db: Db, actor: DecisionActor) {
  const ids = await audienceIds(db, actor);
  if (!ids.length) return { employees: [] as Row[] };
  const employees = (await db.prepare(`SELECT e.id,e.employee_code,e.name_en,e.name_ar,e.company_id,e.branch_id,e.department_id,co.name AS company_name,
      b.name_en AS branch_name,b.name_ar AS branch_name_ar,d.name_en AS department_name,d.name_ar AS department_name_ar,j.name_en AS job_title_name,j.name_ar AS job_title_name_ar
    FROM employees e LEFT JOIN companies co ON co.id=e.company_id LEFT JOIN branches b ON b.id=e.branch_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles j ON j.id=e.job_title_id
    WHERE e.id=ANY(?::int[]) ORDER BY e.name_en`).bind(`{${ids.join(',')}}`).all()).results as Row[];
  return { employees };
}

export async function createDecision(db: Db, actor: DecisionActor, input: Row) {
  const values = validateDecision(input);
  const allowed = new Set(await audienceIds(db, actor));
  const outside = values.employeeIds.filter(id => !allowed.has(id));
  if (outside.length) fail('بعض الموظفين خارج نطاق صلاحياتك', 'Some employees are outside your scope', 403);
  await db.prepare('SELECT pg_advisory_xact_lock(78251)').run();
  const year = new Date().getUTCFullYear();
  const next = await db.prepare("SELECT COUNT(*)::int + 1 AS n FROM administrative_decisions WHERE decision_number LIKE ?").bind(`DEC-${year}-%`).first<{ n: number }>();
  const number = `DEC-${year}-${String(next?.n ?? 1).padStart(4, '0')}`;
  const decision = await db.prepare('INSERT INTO administrative_decisions (decision_number,decision_type,title,body,effective_date,created_by_user_id) VALUES (?,?,?,?,?,?) RETURNING *')
    .bind(number, values.decisionType, values.title, values.body, values.effectiveDate, actor.id).first<Row>();
  await db.prepare('INSERT INTO administrative_decision_recipients (decision_id,employee_id) SELECT ?,unnest(?::int[]) ON CONFLICT DO NOTHING').bind(decision!.id, `{${values.employeeIds.join(',')}}`).run();
  // A bell notification for each recipient account; the blocking prompt is driven by the recipients table.
  await db.prepare(`INSERT INTO notifications (user_id,type,title_key,message_key,entity_type,entity_id,target_path,dedupe_key,created_at)
    SELECT u.id,'administrative_decision','administrative_decision_received',NULL,'administrative_decision',?,'portal','administrative_decision:'||?,CURRENT_TIMESTAMP
    FROM users u WHERE u.status='active' AND u.employee_id=ANY(?::int[]) ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`).bind(String(decision!.id), String(decision!.id), `{${values.employeeIds.join(',')}}`).run();
  await db.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,new_value,created_at) VALUES (?,'administrative_decision_sent','administrative_decisions','administrative_decision',?,?,CURRENT_TIMESTAMP)")
    .bind(actor.id, String(decision!.id), JSON.stringify({ number, title: values.title, type: values.decisionType, recipients: values.employeeIds.length })).run();
  return { ...decision!, recipients: values.employeeIds.length };
}

const SUMMARY = `SELECT d.*,COALESCE(ce.name_en,u.email) AS created_by_name,COALESCE(ce.name_ar,ce.name_en,u.email) AS created_by_name_ar,
  COUNT(r.id)::int AS recipients,COUNT(r.acknowledged_at)::int AS acknowledged
  FROM administrative_decisions d JOIN users u ON u.id=d.created_by_user_id LEFT JOIN employees ce ON ce.id=u.employee_id
  LEFT JOIN administrative_decision_recipients r ON r.decision_id=d.id`;

/** Whole-company senders see every decision; other senders see the ones they sent. */
export async function listDecisions(db: Db, actor: DecisionActor) {
  const own = !seesAllDecisions(actor);
  return (await db.prepare(`${SUMMARY} ${own ? 'WHERE d.created_by_user_id=?' : ''} GROUP BY d.id,u.email,ce.name_en,ce.name_ar ORDER BY d.created_at DESC,d.id DESC LIMIT 500`).bind(...(own ? [actor.id] : [])).all()).results as Row[];
}

async function visibleDecision(db: Db, actor: DecisionActor, id: number, lock = false) {
  const row = await db.prepare(`SELECT * FROM administrative_decisions WHERE id=?${lock ? ' FOR UPDATE' : ''}`).bind(id).first<Row>();
  if (!row || (!seesAllDecisions(actor) && Number(row.created_by_user_id) !== actor.id)) fail('القرار غير موجود', 'Decision not found', 404);
  return row!;
}

export async function decisionRecipients(db: Db, actor: DecisionActor, id: number) {
  const decision = await visibleDecision(db, actor, id);
  const recipients = (await db.prepare(`SELECT r.employee_id,r.acknowledged_at,e.employee_code,e.name_en,e.name_ar,d.name_en AS department_name,d.name_ar AS department_name_ar
    FROM administrative_decision_recipients r JOIN employees e ON e.id=r.employee_id LEFT JOIN departments d ON d.id=e.department_id
    WHERE r.decision_id=? ORDER BY (r.acknowledged_at IS NULL) DESC,e.name_en`).bind(id).all()).results as Row[];
  return { decision, recipients };
}

/** Withdrawn decisions stop prompting; acknowledgements already given are kept. */
export async function withdrawDecision(db: Db, actor: DecisionActor, id: number) {
  const decision = await visibleDecision(db, actor, id, true);
  if (decision.status !== 'active') fail('القرار مسحوب بالفعل', 'Decision is already withdrawn', 409);
  await db.prepare("UPDATE administrative_decisions SET status='withdrawn',withdrawn_at=CURRENT_TIMESTAMP,withdrawn_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(actor.id, id).run();
  await db.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,new_value,created_at) VALUES (?,'administrative_decision_withdrawn','administrative_decisions','administrative_decision',?,?,CURRENT_TIMESTAMP)")
    .bind(actor.id, String(id), JSON.stringify({ number: decision.decision_number })).run();
}

/** Active decisions this account's employee has not acknowledged yet, oldest first. */
export async function pendingDecisions(db: Db, employeeId: number | null) {
  if (!employeeId) return [] as Row[];
  return (await db.prepare(`SELECT d.id,d.decision_number,d.decision_type,d.title,d.body,d.effective_date,d.created_at,COALESCE(ce.name_en,u.email) AS created_by_name,COALESCE(ce.name_ar,ce.name_en,u.email) AS created_by_name_ar
    FROM administrative_decision_recipients r JOIN administrative_decisions d ON d.id=r.decision_id JOIN users u ON u.id=d.created_by_user_id LEFT JOIN employees ce ON ce.id=u.employee_id
    WHERE r.employee_id=? AND r.acknowledged_at IS NULL AND d.status='active' ORDER BY d.created_at,d.id`).bind(employeeId).all()).results as Row[];
}

/** Only the recipient's own account can acknowledge; repeating it is harmless. */
export async function acknowledgeDecision(db: Db, user: { id: number; employeeId: number | null }, decisionId: number) {
  if (!user.employeeId) fail('الحساب غير مرتبط بموظف', 'This account is not linked to an employee', 403);
  const row = await db.prepare(`SELECT r.id,r.acknowledged_at,d.status FROM administrative_decision_recipients r JOIN administrative_decisions d ON d.id=r.decision_id
    WHERE r.decision_id=? AND r.employee_id=? FOR UPDATE OF r`).bind(decisionId, user.employeeId).first<Row>();
  if (!row) fail('القرار غير موجه إليك', 'This decision was not sent to you', 404);
  if (row!.acknowledged_at) return { acknowledgedAt: row!.acknowledged_at };
  if (row!.status !== 'active') fail('تم سحب هذا القرار', 'This decision was withdrawn', 409);
  const saved = await db.prepare('UPDATE administrative_decision_recipients SET acknowledged_at=CURRENT_TIMESTAMP,acknowledged_by_user_id=? WHERE id=? RETURNING acknowledged_at').bind(user.id, row!.id).first<Row>();
  await db.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,new_value,created_at) VALUES (?,'administrative_decision_acknowledged','administrative_decisions','administrative_decision',?,?,CURRENT_TIMESTAMP)")
    .bind(user.id, String(decisionId), JSON.stringify({ employeeId: user.employeeId })).run();
  return { acknowledgedAt: saved!.acknowledged_at };
}

/** Profile "Acknowledgements" tab: every decision sent to the employee, signed or not. */
export async function employeeAcknowledgements(db: Db, employeeId: number) {
  const ready = (await db.prepare("SELECT to_regclass('public.administrative_decisions') AS name").first<{ name: string | null }>())?.name;
  if (!ready) return [] as Row[];
  return (await db.prepare(`SELECT d.id,d.decision_number,d.decision_type,d.title,d.body,d.effective_date,d.status,d.created_at,r.acknowledged_at
    FROM administrative_decision_recipients r JOIN administrative_decisions d ON d.id=r.decision_id
    WHERE r.employee_id=? ORDER BY COALESCE(r.acknowledged_at,d.created_at) DESC,d.id DESC`).bind(employeeId).all()).results as Row[];
}
