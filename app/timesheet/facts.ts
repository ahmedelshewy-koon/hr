import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";
import { aggregateBiometricPunches, localParts } from "../attendance/biometric-policy.ts";
import { holidayCoversCountry, isPostponedAway, type CalendarHoliday } from "../leave/holiday-calendar.ts";
import { loadDeductionRules, type DeductionRule } from "../attendance/attendance-deductions.ts";
import { addDays, employeePayrollCountry, monthKeyOf, normalizePayrollCountry, timeZoneForCountry, type PayrollCountry } from "./time.ts";
import type { DayOverride } from "./engine.ts";
import type { ScheduleAttendanceType, ScheduleDay } from "./schedule.ts";

type Db = PostgresDatabase | TransactionDatabase;
export type Row = Record<string, unknown>;

/** Statuses that mean the employee left: their days after end_date disappear. Active staff with a lapsed contract date do not. */
const LEFT_STATUSES = new Set(["terminated", "resigned", "inactive", "archived", "ended", "left"]);

export type TimesheetEmployee = Row & {
  id: number; employee_code: string; name_en: string; name_ar: string; department_id: number | null; department_name: string | null; department_name_ar: string | null;
  country: string; salary_country: string | null; religion: string | null; start_date: string; end_date: string | null; employment_status: string;
  payroll_country: PayrollCountry | null;
};

export type EmployeeFilter = { employeeIds: number[] | null; departmentIds: number[] | null; employeeId: number; country: "" | PayrollCountry };

export async function departmentSubtreeIds(db: Db, departmentId: number): Promise<number[]> {
  const rows = (await db.prepare("WITH RECURSIVE tree AS (SELECT id FROM departments WHERE id=? AND status!='deleted' UNION ALL SELECT d.id FROM departments d JOIN tree t ON d.parent_id=t.id WHERE d.status!='deleted') SELECT id FROM tree").bind(departmentId).all<{ id: number }>()).results;
  return rows.map(row => Number(row.id));
}

export async function loadEmployees(db: Db, filter: EmployeeFilter): Promise<TimesheetEmployee[]> {
  const rows = (await db.prepare(
    "SELECT e.id,e.employee_code,e.name_en,e.name_ar,e.department_id,d.name_en AS department_name,d.name_ar AS department_name_ar,e.company_id,e.branch_id,e.country,e.salary_country,e.working_business_unit_id,e.religion,e.schedule_type,e.work_days,e.remote_days,e.check_in_time,e.check_out_time,e.grace_minutes,e.required_daily_minutes,e.fingerprint_required,e.attendance_type_id,e.shift_plan_id,e.start_date,e.end_date,e.employment_status,e.salary FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.employment_status!='deleted' AND (?::int[] IS NULL OR e.id=ANY(?::int[])) AND (?::int[] IS NULL OR e.department_id=ANY(?::int[]) OR e.section_id=ANY(?::int[]) OR e.team_id=ANY(?::int[])) AND (?=0 OR e.id=?) ORDER BY e.name_en,e.id",
  ).bind(filter.employeeIds, filter.employeeIds, filter.departmentIds, filter.departmentIds, filter.departmentIds, filter.departmentIds, filter.employeeId, filter.employeeId).all()).results;
  const employees = rows.map(row => ({ ...row, id: Number(row.id), payroll_country: employeePayrollCountry(row) }) as TimesheetEmployee);
  return filter.country ? employees.filter(employee => employee.payroll_country === filter.country) : employees;
}

/** Hidden before the job start date, and after the termination date of an employee who left. */
export function employedOn(employee: Pick<TimesheetEmployee, "start_date" | "end_date" | "employment_status">, date: string) {
  if (employee.start_date && date < String(employee.start_date).slice(0, 10)) return false;
  if (employee.end_date && LEFT_STATUSES.has(String(employee.employment_status)) && date > String(employee.end_date).slice(0, 10)) return false;
  return true;
}

export type DayPunches = { first: string | null; last: string | null; count: number };
type Holiday = CalendarHoliday & { nameEn: string; religion: string };
export type MonthLockKey = string;

export type Facts = {
  from: string; to: string;
  employees: Map<number, TimesheetEmployee & Row>;
  attendanceTypes: Map<number, ScheduleAttendanceType & Row>;
  planDays: Map<string, ScheduleDay>;
  plansByEmployee: Map<number, number>;
  assignments: Map<string, ScheduleDay>;
  devicePunches: Map<string, DayPunches>;
  /** Check-in/out already recorded in daily_attendance (history before timesheets): used when no punch exists, never overrides one. */
  legacy: Map<string, DayPunches>;
  /** "country|date" pairs on which the biometric/attendance data provably exists. A working day outside it is unknown, not absent. */
  coverage: Set<string>;
  remoteSessions: Map<string, DayPunches>;
  holidays: Map<string, Holiday[]>;
  vacations: Map<number, { from: string; to: string; en: string; ar: string }[]>;
  wfhRequests: Map<number, { from: string; to: string }[]>;
  employeeWfh: Set<string>;
  delayDates: Set<string>;
  earlyDates: Set<string>;
  companyWfh: { date: string; country: string }[];
  existing: Map<string, Row>;
  salary: Map<number, { from: string; to: string | null; basic: number }[]>;
  rules: DeductionRule[];
  payrollMultiplier: number;
  monthLocks: Set<string>;
  payrollLocks: Set<string>;
  editPermissions: Set<string>;
};
export const dayKey = (employeeId: number, date: string) => `${employeeId}|${date}`;

const SQL_LIMIT = 20000;

export async function loadFacts(db: Db, employees: TimesheetEmployee[], from: string, to: string): Promise<Facts> {
  const ids = employees.map(employee => employee.id);
  const facts: Facts = {
    from, to, employees: new Map(employees.map(employee => [employee.id, employee])), attendanceTypes: new Map(), planDays: new Map(), plansByEmployee: new Map(),
    assignments: new Map(), devicePunches: new Map(), legacy: new Map(), coverage: new Set(), remoteSessions: new Map(), holidays: new Map(), vacations: new Map(), wfhRequests: new Map(), employeeWfh: new Set(), delayDates: new Set(),
    earlyDates: new Set(), companyWfh: [], existing: new Map(), salary: new Map(), rules: [], payrollMultiplier: 1.5, monthLocks: new Set(), payrollLocks: new Set(), editPermissions: new Set(),
  };
  if (!ids.length) return facts;

  const typeIds = [...new Set(employees.map(employee => Number(employee.attendance_type_id)).filter(Boolean))];
  const planIds = [...new Set(employees.map(employee => Number(employee.shift_plan_id)).filter(Boolean))];
  const [legacyRows, coverageRows, types, plans, assignments, punches, remote, holidayRows, vacations, requests, wfhCompany, employeeWfh, existing, salaries, rules, setting, monthLocks, payrollLocks, editPermissions] = await Promise.all([
    db.prepare("SELECT employee_id,work_date,actual_in,actual_out FROM daily_attendance WHERE employee_id=ANY(?::int[]) AND work_date>=? AND work_date<=? AND actual_in IS NOT NULL").bind(ids, from, to).all(),
    db.prepare("SELECT DISTINCT e.country AS country,to_char(p.punched_at AT TIME ZONE COALESCE(d.timezone,'Africa/Cairo'),'YYYY-MM-DD') AS day FROM attendance_device_punches p JOIN employees e ON e.id=p.employee_id LEFT JOIN attendance_devices d ON d.id=p.device_id WHERE p.punched_at>=(?::date - 1)::timestamptz AND p.punched_at<(?::date + 3)::timestamptz UNION SELECT DISTINCT e.country,a.work_date FROM daily_attendance a JOIN employees e ON e.id=a.employee_id WHERE a.actual_in IS NOT NULL AND a.work_date>=? AND a.work_date<=?").bind(from, to, from, to).all(),
    typeIds.length ? db.prepare("SELECT id,shift_based,start_time,end_time,late_allowance_minutes,early_exit_allowance_minutes,weekend_days FROM attendance_types WHERE id=ANY(?::int[])").bind(typeIds).all() : Promise.resolve({ results: [] as Row[] }),
    planIds.length ? db.prepare("SELECT plan_id,weekday,start_time,end_time,break_minutes,is_off FROM shift_plan_details WHERE plan_id=ANY(?::int[])").bind(planIds).all() : Promise.resolve({ results: [] as Row[] }),
    db.prepare("SELECT employee_id,shift_date,start_time,end_time,break_minutes,is_off FROM shift_assignments WHERE employee_id=ANY(?::int[]) AND shift_date>=? AND shift_date<=?").bind(ids, from, to).all(),
    db.prepare("SELECT p.employee_id,p.punched_at,COALESCE(d.timezone,'Africa/Cairo') AS timezone FROM attendance_device_punches p LEFT JOIN attendance_devices d ON d.id=p.device_id WHERE p.employee_id=ANY(?::int[]) AND p.punched_at>=(?::date - 1)::timestamptz AND p.punched_at<(?::date + 3)::timestamptz ORDER BY p.punched_at LIMIT " + SQL_LIMIT * 10).bind(ids, from, to).all(),
    db.prepare("SELECT employee_id,event_at,event_type FROM attendance_logs WHERE employee_id=ANY(?::int[]) AND source='remote' AND event_at>=(?::date - 1)::timestamptz AND event_at<(?::date + 3)::timestamptz ORDER BY event_at").bind(ids, from, to).all(),
    db.prepare("SELECT id,holiday_date,name_en,name_ar,country,recurrence_type,status,original_date,original_date_behavior,religion FROM holidays WHERE status='active'").all(),
    db.prepare("SELECT r.employee_id,r.from_date,r.to_date,lt.name_en,lt.name_ar FROM requests r JOIN leave_types lt ON lt.id=r.leave_type_id WHERE r.employee_id=ANY(?::int[]) AND r.leave_type_id IS NOT NULL AND r.status='hr_approved' AND r.from_date<=? AND r.to_date>=?").bind(ids, to, from).all(),
    db.prepare("SELECT employee_id,type,from_date,to_date,request_date FROM requests WHERE employee_id=ANY(?::int[]) AND leave_type_id IS NULL AND status='hr_approved' AND type IN ('Work from home','Late arrival','Early departure')").bind(ids).all(),
    db.prepare("SELECT wfh_date,payroll_country FROM company_wfh_days WHERE wfh_date>=? AND wfh_date<=?").bind(from, to).all(),
    db.prepare("SELECT employee_id,wfh_date FROM employee_wfh_days WHERE employee_id=ANY(?::int[]) AND wfh_date>=? AND wfh_date<=?").bind(ids, from, to).all(),
    db.prepare("SELECT * FROM timesheets WHERE employee_id=ANY(?::int[]) AND work_date>=? AND work_date<=?").bind(ids, from, to).all(),
    db.prepare("SELECT employee_id,basic_salary,effective_from,effective_to FROM salary_structures WHERE employee_id=ANY(?::int[]) AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from").bind(ids, to, from).all(),
    loadDeductionRules(db),
    db.prepare("SELECT value_json FROM system_settings WHERE setting_key='payroll'").first<{ value_json: string }>(),
    db.prepare("SELECT month_key,payroll_country FROM timesheet_month_locks WHERE confirmed=1").all(),
    db.prepare("SELECT period_key,payroll_country FROM payroll_month_locks WHERE locked=1").all(),
    db.prepare("SELECT month_key,employee_id FROM timesheet_edit_permissions WHERE is_active=1 AND employee_id=ANY(?::int[])").bind(ids).all(),
  ]);

  for (const row of legacyRows.results) facts.legacy.set(dayKey(Number(row.employee_id), String(row.work_date)), { first: String(row.actual_in).slice(0, 5), last: row.actual_out ? String(row.actual_out).slice(0, 5) : null, count: row.actual_out ? 2 : 1 });
  for (const row of coverageRows.results) facts.coverage.add(`${row.country}|${row.day}`);
  for (const row of types.results) facts.attendanceTypes.set(Number(row.id), row as ScheduleAttendanceType & Row);
  for (const employee of employees) if (employee.shift_plan_id) facts.plansByEmployee.set(employee.id, Number(employee.shift_plan_id));
  for (const row of plans.results) facts.planDays.set(`${row.plan_id}|${row.weekday}`, row);
  for (const row of assignments.results) facts.assignments.set(dayKey(Number(row.employee_id), String(row.shift_date)), row);

  // Device punches: grouped per employee and device zone, overnight shifts use the employee's own schedule boundary.
  const byEmployee = new Map<number, Row[]>();
  for (const row of punches.results) { const list = byEmployee.get(Number(row.employee_id)) ?? []; list.push(row); byEmployee.set(Number(row.employee_id), list); }
  for (const [employeeId, list] of byEmployee) {
    const employee = facts.employees.get(employeeId)!;
    const scheduledIn = String(employee.check_in_time || "09:00").slice(0, 5), scheduledOut = String(employee.check_out_time || "17:00").slice(0, 5);
    const zones = new Map<string, Row[]>();
    for (const punch of list) { const zone = String(punch.timezone); (zones.get(zone) ?? zones.set(zone, []).get(zone)!).push(punch); }
    for (const [zone, zonePunches] of zones) {
      for (const day of aggregateBiometricPunches(zonePunches.map(p => ({ punched_at: p.punched_at as string })), zone, scheduledIn, scheduledOut)) {
        const key = dayKey(employeeId, day.workDate), previous = facts.devicePunches.get(key);
        facts.devicePunches.set(key, previous ? mergePunches(previous, { first: day.actualIn, last: day.actualOut, count: day.count }) : { first: day.actualIn, last: day.actualOut, count: day.count });
      }
    }
  }
  // Web check-ins from home (WFH sessions): first check-in and last check-out of the local day.
  for (const row of remote.results) {
    const employee = facts.employees.get(Number(row.employee_id));
    if (!employee) continue;
    const local = localParts(row.event_at as string, timeZoneForCountry(employee.country));
    const key = dayKey(employee.id, local.date), current = facts.remoteSessions.get(key) ?? { first: null, last: null, count: 0 };
    if (row.event_type === "check_in") { if (!current.first || local.time < current.first) current.first = local.time; current.count = Math.max(current.count, 1); }
    else if (row.event_type === "check_out") { if (!current.last || local.time > current.last) current.last = local.time; current.count = Math.max(current.count, 2); }
    facts.remoteSessions.set(key, current);
  }
  // A check-out without a check-in is not a session start.
  for (const [key, session] of facts.remoteSessions) if (!session.first) facts.remoteSessions.delete(key);

  const calendar = holidayRows.results.map(row => ({
    id: Number(row.id), holidayDate: String(row.holiday_date), country: String(row.country), recurrenceType: String(row.recurrence_type || "once"), status: String(row.status || "active"),
    nameAr: String(row.name_ar ?? ""), nameEn: String(row.name_en ?? ""), originalDate: row.original_date ? String(row.original_date) : null,
    originalDateBehavior: row.original_date_behavior ? String(row.original_date_behavior) : null, religion: String(row.religion ?? "").trim().toLowerCase(),
  } satisfies Holiday));
  facts.holidays.set("*", calendar);

  for (const row of vacations.results) {
    const list = facts.vacations.get(Number(row.employee_id)) ?? [];
    list.push({ from: String(row.from_date), to: String(row.to_date), en: String(row.name_en ?? ""), ar: String(row.name_ar ?? "") });
    facts.vacations.set(Number(row.employee_id), list);
  }
  for (const row of requests.results) {
    const employeeId = Number(row.employee_id), type = String(row.type), single = String(row.request_date || row.from_date || "");
    if (type === "Work from home") {
      const list = facts.wfhRequests.get(employeeId) ?? [];
      list.push({ from: String(row.from_date || single), to: String(row.to_date || row.from_date || single) });
      facts.wfhRequests.set(employeeId, list);
    } else if (single) (type === "Late arrival" ? facts.delayDates : facts.earlyDates).add(dayKey(employeeId, single));
  }
  facts.companyWfh = wfhCompany.results.map(row => ({ date: String(row.wfh_date), country: String(row.payroll_country || "") }));
  for (const row of employeeWfh.results) facts.employeeWfh.add(dayKey(Number(row.employee_id),String(row.wfh_date)));
  for (const row of existing.results) facts.existing.set(dayKey(Number(row.employee_id), String(row.work_date)), row);
  for (const row of salaries.results) {
    const list = facts.salary.get(Number(row.employee_id)) ?? [];
    list.push({ from: String(row.effective_from), to: row.effective_to ? String(row.effective_to) : null, basic: Number(row.basic_salary) || 0 });
    facts.salary.set(Number(row.employee_id), list);
  }
  facts.rules = rules;
  try { facts.payrollMultiplier = Number(JSON.parse(setting?.value_json || "{}").overtimeMultiplier) || 1.5; } catch { facts.payrollMultiplier = 1.5; }
  for (const row of monthLocks.results) facts.monthLocks.add(`${row.month_key}|${row.payroll_country}`);
  for (const row of payrollLocks.results) facts.payrollLocks.add(`${row.period_key}|${row.payroll_country}`);
  for (const row of editPermissions.results) facts.editPermissions.add(`${row.month_key}|${row.employee_id}`);
  return facts;
}

function mergePunches(a: DayPunches, b: DayPunches): DayPunches {
  const times = [a.first, a.last, b.first, b.last].filter((value): value is string => Boolean(value)).sort();
  return { first: times[0] ?? null, last: times.length > 1 ? times[times.length - 1] : null, count: a.count + b.count };
}

export const lockCountry = (employee: Pick<TimesheetEmployee, "payroll_country">) => employee.payroll_country ?? "OTHER";

/** Payroll-locked days never change; a confirmed month changes only for an employee with an open edit permission. */
export function lockState(facts: Pick<Facts, "monthLocks" | "payrollLocks" | "editPermissions">, employee: Pick<TimesheetEmployee, "id" | "payroll_country">, date: string): "open" | "month" | "payroll" {
  const month = monthKeyOf(date), country = lockCountry(employee);
  if (facts.payrollLocks.has(`${month}|${country}`)) return "payroll";
  if (facts.monthLocks.has(`${month}|${country}`) && !facts.editPermissions.has(`${month}|${employee.id}`)) return "month";
  return "open";
}

export function holidayOn(facts: Facts, employee: TimesheetEmployee, date: string): { en: string; ar: string } | null {
  const all = facts.holidays.get("*") ?? [];
  const religion = String(employee.religion ?? "").trim().toLowerCase();
  const country = normalizePayrollCountry(employee.country) === "KSA" ? "Saudi Arabia" : String(employee.country);
  for (const holiday of all) {
    if (!holidayCoversCountry(holiday, country) && !holidayCoversCountry(holiday, String(employee.country))) continue;
    const occurs = holiday.recurrenceType === "annual" ? holiday.holidayDate.slice(5) === date.slice(5) : holiday.holidayDate === date;
    if (!occurs || isPostponedAway(holiday, date, all)) continue;
    if (holiday.religion && holiday.religion !== "all" && holiday.religion !== religion) continue;
    return { en: holiday.nameEn, ar: holiday.nameAr || holiday.nameEn };
  }
  return null;
}

export function vacationOn(facts: Facts, employeeId: number, date: string) {
  return (facts.vacations.get(employeeId) ?? []).find(item => item.from <= date && date <= item.to) ?? null;
}

export function wfhOn(facts: Facts, employee: TimesheetEmployee, date: string): "request" | "employee" | "company" | null {
  if ((facts.wfhRequests.get(employee.id) ?? []).some(item => item.from <= date && date <= item.to)) return "request";
  if (facts.employeeWfh?.has(dayKey(employee.id,date))) return "employee";
  return facts.companyWfh.some(item => item.date === date && (!item.country || item.country === (employee.payroll_country ?? ""))) ? "company" : null;
}

export function dayOverride(facts: Facts, employee: TimesheetEmployee, date: string): DayOverride | null {
  const holiday = holidayOn(facts, employee, date);
  if (holiday) return { kind: "holiday", labelEn: holiday.en, labelAr: holiday.ar };
  const vacation = vacationOn(facts, employee.id, date);
  if (vacation) return { kind: "vacation", labelEn: vacation.en, labelAr: vacation.ar };
  const wfh = wfhOn(facts, employee, date);
  if (wfh === "request" || wfh === "employee") return { kind: "wfh", labelEn: "Work From Home", labelAr: "عمل من المنزل" };
  if (wfh === "company") return { kind: "wfh", labelEn: "Company WFH Day", labelAr: "يوم عمل من المنزل للشركة" };
  return null;
}

export function basicSalaryOn(facts: Facts, employee: TimesheetEmployee, date: string): number {
  const list = facts.salary.get(employee.id) ?? [];
  const match = [...list].reverse().find(item => item.from <= date && (!item.to || item.to >= date));
  return match?.basic ?? (Number(employee.salary) || 0);
}

export function planDayFor(facts: Facts, employee: TimesheetEmployee, date: string, weekday: number): ScheduleDay | null {
  const planId = facts.plansByEmployee.get(employee.id);
  if (!planId) return null;
  // A plan with no row for a weekday means a rest day.
  return facts.planDays.get(`${planId}|${weekday}`) ?? { is_off: 1 };
}

export { addDays };
