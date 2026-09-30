export type ReportPeriod = { from: string; to: string; days: number };
export type PeriodPresetId = "this_month" | "last_month" | "last_30" | "this_quarter" | "this_year";

export const REPORT_MAX_DAYS = 366;
export const PERIOD_PRESETS: PeriodPresetId[] = ["this_month", "last_month", "last_30", "this_quarter", "this_year"];

const DAY_MS = 86400000;
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && isoDate(new Date(value + "T00:00:00Z")) === value;

/** The company works on Cairo time, so "today" must not drift with the server's or browser's zone. */
export const cairoToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export const addDays = (date: string, days: number) => isoDate(new Date(Date.parse(date + "T00:00:00Z") + days * DAY_MS));
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY_MS) + 1;
export const makePeriod = (from: string, to: string): ReportPeriod => ({ from, to, days: daysBetween(from, to) });

/** A missing period means "this month so far"; a present-but-bad one is a client error, never silently replaced. */
export function parseReportPeriod(url: URL, today = cairoToday()): ReportPeriod {
  const rawFrom = url.searchParams.get("from") || "", rawTo = url.searchParams.get("to") || "";
  if (!rawFrom && !rawTo) return makePeriod(today.slice(0, 8) + "01", today);
  if (!validDate(rawFrom) || !validDate(rawTo)) throw new Response("Invalid report dates", { status: 400 });
  if (rawFrom > rawTo) throw new Response("The start date must not be after the end date", { status: 400 });
  const period = makePeriod(rawFrom, rawTo);
  if (period.days > REPORT_MAX_DAYS) throw new Response("The report period cannot exceed 366 days", { status: 400 });
  return period;
}

/** The window of equal length that ends the day before `period` starts; used to say "up/down versus before". */
export function previousPeriod(period: ReportPeriod): ReportPeriod {
  const to = addDays(period.from, -1);
  return makePeriod(addDays(to, -(period.days - 1)), to);
}

export function periodPreset(id: PeriodPresetId, today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  if (id === "this_month") return { from: today.slice(0, 8) + "01", to: today };
  if (id === "last_month") return { from: isoDate(new Date(Date.UTC(year, month - 2, 1))), to: isoDate(new Date(Date.UTC(year, month - 1, 0))) };
  if (id === "last_30") return { from: addDays(today, -29), to: today };
  if (id === "this_quarter") return { from: isoDate(new Date(Date.UTC(year, Math.floor((month - 1) / 3) * 3, 1))), to: today };
  return { from: `${year}-01-01`, to: today };
}

export const presetOf = (from: string, to: string, today: string) => PERIOD_PRESETS.find(id => {
  const preset = periodPreset(id, today);
  return preset.from === from && preset.to === to;
}) ?? null;
