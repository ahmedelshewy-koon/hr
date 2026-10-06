import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dayDeduction, dayOvertime, minutesAfterStart, summarizeAttendanceDeductions } from "../app/attendance/attendance-deductions.ts";

const rule = (id, rule_type, extra) => ({ id, name_en: `Rule ${id}`, name_ar: `قاعدة ${id}`, rule_type, min_minutes: null, max_minutes: null, deduction_type: "daily_wage_percent", value: 0, overtime_multiplier: null, absence_notice: null, ...extra });
const RULES = [
  rule(9, "absence", { value: 200, absence_notice: "without_notice" }),
  rule(10, "absence", { value: 100, absence_notice: "with_notice" }),
  rule(11, "late_arrival", { min_minutes: 1, max_minutes: 15, deduction_type: "fixed_amount", value: 0 }),
  rule(12, "late_arrival", { min_minutes: 16, max_minutes: 30, value: 25 }),
  rule(14, "late_arrival", { min_minutes: 61, max_minutes: null, value: 100 }),
  rule(15, "late_arrival", { min_minutes: 61, max_minutes: 90, value: 50 }),
  rule(16, "overtime", { deduction_type: "hourly", value: 1, overtime_multiplier: 2 }),
];
const late = (actual, lateMinutes) => ({ status: "late", scheduled_in: "09:00", actual_in: actual, late_minutes: lateMinutes });

test("late days match the range on minutes after the scheduled start, preferring the most specific rule", () => {
  assert.equal(minutesAfterStart(late("09:20", 5)), 20);
  assert.equal(dayDeduction(RULES, late("09:20", 5)).rule.id, 12);
  assert.equal(dayDeduction(RULES, late("09:20", 5)).wageDays, 0.25);
  assert.equal(dayDeduction(RULES, late("10:15", 60)).rule.id, 15);
  assert.equal(dayDeduction(RULES, late("11:00", 105)).rule.id, 14);
  assert.equal(dayDeduction(RULES, late("09:40", 25)), null, "31-60 has no rule");
  assert.equal(dayDeduction(RULES, { status: "present", scheduled_in: "09:00", actual_in: "09:10", late_minutes: 0 }), null, "inside the grace window");
});

test("absence uses the excused rule only when HR resolved or dismissed the absence", () => {
  assert.equal(dayDeduction(RULES, { status: "absent", absence_exception_status: "open" }).wageDays, 2);
  assert.equal(dayDeduction(RULES, { status: "absent" }).rule.id, 9);
  assert.equal(dayDeduction(RULES, { status: "absent", absence_exception_status: "dismissed" }).wageDays, 1);
  assert.equal(dayDeduction([rule(1, "absence", { deduction_type: "days_of_wage", value: 1.5 })], { status: "absent", absence_exception_status: "resolved" }).wageDays, 1.5);
});

test("overtime uses the rule multiplier, or the payroll multiplier when no overtime rule exists", () => {
  assert.equal(dayOvertime(RULES, { overtime_minutes: 90 }, 1.5).multiplier, 2);
  assert.equal(dayOvertime([], { overtime_minutes: 90 }, 1.5).multiplier, 1.5);
  assert.equal(dayOvertime([rule(2, "overtime", { min_minutes: 60, overtime_multiplier: 2 })], { overtime_minutes: 30 }, 1.5), null, "below the rule threshold");
});

test("period totals add wage-days, fixed amounts and weighted overtime hours", () => {
  const days = [{ status: "absent" }, late("09:20", 5), { ...late("09:05", 0), status: "present", overtime_minutes: 60 }, { status: "late", scheduled_in: "09:00", actual_in: "09:10", late_minutes: 1 }];
  const fixed = [...RULES.filter(r => r.id !== 11), rule(11, "late_arrival", { min_minutes: 1, max_minutes: 15, deduction_type: "fixed_amount", value: 20 })];
  assert.deepEqual(summarizeAttendanceDeductions(fixed, days, 1.5), { wageDays: 2.25, fixedAmount: 20, overtimeHours: 2, lateDays: 2, absentDays: 1 });
  assert.equal(summarizeAttendanceDeductions([], [{ status: "absent" }, { status: "absent" }], 1.5).wageDays, 2, "no absence rule keeps one day per absence");
});

test("payroll and the attendance report both read the deduction rules", async () => {
  const read = file => readFile(new URL(file, import.meta.url), "utf8");
  const [payroll, report, panel] = await Promise.all([read("../app/api/hr/route.ts"), read("../app/attendance/attendance-report.ts"), read("../app/attendance-report-panel.tsx")]);
  assert.match(payroll, /summarizeAttendanceDeductions\(deductionRules, attendanceRows, overtimeMultiplier\)/);
  assert.match(payroll, /attendanceCost\.wageDays \* dailyRate \+ attendanceCost\.fixedAmount/);
  assert.match(report, /withDeductions\(rules, records\.results\)/);
  assert.match(panel, /deduction_wage_days/);
});
