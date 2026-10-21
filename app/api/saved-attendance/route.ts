import { withDatabase } from "../route-helpers";
import { enforceRateLimit, enforceWriteOrigin, requireActor } from "../api-security";
import { payrollAccess } from "../../payroll/service";
import { requirePayrollPage } from "../../payroll/permissions";
import { savedAttendanceSnapshot } from "../../attendance/saved-attendance";
import { loadEmployees } from "../../timesheet/facts";
import { visibleEmployeeIds } from "../../timesheet/access";
import { readRows } from "../../timesheet/service";
import { isDate, monthKeyOf } from "../../timesheet/time";
import { readMailConfig } from "../../timesheet/mail-config";
import { sendMail } from "../../timesheet/mail";
import { payrollCountrySql } from "../../payroll/country";

type Row = Record<string, unknown>;
const json = (value: unknown) => Response.json(value,{headers:{"cache-control":"private, no-store"}});
const fail=(message:string,status=400):never=>{throw new Response(message,{status});};
const country=(value:unknown)=>value==="Egypt"||value==="KSA"?value:fail("Select Egypt or KSA");
const validRange=(from:unknown,to:unknown)=>{if(!isDate(from)||!isDate(to)||from>to||Date.parse(to)-Date.parse(from)>31*86400000) fail("Select a valid period");return {from:from as string,to:to as string};};

export async function GET(request:Request) {
  return withDatabase("Unable to load saved attendance",async db=>{
    const actor=await requireActor(request,db),access=await payrollAccess(db,actor);
    await requirePayrollPage(db,actor,"savedAttendance");
    const url=new URL(request.url),selected=country(url.searchParams.get("country")||"Egypt");
    if(access.region&&access.region!==selected) fail("Region is outside your scope",403);
    const date=new Date().toISOString().slice(0,10),from=url.searchParams.get("from")||date.slice(0,7)+"-01",to=url.searchParams.get("to")||date;
    validRange(from,to);
    const employeeId=Number(url.searchParams.get("employeeId"))||0,search=String(url.searchParams.get("search")||"").trim().slice(0,100);
    const sort=String(url.searchParams.get("sort")||"work_date"),direction=url.searchParams.get("direction")==="asc"?"ASC":"DESC";
    const secondSort=String(url.searchParams.get("secondSort")||"");
    const order:Record<string,string>={work_date:"s.work_date",employee:"e.name_en",status:"s.status",deduction:"s.deduction_amount"};
    if(!order[sort]||(secondSort&&!order[secondSort])) fail("Invalid attendance sort");
    const limit=Math.min(500,Math.max(1,Number(url.searchParams.get("limit"))||100)),offset=Math.max(0,Number(url.searchParams.get("offset"))||0);
    const ids=await visibleEmployeeIds(db,actor);
    const rows=(await db.prepare(`SELECT s.*,e.name_en,e.name_ar,e.country,e.salary_country,e.working_business_unit_id FROM saved_attendance s JOIN employees e ON e.id=s.employee_id
      WHERE s.work_date>=? AND s.work_date<=? AND ${payrollCountrySql()}=?
      AND (?=0 OR s.employee_id=?) AND (?::int[] IS NULL OR s.employee_id=ANY(?::int[])) AND (?::int[] IS NULL OR e.working_business_unit_id=ANY(?::int[]))
      AND (?='' OR e.employee_code ILIKE '%'||?||'%' OR e.name_en ILIKE '%'||?||'%' OR e.name_ar ILIKE '%'||?||'%')
      ORDER BY ${order[sort]} ${direction}${secondSort&&secondSort!==sort?`,${order[secondSort]} ${direction}`:""},s.id DESC LIMIT ? OFFSET ?`).bind(from,to,selected,employeeId,employeeId,ids,ids,access.units,access.units,search,search,search,search,limit+1,offset).all()).results;
    return json({rows:(access.head?rows:rows.map(row=>({...row,deduction_amount:null}))).slice(0,limit),hasMore:rows.length>limit,offset,limit});
  });
}

export async function POST(request:Request) {
  return withDatabase("Unable to confirm saved attendance",async db=>{
    enforceWriteOrigin(request);
    const actor=await requireActor(request,db),access=await payrollAccess(db,actor);
    await requirePayrollPage(db,actor,"savedAttendance","edit");
    await enforceRateLimit(db,request,"saved-attendance",20,3600,actor.id);
    const input=await request.json().catch(()=>null) as Row|null;
    if(!input) fail("Invalid request");
    if(input!.action!=="confirm"&&input!.action!=="send_notifications") fail("Unknown saved attendance action");
    const {from,to}=validRange(input!.from,input!.to),selected=country(input!.country);
    if(access.region&&access.region!==selected) fail("Region is outside your scope",403);
    const visible=await visibleEmployeeIds(db,actor);
    if(input!.action==="send_notifications"){
      if(!access.head)fail("Only a privileged payroll head can send attendance deductions",403);
      const mail=readMailConfig();if(!mail)throw new Response("Mail service is not configured",{status:503});
      const pending=(await db.prepare(`SELECT s.*,e.name_en,e.name_ar,e.work_email,e.country,e.salary_country,e.working_business_unit_id FROM saved_attendance s JOIN employees e ON e.id=s.employee_id
        WHERE s.work_date>=? AND s.work_date<=? AND ${payrollCountrySql()}=?
        AND (?::int[] IS NULL OR s.employee_id=ANY(?::int[])) AND (?::int[] IS NULL OR e.working_business_unit_id=ANY(?::int[]))
        AND ((s.check_in IS NOT NULL AND s.entry_notification_sent=0) OR (s.check_out IS NOT NULL AND s.exit_notification_sent=0) OR (s.deduction_amount>0 AND s.deduction_notification_sent=0))
        ORDER BY s.work_date,s.id LIMIT 500`).bind(from,to,selected,visible,visible,access.units,access.units).all()).results;
      let sent=0,skipped=0;const failed:{employee:string;date:string;error:string}[]=[];
      for(const row of pending){
        const email=String(row.work_email||"").trim();if(!email){skipped++;continue;}
        const date=String(row.work_date),name=String(row.name_en||row.employee_code),nameAr=String(row.name_ar||name);
        const parts=[row.check_in&&!Number(row.entry_notification_sent)?`Check-in: ${row.check_in}`:"",row.check_out&&!Number(row.exit_notification_sent)?`Check-out: ${row.check_out}`:"",Number(row.deduction_amount)>0&&!Number(row.deduction_notification_sent)?`Deduction: ${Number(row.deduction_amount).toFixed(2)} ${selected==="KSA"?"SAR":"EGP"}`:""] .filter(Boolean);
        if(!parts.length)continue;
        const body=`Dear ${name},\nAttendance for ${date}:\n${parts.join("\n")}\n\nعزيزي ${nameAr}، تم تسجيل بيانات الحضور بتاريخ ${date}. يرجى مراجعة الموارد البشرية عند وجود استفسار.`;
        const outcome=await sendMail(mail,{to:email,subject:`Attendance summary · ملخص الحضور — ${date}`,text:body,html:`<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${body.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")}</pre>`});
        if(!outcome.ok){failed.push({employee:name,date,error:outcome.error||"failed"});continue;}
        await db.prepare(`UPDATE saved_attendance SET entry_notification_sent=CASE WHEN check_in IS NOT NULL THEN 1 ELSE entry_notification_sent END,exit_notification_sent=CASE WHEN check_out IS NOT NULL THEN 1 ELSE exit_notification_sent END,deduction_notification_sent=CASE WHEN deduction_amount>0 THEN 1 ELSE deduction_notification_sent END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.id).run();
        sent++;
      }
      return json({sent,skipped,failed,hasMore:pending.length===500});
    }
    const employees=await loadEmployees(db,{employeeIds:visible,departmentIds:null,employeeId:Number(input!.employeeId)||0,country:selected});
    const scoped=access.units?employees.filter(employee=>access.units!.includes(Number(employee.working_business_unit_id))):employees;
    const rows=await readRows(db,scoped.map(employee=>employee.id),from,to);
    if(!rows.length) fail("No attendance to confirm",409);
    if(rows.some(row=>!["approved","absent","vacation","holiday","wfh"].includes(String(row.status)))) fail("Review pending attendance before confirmation",409);
    const batchId=crypto.randomUUID();
    return db.transaction(async tx=>{
      await tx.prepare("SELECT pg_advisory_xact_lock(905207)").run();
      let confirmed=0,existing=0;
      for(const row of rows){
        const payrollCountry=selected,workDate=String(row.work_date);
        const lock=await tx.prepare("SELECT 1 AS locked FROM payroll_month_locks WHERE period_key=? AND payroll_country=? AND locked=1").bind(monthKeyOf(workDate),payrollCountry).first();
        if(lock) fail("This payroll period is locked",423);
        const monthLock=await tx.prepare("SELECT 1 AS locked FROM timesheet_month_locks WHERE month_key=? AND payroll_country=? AND confirmed=1").bind(workDate.slice(0,7),payrollCountry).first();
        if(monthLock) fail("This month is confirmed and editing is locked",423);
        const s=savedAttendanceSnapshot(row,batchId);
        const inserted=await tx.prepare(`INSERT INTO saved_attendance(employee_id,employee_code,work_date,check_in,check_out,work_minutes,expected_minutes,difference_minutes,status,vacation_type,deduction_rule_id,deduction_amount,absence_has_notice,is_confirmed,batch_id,entry_notification_sent,exit_notification_sent,deduction_notification_sent,confirmed_by)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(employee_id,work_date) DO NOTHING RETURNING id`)
          .bind(s.employeeId,s.employeeCode,s.workDate,s.checkIn,s.checkOut,s.workMinutes,s.expectedMinutes,s.differenceMinutes,s.status,s.vacationType,s.deductionRuleId,s.deductionAmount,s.absenceHasNotice,s.isConfirmed,s.batchId,s.entryNotificationSent,s.exitNotificationSent,s.deductionNotificationSent,actor.id).first();
        if(inserted)confirmed++;else existing++;
      }
      return json({batchId,confirmed,existing});
    });
  });
}
