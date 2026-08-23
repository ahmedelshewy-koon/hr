import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";
import { availableLeaveBalance, calculateLeaveDuration, completedServiceMonths, type LeaveHoliday } from "./leave-calculation";
import { decideLeaveTransition } from "./leave-workflow";

type Db = PostgresDatabase | TransactionDatabase;
type Row = Record<string, unknown>;

export type LeaveActor = {
  id: number;
  employeeId: number | null;
  roleName: string;
};

type Employee = { id:number; country:string; start_date:string; employment_status:string; work_days:string|null };
type LeaveType = { id:number; code:string; name_en:string; name_ar:string; paid:number; attachment_required:number; manager_approval:number; hr_approval:number; status:string };
type LeavePolicy = { id:number; leave_type_id:number; country:string; annual_entitlement:number; min_service_months:number|null; carry_forward:number; max_carry_forward:number|null; expiry_days:number|null; status:string };
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

async function resolvePolicy(db:Db,leaveTypeId:number,country:string){
  return db.prepare("SELECT * FROM leave_policies WHERE leave_type_id=? AND status='active' AND country IN (?, 'Both', 'KSA & Egypt') ORDER BY CASE WHEN country=? THEN 0 ELSE 1 END,id DESC LIMIT 1")
    .bind(leaveTypeId,country,country).first<LeavePolicy>();
}

async function ensureBalance(db:Db,employee:Employee,leaveType:LeaveType,policy:LeavePolicy,year:number){
  const serviceMonths=completedServiceMonths(employee.start_date,`${year}-12-31`);
  if(serviceMonths<Number(policy.min_service_months||0)) response(`This leave requires ${policy.min_service_months} completed months of service`,409);
  const entitlement=Number(policy.annual_entitlement)||0;
  await db.prepare("INSERT INTO leave_balances (employee_id,leave_type_id,year,entitlement,used,pending) VALUES (?,?,?,?,0,0) ON CONFLICT(employee_id,leave_type_id,year) DO UPDATE SET entitlement=CASE WHEN leave_balances.used=0 AND leave_balances.pending=0 THEN excluded.entitlement ELSE leave_balances.entitlement END")
    .bind(employee.id,leaveType.id,year,entitlement).run();
  const balance=await db.prepare("SELECT * FROM leave_balances WHERE employee_id=? AND leave_type_id=? AND year=? FOR UPDATE").bind(employee.id,leaveType.id,year).first<LeaveBalance>();
  if(!balance) response("Unable to initialize leave balance",500);
  return balance;
}

async function holidaysFor(db:Db,country:string){
  const rows=(await db.prepare("SELECT holiday_date,country,recurrence_type,status FROM holidays WHERE status='active' AND country IN (?, 'Both', 'KSA & Egypt')").bind(country).all()).results as Row[];
  return rows.map(row=>({holidayDate:String(row.holiday_date),country:String(row.country),recurrenceType:String(row.recurrence_type||"once"),status:String(row.status||"active")} satisfies LeaveHoliday));
}

export async function initializeCurrentLeaveBalances(db:PostgresDatabase,employeeIds:number[],year:number){
  if(!employeeIds.length)return;
  const placeholders=employeeIds.map(()=>"?").join(",");
  await db.prepare(`WITH ranked AS (
      SELECT e.id AS employee_id,lt.id AS leave_type_id,lp.annual_entitlement,
        ROW_NUMBER() OVER (PARTITION BY e.id,lt.id ORDER BY CASE WHEN lp.country=e.country THEN 0 ELSE 1 END,lp.id DESC) AS rank
      FROM employees e
      JOIN employee_leave_types elt ON elt.employee_id=e.id
      JOIN leave_types lt ON lt.id=elt.leave_type_id AND lt.status='active' AND lt.code<>'OFFICIAL'
      JOIN leave_policies lp ON lp.leave_type_id=lt.id AND lp.status='active' AND lp.country IN (e.country,'Both','KSA & Egypt')
      WHERE e.id IN (${placeholders}) AND e.employment_status IN ('active','probation','notice_period')
        AND (EXTRACT(YEAR FROM AGE(make_date(?,12,31),e.start_date::date))*12+EXTRACT(MONTH FROM AGE(make_date(?,12,31),e.start_date::date)))>=COALESCE(lp.min_service_months,0)
    )
    INSERT INTO leave_balances (employee_id,leave_type_id,year,entitlement,used,pending)
    SELECT employee_id,leave_type_id,?,annual_entitlement,0,0 FROM ranked WHERE rank=1
    ON CONFLICT(employee_id,leave_type_id,year) DO NOTHING`).bind(...employeeIds,year,year,year).run();
}

export async function createLeaveRequest(input:{db:PostgresDatabase;request:Request;actor:LeaveActor;employeeId:number;leaveTypeId:number;fromDate:string;toDate:string;reason:string;notes?:string;attachmentName?:string|null}){
  const year=Number(input.fromDate.slice(0,4));
  if(input.fromDate.slice(0,4)!==input.toDate.slice(0,4)) response("Leave requests must stay within one calendar year",400);
  return input.db.transaction(async tx=>{
    await tx.prepare("SELECT pg_advisory_xact_lock(?,?)").bind(input.employeeId,year).run();
    const employee=await tx.prepare("SELECT id,country,start_date,employment_status,work_days FROM employees WHERE id=? FOR UPDATE").bind(input.employeeId).first<Employee>();
    if(!employee||!["active","probation","notice_period"].includes(employee.employment_status)) response("Employee is not active",409);
    const leaveType=await tx.prepare("SELECT * FROM leave_types WHERE id=? AND status='active'").bind(input.leaveTypeId).first<LeaveType>();
    if(!leaveType) response("Leave type is not active",404);
    if(leaveType.code==="OFFICIAL") response("Official holidays cannot be requested as employee leave",400);
    const assignment=await tx.prepare("SELECT id FROM employee_leave_types WHERE employee_id=? AND leave_type_id=?").bind(employee.id,leaveType.id).first<{id:number}>();
    if(!assignment) response("This leave type is not assigned to your employee profile",403);
    if(leaveType.attachment_required&& !input.attachmentName) response("Supporting documentation is required for this leave type; file upload is not available yet. Please contact HR.",409);
    const policy=await resolvePolicy(tx,leaveType.id,employee.country);
    if(!policy&&leaveType.paid) response("No active leave policy applies to this employee and leave type",409);
    const duration=calculateLeaveDuration({fromDate:input.fromDate,toDate:input.toDate,workDays:employee.work_days,holidays:await holidaysFor(tx,employee.country),country:employee.country});
    if(duration.chargeableDays<=0) response("The selected period contains no chargeable working days",409);
    const overlap=await tx.prepare("SELECT id,request_code FROM requests WHERE employee_id=? AND from_date<=? AND to_date>=? AND status IN ('pending_manager','pending_hr','hr_approved') AND (leave_type_id IS NOT NULL OR type ILIKE '%leave%') LIMIT 1")
      .bind(employee.id,input.toDate,input.fromDate).first<{id:number;request_code:string}>();
    if(overlap) response(`The selected dates overlap with request ${overlap.request_code}`,409);

    const balance=policy?await ensureBalance(tx,employee,leaveType,policy,year):null;
    const controlled=Boolean(balance&&Number(policy!.annual_entitlement)>0);
    if(controlled&&availableLeaveBalance(balance!)<duration.chargeableDays) response(`Insufficient leave balance. Available: ${availableLeaveBalance(balance!)} day(s)`,409);
    const managerApproval=Boolean(leaveType.manager_approval),hrApproval=Boolean(leaveType.hr_approval);
    const status=managerApproval?"pending_manager":hrApproval?"pending_hr":"hr_approved";
    const stage=managerApproval?"manager":hrApproval?"hr":"completed";
    const effect=controlled?(stage==="completed"?"consumed":"reserved"):"none";
    if(controlled){
      const update=stage==="completed"
        ? "UPDATE leave_balances SET used=used+? WHERE id=? AND entitlement-used-pending>=? RETURNING *"
        : "UPDATE leave_balances SET pending=pending+? WHERE id=? AND entitlement-used-pending>=? RETURNING *";
      const changed=await tx.prepare(update).bind(duration.chargeableDays,balance!.id,duration.chargeableDays).first<LeaveBalance>();
      if(!changed) response("Leave balance changed while this request was being submitted. Please try again.",409);
    }
    const sequence=await tx.prepare("SELECT nextval(pg_get_serial_sequence('requests','id'))::int AS id").first<{id:number}>();
    const id=Number(sequence!.id),code=`REQ-${1000+id}`;
    const details={leave:{policyId:policy?.id??null,balanceId:balance?.id??null,leaveTypeId:leaveType.id,requestedDays:duration.chargeableDays,balanceYear:year,managerApproval,hrApproval,chargeableDates:duration.chargeableDates,excludedWeekends:duration.excludedWeekends,excludedHolidays:duration.excludedHolidays},attachmentName:input.attachmentName??null};
    await tx.prepare("INSERT INTO requests (id,request_code,employee_id,type,leave_type_id,requested_days,balance_year,balance_effect,from_date,to_date,reason,notes,details_json,status,current_stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
      .bind(id,code,employee.id,leaveType.name_en,leaveType.id,duration.chargeableDays,year,effect,input.fromDate,input.toDate,input.reason,input.notes||null,JSON.stringify(details),status,stage).run();
    await writeAudit(tx,{request:input.request,actor:input.actor,action:"leave_request_created",recordType:"request",recordId:String(id),next:{code,employeeId:employee.id,leaveTypeId:leaveType.id,days:duration.chargeableDays,status,stage}});
    if(effect!=="none")await writeAudit(tx,{request:input.request,actor:input.actor,action:effect==="reserved"?"leave_balance_reserved":"leave_balance_consumed",recordType:"leave_balance",recordId:String(balance!.id),next:{requestId:id,days:duration.chargeableDays}});
    return {ok:true,id,requestCode:code,requestedDays:duration.chargeableDays,status,currentStage:stage};
  });
}

export async function processLeaveRequest(input:{db:PostgresDatabase;request:Request;actor:LeaveActor;requestId:number;decision:"approve"|"reject";reason?:string}){
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

    const details=jsonObject(row.details_json),leave=jsonObject(JSON.stringify(details.leave??{}));
    const managerApproval=Boolean(leave.managerApproval),hrApproval=Boolean(leave.hrApproval);
    const transition=decideLeaveTransition({status:String(row.status),stage,decision:input.decision,hrApproval});
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
    return {ok:true,status,currentStage,balanceEffect:nextEffect};
  });
}

export async function cancelLeaveRequest(input:{db:PostgresDatabase;request:Request;actor:LeaveActor;requestId:number;reason?:string}){
  return input.db.transaction(async tx=>{
    await tx.prepare("SELECT pg_advisory_xact_lock(?,?)").bind(771,input.requestId).run();
    const row=await tx.prepare("SELECT * FROM requests WHERE id=? FOR UPDATE").bind(input.requestId).first<Row>();
    if(!row||!row.leave_type_id) response("Leave request not found",404);
    if(input.actor.roleName==="Employee"&&Number(row.employee_id)!==Number(input.actor.employeeId)) response("You can cancel only your own leave request",403);
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
    await tx.prepare("INSERT INTO approvals (request_id,stage,actor_user_id,action,reason,created_at) VALUES (?,'employee',?,'cancel',?,CURRENT_TIMESTAMP)").bind(input.requestId,input.actor.id,input.reason?.trim()||null).run();
    await writeAudit(tx,{request:input.request,actor:input.actor,action:"leave_cancelled",recordType:"request",recordId:String(input.requestId),previous:{status:row.status,balanceEffect:effect},next:{status:"cancelled",balanceEffect:"released",days}});
    if(effect!=="none")await writeAudit(tx,{request:input.request,actor:input.actor,action:"leave_balance_released",recordType:"leave_balance",recordId:String(balanceId),previous:{effect},next:{requestId:input.requestId,days,cancelled:true}});
    return {ok:true,status:"cancelled"};
  });
}
