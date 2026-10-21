import { amounts, inRange, mostSpecific, type DeductionRule } from "../attendance/attendance-deductions.ts";

/**
 * Money for one timesheet day, from the rules in Settings → HR Settings.
 *  - Late: the late_arrival rule whose range holds the minutes after the scheduled start (the range includes the grace window).
 *  - Early leave: the early_leave rule whose range holds the early-leave minutes.
 *  - Absence: the rule for the day's notice status; an absence whose notice is not set yet is not charged.
 *  - Overtime: hourly rate × the rule's multiplier (or the payroll multiplier when no overtime rule exists).
 * Daily wage = basic / 30. Hourly wage = daily wage / required hours.
 */
export type DeductionComponent = {
  kind: "late" | "early_leave" | "absence"; ruleId: number; ruleEn: string; ruleAr: string;
  minutes: number; wageDays: number; fixedAmount: number; amount: number;
};
export type DayMoneyInput = {
  isAbsent: boolean; absenceHasNotice: number | null; minutesAfterStart: number; lateMinutes: number; earlyLeaveMinutes: number; overtimeMinutes: number;
};
export type DayMoney = { components: DeductionComponent[]; deductionAmount: number; primaryRuleId: number | null; overtimeAmount: number };

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const dailyRate = (basic: number) => (Number(basic) || 0) / 30;
export const hourlyRate = (basic: number, requiredMinutes: number) => (requiredMinutes > 0 ? dailyRate(basic) / (requiredMinutes / 60) : 0);

function component(kind: DeductionComponent["kind"], rule: DeductionRule, minutes: number, daily: number): DeductionComponent {
  const priced = amounts(rule);
  return {
    kind, ruleId: rule.id, ruleEn: rule.name_en, ruleAr: rule.name_ar, minutes,
    wageDays: Math.round(priced.wageDays * 10000) / 10000, fixedAmount: priced.fixedAmount,
    amount: round2(priced.wageDays * daily + priced.fixedAmount),
  };
}

export function absenceRule(rules: DeductionRule[], hasNotice: number | null): DeductionRule | null {
  if (hasNotice === null || hasNotice === undefined) return null;
  const wanted = Number(hasNotice) === 1 ? "with_notice" : "without_notice";
  const absence = rules.filter(rule => rule.rule_type === "absence");
  return absence.find(rule => rule.absence_notice === wanted) ?? absence.find(rule => !rule.absence_notice) ?? null;
}

export function dayMoney(rules: DeductionRule[], day: DayMoneyInput, basicSalary: number, requiredMinutes: number, fallbackMultiplier: number): DayMoney {
  const daily = dailyRate(basicSalary), components: DeductionComponent[] = [];
  if (day.isAbsent) {
    const rule = absenceRule(rules, day.absenceHasNotice);
    if (rule) components.push(component("absence", rule, 0, daily));
  } else {
    if (day.lateMinutes > 0) {
      const rule = mostSpecific(rules.filter(item => item.rule_type === "late_arrival" && inRange(item, day.minutesAfterStart)));
      if (rule) components.push(component("late", rule, day.minutesAfterStart, daily));
    }
    if (day.earlyLeaveMinutes > 0) {
      const rule = mostSpecific(rules.filter(item => item.rule_type === "early_leave" && inRange(item, day.earlyLeaveMinutes)));
      if (rule) components.push(component("early_leave", rule, day.earlyLeaveMinutes, daily));
    }
  }
  let overtimeAmount = 0;
  if (day.overtimeMinutes > 0) {
    const rule = overtimeRule(rules, day.overtimeMinutes);
    const multiplier = rule ? Number(rule.overtime_multiplier) || fallbackMultiplier : fallbackMultiplier;
    overtimeAmount = round2((day.overtimeMinutes / 60) * hourlyRate(basicSalary, requiredMinutes) * multiplier);
  }
  return { components, deductionAmount: round2(components.reduce((sum, item) => sum + item.amount, 0)), primaryRuleId: components[0]?.ruleId ?? null, overtimeAmount };
}

/** The overtime rule whose range holds the minutes, or null when none does (overtime then does not count). */
export function overtimeRule(rules: DeductionRule[], minutes: number): DeductionRule | null {
  const overtime = rules.filter(rule => rule.rule_type === "overtime");
  return overtime.length ? mostSpecific(overtime.filter(item => inRange(item, minutes))) : null;
}
/** Overtime counts when there is no overtime rule at all, or one whose range holds the minutes. */
export const overtimeCounts = (rules: DeductionRule[], minutes: number) =>
  !rules.some(rule => rule.rule_type === "overtime") || overtimeRule(rules, minutes) !== null;
