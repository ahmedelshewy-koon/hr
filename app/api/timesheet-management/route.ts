import { withDatabase } from "../route-helpers";
import { enforceRateLimit, enforceWriteOrigin, requireActor } from "../api-security";
import { resolveFilters } from "../../timesheet/filters";
import { confirmMonth, daySchedule, decide, ownPayrollCountry, readTimesheets, recalculate, saveEntry, saveNote, setCompanyWfhDay, setEditPermission, setNotice, timesheetReady, unlockMonth } from "../../timesheet/service";
import { loadPayrollPeriod, payrollPeriods, rollbackPayrollPeriod, sendToPayroll, setPayrollLock } from "../../timesheet/payroll";
import { sendDeductionMails } from "../../timesheet/notify";
import { readMailConfig } from "../../timesheet/mail-config";
import { timesheetWorkbook } from "../../timesheet/export";
import { CARD_KEYS, filterByCard, type CardKey } from "../../timesheet/summary";
import { filterSortTimesheetRows } from "../../timesheet/grid";
import { normalizePayrollCountry } from "../../timesheet/time";

const NO_STORE = { "cache-control": "private, no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const monthCountry = (value: unknown): "" | "Egypt" | "KSA" => { const country = normalizePayrollCountry(value); return country ?? ""; };

/**
 * Timesheet Management. GET reads (grid, payroll periods, one payroll period, Excel); POST performs one named action.
 * Page access, edit rights, HR data scope and the month / payroll locks are enforced in app/timesheet/*.
 */
export async function GET(request: Request) {
  return withDatabase("Unable to load the timesheet", async db => {
    const actor = await requireActor(request, db);
    if (!await timesheetReady(db)) throw new Response("Timesheet Management is not set up yet: database migration 0052 has not been applied", { status: 503 });
    const url = new URL(request.url), view = url.searchParams.get("view") || "grid";
    // The first visit asks for the signed-in user's own payroll country as the default filter.
    if (url.searchParams.get("country") === "default") url.searchParams.set("country", await ownPayrollCountry(db, actor));
    if (view === "schedule") return json(await daySchedule(db, actor, Number(url.searchParams.get("employeeId")), url.searchParams.get("date") || ""));
    if (view === "payroll_periods") return json({ periods: await payrollPeriods(db, actor) });
    if (view === "payroll_period") return json(await loadPayrollPeriod(db, actor, url.searchParams.get("month") || "", url.searchParams.get("country")));
    const filters = resolveFilters(url.searchParams);
    if (url.searchParams.get("format") === "xlsx") {
      await enforceRateLimit(db, request, "timesheet-export", 30, 3600, actor.id);
      const data = await readTimesheets(db, actor, filters, false) as { rows: Record<string, unknown>[] };
      const card = url.searchParams.get("card") as CardKey | null;
      const rows = filterSortTimesheetRows(filterByCard(data.rows, card && CARD_KEYS.includes(card) ? card : null),{
        search:url.searchParams.get("search")||"",first:url.searchParams.get("firstSort")||"work_date",second:url.searchParams.get("secondSort")||"",descending:url.searchParams.get("descending")==="1",
      });
      if (!rows.length) throw new Response("No data to export", { status: 404 });
      const bytes = timesheetWorkbook({ rows, from: filters.from, to: filters.to, arabic: url.searchParams.get("lang") === "ar" });
      return new Response(bytes, { headers: { ...NO_STORE, "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="timesheet-${filters.from}-${filters.to}.xlsx"`, "x-content-type-options": "nosniff" } });
    }
    return json(await readTimesheets(db, actor, filters, url.searchParams.get("lists") !== "0"));
  });
}

export async function POST(request: Request) {
  return withDatabase("Unable to save the timesheet", async db => {
    enforceWriteOrigin(request);
    const actor = await requireActor(request, db);
    if (!await timesheetReady(db)) throw new Response("Timesheet Management is not set up yet: database migration 0052 has not been applied", { status: 503 });
    const input = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!input || typeof input !== "object") throw new Response("Invalid request", { status: 400 });
    const action = String(input.action || "");
    switch (action) {
      case "save_entry": {
        if (!input.entry || typeof input.entry !== "object") throw new Response("Invalid entry", { status: 400 });
        return json({ ok: true, row: await saveEntry(db, request, actor, input.entry as Record<string, unknown>) });
      }
      case "decide": {
        if (input.decision !== "approve" && input.decision !== "reject") throw new Response("Invalid decision", { status: 400 });
        return json({ ok: true, row: await decide(db, request, actor, Number(input.id), input.decision) });
      }
      case "set_notice": return json({ ok: true, row: await setNotice(db, request, actor, Number(input.id), input.notice) });
      case "save_note": return json({ ok: true, row: await saveNote(db, request, actor, Number(input.id), input.note) });
      case "recalculate": return json({ ok: true, summary: await recalculate(db, request, actor, resolveFilters(input)) });
      case "confirm_month": return json({ ok: true, ...await confirmMonth(db, request, actor, String(input.month || ""), monthCountry(input.country)) });
      case "unlock_month": return json({ ok: true, ...await unlockMonth(db, request, actor, String(input.month || ""), monthCountry(input.country)) });
      case "set_edit_permission": return json({ ok: true, ...await setEditPermission(db, request, actor, String(input.month || ""), Number(input.employeeId), Boolean(input.active)) });
      case "send_deduction_mails": {
        await enforceRateLimit(db, request, "timesheet-mails", 10, 3600, actor.id);
        return json({ ok: true, ...await sendDeductionMails(db, request, actor, resolveFilters(input), readMailConfig()) });
      }
      case "send_to_payroll": return json({ ok: true, ...await sendToPayroll(db, request, actor, String(input.month || ""), input.country) });
      case "rollback_payroll_period": return json({ ok: true, ...await rollbackPayrollPeriod(db,request,actor,String(input.month||""),input.country) });
      case "set_payroll_lock": return json({ ok: true, ...await setPayrollLock(db, request, actor, String(input.month || ""), input.country, Boolean(input.locked)) });
      case "set_company_wfh": return json({ ok: true, ...await setCompanyWfhDay(db, request, actor, input) });
      default: throw new Response("Unknown action", { status: 400 });
    }
  });
}
