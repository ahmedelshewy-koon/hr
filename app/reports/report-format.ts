import type { Named, Person } from "./report-types";

export const percent = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

/** A comparison is only worth showing when the earlier window holds a meaningful share of the data the current one does. */
export const hasBaseline = (current: number, previous: number) => previous >= Math.max(5, current * 0.3);

/** How a figure moved against the previous period; `null` when there is nothing to compare with. */
export function trend(current: number, previous: number): { direction: "up" | "down" | "flat"; change: number } | null {
  if (!(previous > 0)) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  return { direction: change > 0 ? "up" : change < 0 ? "down" : "flat", change: Math.abs(change) };
}

export const personName = (person: Pick<Person, "name_en" | "name_ar">, rtl: boolean) => (rtl ? person.name_ar || person.name_en : person.name_en || person.name_ar) || "—";
export const personDepartment = (person: Pick<Person, "department_en" | "department_ar">, rtl: boolean) => (rtl ? person.department_ar || person.department_en : person.department_en || person.department_ar) || "";
export const namedLabel = (item: Named | null | undefined, rtl: boolean) => (rtl ? item?.name_ar || item?.name_en : item?.name_en || item?.name_ar) || "—";

/** Minutes as "12h 30m" / "12 س 30 د"; totals of lateness and overtime are easier to grasp in hours. */
export function durationLabel(minutes: number, rtl: boolean) {
  const total = Math.max(0, Math.round(minutes || 0)), hours = Math.floor(total / 60), rest = total % 60;
  if (!total) return "0";
  const parts = rtl ? [hours ? `${hours} س` : "", rest ? `${rest} د` : ""] : [hours ? `${hours}h` : "", rest ? `${rest}m` : ""];
  return parts.filter(Boolean).join(" ");
}

export const daysLabel = (days: number, rtl: boolean, format: (value: number) => string) => {
  const value = Math.round(days * 10) / 10;
  if (!rtl) return `${format(value)} day${value === 1 ? "" : "s"}`;
  return value === 1 ? "يوم" : value === 2 ? "يومان" : `${format(value)} ${value >= 3 && value <= 10 ? "أيام" : "يومًا"}`;
};
