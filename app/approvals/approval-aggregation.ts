import { EMPLOYEE_MANAGER_SQL, effectiveHrSql } from "../employees/hr-assignment";
import type { PostgresDatabase } from "../../db/postgres";
import { pendingApproverColumns } from "./approval-chain-sql";
import { isApprovalActionable, statusCategory, unifiedStatus } from "./approval-presentation";
import { enrichWorkflowRows, workflowScope } from './workflow-service';

type User={id:number;role_name:string;employee_id:number|null;department_id:number|null};
type Row=Record<string,unknown>;
export type UnifiedApproval=Row&{id:string;source_type:"employee_request"|"attendance_correction";source_id:number;actionable:boolean;category:string;unified_status:string;decision_by_me?:string|null;decision_at?:unknown};

export async function aggregateApprovals(db:PostgresDatabase,user:User){
  const hrSql=await effectiveHrSql(db);
  const scope=user.role_name==="Department Manager"?`${EMPLOYEE_MANAGER_SQL}=${Number(user.employee_id)||-1}`:`${hrSql}=${Number(user.id)} AND EXISTS (SELECT 1 FROM hr_responsibles h JOIN users hu ON hu.id=h.user_id AND hu.status='active' WHERE h.user_id=${hrSql} AND h.status='active' AND (hu.employee_id<>e.id AND EXISTS (SELECT 1 FROM employees he WHERE he.id=hu.employee_id AND he.employment_status IN ('active','probation','notice_period'))))`;
  const legacyScope=['Department Manager','HR Manager','Super Admin'].includes(user.role_name)?scope:'FALSE';
  const requestScope=await workflowScope(db,user.id,legacyScope,'employee_request','q');
  const correctionScope=await workflowScope(db,user.id,legacyScope,'attendance_correction','c');
  const [requests,corrections,requestActions,correctionActions]=await Promise.all([
    db.prepare(`SELECT q.id,q.request_code,q.employee_id,q.type,q.from_date,q.to_date,q.request_date,q.request_time,q.amount,q.currency,q.reason,q.notes,q.details_json,q.status,q.current_stage,q.requested_days,q.created_at,q.updated_at,e.name_en AS employee_name,e.name_ar AS employee_name_ar,e.employee_code,e.department_id,d.name_en AS department_name,d.name_ar AS department_name_ar,j.name_en AS job_title,j.name_ar AS job_title_ar,m.name_en AS manager_name,m.name_ar AS manager_name_ar,lt.name_en AS leave_type_name,lt.name_ar AS leave_type_name_ar,lb.entitlement-lb.used-lb.pending AS available_balance,lb.pending AS pending_balance,${pendingApproverColumns(hrSql)} FROM requests q JOIN employees e ON e.id=q.employee_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles j ON j.id=e.job_title_id LEFT JOIN employees m ON m.id=e.manager_id LEFT JOIN leave_types lt ON lt.id=q.leave_type_id LEFT JOIN leave_balances lb ON lb.employee_id=q.employee_id AND lb.leave_type_id=q.leave_type_id AND lb.year=COALESCE(q.balance_year,EXTRACT(YEAR FROM CURRENT_DATE)::integer) WHERE ${requestScope} ORDER BY q.created_at DESC LIMIT 750`).all(),
    db.prepare(`SELECT c.*,e.name_en AS employee_name,e.name_ar AS employee_name_ar,e.employee_code,e.department_id,d.name_en AS department_name,d.name_ar AS department_name_ar,j.name_en AS job_title,j.name_ar AS job_title_ar,m.name_en AS manager_name,m.name_ar AS manager_name_ar,da.scheduled_in,da.scheduled_out,da.actual_in,da.actual_out,da.worked_minutes,da.late_minutes,da.early_minutes FROM attendance_corrections c JOIN employees e ON e.id=c.employee_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles j ON j.id=e.job_title_id LEFT JOIN employees m ON m.id=e.manager_id LEFT JOIN daily_attendance da ON da.id=c.daily_attendance_id WHERE ${correctionScope} ORDER BY c.created_at DESC LIMIT 750`).all(),
    db.prepare(`SELECT a.request_id,a.actor_user_id,a.action,a.reason,a.stage,a.created_at,u.email AS actor_email,ae.name_en AS actor_name,ae.name_ar AS actor_name_ar FROM approvals a JOIN requests q ON q.id=a.request_id JOIN employees e ON e.id=q.employee_id LEFT JOIN users u ON u.id=a.actor_user_id LEFT JOIN employees ae ON ae.id=u.employee_id WHERE ${requestScope} ORDER BY a.created_at,a.id`).all(),
    db.prepare(`SELECT a.correction_id,a.actor_user_id,a.action,a.reason,a.stage,a.created_at,u.email AS actor_email,ae.name_en AS actor_name,ae.name_ar AS actor_name_ar FROM attendance_correction_actions a JOIN attendance_corrections c ON c.id=a.correction_id JOIN employees e ON e.id=c.employee_id LEFT JOIN users u ON u.id=a.actor_user_id LEFT JOIN employees ae ON ae.id=u.employee_id WHERE ${correctionScope} ORDER BY a.created_at,a.id`).all(),
  ]);
  await enrichWorkflowRows(db,requests.results,'employee_request');
  await enrichWorkflowRows(db,corrections.results,'attendance_correction');
  const requestHistory=requestActions.results as Row[],correctionHistory=correctionActions.results as Row[];
  const items:UnifiedApproval[]=[];
  for(const row of requests.results as Row[]){
    const stage=String(row.current_stage),status=String(row.status);
    const actionable=row.approval_workflow?!row.workflow_unavailable&&Number(row.workflow_current_user_id)===user.id&&status==='pending_hr'&&Number(row.employee_id)!==user.employee_id:isApprovalActionable({roleName:user.role_name,stage,status,employeeId:Number(row.employee_id),actorEmployeeId:user.employee_id});
    const history=requestHistory.filter(action=>Number(action.request_id)===Number(row.id)),mine=history.filter(action=>Number(action.actor_user_id)===user.id).at(-1);
    items.push({...row,id:`request:${row.id}`,source_type:"employee_request",source_id:Number(row.id),approval_type:row.leave_type_name||row.type,effective_date:row.from_date||row.request_date,actionable,category:statusCategory(status,actionable),unified_status:row.approval_workflow&&status==='pending_hr'?'waiting_approval':unifiedStatus(status),decision_by_me:mine?String(mine.action):null,decision_at:mine?.created_at,history});
  }
  for(const row of corrections.results as Row[]){
    const stage=String(row.current_stage),status=String(row.status);
    const actionable=row.approval_workflow?!row.workflow_unavailable&&Number(row.workflow_current_user_id)===user.id&&status==='pending_hr'&&Number(row.employee_id)!==user.employee_id:isApprovalActionable({roleName:user.role_name,stage,status,employeeId:Number(row.employee_id),actorEmployeeId:user.employee_id});
    const history=correctionHistory.filter(action=>Number(action.correction_id)===Number(row.id)),mine=history.filter(action=>Number(action.actor_user_id)===user.id&&/(approved|rejected)$/.test(String(action.action))).at(-1);
    items.push({...row,id:`attendance:${row.id}`,source_type:"attendance_correction",source_id:Number(row.id),approval_type:"attendance_correction",effective_date:row.attendance_date,actionable,category:statusCategory(status,actionable),unified_status:row.approval_workflow&&status==='pending_hr'?'waiting_approval':unifiedStatus(status),decision_by_me:mine?String(mine.action).includes("approved")?"approve":"reject":null,decision_at:mine?.created_at,history});
  }
  items.sort((a,b)=>a.actionable===b.actionable?new Date(String(a.created_at)).getTime()-new Date(String(b.created_at)).getTime():a.actionable?-1:1);
  const month=new Date().toISOString().slice(0,7),approvedByMe=items.filter(item=>item.decision_by_me==="approve"&&(item.decision_at instanceof Date?item.decision_at.toISOString():String(item.decision_at)).startsWith(month)).length,rejectedByMe=items.filter(item=>item.decision_by_me==="reject"&&(item.decision_at instanceof Date?item.decision_at.toISOString():String(item.decision_at)).startsWith(month)).length;
  return {items,metrics:{needsMyApproval:items.filter(item=>item.actionable).length,waiting:items.filter(item=>item.category==="waiting").length,approvedThisMonth:approvedByMe,rejectedThisMonth:rejectedByMe,companyPending:items.filter(item=>["pending_manager","pending_hr"].includes(String(item.status))).length}};
}
