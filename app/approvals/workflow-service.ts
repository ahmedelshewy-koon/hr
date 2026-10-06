import type { TransactionDatabase } from '../../db/postgres';
import { EMPLOYEE_MANAGER_SQL, requireEmployeeHr } from '../employees/hr-assignment.ts';
import { advanceWorkflow, type ResolvedStep, type StepConfig, type WorkflowRun } from './workflow-policy.ts';
type DB=TransactionDatabase;
type Row=Record<string,unknown>;
export type SourceType='employee_request'|'attendance_correction';
export type Snapshot={workflowId:number;version:number;companyId:number;departmentId:number|null;employeeId:number;requestType:string;steps:ResolvedStep[]};
export const isWorkflowStage=(stage:unknown)=>String(stage).startsWith('workflow:');
export async function workflowsReady(db:DB){return Boolean((await db.prepare("SELECT to_regclass('public.approval_workflow_runs') AS name").first<{name:string|null}>())?.name);}
export async function resolveWorkflow(db:DB,employeeId:number,requestType:string):Promise<Snapshot|null>{
  if(!await workflowsReady(db))return null;
  // The most specific active workflow wins: the employee's team, then section, then department, then the company-wide default.
  // An inactive unit workflow is skipped, so its employees fall back to the company workflow.
  const row=await db.prepare(`SELECT w.*,${EMPLOYEE_MANAGER_SQL} AS manager_id FROM employees e JOIN approval_workflows w ON w.company_id=e.company_id AND w.request_type=? AND w.active=true AND (w.department_id IS NULL OR w.department_id IN (e.team_id,e.section_id,e.department_id)) WHERE e.id=? ORDER BY CASE WHEN w.department_id IS NULL THEN 3 WHEN w.department_id=e.team_id THEN 0 WHEN w.department_id=e.section_id THEN 1 ELSE 2 END LIMIT 1 FOR SHARE OF e,w`).bind(requestType,employeeId).first<Row>();
  if(!row)return null;
  const config=JSON.parse(String(row.steps_json)) as StepConfig[],steps:ResolvedStep[]=[];
  for(const step of config){
    let userId=step.userId;
    if(step.kind==='manager')userId=Number((await db.prepare("SELECT id FROM users WHERE employee_id=? AND status='active' ORDER BY id LIMIT 1").bind(row.manager_id).first<Row>())?.id);
    if(step.kind==='hr')userId=await requireEmployeeHr(db,employeeId);
    const user=await db.prepare("SELECT u.id,u.employee_id,e.name_en,e.name_ar FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.id=? AND u.status='active' AND e.employment_status IN ('active','probation','notice_period') FOR SHARE OF u,e").bind(userId||0).first<Row>();
    if(!user)throw new Response('أحد موافقي المسار غير متاح. راجع إعدادات الاعتمادات / An approver is unavailable',{status:409});
    if(Number(user.employee_id)===employeeId)throw new Response('مسار الاعتماد يتضمن صاحب الطلب. راجع الإعدادات / The requester cannot approve their own request',{status:409});
    if(steps.some(s=>s.userId===Number(user.id)))throw new Response('مسار الاعتماد ينتج موافقًا مكررًا / The resolved approver is duplicated',{status:409});
    steps.push({userId:Number(user.id),name:String(user.name_en||user.name_ar),nameAr:String(user.name_ar||user.name_en)});
  }
  if(!steps.length)throw new Response('مسار الاعتماد بلا مراحل / Empty approval workflow',{status:409});
  return {workflowId:Number(row.id),version:Number(row.version),companyId:Number(row.company_id),departmentId:row.department_id==null?null:Number(row.department_id),employeeId,requestType,steps};
}
export async function attachWorkflow(db:DB,sourceType:SourceType,sourceId:number,snapshot:Snapshot){
  await db.prepare("INSERT INTO approval_workflow_runs (source_type,source_id,employee_id,company_id,department_id,workflow_id,version,request_type,steps_json,current_user_id) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(sourceType,sourceId,snapshot.employeeId,snapshot.companyId,snapshot.departmentId??null,snapshot.workflowId,snapshot.version,snapshot.requestType,JSON.stringify(snapshot.steps),snapshot.steps[0].userId).run();
  const table=sourceType==='employee_request'?'requests':'attendance_corrections';
  await db.prepare(`UPDATE ${table} SET status='pending_hr',current_stage='workflow:0' WHERE id=?`).bind(sourceId).run();
}
export function runFromRow(row:Row):WorkflowRun{return {steps:JSON.parse(String(row.steps_json)),currentStep:Number(row.current_step),state:row.state as WorkflowRun['state']};}
export async function decideWorkflow(db:DB,sourceType:SourceType,sourceId:number,actorId:number,expectedStage:string,decision:'approve'|'reject',reason=''){
  const row=await db.prepare("SELECT * FROM approval_workflow_runs WHERE source_type=? AND source_id=? FOR UPDATE").bind(sourceType,sourceId).first<Row>();
  if(!row)throw new Response('Approval workflow not found',{status:409});
  const user=await db.prepare("SELECT u.employee_id FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.id=? AND u.status='active' AND e.employment_status IN ('active','probation','notice_period') FOR SHARE OF u,e").bind(actorId).first<Row>();
  if(!user||Number(user.employee_id)===Number(row.employee_id))throw new Response('Approval is not permitted',{status:403});
  const next=advanceWorkflow(runFromRow(row),actorId,expectedStage,decision,reason);
  await db.prepare("UPDATE approval_workflow_runs SET steps_json=?,current_step=?,state=?,current_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(next.steps),next.currentStep,next.state,next.state==='pending'?next.steps[next.currentStep].userId:null,row.id).run();
  return {status:next.state==='pending'?'pending_hr':next.state==='rejected'?(sourceType==='attendance_correction'?'rejected_hr':'hr_rejected'):sourceType==='attendance_correction'?'resolved':'hr_approved',currentStage:next.state==='pending'?`workflow:${next.currentStep}`:'completed',balanceAction:next.state==='pending'?'none' as const:next.state==='approved'?'consume' as const:'release' as const,apply:next.state==='approved'};
}
export async function cancelWorkflow(db:DB,sourceId:number){if(await workflowsReady(db))await db.prepare("UPDATE approval_workflow_runs SET state='cancelled',current_user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE source_type='employee_request' AND source_id=?").bind(sourceId).run();}
export async function hasWorkflowAssignments(db:DB,userId:number){
  if(!await workflowsReady(db))return false;
  return Boolean(await db.prepare("SELECT id FROM approval_workflow_runs WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(steps_json::jsonb) s WHERE (s->>'userId')::int=?) LIMIT 1").bind(userId).first<Row>());
}
export async function enrichWorkflowRows(db:DB,rows:Row[],sourceType:SourceType){
  if(!rows.length||!await workflowsReady(db))return;
  const ids=rows.map(r=>Number(r.source_id||r.id));
  const runs=(await db.prepare(`SELECT w.*, (w.state='pending' AND NOT EXISTS(SELECT 1 FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.id=w.current_user_id AND u.status='active' AND e.employment_status IN ('active','probation','notice_period') AND e.id<>w.employee_id)) AS approver_unavailable FROM approval_workflow_runs w WHERE source_type=? AND source_id IN (${ids.map(()=>'?').join(',')})`).bind(sourceType,...ids).all<Row>()).results;
  for(const row of rows){const run=runs.find(r=>Number(r.source_id)===Number(row.source_id||row.id));if(run){row.approval_workflow=runFromRow(run);row.workflow_current_user_id=run.current_user_id;row.workflow_unavailable=Boolean(run.approver_unavailable);}}
}
export async function workflowScope(db:DB,userId:number,legacyScope:string,sourceType:SourceType,alias:'q'|'c'){
  if(!await workflowsReady(db))return legacyScope;
  const link=`w.source_type='${sourceType}' AND w.source_id=${alias}.id`;
  return `((NOT EXISTS(SELECT 1 FROM approval_workflow_runs w WHERE ${link}) AND (${legacyScope})) OR EXISTS(SELECT 1 FROM approval_workflow_runs w WHERE ${link} AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.steps_json::jsonb) s WHERE (s->>'userId')::int=${Number(userId)})))`;
}
export async function canReadWorkflowDocument(db:DB,userId:number,documentId:number){
  if(!await workflowsReady(db))return false;
  return Boolean(await db.prepare(`SELECT w.id FROM approval_workflow_runs w JOIN requests q ON q.id=w.source_id AND w.source_type='employee_request'
    JOIN documents d ON d.id=? AND d.employee_id=q.employee_id
    WHERE (q.details_json::jsonb->'attachment'->>'documentId')=? AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.steps_json::jsonb) s WHERE (s->>'userId')::int=?) LIMIT 1`).bind(documentId,String(documentId),userId).first());
}
