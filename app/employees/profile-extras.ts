import type { TransactionDatabase } from '../../db/postgres';

/**
 * Employee profile extras: emergency contacts, the employee's medical insurance plan, marital status and HR notes.
 * Pure validators are shared with the tests; writes run in the caller's transaction and write an audit row.
 */
type Row = Record<string, unknown>;
type Db = Pick<TransactionDatabase, 'prepare'>;
export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed'] as const;
export const RELATIONSHIPS = ['spouse', 'parent', 'sibling', 'child', 'relative', 'friend', 'other'] as const;

const fail = (ar: string, en: string, status = 400): never => { throw new Response(`${ar} / ${en}`, { status }); };
const text = (value: unknown) => String(value ?? '').trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE = /^\+?[0-9][0-9\s-]{5,19}$/;

export function validateContact(input: Row) {
  const name = text(input.name), relationship = text(input.relationship), phone = text(input.phone), alternate = text(input.alternate_phone);
  if (!name || name.length > 120) fail('اسم جهة الاتصال مطلوب', 'Contact name is required');
  if (!(RELATIONSHIPS as readonly string[]).includes(relationship)) fail('صلة القرابة غير صالحة', 'Invalid relationship');
  if (!PHONE.test(phone)) fail('رقم الهاتف غير صالح', 'Invalid phone number');
  if (alternate && !PHONE.test(alternate)) fail('رقم الهاتف البديل غير صالح', 'Invalid alternate phone number');
  return { name, relationship, phone, alternate_phone: alternate || null, is_primary: input.is_primary === true || input.is_primary === 1 || input.is_primary === '1' ? 1 : 0 };
}

export function validateInsurance(input: Row) {
  const planId = Number(input.plan_id), dependents = input.dependents === '' || input.dependents === undefined || input.dependents === null ? 0 : Number(input.dependents);
  const start = text(input.start_date), end = text(input.end_date), card = text(input.card_number), notes = text(input.notes);
  if (!Number.isSafeInteger(planId) || planId < 1) fail('اختر خطة التأمين', 'Select an insurance plan');
  if (!DATE.test(start)) fail('تاريخ بداية التأمين مطلوب', 'Insurance start date is required');
  if (end && (!DATE.test(end) || end < start)) fail('تاريخ نهاية التأمين يجب أن يكون بعد البداية', 'Insurance end date must be after the start date');
  if (!Number.isInteger(dependents) || dependents < 0 || dependents > 20) fail('عدد التابعين بين 0 و20', 'Dependents must be between 0 and 20');
  if (card.length > 60 || notes.length > 1000) fail('القيمة طويلة جدًا', 'Value is too long');
  return { plan_id: planId, card_number: card || null, start_date: start, end_date: end || null, dependents, notes: notes || null };
}

export function validatePersonal(input: Row) {
  const marital = text(input.marital_status), notes = text(input.profile_notes);
  if (marital && !(MARITAL_STATUSES as readonly string[]).includes(marital)) fail('الحالة الاجتماعية غير صالحة', 'Invalid marital status');
  if (notes.length > 4000) fail('الملاحظات طويلة جدًا', 'Notes are too long');
  return { marital_status: marital || null, profile_notes: notes || null };
}

async function audit(db: Db, actorId: number, action: string, recordType: string, recordId: unknown, before: unknown, after: unknown) {
  await db.prepare('INSERT INTO audit_logs (user_id,action,module,record_type,record_id,previous_value,new_value,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)')
    .bind(actorId, action, 'employees', recordType, String(recordId), before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)).run();
}

export async function saveContact(db: Db, employeeId: number, input: Row, actorId: number) {
  const values = validateContact(input), id = Number(input.id) || null;
  const before = id ? await db.prepare('SELECT * FROM employee_emergency_contacts WHERE id=? AND employee_id=? FOR UPDATE').bind(id, employeeId).first<Row>() : null;
  if (id && !before) fail('جهة الاتصال غير موجودة', 'Contact not found', 404);
  // Only one primary contact per employee.
  if (values.is_primary) await db.prepare('UPDATE employee_emergency_contacts SET is_primary=0,updated_at=CURRENT_TIMESTAMP WHERE employee_id=? AND id<>?').bind(employeeId, id ?? 0).run();
  const saved = id
    ? await db.prepare('UPDATE employee_emergency_contacts SET name=?,relationship=?,phone=?,alternate_phone=?,is_primary=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *').bind(values.name, values.relationship, values.phone, values.alternate_phone, values.is_primary, id).first<Row>()
    : await db.prepare('INSERT INTO employee_emergency_contacts (employee_id,name,relationship,phone,alternate_phone,is_primary) VALUES (?,?,?,?,?,?) RETURNING *').bind(employeeId, values.name, values.relationship, values.phone, values.alternate_phone, values.is_primary).first<Row>();
  await audit(db, actorId, id ? 'emergency_contact_updated' : 'emergency_contact_created', 'employee_emergency_contact', saved!.id, before, values);
  return saved!;
}

export async function deleteContact(db: Db, employeeId: number, id: number, actorId: number) {
  const before = await db.prepare('SELECT * FROM employee_emergency_contacts WHERE id=? AND employee_id=? FOR UPDATE').bind(id, employeeId).first<Row>();
  if (!before) fail('جهة الاتصال غير موجودة', 'Contact not found', 404);
  await db.prepare('DELETE FROM employee_emergency_contacts WHERE id=?').bind(id).run();
  await audit(db, actorId, 'emergency_contact_deleted', 'employee_emergency_contact', id, before, null);
}

/** Assigning a plan replaces the employee's active one (ended the day before the new start), so history is kept. */
export async function saveInsurance(db: Db, employeeId: number, input: Row, actorId: number) {
  const values = validateInsurance(input);
  const plan = await db.prepare("SELECT id FROM medical_insurance_plans WHERE id=? AND status='active'").bind(values.plan_id).first();
  if (!plan) fail('خطة التأمين غير متاحة', 'Insurance plan is not available', 409);
  const current = await db.prepare("SELECT * FROM employee_medical_insurance WHERE employee_id=? AND status='active' FOR UPDATE").bind(employeeId).first<Row>();
  if (current && Number(input.id) === Number(current.id)) {
    const saved = await db.prepare('UPDATE employee_medical_insurance SET plan_id=?,card_number=?,start_date=?,end_date=?,dependents=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *')
      .bind(values.plan_id, values.card_number, values.start_date, values.end_date, values.dependents, values.notes, current.id).first<Row>();
    await audit(db, actorId, 'medical_insurance_updated', 'employee_medical_insurance', current.id, current, values);
    return saved!;
  }
  if (current) {
    const dayBefore = new Date(`${values.start_date}T00:00:00Z`); dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const end = String(current.start_date) > dayBefore.toISOString().slice(0, 10) ? String(current.start_date) : dayBefore.toISOString().slice(0, 10);
    await db.prepare("UPDATE employee_medical_insurance SET status='ended',end_date=COALESCE(end_date,?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(end, current.id).run();
  }
  const saved = await db.prepare('INSERT INTO employee_medical_insurance (employee_id,plan_id,card_number,start_date,end_date,dependents,notes) VALUES (?,?,?,?,?,?,?) RETURNING *')
    .bind(employeeId, values.plan_id, values.card_number, values.start_date, values.end_date, values.dependents, values.notes).first<Row>();
  await audit(db, actorId, 'medical_insurance_assigned', 'employee_medical_insurance', saved!.id, current, values);
  return saved!;
}

export async function endInsurance(db: Db, employeeId: number, actorId: number) {
  const current = await db.prepare("SELECT * FROM employee_medical_insurance WHERE employee_id=? AND status='active' FOR UPDATE").bind(employeeId).first<Row>();
  if (!current) fail('لا يوجد تأمين نشط', 'No active insurance', 404);
  const today = new Date().toISOString().slice(0, 10);
  await db.prepare("UPDATE employee_medical_insurance SET status='ended',end_date=COALESCE(end_date,?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(today < String(current!.start_date) ? String(current!.start_date) : today, current!.id).run();
  await audit(db, actorId, 'medical_insurance_ended', 'employee_medical_insurance', current!.id, current, { status: 'ended' });
}

export async function savePersonal(db: Db, employeeId: number, input: Row, actorId: number) {
  const values = validatePersonal(input);
  const before = await db.prepare('SELECT marital_status,profile_notes FROM employees WHERE id=? FOR UPDATE').bind(employeeId).first<Row>();
  await db.prepare('UPDATE employees SET marital_status=?,profile_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(values.marital_status, values.profile_notes, employeeId).run();
  await audit(db, actorId, 'employee_profile_details_updated', 'employee', employeeId, before, values);
  return values;
}

export async function readProfileExtras(db: Db, employeeId: number) {
  const [contacts, insurance] = await Promise.all([
    db.prepare('SELECT * FROM employee_emergency_contacts WHERE employee_id=? ORDER BY is_primary DESC,id').bind(employeeId).all(),
    db.prepare(`SELECT i.*,p.name_en AS plan_name,p.name_ar AS plan_name_ar,p.provider,p.coverage_type,p.max_coverage,p.currency,p.employee_contribution,p.company_contribution,p.family_coverage
      FROM employee_medical_insurance i JOIN medical_insurance_plans p ON p.id=i.plan_id WHERE i.employee_id=? ORDER BY (i.status='active') DESC,i.start_date DESC,i.id DESC`).bind(employeeId).all(),
  ]);
  return { contacts: (contacts.results ?? []) as Row[], insurance: (insurance.results ?? []) as Row[] };
}
