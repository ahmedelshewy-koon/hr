import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";
import type { ApiActor } from "../api/api-security";
import { assertEmployeeVisible, timesheetAccess, visibleEmployeeIds, TIMESHEET_MODULE, type TimesheetAccess } from "./access.ts";
import { buildDraft, recalculateRange, scheduleFor } from "./calculate.ts";
import { departmentSubtreeIds, loadEmployees, loadFacts, lockCountry, lockState, type EmployeeFilter, type Row, type TimesheetEmployee } from "./facts.ts";
import { filterMonthKey, type TimesheetFilters } from "./filters.ts";
import { naughtyCorner, summarize } from "./summary.ts";
import { employeePayrollCountry, isClock, isDate, isMonthKey, monthKeyOf, monthKeysBetween, PAYROLL_COUNTRIES, periodForMonth } from "./time.ts";

type Db = PostgresDatabase | TransactionDatabase;
export const ROW_LIMIT = 20000;
export const NOTE_MAX = 1000;
const fail = (message: string, status = 400) => new Response(message, { status });
const clean = (value: unknown, max = 500) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export async function audit(db: Db, request: Request | null, actor: ApiActor, action: string, recordType: string, recordId: string, previous: unknown, next: unknown) {
  await db.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,previous_value,new_value,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
    .bind(actor.id, action, TIMESHEET_MODULE, recordType, recordId, previous == null ? null : JSON.stringify(previous), next == null ? null : JSON.stringify(next), request?.headers.get("cf-connecting-ip") ?? null).run();
}

/** Employees the filters select, inside the actor's scope. */
export async function scopedEmployees(db: Db, actor: ApiActor, filters: Pick<TimesheetFilters, "departmentId" | "country" | "employeeId">): Promise<TimesheetEmployee[]> {
  const filter: EmployeeFilter = {
    employeeIds: await visibleEmployeeIds(db, actor),
    departmentIds: filters.departmentId ? await departmentSubtreeIds(db, filters.departmentId) : null,
    employeeId: filters.employeeId, country: filters.country,
  };
  if (filter.departmentIds && !filter.departmentIds.length) return [];
  return loadEmployees(db, filter);
}

const ROW_SELECT = `SELECT t.*,e.employee_code,e.name_en AS employee_name,e.name_ar AS employee_name_ar,e.department_id,e.country,e.salary_country,e.work_email,
dep.name_en AS department_name,dep.name_ar AS department_name_ar,r.name_en AS rule_en,r.name_ar AS rule_ar,r.deduction_type AS rule_deduction_type,r.value AS rule_value,
COALESCE(ce.name_en,cu.email) AS changed_by_name,COALESCE(ce.name_ar,ce.name_en,cu.email) AS changed_by_name_ar,
COALESCE(ne.name_en,nu.email) AS manager_note_by_name,COALESCE(ne.name_ar,ne.name_en,nu.email) AS manager_note_by_name_ar,
COALESCE(ae.name_en,au.email) AS approved_by_name,COALESCE(ae.name_ar,ae.name_en,au.email) AS approved_by_name_ar
FROM timesheets t JOIN employees e ON e.id=t.employee_id LEFT JOIN departments dep ON dep.id=e.department_id LEFT JOIN deduction_rules r ON r.id=t.deduction_rule_id
LEFT JOIN users cu ON cu.id=t.changed_by LEFT JOIN employees ce ON ce.id=cu.employee_id
LEFT JOIN users nu ON nu.id=t.manager_note_by LEFT JOIN employees ne ON ne.id=nu.employee_id
LEFT JOIN users au ON au.id=t.approved_by LEFT JOIN employees ae ON ae.id=au.employee_id`;
/** A day belongs on the grid only while the employee is employed: hidden before the start date and, for leavers, after the end date. */
const EMPLOYED_SQL = "e.employment_status!='deleted' AND t.work_date>=e.start_date AND (e.end_date IS NULL OR t.work_date<=e.end_date OR e.employment_status NOT IN ('terminated','resigned','inactive','archived','ended','left'))";

export type GridRow = Row & { lock: "open" | "month" | "payroll"; payroll_country: string; editable: boolean; can_open_edit: boolean };

export async function readRows(db: Db, employeeIds: number[], from: string, to: string): Promise<Row[]> {
  if (!employeeIds.length) return [];
  return (await db.prepare(`${ROW_SELECT} WHERE t.work_date>=? AND t.work_date<=? AND t.employee_id=ANY(?::int[]) AND ${EMPLOYED_SQL} ORDER BY t.work_date,e.name_en,t.id LIMIT ${ROW_LIMIT + 1}`).bind(from, to, employeeIds).all()).results;
}
export async function readRow(db: Db, id: number): Promise<Row | null> {
  return (await db.prepare(`${ROW_SELECT} WHERE t.id=?`).bind(id).first()) ?? null;
}

type Locks = { months: Set<string>; payroll: Set<string>; permissions: Set<string> };
async function readLocks(db: Db, employeeIds: number[]): Promise<Locks> {
  const [months, payroll, permissions] = await Promise.all([
    db.prepare("SELECT month_key,payroll_country FROM timesheet_month_locks WHERE confirmed=1").all(),
    db.prepare("SELECT period_key,payroll_country FROM payroll_month_locks WHERE locked=1").all(),
    employeeIds.length ? db.prepare("SELECT month_key,employee_id FROM timesheet_edit_permissions WHERE is_active=1 AND employee_id=ANY(?::int[])").bind(employeeIds).all() : Promise.resolve({ results: [] as Row[] }),
  ]);
  return {
    months: new Set(months.results.map(row => `${row.month_key}|${row.payroll_country}`)), payroll: new Set(payroll.results.map(row => `${row.period_key}|${row.payroll_country}`)),
    permissions: new Set(permissions.results.map(row => `${row.month_key}|${row.employee_id}`)),
  };
}

/** Adds the lock state and what the actor may do with each row. */
function decorate(rows: Row[], locks: Locks, access: TimesheetAccess): GridRow[] {
  return rows.map(row => {
    const payrollCountry = employeePayrollCountry(row), month = monthKeyOf(String(row.work_date)), country = payrollCountry ?? "OTHER";
    const lock = locks.payroll.has(`${month}|${country}`) ? "payroll" : locks.months.has(`${month}|${country}`) && !locks.permissions.has(`${month}|${row.employee_id}`) ? "month" : "open";
    return { ...row, lock, payroll_country: payrollCountry ?? "", editable: access.canEdit && lock === "open", can_open_edit: access.canEdit && locks.months.has(`${month}|${country}`) && !locks.payroll.has(`${month}|${country}`) } as GridRow;
  });
}

export type Department = { id: number; parent_id: number | null; name_en: string; name_ar: string; unit_type: string };

async function visibleDepartments(db: Db, employees: TimesheetEmployee[], wholeCompany: boolean): Promise<Department[]> {
  const rows = (await db.prepare("SELECT id,parent_id,name_en,name_ar,unit_type FROM departments WHERE status!='deleted' ORDER BY name_en").all()).results.map(row => ({ ...row, id: Number(row.id), parent_id: row.parent_id == null ? null : Number(row.parent_id) })) as Department[];
  if (wholeCompany) return rows;
  const byId = new Map(rows.map(row => [row.id, row])), keep = new Set<number>();
  for (const employee of employees) for (let id = employee.department_id; id && !keep.has(id); id = byId.get(id)?.parent_id ?? null) keep.add(id);
  return rows.filter(row => keep.has(row.id));
}

export async function readTimesheets(db: PostgresDatabase, actor: ApiActor, filters: TimesheetFilters, includeLists = true) {
  const access = await timesheetAccess(db, actor);
  if (!access.canView) throw fail("Permission denied", 403);
  const employees = await scopedEmployees(db, actor, filters);
  const ids = employees.map(employee => employee.id);
  const [rawRows, locks] = await Promise.all([readRows(db, ids, filters.from, filters.to), readLocks(db, ids)]);
  const truncated = rawRows.length > ROW_LIMIT;
  const rows = decorate(truncated ? rawRows.slice(0, ROW_LIMIT) : rawRows, locks, access);
  const monthKey = filterMonthKey(filters), months = monthKeysBetween(filters.from, filters.to);
  const countries = filters.country ? [filters.country] : [...PAYROLL_COUNTRIES, "OTHER"];
  const confirmed = months.every(month => countries.some(country => locks.months.has(`${month}|${country}`)));
  const payload: Record<string, unknown> = {
    filters, period: { from: filters.from, to: filters.to, monthKey, months }, rows, summary: summarize(rows), naughty: naughtyCorner(rows), truncated,
    access, month: { confirmed, anyConfirmed: months.some(month => countries.some(country => locks.months.has(`${month}|${country}`))), payrollLocked: months.some(month => countries.some(country => locks.payroll.has(`${month}|${country}`))) },
    editPermissions: [...locks.permissions].map(key => { const [month, employeeId] = key.split("|"); return { month_key: month, employee_id: Number(employeeId) }; }).filter(item => months.includes(item.month_key)),
  };
  if (includeLists) {
    const picker = await scopedEmployees(db, actor, { departmentId: filters.departmentId, country: filters.country, employeeId: 0 });
    payload.employees = picker.map(employee => ({ id: employee.id, employee_code: employee.employee_code, name_en: employee.name_en, name_ar: employee.name_ar, department_id: employee.department_id, payroll_country: employee.payroll_country }));
    payload.departments = await visibleDepartments(db, await scopedEmployees(db, actor, { departmentId: 0, country: "", employeeId: 0 }), (await visibleEmployeeIds(db, actor)) === null);
    const self = actor.employeeId ? await db.prepare("SELECT country,salary_country FROM employees WHERE id=?").bind(actor.employeeId).first() : null;
    payload.defaultCountry = self ? employeePayrollCountry(self) ?? "" : "";
  }
  return payload;
}

// ---------- Entries ----------

export type EntryInput = {
  id?: number; employeeId: number; workDate: string; scheduledStart?: string; scheduledEnd?: string; actualStart?: string; actualEnd?: string;
  breakDurationMinutes?: number; isAbsent?: boolean; absenceReason?: string; notes?: string;
};

function parseEntry(input: Record<string, unknown>): EntryInput {
  const employeeId = Number(input.employeeId), workDate = String(input.workDate ?? "");
  if (!Number.isInteger(employeeId) || employeeId <= 0 || !isDate(workDate)) throw fail("Please select employee and date");
  const time = (value: unknown, label: string) => { const text = clean(value, 5); if (text && !isClock(text)) throw fail(`${label} must use HH:mm`); return text; };
  const breakMinutes = input.breakDurationMinutes === undefined || input.breakDurationMinutes === "" ? undefined : Math.round(Number(input.breakDurationMinutes));
  if (breakMinutes !== undefined && (!Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes > 600)) throw fail("Break duration must be between 0 and 600 minutes");
  return {
    id: input.id ? Number(input.id) : undefined, employeeId, workDate, scheduledStart: time(input.scheduledStart, "Scheduled start"), scheduledEnd: time(input.scheduledEnd, "Scheduled end"),
    actualStart: time(input.actualStart, "Actual start"), actualEnd: time(input.actualEnd, "Actual end"), breakDurationMinutes: breakMinutes, isAbsent: Boolean(input.isAbsent),
    absenceReason: clean(input.absenceReason, 300), notes: clean(input.notes, NOTE_MAX),
  };
}

function lockMessage(state: "month" | "payroll") {
  return state === "payroll" ? "This day belongs to a payroll period that is locked" : "This month is confirmed and editing is locked";
}

export async function assertEditable(db: Db, employee: TimesheetEmployee, date: string) {
  const facts = await loadFacts(db, [employee], date, date);
  const state = lockState(facts, employee, date);
  if (state !== "open") throw fail(lockMessage(state), 423);
}

/** Add Timesheet Entry / Edit Timesheet Entry: stores the manual decisions, then recalculates the row at once (Save & Calculate). */
export async function saveEntry(db: PostgresDatabase, request: Request, actor: ApiActor, rawInput: Record<string, unknown>) {
  const access = await timesheetAccess(db, actor);
  if (!access.canEdit) throw fail("Permission denied", 403);
  const input = parseEntry(rawInput);
  await assertEmployeeVisible(db, actor, input.employeeId);
  return db.transaction(async tx => {
    await tx.prepare("SELECT pg_advisory_xact_lock(905201,?)").bind(input.employeeId).run();
    const [employee] = await loadEmployees(tx, { employeeIds: null, departmentIds: null, employeeId: input.employeeId, country: "" });
    if (!employee) throw fail("Employee not found", 404);
    const before = (await tx.prepare("SELECT * FROM timesheets WHERE employee_id=? AND work_date=?").bind(input.employeeId, input.workDate).first<Row>()) ?? null;
    if (input.id && (!before || Number(before.id) !== input.id)) throw fail("Timesheet entry not found", 404);
    await assertEditable(tx, employee, input.workDate);

    const facts = await loadFacts(tx, [employee], input.workDate, input.workDate);
    const schedule = scheduleFor(facts, employee, input.workDate), dayKeyText = `${employee.id}|${input.workDate}`;
    const found = facts.devicePunches.get(dayKeyText) ?? facts.remoteSessions.get(dayKeyText) ?? facts.legacy.get(dayKeyText) ?? null;
    const baseline = { scheduledStart: schedule.isOff ? null : schedule.start, scheduledEnd: schedule.isOff ? null : schedule.end, breakDurationMinutes: schedule.breakMinutes, actualStart: found?.first ?? null, actualEnd: found && found.count > 1 ? found.last : null };
    const hasManualTimes = Boolean(input.actualStart || input.actualEnd);
    const currentStart = (before?.actual_start as string | null) ?? baseline?.actualStart ?? null, currentEnd = (before?.actual_end as string | null) ?? baseline?.actualEnd ?? null;
    // Times equal to what punches already gave are not a manual change; only a different (or newly typed) time overrides the punch.
    const manualStart = input.actualStart ? (input.actualStart === currentStart && !before?.changed_start ? null : input.actualStart) : null;
    const manualEnd = input.actualEnd ? (input.actualEnd === currentEnd && !before?.changed_end ? null : input.actualEnd) : null;
    const timesChanged = String(manualStart ?? "") !== String(before?.changed_start ?? "") || String(manualEnd ?? "") !== String(before?.changed_end ?? "");
    const resolvedStart = baseline?.scheduledStart ?? null, resolvedEnd = baseline?.scheduledEnd ?? null;
    const scheduleChanged = Boolean(input.scheduledStart && input.scheduledEnd && (input.scheduledStart !== resolvedStart || input.scheduledEnd !== resolvedEnd));
    // Entering any time on an absent day clears the absence; otherwise the toggle is HR's decision and recalculation keeps it.
    const absenceOverride = hasManualTimes ? null : input.isAbsent ? "absent" : (before?.is_absent || before?.absence_override === "absent") ? "present" : (before?.absence_override ?? null);
    const breakMinutes = input.breakDurationMinutes ?? Number(before?.break_duration_minutes ?? baseline?.breakDurationMinutes ?? 0);

    await tx.prepare(`INSERT INTO timesheets (employee_id,work_date,scheduled_start,scheduled_end,schedule_override,break_duration_minutes,status,changed_start,changed_end,changed_by,changed_at,absence_override,absence_reason,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT (employee_id,work_date) DO UPDATE SET scheduled_start=CASE WHEN excluded.schedule_override=1 THEN excluded.scheduled_start ELSE timesheets.scheduled_start END,
      scheduled_end=CASE WHEN excluded.schedule_override=1 THEN excluded.scheduled_end ELSE timesheets.scheduled_end END,
      schedule_override=CASE WHEN excluded.schedule_override=1 THEN 1 ELSE timesheets.schedule_override END,
      break_duration_minutes=excluded.break_duration_minutes,status=CASE WHEN ? THEN 'pending' ELSE timesheets.status END,
      changed_start=excluded.changed_start,changed_end=excluded.changed_end,changed_by=excluded.changed_by,changed_at=CURRENT_TIMESTAMP,
      approved_by=CASE WHEN ? THEN NULL ELSE timesheets.approved_by END,approved_at=CASE WHEN ? THEN NULL ELSE timesheets.approved_at END,
      absence_override=excluded.absence_override,absence_reason=excluded.absence_reason,notes=excluded.notes,updated_at=CURRENT_TIMESTAMP`)
      .bind(input.employeeId, input.workDate, scheduleChanged ? input.scheduledStart : (before?.scheduled_start ?? null), scheduleChanged ? input.scheduledEnd : (before?.scheduled_end ?? null), scheduleChanged ? 1 : 0,
        breakMinutes, "pending", manualStart, manualEnd, actor.id, absenceOverride, input.isAbsent && !hasManualTimes ? input.absenceReason || null : null, input.notes || null,
        timesChanged, timesChanged, timesChanged).run();
    await recalculateRange(tx, [employee], input.workDate, input.workDate, { ignoreLocks: true });
    const saved = await tx.prepare("SELECT id FROM timesheets WHERE employee_id=? AND work_date=?").bind(input.employeeId, input.workDate).first<{ id: number }>();
    await audit(tx, request, actor, before ? "timesheet_edited" : "timesheet_added", "timesheet", String(saved?.id ?? ""), before, { ...input });
    return readRow(tx, Number(saved?.id));
  });
}

async function loadRowForAction(tx: Db, actor: ApiActor, id: number) {
  const row = await readRow(tx, id);
  if (!row) throw fail("Timesheet entry not found", 404);
  await assertEmployeeVisible(tx, actor, Number(row.employee_id));
  return row;
}
async function employeeOf(tx: Db, row: Row) {
  const [employee] = await loadEmployees(tx, { employeeIds: null, departmentIds: null, employeeId: Number(row.employee_id), country: "" });
  if (!employee) throw fail("Employee not found", 404);
  return employee;
}

export async function decide(db: PostgresDatabase, request: Request, actor: ApiActor, id: number, decision: "approve" | "reject") {
  const access = await timesheetAccess(db, actor);
  if (!access.canApprove) throw fail("Permission denied", 403);
  return db.transaction(async tx => {
    const row = await loadRowForAction(tx, actor, id);
    if (!["pending", "waiting_for_exit"].includes(String(row.status))) throw fail("Only pending or waiting-for-exit entries can be approved or rejected", 409);
    await assertEditable(tx, await employeeOf(tx, row), String(row.work_date));
    const status = decision === "approve" ? "approved" : "rejected";
    await tx.prepare("UPDATE timesheets SET status=?,approved_by=?,approved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, actor.id, id).run();
    await audit(tx, request, actor, `timesheet_${status}`, "timesheet", String(id), { status: row.status }, { status });
    return readRow(tx, id);
  });
}

/** Tri-state notice for an absent day: unset (not charged), with notice or without notice. */
export async function setNotice(db: PostgresDatabase, request: Request, actor: ApiActor, id: number, notice: unknown) {
  const access = await timesheetAccess(db, actor);
  if (!access.canEdit) throw fail("Permission denied", 403);
  if (!["unset", "with", "without"].includes(String(notice))) throw fail("Invalid notice status");
  return db.transaction(async tx => {
    const row = await loadRowForAction(tx, actor, id);
    if (!Number(row.is_absent)) throw fail("Notice status applies to absent days only", 409);
    const employee = await employeeOf(tx, row);
    await assertEditable(tx, employee, String(row.work_date));
    const value = notice === "with" ? 1 : notice === "without" ? 0 : null;
    await tx.prepare("UPDATE timesheets SET absence_has_notice=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(value, id).run();
    await recalculateRange(tx, [employee], String(row.work_date), String(row.work_date), { ignoreLocks: true });
    await audit(tx, request, actor, "timesheet_notice_changed", "timesheet", String(id), { absence_has_notice: row.absence_has_notice }, { absence_has_notice: value });
    return readRow(tx, id);
  });
}

/** Managers and HR leave a note on a day; it stays editable after a month is confirmed because it changes no number. */
export async function saveNote(db: PostgresDatabase, request: Request, actor: ApiActor, id: number, note: unknown) {
  const access = await timesheetAccess(db, actor);
  if (!access.canView) throw fail("Permission denied", 403);
  const text = clean(note, NOTE_MAX);
  return db.transaction(async tx => {
    const row = await loadRowForAction(tx, actor, id);
    await tx.prepare("UPDATE timesheets SET manager_note=?,manager_note_by=?,manager_note_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(text || null, text ? actor.id : null, id).run();
    await audit(tx, request, actor, "timesheet_note_saved", "timesheet", String(id), { manager_note: row.manager_note }, { manager_note: text || null });
    return readRow(tx, id);
  });
}

// ---------- Recalculate ----------

export async function recalculate(db: PostgresDatabase, request: Request, actor: ApiActor, filters: TimesheetFilters) {
  const access = await timesheetAccess(db, actor);
  if (!access.canEdit) throw fail("Permission denied", 403);
  const employees = await scopedEmployees(db, actor, filters);
  const summary = await db.transaction(async tx => {
    await tx.prepare("SELECT pg_advisory_xact_lock(905200)").run();
    return recalculateRange(tx, employees, filters.from, filters.to);
  });
  await audit(db, request, actor, "timesheet_recalculated", "timesheet_scope", `${filters.from}..${filters.to}`, null, { filters, ...summary });
  return summary;
}

// ---------- Month lock and per-employee edit exceptions ----------

const lockCountries = (country: "" | "Egypt" | "KSA") => (country ? [country] : [...PAYROLL_COUNTRIES, "OTHER"]);

export async function confirmMonth(db: PostgresDatabase, request: Request, actor: ApiActor, monthKey: string, country: "" | "Egypt" | "KSA") {
  const access = await timesheetAccess(db, actor);
  if (!access.canEdit) throw fail("Permission denied", 403);
  if (!isMonthKey(monthKey)) throw fail("Select a valid month");
  for (const item of lockCountries(country)) {
    await db.prepare(`INSERT INTO timesheet_month_locks (month_key,payroll_country,confirmed,confirmed_by,confirmed_at,unlocked_by,unlocked_at,created_at,updated_at) VALUES (?,?,1,?,CURRENT_TIMESTAMP,NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT (month_key,payroll_country) DO UPDATE SET confirmed=1,confirmed_by=excluded.confirmed_by,confirmed_at=CURRENT_TIMESTAMP,unlocked_by=NULL,unlocked_at=NULL,updated_at=CURRENT_TIMESTAMP`).bind(monthKey, item, actor.id).run();
  }
  await audit(db, request, actor, "timesheet_month_confirmed", "timesheet_month", monthKey, null, { monthKey, country: country || "all" });
  return { monthKey, countries: lockCountries(country) };
}

export async function unlockMonth(db: PostgresDatabase, request: Request, actor: ApiActor, monthKey: string, country: "" | "Egypt" | "KSA") {
  const access = await timesheetAccess(db, actor);
  if (!access.isMaster) throw fail("Only the master admin can unlock a confirmed month", 403);
  if (!isMonthKey(monthKey)) throw fail("Select a valid month");
  for (const item of lockCountries(country)) {
    await db.prepare("UPDATE timesheet_month_locks SET confirmed=0,unlocked_by=?,unlocked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE month_key=? AND payroll_country=?").bind(actor.id, monthKey, item).run();
  }
  await audit(db, request, actor, "timesheet_month_unlocked", "timesheet_month", monthKey, null, { monthKey, country: country || "all" });
  return { monthKey, countries: lockCountries(country) };
}

/** Open edit / Close edit: lets HR change one employee's days in an otherwise confirmed month. */
export async function setEditPermission(db: PostgresDatabase, request: Request, actor: ApiActor, monthKey: string, employeeId: number, active: boolean) {
  const access = await timesheetAccess(db, actor);
  if (!access.canEdit) throw fail("Permission denied", 403);
  if (!isMonthKey(monthKey) || !Number.isInteger(employeeId) || employeeId <= 0) throw fail("Invalid edit permission");
  await assertEmployeeVisible(db, actor, employeeId);
  const [employee] = await loadEmployees(db, { employeeIds: null, departmentIds: null, employeeId, country: "" });
  if (!employee) throw fail("Employee not found", 404);
  const payroll = await db.prepare("SELECT 1 AS locked FROM payroll_month_locks WHERE period_key=? AND payroll_country=? AND locked=1").bind(monthKey, lockCountry(employee)).first();
  if (payroll) throw fail("This payroll period is locked", 423);
  await db.prepare(`INSERT INTO timesheet_edit_permissions (month_key,employee_id,is_active,granted_by,closed_by,created_at,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT (month_key,employee_id) DO UPDATE SET is_active=excluded.is_active,granted_by=CASE WHEN excluded.is_active=1 THEN excluded.granted_by ELSE timesheet_edit_permissions.granted_by END,closed_by=excluded.closed_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(monthKey, employeeId, active ? 1 : 0, active ? actor.id : null, active ? null : actor.id).run();
  await audit(db, request, actor, active ? "timesheet_edit_opened" : "timesheet_edit_closed", "timesheet_edit_permission", `${monthKey}:${employeeId}`, null, { monthKey, employeeId, active });
  return { monthKey, employeeId, active };
}

/** Company-wide work-from-home date (payroll country '' = everyone); affects the next recalculation. */
export async function setCompanyWfhDay(db: PostgresDatabase, request: Request, actor: ApiActor, input: Record<string, unknown>) {
  const access = await timesheetAccess(db, actor);
  if (!access.canEdit) throw fail("Permission denied", 403);
  const date = String(input.date ?? ""), country = String(input.country ?? "");
  if (!isDate(date) || !["", "Egypt", "KSA"].includes(country)) throw fail("Invalid company WFH day");
  if (input.remove) await db.prepare("DELETE FROM company_wfh_days WHERE wfh_date=? AND payroll_country=?").bind(date, country).run();
  else await db.prepare("INSERT INTO company_wfh_days (wfh_date,payroll_country,note,created_by,created_at,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT (wfh_date,payroll_country) DO UPDATE SET note=excluded.note,updated_at=CURRENT_TIMESTAMP").bind(date, country, clean(input.note, 300) || null, actor.id).run();
  await audit(db, request, actor, input.remove ? "company_wfh_removed" : "company_wfh_saved", "company_wfh_day", `${date}:${country}`, null, { date, country });
  return { date, country };
}

export { periodForMonth };

/** The shift an employee is expected to work on a date (prefills Add Timesheet Entry) plus the row already saved for it. */
export async function daySchedule(db: PostgresDatabase, actor: ApiActor, employeeId: number, date: string) {
  const access = await timesheetAccess(db, actor);
  if (!access.canView) throw fail("Permission denied", 403);
  if (!Number.isInteger(employeeId) || employeeId <= 0 || !isDate(date)) throw fail("Please select employee and date");
  await assertEmployeeVisible(db, actor, employeeId);
  const [employee] = await loadEmployees(db, { employeeIds: null, departmentIds: null, employeeId, country: "" });
  if (!employee) throw fail("Employee not found", 404);
  const facts = await loadFacts(db, [employee], date, date);
  const schedule = scheduleFor(facts, employee, date);
  const draft = buildDraft(facts, employee, date, new Date(Date.now() + 86400000 * 400));
  const row = await db.prepare("SELECT id FROM timesheets WHERE employee_id=? AND work_date=?").bind(employeeId, date).first<{ id: number }>();
  return {
    scheduledStart: schedule.isOff ? null : schedule.start, scheduledEnd: schedule.isOff ? null : schedule.end, breakDurationMinutes: schedule.breakMinutes,
    actualStart: draft?.actualStart ?? null, actualEnd: draft?.actualEnd ?? null, override: draft && ["holiday", "vacation", "wfh"].includes(draft.status) ? draft.status : null,
    existingId: row?.id ?? null, lock: lockState(facts, employee, date),
  };
}

/** True once migration 0052 has created the timesheet tables; the API answers 503 instead of a database error until then. */
export async function timesheetReady(db: PostgresDatabase) {
  const row = await db.prepare("SELECT to_regclass('public.timesheets') IS NOT NULL AND to_regclass('public.payroll_month_locks') IS NOT NULL AS ready").first<{ ready: boolean }>();
  return Boolean(row?.ready);
}

/** The signed-in user's own payroll country, the default of the Payroll Country filter. */
export async function ownPayrollCountry(db: PostgresDatabase, actor: ApiActor): Promise<"" | "Egypt" | "KSA"> {
  if (!actor.employeeId) return "";
  const self = await db.prepare("SELECT country,salary_country FROM employees WHERE id=?").bind(actor.employeeId).first();
  return self ? employeePayrollCountry(self) ?? "" : "";
}
