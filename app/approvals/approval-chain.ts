import type { WorkflowRun } from './workflow-policy';
type Row = Record<string, unknown>;

export type ApprovalStepState = "approved" | "rejected" | "pending" | "upcoming" | "stopped";
export type ApprovalStep = { stage: "manager" | "hr" | `workflow:${number}`; state: ApprovalStepState; name: string | null; nameAr: string | null; at: unknown; reason: string | null };

/** Manager then HR, each with the person who decided or the person it is waiting on. */
export function buildApprovalChain(request: Row, history: Row[]): ApprovalStep[] {
  const workflow=request.approval_workflow as WorkflowRun|undefined;
  if(workflow)return workflow.steps.map((step,index)=>({stage:`workflow:${index}`,state:step.decision==='approve'?'approved':step.decision==='reject'?'rejected':workflow.state!=='pending'?'stopped':index===workflow.currentStep?'pending':'upcoming',name:step.name,nameAr:step.nameAr,at:step.at||null,reason:step.reason||null}));
  const status = String(request.status ?? "");
  const decided = (stage: string) => history.filter(action => String(action.stage) === stage && ["approve", "reject"].includes(String(action.action))).at(-1);
  const step = (stage: "manager" | "hr", waitingState: ApprovalStepState | null): ApprovalStep => {
    const action = decided(stage);
    if (action) return { stage, state: action.action === "approve" ? "approved" : "rejected", name: (action.actor_name || action.actor_email || null) as string | null, nameAr: (action.actor_name_ar || action.actor_name || action.actor_email || null) as string | null, at: action.created_at, reason: (action.reason as string) || null };
    const pendingName = (stage === "manager" ? request.pending_manager_name : request.pending_hr_name) as string | null ?? null;
    const pendingNameAr = (stage === "manager" ? request.pending_manager_name_ar : request.pending_hr_name_ar) as string | null ?? pendingName;
    if (waitingState) return { stage, state: waitingState, name: pendingName, nameAr: pendingNameAr, at: null, reason: null };
    return { stage, state: "stopped", name: null, nameAr: null, at: null, reason: null };
  };
  const managerRejected = status === "manager_rejected" || status === "rejected_manager";
  const finished = ["hr_approved", "approved", "hr_rejected", "rejected_hr"].includes(status);
  const manager = step("manager", status === "pending_manager" ? "pending" : null);
  // Requests that reached HR before actions were recorded still passed the manager stage.
  if (manager.state === "stopped" && (status === "pending_hr" || finished)) manager.state = "approved";
  const hr = step("hr", status === "pending_hr" ? "pending" : status === "pending_manager" ? "upcoming" : null);
  if (hr.state === "stopped" && finished) hr.state = status.includes("rejected") ? "rejected" : "approved";
  if (managerRejected && hr.state !== "rejected" && hr.state !== "approved") hr.state = "stopped";
  return [manager, hr];
}
