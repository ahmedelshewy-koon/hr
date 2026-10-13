import { withDatabase } from "../../route-helpers";
import { enforceWriteOrigin, requireActor } from "../../api-security";
import { clearAssignments, deleteShiftPlan, readSchedules, saveAssignments, saveAttendanceTypeExtras, saveEmployeeSchedule, saveShiftPlan, setCompanyWfhDay, setHolidayReligion } from "../../../timesheet/schedules";
import { timesheetReady } from "../../../timesheet/service";
import { addDays } from "../../../timesheet/time";
import { requirePayrollPage } from "../../../payroll/permissions";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
const notReady = () => new Response("Timesheet Management is not set up yet: database migration 0052 has not been applied", { status: 503 });

/** Schedule inputs of the Timesheet: shift types, attendance types, shift plans, rotating assignments, holiday religion, company WFH days. */
export async function GET(request: Request) {
  return withDatabase("Unable to load the schedules", async db => {
    const actor = await requireActor(request, db);
    if (!await timesheetReady(db)) throw notReady();
    const url = new URL(request.url), today = new Date().toISOString().slice(0, 10);
    const payrollPagesReady=Boolean((await db.prepare("SELECT to_regclass('public.user_permissions') IS NOT NULL AS ready").first<{ready:boolean}>())?.ready);
    if(payrollPagesReady&&url.searchParams.get("page")==="types")await requirePayrollPage(db,actor,"attendanceTypeSetup");
    if(payrollPagesReady&&url.searchParams.get("page")==="plans")await requirePayrollPage(db,actor,"shiftPlansSetup");
    return json(await readSchedules(db, actor, url.searchParams.get("from") || addDays(today, -7), url.searchParams.get("to") || addDays(today, 60)));
  });
}

export async function POST(request: Request) {
  return withDatabase("Unable to save the schedule", async db => {
    enforceWriteOrigin(request);
    const actor = await requireActor(request, db);
    if (!await timesheetReady(db)) throw notReady();
    const input = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!input || typeof input !== "object") throw new Response("Invalid request", { status: 400 });
    const payrollPagesReady=Boolean((await db.prepare("SELECT to_regclass('public.user_permissions') IS NOT NULL AS ready").first<{ready:boolean}>())?.ready);
    if(payrollPagesReady&&input.action==="save_attendance_type")await requirePayrollPage(db,actor,"attendanceTypeSetup","edit");
    if(payrollPagesReady&&(input.action==="save_shift_plan"||input.action==="delete_shift_plan"))await requirePayrollPage(db,actor,"shiftPlansSetup","edit");
    switch (String(input.action || "")) {
      case "save_employee_schedule": return json({ ok: true, ...await saveEmployeeSchedule(db, request, actor, input) });
      case "save_attendance_type": return json({ ok: true, ...await saveAttendanceTypeExtras(db, request, actor, input) });
      case "save_shift_plan": return json({ ok: true, ...await saveShiftPlan(db, request, actor, input) });
      case "delete_shift_plan": return json({ ok: true, ...await deleteShiftPlan(db, request, actor, Number(input.id)) });
      case "save_assignments": return json({ ok: true, ...await saveAssignments(db, request, actor, input) });
      case "clear_assignments": return json({ ok: true, ...await clearAssignments(db, request, actor, input) });
      case "set_holiday_religion": return json({ ok: true, ...await setHolidayReligion(db, request, actor, input) });
      case "set_company_wfh": return json({ ok: true, ...await setCompanyWfhDay(db, request, actor, input) });
      default: throw new Response("Unknown action", { status: 400 });
    }
  });
}
