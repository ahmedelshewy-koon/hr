import type {TransactionDatabase} from "../../db/postgres";
import type {ResolvedStep} from "./workflow-policy";
import {employeePayrollCountry} from "../payroll/country.ts";

type Row=Record<string,unknown>;
export function selectRegionalManagers(managers:Row[],region:string,unitId:number|null):Row[]{
  const eligible=managers.filter(row=>{
    const units=Array.isArray(row.business_unit_ids)?row.business_unit_ids.map(Number):[];
    return !units.length||unitId!==null&&units.includes(unitId);
  });
  const exact=eligible.filter(row=>row.region===region),allRegions=eligible.filter(row=>row.region==null||row.region==="");
  return (exact.length?exact:allRegions.length?allRegions:eligible).sort((a,b)=>Number(a.admin_order)-Number(b.admin_order)||Number(a.id)-Number(b.id));
}

/** Payroll-country approvers are separate from company HR ownership. */
export async function payrollRegionChain(db:TransactionDatabase,employeeId:number):Promise<ResolvedStep[]|null>{
  const ready=await db.prepare("SELECT to_regclass('public.hr_managers') IS NOT NULL AS ready").first<{ready:boolean}>();
  if(!ready?.ready)return null;
  // Until an administrator assigns HR managers, requests keep the approval routing they had before migration 0053.
  const configured=await db.prepare("SELECT EXISTS(SELECT 1 FROM hr_managers WHERE is_active=1) AS configured").first<{configured:boolean}>();
  if(!configured?.configured)return null;
  const employee=await db.prepare("SELECT id,country,salary_country,working_business_unit_id FROM employees WHERE id=?").bind(employeeId).first<Row>();
  if(!employee)throw new Response("Employee not found",{status:404});
  const region=employeePayrollCountry(employee);
  // No payroll country: no regional chain, so the request keeps the employee's company HR step.
  if(!region)return [];
  const managers=(await db.prepare(`SELECT h.id,h.region,h.admin_order,h.user_id,e.name_en,e.name_ar,
    ARRAY(SELECT business_unit_id FROM hr_manager_business_units WHERE manager_id=h.id ORDER BY business_unit_id) AS business_unit_ids
    FROM hr_managers h JOIN users u ON u.id=h.user_id AND u.status='active' JOIN employees e ON e.id=u.employee_id
    WHERE h.is_active=1 AND e.employment_status IN ('active','probation','notice_period') AND e.id<>? ORDER BY h.admin_order,h.id`).bind(employeeId).all()).results;
  const selected=selectRegionalManagers(managers,region,employee.working_business_unit_id==null?null:Number(employee.working_business_unit_id));
  return selected.map(row=>({userId:Number(row.user_id),name:String(row.name_en||row.name_ar),nameAr:String(row.name_ar||row.name_en)}));
}
