import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { currentHolidayRows, isHolidayDate } from "../app/leave/holiday-calendar.ts";
import { calculateLeaveDuration } from "../app/leave/leave-calculation.ts";

const armedForcesDay = { id: 1, holidayDate: "2026-10-06", nameAr: "عيد القوات المسلحة", country: "Egypt", recurrenceType: "annual", status: "active" };
const postponed = { id: 2, holidayDate: "2026-10-08", nameAr: "عيد القوات المسلحة", country: "Egypt", recurrenceType: "once", status: "active", originalDate: "2026-10-06", originalDateBehavior: "workday" };

test("an annual holiday recurs on the same month and day every year", () => {
  assert.equal(isHolidayDate([armedForcesDay], "2026-10-06", "Egypt"), true);
  assert.equal(isHolidayDate([armedForcesDay], "2027-10-06", "Egypt"), true);
  assert.equal(isHolidayDate([armedForcesDay], "2026-10-07", "Egypt"), false);
});

test("a postponed holiday counts on the new date and frees the original date", () => {
  const holidays = [armedForcesDay, postponed];
  assert.equal(isHolidayDate(holidays, "2026-10-08", "Egypt"), true);
  assert.equal(isHolidayDate(holidays, "2026-10-06", "Egypt"), false);
});

test("postponing one year leaves the annual holiday in place for other years", () => {
  assert.equal(isHolidayDate([armedForcesDay, postponed], "2027-10-06", "Egypt"), true);
});

test("a postponed one-time holiday also frees its original date", () => {
  const once = { ...armedForcesDay, recurrenceType: "once" };
  assert.equal(isHolidayDate([once, postponed], "2026-10-06", "Egypt"), false);
  assert.equal(isHolidayDate([once, postponed], "2026-10-08", "Egypt"), true);
});

test("a postponement does not affect a different holiday or another country's holiday", () => {
  const other = { id: 3, holidayDate: "2026-10-06", nameAr: "عطلة أخرى", country: "Egypt", recurrenceType: "once", status: "active" };
  const saudi = { id: 4, holidayDate: "2026-10-06", nameAr: "عيد القوات المسلحة", country: "Saudi Arabia", recurrenceType: "once", status: "active" };
  assert.equal(isHolidayDate([armedForcesDay, postponed, other], "2026-10-06", "Egypt"), true);
  assert.equal(isHolidayDate([armedForcesDay, postponed, saudi], "2026-10-06", "Saudi Arabia"), true);
});

test("an archived postponement restores the original holiday", () => {
  const cancelled = { ...postponed, status: "archived" };
  assert.equal(isHolidayDate([armedForcesDay, cancelled], "2026-10-06", "Egypt"), true);
  assert.equal(isHolidayDate([armedForcesDay, cancelled], "2026-10-08", "Egypt"), false);
});

test("holidays only apply to the countries they cover", () => {
  assert.equal(isHolidayDate([armedForcesDay], "2026-10-06", "Saudi Arabia"), false);
  assert.equal(isHolidayDate([{ ...armedForcesDay, country: "Both" }], "2026-10-06", "Saudi Arabia"), true);
});

test("leave over a postponed holiday charges the freed day and not the new holiday", () => {
  const result = calculateLeaveDuration({ fromDate: "2026-10-05", toDate: "2026-10-08", workDays: "0,1,2,3,4", country: "Egypt", holidays: [armedForcesDay, postponed] });
  assert.deepEqual(result.excludedHolidays, ["2026-10-08"]);
  assert.deepEqual(result.chargeableDates, ["2026-10-05", "2026-10-06", "2026-10-07"]);
});

test("the holiday register hides archived rows and the row a postponement moved away", () => {
  const rows = [
    { id: 1, holiday_date: "2026-10-06", name_ar: "عيد القوات المسلحة", country: "Egypt", recurrence_type: "annual", status: "active" },
    { id: 2, holiday_date: "2026-10-08", name_ar: "عيد القوات المسلحة", country: "Egypt", recurrence_type: "once", status: "active", original_date: "2026-10-06", original_date_behavior: "workday" },
    { id: 3, holiday_date: "2026-05-01", name_ar: "عيد العمال", country: "Egypt", recurrence_type: "annual", status: "archived" },
    { id: 4, holiday_date: "2026-04-25", name_ar: "عيد تحرير سيناء", country: "Egypt", recurrence_type: "annual", status: "active" },
  ];
  assert.deepEqual(currentHolidayRows(rows).map(row => row.id), [2, 4]);
});

test("holiday and leave changes recalculate attendance so covered days are never absences", async () => {
  const attendance = await readFile(new URL("../app/attendance/attendance-service.ts", import.meta.url), "utf8");
  const leave = await readFile(new URL("../app/leave/leave-service.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../app/api/hr/route.ts", import.meta.url), "utf8");
  assert.match(attendance, /export async function refreshLeaveAttendance/);
  assert.match(attendance, /export async function refreshHolidayAttendance/);
  assert.match(attendance, /isHolidayDate\(await loadCalendarHolidays/);
  assert.equal((leave.match(/refreshLeaveAttendance\(tx/g) ?? []).length, 3);
  for (const action of ["create_holiday", "update_holiday", "postpone_holiday", "cancel_holiday_postponement"]) {
    const start = api.indexOf(`action==="${action}"`);
    assert.ok(start > 0, `${action} is handled`);
    const block = api.slice(start, api.indexOf("if(action===", start + 10));
    assert.match(block, /refreshHolidayAttendance\(tx/, `${action} refreshes attendance`);
  }
});
