import type { PostgresDatabase } from "../../db/postgres";
import type { ApiActor, PermissionSet } from "../api/api-security";
import { MANAGED_DEPARTMENTS_CTE, isCompanyWideRole } from "../organization/department-scope";
import { addDays, cairoToday, previousPeriod, type ReportPeriod } from "./report-period";
import type {
  ApprovalsReport, AssetsReport, AttendanceReport, AttendanceTotals, CountRow, DatedPerson, DocumentsReport, LearningReport,
  LeaveReport, LifecycleReport, RecruitmentReport, ReportOverview, WorkforceReport,
} from "./report-types";

type Row = Record<string, unknown>;

const ACTIVE = "'active','probation','notice_period'";
const APPROVED = "'hr_approved','approved'";
const PENDING = "'pending_manager','pending_hr'";
const PRESENT = "NULLIF(BTRIM(da.actual_in),'') IS NOT NULL";
/** A day the employee was expected to work: not a holiday, weekend, approved leave or a day that has not happened yet. */
const WORKDAY = "da.status NOT IN ('holiday','non_working_day','leave','scheduled')";
/** Turned up on such a day; a punch on a day off is overtime, not attendance, and must not push the rate past 100%. */
const ATTENDED = `${PRESENT} AND ${WORKDAY}`;
const PERSON = "e.id AS employee_id,e.employee_code,e.name_en,e.name_ar,d.name_en AS department_en,d.name_ar AS department_ar";
const DEPARTMENT_JOIN = "LEFT JOIN departments d ON d.id=e.department_id";
const DAY_MS = 86400000;

const num = (value: unknown) => Number(value) || 0;
const maybe = (value: unknown) => (value == null ? null : Number(value));
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const daysFrom = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
const counts = (rows: Row[]): CountRow[] => rows.map(row => ({ key: String(row.key ?? ""), count: num(row.count) }));

/** Who the actor may report on: `null` is everyone, otherwise the explicit employee ids (a manager's own branch). */
export async function reportEmployeeScope(db: PostgresDatabase, actor: Pick<ApiActor, "roleName" | "employeeId">): Promise<number[] | null> {
  if (isCompanyWideRole(actor.roleName)) return null;
  if (actor.roleName === "Employee") return actor.employeeId ? [actor.employeeId] : [];
  if (actor.roleName === "Department Manager" && actor.employeeId) {
    const rows = (await db.prepare(`${MANAGED_DEPARTMENTS_CTE} SELECT e.id FROM employees e WHERE e.department_id IN (SELECT id FROM managed) AND e.employment_status!='deleted'`).bind(actor.employeeId).all()).results;
    return [...new Set([actor.employeeId, ...rows.map(row => Number(row.id))])];
  }
  return [];
}

export async function loadReportOverview(db: PostgresDatabase, actor: ApiActor, can: PermissionSet, period: ReportPeriod): Promise<ReportOverview> {
  const today = cairoToday(), previous = previousPeriod(period), ids = await reportEmployeeScope(db, actor);
  const companyWide = ids === null;
  const scopeSql = ids === null ? "" : ids.length ? ` AND e.id IN (${ids.map(() => "?").join(",")})` : " AND 1=0";
  const scopeArgs = ids ?? [];

  /** `head` must end inside a WHERE clause that aliases employees as `e`; the scope is appended there, `tail` follows it. */
  const rows = async (head: string, params: unknown[] = [], tail = "") => (await db.prepare(`${head}${scopeSql} ${tail}`).bind(...params, ...scopeArgs).all()).results as Row[];
  const one = async (head: string, params: unknown[] = [], tail = "") => (await rows(head, params, tail))[0] ?? {};
  const persons = <T extends Row>(list: Row[], extra: (row: Row) => T) => list.map(row => ({
    employee_id: num(row.employee_id), employee_code: String(row.employee_code ?? ""), name_en: String(row.name_en ?? ""), name_ar: String(row.name_ar ?? ""),
    department_en: (row.department_en as string | null) ?? null, department_ar: (row.department_ar as string | null) ?? null, ...extra(row),
  }));
  const dated = (list: Row[], field: string): DatedPerson[] => persons(list, row => ({ date: String(row[field] ?? "") })) as DatedPerson[];

  const workforce = async (): Promise<WorkforceReport> => {
    const active = `e.employment_status IN (${ACTIVE})`;
    const [statuses, departments, countries, types, starts, hires, leavers, contracts] = await Promise.all([
      rows("SELECT e.employment_status AS key,COUNT(*)::int AS count FROM employees e WHERE e.employment_status!='deleted'", [], "GROUP BY 1 ORDER BY 2 DESC"),
      rows(`SELECT d.name_en,d.name_ar,COUNT(*)::int AS count FROM employees e ${DEPARTMENT_JOIN} WHERE ${active}`, [], "GROUP BY d.id,d.name_en,d.name_ar ORDER BY count DESC,d.name_en LIMIT 12"),
      rows(`SELECT COALESCE(e.country,'') AS key,COUNT(*)::int AS count FROM employees e WHERE ${active}`, [], "GROUP BY 1 ORDER BY 2 DESC"),
      rows(`SELECT COALESCE(e.employment_type,'full_time') AS key,COUNT(*)::int AS count FROM employees e WHERE ${active}`, [], "GROUP BY 1 ORDER BY 2 DESC"),
      rows(`SELECT e.start_date FROM employees e WHERE ${active}`),
      rows(`SELECT ${PERSON},e.start_date AS date,COUNT(*) OVER()::int AS total FROM employees e ${DEPARTMENT_JOIN} WHERE e.employment_status!='deleted' AND e.start_date>=? AND e.start_date<=?`, [period.from, period.to], "ORDER BY e.start_date DESC LIMIT 15"),
      rows(`SELECT ${PERSON},e.end_date AS date,COUNT(*) OVER()::int AS total FROM employees e ${DEPARTMENT_JOIN} WHERE e.employment_status='inactive' AND e.end_date>=? AND e.end_date<=?`, [period.from, period.to], "ORDER BY e.end_date DESC LIMIT 15"),
      rows(`SELECT ${PERSON},e.end_date AS date,COUNT(*) OVER()::int AS total FROM employees e ${DEPARTMENT_JOIN} WHERE ${active} AND e.end_date>=? AND e.end_date<=?`, [today, addDays(today, 60)], "ORDER BY e.end_date LIMIT 15"),
    ]);
    const headcount = statuses.filter(row => ACTIVE.includes(`'${row.key}'`)).reduce((sum, row) => sum + num(row.count), 0);
    const tenures = starts.map(row => daysFrom(String(row.start_date), today) / 365.25).filter(years => Number.isFinite(years) && years >= 0);
    const bucket = (test: (years: number) => boolean) => tenures.filter(test).length;
    const leaverTotal = num(leavers[0]?.total);
    return {
      active: headcount,
      inactive: num(statuses.find(row => row.key === "inactive")?.count),
      byStatus: counts(statuses),
      byDepartment: departments.map(row => ({ name_en: row.name_en as string | null, name_ar: row.name_ar as string | null, count: num(row.count) })),
      byCountry: counts(countries),
      byType: counts(types),
      byTenure: [
        { key: "lt1", count: bucket(years => years < 1) }, { key: "1to3", count: bucket(years => years >= 1 && years < 3) },
        { key: "3to5", count: bucket(years => years >= 3 && years < 5) }, { key: "gt5", count: bucket(years => years >= 5) },
      ],
      averageTenureYears: tenures.length ? round(tenures.reduce((sum, years) => sum + years, 0) / tenures.length) : 0,
      hires: { total: num(hires[0]?.total), rows: dated(hires, "date") },
      leavers: { total: leaverTotal, rows: dated(leavers, "date") },
      turnoverRate: headcount + leaverTotal ? round((leaverTotal / (headcount + leaverTotal)) * 100) : 0,
      contractsEnding: { total: num(contracts[0]?.total), rows: dated(contracts, "date") },
    };
  };

  const attendance = async (): Promise<AttendanceReport> => {
    const through = period.to < today ? period.to : today;
    const base = `FROM daily_attendance da JOIN employees e ON e.id=da.employee_id ${DEPARTMENT_JOIN} WHERE e.employment_status!='deleted' AND COALESCE(e.employment_type,'full_time')='full_time' AND da.work_date>=? AND da.work_date<=?`;
    const totals = async (from: string, to: string): Promise<AttendanceTotals> => {
      const row = await one(`SELECT COUNT(*) FILTER (WHERE ${WORKDAY})::int AS workdays,COUNT(*) FILTER (WHERE ${ATTENDED})::int AS attended,COUNT(*) FILTER (WHERE da.status='absent')::int AS absent,COUNT(*) FILTER (WHERE da.status='leave')::int AS leave_days,COUNT(*) FILTER (WHERE ${ATTENDED} AND da.late_minutes>0)::int AS late_days,COALESCE(SUM(da.late_minutes) FILTER (WHERE ${ATTENDED} AND da.late_minutes>0),0)::int AS late_minutes,COUNT(*) FILTER (WHERE da.early_minutes>0)::int AS early_days,COALESCE(SUM(da.overtime_minutes),0)::int AS overtime_minutes,COALESCE(SUM(da.worked_minutes),0)::int AS worked_minutes,COUNT(*) FILTER (WHERE ${ATTENDED} AND da.attendance_type='remote')::int AS remote_days,COUNT(*) FILTER (WHERE ${PRESENT} AND NULLIF(BTRIM(da.actual_out),'') IS NULL AND da.work_date<?)::int AS missing_checkout,COUNT(*) FILTER (WHERE da.status='needs_review')::int AS needs_review,COUNT(DISTINCT da.employee_id)::int AS employees ${base}`, [today, from, to]);
      return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, num(value)])) as AttendanceTotals;
    };
    const [current, before, daily, departments, late, absent, exceptions] = await Promise.all([
      totals(period.from, through),
      totals(previous.from, previous.to < today ? previous.to : today),
      rows(`SELECT da.work_date AS date,COUNT(*) FILTER (WHERE ${ATTENDED})::int AS attended,COUNT(*) FILTER (WHERE ${ATTENDED} AND da.late_minutes>0)::int AS late,COUNT(*) FILTER (WHERE da.status='absent')::int AS absent ${base}`, [period.from, through], "GROUP BY da.work_date ORDER BY da.work_date"),
      rows(`SELECT d.name_en,d.name_ar,COUNT(DISTINCT da.employee_id)::int AS employees,COUNT(*) FILTER (WHERE ${WORKDAY})::int AS workdays,COUNT(*) FILTER (WHERE ${ATTENDED})::int AS attended,COUNT(*) FILTER (WHERE da.status='absent')::int AS absent,COUNT(*) FILTER (WHERE ${ATTENDED} AND da.late_minutes>0)::int AS late_days,COALESCE(SUM(da.late_minutes) FILTER (WHERE ${ATTENDED} AND da.late_minutes>0),0)::int AS late_minutes ${base}`, [period.from, through], "GROUP BY d.id,d.name_en,d.name_ar ORDER BY workdays DESC LIMIT 20"),
      rows(`SELECT ${PERSON},COUNT(*) FILTER (WHERE ${ATTENDED} AND da.late_minutes>0)::int AS days,COALESCE(SUM(da.late_minutes) FILTER (WHERE ${ATTENDED} AND da.late_minutes>0),0)::int AS minutes ${base}`, [period.from, through], `GROUP BY e.id,d.id HAVING COUNT(*) FILTER (WHERE ${ATTENDED} AND da.late_minutes>0)>0 ORDER BY days DESC,minutes DESC LIMIT 10`),
      rows(`SELECT ${PERSON},COUNT(*) FILTER (WHERE da.status='absent')::int AS days ${base}`, [period.from, through], "GROUP BY e.id,d.id HAVING COUNT(*) FILTER (WHERE da.status='absent')>0 ORDER BY days DESC LIMIT 10"),
      one("SELECT COUNT(*)::int AS count FROM attendance_exceptions x JOIN employees e ON e.id=x.employee_id WHERE x.status IN ('open','correction_requested','pending_manager','pending_hr') AND x.attendance_date>=? AND x.attendance_date<=?", [period.from, period.to]),
    ]);
    return {
      through, totals: current, previous: before,
      daily: daily.map(row => ({ date: String(row.date), attended: num(row.attended), late: num(row.late), absent: num(row.absent) })),
      byDepartment: departments.map(row => ({ name_en: row.name_en as string | null, name_ar: row.name_ar as string | null, employees: num(row.employees), workdays: num(row.workdays), attended: num(row.attended), absent: num(row.absent), late_days: num(row.late_days), late_minutes: num(row.late_minutes) })),
      topLate: persons(late, row => ({ days: num(row.days), minutes: num(row.minutes) })),
      topAbsent: persons(absent, row => ({ days: num(row.days) })),
      openExceptions: num(exceptions.count),
    };
  };

  const leave = async (): Promise<LeaveReport> => {
    const base = `FROM requests q JOIN employees e ON e.id=q.employee_id AND e.employment_status!='deleted' JOIN leave_types lt ON lt.id=q.leave_type_id ${DEPARTMENT_JOIN} WHERE q.from_date>=? AND q.from_date<=?`;
    const year = Number(period.to.slice(0, 4)), horizon = addDays(today, 14);
    const [types, previousDays, takers, departments, balances, high, onLeave, upcoming] = await Promise.all([
      rows(`SELECT lt.name_en,lt.name_ar,COUNT(*)::int AS requests,COUNT(*) FILTER (WHERE q.status IN (${APPROVED}))::int AS approved,COUNT(*) FILTER (WHERE q.status IN (${PENDING}))::int AS pending,COUNT(*) FILTER (WHERE q.status LIKE '%rejected%')::int AS rejected,COALESCE(SUM(q.requested_days) FILTER (WHERE q.status IN (${APPROVED})),0)::float8 AS approved_days ${base}`, [period.from, period.to], "GROUP BY lt.id,lt.name_en,lt.name_ar ORDER BY approved_days DESC,requests DESC"),
      one(`SELECT COALESCE(SUM(q.requested_days),0)::float8 AS days ${base} AND q.status IN (${APPROVED})`, [previous.from, previous.to]),
      rows(`SELECT ${PERSON},COALESCE(SUM(q.requested_days),0)::float8 AS days,COUNT(*)::int AS requests ${base} AND q.status IN (${APPROVED})`, [period.from, period.to], "GROUP BY e.id,d.id ORDER BY days DESC LIMIT 10"),
      rows(`SELECT d.name_en,d.name_ar,COALESCE(SUM(q.requested_days),0)::float8 AS days ${base} AND q.status IN (${APPROVED})`, [period.from, period.to], "GROUP BY d.id,d.name_en,d.name_ar ORDER BY days DESC LIMIT 12"),
      rows(`SELECT lt.name_en,lt.name_ar,COUNT(DISTINCT b.employee_id)::int AS employees,SUM(b.entitlement)::float8 AS entitlement,SUM(b.used)::float8 AS used,SUM(b.pending)::float8 AS pending FROM leave_balances b JOIN employees e ON e.id=b.employee_id AND e.employment_status IN (${ACTIVE}) JOIN leave_types lt ON lt.id=b.leave_type_id JOIN employee_leave_types x ON x.employee_id=b.employee_id AND x.leave_type_id=b.leave_type_id WHERE b.year=? AND b.entitlement>0`, [year], "GROUP BY lt.id,lt.name_en,lt.name_ar ORDER BY entitlement DESC"),
      rows(`SELECT ${PERSON},SUM(b.entitlement)::float8 AS entitlement,SUM(b.used)::float8 AS used,SUM(b.pending)::float8 AS pending FROM leave_balances b JOIN employees e ON e.id=b.employee_id AND e.employment_status IN (${ACTIVE}) JOIN leave_types lt ON lt.id=b.leave_type_id JOIN employee_leave_types x ON x.employee_id=b.employee_id AND x.leave_type_id=b.leave_type_id ${DEPARTMENT_JOIN} WHERE b.year=? AND b.entitlement>0 AND lt.code LIKE '%ANNUAL%'`, [year], "GROUP BY e.id,d.id ORDER BY SUM(b.entitlement-b.used-b.pending) DESC LIMIT 10"),
      one(`SELECT COUNT(DISTINCT q.employee_id)::int AS count FROM requests q JOIN employees e ON e.id=q.employee_id WHERE q.leave_type_id IS NOT NULL AND q.status IN (${APPROVED}) AND q.from_date<=? AND q.to_date>=?`, [today, today]),
      rows(`SELECT ${PERSON},lt.name_en AS leave_en,lt.name_ar AS leave_ar,q.from_date,q.to_date,COALESCE(q.requested_days,0)::float8 AS days,COUNT(*) OVER()::int AS total FROM requests q JOIN employees e ON e.id=q.employee_id JOIN leave_types lt ON lt.id=q.leave_type_id ${DEPARTMENT_JOIN} WHERE q.status IN (${APPROVED}) AND q.to_date>=? AND q.from_date<=?`, [today, horizon], "ORDER BY q.from_date,e.name_en LIMIT 12"),
    ]);
    const sum = (key: string) => types.reduce((total, row) => total + num(row[key]), 0);
    return {
      totals: { requests: sum("requests"), approved: sum("approved"), pending: sum("pending"), rejected: sum("rejected"), approved_days: round(sum("approved_days")), previous_approved_days: round(num(previousDays.days)) },
      byType: types.map(row => ({ name_en: row.name_en as string | null, name_ar: row.name_ar as string | null, requests: num(row.requests), approved: num(row.approved), pending: num(row.pending), rejected: num(row.rejected), approved_days: round(num(row.approved_days)) })),
      byDepartment: departments.filter(row => num(row.days) > 0).map(row => ({ name_en: row.name_en as string | null, name_ar: row.name_ar as string | null, days: round(num(row.days)) })),
      topTakers: persons(takers, row => ({ days: round(num(row.days)), requests: num(row.requests) })),
      balanceYear: year,
      balances: balances.map(row => ({ name_en: row.name_en as string | null, name_ar: row.name_ar as string | null, employees: num(row.employees), entitlement: round(num(row.entitlement)), used: round(num(row.used)), pending: round(num(row.pending)) })),
      highBalances: persons(high, row => ({ entitlement: num(row.entitlement), used: num(row.used), pending: num(row.pending) })),
      onLeaveToday: num(onLeave.count),
      upcoming: { total: num(upcoming[0]?.total), rows: persons(upcoming, row => ({ leave_en: String(row.leave_en ?? ""), leave_ar: String(row.leave_ar ?? ""), from_date: String(row.from_date ?? ""), to_date: String(row.to_date ?? ""), days: num(row.days) })) },
    };
  };

  const approvals = async (): Promise<ApprovalsReport> => {
    const kind = "CASE WHEN q.leave_type_id IS NOT NULL THEN 'leave' ELSE q.type END";
    const base = `FROM requests q JOIN employees e ON e.id=q.employee_id AND e.employment_status!='deleted' ${DEPARTMENT_JOIN} WHERE q.created_at::date>=?::date AND q.created_at::date<=?::date`;
    const [totals, before, speed, kinds, waiting, oldest] = await Promise.all([
      one(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE q.status IN (${APPROVED}))::int AS approved,COUNT(*) FILTER (WHERE q.status='pending_manager')::int AS pending_manager,COUNT(*) FILTER (WHERE q.status='pending_hr')::int AS pending_hr,COUNT(*) FILTER (WHERE q.status LIKE '%rejected%')::int AS rejected,COUNT(*) FILTER (WHERE q.status='cancelled')::int AS cancelled ${base}`, [period.from, period.to]),
      one(`SELECT COUNT(*)::int AS total ${base}`, [previous.from, previous.to]),
      one(`SELECT AVG(EXTRACT(EPOCH FROM (x.decided-q.created_at))/3600)::float8 AS hours FROM requests q JOIN employees e ON e.id=q.employee_id JOIN LATERAL (SELECT MAX(a.created_at) AS decided FROM approvals a WHERE a.request_id=q.id) x ON x.decided IS NOT NULL WHERE q.status NOT IN (${PENDING},'cancelled') AND q.created_at::date>=?::date AND q.created_at::date<=?::date`, [period.from, period.to]),
      rows(`SELECT ${kind} AS key,COUNT(*)::int AS total,COUNT(*) FILTER (WHERE q.status IN (${APPROVED}))::int AS approved,COUNT(*) FILTER (WHERE q.status IN (${PENDING}))::int AS pending,COUNT(*) FILTER (WHERE q.status LIKE '%rejected%')::int AS rejected ${base}`, [period.from, period.to], "GROUP BY 1 ORDER BY total DESC LIMIT 10"),
      one(`SELECT COUNT(*) FILTER (WHERE q.status='pending_manager')::int AS manager,COUNT(*) FILTER (WHERE q.status='pending_hr')::int AS hr,COUNT(*) FILTER (WHERE q.created_at<NOW()-INTERVAL '3 days')::int AS overdue FROM requests q JOIN employees e ON e.id=q.employee_id WHERE q.status IN (${PENDING})`),
      rows(`SELECT ${PERSON},q.request_code,${kind} AS kind,q.status,q.current_stage AS stage,ROUND(EXTRACT(EPOCH FROM (NOW()-q.created_at))/86400)::int AS age_days,COUNT(*) OVER()::int AS total FROM requests q JOIN employees e ON e.id=q.employee_id ${DEPARTMENT_JOIN} WHERE q.status IN (${PENDING})`, [], "ORDER BY q.created_at LIMIT 10"),
    ]);
    return {
      totals: { total: num(totals.total), approved: num(totals.approved), pending_manager: num(totals.pending_manager), pending_hr: num(totals.pending_hr), rejected: num(totals.rejected), cancelled: num(totals.cancelled), previous_total: num(before.total) },
      averageHours: maybe(speed.hours),
      byKind: kinds.map(row => ({ key: String(row.key ?? ""), total: num(row.total), approved: num(row.approved), pending: num(row.pending), rejected: num(row.rejected) })),
      pendingNow: { manager: num(waiting.manager), hr: num(waiting.hr), overdue: num(waiting.overdue) },
      oldest: { total: num(oldest[0]?.total), rows: persons(oldest, row => ({ request_code: String(row.request_code ?? ""), kind: String(row.kind ?? ""), status: String(row.status ?? ""), stage: String(row.stage ?? ""), age_days: num(row.age_days) })) },
    };
  };

  /** Expiry data names individual employees' identity papers, so like the raw export it stays with HR. */
  const documents = async (): Promise<DocumentsReport> => {
    const state = "CASE WHEN NULLIF(d.expiry_date,'') IS NULL THEN 'no_expiry' WHEN d.expiry_date<? THEN 'expired' WHEN d.expiry_date<=? THEN 'expiring' ELSE 'valid' END";
    const [states, attention, missingByCategory, missingEmployees] = await Promise.all([
      rows(`SELECT c.name_en,c.name_ar,${state} AS state,COUNT(*)::int AS count FROM documents d JOIN employees e ON e.id=d.employee_id AND e.employment_status IN (${ACTIVE}) JOIN document_categories c ON c.code=d.category WHERE d.status='active'`, [today, addDays(today, 30)], "GROUP BY c.id,c.name_en,c.name_ar,3"),
      rows(`SELECT ${PERSON},c.name_en AS category_en,c.name_ar AS category_ar,dc.name,dc.expiry_date,COUNT(*) OVER()::int AS total FROM documents dc JOIN employees e ON e.id=dc.employee_id AND e.employment_status IN (${ACTIVE}) JOIN document_categories c ON c.code=dc.category ${DEPARTMENT_JOIN} WHERE dc.status='active' AND NULLIF(dc.expiry_date,'') IS NOT NULL AND dc.expiry_date<=?`, [addDays(today, 30)], "ORDER BY dc.expiry_date LIMIT 15"),
      rows(`SELECT c.name_en,c.name_ar,COUNT(*)::int AS count FROM employees e JOIN document_categories c ON c.required_document=1 AND c.status='active' AND (c.country IS NULL OR c.country=e.country) AND (c.employment_type IS NULL OR c.employment_type=e.employment_type) WHERE e.employment_status IN (${ACTIVE})`, [], "AND NOT EXISTS (SELECT 1 FROM documents dc WHERE dc.employee_id=e.id AND dc.category=c.code AND dc.status='active') GROUP BY c.id,c.name_en,c.name_ar ORDER BY count DESC"),
      rows(`SELECT ${PERSON},COUNT(*)::int AS count,string_agg(c.name_en,', ') AS names_en,string_agg(c.name_ar,'، ') AS names_ar FROM employees e JOIN document_categories c ON c.required_document=1 AND c.status='active' AND (c.country IS NULL OR c.country=e.country) AND (c.employment_type IS NULL OR c.employment_type=e.employment_type) ${DEPARTMENT_JOIN} WHERE e.employment_status IN (${ACTIVE})`, [], "AND NOT EXISTS (SELECT 1 FROM documents dc WHERE dc.employee_id=e.id AND dc.category=c.code AND dc.status='active') GROUP BY e.id,d.id ORDER BY count DESC,e.name_en LIMIT 10"),
    ]);
    const totals = { active: 0, valid: 0, expiring: 0, expired: 0, no_expiry: 0 };
    const categories = new Map<string, { name_en: string | null; name_ar: string | null; total: number; expired: number; expiring: number }>();
    for (const row of states) {
      const key = String(row.state) as "valid" | "expiring" | "expired" | "no_expiry", count = num(row.count), id = `${row.name_en}|${row.name_ar}`;
      totals[key] += count; totals.active += count;
      const entry = categories.get(id) ?? { name_en: row.name_en as string | null, name_ar: row.name_ar as string | null, total: 0, expired: 0, expiring: 0 };
      entry.total += count; if (key === "expired") entry.expired += count; if (key === "expiring") entry.expiring += count;
      categories.set(id, entry);
    }
    return {
      totals,
      byCategory: [...categories.values()].sort((a, b) => b.expired + b.expiring - (a.expired + a.expiring) || b.total - a.total),
      attention: { total: num(attention[0]?.total), rows: persons(attention, row => ({ category_en: (row.category_en as string | null) ?? null, category_ar: (row.category_ar as string | null) ?? null, name: String(row.name ?? ""), expiry_date: String(row.expiry_date ?? ""), days_left: daysFrom(today, String(row.expiry_date)) })) },
      missing: {
        total: missingByCategory.reduce((sum, row) => sum + num(row.count), 0),
        byCategory: missingByCategory.map(row => ({ name_en: row.name_en as string | null, name_ar: row.name_ar as string | null, count: num(row.count) })),
        employees: persons(missingEmployees, row => ({ count: num(row.count), names_en: String(row.names_en ?? ""), names_ar: String(row.names_ar ?? "") })),
      },
    };
  };

  const recruitment = async (): Promise<RecruitmentReport> => {
    const byManager = actor.roleName === "Department Manager";
    const jobScope = byManager ? " AND j.hiring_manager_employee_id=?" : "";
    const jobArgs = byManager ? [actor.employeeId] : [];
    const run = async (sql: string, params: unknown[] = [], tail = "") => (await db.prepare(`${sql}${jobScope} ${tail}`).bind(...params, ...jobArgs).all()).results as Row[];
    const decided = "a.decision_at::date>=?::date AND a.decision_at::date<=?::date";
    const [jobs, apps, stages, sources, open] = await Promise.all([
      run("SELECT COUNT(*) FILTER (WHERE j.status='open')::int AS open_jobs,COALESCE(SUM(j.openings_count) FILTER (WHERE j.status='open'),0)::int AS open_positions FROM job_openings j WHERE 1=1"),
      run(`SELECT COUNT(*) FILTER (WHERE a.applied_at::date>=?::date AND a.applied_at::date<=?::date)::int AS applications,COUNT(*) FILTER (WHERE a.status IN ('active','on_hold','offer'))::int AS pipeline,COUNT(*) FILTER (WHERE a.status='hired' AND ${decided})::int AS hired,COUNT(*) FILTER (WHERE a.status='rejected' AND ${decided})::int AS rejected,COUNT(*) FILTER (WHERE a.status IN ('active','on_hold') AND a.stage_entered_at<NOW()-INTERVAL '14 days')::int AS stalled,AVG(EXTRACT(EPOCH FROM (a.decision_at-a.applied_at))/86400) FILTER (WHERE a.status='hired' AND ${decided})::float8 AS days_to_hire FROM candidate_applications a JOIN job_openings j ON j.id=a.job_id WHERE 1=1`, [period.from, period.to, period.from, period.to, period.from, period.to, period.from, period.to]),
      run("SELECT s.stage_key AS key,MIN(s.name_en) AS name_en,MIN(s.name_ar) AS name_ar,MIN(s.sort_order)::int AS position,COUNT(*)::int AS count FROM candidate_applications a JOIN recruitment_stages s ON s.id=a.current_stage_id JOIN job_openings j ON j.id=a.job_id WHERE a.status IN ('active','on_hold','offer')", [], "GROUP BY s.stage_key ORDER BY position"),
      run("SELECT COALESCE(NULLIF(a.source,''),'unknown') AS key,COUNT(*)::int AS applications,COUNT(*) FILTER (WHERE a.status='hired')::int AS hired FROM candidate_applications a JOIN job_openings j ON j.id=a.job_id WHERE a.applied_at::date>=?::date AND a.applied_at::date<=?::date", [period.from, period.to], "GROUP BY 1 ORDER BY applications DESC LIMIT 8"),
      run("SELECT j.id,j.title,j.openings_count,j.created_date,COUNT(a.id) FILTER (WHERE a.status IN ('active','on_hold','offer'))::int AS pipeline,COUNT(a.id) FILTER (WHERE a.status='hired')::int AS hired FROM job_openings j LEFT JOIN candidate_applications a ON a.job_id=j.id WHERE j.status='open'", [], "GROUP BY j.id ORDER BY j.created_date LIMIT 12"),
    ]);
    const head = jobs[0] ?? {}, stats = apps[0] ?? {};
    return {
      openJobs: num(head.open_jobs), openPositions: num(head.open_positions), pipeline: num(stats.pipeline), applications: num(stats.applications),
      hired: num(stats.hired), rejected: num(stats.rejected), stalled: num(stats.stalled), avgDaysToHire: stats.days_to_hire == null ? null : round(num(stats.days_to_hire)),
      byStage: stages.map(row => ({ key: String(row.key), name_en: row.name_en as string | null, name_ar: row.name_ar as string | null, count: num(row.count) })),
      bySource: sources.map(row => ({ key: String(row.key), applications: num(row.applications), hired: num(row.hired) })),
      jobs: open.map(row => ({ id: num(row.id), title: String(row.title), openings_count: num(row.openings_count), created_date: String(row.created_date ?? ""), pipeline: num(row.pipeline), hired: num(row.hired) })),
    };
  };

  const lifecycle = async (types: string[]): Promise<LifecycleReport> => {
    const kinds = `l.lifecycle_type IN (${types.map(() => "?").join(",")})`;
    const openOnes = "l.status NOT IN ('completed','cancelled')";
    const [summary, completed, overdue] = await Promise.all([
      rows(`SELECT l.lifecycle_type AS type,COUNT(DISTINCT l.id)::int AS lifecycles,COUNT(t.id)::int AS tasks,COUNT(t.id) FILTER (WHERE t.status='completed')::int AS done,COUNT(t.id) FILTER (WHERE t.status!='completed' AND t.due_date<?)::int AS overdue FROM employee_lifecycles l JOIN employees e ON e.id=l.employee_id LEFT JOIN lifecycle_tasks t ON t.lifecycle_id=l.id WHERE ${openOnes} AND ${kinds}`, [today, ...types], "GROUP BY 1"),
      rows(`SELECT l.lifecycle_type AS key,COUNT(*)::int AS count FROM employee_lifecycles l JOIN employees e ON e.id=l.employee_id WHERE l.status='completed' AND l.completed_at::date>=?::date AND l.completed_at::date<=?::date AND ${kinds}`, [period.from, period.to, ...types], "GROUP BY 1"),
      rows(`SELECT ${PERSON},t.title,t.due_date,l.lifecycle_type AS type,COUNT(*) OVER()::int AS total FROM lifecycle_tasks t JOIN employee_lifecycles l ON l.id=t.lifecycle_id JOIN employees e ON e.id=l.employee_id ${DEPARTMENT_JOIN} WHERE ${openOnes} AND t.status!='completed' AND t.due_date<? AND ${kinds}`, [today, ...types], "ORDER BY t.due_date LIMIT 10"),
    ]);
    return {
      types: summary.map(row => ({ type: String(row.type), lifecycles: num(row.lifecycles), tasks: num(row.tasks), done: num(row.done), overdue: num(row.overdue) })),
      completedInPeriod: counts(completed),
      overdueTasks: { total: num(overdue[0]?.total), rows: persons(overdue, row => ({ title: String(row.title ?? ""), due_date: String(row.due_date ?? ""), type: String(row.type ?? ""), days_late: daysFrom(String(row.due_date), today) })) },
    };
  };

  const assets = async (): Promise<AssetsReport> => {
    const [statuses, categories, poor, unreturned] = await Promise.all([
      companyWide ? db.prepare("SELECT status AS key,COUNT(*)::int AS count FROM assets GROUP BY 1 ORDER BY 2 DESC").all() : null,
      companyWide ? db.prepare("SELECT a.category AS key,COUNT(*)::int AS total,COUNT(*) FILTER (WHERE a.status='assigned')::int AS assigned FROM assets a GROUP BY 1 ORDER BY total DESC LIMIT 10").all() : null,
      companyWide ? db.prepare("SELECT COUNT(*)::int AS count FROM assets WHERE asset_condition IN ('poor','damaged','needs_repair')").all() : null,
      rows(`SELECT ${PERSON},a.asset_code,a.name AS asset_name,a.category,x.assigned_at,COUNT(*) OVER()::int AS total FROM asset_assignments x JOIN assets a ON a.id=x.asset_id JOIN employees e ON e.id=x.employee_id ${DEPARTMENT_JOIN} WHERE x.returned_at IS NULL AND (e.employment_status='inactive' OR EXISTS (SELECT 1 FROM employee_lifecycles l WHERE l.employee_id=e.id AND l.lifecycle_type='offboarding' AND l.status NOT IN ('completed','cancelled')))`, [], "ORDER BY x.assigned_at LIMIT 10"),
    ]);
    return {
      inventory: statuses && categories && poor ? {
        byStatus: counts(statuses.results as Row[]),
        byCategory: (categories.results as Row[]).map(row => ({ key: String(row.key), total: num(row.total), assigned: num(row.assigned) })),
        poorCondition: num((poor.results as Row[])[0]?.count),
      } : null,
      unreturned: { total: num(unreturned[0]?.total), rows: persons(unreturned, row => ({ asset_code: String(row.asset_code ?? ""), asset_name: String(row.asset_name ?? ""), category: String(row.category ?? ""), assigned_at: String(row.assigned_at ?? "").slice(0, 10) })) },
    };
  };

  const learning = async (): Promise<LearningReport> => {
    const base = `FROM training_enrollments x JOIN training_courses c ON c.id=x.course_id JOIN employees e ON e.id=x.employee_id AND e.employment_status IN (${ACTIVE}) ${DEPARTMENT_JOIN} WHERE x.status!='cancelled'`;
    const [totals, overdue, certificates, courses] = await Promise.all([
      one(`SELECT COUNT(*) FILTER (WHERE x.status='assigned')::int AS assigned,COUNT(*) FILTER (WHERE x.status='in_progress')::int AS in_progress,COUNT(*) FILTER (WHERE x.status='completed')::int AS completed,COUNT(*) FILTER (WHERE x.status='failed')::int AS failed,COUNT(*) FILTER (WHERE x.status='completed' AND x.completion_date>=? AND x.completion_date<=?)::int AS completed_in_period ${base}`, [period.from, period.to]),
      rows(`SELECT ${PERSON},c.title AS course,x.due_date,COUNT(*) OVER()::int AS total ${base} AND c.mandatory=1 AND x.status IN ('assigned','in_progress') AND x.due_date<?`, [today], "ORDER BY x.due_date LIMIT 10"),
      rows(`SELECT ${PERSON},c.title AS course,x.certificate_expiry AS expiry,COUNT(*) OVER()::int AS total ${base} AND x.status='completed' AND NULLIF(x.certificate_expiry,'') IS NOT NULL AND x.certificate_expiry<=?`, [addDays(today, 60)], "ORDER BY x.certificate_expiry LIMIT 10"),
      rows(`SELECT c.title,c.mandatory,COUNT(*)::int AS enrolled,COUNT(*) FILTER (WHERE x.status='completed')::int AS completed,AVG(x.score) FILTER (WHERE x.score IS NOT NULL)::float8 AS avg_score ${base}`, [], "GROUP BY c.id ORDER BY enrolled DESC LIMIT 10"),
    ]);
    const counted = num(totals.assigned) + num(totals.in_progress) + num(totals.completed) + num(totals.failed);
    return {
      totals: { assigned: num(totals.assigned), in_progress: num(totals.in_progress), completed: num(totals.completed), failed: num(totals.failed), completed_in_period: num(totals.completed_in_period) },
      completionRate: counted ? round((num(totals.completed) / counted) * 100) : 0,
      mandatoryOverdue: { total: num(overdue[0]?.total), rows: persons(overdue, row => ({ course: String(row.course ?? ""), due_date: String(row.due_date ?? ""), days_late: daysFrom(String(row.due_date), today) })) },
      certificates: { total: num(certificates[0]?.total), rows: persons(certificates, row => ({ course: String(row.course ?? ""), expiry: String(row.expiry ?? ""), days_left: daysFrom(today, String(row.expiry)) })) },
      byCourse: courses.map(row => ({ title: String(row.title), mandatory: num(row.mandatory), enrolled: num(row.enrolled), completed: num(row.completed), avg_score: row.avg_score == null ? null : round(num(row.avg_score)) })),
    };
  };

  const lifecycleTypes = (["onboarding", "offboarding"] as const).filter(type => can.allows(type, "export"));
  const [workforceReport, attendanceReport, leaveReport, approvalsReport, documentsReport, recruitmentReport, lifecycleReport, assetsReport, learningReport] = await Promise.all([
    workforce(), attendance(), leave(), approvals(),
    companyWide ? documents() : null,
    can.allows("recruitment", "export") ? recruitment() : null,
    lifecycleTypes.length ? lifecycle([...lifecycleTypes]) : null,
    can.allows("assets", "export") ? assets() : null,
    can.allows("learning", "export") ? learning() : null,
  ]);
  return {
    period, previous, today, generatedAt: new Date().toISOString(), scope: companyWide ? "company" : "team",
    workforce: workforceReport, attendance: attendanceReport, leave: leaveReport, approvals: approvalsReport, documents: documentsReport,
    recruitment: recruitmentReport, lifecycle: lifecycleReport, assets: assetsReport, learning: learningReport,
  };
}
