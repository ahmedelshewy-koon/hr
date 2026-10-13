import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";
import type { ApiActor } from "../api/api-security";
import { calculatePayroll, buildInvoices, type PayrollLine } from "./engine.ts";
import { redactPayrollPreview, redactPayrollWorkspace } from "./privacy.ts";
import { employeePayrollCountry, payrollCountrySql } from "./country.ts";

type Db = PostgresDatabase | TransactionDatabase;
type Row = Record<string, unknown>;
const fail=(message:string,status=400): never=>{throw new Response(message,{status});};
/** Payroll entries need a stored payroll country; unresolved employees are never placed in a payroll by fallback. */
export const requirePayrollCountry=(employee:Row)=>employeePayrollCountry(employee)??fail("Employee has no payroll country; set it on the employee record first",409);
const number=(value:unknown)=>Number(value)||0;
const monthKey=(year:number,month:number)=>`${year}-${String(month).padStart(2,"0")}`;
const validPeriod=(year:number,month:number)=>{if (!Number.isInteger(year)||year<2000||year>2100||!Number.isInteger(month)||month<1||month>12) fail("Invalid payroll period");};
const country=(value:unknown)=>{if(value!=="Egypt"&&value!=="KSA") fail("Select Egypt or KSA");return String(value);};
const rows=async(db:Db,sql:string,...values:unknown[]) => (await db.prepare(sql).bind(...values).all()).results;
async function inputFingerprint(db:Db,actor:ApiActor,year:number,month:number,payrollCountry:string,salaryCurrency:string,rate:number){
  const data=await inputs(db,actor,year,month,payrollCountry);
  data.employees=data.employees.filter(employee=>String(employee.salary_currency||"SAR")===salaryCurrency);
  const calculated=calculatePayroll({year,month,...data});
  const payload=JSON.stringify({year,month,payrollCountry,salaryCurrency,rate,employees:data.employees.map(e=>[e.id,e.working_business_unit_id,e.cost_center_id,e.salary,e.basic_salary]),lines:calculated.lines.map(l=>[l.employee_id,l.element_id,l.element_code,l.amount,l.minutes,l.currency])});
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(payload));
  return {fingerprint:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join(""),data,calculated};
}

export async function payrollAccess(db:Db,actor:ApiActor) {
  if(actor.roleName==="Super Admin") return {master:true,head:true,region:null,units:null as number[]|null};
  const manager=await db.prepare("SELECT id,region,admin_order FROM hr_managers WHERE user_id=? AND is_active=1").bind(actor.id).first<Row>();
  if(!manager) throw new Response("Access Restricted",{status:403});
  const links=await rows(db,"SELECT business_unit_id FROM hr_manager_business_units WHERE manager_id=?",manager.id);
  return {master:false,head:number(manager.admin_order)===0,region:manager.region?String(manager.region):null,units:links.length?links.map(link=>number(link.business_unit_id)):null};
}

export async function assertPayrollEmployee(db:Db,actor:ApiActor,employeeId:number) {
  const access=await payrollAccess(db,actor);
  const employee=await db.prepare("SELECT id,working_business_unit_id,salary_country,country FROM employees WHERE id=? AND employment_status!='deleted'").bind(employeeId).first<Row>();
  if(!employee) throw new Response("Employee not found",{status:404});
  const payrollCountry=employeePayrollCountry(employee);
  if(access.region&&access.region!==payrollCountry) fail("Employee is outside your payroll region",403);
  if(access.units&&!access.units.includes(number(employee.working_business_unit_id))) fail("Employee is outside your business units",403);
  return employee;
}

export async function assertUnlocked(db:Db,year:number,month:number,payrollCountry:string) {
  const lock=await db.prepare("SELECT locked FROM payroll_month_locks WHERE period_key=? AND payroll_country=?").bind(monthKey(year,month),payrollCountry).first<{locked:number}>();
  if(number(lock?.locked)===1) fail("Payroll month is locked",423);
}

async function visibleEmployees(db:Db,actor:ApiActor,payrollCountry:string,year?:number,month?:number) {
  const access=await payrollAccess(db,actor);
  if(access.region&&access.region!==payrollCountry) fail("Region is outside your scope",403);
  const periodEnd=year&&month?`${year}-${String(month).padStart(2,"0")}-${String(new Date(Date.UTC(year,month,0)).getUTCDate()).padStart(2,"0")}`:null;
  const employees=await rows(db,`SELECT e.*,ss.basic_salary,b.code AS business_unit_code,c.code AS cost_center_code,c.debit_account,d.name_en AS department_code,co.name AS company_name
    FROM employees e LEFT JOIN business_units b ON b.id=e.working_business_unit_id LEFT JOIN cost_centers c ON c.id=e.cost_center_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN companies co ON co.id=e.company_id
    LEFT JOIN LATERAL (SELECT basic_salary FROM salary_structures WHERE employee_id=e.id AND (?::text IS NULL OR effective_from<=?) AND (effective_to IS NULL OR ?::text IS NULL OR effective_to>=(left(?::text,7)||'-01')) ORDER BY effective_from DESC,id DESC LIMIT 1) ss ON true
    WHERE e.employment_status!='deleted' AND ${payrollCountrySql()}=? ORDER BY e.name_en,e.id`,periodEnd,periodEnd,periodEnd,periodEnd,payrollCountry);
  return access.units?employees.filter(employee=>access.units!.includes(number(employee.working_business_unit_id))):employees;
}

async function inputs(db:Db,actor:ApiActor,year:number,month:number,payrollCountry:string) {
  validPeriod(year,month);country(payrollCountry);
  const [employees,elements,recurring,variables,eligibility]=await Promise.all([
    visibleEmployees(db,actor,payrollCountry,year,month),rows(db,"SELECT * FROM payroll_elements WHERE is_active=1 ORDER BY sort_order,id"),
    rows(db,"SELECT * FROM payroll_employee_elements WHERE is_active=1"),rows(db,"SELECT * FROM payroll_variable_entries WHERE period_key=?",monthKey(year,month)),
    rows(db,"SELECT * FROM payroll_element_eligibility")]);
  return {employees,elements,recurring,variables,eligibility};
}

export async function preview(db:Db,actor:ApiActor,year:number,month:number,payrollCountry:string) {
  const data=await inputs(db,actor,year,month,payrollCountry);
  const calculated=calculatePayroll({year,month,...data});
  const access=await payrollAccess(db,actor);
  if(!access.head) {
    return redactPayrollPreview({ ...calculated,employees:data.employees,elements:data.elements });
  }
  return { ...calculated,employees:data.employees,elements:data.elements };
}

export async function workspace(db:PostgresDatabase,actor:ApiActor,year:number,month:number,payrollCountry:string) {
  const access=await payrollAccess(db,actor);
  const selected=country(payrollCountry);
  const [employees,elements,recurring,variables,eligibility,runs,currencies,businessUnits,costCenters,mappings,erp,locks,managers,users,departments,jobTitles]=await Promise.all([
    visibleEmployees(db,actor,selected,year,month),rows(db,"SELECT * FROM payroll_elements ORDER BY sort_order,id"),
    rows(db,"SELECT * FROM payroll_employee_elements ORDER BY id DESC"),rows(db,"SELECT * FROM payroll_variable_entries WHERE period_key=? ORDER BY id DESC",monthKey(year,month)),
    rows(db,"SELECT * FROM payroll_element_eligibility"),rows(db,"SELECT * FROM payroll_runs WHERE country=? AND currency IS NOT NULL ORDER BY year DESC,month DESC,id DESC LIMIT 300",selected),
    rows(db,"SELECT * FROM payroll_currencies ORDER BY code"),rows(db,"SELECT * FROM business_units ORDER BY code"),
    rows(db,"SELECT * FROM cost_centers ORDER BY code"),rows(db,"SELECT * FROM business_unit_cost_center_mapping"),
    db.prepare("SELECT id,invoice_url,invoice_method,batch_url,batch_method,default_status FROM payroll_erp_settings WHERE id=1").first(),
    rows(db,"SELECT * FROM payroll_month_locks WHERE period_key=? AND payroll_country=?",monthKey(year,month),selected),
    access.master?rows(db,"SELECT h.*,u.email,COALESCE(array_remove(array_agg(m.business_unit_id),NULL),'{}'::integer[]) AS business_unit_ids FROM hr_managers h JOIN users u ON u.id=h.user_id LEFT JOIN hr_manager_business_units m ON m.manager_id=h.id GROUP BY h.id,u.email ORDER BY h.region NULLS FIRST,h.admin_order,h.id"):Promise.resolve([]),
    access.master?rows(db,"SELECT id,email FROM users WHERE status='active' ORDER BY email"):Promise.resolve([]),
    rows(db,"SELECT id,name_en,name_ar FROM departments WHERE status!='deleted' ORDER BY name_en"),
    rows(db,"SELECT id,name_en,name_ar FROM job_titles WHERE status!='deleted' ORDER BY name_en")]);
  const visibleIds=new Set(employees.map(employee=>number(employee.id)));
  const result={access,employees,elements,
    recurring:recurring.filter(entry=>visibleIds.has(number(entry.employee_id))),variables:variables.filter(entry=>visibleIds.has(number(entry.employee_id))),
    eligibility,runs:access.units?[]:runs,currencies,businessUnits,costCenters,mappings,erp:access.head?erp:null,lock:locks[0]??null,managers,users,departments,jobTitles};
  return access.head?result:redactPayrollWorkspace(result);
}

export async function saveElement(db:PostgresDatabase,actor:ApiActor,input:Row) {
  await payrollAccess(db,actor);
  const id=number(input.id), code=String(input.code||"").trim().toUpperCase(),nameEn=String(input.nameEn||"").trim(),nameAr=String(input.nameAr||"").trim();
  const type=String(input.elementType||""),calculation=String(input.calculationType||"fixed");
  if(!code||!nameEn||!nameAr||!["earning","deduction","employer_contribution"].includes(type)||!["fixed","percentage","formula","delay_minutes","absence_days","variable"].includes(calculation)) fail("Invalid payroll element");
  const flags=["isBasicSalaryElement","isDelayMinutesElement","isAbsenceElement"].map(key=>input[key]?1:0);
  if(flags.reduce<number>((a,b)=>a+b,0)>1) fail("An element can have only one special role");
  if((flags[1]||flags[2])&&type!=="deduction") fail("Delay and absence elements must be deductions");
  if(flags[0]&&type!=="earning") fail("Basic salary must be an earning");
  return db.transaction(async tx=>{
    await tx.prepare("SELECT pg_advisory_xact_lock(905203)").run();
    for(const [flag,enabled] of [["is_basic_salary_element",flags[0]],["is_delay_minutes_element",flags[1]],["is_absence_element",flags[2]]] as const) if(enabled) await tx.prepare(`UPDATE payroll_elements SET ${flag}=0 WHERE ${flag}=1 AND id!=?`).bind(id).run();
    const values=[code,nameEn,nameAr,type,String(input.classification||""),calculation,number(input.defaultAmount),String(input.formula||"")||null,number(input.sortOrder),input.isActive===false?0:1,String(input.elementAccount||"")||null,String(input.elementAccountName||"")||null,...flags];
    if(id) return tx.prepare(`UPDATE payroll_elements SET code=?,name_en=?,name_ar=?,element_type=?,classification=?,calculation_type=?,default_amount=?,formula=?,sort_order=?,is_active=?,element_account=?,element_account_name=?,is_basic_salary_element=?,is_delay_minutes_element=?,is_absence_element=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *`).bind(...values,id).first();
    return tx.prepare(`INSERT INTO payroll_elements(code,name_en,name_ar,element_type,classification,calculation_type,default_amount,formula,sort_order,is_active,element_account,element_account_name,is_basic_salary_element,is_delay_minutes_element,is_absence_element) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`).bind(...values).first();
  });
}

export async function saveEmployeeElement(db:Db,actor:ApiActor,input:Row) {
  const employeeId=number(input.employeeId),elementId=number(input.elementId),from=String(input.effectiveFrom||"");
  const employee=await assertPayrollEmployee(db,actor,employeeId);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!elementId||number(input.amount)<0) fail("Invalid employee element");
  const element=await db.prepare("SELECT id FROM payroll_elements WHERE id=? AND is_active=1 AND is_basic_salary_element=0 AND is_delay_minutes_element=0 AND is_absence_element=0").bind(elementId).first(); if(!element) fail("Only ordinary active elements can recur",400);
  const payrollCountry=requirePayrollCountry(employee);
  if(payrollCountry!==country(input.country)) fail("Employee belongs to another payroll country");
  const period=from.slice(0,7).split("-").map(Number);await assertUnlocked(db,period[0],period[1],payrollCountry);
  const intersectsLock=async(start:string,end:unknown)=>db.prepare("SELECT 1 AS locked FROM payroll_month_locks WHERE payroll_country=? AND locked=1 AND period_key>=? AND (?::text IS NULL OR period_key<=?) LIMIT 1").bind(payrollCountry,start.slice(0,7),end?String(end).slice(0,7):null,end?String(end).slice(0,7):null).first();
  const intersectsConfirmedRun=async(start:string,end:unknown)=>db.prepare("SELECT 1 AS confirmed FROM payroll_runs WHERE country=? AND status='confirmed' AND currency IS NOT NULL AND (year::text||'-'||lpad(month::text,2,'0'))>=? AND (?::text IS NULL OR (year::text||'-'||lpad(month::text,2,'0'))<=?) LIMIT 1").bind(payrollCountry,start.slice(0,7),end?String(end).slice(0,7):null,end?String(end).slice(0,7):null).first();
  if(await intersectsLock(from,input.effectiveTo)) fail("Recurring element overlaps a locked payroll month",423);
  if(await intersectsConfirmedRun(from,input.effectiveTo)) fail("Recurring element overlaps a confirmed payroll run",409);
  if(input.id){const old=await db.prepare("SELECT effective_from,effective_to FROM payroll_employee_elements WHERE id=? AND employee_id=?").bind(number(input.id),employeeId).first<Row>();if(old&&(await intersectsLock(String(old.effective_from),old.effective_to)||await intersectsConfirmedRun(String(old.effective_from),old.effective_to))) fail("Existing recurring element overlaps a locked month or confirmed run",409);}
  if(input.id) return db.prepare("UPDATE payroll_employee_elements SET element_id=?,amount=?,effective_from=?,effective_to=?,is_active=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND employee_id=? RETURNING *").bind(elementId,number(input.amount),from,input.effectiveTo||null,input.isActive===false?0:1,input.notes||null,number(input.id),employeeId).first();
  return db.prepare("INSERT INTO payroll_employee_elements(employee_id,element_id,amount,effective_from,effective_to,is_active,notes) VALUES(?,?,?,?,?,?,?) RETURNING *").bind(employeeId,elementId,number(input.amount),from,input.effectiveTo||null,1,input.notes||null).first();
}

export async function saveVariable(db:PostgresDatabase,actor:ApiActor,input:Row) {
  const employeeId=number(input.employeeId),year=number(input.year),month=number(input.month),selected=country(input.country);
  validPeriod(year,month);
  return db.transaction(async tx=>{
    await tx.prepare("SELECT pg_advisory_xact_lock(905204)").run();
    const employee=await assertPayrollEmployee(tx,actor,employeeId);
    if(requirePayrollCountry(employee)!==selected) fail("Employee belongs to another payroll country");
    await assertUnlocked(tx,year,month,selected);
    const confirmed=await tx.prepare("SELECT 1 AS confirmed FROM payroll_runs WHERE year=? AND month=? AND country=? AND status='confirmed' AND currency IS NOT NULL LIMIT 1").bind(year,month,selected).first();
    if(confirmed) fail("Confirmed payroll run blocks variable entry changes",409);
    const element=await tx.prepare("SELECT id,code FROM payroll_elements WHERE id=? AND is_active=1 AND is_basic_salary_element=0 AND is_delay_minutes_element=0 AND is_absence_element=0").bind(number(input.elementId)).first<Row>();
    if(!element||!Number.isFinite(Number(input.amount))||number(input.amount)<0) throw new Response("Invalid variable entry",{status:400});
    const key=monthKey(year,month);
    return tx.prepare(`INSERT INTO payroll_variable_entries(employee_id,period_key,element,element_id,quantity,amount,source,detail_json,posted_by,posted_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'manual',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(employee_id,period_key,element) DO UPDATE SET element_id=excluded.element_id,quantity=excluded.quantity,amount=excluded.amount,source='manual',detail_json=excluded.detail_json,posted_by=excluded.posted_by,updated_at=CURRENT_TIMESTAMP RETURNING *`)
      .bind(employeeId,key,element.code,element.id,number(input.quantity),number(input.amount),input.notes||null,actor.id).first();
  });
}

export async function calculateRun(db:PostgresDatabase,actor:ApiActor,year:number,month:number,payrollCountry:string,salaryCurrency:string,rate:number) {
  const access=await payrollAccess(db,actor);if(access.units||!access.head) fail("Only a country-wide privileged payroll manager can calculate a run",403);validPeriod(year,month);const selected=country(payrollCountry);await assertUnlocked(db,year,month,selected);
  if(!Number.isFinite(rate)||rate<=0) fail("SAR rate must be positive");
  if(!/^[A-Z]{3}$/.test(salaryCurrency)) fail("Select a salary currency");
  const currencyRow=await db.prepare("SELECT code FROM payroll_currencies WHERE code=? AND is_active=1").bind(salaryCurrency).first();
  if(!currencyRow) fail("Configure the salary currency and its SAR rate first",409);
  return db.transaction(async tx=>{
    await tx.prepare("SELECT pg_advisory_xact_lock(905204)").run();
    await assertUnlocked(tx,year,month,selected);
    const existing=await tx.prepare("SELECT * FROM payroll_runs WHERE year=? AND month=? AND country=? AND currency=? FOR UPDATE").bind(year,month,selected,salaryCurrency).first<Row>();
    if(existing && existing.status!=="draft") fail("Only a draft run can be calculated",409);
    if(existing && (await tx.prepare("SELECT 1 FROM payroll_items WHERE payroll_run_id=? LIMIT 1").bind(existing.id).first())) fail("This period has a historical payroll run; historical records cannot be overwritten",409);
    if(existing&&(existing.erp_post_started_at||existing.sent_to_accounting_at)) fail("An ERP attempt requires reconciliation before recalculation",409);
    const {fingerprint,data,calculated:result}=await inputFingerprint(tx,actor,year,month,selected,salaryCurrency,rate);
    if(!result.people.length) fail("No eligible employees for the period",409);
    const gross=result.people.reduce((sum,person)=>sum+person.gross,0),deductions=result.people.reduce((sum,person)=>sum+person.deductions,0),net=result.people.reduce((sum,person)=>sum+person.net,0);
    const run=existing?await tx.prepare("UPDATE payroll_runs SET sar_currency_rate=?,total_gross=?,total_deductions=?,total_net=?,employee_count=?,input_fingerprint=? WHERE id=? RETURNING *").bind(rate,gross,deductions,net,result.people.length,fingerprint,existing.id).first<Row>():
      await tx.prepare("INSERT INTO payroll_runs(year,month,country,status,currency,sar_currency_rate,total_gross,total_deductions,total_net,employee_count,input_fingerprint) VALUES(?,?,?,'draft',?,?,?,?,?,?,?) RETURNING *").bind(year,month,selected,salaryCurrency,rate,gross,deductions,net,result.people.length,fingerprint).first<Row>();
    if(!run) throw new Response("Unable to save payroll run",{status:500});
    await tx.prepare("DELETE FROM payroll_run_lines WHERE run_id=?").bind(run.id).run();
    const mappings=await rows(tx,"SELECT * FROM business_unit_cost_center_mapping");
    for(const line of result.lines) {
      const employee=data.employees.find(item=>number(item.id)===line.employee_id)!,element=data.elements.find(item=>number(item.id)===line.element_id);
      const mapping=mappings.find(item=>number(item.business_unit_id)===number(employee.working_business_unit_id)&&number(item.cost_center_id)===number(employee.cost_center_id));
      await tx.prepare("INSERT INTO payroll_run_lines(run_id,employee_id,element_id,element_code,element_name_en,element_name_ar,element_type,amount,minutes,currency,business_unit_code,cost_center_code,department_code,element_account,fallback_account,employee_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(run.id,line.employee_id,line.element_id,line.element_code,line.element_name_en,line.element_name_ar,line.element_type,line.amount,line.minutes,line.currency,
          employee.business_unit_code,employee.cost_center_code,employee.department_code,element?.element_account,mapping?.payroll_dr_account||employee.debit_account,employee.employee_code).run();
    }
    return run;
  });
}

export async function runAction(db:PostgresDatabase,actor:ApiActor,id:number,action:string) {
  const access=await payrollAccess(db,actor);
  if(access.units) fail("A business unit scoped HR manager cannot change a country-wide run",403);
  return db.transaction(async tx=>{
    await tx.prepare("SELECT pg_advisory_xact_lock(905204)").run();
    const run=await tx.prepare("SELECT * FROM payroll_runs WHERE id=? AND currency IS NOT NULL FOR UPDATE").bind(id).first<Row>();
    if(!run) throw new Response("Run not found",{status:404});
    country(run.country);await visibleEmployees(tx,actor,String(run.country));
    if(action!=="unlock") await assertUnlocked(tx,number(run.year),number(run.month),String(run.country));
    if(action==="confirm"&&run.status==="draft") {
      if(!run.input_fingerprint) throw new Response("Recalculate this run before confirmation",{status:409});
      const count=await tx.prepare("SELECT COUNT(*)::int AS count FROM payroll_run_lines WHERE run_id=?").bind(id).first<{count:number}>();
      if(!count?.count||count.count<number(run.employee_count))fail("Run lines are incomplete",409);
      const {fingerprint}=await inputFingerprint(tx,actor,number(run.year),number(run.month),String(run.country),String(run.currency),number(run.sar_currency_rate));
      if(fingerprint!==run.input_fingerprint)fail("Payroll inputs changed; recalculate this run",409);
      return tx.prepare("UPDATE payroll_runs SET status='confirmed',confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP WHERE id=? AND status='draft' RETURNING *").bind(actor.id,id).first();
    }
    if(action==="rollback"&&run.status==="confirmed"&&!run.sent_to_accounting_at&&!run.erp_post_started_at) return tx.prepare("UPDATE payroll_runs SET status='draft',confirmed_by=NULL,confirmed_at=NULL WHERE id=? RETURNING *").bind(id).first();
    if(action==="lock"&&run.status==="confirmed"&&access.master) return tx.prepare("INSERT INTO payroll_month_locks(period_key,payroll_country,locked,locked_by,locked_at) VALUES(?,?,1,?,CURRENT_TIMESTAMP) ON CONFLICT(period_key,payroll_country) DO UPDATE SET locked=1,locked_by=excluded.locked_by,locked_at=CURRENT_TIMESTAMP RETURNING *").bind(monthKey(number(run.year),number(run.month)),run.country,actor.id).first();
    if(action==="unlock"&&access.master) return tx.prepare("UPDATE payroll_month_locks SET locked=0,locked_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE period_key=? AND payroll_country=? RETURNING *").bind(monthKey(number(run.year),number(run.month)),run.country).first();
    fail("Action unavailable for this run",409);
  });
}

export async function erpPreview(db:PostgresDatabase,actor:ApiActor,id:number) {
  const access=await payrollAccess(db,actor);if(access.units||!access.head) fail("Only a privileged country-wide payroll manager can view a country-wide ERP invoice",403);
  const run=await db.prepare("SELECT * FROM payroll_runs WHERE id=? AND currency IS NOT NULL").bind(id).first<Row>();if(!run) throw new Response("Run not found",{status:404});
  const [lines,employees,elements,mappings]=await Promise.all([
    rows(db,"SELECT * FROM payroll_run_lines WHERE run_id=?",id),visibleEmployees(db,actor,String(run.country)),rows(db,"SELECT * FROM payroll_elements"),rows(db,"SELECT * FROM business_unit_cost_center_mapping")]);
  const settings=await db.prepare("SELECT id,invoice_url,invoice_method,batch_url,batch_method,default_status FROM payroll_erp_settings WHERE id=1").first<Row>();
  return {run,settings,employees,...buildInvoices(lines as PayrollLine[],employees,elements,mappings,number(run.sar_currency_rate),String(settings?.default_status||"DRAFT"),String(run.erp_batch_number||"PREVIEW"))};
}
