import { daysBetween, isDate, isMonthKey, monthKeyOf, normalizePayrollCountry, periodForMonth, type PayrollCountry } from "./time.ts";

export type FilterMode = "date" | "range" | "month";
export type TimesheetFilters = {
  mode: FilterMode; from: string; to: string;
  /** The payroll month when mode is "month" (period: 26th of the previous month to the 25th). */
  monthKey: string | null;
  departmentId: number; country: "" | PayrollCountry; employeeId: number;
};

export const MAX_RANGE_DAYS = 93;

const bad = (message: string) => new Response(message, { status: 400 });

/** Reads the page filters from a query string or a JSON body. Messages match the ones the page shows. */
export function resolveFilters(source: URLSearchParams | Record<string, unknown>): TimesheetFilters {
  const get = (key: string) => String((source instanceof URLSearchParams ? source.get(key) : source[key]) ?? "").trim();
  const mode = (get("mode") || "month") as FilterMode;
  if (!["date", "range", "month"].includes(mode)) throw bad("Invalid filter mode");
  let from = "", to = "", monthKey: string | null = null;
  if (mode === "date") {
    const date = get("date") || get("from");
    if (!isDate(date)) throw bad("Please select a date");
    from = to = date;
  } else if (mode === "range") {
    from = get("from"); to = get("to");
    if (!isDate(from) || !isDate(to) || from > to) throw bad("Select a valid period");
    if (daysBetween(from, to) > MAX_RANGE_DAYS) throw bad("The period cannot exceed 93 days");
  } else {
    monthKey = get("month");
    if (!isMonthKey(monthKey)) throw bad("Select a valid month");
    ({ from, to } = periodForMonth(monthKey));
  }
  const rawCountry = get("country");
  const country = rawCountry ? normalizePayrollCountry(rawCountry) : null;
  if (rawCountry && !country) throw bad("Invalid payroll country");
  const departmentId = Number(get("departmentId") || 0), employeeId = Number(get("employeeId") || 0);
  if (!Number.isInteger(departmentId) || departmentId < 0 || !Number.isInteger(employeeId) || employeeId < 0) throw bad("Invalid filter");
  return { mode, from, to, monthKey: mode === "month" ? monthKey : null, departmentId, country: country ?? "", employeeId };
}

/** The payroll month a filter belongs to, for locks: the chosen month, or the month of the first day. */
export const filterMonthKey = (filters: TimesheetFilters) => filters.monthKey ?? monthKeyOf(filters.from);
