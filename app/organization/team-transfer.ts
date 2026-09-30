import type { TransactionDatabase } from '../../db/postgres';
import type { Row } from '../ui-types';
import { assignmentFields, assignmentFromPayload, assertAssignmentReviewCurrent, assignmentGroupIssues, validateAssignmentDate, REVIEW_COLUMNS, type AssignmentChange } from './assignment-policy.ts';
import { organizationReady, persistAssignment, readOrganizationCatalog, readReportingRows } from './assignment-service.ts';
import { refreshReportingLevels } from './reporting-service.ts';
import { OrganizationError, asResponse, orgError, type OrganizationIssue } from './org-errors.ts';

/**
 * Controlled team organizational transfer: a manager and selected members of their current reporting subtree
 * change Company/Branch/units/Position/Title together, validated as ONE final state and committed atomically.
 * manager_id and hr_user_id are never changed here (reporting lines are preserved, never cleared temporarily).
 */
const EDITABLE = ['companyId','branchId','departmentId','sectionId','teamId','positionId','jobTitleId','gradeId','workLocationId'] as const;
export type TransferMember = Partial<Record<(typeof EDITABLE)[number], unknown>> & { employeeId: unknown; reviewed?: Row };
export type TransferInput = { rootEmployeeId: unknown; members: TransferMember[]; assignmentEffectiveDate?: string|null };
export type TransferChange = { employee_id:number; name_en:string|null; name_ar:string|null; before:Row; after:Row; fields:{field:string;before:unknown;after:unknown}[] };
export type TransferPreview = { root_employee_id:number; changes:TransferChange[]; issues:OrganizationIssue[]; valid:boolean; subtree_ids:number[] };

function subtreeOf(rows:{id:number;manager_id:number|null;employment_status:string}[],rootId:number):number[]{
  const result:number[]=[];const queue=[rootId];const seen=new Set<number>();
  while(queue.length){const id=queue.shift()!;if(seen.has(id))continue;seen.add(id);result.push(id);for(const r of rows)if(Number(r.manager_id)===id&&r.employment_status!=='deleted')queue.push(Number(r.id));}
  return result;
}

async function build(db:TransactionDatabase,input:TransferInput,lock:boolean):Promise<TransferPreview&{befores:Map<number,Row>;nexts:Map<number,Row>}>{
  if(!await organizationReady(db))throw asResponse(orgError('SETUP_UNAVAILABLE',null,'إعداد الهيكل التنظيمي غير متاح بعد','Organizational setup is not available yet'),409);
  await db.prepare('SELECT pg_advisory_xact_lock(78231)').run();
  const rootId=Number(input.rootEmployeeId);
  if(!Number.isSafeInteger(rootId)||rootId<=0)throw asResponse(orgError('INVALID_SELECTION','root_employee_id','اختر المدير','Select the manager'),400);
  const members=Array.isArray(input.members)?input.members:[];
  const ids=[...new Set(members.map(m=>Number(m.employeeId)))];
  if(!ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||ids.length!==members.length)throw asResponse(orgError('INVALID_SELECTION','members','قائمة الموظفين غير صالحة','Invalid member list'),400);
  if(!ids.includes(rootId))throw asResponse(orgError('INVALID_SELECTION','members','يجب أن يكون المدير ضمن النقل','The manager must be part of the transfer'),400);
  if(ids.length>200)throw asResponse(orgError('INVALID_SELECTION','members','عدد كبير جدًا من الموظفين','Too many employees in one transfer'),400);
  for(const m of members)for(const key of Object.keys(m))if(!['employeeId','reviewed',...EDITABLE].includes(key))throw asResponse(orgError('INVALID_SELECTION',key,'لا يمكن تعديل هذا الحقل في نقل الفريق (خط التبعية ومسؤول الموارد البشرية يبقيان كما هما)','This field cannot change in a team transfer (reporting lines and HR overrides are preserved)'),400);
  const placeholders=ids.map(()=>'?').join(',');
  const current=(await db.prepare(`SELECT * FROM employees WHERE id IN (${placeholders}) AND employment_status!='deleted' ORDER BY id${lock?' FOR UPDATE':''}`).bind(...ids).all()).results as Row[];
  if(current.length!==ids.length)throw asResponse(orgError('NOT_FOUND','members','بعض الموظفين غير موجودين','Some employees were not found',{details:{missing:ids.filter(id=>!current.some(r=>Number(r.id)===id))}}),404);
  const rows=await readReportingRows(db);
  const subtree=subtreeOf(rows,rootId);
  const outsideSubtree=ids.filter(id=>!subtree.includes(id));
  if(outsideSubtree.length)throw asResponse(orgError('INVALID_SELECTION','members','الموظفون المحددون يجب أن يكونوا ضمن فريق المدير','Selected employees must be in the manager\'s reporting subtree',{details:{employees:outsideSubtree}}),400);
  try{validateAssignmentDate(input.assignmentEffectiveDate)}catch(error){throw asResponse(error,400);}
  const catalog=await readOrganizationCatalog(db);
  const befores=new Map<number,Row>(),nexts=new Map<number,Row>(),changes:TransferChange[]=[],groupChanges:AssignmentChange[]=[];
  for(const member of members){
    const id=Number(member.employeeId),before=current.find(r=>Number(r.id)===id)!;
    let next:Row;
    try{next=assignmentFromPayload(Object.fromEntries(EDITABLE.filter(k=>member[k]!==undefined).map(k=>[k,member[k]])),before);}catch(error){throw asResponse(error,400);}
    next.manager_id=before.manager_id??null;next.hr_user_id=before.hr_user_id??null;
    befores.set(id,before);nexts.set(id,next);
    const fields:{field:string;before:unknown;after:unknown}[]=Object.values(assignmentFields).filter(c=>Number(next[c]||0)!==Number(before[c]||0)).map(c=>({field:c,before:before[c]??null,after:next[c]??null}));
    if(input.assignmentEffectiveDate!==undefined&&String(input.assignmentEffectiveDate||'')!==String(before.assignment_effective_date||''))fields.push({field:'assignment_effective_date',before:before.assignment_effective_date??null,after:input.assignmentEffectiveDate||null});
    changes.push({employee_id:id,name_en:before.name_en??null,name_ar:before.name_ar??null,before:Object.fromEntries(REVIEW_COLUMNS.map(c=>[c,before[c]??null])),after:{...Object.fromEntries(REVIEW_COLUMNS.map(c=>[c,next[c]??before[c]??null])),assignment_effective_date:input.assignmentEffectiveDate===undefined?before.assignment_effective_date??null:input.assignmentEffectiveDate||null},fields});
    groupChanges.push({id,before,next,status:before.employment_status});
  }
  const issues=assignmentGroupIssues(catalog,rows,groupChanges,{teamTransfer:true});
  if(!changes.some(c=>c.fields.length))issues.push({code:'INVALID_SELECTION',field:null,message_ar:'لا توجد تغييرات للنقل',message_en:'Nothing changes in this transfer'});
  return {root_employee_id:rootId,changes,issues,valid:!issues.length,subtree_ids:subtree,befores,nexts};
}

/** Read-only preview inside the caller's transaction: exact before/after per employee plus every blocking issue. */
export async function previewTeamTransfer(db:TransactionDatabase,input:TransferInput):Promise<TransferPreview>{
  const {root_employee_id,changes,issues,valid,subtree_ids}=await build(db,input,false);
  return {root_employee_id,changes,issues,valid,subtree_ids};
}

/** Commit: lock all members, require a current review for each, validate the final group, write + audit each. */
export async function commitTeamTransfer(db:TransactionDatabase,input:TransferInput,actor:{id:number;ip?:string|null}){
  const result=await build(db,input,true);
  for(const member of input.members){
    const before=result.befores.get(Number(member.employeeId))!;
    if(!member.reviewed||typeof member.reviewed!=='object')throw asResponse(orgError('STALE_REVIEW','members','راجع النقل قبل التأكيد','Review the transfer before confirming',{status:409,blocking:{type:'employee',id:before.id}}),409);
    try{assertAssignmentReviewCurrent(member.reviewed,before);}catch(error){throw asResponse(error,409);}
  }
  if(!result.valid){const first=result.issues[0];throw asResponse(new OrganizationError({...first,details:{...(first.details as object),issues:result.issues}}),400);}
  const audits:number[]=[];
  for(const change of result.changes){
    if(!change.fields.length)continue;
    const id=change.employee_id,before=result.befores.get(id)!,next=result.nexts.get(id)!;
    // Same persistence and audit shape as a single profile save (full before/after employee rows).
    await db.prepare('UPDATE employees SET updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run();
    await persistAssignment(db,id,next,input.assignmentEffectiveDate===undefined?{}:{assignmentEffectiveDate:input.assignmentEffectiveDate||null},before);
    if(Number(next.department_id||0)!==Number(before.department_id||0))await refreshReportingLevels(db,id);
    const after=await db.prepare('SELECT * FROM employees WHERE id=?').bind(id).first<Row>();
    if(Number(after?.manager_id||0)!==Number(before.manager_id||0))throw new Response('Reporting line changed unexpectedly',{status:500});
    const audit=await db.prepare("INSERT INTO audit_logs(user_id,action,module,record_type,record_id,previous_value,new_value,ip_address) VALUES (?,'update','employees','employee',?,?,?,?) RETURNING id").bind(actor.id,String(id),JSON.stringify(before),JSON.stringify(after),actor.ip??null).first<{id:number}>();
    audits.push(Number(audit?.id));
  }
  const changed=result.changes.filter(c=>c.fields.length);
  // One summary row ties the per-employee rows to a single reviewed transfer.
  const summary=await db.prepare("INSERT INTO audit_logs(user_id,action,module,record_type,record_id,previous_value,new_value,ip_address) VALUES (?,'team_transfer','employees','team_transfer',?,?,?,?) RETURNING id").bind(actor.id,String(result.root_employee_id),JSON.stringify(changed.map(c=>({employee_id:c.employee_id,...c.before}))),JSON.stringify({audit_ids:audits,changes:changed.map(c=>({employee_id:c.employee_id,fields:c.fields}))}),actor.ip??null).first<{id:number}>();
  return {root_employee_id:result.root_employee_id,changed:changed.map(c=>c.employee_id),audit_ids:[...audits,Number(summary?.id)],changes:result.changes};
}
