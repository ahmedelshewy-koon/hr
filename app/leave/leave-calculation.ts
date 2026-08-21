export type LeaveHoliday = {
  holidayDate: string;
  country: string;
  recurrenceType?: string | null;
  status?: string | null;
};

export type LeaveDuration = {
  chargeableDays: number;
  chargeableDates: string[];
  excludedWeekends: string[];
  excludedHolidays: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseWorkDays(value: string | null | undefined) {
  const parsed = String(value ?? "0,1,2,3,4")
    .split(",")
    .map(part => Number(part.trim()))
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
  return new Set(parsed.length ? parsed : [0, 1, 2, 3, 4]);
}

function appliesOnDate(holiday: LeaveHoliday, date: string, country: string) {
  if (holiday.status && holiday.status !== "active") return false;
  if (holiday.country !== country && holiday.country !== "Both" && holiday.country !== "KSA & Egypt") return false;
  return holiday.recurrenceType === "annual"
    ? holiday.holidayDate.slice(5) === date.slice(5)
    : holiday.holidayDate === date;
}

export function calculateLeaveDuration(input: {
  fromDate: string;
  toDate: string;
  workDays?: string | null;
  holidays?: LeaveHoliday[];
  country: string;
}): LeaveDuration {
  if (!validIsoDate(input.fromDate) || !validIsoDate(input.toDate)) throw new Error("Invalid leave dates");
  if (input.toDate < input.fromDate) throw new Error("End date cannot be before start date");

  const workDays = parseWorkDays(input.workDays);
  const holidays = input.holidays ?? [];
  const result: LeaveDuration = { chargeableDays: 0, chargeableDates: [], excludedWeekends: [], excludedHolidays: [] };
  const cursor = new Date(`${input.fromDate}T00:00:00Z`);
  const end = new Date(`${input.toDate}T00:00:00Z`);

  for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    if (!workDays.has(cursor.getUTCDay())) {
      result.excludedWeekends.push(date);
    } else if (holidays.some(holiday => appliesOnDate(holiday, date, input.country))) {
      result.excludedHolidays.push(date);
    } else {
      result.chargeableDates.push(date);
    }
  }
  result.chargeableDays = result.chargeableDates.length;
  return result;
}

export function completedServiceMonths(startDate: string, onDate: string) {
  if (!validIsoDate(startDate) || !validIsoDate(onDate)) return 0;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${onDate}T00:00:00Z`);
  if (end < start) return 0;
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  if (end.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

export function availableLeaveBalance(balance: { entitlement: number; used: number; pending: number }) {
  return Math.max(0, Number(balance.entitlement) - Number(balance.used) - Number(balance.pending));
}
