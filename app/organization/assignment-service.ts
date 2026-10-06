import type { TransactionDatabase } from '../../db/postgres';
import { recordJobHistory } from '../employees/job-history.ts';
import type { Row } from '../ui-types';
import { assignmentFields, assignmentFromPayload, validateAssignmentDate, validateAssignmentGroup, type OrganizationCatalog } from './assignment-policy.ts';
import { validateReportingManager } from './reporting-line.ts';
import { asResponse, orgError } from './org-errors.ts';
import { hrIneligibility } from './hr-responsibility.ts';
import { readHrRoster } from './hr-roster.ts';

export async function organizationReady(db:TransactionDatabase):Promise<boolean>{
  return Boolean((await db.prepare("SELECT (to_regclass('public.positions') IS NOT NULL AND to_regclass('public.hr_responsibility_rules') IS NOT NULL AND to_regclass('public.organization_branch_scopes') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='job_grades' AND column_name='sort_order') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='companies_code_unique' AND conrelid=to_regclass('public.companies'))) AS ready").first<{ready:boolean}>())?.ready);
}
export async function readOrganizationCatalog(db:TransactionDatabase):Promise<OrganizationCatalog>{
  const names={companies:'companies',branches:'branches',companyBranches:'company_branches',departments:'departments',branchScopes:'organization_branch_scopes',positions:'positions',grades:'job_grades',workLocations:'work_locations',hrRules:'hr_responsibility_rules',jobTitles:'job_titles'};
  const entries=await Promise.all(Object.entries(names).map(async([key,table])=>[key,(await db.prepare(`SELECT * FROM ${table} ORDER BY ${key==='grades'?'sort_order,name_en,id':'id'}`).all()).results]));
  return Object.fromEntries(entries) as OrganizationCatalog;
}
/** Minimal employee rows used by every group/reporting validation. */
export async function readReportingRows(db:TransactionDatabase){
  return (await db.prepare('SELECT id,manager_id,employment_status,company_id,position_id,name_en,name_ar FROM employees').all()).results as {id:number;manager_id:number|null;employment_status:string;company_id:number|null;position_id:number|null;name_en?:string;name_ar?:string}[];
}
/** All assignment writes serialize on the same lock, including ATS conversions and master-data changes. */
export async function validateEmployeeWrite(db:TransactionDatabase,employeeId:number,payload:Row,before:Row={},visibleEmployeeIds?:Set<number>){
  await db.prepare('SELECT pg_advisory_xact_lock(78231)').run();
  let next:Row;
  try{next=assignmentFromPayload(payload,before);}catch(error){throw asResponse(error,400);}
  const ready=await organizationReady(db);
  const rows=await readReportingRows(db);
  const managerChanged=Number(next.manager_id||0)!==Number(before.manager_id||0);
  try{
    validateAssignmentDate(payload.assignmentEffectiveDate===undefined?before.assignment_effective_date:payload.assignmentEffectiveDate);
    if(next.hr_user_id&&Number(next.hr_user_id)!==Number(before.hr_user_id)){
      // An override is an explicit exception and must name an eligible person; the rule result is never stored here.
      const hr=(await readHrRoster(db)).find(row=>Number(row.user_id)===Number(next.hr_user_id));
      const invalid=hrIneligibility(hr);
      if(invalid)throw orgError(invalid.code,'hr_user_id',invalid.ar,invalid.en,{blocking:{type:'user',id:next.hr_user_id}});
      if(Number(hr?.employee_id)===employeeId)throw orgError('HR_OVERRIDE_INVALID','hr_user_id','لا يمكن أن يكون الموظف مسؤول الموارد البشرية لنفسه','An employee cannot be their own HR responsible',{blocking:{type:'user',id:next.hr_user_id}});
    }
    if(!ready){
      // Pre-readiness fallback keeps the historical checks; organizational tables do not exist yet.
      if(managerChanged||!before.id)validateReportingManager(rows,employeeId,next.manager_id);
      if(next.manager_id&&(managerChanged||Number(next.company_id)!==Number(before.company_id))){
        const manager=rows.find(r=>Number(r.id)===Number(next.manager_id));
        if(visibleEmployeeIds&&!visibleEmployeeIds.has(Number(next.manager_id)))throw orgError('MANAGER_OUT_OF_SCOPE','manager_id','المدير خارج نطاق الصلاحيات','Manager outside visibility scope');
        if(next.company_id&&Number(manager?.company_id)!==Number(next.company_id))throw orgError('MANAGER_COMPANY_MISMATCH','manager_id','المدير لا يتبع الشركة','Manager does not belong to company');
      }
      if(['branch_id','section_id','team_id','position_id','grade_id','work_location_id'].some(key=>next[key]))throw orgError('SETUP_UNAVAILABLE',null,'إعداد الهيكل التنظيمي غير متاح بعد','Organizational setup is not available yet');
      return next;
    }
    const catalog=await readOrganizationCatalog(db);
    validateAssignmentGroup(catalog,rows,[{id:employeeId,before,next,status:payload.employmentStatus??before.employment_status??'active'}],{visibleEmployeeIds});
    return next;
  }catch(error){throw asResponse(error,400);}
}
export async function persistAssignment(db:TransactionDatabase,employeeId:number,next:Row,payload:Row,before:Row={}){
  if(!await organizationReady(db))return;
  const columns=Object.values(assignmentFields);
  const effective=payload.assignmentEffectiveDate===undefined?before.assignment_effective_date:payload.assignmentEffectiveDate;
  try{validateAssignmentDate(effective);}catch(error){throw asResponse(error,400);}
  await db.prepare(`UPDATE employees SET ${columns.map(c=>`${c}=?`).join(',')},assignment_effective_date=? WHERE id=?`).bind(...columns.map(c=>next[c]),effective||null,employeeId).run();
  // Job history follows every assignment write (profile edit, new hire, team transfer) in the same transaction.
  await recordJobHistory(db,employeeId,before,next,effective,typeof payload.assignmentChangeReason==='string'?payload.assignmentChangeReason.trim().slice(0,500)||null:null);
}
