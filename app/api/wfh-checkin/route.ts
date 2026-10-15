import { withDatabase } from "../route-helpers";
import { enforceRateLimit, enforceWriteOrigin, hasPermission, requireActor } from "../api-security";
import { assertPayrollEmployee, payrollAccess } from "../../payroll/service";
import { requirePayrollPage } from "../../payroll/permissions";
import { employeePayrollCountry, isDate, localNow, monthKeyOf } from "../../timesheet/time";
import { validateWfhTransition } from "../../wfh/rules";
import type { PostgresDatabase, TransactionDatabase } from "../../../db/postgres";

type Db = PostgresDatabase | TransactionDatabase;
type Row = Record<string, unknown>;
const json = (value: unknown) => Response.json(value, { headers: { "cache-control": "private, no-store" } });
const fail = (message: string, status = 400): never => { throw new Response(message, { status }); };
const idOf = (value: unknown) => { const id = Number(value); if (!Number.isInteger(id) || id <= 0) fail("Invalid employee"); return id; };

async function employee(db: Db, id: number) {
  const row = await db.prepare("SELECT id,employee_code,name_en,name_ar,country,salary_country,employment_status FROM employees WHERE id=? AND employment_status!='deleted'").bind(id).first<Row>();
  if (!row) fail("Employee not found", 404);
  return row!;
}

async function assertDayOpen(db: Db, employeeId: number, date: string, country: string) {
  const payroll = await db.prepare("SELECT 1 AS blocked FROM payroll_month_locks WHERE period_key=? AND payroll_country=? AND locked=1").bind(monthKeyOf(date), country).first();
  if (payroll) fail("This payroll period is locked", 423);
  const month = date.slice(0, 7);
  const timesheet = await db.prepare("SELECT 1 AS blocked FROM timesheet_month_locks WHERE month_key=? AND payroll_country=? AND confirmed=1").bind(month, country).first();
  if (timesheet) {
    const exception = await db.prepare("SELECT 1 AS allowed FROM timesheet_edit_permissions WHERE month_key=? AND employee_id=? AND is_active=1").bind(month, employeeId).first();
    if (!exception) fail("This month is confirmed and editing is locked", 423);
  }
}

async function allowedDay(db: Db, employeeId: number, date: string, country: string) {
  const [assigned, company, request] = await Promise.all([
    db.prepare("SELECT 1 AS allowed FROM employee_wfh_days WHERE employee_id=? AND wfh_date=?").bind(employeeId,date).first(),
    db.prepare("SELECT 1 AS allowed FROM company_wfh_days WHERE wfh_date=? AND payroll_country IN ('',?)").bind(date,country).first(),
    db.prepare("SELECT 1 AS allowed FROM requests WHERE employee_id=? AND type='Work from home' AND status='hr_approved' AND from_date<=? AND to_date>=?").bind(employeeId,date,date).first(),
  ]);
  return Boolean(assigned || company || request);
}

async function manager(db: PostgresDatabase, actor: Awaited<ReturnType<typeof requireActor>>) {
  if (actor.roleName !== "Super Admin" && actor.roleName !== "HR Manager") fail("Permission denied",403);
  await payrollAccess(db,actor);
  await requirePayrollPage(db,actor,"wfhCheckin","edit");
}

export async function GET(request: Request) {
  return withDatabase("Unable to load WFH sessions", async db => {
    const actor = await requireActor(request,db);
    const url = new URL(request.url);
    if (url.searchParams.get("view") === "people") {
      await manager(db,actor);
      const access=await payrollAccess(db,actor);
      const all=(await db.prepare("SELECT id,employee_code,name_en,name_ar,country,salary_country,working_business_unit_id FROM employees WHERE employment_status!='deleted' ORDER BY name_en,id").all()).results;
      return json({employees:all.filter(row=>(!access.region||employeePayrollCountry(row)===access.region)&&(!access.units||access.units.includes(Number(row.working_business_unit_id))))});
    }
    const target = Number(url.searchParams.get("employeeId")) || actor.employeeId;
    if (!target) throw new Response("Employee profile required",{status:403});
    if (target !== actor.employeeId) { await manager(db,actor); await assertPayrollEmployee(db,actor,target); }
    else if (!(await hasPermission(db,actor,"attendance","create")) && actor.roleName !== "Super Admin") fail("Permission denied",403);
    const person = await employee(db,target);
    const date = localNow("Asia/Riyadh").date;
    const offset=Math.max(0,Math.min(100000,Number(url.searchParams.get("offset"))||0));
    const sessions = (await db.prepare("SELECT id,work_date,checked_in_at,checked_out_at,forced_by FROM wfh_sessions WHERE employee_id=? ORDER BY checked_in_at DESC,id DESC LIMIT 101 OFFSET ?").bind(target,offset).all()).results;
    const days = (await db.prepare("SELECT wfh_date FROM employee_wfh_days WHERE employee_id=? AND wfh_date>=? ORDER BY wfh_date").bind(target,date.slice(0,7)+"-01").all()).results;
    return json({employee:person,sessions:sessions.slice(0,100),hasMore:sessions.length>100,days,eligibleToday:await allowedDay(db,target,date,String(employeePayrollCountry(person)||"")),riyadhDate:date});
  });
}

export async function POST(request: Request) {
  return withDatabase("Unable to update WFH session", async db => {
    enforceWriteOrigin(request);
    const actor = await requireActor(request,db);
    await enforceRateLimit(db,request,"wfh-checkin",60,3600,actor.id);
    const input = await request.json().catch(()=>null) as Row | null;
    if (!input) throw new Response("Invalid request",{status:400});
    const action = String(input.action||"");
    const employeeId = action === "check_in" || action === "check_out" ? idOf(actor.employeeId) : idOf(input.employeeId);
    if (action === "check_in" || action === "check_out") {
      if (!(await hasPermission(db,actor,"attendance","create")) && actor.roleName !== "Super Admin") fail("Permission denied",403);
    } else { await manager(db,actor); await assertPayrollEmployee(db,actor,employeeId); }
    const person = await employee(db,employeeId),country = String(employeePayrollCountry(person)||"");
    if (!country) fail("Select Egypt or KSA");
    if (action === "assign_day") {
      const date = String(input.date||"");
      if (!isDate(date)) fail("Invalid WFH date");
      await assertDayOpen(db,employeeId,date,country);
      return json(input.remove
        ?await db.prepare("DELETE FROM employee_wfh_days WHERE employee_id=? AND wfh_date=? RETURNING id").bind(employeeId,date).first()
        :await db.prepare("INSERT INTO employee_wfh_days(employee_id,wfh_date,approved_by) VALUES(?,?,?) ON CONFLICT(employee_id,wfh_date) DO UPDATE SET approved_by=excluded.approved_by RETURNING *").bind(employeeId,date,actor.id).first());
    }
    if (!["check_in","check_out","force_checkout"].includes(action)) fail("Unknown WFH action");
    const now = new Date(),date = localNow("Asia/Riyadh",now).date;
    return db.transaction(async tx => {
      await tx.prepare("SELECT pg_advisory_xact_lock(?)").bind(700000+employeeId).run();
      const open = await tx.prepare("SELECT * FROM wfh_sessions WHERE employee_id=? AND checked_out_at IS NULL FOR UPDATE").bind(employeeId).first<Row>();
      const workDate = action === "check_in" ? date : String(open?.work_date||"");
      if (action === "check_in" && !(await allowedDay(tx,employeeId,date,country))) fail("Today is not an approved WFH day",409);
      if (action === "force_checkout" && !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(String(input.cairoDateTime||""))) fail("Choose a Cairo checkout date and time");
      const at = action === "force_checkout"
        ?new Date(String((await tx.prepare("SELECT (?::timestamp AT TIME ZONE 'Africa/Cairo') AS at").bind(input.cairoDateTime).first<Row>())?.at))
        :now;
      try { validateWfhTransition(action as "check_in"|"check_out"|"force_checkout",open as {checked_in_at:string}|null,at); }
      catch (error) { fail(error instanceof Error?error.message:"Invalid WFH session",409); }
      await assertDayOpen(tx,employeeId,workDate,country);
      if (action === "check_in") {
        const created = await tx.prepare("INSERT INTO wfh_sessions(employee_id,work_date,checked_in_at,created_by) VALUES(?,?,?,?) RETURNING *").bind(employeeId,date,at.toISOString(),actor.id).first();
        await tx.prepare("INSERT INTO attendance_logs(employee_id,event_at,event_type,source,device,created_by_user_id) VALUES(? ,?,'check_in','remote','WFH',?)").bind(employeeId,at.toISOString(),actor.id).run();
        return json(created);
      }
      const updated = await tx.prepare("UPDATE wfh_sessions SET checked_out_at=?,forced_by=? WHERE id=? RETURNING *").bind(at.toISOString(),action==="force_checkout"?actor.id:null,open!.id).first();
      await tx.prepare("INSERT INTO attendance_logs(employee_id,event_at,event_type,source,device,created_by_user_id) VALUES(? ,?,'check_out','remote','WFH',?)").bind(employeeId,at.toISOString(),actor.id).run();
      return json(updated);
    });
  });
}
