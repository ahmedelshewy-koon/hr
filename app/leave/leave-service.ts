import { requireEmployeeHr, assertEmployeeHr, assertEmployeeManager } from "../employees/hr-assignment";
import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";
import { availableLeaveBalance, calculateLeaveDuration } from "./leave-calculation";
import { loadCalendarHolidays } from "./holiday-store";
import { refreshLeaveAttendance } from "../attendance/attendance-service";
import { decideLeaveTransition } from "./leave-workflow";
import { LEAVE_REPORT_CATEGORY, leaveRequiresReport } from "./leave-report-policy";
import { attachWorkflow, cancelWorkflow, decideWorkflow, isWorkflowStage, resolveWorkflow } from '../approvals/workflow-service';

type Db = PostgresDatabase | TransactionDatabase;
type Row = Record<string, unknown>;

export type LeaveActor = {
  id: number;
  employeeId: number | null;
  roleName: string;
};

type Employee = { id:number; country:string; start_date:string; employment_status:string; work_days:string|null };
type LeaveType = { id:number; code:string; name_en:string; name_ar:string; default_days:number; paid:number; attachment_required:number; manager_approval:number; hr_approval:number; status:string };
type LeaveBalance = { id:number; employee_id:number; leave_type_id:number; year:number; entitlement:number; used:number; pending:number };

function response(message: string, status = 400): never { throw new Response(message, { status }); }
function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try { const parsed=JSON.parse(value); return parsed && typeof parsed === "object" ? parsed as Record<string,unknown> : {}; } catch { return {}; }
}

async function writeAudit(db:Db,input:{request:Request;actor:LeaveActor;action:string;recordType:string;recordId:string;previous?:unknown;next?:unknown}){
  await db.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,previous_value,new_value,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
    .bind(input.actor.id,input.action,"leave_management",input.recordType,input.recordId,input.previous===undefined?null:JSON.stringify(input.previous),input.next===undefined?null:JSON.stringify(input.next),input.request.headers.get("cf-connecting-ip")).run();
}

async function ensureBalance(db:Db,employee:Employee,leaveType:LeaveType,year:number){
  const entitlement=Number(leaveType.default_days)||0;
  await db.prepare("INSERT INTO leave_balances (employee_id,leave_type_id,year,entitlement,used,pending) VALUES (?,?,?,?,0,0) ON CONFLICT(employee_id,leave_type_id,year) DO UPDATE SET entitlement=CASE WHEN leave_balances.used=0 AND leave_balances.pending=0 THEN excluded.entitlement ELSE leave_balances.entitlement END")
    .bind(employee.id,leaveType.id,year,entitlement).run();
  const balance=await db.prepare("SELECT * FROM leave_balances WHERE employee_id=? AND leave_type_id=? AND year=? FOR UPDATE").bind(employee.id,leaveType.id,year).first<LeaveBalance>();
  if(!balance) response("Unable to initialize leave balance",500);
  return balance;
}

export async function initializeCurrentLeaveBalances(db:PostgresDatabase,employeeIds:number[],year:number){
  if(!employeeIds.length)return;
  const placeholders=employeeIds.map(()=>"?").join(",");
  await db.prepare(`INSERT INTO leave_balances (employee_id,leave_type_id,year,entitlement,used,pending)
    SELECT e.id,lt.id,?::integer,lt.default_days,0,0
    FROM employees e
    JOIN employee_leave_types elt ON elt.employee_id=e.id
    JOIN leave_types lt ON lt.id=elt.leave_type_id AND lt.status='active' AND lt.code<>'OFFICIAL'
    WHERE e.id IN (${placeholders}) AND e.employment_status IN ('active','probation','notice_period')
    ON CONFLICT(employee_id,leave_type_id,year) DO NOTHING`).bind(year,...employeeIds).run();
}

// onBehalf: "manager" = the employee's direct manager files it, so it is approved at once;
// "hr" = HR files it, approved at once only when the actor is the employee's assigned HR.
type CreateLeaveInput={request:Request;actor:LeaveActor;employeeId:number;leaveTypeId:number;fromDate:string;toDate:string;reason:string;notes?:string;attachmentDocumentId?:number|null;onBehalf?:"manager"|"hr"|null};
export async function createLeaveRequest(input:CreateLeaveInput&{db:PostgresDatabase}){
  if(input.fromDate.slice(0,4)!==input.toDate.slice(0,4)) response("Leave requests must stay within one calendar year",400);
  return input.db.transaction(tx=>createLeaveInTx(tx,input));
}
/** The whole leave submission inside the caller's transaction (used by create and by edit). */
async function createLeaveInTx(tx:TransactionDatabase,input:CreateLeaveInput){
    const year=Number(input.fromDate.slice(0,4));
    if(input.fromDate.slice(0,4)!==input.toDate.slice(0,4)) response("Leave requests must stay within one calendar year",400);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(input.fromDate)||!/^\d{4}-\d{2}-\d{2}$/.test(input.toDate)) response("Invalid end date",400);
    if(input.fromDate>input.toDate) response("The start date must not be after the end date",400);
    await tx.prepare("SELECT pg_advisory_xact_lock(?,?)").bind(input.employeeId,year).run();
    const employee=await tx.prepare("SELECT id,country,start_date,employment_status,work_days FROM employees WHERE id=? FOR UPDATE").bind(input.employeeId).first<Employee>();
    if(!employee||!["active","probation","notice_period"].includes(employee.employment_status)) response("Employee is not active",409);
    const workflow=await resolveWorkflow(tx,employee.id,`leave:${input.leaveTypeId}`);
    const hrUserId=workflow?null:await requireEmployeeHr(tx, employee.id);
    if(input.onBehalf&&employee.id===Number(input.actor.employeeId)) response("Use your own request form for your own leave",400);
    if(input.onBehalf==="manager")await assertEmployeeManager(tx,employee.id,input.actor.employeeId);
    const directApproval=!workflow&&(input.onBehalf==="manager"||(input.onBehalf==="hr"&&hrUserId===input.actor.id));
    const leaveType=await tx.prepare("SELECT * FROM leave_types WHERE id=? AND status='active'").bind(input.leaveTypeId).first<LeaveType>();
    if(!leaveType) response("Leave type is not active",404);
    if(leaveType.code==="OFFICIAL") response("Official holidays cannot be requested as employee leave",400);
    const assignment=await tx.prepare("SELECT id FROM employee_leave_types WHERE employee_id=? AND leave_type_id=?").bind(employee.id,leaveType.id).first<{id:number}>();
    if(!assignment) response("This leave type is not assigned to your employee profile",403);
    const report=input.attachmentDocumentId?await tx.prepare("SELECT id,name FROM documents WHERE id=? AND employee_id=? AND category=? AND status='active'").bind(input.attachmentDocumentId,employee.id,LEAVE_REPORT_CATEGORY).first<{id:number;name:string}>():null;
    if(input.attachmentDocumentId&&!report) response("The attached medical report was not found. Upload it again and retry.",400);
    if(leaveRequiresReport(leaveType)&&!report) response("A medical report is required for this leave type. Upload the report and try again.",409);
    const duration=calculateLeaveDuration({fromDate:input.fromDate,toDate:input.toDate,workDays:employee.work_days,holidays:await loadCalendarHolidays(tx,employee.country),country:employee.country});
    if(duration.chargeableDays<=0) response("The selected period contains no chargeable working days",409);
    const overlap=await tx.prepare("SELECT id,request_code FROM requests WHERE employee_id=? AND from_date<=? AND to_date>=? AND status IN ('pending_manager','pending_hr','hr_approved') AND (leave_type_id IS NOT NULL OR type ILIKE '%leave%') LIMIT 1")
      .bind(employee.id,input.toDate,input.fromDate).first<{id:number;request_code:string}>();
    if(overlap) response(`The selected dates overlap with request ${overlap.request_code}`,409);

    const balance=await ensureBalance(tx,employee,leaveType,year);
    const controlled=Number(leaveType.default_days)>0;
    if(controlled&&availableLeaveBalance(balance)<duration.chargeableDays) response(`Insufficient leave balance. Available: ${availableLeaveBalance(balance)} day(s)`,409);
    const managerApproval=true,hrApproval=true;
    const status=workflow?"pending_hr":directApproval?"hr_approved":managerApproval?"pending_manager":hrApproval?"pending_hr":"hr_approved";
    const stage=workflow?"workflow:0":directApproval?"completed":managerApproval?"manager":hrApproval?"hr":"completed";
    const effect=controlled?(stage==="completed"?"consumed":"reserved"):"none";
    if(controlled){
      const update=stage==="completed"
        ? "UPDATE leave_balances SET used=used+? WHERE id=? AND entitlement-used-pending>=? RETURNING *"
        : "UPDATE leave_balances SET pending=pending+? WHERE id=? AND entitlement-used-pending>=? RETURNING *";
      const changed=await tx.prepare(update).bind(duration.chargeableDays,balance.id,duration.chargeableDays).first<LeaveBalance>();
      if(!changed) response("Leave balance changed while this request was being submitted. Please try again.",409);
    }
    const sequence=await tx.prepare("SELECT nextval(pg_get_serial_sequence('requests','id'))::int AS id").first<{id:number}>();
    const id=Number(sequence!.id),code=`REQ-${1000+id}`;
    const details={leave:{balanceId:balance.id,leaveTypeId:leaveType.id,requestedDays:duration.chargeableDays,balanceYear:year,managerApproval,hrApproval,createdOnBehalfBy:input.onBehalf?{userId:input.actor.id,role:input.onBehalf}:null,chargeableDates:duration.chargeableDates,excludedWeekends:duration.excludedWeekends,excludedHolidays:duration.excludedHolidays},attachmentName:report?.name??null,attachment:report?{documentId:report.id,name:report.name}:null};
    await tx.prepare("INSERT INTO requests (id,request_code,employee_id,type,leave_type_id,requested_days,balance_year,balance_effect,from_date,to_date,reason,notes,details_json,status,current_stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
      .bind(id,code,employee.id,leaveType.name_en,leaveType.id,duration.chargeableDays,year,effect,input.fromDate,input.toDate,input.reason,input.notes||null,JSON.stringify(details),status,stage).run();
    await writeAudit(tx,{request:input.request,actor:input.actor,action:input.onBehalf?"leave_request_created_on_behalf":"leave_request_created",recordType:"request",recordId:String(id),next:{code,employeeId:employee.id,leaveTypeId:leaveType.id,days:duration.chargeableDays,status,stage,onBehalf:input.onBehalf??null,reportDocumentId:report?.id??null}});
    if(workflow)await attachWorkflow(tx,'employee_request',id,workflow);
    if(directApproval)await tx.prepare("INSERT INTO approvals (request_id,stage,actor_user_id,action,reason,created_at) VALUES (?,?,?,'approve',?,CURRENT_TIMESTAMP)").bind(id,input.onBehalf==="manager"?"manager":"hr",input.actor.id,"Created and approved on behalf of the employee").run();
    if(effect!=="none")await writeAudit(tx,{request:input.request,actor:input.actor,action:effect==="reserved"?"leave_balance_reserved":"leave_balance_consumed",recordType:"leave_balance",recordId:String(balance.id),next:{requestId:id,days:duration.chargeableDays}});
    if(status==="hr_approved")await refreshLeaveAttendance(tx,employee.id,input.fromDate,input.toDate);
    return {ok:true,id,requestCode:code,requestedDays:duration.chargeableDays,status,currentStage:stage};
}

export async function processLeaveRequest(input:{db:PostgresDatabase;request:Request;actor:LeaveActor;requestId:number;decision:"approve"|"reject";reason?:string;expectedStage?:string}){
  return input.db.transaction(async tx=>{
    await tx.prepare("SELECT pg_advisory_xact_lock(?,?)").bind(771,input.requestId).run();
    const row=await tx.prepare("SELECT * FROM requests WHERE id=? FOR UPDATE").bind(input.requestId).first<Row>();
    if(!row||!row.leave_type_id) response("Leave request not found",404);
    if(!["pending_manager","pending_hr"].includes(String(row.status))) response("This leave request has already been processed",409);
    const stage=String(row.current_stage);
    if(stage==="manager"&&input.actor.roleName!=="Department Manager") response("Only the employee's department manager can take this action",403);
    if(stage==="hr"&&!['Super Admin','HR Manager'].includes(input.actor.roleName)) response("Only HR can take this action",403);
    if(Number(row.employee_id)===Number(input.actor.employeeId)) response("You cannot approve your own request",403);
    if(input.decision==="reject"&&!input.reason?.trim()) response("Rejection reason is required",400);

    if(stage==="manager")await assertEmployeeManager(tx,Number(row.employee_id),input.actor.employeeId);
    if(stage==="hr")await assertEmployeeHr(tx,Number(row.employee_id),input.actor.id);
    if(stage==="manager"&&input.decision==="approve")await requireEmployeeHr(tx,Number(row.employee_id));
    const details=jsonObject(row.details_json),leave=jsonObject(JSON.stringify(details.leave??{}));
    const managerApproval=true,hrApproval=true;
    const transition=isWorkflowStage(stage)?await decideWorkflow(tx,'employee_request',input.requestId,input.actor.id,input.expectedStage||'',input.decision,input.reason):decideLeaveTransition({status:String(row.status),stage,decision:input.decision,hrApproval});
    const {status,currentStage}=transition;
    const finalEffect=transition.balanceAction==="consume"?"consumed":transition.balanceAction==="release"?"released":null;
    let nextEffect=String(row.balance_effect||"none");
    const balanceId=Number(leave.balanceId)||0,days=Number(row.requested_days)||Number(leave.requestedDays)||0;
    if(finalEffect&&nextEffect==="reserved"){
      const sql=finalEffect==="consumed"
        ? "UPDATE leave_balances SET pending=pending-?,used=used+? WHERE id=? AND pending>=? RETURNING *"
        : "UPDATE leave_balances SET pending=pending-? WHERE id=? AND pending>=? RETURNING *";
      const changed=finalEffect==="consumed"
        ? await tx.prepare(sql).bind(days,days,balanceId,days).first<LeaveBalance>()
        : await tx.prepare(sql).bind(days,balanceId,days).first<LeaveBalance>();
      if(!changed) response("The reserved leave balance is inconsistent; no balance was changed",409);
      nextEffect=finalEffect;
      await writeAudit(tx,{request:input.request,actor:input.actor,action:finalEffect==="consumed"?"leave_balance_consumed":"leave_balance_released",recordType:"leave_balance",recordId:String(balanceId),previous:{requestId:input.requestId,effect:row.balance_effect},next:{requestId:input.requestId,effect:finalEffect,days}});
    }else if(finalEffect&&nextEffect!=="none") response("This leave balance effect has already been applied",409);
    details.leave={...leave,managerApproval,hrApproval};
    await tx.prepare("UPDATE requests SET status=?,current_stage=?,balance_effect=?,details_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status,currentStage,nextEffect,JSON.stringify(details),input.requestId).run();
    await tx.prepare("INSERT INTO approvals (request_id,stage,actor_user_id,action,reason,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)").bind(input.requestId,stage,input.actor.id,input.decision,input.reason?.trim()||null).run();
    await writeAudit(tx,{request:input.request,actor:input.actor,action:stage==="manager"?`manager_${input.decision}`:`hr_${input.decision}`,recordType:"request",recordId:String(input.requestId),previous:{status:row.status,stage},next:{status,currentStage,balanceEffect:nextEffect}});
    if(status==="hr_approved")await refreshLeaveAttendance(tx,Number(row.employee_id),String(row.from_date),String(row.to_date));
    return {ok:true,status,currentStage,balanceEffect:nextEffect};
  });
}

type CancelLeaveInput={request:Request;actor:LeaveActor;requestId:number;reason?:string};
export async function cancelLeaveRequest(input:CancelLeaveInput&{db:PostgresDatabase}){
  return input.db.transaction(tx=>cancelLeaveInTx(tx,input));
}
async function cancelLeaveInTx(tx:TransactionDatabase,input:CancelLeaveInput){
    await tx.prepare("SELECT pg_advisory_xact_lock(?,?)").bind(771,input.requestId).run();
    const row=await tx.prepare("SELECT * FROM requests WHERE id=? FOR UPDATE").bind(input.requestId).first<Row>();
    if(!row||!row.leave_type_id) response("Leave request not found",404);
    if(input.actor.roleName==="Employee"&&Number(row.employee_id)!==Number(input.actor.employeeId)) response("You can cancel only your own leave request",403);
    if(["HR Manager","Super Admin"].includes(input.actor.roleName)&&Number(row.employee_id)!==Number(input.actor.employeeId))await assertEmployeeHr(tx,Number(row.employee_id),input.actor.id);
    // A department manager may only cancel leave of employees they manage.
    if(input.actor.roleName==="Department Manager"&&Number(row.employee_id)!==Number(input.actor.employeeId))await assertEmployeeManager(tx,Number(row.employee_id),input.actor.employeeId);
    const pending=["pending_manager","pending_hr"].includes(String(row.status));
    const approved=String(row.status)==="hr_approved"&&String(row.from_date)>new Date().toISOString().slice(0,10);
    if(!pending&&!approved) response("Only pending leave or approved future leave can be cancelled",409);
    const details=jsonObject(row.details_json),leave=jsonObject(JSON.stringify(details.leave??{}));
    const balanceId=Number(leave.balanceId)||0,days=Number(row.requested_days)||Number(leave.requestedDays)||0,effect=String(row.balance_effect||"none");
    if(effect==="reserved"){
      const changed=await tx.prepare("UPDATE leave_balances SET pending=pending-? WHERE id=? AND pending>=? RETURNING *").bind(days,balanceId,days).first<LeaveBalance>();
      if(!changed)response("The reserved leave balance is inconsistent",409);
    }else if(effect==="consumed"){
      const changed=await tx.prepare("UPDATE leave_balances SET used=used-? WHERE id=? AND used>=? RETURNING *").bind(days,balanceId,days).first<LeaveBalance>();
      if(!changed)response("The consumed leave balance is inconsistent",409);
    }
    await tx.prepare("UPDATE requests SET status='cancelled',current_stage='completed',balance_effect='released',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(input.requestId).run();
    await cancelWorkflow(tx,input.requestId);
    await tx.prepare("INSERT INTO approvals (request_id,stage,actor_user_id,action,reason,created_at) VALUES (?,'employee',?,'cancel',?,CURRENT_TIMESTAMP)").bind(input.requestId,input.actor.id,input.reason?.trim()||null).run();
    await writeAudit(tx,{request:input.request,actor:input.actor,action:"leave_cancelled",recordType:"request",recordId:String(input.requestId),previous:{status:row.status,balanceEffect:effect},next:{status:"cancelled",balanceEffect:"released",days}});
    if(effect!=="none")await writeAudit(tx,{request:input.request,actor:input.actor,action:"leave_balance_released",recordType:"leave_balance",recordId:String(balanceId),previous:{effect},next:{requestId:input.requestId,days,cancelled:true}});
    if(String(row.status)==="hr_approved")await refreshLeaveAttendance(tx,Number(row.employee_id),String(row.from_date),String(row.to_date));
    return {ok:true,status:"cancelled"};
}

/**
 * Edit = cancel the original (releasing its balance) and submit the new dates/type, in ONE transaction:
 * if the new period is refused (overlap, balance, no working days) the original leave is left exactly as it was.
 */
export async function editLeaveRequest(input:{db:PostgresDatabase;request:Request;actor:LeaveActor;requestId:number;leaveTypeId:number;fromDate:string;toDate:string;reason:string;notes?:string;onBehalf:"manager"|"hr"|null}){
  if(input.fromDate.slice(0,4)!==input.toDate.slice(0,4)) response("Leave requests must stay within one calendar year",400);
  return input.db.transaction(async tx=>{
    const original=await tx.prepare("SELECT id,employee_id,request_code,details_json FROM requests WHERE id=? AND leave_type_id IS NOT NULL").bind(input.requestId).first<Row>();
    if(!original) response("Leave request not found",404);
    await cancelLeaveInTx(tx,{request:input.request,actor:input.actor,requestId:input.requestId,reason:"Edited"});
    const created=await createLeaveInTx(tx,{request:input.request,actor:input.actor,employeeId:Number(original!.employee_id),leaveTypeId:input.leaveTypeId,fromDate:input.fromDate,toDate:input.toDate,reason:input.reason,notes:input.notes,onBehalf:input.onBehalf,attachmentDocumentId:Number(jsonObject(JSON.stringify(jsonObject(original!.details_json).attachment??{})).documentId)||null});
    await writeAudit(tx,{request:input.request,actor:input.actor,action:"leave_request_edited",recordType:"request",recordId:String(created.id),previous:{requestId:input.requestId,code:original!.request_code},next:{requestId:created.id,code:created.requestCode}});
    return {...created,replacedRequestId:input.requestId};
  });
}
