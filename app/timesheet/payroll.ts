import type { PostgresDatabase } from "../../db/postgres";
import type { ApiActor } from "../api/api-security";
import { seesWholeCompany } from "../employees/hr-data-scope.ts";
import { timesheetAccess } from "./access.ts";
import { loadEmployees, type Row } from "./facts.ts";
import { audit, readRows } from "./service.ts";
import { deductionSummary } from "./summary.ts";
import { isMonthKey, periodForMonth, PAYROLL_COUNTRIES, type PayrollCountry } from "./time.ts";
import { payrollCountrySql } from "../payroll/country.ts";

const fail = (message: string, status = 400) => new Response(message, { status });
const country = (value: unknown): PayrollCountry => { if (!PAYROLL_COUNTRIES.includes(value as PayrollCountry)) throw fail("Select Egypt or KSA"); return value as PayrollCountry; };

/**
 * Payroll Deductions. Deduction Summary posts one variable entry per employee, period and element:
 *   delay    = late + early-leave deductions (quantity = minutes)
 *   absence  = charged absences, (basic / 30) × days × rule value (quantity = charged days)
 *   overtime = overtime pay (quantity = minutes)
 * Payroll runs read only these entries. The period is the 26th of the previous month to the 25th of the month named by the key.
 */
export async function payrollPeriods(db: PostgresDatabase, actor: ApiActor) {
  const access = await timesheetAccess(db, actor);
  if (!access.canView) throw fail("Permission denied", 403);
  const rows = (await db.prepare("SELECT * FROM payroll_month_locks WHERE sent_at IS NOT NULL ORDER BY period_key DESC,payroll_country LIMIT 120").all()).results;
  return rows.map(row => ({ ...row, ...periodForMonth(String(row.period_key)) }));
}

export async function loadPayrollPeriod(db: PostgresDatabase, actor: ApiActor, periodKey: string, payrollCountry: unknown) {
  const access = await timesheetAccess(db, actor);
  if (!access.canView) throw fail("Permission denied", 403);
  if (!isMonthKey(periodKey)) throw fail("Select a valid month");
  const selected = country(payrollCountry);
  const lock = (await db.prepare("SELECT * FROM payroll_month_locks WHERE period_key=? AND payroll_country=?").bind(periodKey, selected).first()) ?? null;
  const entries = (await db.prepare(`SELECT p.employee_id,p.element,p.quantity,p.amount,p.posted_at,e.employee_code,e.name_en AS employee_name,e.name_ar AS employee_name_ar,e.country,e.salary_country
    FROM payroll_variable_entries p JOIN employees e ON e.id=p.employee_id WHERE p.period_key=? ORDER BY e.name_en,p.element`).bind(periodKey).all()).results;
  const byEmployee = new Map<number, Row>();
  for (const entry of entries) {
    const key = Number(entry.employee_id);
    const record = byEmployee.get(key) ?? { employee_id: key, employee_code: entry.employee_code, employee_name: entry.employee_name, employee_name_ar: entry.employee_name_ar, country: entry.country, salary_country: entry.salary_country, delay_amount: 0, delay_minutes: 0, absence_amount: 0, absence_days: 0, overtime_amount: 0, overtime_minutes: 0 };
    record[`${entry.element}_amount`] = Number(entry.amount) || 0;
    record[entry.element === "absence" ? "absence_days" : `${entry.element}_minutes`] = Number(entry.quantity) || 0;
    byEmployee.set(key, record);
  }
  return { periodKey, country: selected, ...periodForMonth(periodKey), lock, entries: [...byEmployee.values()] };
}

/** Posts the period's Deduction Summary to payroll for one payroll country. Replaces any earlier posting of that period. */
export async function sendToPayroll(db: PostgresDatabase, request: Request, actor: ApiActor, periodKey: string, payrollCountry: unknown) {
  const access = await timesheetAccess(db, actor);
  if (!access.canEdit) throw fail("Permission denied", 403);
  if (!seesWholeCompany(actor)) throw fail("Only company-wide HR can send deductions to payroll", 403);
  if (!isMonthKey(periodKey)) throw fail("Select a valid month");
  const selected = country(payrollCountry), { from, to } = periodForMonth(periodKey);
  return db.transaction(async tx => {
    await tx.prepare("SELECT pg_advisory_xact_lock(905202)").run();
    await tx.prepare("SELECT pg_advisory_xact_lock(905204)").run();
    const existing = await tx.prepare("SELECT locked FROM payroll_month_locks WHERE period_key=? AND payroll_country=?").bind(periodKey, selected).first<{ locked: number }>();
    if (existing && Number(existing.locked) === 1) throw fail("This payroll period is locked", 423);
    const committedRun=await tx.prepare("SELECT 1 AS found FROM payroll_runs WHERE year=? AND month=? AND country=? AND currency IS NOT NULL AND status<>'draft' LIMIT 1")
      .bind(Number(periodKey.slice(0,4)),Number(periodKey.slice(5,7)),selected).first();
    if(committedRun)throw fail("A confirmed payroll run exists; reconcile and roll it back before reposting deductions",409);
    const employees = await loadEmployees(tx, { employeeIds: null, departmentIds: null, employeeId: 0, country: selected });
    const rows = await readRows(tx, employees.map(employee => employee.id), from, to);
    const { employees: lines, grand } = deductionSummary(rows);
    const ids = employees.map(employee => employee.id);
    if (ids.length) await tx.prepare("DELETE FROM payroll_variable_entries WHERE period_key=? AND source='timesheet' AND employee_id=ANY(?::int[])").bind(periodKey, ids).run();
    let posted = 0;
    for (const line of lines) {
      const entries: [string, number, number][] = [
        ["delay", line.delayMinutes + line.earlyMinutes, line.delayAmount], ["absence", line.chargedAbsenceDays, line.absenceAmount], ["overtime", line.overtimeMinutes, line.overtimeAmount],
      ];
      for (const [element, quantity, amount] of entries) {
        if (!amount) continue;
        await tx.prepare(`INSERT INTO payroll_variable_entries (employee_id,period_key,element,quantity,amount,source,posted_by,posted_at,created_at,updated_at) VALUES (?,?,?,?,?,'timesheet',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT (employee_id,period_key,element) DO UPDATE SET quantity=excluded.quantity,amount=excluded.amount,source='timesheet',posted_by=excluded.posted_by,posted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
          .bind(line.employee_id, periodKey, element, quantity, amount, actor.id).run();
        posted++;
      }
    }
    await tx.prepare(`INSERT INTO payroll_month_locks (period_key,payroll_country,sent_by,sent_at,employees_count,delay_total,absence_total,locked,created_at,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP,?,?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT (period_key,payroll_country) DO UPDATE SET sent_by=excluded.sent_by,sent_at=CURRENT_TIMESTAMP,employees_count=excluded.employees_count,delay_total=excluded.delay_total,absence_total=excluded.absence_total,updated_at=CURRENT_TIMESTAMP`)
      .bind(periodKey, selected, actor.id, lines.length, grand.delayAmount, grand.absenceAmount).run();
    await audit(tx, request, actor, "timesheet_sent_to_payroll", "payroll_period", `${periodKey}:${selected}`, null, { periodKey, country: selected, employees: lines.length, entries: posted, delay: grand.delayAmount, absence: grand.absenceAmount });
    return { periodKey, country: selected, employees: lines.length, entries: posted, delayTotal: grand.delayAmount, absenceTotal: grand.absenceAmount };
  });
}

/** Reverses a Timesheet posting while retaining the month record and audit trail. */
export async function rollbackPayrollPeriod(db:PostgresDatabase,request:Request,actor:ApiActor,periodKey:string,payrollCountry:unknown){
  const access=await timesheetAccess(db,actor);
  if(!access.isMaster)throw fail("Only the master admin can roll back payroll deductions",403);
  if(!isMonthKey(periodKey))throw fail("Select a valid month");
  const selected=country(payrollCountry);
  return db.transaction(async tx=>{
    await tx.prepare("SELECT pg_advisory_xact_lock(905202)").run();
    await tx.prepare("SELECT pg_advisory_xact_lock(905204)").run();
    const current=await tx.prepare("SELECT * FROM payroll_month_locks WHERE period_key=? AND payroll_country=? FOR UPDATE").bind(periodKey,selected).first<Row>();
    if(!current?.sent_at)throw fail("This period was not sent to payroll",409);
    if(Number(current.locked)===1)throw fail("Unlock this month before rollback",423);
    const run=await tx.prepare("SELECT 1 AS found FROM payroll_runs WHERE year=? AND month=? AND country=? AND currency IS NOT NULL AND (status<>'draft' OR erp_post_started_at IS NOT NULL OR sent_to_accounting_at IS NOT NULL) LIMIT 1")
      .bind(Number(periodKey.slice(0,4)),Number(periodKey.slice(5,7)),selected).first();
    if(run)throw fail("A confirmed or sent payroll run must be reconciled and rolled back first",409);
    const deleted=await tx.prepare(`DELETE FROM payroll_variable_entries p USING employees e WHERE p.employee_id=e.id AND p.period_key=? AND p.source='timesheet' AND ${payrollCountrySql()}=? RETURNING p.id`).bind(periodKey,selected).all();
    await tx.prepare("UPDATE payroll_month_locks SET sent_at=NULL,sent_by=NULL,employees_count=0,delay_total=0,absence_total=0,updated_at=CURRENT_TIMESTAMP WHERE period_key=? AND payroll_country=?").bind(periodKey,selected).run();
    await audit(tx,request,actor,"timesheet_payroll_rollback","payroll_period",`${periodKey}:${selected}`,current,{entries:deleted.results.length});
    return {periodKey,country:selected,entriesRemoved:deleted.results.length};
  });
}

/** Locks (or unlocks) a period that was sent to payroll. A locked period blocks every timesheet change inside it; only the master admin can unlock. */
export async function setPayrollLock(db: PostgresDatabase, request: Request, actor: ApiActor, periodKey: string, payrollCountry: unknown, locked: boolean) {
  const access = await timesheetAccess(db, actor);
  if (locked ? !access.canEdit : !access.isMaster) throw fail(locked ? "Permission denied" : "Only the master admin can unlock a payroll month", 403);
  if (!isMonthKey(periodKey)) throw fail("Select a valid month");
  const selected = country(payrollCountry);
  const row = await db.prepare("SELECT sent_at FROM payroll_month_locks WHERE period_key=? AND payroll_country=?").bind(periodKey, selected).first<{ sent_at: string | null }>();
  if (!row?.sent_at) throw fail("Send this month to payroll before locking it", 409);
  await db.prepare("UPDATE payroll_month_locks SET locked=?,locked_by=?,locked_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE locked_at END,updated_at=CURRENT_TIMESTAMP WHERE period_key=? AND payroll_country=?")
    .bind(locked ? 1 : 0, locked ? actor.id : null, locked ? 1 : 0, periodKey, selected).run();
  await audit(db, request, actor, locked ? "payroll_month_locked" : "payroll_month_unlocked", "payroll_period", `${periodKey}:${selected}`, null, { periodKey, country: selected, locked });
  return { periodKey, country: selected, locked };
}
