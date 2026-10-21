import { isClock, spanMinutes, weekdayOf } from "./time.ts";

/**
 * Which shift an employee is expected to work on a date. Sources, in the order the Timesheet specification names them:
 *  1. the employee's attendance type, when it has fixed times and is not shift based;
 *  2. a rotating employee's shift assignment for that date;
 *  3. a shift employee's weekly shift plan for that weekday;
 *  4. the employee's own fixed shift (check-in/out times and work days).
 * A rotating or shift employee with nothing assigned for the day follows the fixed shift instead of silently having no work.
 * A weekend, plan off-day or assigned day off is "no shift": it is never late, early or absent.
 */
export type ScheduleEmployee = {
  schedule_type?: unknown; work_days?: unknown; check_in_time?: unknown; check_out_time?: unknown;
  grace_minutes?: unknown; required_daily_minutes?: unknown;
};
export type ScheduleAttendanceType = {
  shift_based?: unknown; start_time?: unknown; end_time?: unknown; late_allowance_minutes?: unknown;
  early_exit_allowance_minutes?: unknown; weekend_days?: unknown;
};
export type ScheduleDay = { start_time?: unknown; end_time?: unknown; break_minutes?: unknown; is_off?: unknown };
export type ScheduleInput = {
  date: string; employee: ScheduleEmployee; attendanceType?: ScheduleAttendanceType | null;
  planDay?: ScheduleDay | null; assignment?: ScheduleDay | null;
};
export type ScheduleSource = "attendance_type" | "assignment" | "shift_plan" | "fixed";
export type ResolvedSchedule = {
  source: ScheduleSource; isOff: boolean; start: string | null; end: string | null; breakMinutes: number;
  graceLate: number; graceEarly: number; requiredMinutes: number;
};

const weekdays = (value: unknown) => new Set(String(value ?? "").split(",").map(item => item.trim()).filter(item => /^[0-6]$/.test(item)).map(Number));
const clock = (value: unknown) => (isClock(String(value ?? "").slice(0, 5)) ? String(value).slice(0, 5) : null);
const whole = (value: unknown, fallback = 0) => { const number = Math.round(Number(value)); return Number.isFinite(number) && number >= 0 ? number : fallback; };

export function resolveSchedule(input: ScheduleInput): ResolvedSchedule {
  const { employee, date } = input, weekday = weekdayOf(date);
  const type = input.attendanceType, kind = String(employee.schedule_type ?? "fixed");
  const employeeGrace = whole(employee.grace_minutes);
  const fixedStart = clock(employee.check_in_time) ?? "09:00", fixedEnd = clock(employee.check_out_time) ?? "17:00";
  const build = (source: ScheduleSource, isOff: boolean, start: string | null, end: string | null, breakMinutes: number, graceLate: number, graceEarly: number): ResolvedSchedule => {
    const length = !isOff && start && end ? Math.max(0, spanMinutes(start, end) - breakMinutes) : 0;
    return { source, isOff: isOff || !start || !end, start: isOff ? null : start, end: isOff ? null : end, breakMinutes, graceLate, graceEarly, requiredMinutes: length || whole(employee.required_daily_minutes, 480) };
  };

  const typeStart = clock(type?.start_time), typeEnd = clock(type?.end_time);
  if (type && !Number(type.shift_based) && typeStart && typeEnd) {
    const explicit = weekdays(type.weekend_days), work = weekdays(employee.work_days);
    const off = explicit.size ? explicit.has(weekday) : !work.has(weekday);
    return build("attendance_type", off, typeStart, typeEnd, 0, whole(type.late_allowance_minutes), whole(type.early_exit_allowance_minutes));
  }
  if (kind === "rotating" && input.assignment) {
    const a = input.assignment;
    return build("assignment", Boolean(Number(a.is_off)), clock(a.start_time), clock(a.end_time), whole(a.break_minutes), employeeGrace, whole(type?.early_exit_allowance_minutes));
  }
  if (kind === "shift" && input.planDay) {
    const d = input.planDay;
    return build("shift_plan", Boolean(Number(d.is_off)), clock(d.start_time), clock(d.end_time), whole(d.break_minutes), employeeGrace, whole(type?.early_exit_allowance_minutes));
  }
  const work = weekdays(employee.work_days || "0,1,2,3,4");
  return build("fixed", !work.has(weekday), fixedStart, fixedEnd, 0, employeeGrace, whole(type?.early_exit_allowance_minutes));
}
