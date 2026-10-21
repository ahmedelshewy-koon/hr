import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";
import { calculateTimesheetDay, type EngineResult } from "./engine.ts";
import { dayMoney, overtimeCounts, type DeductionComponent } from "./deductions.ts";
import {
  basicSalaryOn, dayKey, dayOverride, employedOn, loadFacts, lockState, planDayFor, type Facts, type Row, type TimesheetEmployee,
} from "./facts.ts";
import { resolveSchedule, type ScheduleEmployee } from "./schedule.ts";
import { eachDate, localNow, timeZoneForCountry, weekdayOf } from "./time.ts";

type Db = PostgresDatabase | TransactionDatabase;

export type TimesheetDraft = EngineResult & {
  employeeId: number; workDate: string; deductionAmount: number; overtimeAmount: number; deductionRuleId: number | null;
  deductionDetails: DeductionComponent[]; existed: boolean;
};

/** The shift expected on a date, honouring a day HR scheduled by hand (Edit Timesheet Entry). */
export function scheduleFor(facts: Facts, employee: TimesheetEmployee, date: string) {
  const key = dayKey(employee.id, date), existing = facts.existing.get(key) ?? null;
  const resolved = resolveSchedule({
    date, employee: employee as ScheduleEmployee, attendanceType: employee.attendance_type_id ? facts.attendanceTypes.get(Number(employee.attendance_type_id)) : null,
    planDay: planDayFor(facts, employee, date, weekdayOf(date)), assignment: facts.assignments.get(key) ?? null,
  });
  return existing && Number(existing.schedule_override) === 1 && existing.scheduled_start && existing.scheduled_end
    ? { ...resolved, isOff: false, start: String(existing.scheduled_start), end: String(existing.scheduled_end) } : resolved;
}

/**
 * Builds the timesheet row for one employee and day from the loaded facts, or null when the day needs no row (rest day with
 * nothing recorded, a day before the job start or after the termination, a day that has not happened yet, a day with no
 * attendance data at all).
 */
export function buildDraft(facts: Facts, employee: TimesheetEmployee, date: string, now = new Date()): TimesheetDraft | null {
  if (!employedOn(employee, date)) return null;
  const key = dayKey(employee.id, date), existing = facts.existing.get(key) ?? null;
  const today = localNow(timeZoneForCountry(employee.country), now).date;
  if (date > today && !existing) return null;
  const schedule = scheduleFor(facts, employee, date);
  const override = dayOverride(facts, employee, date);
  const device = facts.devicePunches.get(key) ?? null, remote = facts.remoteSessions.get(key) ?? null;
  const legacy = facts.legacy.get(key) ?? null;
  const punches = (override?.kind === "wfh" ? (remote ?? device) : (device ?? remote)) ?? legacy;
  const dataCovered = facts.coverage.has(`${employee.country}|${date}`);
  const manual = existing ? { start: (existing.changed_start as string | null) ?? null, end: (existing.changed_end as string | null) ?? null } : null;
  // No data for that day at all (history before the devices were connected): nothing to say about it, so no row.
  if (!dataCovered && !punches && !override && !existing) return null;
  if (schedule.isOff && !override && !punches && !manual?.start && !manual?.end && !existing) return null;

  const result = calculateTimesheetDay({
    workDate: date, schedule, override, punches, manual, today, dataCovered,
    existing: existing ? { status: existing.status as string, absenceOverride: (existing.absence_override as string | null) ?? null, breakDurationMinutes: Number(existing.break_duration_minutes) || 0, breakManual: existing.changed_by != null } : null,
    approvedDelay: facts.delayDates.has(key), approvedEarlyLeave: facts.earlyDates.has(key),
    fingerprintRequired: Number(employee.fingerprint_required ?? 1) !== 0,
    overtimeAllowed: minutes => overtimeCounts(facts.rules, minutes),
  });

  const money = dayMoney(facts.rules, {
    isAbsent: result.isAbsent, absenceHasNotice: existing?.absence_has_notice == null ? null : Number(existing.absence_has_notice),
    minutesAfterStart: result.minutesAfterStart, lateMinutes: result.lateMinutes, earlyLeaveMinutes: result.earlyLeaveMinutes, overtimeMinutes: result.overtimeMinutes,
  }, basicSalaryOn(facts, employee, date), schedule.requiredMinutes, facts.payrollMultiplier);
  return { ...result, employeeId: employee.id, workDate: date, deductionAmount: money.deductionAmount, overtimeAmount: money.overtimeAmount, deductionRuleId: money.primaryRuleId, deductionDetails: money.components, existed: Boolean(existing) };
}

/**
 * A row an earlier calculation created for a day that has no attendance data at all and that nobody has touched (no manual
 * times, note, notice, decision or mail). Such a row only records a guessed absence, so recalculation removes it.
 */
export function staleEmptyRow(facts: Facts, employee: TimesheetEmployee, date: string): number | null {
  const key = dayKey(employee.id, date), existing = facts.existing.get(key);
  if (!existing) return null;
  const touched = existing.changed_by != null || existing.manager_note || existing.notes || existing.approved_by != null || existing.absence_has_notice != null || existing.absence_override
    || Number(existing.deduction_notification_sent) === 1 || Number(existing.schedule_override) === 1 || existing.actual_start || existing.actual_end;
  if (touched || facts.devicePunches.has(key) || facts.remoteSessions.has(key) || facts.legacy.has(key) || facts.coverage.has(`${employee.country}|${date}`)) return null;
  if (dayOverride(facts, employee, date)) return null;
  return Number(existing.id);
}

const UPSERT = `INSERT INTO timesheets (employee_id,work_date,scheduled_start,scheduled_end,actual_start,actual_end,break_duration_minutes,status,is_absent,late_minutes,early_leave_minutes,overtime_minutes,total_work_minutes,deduction_amount,overtime_amount,deduction_rule_id,deduction_details,label_en,label_ar,created_at,updated_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT (employee_id,work_date) DO UPDATE SET scheduled_start=excluded.scheduled_start,scheduled_end=excluded.scheduled_end,actual_start=excluded.actual_start,actual_end=excluded.actual_end,
break_duration_minutes=excluded.break_duration_minutes,status=excluded.status,is_absent=excluded.is_absent,late_minutes=excluded.late_minutes,early_leave_minutes=excluded.early_leave_minutes,
overtime_minutes=excluded.overtime_minutes,total_work_minutes=excluded.total_work_minutes,
deduction_notification_sent=CASE WHEN timesheets.deduction_amount IS DISTINCT FROM excluded.deduction_amount THEN 0 ELSE timesheets.deduction_notification_sent END,
deduction_notification_sent_at=CASE WHEN timesheets.deduction_amount IS DISTINCT FROM excluded.deduction_amount THEN NULL ELSE timesheets.deduction_notification_sent_at END,
deduction_amount=excluded.deduction_amount,overtime_amount=excluded.overtime_amount,deduction_rule_id=excluded.deduction_rule_id,deduction_details=excluded.deduction_details,
label_en=excluded.label_en,label_ar=excluded.label_ar,updated_at=CURRENT_TIMESTAMP`;

const draftBindings = (draft: TimesheetDraft) => [
  draft.employeeId, draft.workDate, draft.scheduledStart, draft.scheduledEnd, draft.actualStart, draft.actualEnd, draft.breakDurationMinutes, draft.status, draft.isAbsent ? 1 : 0,
  draft.lateMinutes, draft.earlyLeaveMinutes, draft.overtimeMinutes, draft.totalWorkMinutes, draft.deductionAmount, draft.overtimeAmount, draft.deductionRuleId,
  draft.deductionDetails.length ? JSON.stringify(draft.deductionDetails) : null, draft.labelEn, draft.labelAr,
];

export type RecalculateSummary = { employees: number; days: number; created: number; updated: number; skippedLocked: number; removed: number };

/**
 * Recalculates every employee × day in scope. Days inside a confirmed month (without an open edit permission) or a locked
 * payroll period are left exactly as they are. `ignoreLocks` is for one-row saves the caller already authorised.
 */
export async function recalculateRange(db: Db, employees: TimesheetEmployee[], from: string, to: string, options: { ignoreLocks?: boolean; now?: Date } = {}): Promise<RecalculateSummary> {
  const summary: RecalculateSummary = { employees: employees.length, days: 0, created: 0, updated: 0, skippedLocked: 0, removed: 0 };
  if (!employees.length) return summary;
  const facts = await loadFacts(db, employees, from, to);
  const statements = [];
  for (const employee of employees) {
    for (const date of eachDate(from, to)) {
      const locked = !options.ignoreLocks && lockState(facts, employee, date) !== "open";
      const stale = staleEmptyRow(facts, employee, date);
      if (stale !== null && !locked && employedOn(employee, date)) { summary.removed++; statements.push(db.prepare("DELETE FROM timesheets WHERE id=?").bind(stale)); continue; }
      const draft = buildDraft(facts, employee, date, options.now);
      if (!draft) continue;
      if (locked) { summary.skippedLocked++; continue; }
      summary.days++;
      if (draft.existed) summary.updated++; else summary.created++;
      statements.push(db.prepare(UPSERT).bind(...draftBindings(draft)));
    }
  }
  for (let start = 0; start < statements.length; start += 300) await db.batch(statements.slice(start, start + 300));
  return summary;
}

export type { Row };
