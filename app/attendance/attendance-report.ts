import type { PostgresDatabase } from "../../db/postgres";

export type AttendanceReportFilters = { employeeId: number; from: string; to: string; country: string };

export const ATTENDANCE_REPORT_PAGE_SIZE = 50;
export const ATTENDANCE_REPORT_EXPORT_LIMIT = 20000;
const MAX_RANGE_DAYS = 366;

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;

/** employeeId 0 means every employee and an empty country means every country; the period is mandatory and capped so one request stays bounded. */
export function parseAttendanceReportFilters(url: URL): AttendanceReportFilters {
  const from = url.searchParams.get("from") || "", to = url.searchParams.get("to") || "";
  if (!validDate(from) || !validDate(to)) throw new Response("Invalid attendance report dates", { status: 400 });
  if (from > to) throw new Response("The start date must not be after the end date", { status: 400 });
  const days = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000 + 1;
  if (days > MAX_RANGE_DAYS) throw new Response("The report period cannot exceed 366 days", { status: 400 });
  const rawEmployee = url.searchParams.get("employeeId") || "";
  const employeeId = rawEmployee ? Number(rawEmployee) : 0;
  if (!Number.isInteger(employeeId) || employeeId < 0) throw new Response("Invalid employee", { status: 400 });
  const country = (url.searchParams.get("country") || "").trim();
  if (country.length > 60) throw new Response("Invalid country", { status: 400 });
  return { employeeId, from, to, country };
}

const FROM_CLAUSE = "FROM daily_attendance a JOIN employees e ON e.id=a.employee_id LEFT JOIN departments dep ON dep.id=e.department_id WHERE e.employment_status!='deleted' AND a.work_date>=? AND a.work_date<=? AND (?=0 OR a.employee_id=?) AND (?='' OR e.country=?) AND (?::int[] IS NULL OR a.employee_id=ANY(?::int[]))";
/** `employeeIds` limits the report to those employees (a branch HR); null means every employee. */
const bindings = (filters: AttendanceReportFilters, employeeIds: number[] | null = null) => [filters.from, filters.to, filters.employeeId, filters.employeeId, filters.country, filters.country, employeeIds, employeeIds];
const ROW_COLUMNS = "a.id,a.work_date,a.scheduled_in,a.scheduled_out,a.actual_in,a.actual_out,a.worked_minutes,a.required_minutes,a.late_minutes,a.early_minutes,a.overtime_minutes,a.status,e.id AS employee_id,e.employee_code,e.name_en AS employee_name,e.name_ar AS employee_name_ar,dep.name_en AS department_name,dep.name_ar AS department_name_ar";
const ORDER = " ORDER BY a.work_date,e.name_en,a.id";

export async function readAttendanceReport(db: PostgresDatabase, filters: AttendanceReportFilters, page: number, employeeIds: number[] | null = null) {
  const safePage = Math.max(1, Math.min(100000, Math.floor(page) || 1));
  const [summary, records] = await Promise.all([
    db.prepare("SELECT count(*)::integer AS total_rows,count(*) FILTER (WHERE NULLIF(BTRIM(a.actual_in),'') IS NOT NULL)::integer AS attended_days,count(*) FILTER (WHERE a.late_minutes>0)::integer AS late_days,COALESCE(sum(a.late_minutes),0)::integer AS late_minutes,count(*) FILTER (WHERE a.early_minutes>0)::integer AS early_days,COALESCE(sum(a.early_minutes),0)::integer AS early_minutes,count(*) FILTER (WHERE a.overtime_minutes>0)::integer AS overtime_days,COALESCE(sum(a.overtime_minutes),0)::integer AS overtime_minutes,COALESCE(sum(a.worked_minutes),0)::integer AS worked_minutes,count(*) FILTER (WHERE a.status='absent')::integer AS absent_days,count(*) FILTER (WHERE a.status='leave')::integer AS leave_days " + FROM_CLAUSE).bind(...bindings(filters, employeeIds)).first<Record<string, number>>(),
    db.prepare("SELECT " + ROW_COLUMNS + " " + FROM_CLAUSE + ORDER + " LIMIT ? OFFSET ?").bind(...bindings(filters, employeeIds), ATTENDANCE_REPORT_PAGE_SIZE, (safePage - 1) * ATTENDANCE_REPORT_PAGE_SIZE).all(),
  ]);
  return { summary: summary || {}, records: records.results, page: safePage, pageSize: ATTENDANCE_REPORT_PAGE_SIZE, total: Number(summary?.total_rows) || 0 };
}

const STATUS_AR: Record<string, string> = { present: "حاضر", late: "متأخر", absent: "غائب", leave: "إجازة", holiday: "عطلة رسمية", remote: "عن بُعد", needs_review: "يحتاج مراجعة", non_working_day: "يوم راحة", scheduled: "مجدول" };
const STATUS_EN: Record<string, string> = { present: "Present", late: "Late", absent: "Absent", leave: "On leave", holiday: "Official holiday", remote: "Remote", needs_review: "Needs review", non_working_day: "Non-working day", scheduled: "Scheduled" };

// A cell that starts with = + - @ is executed as a formula by spreadsheet apps.
const cell = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
};

export const weekday = (day: unknown, arabic: boolean) => /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? new Intl.DateTimeFormat(arabic ? "ar-EG" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(String(day) + "T12:00:00Z")) : "";

export async function exportAttendanceReportCsv(db: PostgresDatabase, filters: AttendanceReportFilters, arabic: boolean, employeeIds: number[] | null = null) {
  const [summary, rows] = await Promise.all([
    db.prepare("SELECT COALESCE(sum(a.worked_minutes),0)::integer AS worked_minutes,COALESCE(sum(a.late_minutes),0)::integer AS late_minutes,COALESCE(sum(a.early_minutes),0)::integer AS early_minutes,COALESCE(sum(a.overtime_minutes),0)::integer AS overtime_minutes,count(*)::integer AS total_rows " + FROM_CLAUSE).bind(...bindings(filters, employeeIds)).first<Record<string, number>>(),
    db.prepare("SELECT " + ROW_COLUMNS + " " + FROM_CLAUSE + ORDER + " LIMIT ?").bind(...bindings(filters, employeeIds), ATTENDANCE_REPORT_EXPORT_LIMIT).all(),
  ]);
  const statuses = arabic ? STATUS_AR : STATUS_EN;
  const header = arabic
    ? ["رقم الموظف", "الموظف", "القسم", "التاريخ", "اليوم", "الدوام من", "الدوام إلى", "الحضور", "الانصراف", "دقائق العمل", "دقائق التأخير", "دقائق الانصراف المبكر", "دقائق العمل الإضافي", "الحالة"]
    : ["Employee code", "Employee", "Department", "Date", "Day", "Scheduled in", "Scheduled out", "Check-in", "Check-out", "Worked minutes", "Late minutes", "Early departure minutes", "Overtime minutes", "Status"];
  const lines = [header.map(cell).join(",")];
  for (const row of rows.results) {
    lines.push([
      row.employee_code, arabic ? row.employee_name_ar || row.employee_name : row.employee_name, (arabic ? row.department_name_ar : row.department_name) || "", row.work_date, weekday(row.work_date, arabic),
      row.scheduled_in, row.scheduled_out, row.actual_in, row.actual_out, row.worked_minutes ?? 0, row.late_minutes ?? 0, row.early_minutes ?? 0, row.overtime_minutes ?? 0,
      statuses[String(row.status)] || row.status,
    ].map(cell).join(","));
  }
  lines.push(["", arabic ? "الإجمالي" : "Total", "", "", "", "", "", "", "", summary?.worked_minutes ?? 0, summary?.late_minutes ?? 0, summary?.early_minutes ?? 0, summary?.overtime_minutes ?? 0, ""].map(cell).join(","));
  const scope = filters.employeeId ? String(rows.results[0]?.employee_code || filters.employeeId).replace(/[^A-Za-z0-9_-]/g, "") : filters.country ? filters.country.replace(/[^A-Za-z0-9_-]+/g, "-").toLowerCase() : "all";
  return { csv: "﻿" + lines.join("\r\n"), filename: `attendance-report-${scope}-${filters.from}-${filters.to}.csv`, total: Number(summary?.total_rows) || 0 };
}
