import assert from "node:assert/strict";
import test from "node:test";
import { calculateTimesheetDay } from "../app/timesheet/engine.ts";
import { resolveSchedule } from "../app/timesheet/schedule.ts";
import { dayMoney, overtimeCounts } from "../app/timesheet/deductions.ts";
import { deductionSummary, matchesCard, naughtyCorner, summarize } from "../app/timesheet/summary.ts";
import { monthKeyOf, normalizePayrollCountry, periodForMonth } from "../app/timesheet/time.ts";
import { resolveFilters } from "../app/timesheet/filters.ts";
import { statusLabel } from "../app/timesheet/labels.ts";

const employee = { schedule_type: "fixed", work_days: "0,1,2,3,4", check_in_time: "09:00", check_out_time: "17:00", grace_minutes: 15, required_daily_minutes: 480 };
const schedule = resolveSchedule({ date: "2026-10-12", employee }); // Monday
const base = { workDate: "2026-10-12", schedule, today: "2026-10-13" };

test("payroll period runs from the 26th of the previous month to the 25th", () => {
  assert.deepEqual(periodForMonth("2026-10"), { from: "2026-09-26", to: "2026-10-25" });
  assert.deepEqual(periodForMonth("2026-01"), { from: "2025-12-26", to: "2026-01-25" });
  assert.equal(monthKeyOf("2026-09-26"), "2026-10");
  assert.equal(monthKeyOf("2026-10-25"), "2026-10");
  assert.equal(monthKeyOf("2026-12-30"), "2027-01");
  assert.equal(normalizePayrollCountry("Saudi Arabia"), "KSA");
});

test("late and early leave subtract the grace allowance; overtime is time past the scheduled end", () => {
  const late = calculateTimesheetDay({ ...base, punches: { first: "09:40", last: "17:00", count: 2 } });
  assert.equal(late.lateMinutes, 25); assert.equal(late.minutesAfterStart, 40); assert.equal(late.status, "pending");
  const early = calculateTimesheetDay({ ...base, punches: { first: "09:00", last: "16:20", count: 2 } });
  assert.equal(early.earlyLeaveMinutes, 40);
  const overtime = calculateTimesheetDay({ ...base, punches: { first: "09:00", last: "18:30", count: 2 } });
  assert.equal(overtime.overtimeMinutes, 90); assert.equal(overtime.totalWorkMinutes, 570);
});

test("no punches on a past working day is absent; today is still pending; check-in only waits for exit", () => {
  assert.equal(calculateTimesheetDay(base).isAbsent, true);
  assert.equal(calculateTimesheetDay({ ...base, today: "2026-10-12" }).isAbsent, false);
  assert.equal(calculateTimesheetDay({ ...base, punches: { first: "09:00", last: null, count: 1 } }).status, "waiting_for_exit");
});

test("holiday, vacation and WFH days are never absent", () => {
  for (const kind of ["holiday", "vacation", "wfh"]) {
    const result = calculateTimesheetDay({ ...base, override: { kind, labelEn: "x", labelAr: "س" } });
    assert.equal(result.isAbsent, false); assert.equal(result.status, kind); assert.equal(result.lateMinutes, 0);
  }
  const vacationWithPunch = calculateTimesheetDay({ ...base, override: { kind: "vacation", labelEn: "Sick Leave", labelAr: "مرضية" }, punches: { first: "11:00", last: "12:00", count: 2 } });
  assert.equal(vacationWithPunch.lateMinutes, 0);
});

test("approved delay and early-leave requests zero the matching minutes", () => {
  const result = calculateTimesheetDay({ ...base, punches: { first: "10:00", last: "16:00", count: 2 }, approvedDelay: true, approvedEarlyLeave: true });
  assert.equal(result.lateMinutes, 0); assert.equal(result.earlyLeaveMinutes, 0);
});

test("manual times win over punches and clear an absence; manual decisions survive recalculation", () => {
  const manual = calculateTimesheetDay({ ...base, manual: { start: "09:00", end: "17:00" } });
  assert.equal(manual.isAbsent, false); assert.equal(manual.lateMinutes, 0);
  const manualOverPunch = calculateTimesheetDay({ ...base, punches: { first: "10:30", last: "17:00", count: 2 }, manual: { start: "09:10", end: null } });
  assert.equal(manualOverPunch.actualStart, "09:10"); assert.equal(manualOverPunch.lateMinutes, 0);
  assert.equal(calculateTimesheetDay({ ...base, existing: { absenceOverride: "present" } }).isAbsent, false, "HR cleared the absence");
  assert.equal(calculateTimesheetDay({ ...base, today: "2026-10-12", existing: { absenceOverride: "absent" } }).isAbsent, true, "HR marked it absent");
  assert.equal(calculateTimesheetDay({ ...base, punches: { first: "09:00", last: "17:00", count: 2 }, existing: { status: "approved" } }).status, "approved");
});

test("a rest day has no shift and is never absent", () => {
  const rest = resolveSchedule({ date: "2026-10-16", employee }); // Friday
  assert.equal(rest.isOff, true);
  const result = calculateTimesheetDay({ workDate: "2026-10-16", schedule: rest, today: "2026-10-20" });
  assert.equal(result.isAbsent, false); assert.equal(result.scheduledStart, null);
});

test("schedule sources: attendance type, rotating assignment, shift plan, fixed", () => {
  const type = { shift_based: 0, start_time: "08:00", end_time: "16:00", late_allowance_minutes: 5, early_exit_allowance_minutes: 10, weekend_days: "5,6" };
  const byType = resolveSchedule({ date: "2026-10-12", employee, attendanceType: type });
  assert.deepEqual([byType.source, byType.start, byType.graceLate, byType.graceEarly], ["attendance_type", "08:00", 5, 10]);
  assert.equal(resolveSchedule({ date: "2026-10-16", employee, attendanceType: type }).isOff, true);
  const rotating = resolveSchedule({ date: "2026-10-12", employee: { ...employee, schedule_type: "rotating" }, assignment: { start_time: "22:00", end_time: "06:00", break_minutes: 30 } });
  assert.equal(rotating.source, "assignment"); assert.equal(rotating.requiredMinutes, 450);
  assert.equal(resolveSchedule({ date: "2026-10-12", employee: { ...employee, schedule_type: "rotating" }, assignment: { is_off: 1 } }).isOff, true);
  assert.equal(resolveSchedule({ date: "2026-10-12", employee: { ...employee, schedule_type: "shift" }, planDay: { start_time: "07:00", end_time: "15:00" } }).source, "shift_plan");
  assert.equal(resolveSchedule({ date: "2026-10-12", employee: { ...employee, schedule_type: "shift" }, planDay: { is_off: 1 } }).isOff, true);
  assert.equal(resolveSchedule({ date: "2026-10-12", employee }).source, "fixed");
});

test("an overnight shift measures late, early and overtime across midnight", () => {
  const night = resolveSchedule({ date: "2026-10-12", employee: { ...employee, schedule_type: "rotating" }, assignment: { start_time: "22:00", end_time: "06:00" } });
  const result = calculateTimesheetDay({ workDate: "2026-10-12", schedule: night, today: "2026-10-14", punches: { first: "22:05", last: "06:20", count: 2 } });
  assert.equal(result.lateMinutes, 0); assert.equal(result.overtimeMinutes, 20); assert.equal(result.totalWorkMinutes, 495);
});

const rules = [
  { id: 1, name_en: "Late 1-15", name_ar: "", rule_type: "late_arrival", min_minutes: 1, max_minutes: 15, deduction_type: "fixed_amount", value: 0 },
  { id: 2, name_en: "Late 16-60", name_ar: "", rule_type: "late_arrival", min_minutes: 16, max_minutes: 60, deduction_type: "daily_wage_percent", value: 25 },
  { id: 3, name_en: "Early", name_ar: "", rule_type: "early_leave", min_minutes: 1, max_minutes: null, deduction_type: "daily_wage_percent", value: 50 },
  { id: 4, name_en: "Absent without", name_ar: "", rule_type: "absence", absence_notice: "without_notice", deduction_type: "daily_wage_percent", value: 200 },
  { id: 5, name_en: "Absent with", name_ar: "", rule_type: "absence", absence_notice: "with_notice", deduction_type: "daily_wage_percent", value: 100 },
  { id: 6, name_en: "Overtime", name_ar: "", rule_type: "overtime", min_minutes: null, max_minutes: null, deduction_type: "hourly", value: 1, overtime_multiplier: 2 },
];

test("deduction money: late, early leave, absence by notice (unset is not charged), overtime", () => {
  const day = { isAbsent: false, absenceHasNotice: null, minutesAfterStart: 40, lateMinutes: 25, earlyLeaveMinutes: 30, overtimeMinutes: 0 };
  const money = dayMoney(rules, day, 3000, 480, 1.5); // daily wage 100
  assert.equal(money.deductionAmount, 75); assert.equal(money.primaryRuleId, 2); assert.equal(money.components.length, 2);
  const absent = { isAbsent: true, absenceHasNotice: 0, minutesAfterStart: 0, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 };
  assert.equal(dayMoney(rules, absent, 3000, 480, 1.5).deductionAmount, 200);
  assert.equal(dayMoney(rules, { ...absent, absenceHasNotice: 1 }, 3000, 480, 1.5).deductionAmount, 100);
  assert.equal(dayMoney(rules, { ...absent, absenceHasNotice: null }, 3000, 480, 1.5).deductionAmount, 0);
  const overtime = dayMoney(rules, { ...absent, isAbsent: false, overtimeMinutes: 120 }, 3000, 480, 1.5);
  assert.equal(overtime.overtimeAmount, 2 * (100 / 8) * 2);
  assert.equal(overtimeCounts(rules.filter(r => r.rule_type !== "overtime"), 5), true);
});

test("summary cards, deduction summary and naughty corner agree", () => {
  const rows = [
    { id: 1, employee_id: 1, employee_name: "A", status: "pending", late_minutes: 20, deduction_amount: 25, deduction_details: JSON.stringify([{ kind: "late", amount: 25 }]) },
    { id: 2, employee_id: 1, employee_name: "A", status: "pending", late_minutes: 5, deduction_amount: 0 },
    { id: 3, employee_id: 2, employee_name: "B", status: "absent", is_absent: 1, absence_has_notice: null, deduction_amount: 0 },
    { id: 4, employee_id: 2, employee_name: "B", status: "absent", is_absent: 1, absence_has_notice: 0, deduction_amount: 200, deduction_details: JSON.stringify([{ kind: "absence", amount: 200, wageDays: 2 }]) },
    { id: 5, employee_id: 3, employee_name: "C", status: "rejected", late_minutes: 90, deduction_amount: 99 },
  ];
  const s = summarize(rows);
  assert.equal(s.absent, 2); assert.equal(s.lateCount, 3); assert.equal(s.totalDeduction, 225);
  assert.equal(matchesCard(rows[2], "absent"), true);
  const d = deductionSummary(rows);
  assert.equal(d.grand.absentUnset, 1); assert.equal(d.grand.absentWithoutNotice, 1); assert.equal(d.grand.totalDeduction, 225); assert.equal(d.grand.chargedAbsenceDays, 1);
  assert.equal(naughtyCorner(rows)[0].employee_id, 1);
  assert.equal(naughtyCorner(rows).some(e => e.employee_id === 3), false, "rejected entries do not count");
});

test("filters validate with the messages the page shows", () => {
  assert.throws(() => resolveFilters({ mode: "date" }), e => e.status === 400);
  assert.deepEqual(resolveFilters({ mode: "month", month: "2026-10", country: "Saudi Arabia" }).country, "KSA");
  const month = resolveFilters({ mode: "month", month: "2026-10" });
  assert.equal(month.from, "2026-09-26"); assert.equal(month.to, "2026-10-25");
  assert.throws(() => resolveFilters({ mode: "range", from: "2026-10-05", to: "2026-10-01" }), e => e.status === 400);
});

test("status labels are bilingual and carry holiday and vacation names", () => {
  assert.equal(statusLabel({ status: "vacation", label_en: "Sick Leave" }, false), "Vacation (Sick Leave)");
  assert.equal(statusLabel({ status: "holiday", label_ar: "عيد" }, true), "عطلة رسمية (عيد)");
  assert.equal(statusLabel({ status: "waiting_for_exit" }, false), "Waiting for Exit");
});

test("a missing punch on a day with no attendance data is unknown, never an absence", () => {
  const uncovered = calculateTimesheetDay({ ...base, dataCovered: false });
  assert.equal(uncovered.isAbsent, false); assert.equal(uncovered.status, "pending");
  assert.equal(calculateTimesheetDay({ ...base, dataCovered: true }).isAbsent, true);
  assert.equal(calculateTimesheetDay({ ...base, dataCovered: false, existing: { absenceOverride: "absent" } }).isAbsent, true, "HR's own decision still stands");
});

test("mail never reports success when the transport fails or is unreachable", async () => {
  const { sendMail, deductionMessage } = await import("../app/timesheet/mail.ts");
  const config = { url: "http://127.0.0.1:9/mail", key: "k", from: "hr@example.invalid" };
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("nope", { status: 500 });
    assert.equal((await sendMail(config, { to: "a@b.c", subject: "s", html: "h", text: "t" })).ok, false);
    globalThis.fetch = async () => { throw new Error("offline"); };
    const failed = await sendMail(config, { to: "a@b.c", subject: "s", html: "h", text: "t" });
    assert.equal(failed.ok, false); assert.match(failed.error, /offline/);
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    assert.equal((await sendMail(config, { to: "a@b.c", subject: "s", html: "h", text: "t" })).ok, true);
  } finally { globalThis.fetch = real; }
  const message = deductionMessage({ name: "A <b>", nameAr: "أ", to: "a@b.c", periodFrom: "2026-09-26", periodTo: "2026-10-25", rows: [{ work_date: "2026-10-04", late_minutes: 35, deduction_amount: 25, deduction_details: JSON.stringify([{ kind: "late", minutes: 65, ruleEn: "Late", amount: 25 }]) }] });
  assert.ok(!message.html.includes("A <b>") && message.html.includes("A &lt;b&gt;"), "names are escaped"); assert.match(message.text, /Total: 25\.00/);
});
