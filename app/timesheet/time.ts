/**
 * Date and clock helpers for Timesheet Management. Everything is plain text: dates are YYYY-MM-DD and clock times are the
 * company-local HH:mm the schedules are written in (Cairo for Egypt, Riyadh for Saudi Arabia). No Date arithmetic depends
 * on the server's zone.
 */
// Payroll country rules live in one module shared with Payroll; re-exported for the Timesheet code.
import { employeePayrollCountry, normalizePayrollCountry, PAYROLL_COUNTRIES, type PayrollCountry } from "../payroll/country.ts";
export { employeePayrollCountry, normalizePayrollCountry, PAYROLL_COUNTRIES, type PayrollCountry };

const DAY_MS = 86400000;
export const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
export const isClock = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const isMonthKey = (value: unknown): value is string => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export const addDays = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY_MS) + 1;
/** 0 = Sunday … 6 = Saturday, the same numbering as employees.work_days. */
export const weekdayOf = (date: string) => new Date(date + "T12:00:00Z").getUTCDay();
export function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) dates.push(day);
  return dates;
}

export const clockToMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
export const minutesToClock = (minutes: number) => {
  const normal = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return String(Math.floor(normal / 60)).padStart(2, "0") + ":" + String(normal % 60).padStart(2, "0");
};

/**
 * Payroll attendance period: the 26th of the previous month through the 25th of the month named by the key.
 * "2026-10" → 2026-09-26 … 2026-10-25.
 */
export function periodForMonth(monthKey: string): { from: string; to: string } {
  if (!isMonthKey(monthKey)) throw new Error("Invalid month");
  const year = Number(monthKey.slice(0, 4)), month = Number(monthKey.slice(5, 7));
  const previous = new Date(Date.UTC(year, month - 2, 26));
  return { from: previous.toISOString().slice(0, 10), to: `${monthKey}-25` };
}

/** The payroll month a date belongs to: days from the 26th on count toward the next month's period. */
export function monthKeyOf(date: string): string {
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7)), day = Number(date.slice(8, 10));
  const shifted = day >= 26 ? new Date(Date.UTC(year, month, 1)) : new Date(Date.UTC(year, month - 1, 1));
  return shifted.toISOString().slice(0, 7);
}

/** Month keys whose periods overlap [from, to]. */
export function monthKeysBetween(from: string, to: string): string[] {
  const keys = new Set<string>();
  for (let day = from; day <= to; day = addDays(day, 1)) keys.add(monthKeyOf(day));
  return [...keys].sort();
}


/** Wall-clock zone of the country the employee works in; punches and "today" are read in it. */
export function timeZoneForCountry(country: unknown): string {
  return normalizePayrollCountry(country) === "Egypt" ? "Africa/Cairo" : "Asia/Riyadh";
}

/** Today's date and clock minute in an IANA zone. */
export function localNow(timeZone: string, now = new Date()): { date: string; minutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Minutes from `from` to `to` on a clock that wraps at midnight (end earlier than start means the next day). */
export function spanMinutes(from: string, to: string): number {
  const start = clockToMinutes(from), end = clockToMinutes(to);
  return end >= start ? end - start : end + 1440 - start;
}
