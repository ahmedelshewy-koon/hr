import { components, type SheetRow } from "./summary.ts";

/** Bilingual wording shared by the page, the Excel export and the print view. */
export const num = (value: unknown) => Number(value) || 0;
const pair = (arabic: boolean, en: string, ar: string) => (arabic ? ar : en);

export function statusLabel(row: SheetRow, arabic: boolean): string {
  const status = String(row.status ?? ""), label = arabic ? String(row.label_ar || row.label_en || "") : String(row.label_en || row.label_ar || "");
  switch (status) {
    case "approved": return pair(arabic, "Approved", "معتمد");
    case "pending": return pair(arabic, "Pending", "قيد المراجعة");
    case "waiting_for_exit": return pair(arabic, "Waiting for Exit", "بانتظار الانصراف");
    case "rejected": return pair(arabic, "Rejected", "مرفوض");
    case "absent": return pair(arabic, "Absent", "غائب");
    case "vacation": return label ? `${pair(arabic, "Vacation", "إجازة")} (${label})` : pair(arabic, "Vacation", "إجازة");
    case "holiday": return label ? `${pair(arabic, "Holiday", "عطلة رسمية")} (${label})` : pair(arabic, "Holiday", "عطلة رسمية");
    case "wfh": return label || pair(arabic, "Work From Home", "عمل من المنزل");
    default: return status;
  }
}
/** No scheduled shift and nothing recorded: the day is a rest day for this employee. */
export const isNoShift = (row: SheetRow) => !row.scheduled_start && !row.actual_start && !row.actual_end && !["holiday", "vacation", "wfh"].includes(String(row.status));
export const rowStatusLabel = (row: SheetRow, arabic: boolean) => (isNoShift(row) ? pair(arabic, "No shift", "لا يوجد دوام") : statusLabel(row, arabic));

export function noticeLabel(row: SheetRow, arabic: boolean): string {
  if (!num(row.is_absent) && row.status !== "absent") return "";
  if (row.absence_has_notice === null || row.absence_has_notice === undefined) return pair(arabic, "Unset", "غير محدد");
  return num(row.absence_has_notice) === 1 ? pair(arabic, "With notice", "بإشعار") : pair(arabic, "Without notice", "بدون إشعار");
}

const TYPE_LABEL: Record<string, [string, string]> = { fixed_amount: ["Fixed amount", "مبلغ ثابت"], daily_wage_percent: ["% of daily wage", "نسبة من أجر اليوم"], days_of_wage: ["Days of wage", "أيام من الأجر"] };
export const deductionTypeLabel = (row: SheetRow, arabic: boolean) => {
  const type = String(row.rule_deduction_type ?? ""), found = TYPE_LABEL[type];
  return found ? found[arabic ? 1 : 0] : "";
};
export const deductionValueText = (row: SheetRow) => {
  if (row.rule_value === null || row.rule_value === undefined) return "";
  return String(row.rule_deduction_type) === "daily_wage_percent" ? `${num(row.rule_value)}%` : String(num(row.rule_value));
};
export const ruleName = (row: SheetRow, arabic: boolean) => String((arabic ? row.rule_ar || row.rule_en : row.rule_en || row.rule_ar) ?? "");
export const componentRuleName = (part: { ruleEn?: string; ruleAr?: string }, arabic: boolean) => String((arabic ? part.ruleAr || part.ruleEn : part.ruleEn || part.ruleAr) ?? "");
export const kindLabel = (kind: string | undefined, arabic: boolean) => ({ late: pair(arabic, "Late arrival", "تأخير"), early_leave: pair(arabic, "Early leave", "انصراف مبكر"), absence: pair(arabic, "Absence", "غياب") } as Record<string, string>)[String(kind)] ?? "";

/** "WFH Extra Hours": hours worked from home beyond the scheduled day. */
export const wfhExtraHours = (row: SheetRow) => row.status === "wfh" && num(row.overtime_minutes) > 0;

export function hoursText(minutes: unknown, arabic: boolean) {
  const total = Math.max(0, Math.round(num(minutes))), hours = Math.floor(total / 60), rest = total % 60;
  if (!total) return "—";
  return arabic ? [hours ? `${hours} س` : "", rest ? `${rest} د` : ""].filter(Boolean).join(" ") : [hours ? `${hours}h` : "", rest ? `${rest}m` : ""].filter(Boolean).join(" ");
}
export const deductionComponents = components;
