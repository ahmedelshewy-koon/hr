export type LeaveDecision = "approve" | "reject";

export function decideLeaveTransition(input:{status:string;stage:string;decision:LeaveDecision;hrApproval:boolean}){
  if(!["pending_manager","pending_hr"].includes(input.status))throw new Error("This leave request has already been processed");
  if(!["manager","hr"].includes(input.stage))throw new Error("Leave request is not at an approval stage");
  if(input.decision==="reject")return {status:input.stage==="manager"?"manager_rejected":"hr_rejected",currentStage:"completed",balanceAction:"release" as const};
  if(input.stage==="manager"&&input.hrApproval)return {status:"pending_hr",currentStage:"hr",balanceAction:"none" as const};
  return {status:"hr_approved",currentStage:"completed",balanceAction:"consume" as const};
}
