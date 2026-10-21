import { clockToMinutes, isClock } from "./time.ts";
import type { ResolvedSchedule } from "./schedule.ts";

/**
 * The Timesheet calculation for one employee on one day. Pure: the loaders in service.ts gather punches, schedule, holiday,
 * vacation, WFH and request facts, this decides the row. Rules (specification §8):
 *  - Official holiday, approved vacation and approved/company WFH days are never absent (priority in that order).
 *  - Actual times: manual changed times, then the first/last punch.
 *  - A working day with no times is absent once the day is over; check-in only means waiting for exit.
 *  - Late / early leave subtract the grace allowance; overtime is time worked beyond the scheduled end.
 *  - An approved delay or early-leave request zeroes the matching minutes.
 *  - Manual decisions survive: a cleared or marked absence, approved/rejected status, notice status and notes live on the row.
 */
export type DayOverride = { kind: "holiday" | "vacation" | "wfh"; labelEn: string; labelAr: string };
export type EngineExisting = {
  status?: string | null; absenceOverride?: string | null; breakDurationMinutes?: number | null;
  /** True when HR entered the break by hand, so recalculation keeps it instead of using the schedule's. */
  breakManual?: boolean;
};
export type EngineInput = {
  workDate: string;
  schedule: ResolvedSchedule;
  override?: DayOverride | null;
  punches?: { first: string | null; last: string | null; count: number } | null;
  manual?: { start?: string | null; end?: string | null } | null;
  existing?: EngineExisting | null;
  /** Approved "Late arrival" / "Early departure" requests for this date. */
  approvedDelay?: boolean;
  approvedEarlyLeave?: boolean;
  /** Employees who are not required to punch count as attended on working days. */
  fingerprintRequired?: boolean;
  /** False when no biometric/attendance data exists for that country and day: a missing punch is then unknown, never an absence. */
  dataCovered?: boolean;
  /** Today in the employee's zone; days before it are over. */
  today: string;
  /** Overtime inside the rule's range only: a function so the caller owns rule lookup. null = no overtime counts. */
  overtimeAllowed?: (minutes: number) => boolean;
};
export type EngineStatus = "pending" | "waiting_for_exit" | "approved" | "rejected" | "absent" | "vacation" | "holiday" | "wfh";
export type EngineResult = {
  scheduledStart: string | null; scheduledEnd: string | null; actualStart: string | null; actualEnd: string | null;
  breakDurationMinutes: number; status: EngineStatus; isAbsent: boolean;
  lateMinutes: number; earlyLeaveMinutes: number; overtimeMinutes: number; totalWorkMinutes: number;
  /** Minutes after the scheduled start before the grace allowance, which the late deduction ranges are written against. */
  minutesAfterStart: number;
  labelEn: string | null; labelAr: string | null;
  autoAttended: boolean;
};

const time = (value: unknown) => (isClock(value) ? value : null);

export function calculateTimesheetDay(input: EngineInput): EngineResult {
  const { schedule, existing } = input;
  const manualStart = time(input.manual?.start), manualEnd = time(input.manual?.end);
  const punchFirst = time(input.punches?.first), punchLast = (input.punches?.count ?? 0) > 1 ? time(input.punches?.last) : null;
  let actualStart = manualStart ?? punchFirst, actualEnd = manualEnd ?? punchLast;
  const hasTimes = Boolean(actualStart || actualEnd);
  const dayOver = input.workDate < input.today;
  const breakMinutes = existing?.breakManual && existing.breakDurationMinutes != null ? Math.max(0, existing.breakDurationMinutes) : schedule.breakMinutes;
  const result: EngineResult = {
    scheduledStart: schedule.isOff ? null : schedule.start, scheduledEnd: schedule.isOff ? null : schedule.end,
    actualStart, actualEnd, breakDurationMinutes: breakMinutes, status: "pending", isAbsent: false,
    lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, totalWorkMinutes: 0, minutesAfterStart: 0,
    labelEn: input.override?.labelEn ?? null, labelAr: input.override?.labelAr ?? null, autoAttended: false,
  };

  const worked = () => {
    if (!actualStart || !actualEnd) return 0;
    const start = clockToMinutes(actualStart), end = clockToMinutes(actualEnd);
    return Math.max(0, (end >= start ? end - start : end + 1440 - start) - breakMinutes);
  };

  // A holiday, approved vacation or WFH day keeps whatever was punched but never turns into an absence, a delay or a deduction.
  if (input.override) {
    result.status = input.override.kind;
    result.totalWorkMinutes = worked();
    if (input.override.kind === "wfh" && !schedule.isOff && schedule.start && schedule.end) applyMeasures(result, input, schedule, actualStart, actualEnd);
    return result;
  }

  if (schedule.isOff || !schedule.start || !schedule.end) {
    result.totalWorkMinutes = worked();
    result.status = !hasTimes ? "pending" : !actualEnd ? "waiting_for_exit" : keepDecision(existing);
    return result;
  }

  if (!hasTimes) {
    if (input.fingerprintRequired === false) {
      result.actualStart = schedule.start; result.actualEnd = schedule.end; actualStart = schedule.start; actualEnd = schedule.end;
      result.totalWorkMinutes = worked(); result.status = "approved"; result.autoAttended = true;
      return result;
    }
    const forced = existing?.absenceOverride === "absent", cleared = existing?.absenceOverride === "present";
    if (forced || (!cleared && dayOver && input.dataCovered !== false)) { result.status = "absent"; result.isAbsent = true; }
    return result;
  }

  // Times were punched or entered by hand on this working day.
  if (existing?.absenceOverride === "absent" && !manualStart && !manualEnd) { result.status = "absent"; result.isAbsent = true; return result; }
  applyMeasures(result, input, schedule, actualStart, actualEnd);
  result.totalWorkMinutes = worked();
  result.status = !actualEnd ? "waiting_for_exit" : keepDecision(existing);
  return result;
}

/** A finished day goes to approval; an approved or rejected decision HR already made is kept. */
function keepDecision(existing: EngineExisting | null | undefined): EngineStatus {
  return existing?.status === "approved" || existing?.status === "rejected" ? existing.status : "pending";
}

function applyMeasures(result: EngineResult, input: EngineInput, schedule: ResolvedSchedule, actualStart: string | null, actualEnd: string | null) {
  const scheduledStart = clockToMinutes(schedule.start!);
  const scheduledEnd = clockToMinutes(schedule.end!) <= scheduledStart ? clockToMinutes(schedule.end!) + 1440 : clockToMinutes(schedule.end!);
  if (actualStart) {
    let diff = clockToMinutes(actualStart) - scheduledStart;
    if (diff < -720) diff += 1440; // a check-in just before midnight for an early-morning shift is not lateness
    const after = Math.max(0, diff);
    result.minutesAfterStart = input.approvedDelay ? 0 : after;
    result.lateMinutes = input.approvedDelay ? 0 : Math.max(0, after - schedule.graceLate);
  }
  if (actualStart && actualEnd) {
    const start = clockToMinutes(actualStart);
    let end = clockToMinutes(actualEnd);
    if (end <= start) end += 1440;
    // Bring both sides onto the same side of midnight as the shift when the shift itself crosses it.
    const shiftedEnd = scheduledEnd;
    result.earlyLeaveMinutes = input.approvedEarlyLeave ? 0 : Math.max(0, shiftedEnd - end - schedule.graceEarly);
    const beyond = Math.max(0, end - shiftedEnd);
    result.overtimeMinutes = beyond > 0 && (!input.overtimeAllowed || input.overtimeAllowed(beyond)) ? beyond : 0;
  }
}
