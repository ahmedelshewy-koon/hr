import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";
import type { CalendarHoliday } from "./holiday-calendar.ts";

type Db = PostgresDatabase | TransactionDatabase;

/** Active holidays that can apply to an employee in `country`, in the shape the calendar rules expect. */
export async function loadCalendarHolidays(db: Db, country: string): Promise<CalendarHoliday[]> {
  const rows = (await db.prepare("SELECT id,holiday_date,name_ar,country,recurrence_type,status,original_date,original_date_behavior FROM holidays WHERE status='active' AND country IN (?, 'Both', 'KSA & Egypt')").bind(country).all()).results as Record<string, unknown>[];
  return rows.map(row => ({
    id: Number(row.id),
    holidayDate: String(row.holiday_date),
    nameAr: String(row.name_ar ?? ""),
    country: String(row.country),
    recurrenceType: String(row.recurrence_type || "once"),
    status: String(row.status || "active"),
    originalDate: row.original_date ? String(row.original_date) : null,
    originalDateBehavior: row.original_date_behavior ? String(row.original_date_behavior) : null,
  } satisfies CalendarHoliday));
}
