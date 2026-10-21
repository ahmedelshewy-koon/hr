import type { PostgresDatabase } from "../../db/postgres";
import type { ApiActor } from "../api/api-security";
import { timesheetAccess, visibleEmployeeIds } from "./access.ts";
import { audit, setCompanyWfhDay } from "./service.ts";
import { addDays, daysBetween, eachDate, isClock, isDate, weekdayOf } from "./time.ts";

/**
 * Schedule sources the timesheet calculation reads: employee shift type, attendance type and weekly shift plan, per-date rotating
 * shift assignments, holiday religion and company work-from-home days. Changes apply at the next Recalculate and never touch
 * locked months or payroll periods.
 */
const fail = (message: string, status = 400) => new Response(message, { status });
const SHIFT_TYPES = ["fixed", "shift", "rotating"];
const RELIGIONS = ["", "muslim", "christian"];
const MAX_ASSIGNMENT_DAYS = 93;
const clean = (value: unknown, max = 120) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const time = (value: unknown, label: string) => { const text = clean(value, 5); if (!isClock(text)) throw fail(`${label} must use HH:mm`); return text; };
const minutes = (value: unknown) => { const n = Math.round(Number(value) || 0); if (n < 0 || n > 600) throw fail("Break duration must be between 0 and 600 minutes"); return n; };

async function editor(db: PostgresDatabase, actor: ApiActor) {
  const access = await timesheetAccess(db, actor);
  if (!access.canEdit) throw fail("Permission denied", 403);
}
async function scopedIds(db: PostgresDatabase, actor: ApiActor, requested: unknown): Promise<number[]> {
  const ids = [...new Set((Array.isArray(requested) ? requested : []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw fail("Select at least one employee");
  const visible = await visibleEmployeeIds(db, actor);
  if (visible !== null && ids.some(id => !visible.includes(id))) throw fail("Employee is outside your access scope", 403);
  const found = await db.prepare("SELECT id FROM employees WHERE id=ANY(?::int[]) AND employment_status!='deleted'").bind(ids).all<{ id: number }>();
  if (found.results.length !== ids.length) throw fail("Employee not found", 404);
  return ids;
}

export async function readSchedules(db: PostgresDatabase, actor: ApiActor, from: string, to: string) {
  const access = await timesheetAccess(db, actor);
  if (!access.canView) throw fail("Permission denied", 403);
  if (!isDate(from) || !isDate(to) || from > to || daysBetween(from, to) > 400) throw fail("Select a valid period");
  const visible = await visibleEmployeeIds(db, actor);
  const [types, employees, plans, details, assignments, holidays, wfh] = await Promise.all([
    db.prepare("SELECT id,code,name_en,name_ar,shift_based,start_time,end_time,late_allowance_minutes,early_exit_allowance_minutes,weekend_days,status FROM attendance_types ORDER BY name_en").all(),
    db.prepare("SELECT e.id,e.employee_code,e.name_en,e.name_ar,e.schedule_type,e.attendance_type_id,e.shift_plan_id,e.work_days,e.check_in_time,e.check_out_time,e.country,e.salary_country,d.name_en AS department_name,d.name_ar AS department_name_ar FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.employment_status!='deleted' AND (?::int[] IS NULL OR e.id=ANY(?::int[])) ORDER BY e.name_en,e.id").bind(visible, visible).all(),
    db.prepare("SELECT id,name_en,name_ar,status FROM shift_plans ORDER BY name_en").all(),
    db.prepare("SELECT plan_id,weekday,start_time,end_time,break_minutes,is_off FROM shift_plan_details ORDER BY plan_id,weekday").all(),
    db.prepare("SELECT employee_id,shift_date,start_time,end_time,break_minutes,is_off FROM shift_assignments WHERE shift_date>=? AND shift_date<=? AND (?::int[] IS NULL OR employee_id=ANY(?::int[])) ORDER BY shift_date,employee_id").bind(from, to, visible, visible).all(),
    db.prepare("SELECT id,name_en,name_ar,holiday_date,country,recurrence_type,religion FROM holidays WHERE status='active' ORDER BY holiday_date").all(),
    db.prepare("SELECT id,wfh_date,payroll_country,note FROM company_wfh_days WHERE wfh_date>=? ORDER BY wfh_date").bind(addDays(from, -60)).all(),
  ]);
  const plansWithDays = plans.results.map(plan => ({ ...plan, days: details.results.filter(row => Number(row.plan_id) === Number(plan.id)) }));
  return { access, attendanceTypes: types.results, employees: employees.results, shiftPlans: plansWithDays, assignments: assignments.results, holidays: holidays.results, companyWfh: wfh.results };
}

export async function saveEmployeeSchedule(db: PostgresDatabase, request: Request, actor: ApiActor, input: Record<string, unknown>) {
  await editor(db, actor);
  const ids = await scopedIds(db, actor, input.employeeIds);
  const scheduleType = input.scheduleType === undefined || input.scheduleType === "" ? null : String(input.scheduleType);
  if (scheduleType !== null && !SHIFT_TYPES.includes(scheduleType)) throw fail("Invalid shift type");
  const optionalId = async (value: unknown, table: string) => {
    if (value === undefined) return undefined;
    const id = Number(value);
    if (!id) return null;
    if (!(await db.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(id).first())) throw fail("Selection not found", 404);
    return id;
  };
  const attendanceTypeId = await optionalId(input.attendanceTypeId, "attendance_types"), shiftPlanId = await optionalId(input.shiftPlanId, "shift_plans");
  await db.transaction(async tx => {
    if (scheduleType) await tx.prepare("UPDATE employees SET schedule_type=?,updated_at=CURRENT_TIMESTAMP WHERE id=ANY(?::int[])").bind(scheduleType, ids).run();
    if (attendanceTypeId !== undefined) await tx.prepare("UPDATE employees SET attendance_type_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=ANY(?::int[])").bind(attendanceTypeId, ids).run();
    if (shiftPlanId !== undefined) await tx.prepare("UPDATE employees SET shift_plan_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=ANY(?::int[])").bind(shiftPlanId, ids).run();
    await audit(tx, request, actor, "timesheet_employee_schedule_changed", "employee_schedule", ids.join(","), null, { ids, scheduleType, attendanceTypeId, shiftPlanId });
  });
  return { updated: ids.length };
}

export async function saveAttendanceTypeExtras(db: PostgresDatabase, request: Request, actor: ApiActor, input: Record<string, unknown>) {
  await editor(db, actor);
  const id = Number(input.id), early = Math.round(Number(input.earlyExitAllowanceMinutes) || 0);
  if (!id || early < 0 || early > 240) throw fail("Invalid attendance type");
  const days = [...new Set(String(input.weekendDays ?? "").split(",").map(item => item.trim()).filter(Boolean))];
  if (days.some(day => !/^[0-6]$/.test(day))) throw fail("Weekend days must be weekday numbers 0-6");
  const updated = await db.prepare("UPDATE attendance_types SET early_exit_allowance_minutes=?,weekend_days=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING id").bind(early, days.sort().join(","), id).first();
  if (!updated) throw fail("Attendance type not found", 404);
  await audit(db, request, actor, "timesheet_attendance_type_changed", "attendance_type", String(id), null, { early, days });
  return { id };
}

export async function saveShiftPlan(db: PostgresDatabase, request: Request, actor: ApiActor, input: Record<string, unknown>) {
  await editor(db, actor);
  const nameEn = clean(input.nameEn), nameAr = clean(input.nameAr), status = input.status === "inactive" ? "inactive" : "active";
  if (!nameEn || !nameAr) throw fail("Enter the plan name in Arabic and English");
  const days = (Array.isArray(input.days) ? input.days : []) as Record<string, unknown>[];
  const parsed = days.map(day => {
    const weekday = Number(day.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw fail("Invalid weekday");
    const off = Boolean(day.isOff);
    return { weekday, off, start: off ? null : time(day.startTime, "Start time"), end: off ? null : time(day.endTime, "End time"), breakMinutes: off ? 0 : minutes(day.breakMinutes) };
  });
  if (new Set(parsed.map(day => day.weekday)).size !== parsed.length) throw fail("Each weekday can appear once");
  const id = await db.transaction(async tx => {
    let planId = Number(input.id) || 0;
    if (planId) {
      if (!(await tx.prepare("UPDATE shift_plans SET name_en=?,name_ar=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING id").bind(nameEn, nameAr, status, planId).first())) throw fail("Shift plan not found", 404);
      await tx.prepare("DELETE FROM shift_plan_details WHERE plan_id=?").bind(planId).run();
    } else planId = Number((await tx.prepare("INSERT INTO shift_plans (name_en,name_ar,status,created_at,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").bind(nameEn, nameAr, status).first<{ id: number }>())!.id);
    for (const day of parsed) await tx.prepare("INSERT INTO shift_plan_details (plan_id,weekday,start_time,end_time,break_minutes,is_off) VALUES (?,?,?,?,?,?)").bind(planId, day.weekday, day.start, day.end, day.breakMinutes, day.off ? 1 : 0).run();
    await audit(tx, request, actor, "timesheet_shift_plan_saved", "shift_plan", String(planId), null, { nameEn, days: parsed.length });
    return planId;
  });
  return { id };
}

export async function deleteShiftPlan(db: PostgresDatabase, request: Request, actor: ApiActor, id: number) {
  await editor(db, actor);
  const used = await db.prepare("SELECT count(*)::int AS n FROM employees WHERE shift_plan_id=? AND employment_status!='deleted'").bind(id).first<{ n: number }>();
  if (Number(used?.n) > 0) throw fail("This shift plan is assigned to employees; reassign them first", 409);
  await db.transaction(async tx => {
    await tx.prepare("DELETE FROM shift_plan_details WHERE plan_id=?").bind(id).run();
    await tx.prepare("DELETE FROM shift_plans WHERE id=?").bind(id).run();
    await audit(tx, request, actor, "timesheet_shift_plan_deleted", "shift_plan", String(id), null, null);
  });
  return { id };
}

/** Rotating shifts: one shift (or a day off) for the chosen employees on every chosen weekday of a date range. */
export async function saveAssignments(db: PostgresDatabase, request: Request, actor: ApiActor, input: Record<string, unknown>) {
  await editor(db, actor);
  const ids = await scopedIds(db, actor, input.employeeIds);
  const from = String(input.from ?? ""), to = String(input.to ?? "");
  if (!isDate(from) || !isDate(to) || from > to) throw fail("Select a valid period");
  if (daysBetween(from, to) > MAX_ASSIGNMENT_DAYS) throw fail("The period cannot exceed 93 days");
  const off = Boolean(input.isOff), start = off ? null : time(input.startTime, "Start time"), end = off ? null : time(input.endTime, "End time"), breakMinutes = off ? 0 : minutes(input.breakMinutes);
  const weekdays = Array.isArray(input.weekdays) && input.weekdays.length ? input.weekdays.map(Number) : [0, 1, 2, 3, 4, 5, 6];
  const dates = eachDate(from, to).filter(date => weekdays.includes(weekdayOf(date)));
  await db.transaction(async tx => {
    for (const employeeId of ids) for (const date of dates) {
      await tx.prepare(`INSERT INTO shift_assignments (employee_id,shift_date,start_time,end_time,break_minutes,is_off,created_at,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT (employee_id,shift_date) DO UPDATE SET start_time=excluded.start_time,end_time=excluded.end_time,break_minutes=excluded.break_minutes,is_off=excluded.is_off,updated_at=CURRENT_TIMESTAMP`).bind(employeeId, date, start, end, breakMinutes, off ? 1 : 0).run();
    }
    await audit(tx, request, actor, "timesheet_assignments_saved", "shift_assignment", ids.join(","), null, { from, to, employees: ids.length, days: dates.length, off });
  });
  return { employees: ids.length, days: dates.length };
}

export async function clearAssignments(db: PostgresDatabase, request: Request, actor: ApiActor, input: Record<string, unknown>) {
  await editor(db, actor);
  const ids = await scopedIds(db, actor, input.employeeIds);
  const from = String(input.from ?? ""), to = String(input.to ?? "");
  if (!isDate(from) || !isDate(to) || from > to) throw fail("Select a valid period");
  const removed = await db.prepare("DELETE FROM shift_assignments WHERE employee_id=ANY(?::int[]) AND shift_date>=? AND shift_date<=? RETURNING id").bind(ids, from, to).all();
  await audit(db, request, actor, "timesheet_assignments_cleared", "shift_assignment", ids.join(","), null, { from, to, removed: removed.results.length });
  return { removed: removed.results.length };
}

export async function setHolidayReligion(db: PostgresDatabase, request: Request, actor: ApiActor, input: Record<string, unknown>) {
  await editor(db, actor);
  const religion = clean(input.religion, 20).toLowerCase();
  if (!RELIGIONS.includes(religion)) throw fail("Invalid religion");
  const row = await db.prepare("UPDATE holidays SET religion=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING id").bind(religion || null, Number(input.id)).first();
  if (!row) throw fail("Holiday not found", 404);
  await audit(db, request, actor, "timesheet_holiday_religion_changed", "holiday", String(input.id), null, { religion });
  return { id: Number(input.id), religion };
}

export { setCompanyWfhDay };
