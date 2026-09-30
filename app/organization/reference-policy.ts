import type { TransactionDatabase } from '../../db/postgres';
import { asResponse, orgError } from './org-errors.ts';

// One reference map drives both server usage counts and write validation.
// Association rows retain history but do not themselves keep a branch active.
export const references:Record<string,string[]>={
  companies:['employees:company_id','departments:company_id','positions:company_id','hr_responsibility_rules:company_id','company_branches:company_id'],
  branches:['employees:branch_id','organization_branch_scopes:branch_id','work_locations:branch_id','hr_responsibility_rules:branch_id','company_branches:branch_id'],
  departments:['employees:department_id','employees:section_id','employees:team_id','departments:parent_id','positions:department_id','positions:section_id','positions:team_id','job_titles:department_id'],
  positions:['employees:position_id'],grades:['employees:grade_id','positions:grade_id'],workLocations:['employees:work_location_id'],
  jobTitles:['employees:job_title_id','positions:job_title_id'],hrRules:[],
};
export type OrganizationUsage={total:number;active:number;historical:number;references:Record<string,{total:number;active:number}>};
const emptyUsage=():OrganizationUsage=>({total:0,active:0,historical:0,references:{}});
export async function readOrganizationUsageMap(db:TransactionDatabase,entity:string,id?:number):Promise<Record<string,OrganizationUsage>>{
  const result:Record<string,OrganizationUsage>={};
  for(const ref of references[entity]??[]){
    const [table,column]=ref.split(':');
    const active=table==='employees'?"employment_status IN ('active','probation','notice_period')":table==='company_branches'?'FALSE':table==='organization_branch_scopes'?"EXISTS (SELECT 1 FROM departments d WHERE d.id=organization_branch_scopes.department_id AND d.status='active' AND d.branch_scope='selected')":"status='active'";
    const query=db.prepare(`SELECT ${column} AS record_id,count(*)::int AS total,count(*) FILTER (WHERE ${active})::int AS active FROM ${table} WHERE ${id===undefined?`${column} IS NOT NULL`:`${column}=?`} GROUP BY ${column}`);
    const rows=(await (id===undefined?query:query.bind(id)).all()).results;
    for(const row of rows){
      const usage=result[String(row.record_id)]??=emptyUsage();
      const counts={total:Number(row.total),active:Number(row.active)};
      usage.references[ref]=counts;usage.total+=counts.total;usage.active+=counts.active;
      usage.historical=usage.total-usage.active;
    }
  }
  return result;
}
export async function readOrganizationUsage(db:TransactionDatabase,entity:string,id:number):Promise<OrganizationUsage>{
  return (await readOrganizationUsageMap(db,entity,id))[String(id)]??emptyUsage();
}
const LABELS:Record<string,[string,string]>={employees:['موظف','employee(s)'],departments:['وحدة تنظيمية','organizational unit(s)'],positions:['وظيفة','position(s)'],job_titles:['مسمى وظيفي','job title(s)'],hr_responsibility_rules:['قاعدة موارد بشرية','HR rule(s)'],work_locations:['مقر عمل','work location(s)'],organization_branch_scopes:['نطاق فرع','branch scope(s)'],company_branches:['ارتباط شركة وفرع','company–branch link(s)']};
/** Usage grouped by the table that holds the reference, e.g. "8 active employee(s), 3 historical employee(s), 2 position(s)". */
export function usageSummary(usage:OrganizationUsage,{includeLinks=false,activeOnly=false}:{includeLinks?:boolean;activeOnly?:boolean}={}){
  const groups=new Map<string,{total:number;active:number}>();
  for(const [ref,count] of Object.entries(usage.references)){const table=ref.split(':')[0];if(table==='company_branches'&&!includeLinks)continue;const g=groups.get(table)??{total:0,active:0};g.total+=count.total;g.active+=count.active;groups.set(table,g);}
  const lines=[...groups.entries()].map(([table,g])=>({table,active:g.active,historical:g.total-g.active,total:g.total})).filter(l=>activeOnly?l.active>0:l.total>0);
  const [ar,en]=[lines.map(l=>{const [a]=LABELS[l.table]??[l.table];return table(l,a,true);}).join('، '),lines.map(l=>{const [,e]=LABELS[l.table]??[l.table,l.table];return table(l,e,false);}).join(', ')];
  function table(l:{table:string;active:number;historical:number},label:string,rtl:boolean){
    if(l.table!=='employees')return rtl?`${label}: ${activeOnly?l.active:l.active+l.historical}`:`${activeOnly?l.active:l.active+l.historical} ${label}`;
    const parts=rtl?[l.active?`${l.active} ${label} حالي`:'',!activeOnly&&l.historical?`${l.historical} ${label} تاريخي`:'']:[l.active?`${l.active} active ${label}`:'',!activeOnly&&l.historical?`${l.historical} historical ${label}`:''];
    return parts.filter(Boolean).join(rtl?'، ':', ');
  }
  return {lines,ar,en};
}
export async function assertCanDeactivate(db:TransactionDatabase,entity:string,id:number){
  const usage=await readOrganizationUsage(db,entity,id);
  if(usage.active){const s=usageSummary(usage,{activeOnly:true});throw asResponse(orgError('ACTIVE_DEPENDENTS','status',`توجد ارتباطات نشطة؛ أعد تعيينها أولًا (${s.ar})`,`Active dependents exist; reassign them before deactivation (${s.en})`,{blocking:{type:entity,id},details:{usage:s.lines}}),409);}
}
export async function assertUnreferenced(db:TransactionDatabase,entity:string,id:number){
  const usage=await readOrganizationUsage(db,entity,id);
  if(Object.entries(usage.references).some(([ref,count])=>!ref.startsWith('company_branches:')&&count.total>0)){const s=usageSummary(usage);throw asResponse(orgError('REFERENCED_ENTITY_CONFLICT',null,`التغيير الهيكلي يؤثر على مراجع قائمة أو تاريخية (${s.ar})`,`Structural change affects existing or historical references (${s.en})`,{blocking:{type:entity,id},details:{usage:s.lines}}),409);}
}
