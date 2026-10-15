import { withDatabase } from "../route-helpers";
import { enforceRateLimit, enforceWriteOrigin, requireActor } from "../api-security";
import { payrollAccess } from "../../payroll/service";
import { requirePayrollPage } from "../../payroll/permissions";
import { visibleEmployeeIds } from "../../timesheet/access";
import { employeePayrollCountry, payrollCountrySql } from "../../payroll/country";

const json=(body:unknown)=>Response.json(body,{headers:{"cache-control":"private, no-store"}});
const validYear=(value:unknown)=>{const year=Number(value)||new Date().getUTCFullYear();if(!Number.isInteger(year)||year<2000||year>2100)throw new Response("Invalid year",{status:400});return year;};
const validCountry=(value:unknown)=>{if(value!=="Egypt"&&value!=="KSA")throw new Response("Select Egypt or KSA",{status:400});return value;};

export async function GET(request:Request){
  return withDatabase("Unable to load vacation setup",async db=>{
    const actor=await requireActor(request,db),access=await payrollAccess(db,actor);await requirePayrollPage(db,actor,"vacationSetup");
    const url=new URL(request.url),year=validYear(url.searchParams.get("year")),country=validCountry(url.searchParams.get("country")||"Egypt");
    if(access.region&&access.region!==country)throw new Response("Region is outside your scope",{status:403});
    const ids=await visibleEmployeeIds(db,actor),search=String(url.searchParams.get("search")||"").trim().slice(0,100);
    const sort=url.searchParams.get("sort")||"employee",secondSort=url.searchParams.get("secondSort")||"",direction=url.searchParams.get("direction")==="desc"?"DESC":"ASC";
    const orders:Record<string,string>={employee:"e.name_en",code:"lt.code",remaining:"COALESCE(lb.entitlement,lt.default_days)-COALESCE(lb.used,0)-COALESCE(lb.pending,0)",used:"COALESCE(lb.used,0)"};
    if(!orders[sort]||(secondSort&&!orders[secondSort]))throw new Response("Invalid vacation sort",{status:400});
    const offset=Math.max(0,Number(url.searchParams.get("offset"))||0),limit=Math.min(500,Math.max(1,Number(url.searchParams.get("limit"))||100));
    const types=(await db.prepare("SELECT * FROM leave_types WHERE status<>'archived' ORDER BY code,id").all()).results;
    const employees=(await db.prepare(`SELECT e.id,e.employee_code,e.name_en,e.name_ar,e.company_id,e.salary_country,e.working_business_unit_id,
      lt.id AS leave_type_id,lt.code AS vacation_code,lt.name_en AS vacation_name_en,lt.name_ar AS vacation_name_ar,
      COALESCE(lb.entitlement,lt.default_days) AS entitlement,COALESCE(lb.used,0) AS used,COALESCE(lb.pending,0) AS pending,
      COALESCE(lb.entitlement,lt.default_days)-COALESCE(lb.used,0)-COALESCE(lb.pending,0) AS remaining
      FROM employees e JOIN employee_leave_types elt ON elt.employee_id=e.id JOIN leave_types lt ON lt.id=elt.leave_type_id AND lt.status='active'
      LEFT JOIN leave_balances lb ON lb.employee_id=e.id AND lb.leave_type_id=lt.id AND lb.year=?
      WHERE e.employment_status!='deleted' AND ${payrollCountrySql()}=?
      AND (?::int[] IS NULL OR e.id=ANY(?::int[])) AND (?::int[] IS NULL OR e.working_business_unit_id=ANY(?::int[]))
      AND (?='' OR e.employee_code ILIKE '%'||?||'%' OR e.name_en ILIKE '%'||?||'%' OR e.name_ar ILIKE '%'||?||'%')
      ORDER BY ${orders[sort]} ${direction}${secondSort&&secondSort!==sort?`,${orders[secondSort]} ${direction}`:""},e.id,lt.id LIMIT ? OFFSET ?`).bind(year,country,ids,ids,access.units,access.units,search,search,search,search,limit+1,offset).all()).results;
    return json({year,country,types,rows:employees.slice(0,limit),hasMore:employees.length>limit,offset,limit});
  });
}

export async function POST(request:Request){
  return withDatabase("Unable to save vacation setup",async db=>{
    enforceWriteOrigin(request);const actor=await requireActor(request,db),access=await payrollAccess(db,actor);
    await requirePayrollPage(db,actor,"vacationSetup","edit");await enforceRateLimit(db,request,"vacation-setup",60,3600,actor.id);
    const input=await request.json().catch(()=>null) as Record<string,unknown>|null;if(!input)throw new Response("Invalid request",{status:400});
    if(input.action==="save_code"){
      if(!access.master)throw new Response("Master admin required",{status:403});
      const code=String(input.code||"").trim().toUpperCase(),nameEn=String(input.nameEn||"").trim(),nameAr=String(input.nameAr||"").trim(),days=Number(input.defaultDays),id=Number(input.id)||0;
      if(!/^[A-Z0-9_-]{2,30}$/.test(code)||!nameEn||!nameAr||!Number.isInteger(days)||days<0||days>366)throw new Response("Invalid vacation code",{status:400});
      const status=input.isActive===false?"inactive":"active";
      if(id)return json(await db.prepare("UPDATE leave_types SET code=?,name_en=?,name_ar=?,default_days=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'archived' RETURNING *").bind(code,nameEn,nameAr,days,status,id).first());
      return json(await db.prepare("INSERT INTO leave_types(code,name_en,name_ar,default_days,status) VALUES(?,?,?,?,?) RETURNING *").bind(code,nameEn,nameAr,days,status).first());
    }
    if(input.action==="set_balance"){
      if(!access.head)throw new Response("Privileged HR head required",{status:403});
      const employeeId=Number(input.employeeId),typeId=Number(input.leaveTypeId),year=validYear(input.year),entitlement=Number(input.entitlement);
      if(!Number.isInteger(employeeId)||employeeId<=0||!Number.isInteger(typeId)||typeId<=0||!Number.isFinite(entitlement)||entitlement<0||entitlement>366)throw new Response("Invalid vacation balance",{status:400});
      const employee=await db.prepare("SELECT id,country,salary_country,working_business_unit_id FROM employees WHERE id=? AND employment_status!='deleted'").bind(employeeId).first<Record<string,unknown>>();
      if(!employee)throw new Response("Employee not found",{status:404});
      const region=employeePayrollCountry(employee);
      if(access.region&&access.region!==region||access.units&&!access.units.includes(Number(employee.working_business_unit_id)))throw new Response("Employee is outside your scope",{status:403});
      const assigned=await db.prepare("SELECT 1 AS assigned FROM employee_leave_types elt JOIN leave_types lt ON lt.id=elt.leave_type_id WHERE elt.employee_id=? AND elt.leave_type_id=? AND lt.status='active'").bind(employeeId,typeId).first();
      if(!assigned)throw new Response("Vacation code is not assigned to this employee",{status:409});
      return db.transaction(async tx=>{
        await tx.prepare("SELECT pg_advisory_xact_lock(905208)").run();
        const old=await tx.prepare("SELECT * FROM leave_balances WHERE employee_id=? AND leave_type_id=? AND year=? FOR UPDATE").bind(employeeId,typeId,year).first<Record<string,unknown>>();
        if(old&&entitlement<Number(old.used)+Number(old.pending))throw new Response("Entitlement cannot be less than used and pending days",{status:409});
        const saved=await tx.prepare("INSERT INTO leave_balances(employee_id,leave_type_id,year,entitlement,used,pending) VALUES(?,?,?,?,0,0) ON CONFLICT(employee_id,leave_type_id,year) DO UPDATE SET entitlement=excluded.entitlement RETURNING *").bind(employeeId,typeId,year,entitlement).first();
        await tx.prepare("INSERT INTO audit_logs(user_id,action,module,record_type,record_id,previous_value,new_value) VALUES (?,'update','leave_management','leave_balance',?,?,?)").bind(actor.id,`${employeeId}:${typeId}:${year}`,JSON.stringify(old),JSON.stringify(saved)).run();
        return json(saved);
      });
    }
    throw new Response("Unknown vacation action",{status:400});
  });
}
