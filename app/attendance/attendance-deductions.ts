import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";

/**
 * Links Settings → HR Settings → deduction & overtime rules to daily attendance. Pure matching, shared by the
 * attendance report (per-day rule + wage-days) and payroll (money). Nothing is stored: a rule change applies to every
 * report and to the next payroll generation.
 *
 * - Late: matched on minutes after the scheduled start (the rule ranges include the grace window), only on days the
 *   calculation marked late. Overlapping ranges resolve to the most specific one (highest start, then narrowest).
 * - Absence: "with notice" when HR excused the absence (its exception resolved or dismissed), otherwise "without
 *   notice"; a rule with no notice set covers both.
 * - Overtime: the rule's multiplier applies to the day's overtime minutes inside its range.
 */
export type DeductionRule = {
  id: number; name_en: string; name_ar: string; rule_type: string; min_minutes: number | null; max_minutes: number | null;
  deduction_type: string | null; value: number | null; overtime_multiplier: number | null; absence_notice: string | null;
};
export type AttendanceDay = {
  status?: unknown; scheduled_in?: unknown; actual_in?: unknown; late_minutes?: unknown; overtime_minutes?: unknown;
  absence_exception_status?: unknown;
};
export type DayDeduction = { rule: DeductionRule; wageDays: number; fixedAmount: number };
export type DayOvertime = { rule: DeductionRule | null; minutes: number; multiplier: number };

const EXCUSED = ["resolved", "dismissed"];
const clock = (value: unknown) => /^([01]\d|2[0-3]):[0-5]\d/.test(String(value ?? "")) ? Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(3, 5)) : null;
const end = (rule: DeductionRule) => (rule.max_minutes === null || rule.max_minutes === undefined ? Infinity : Number(rule.max_minutes));
const inRange = (rule: DeductionRule, minutes: number) => Number(rule.min_minutes ?? 0) <= minutes && minutes <= end(rule);
const mostSpecific = (rules: DeductionRule[]) => [...rules].sort((a, b) => Number(b.min_minutes ?? 0) - Number(a.min_minutes ?? 0) || end(a) - end(b) || a.id - b.id)[0] ?? null;

export async function loadDeductionRules(db: PostgresDatabase | TransactionDatabase): Promise<DeductionRule[]> {
  const rows = await db.prepare("SELECT id,name_en,name_ar,rule_type,min_minutes,max_minutes,deduction_type,value,overtime_multiplier,absence_notice FROM deduction_rules WHERE status='active' ORDER BY id").all<DeductionRule>();
  return rows.results.map(row => ({ ...row, id: Number(row.id) }));
}

/** Minutes after the scheduled start; a check-in across midnight from the schedule is not lateness. */
export function minutesAfterStart(day: AttendanceDay): number {
  const scheduled = clock(day.scheduled_in), actual = clock(day.actual_in);
  if (scheduled === null || actual === null) return Number(day.late_minutes) || 0;
  let diff = actual - scheduled;
  if (diff < -720) diff += 1440;
  return Math.max(0, diff);
}

export const absenceNotice = (day: AttendanceDay) => (EXCUSED.includes(String(day.absence_exception_status)) ? "with_notice" : "without_notice");

function amounts(rule: DeductionRule): DayDeduction {
  const value = Number(rule.value) || 0;
  if (rule.deduction_type === "fixed_amount") return { rule, wageDays: 0, fixedAmount: value };
  if (rule.deduction_type === "days_of_wage") return { rule, wageDays: value, fixedAmount: 0 };
  return { rule, wageDays: value / 100, fixedAmount: 0 };
}

export function dayDeduction(rules: DeductionRule[], day: AttendanceDay): DayDeduction | null {
  if (day.status === "absent") {
    const notice = absenceNotice(day), absence = rules.filter(rule => rule.rule_type === "absence");
    const rule = absence.find(item => item.absence_notice === notice) ?? absence.find(item => !item.absence_notice);
    return rule ? amounts(rule) : null;
  }
  if (Number(day.late_minutes) > 0) {
    const late = minutesAfterStart(day), rule = mostSpecific(rules.filter(item => item.rule_type === "late_arrival" && inRange(item, late)));
    return rule ? amounts(rule) : null;
  }
  return null;
}

/** With no active overtime rule every overtime minute keeps the payroll-settings multiplier. */
export function dayOvertime(rules: DeductionRule[], day: AttendanceDay, fallbackMultiplier: number): DayOvertime | null {
  const minutes = Number(day.overtime_minutes) || 0;
  if (minutes <= 0) return null;
  const overtime = rules.filter(rule => rule.rule_type === "overtime");
  if (!overtime.length) return { rule: null, minutes, multiplier: fallbackMultiplier };
  const rule = mostSpecific(overtime.filter(item => inRange(item, minutes)));
  return rule ? { rule, minutes, multiplier: Number(rule.overtime_multiplier) || fallbackMultiplier } : null;
}

/**
 * Period totals in wage units, so callers apply their own daily and hourly rates. Without any active absence rule an
 * absent day still costs one day's wage, as payroll did before rules existed.
 */
export function summarizeAttendanceDeductions(rules: DeductionRule[], days: AttendanceDay[], fallbackMultiplier: number) {
  const hasAbsenceRule = rules.some(rule => rule.rule_type === "absence");
  let wageDays = 0, fixedAmount = 0, overtimeHours = 0, lateDays = 0, absentDays = 0;
  for (const day of days) {
    const deduction = dayDeduction(rules, day);
    if (deduction) { wageDays += deduction.wageDays; fixedAmount += deduction.fixedAmount; }
    else if (day.status === "absent" && !hasAbsenceRule) wageDays += 1;
    if (day.status === "absent") absentDays += 1; else if (deduction) lateDays += 1;
    const overtime = dayOvertime(rules, day, fallbackMultiplier);
    if (overtime) overtimeHours += (overtime.minutes / 60) * overtime.multiplier;
  }
  return { wageDays, fixedAmount, overtimeHours, lateDays, absentDays };
}

/** SQL column that reports the day's absence exception status, for `absenceNotice`. `a` is daily_attendance. */
export const ABSENCE_EXCEPTION_STATUS_SQL = "(SELECT x.status FROM attendance_exceptions x WHERE x.employee_id=a.employee_id AND x.attendance_date=a.work_date AND x.exception_type='absent' LIMIT 1) AS absence_exception_status";
