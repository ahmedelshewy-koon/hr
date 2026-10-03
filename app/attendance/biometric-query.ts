import type { PostgresDatabase } from "../../db/postgres";
import { csvValue } from "../reports/report-columns.ts";
import { weekday } from "./attendance-report.ts";

const EXPORT_LIMIT = 50000;

// `date` is the legacy single-day filter; `from`/`to` bound an inclusive day range. Empty means open-ended.
export function biometricDateRange(url: URL) {
  const single = url.searchParams.get("date") || "";
  const from = url.searchParams.get("from") ?? single, to = url.searchParams.get("to") ?? single;
  for (const day of [from, to]) if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(new Date(day + "T12:00:00Z").getTime()))) throw new Response("Invalid attendance date", { status: 400 });
  if (from && to && from > to) throw new Response("Invalid attendance date range", { status: 400 });
  return { from, to };
}

function filters(url: URL) {
  const { from, to } = biometricDateRange(url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const match = "%" + query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_") + "%";
  return { from, to, query, match };
}

const punchFrom = "FROM attendance_device_punches p JOIN attendance_devices d ON d.id=p.device_id LEFT JOIN attendance_device_users du ON du.device_id=p.device_id AND du.device_user_id=p.device_user_id LEFT JOIN employees e ON e.id=p.employee_id LEFT JOIN departments dep ON dep.id=e.department_id WHERE (?='' OR to_char(p.punched_at AT TIME ZONE d.timezone,'YYYY-MM-DD')>=?) AND (?='' OR to_char(p.punched_at AT TIME ZONE d.timezone,'YYYY-MM-DD')<=?) AND (?='' OR concat_ws(' ',e.name_en,e.name_ar,e.employee_code,du.display_name,p.device_user_id) ILIKE ?) AND (?::int[] IS NULL OR p.employee_id IS NULL OR p.employee_id=ANY(?::int[]))";
const dailyFrom = "FROM daily_attendance a JOIN employees e ON e.id=a.employee_id LEFT JOIN departments dep ON dep.id=e.department_id WHERE EXISTS (SELECT 1 FROM attendance_device_users du WHERE du.employee_id=e.id) AND (?='' OR a.work_date>=?) AND (?='' OR a.work_date<=?) AND (?='' OR concat_ws(' ',e.name_en,e.name_ar,e.employee_code,e.fingerprint_code) ILIKE ?) AND (?::int[] IS NULL OR e.id=ANY(?::int[]))";
/** `employeeIds` limits rows to those employees (a branch HR); null means every employee. */
const filterArgs = (f: ReturnType<typeof filters>, employeeIds: number[] | null = null) => [f.from, f.from, f.to, f.to, f.query, f.match, employeeIds, employeeIds];

export async function readBiometricWorkspace(db: PostgresDatabase, url: URL, employeeIds: number[] | null = null, includeSetup = false) {
  const tab = url.searchParams.get("tab") === "punches" ? "punches" : "daily";
  const f = filters(url);
  const page = Math.max(1, Math.min(100000, Math.floor(Number(url.searchParams.get("page")) || 1)));
  const limit = 50;
  const [devices, users, syncs, summary] = await Promise.all([
    db.prepare("SELECT d.*,s.status AS latest_sync_status,s.requested_at AS latest_sync_requested_at FROM attendance_devices d LEFT JOIN LATERAL (SELECT status,requested_at FROM attendance_device_syncs WHERE device_id=d.id ORDER BY requested_at DESC,id DESC LIMIT 1) s ON TRUE WHERE d.enabled=1 ORDER BY d.id").all(),
    db.prepare("SELECT du.id,du.device_id,du.device_user_id,du.display_name,du.employee_id,du.enabled,d.name AS device_name,e.employee_code,e.name_en AS employee_name,e.name_ar AS employee_name_ar,e.employment_status,dep.name_en AS department_name,dep.name_ar AS department_name_ar,da.actual_in AS today_in,da.actual_out AS today_out,(SELECT max(p.punched_at) FROM attendance_device_punches p WHERE p.device_id=du.device_id AND p.device_user_id=du.device_user_id) AS latest_punch_at FROM attendance_device_users du JOIN attendance_devices d ON d.id=du.device_id LEFT JOIN employees e ON e.id=du.employee_id LEFT JOIN departments dep ON dep.id=e.department_id LEFT JOIN daily_attendance da ON da.employee_id=e.id AND da.work_date=to_char(CURRENT_TIMESTAMP AT TIME ZONE d.timezone,'YYYY-MM-DD') WHERE du.enabled=1 AND (?::int[] IS NULL OR du.employee_id IS NULL OR du.employee_id=ANY(?::int[])) ORDER BY CASE WHEN du.employee_id IS NULL THEN 0 ELSE 1 END,du.display_name").bind(employeeIds, employeeIds).all(),
    db.prepare("SELECT s.*,d.model AS device_name FROM attendance_device_syncs s JOIN attendance_devices d ON d.id=s.device_id ORDER BY s.requested_at DESC,s.id DESC LIMIT 12").all(),
    db.prepare("SELECT count(*)::integer AS punch_count,count(*) FILTER (WHERE employee_id IS NULL)::integer AS unlinked_punch_count,max(punched_at) AS latest_punch FROM attendance_device_punches").first(),
  ]);
  let records, total;
  if (tab === "punches") {
    [records, total] = await Promise.all([
      db.prepare("SELECT p.id,p.device_user_id,p.employee_id,p.punched_at,p.punch_type,p.verify_type,d.model AS device_name,d.timezone,du.display_name AS device_user_name,e.employee_code,e.name_en AS employee_name,e.name_ar AS employee_name_ar,dep.name_en AS department_name,dep.name_ar AS department_name_ar " + punchFrom + " ORDER BY p.punched_at DESC,p.id DESC LIMIT ? OFFSET ?").bind(...filterArgs(f, employeeIds), limit, (page - 1) * limit).all(),
      db.prepare("SELECT count(*)::integer AS total " + punchFrom).bind(...filterArgs(f, employeeIds)).first<{ total: number }>(),
    ]);
  } else {
    [records, total] = await Promise.all([
      db.prepare("SELECT a.*,e.employee_code,e.fingerprint_code,e.name_en AS employee_name,e.name_ar AS employee_name_ar,dep.name_en AS department_name,dep.name_ar AS department_name_ar " + dailyFrom + " ORDER BY a.work_date DESC,NULLIF(BTRIM(a.actual_in),'') DESC NULLS LAST,a.id DESC LIMIT ? OFFSET ?").bind(...filterArgs(f, employeeIds), limit, (page - 1) * limit).all(),
      db.prepare("SELECT count(*)::integer AS total " + dailyFrom).bind(...filterArgs(f, employeeIds)).first<{ total: number }>(),
    ]);
  }
  const setup = includeSetup ? await readBiometricSetup(db) : null;
  return { devices: devices.results, users: users.results, syncs: syncs.results, summary, records: records.results, page, pageSize: limit, total: total?.total || 0, canManageDevices: includeSetup, ...setup };
}

/** Device and connector configuration for the administrator; never includes token hashes. */
async function readBiometricSetup(db: PostgresDatabase) {
  // Until migration 0032 runs, the attendance screen still loads; only device setup is unavailable.
  const migrated = await db.prepare("SELECT to_regclass('attendance_agents') IS NOT NULL AS ready").first<{ ready: boolean }>();
  if (!migrated?.ready) return { agents: [], allDevices: [], setupUnavailable: true };
  const [agents, allDevices] = await Promise.all([
    db.prepare("SELECT a.id,a.name,a.enabled,a.token_hint,a.agent_version,a.last_seen_at,a.last_ip,a.created_at,(SELECT count(*)::integer FROM attendance_devices d WHERE d.agent_id=a.id) AS device_count FROM attendance_agents a ORDER BY a.id").all(),
    db.prepare("SELECT id,agent_id,name,model,ip_address,port,timezone,enabled,status,last_seen_at,last_sync_at,last_error FROM attendance_devices ORDER BY id").all(),
  ]);
  return { agents: agents.results, allDevices: allDevices.results };
}


/** Every row of the selected tab (not just one page), oldest first, as spreadsheet columns. */
export async function exportBiometricRecords(db: PostgresDatabase, url: URL, arabic: boolean, employeeIds: number[] | null = null) {
  const tab = url.searchParams.get("tab") === "punches" ? "punches" : "daily";
  const f = filters(url);
  const t = (en: string, ar: string) => arabic ? ar : en;
  const pick = (row: Record<string, unknown>, en: string, ar: string) => (arabic ? row[ar] || row[en] : row[en]) || "";
  let columns: { key: string; label: string; width?: number }[], rows: Record<string, unknown>[];
  if (tab === "punches") {
    const result = await db.prepare("SELECT to_char(p.punched_at AT TIME ZONE d.timezone,'YYYY-MM-DD') AS day,to_char(p.punched_at AT TIME ZONE d.timezone,'HH24:MI:SS') AS time,p.device_user_id,p.employee_id,du.display_name AS device_user_name,d.model AS device_name,e.employee_code,e.name_en AS employee_name,e.name_ar AS employee_name_ar,dep.name_en AS department_name,dep.name_ar AS department_name_ar " + punchFrom + " ORDER BY p.punched_at,p.id LIMIT ?").bind(...filterArgs(f, employeeIds), EXPORT_LIMIT + 1).all<Record<string, unknown>>();
    rows = result.results.slice(0, EXPORT_LIMIT).map(row => ({ ...row, weekday: weekday(row.day, arabic), employee: pick(row, "employee_name", "employee_name_ar"), department: pick(row, "department_name", "department_name_ar"), link: row.employee_id ? t("Linked", "مرتبط") : t("Awaiting employee link", "بانتظار ربط الموظف") }));
    columns = [{ key: "day", label: t("Date", "التاريخ"), width: 13 }, { key: "weekday", label: t("Day", "اليوم"), width: 12 }, { key: "time", label: t("Punch time", "وقت البصمة"), width: 12 }, { key: "device_user_id", label: t("Device ID", "رقم البصمة"), width: 12 }, { key: "device_user_name", label: t("Device name", "الاسم على الجهاز"), width: 22 }, { key: "employee", label: t("Employee", "الموظف"), width: 28 }, { key: "employee_code", label: t("Employee code", "كود الموظف"), width: 13 }, { key: "department", label: t("Department", "القسم"), width: 22 }, { key: "device_name", label: t("Device", "الجهاز"), width: 18 }, { key: "link", label: t("Link", "الربط"), width: 20 }];
    return { columns, rows, limited: result.results.length > EXPORT_LIMIT, filename: `biometric-punches-${f.from || "start"}-to-${f.to || "latest"}.xlsx`, sheet: t("Biometric punches", "البصمات") };
  }
  const result = await db.prepare("SELECT a.work_date,a.actual_in,a.actual_out,a.worked_minutes,a.status,e.employee_code,e.fingerprint_code,e.name_en AS employee_name,e.name_ar AS employee_name_ar,dep.name_en AS department_name,dep.name_ar AS department_name_ar " + dailyFrom + " ORDER BY a.work_date,e.employee_code,a.id LIMIT ?").bind(...filterArgs(f, employeeIds), EXPORT_LIMIT + 1).all<Record<string, unknown>>();
  rows = result.results.slice(0, EXPORT_LIMIT).map(row => ({ ...row, weekday: weekday(row.work_date, arabic), employee: pick(row, "employee_name", "employee_name_ar"), department: pick(row, "department_name", "department_name_ar"), hours: row.actual_out ? (Number(row.worked_minutes) / 60).toFixed(2) : "", status: csvValue("status", row.status, arabic) }));
  columns = [{ key: "work_date", label: t("Date", "التاريخ"), width: 13 }, { key: "weekday", label: t("Day", "اليوم"), width: 12 }, { key: "employee", label: t("Employee", "الموظف"), width: 28 }, { key: "employee_code", label: t("Employee code", "كود الموظف"), width: 13 }, { key: "fingerprint_code", label: t("Device ID", "رقم البصمة"), width: 12 }, { key: "department", label: t("Department", "القسم"), width: 22 }, { key: "actual_in", label: t("Check-in", "الحضور"), width: 11 }, { key: "actual_out", label: t("Check-out", "الانصراف"), width: 11 }, { key: "hours", label: t("Hours", "الساعات"), width: 10 }, { key: "status", label: t("Status", "الحالة"), width: 18 }];
  return { columns, rows, limited: result.results.length > EXPORT_LIMIT, filename: `biometric-attendance-${f.from || "start"}-to-${f.to || "latest"}.xlsx`, sheet: t("Daily attendance", "الحضور والانصراف") };
}
