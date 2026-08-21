export type UnifiedCategory="needs_my_approval"|"waiting"|"approved"|"rejected"|"completed";

export function statusCategory(status:string,actionable=false):UnifiedCategory{
  if(actionable)return "needs_my_approval";
  if(["pending_manager","pending_hr"].includes(status))return "waiting";
  if(["manager_rejected","hr_rejected","rejected_manager","rejected_hr","rejected"].includes(status))return "rejected";
  if(["hr_approved","approved","resolved"].includes(status))return "approved";
  return "completed";
}

export function unifiedStatus(status:string){
  if(status==="pending_manager")return "waiting_manager";
  if(status==="pending_hr")return "waiting_hr";
  if(["hr_approved","approved","resolved"].includes(status))return "approved";
  if(status.includes("rejected")||status==="rejected")return "rejected";
  return "completed";
}

export function routeApprovalAction(sourceType:string){
  if(sourceType==="attendance_correction")return "attendance_correction_action";
  if(sourceType==="employee_request")return "request_action";
  throw new Error("Unsupported approval source");
}

export function isApprovalActionable(input:{roleName:string;stage:string;status:string;employeeId:number;actorEmployeeId:number|null}){
  if(input.actorEmployeeId!==null&&Number(input.employeeId)===Number(input.actorEmployeeId))return false;
  if(input.roleName==="Department Manager")return input.stage==="manager"&&input.status==="pending_manager";
  if(["HR Manager","Super Admin"].includes(input.roleName))return input.stage==="hr"&&input.status==="pending_hr";
  return false;
}
