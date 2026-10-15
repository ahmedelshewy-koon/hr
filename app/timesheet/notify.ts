import type { PostgresDatabase } from "../../db/postgres";
import type { ApiActor } from "../api/api-security";
import { timesheetAccess } from "./access.ts";
import { loadEmployees } from "./facts.ts";
import type { TimesheetFilters } from "./filters.ts";
import { deductionMessage, sendMail, type MailConfig } from "./mail.ts";
import { audit, readRows, scopedEmployees } from "./service.ts";
import { recalculateRange } from "./calculate.ts";
import { addDays, localNow, timeZoneForCountry } from "./time.ts";

const fail = (message: string, status = 400) => new Response(message, { status });

/** Send Deduction Mails: one e-mail per employee with the unsent deductions of the filtered period, then marks those days "Mail Sent". */
export async function sendDeductionMails(db: PostgresDatabase, request: Request, actor: ApiActor, filters: TimesheetFilters, config: MailConfig | null) {
  const access = await timesheetAccess(db, actor);
  if (!access.canEdit) throw fail("Permission denied", 403);
  if (!config) return { configured: false, sent: 0, failed: [] as { employee: string; error: string }[], skipped: 0, noEmail: [] as string[] };
  const employees = await scopedEmployees(db, actor, filters);
  const rows = (await readRows(db, employees.map(employee => employee.id), filters.from, filters.to))
    .filter(row => Number(row.deduction_amount) > 0 && !Number(row.deduction_notification_sent) && row.status !== "rejected");
  const byEmployee = new Map<number, typeof rows>();
  for (const row of rows) (byEmployee.get(Number(row.employee_id)) ?? byEmployee.set(Number(row.employee_id), []).get(Number(row.employee_id))!).push(row);
  const result = { configured: true, sent: 0, failed: [] as { employee: string; error: string }[], skipped: 0, noEmail: [] as string[] };
  for (const [employeeId, list] of byEmployee) {
    const first = list[0], email = String(first.work_email ?? "").trim();
    if (!email) { result.noEmail.push(String(first.employee_name)); result.skipped++; continue; }
    const outcome = await sendMail(config, deductionMessage({ name: String(first.employee_name), nameAr: String(first.employee_name_ar ?? ""), to: email, periodFrom: filters.from, periodTo: filters.to, rows: list }));
    if (!outcome.ok) { result.failed.push({ employee: String(first.employee_name), error: outcome.error ?? "failed" }); continue; }
    await db.prepare("UPDATE timesheets SET deduction_notification_sent=1,deduction_notification_sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE employee_id=? AND id=ANY(?::int[])").bind(employeeId, list.map(row => Number(row.id))).run();
    result.sent++;
  }
  await audit(db, request, actor, "timesheet_deduction_mails_sent", "timesheet_scope", `${filters.from}..${filters.to}`, null, { sent: result.sent, failed: result.failed.length, noEmail: result.noEmail.length });
  return result;
}

/**
 * Scheduled job (worker cron): recalculates yesterday and today for everyone, then mails (a) each employee who checked in
 * yesterday but never checked out a reminder and (b) each HR manager a short attendance summary. Mail needs MAIL_API_* config;
 * the recalculation runs regardless. Locked months and payroll periods are left alone.
 */
export async function runScheduledTimesheetJobs(db: PostgresDatabase, config: MailConfig | null, now = new Date()) {
  const employees = await loadEmployees(db, { employeeIds: null, departmentIds: null, employeeId: 0, country: "" });
  const active = employees.filter(employee => ["active", "probation", "notice_period"].includes(String(employee.employment_status)));
  const today = localNow(timeZoneForCountry("Saudi Arabia"), now).date, yesterday = addDays(today, -1);
  await db.transaction(async tx => {
    await tx.prepare("SELECT pg_advisory_xact_lock(905200)").run();
    await recalculateRange(tx, active, addDays(yesterday, -1), today, { now });
  });
  const summary = { recalculated: active.length, reminders: 0, summaries: 0, mailConfigured: Boolean(config) };
  if (!config) return summary;
  const waiting = (await readRows(db, active.map(employee => employee.id), yesterday, yesterday)).filter(row => row.status === "waiting_for_exit");
  for (const row of waiting) {
    const email = String(row.work_email ?? "").trim();
    if (!email) continue;
    const text = `Dear ${row.employee_name},\nYour attendance on ${yesterday} has a check-in but no check-out. Please contact HR to complete it.\n\nعزيزي ${row.employee_name_ar || row.employee_name}، يوجد تسجيل حضور بتاريخ ${yesterday} بدون تسجيل انصراف. يرجى التواصل مع الموارد البشرية لاستكماله.`;
    const outcome = await sendMail(config, { to: email, subject: `Attendance reminder · تذكير بالانصراف — ${yesterday}`, text, html: `<p>${text.replaceAll("\n", "<br>")}</p>` });
    if (outcome.ok) summary.reminders++;
  }
  const rows = await readRows(db, active.map(employee => employee.id), yesterday, yesterday);
  const count = (predicate: (row: Record<string, unknown>) => boolean) => rows.filter(predicate).length;
  const body = `Attendance summary for ${yesterday}\nEntries: ${rows.length}\nAbsent: ${count(row => Number(row.is_absent) === 1)}\nLate: ${count(row => Number(row.late_minutes) > 0)}\nWaiting for exit: ${count(row => row.status === "waiting_for_exit")}\nPending approval: ${count(row => row.status === "pending")}`;
  const hr = (await db.prepare("SELECT u.email FROM users u JOIN roles r ON r.id=u.role_id WHERE u.status='active' AND r.name IN ('HR Manager','Super Admin')").all<{ email: string }>()).results;
  for (const user of hr) {
    const outcome = await sendMail(config, { to: String(user.email), subject: `Attendance summary · ملخص الحضور — ${yesterday}`, text: body, html: `<p>${body.replaceAll("\n", "<br>")}</p>` });
    if (outcome.ok) summary.summaries++;
  }
  return summary;
}
