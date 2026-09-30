/**
 * One place that decides whether a date is an official holiday, shared by leave and attendance.
 * A postponed holiday is stored as a one-time copy at the new date whose `originalDate` is the
 * date it was moved from; the holiday it was copied from stops applying on that original date.
 */
export type CalendarHoliday = {
  id?: number | null;
  holidayDate: string;
  country: string;
  recurrenceType?: string | null;
  status?: string | null;
  nameAr?: string | null;
  originalDate?: string | null;
  originalDateBehavior?: string | null;
};

export const POSTPONED_ORIGINAL_DAY = "workday";

const SHARED_COUNTRIES = ["Both", "KSA & Egypt"];

const isActive = (holiday: CalendarHoliday) => !holiday.status || holiday.status === "active";

export function holidayCoversCountry(holiday: CalendarHoliday, country: string) {
  return holiday.country === country || SHARED_COUNTRIES.includes(holiday.country);
}

function occursOn(holiday: CalendarHoliday, date: string) {
  return holiday.recurrenceType === "annual"
    ? holiday.holidayDate.slice(5) === date.slice(5)
    : holiday.holidayDate === date;
}

/** True when a postponed copy has moved this holiday away from `date`. */
export function isPostponedAway(holiday: CalendarHoliday, date: string, all: CalendarHoliday[]) {
  return all.some(moved => moved !== holiday && isActive(moved)
    && moved.originalDate === date && moved.originalDateBehavior === POSTPONED_ORIGINAL_DAY
    && moved.country === holiday.country && (moved.nameAr ?? "") === (holiday.nameAr ?? ""));
}

/** Holiday rows as the API returns them (snake_case columns). */
export function holidayFromRow(row: Record<string, unknown>): CalendarHoliday {
  return {
    id: Number(row.id) || null,
    holidayDate: String(row.holiday_date ?? ""),
    country: String(row.country ?? ""),
    recurrenceType: row.recurrence_type ? String(row.recurrence_type) : null,
    status: row.status ? String(row.status) : null,
    nameAr: row.name_ar ? String(row.name_ar) : null,
    originalDate: row.original_date ? String(row.original_date) : null,
    originalDateBehavior: row.original_date_behavior ? String(row.original_date_behavior) : null,
  };
}

/** Rows to show people: active holidays, minus those a postponed copy has moved off their date. */
export function currentHolidayRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  const holidays = rows.map(holidayFromRow);
  return rows.filter((_, index) => isActive(holidays[index]) && !isPostponedAway(holidays[index], holidays[index].holidayDate, holidays));
}

export function isHolidayDate(holidays: CalendarHoliday[], date: string, country: string) {
  return holidays.some(holiday => isActive(holiday) && holidayCoversCountry(holiday, country)
    && occursOn(holiday, date) && !isPostponedAway(holiday, date, holidays));
}
