import { withDatabase } from "../route-helpers";
import { requireActor } from "../api-security";
import { payrollAccess } from "../../payroll/service";
import { requirePayrollPage } from "../../payroll/permissions";
import { isDate } from "../../timesheet/time";
import { payrollCountrySql } from "../../payroll/country";

const json=(value:unknown)=>Response.json(value,{headers:{"cache-control":"private, no-store"}});
export async function GET(request:Request) {
  return withDatabase("Unable to load biometric logs",async db=>{
    const actor=await requireActor(request,db),access=await payrollAccess(db,actor);
    await requirePayrollPage(db,actor,"zkAttendanceLogs");
    const url=new URL(request.url),from=url.searchParams.get("from")||"",to=url.searchParams.get("to")||"";
    if((from&&!isDate(from))||(to&&!isDate(to))||(from&&to&&from>to)) throw new Response("Invalid attendance date range",{status:400});
    const search=(url.searchParams.get("search")||"").trim().slice(0,100),country=url.searchParams.get("country")||access.region||"";
    if(country&&!["Egypt","KSA"].includes(country)) throw new Response("Select Egypt or KSA",{status:400});
    if(access.region&&country!==access.region) throw new Response("Region is outside your scope",{status:403});
    const limit=Math.min(500,Math.max(1,Number(url.searchParams.get("limit"))||100)),offset=Math.max(0,Number(url.searchParams.get("offset"))||0);
    const sort=url.searchParams.get("sort")||"punched_at",secondSort=url.searchParams.get("secondSort")||"",direction=url.searchParams.get("direction")==="asc"?"ASC":"DESC";
    const order:Record<string,string>={punched_at:"p.punched_at",employee:"e.name_en",employee_code:"e.employee_code",device:"d.name",country:"e.salary_country"};
    if(!order[sort]||(secondSort&&!order[secondSort])) throw new Response("Invalid attendance sort",{status:400});
    const rows=(await db.prepare(`SELECT p.id,p.employee_id,p.device_user_id,p.punched_at,d.name AS device_name,d.timezone,e.employee_code,e.name_en,e.name_ar,
      ${payrollCountrySql()} AS payroll_country
      FROM attendance_device_punches p JOIN attendance_devices d ON d.id=p.device_id LEFT JOIN employees e ON e.id=p.employee_id
      WHERE (?='' OR to_char(p.punched_at AT TIME ZONE COALESCE(d.timezone,'Africa/Cairo'),'YYYY-MM-DD')>=?)
      AND (?='' OR to_char(p.punched_at AT TIME ZONE COALESCE(d.timezone,'Africa/Cairo'),'YYYY-MM-DD')<=?)
      AND (?='' OR e.employee_code ILIKE '%'||?||'%' OR e.name_en ILIKE '%'||?||'%' OR e.name_ar ILIKE '%'||?||'%' OR p.device_user_id ILIKE '%'||?||'%')
      AND (?='' OR ${payrollCountrySql()}=?)
      AND (?::int[] IS NULL OR e.working_business_unit_id=ANY(?::int[]))
      AND (?=1 OR p.employee_id IS NOT NULL)
      ORDER BY ${order[sort]} ${direction}${secondSort&&secondSort!==sort?`,${order[secondSort]} ${direction}`:""},p.id DESC LIMIT ? OFFSET ?`)
      .bind(from,from,to,to,search,search,search,search,search,country,country,access.units,access.units,access.master?1:0,limit+1,offset).all()).results;
    return json({rows:rows.slice(0,limit),hasMore:rows.length>limit,offset,limit});
  });
}
