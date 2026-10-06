import type { TransactionDatabase } from '../../db/postgres';

type Row = Record<string, unknown>;
type Db = Pick<TransactionDatabase, 'prepare'>;

/** The fields that make up a job-history entry; any change to one of them starts a new entry. */
export const HISTORY_FIELDS = ['company_id', 'branch_id', 'department_id', 'section_id', 'job_title_id', 'position_id'] as const;

export function assignmentChanged(before: Row, next: Row): boolean {
  return HISTORY_FIELDS.some(field => Number(before[field] || 0) !== Number(next[field] || 0));
}

/** The entry's start date: the assignment effective date when given, otherwise today (YYYY-MM-DD). */
export function historyStartDate(effective: unknown, today = new Date().toISOString().slice(0, 10)): string {
  const value = String(effective ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;
}

let ready: boolean | null = null;
async function historyReady(db: Db) {
  if (ready) return true;
  ready = Boolean((await db.prepare("SELECT to_regclass('public.employee_job_history') AS name").first<{ name: string | null }>())?.name);
  return ready;
}

/**
 * Closes the employee's open job-history entry and opens a new one when the assignment really changed.
 * Runs inside the caller's transaction, right after the assignment is written.
 */
export async function recordJobHistory(db: Db, employeeId: number, before: Row, next: Row, effective: unknown, reason: string | null = null) {
  if (!await historyReady(db)) return;
  const open = await db.prepare('SELECT id,start_date FROM employee_job_history WHERE employee_id=? AND end_date IS NULL FOR UPDATE').bind(employeeId).first<Row>();
  if (open && !assignmentChanged(before, next)) return;
  const start = historyStartDate(effective);
  // An entry that starts the same day it is replaced is superseded rather than kept as a zero-length row.
  if (open && String(open.start_date) >= start) await db.prepare('DELETE FROM employee_job_history WHERE id=?').bind(open.id).run();
  else if (open) await db.prepare('UPDATE employee_job_history SET end_date=? WHERE id=?').bind(start, open.id).run();
  await db.prepare('INSERT INTO employee_job_history (employee_id,company_id,branch_id,department_id,section_id,job_title_id,position_id,start_date,change_reason) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(employeeId, ...HISTORY_FIELDS.map(field => next[field] ?? null), start, reason).run();
}

export async function readJobHistory(db: Db, employeeId: number) {
  if (!await historyReady(db)) return [];
  return ((await db.prepare(`SELECT h.id,h.start_date,h.end_date,h.change_reason,co.name AS company_name,
      b.name_en AS branch_name,b.name_ar AS branch_name_ar,d.name_en AS department_name,d.name_ar AS department_name_ar,
      s.name_en AS section_name,s.name_ar AS section_name_ar,j.name_en AS job_title_name,j.name_ar AS job_title_name_ar,p.name_en AS position_name,p.name_ar AS position_name_ar
    FROM employee_job_history h LEFT JOIN companies co ON co.id=h.company_id LEFT JOIN branches b ON b.id=h.branch_id LEFT JOIN departments d ON d.id=h.department_id
    LEFT JOIN departments s ON s.id=h.section_id LEFT JOIN job_titles j ON j.id=h.job_title_id LEFT JOIN positions p ON p.id=h.position_id
    WHERE h.employee_id=? ORDER BY h.start_date DESC,h.id DESC`).bind(employeeId).all()).results ?? []) as Row[];
}
