"use client";

import { Check, Clock3, Minus, UserRound, X } from "lucide-react";
import { buildApprovalChain, type ApprovalStep } from "./approvals/approval-chain";
import type { Row } from "./ui-types";
import "./approval-chain.css";

const stageLabel = (stage: ApprovalStep["stage"], rtl: boolean) => stage.startsWith('workflow:')?(rtl?`المرحلة ${Number(stage.split(':')[1])+1}`:`Stage ${Number(stage.split(':')[1])+1}`):stage === "manager" ? (rtl ? "مدير القسم" : "Department manager") : (rtl ? "الموارد البشرية" : "HR");
const stateLabel: Record<ApprovalStep["state"], [string, string]> = { approved: ["Approved", "اعتمد"], rejected: ["Rejected", "رفض"], pending: ["Waiting for approval", "بانتظار اعتماده"], upcoming: ["Waiting for previous stage", "بعد المرحلة السابقة"], stopped: ["Not required", "لم يعد مطلوبًا"] };
const missingLabel = (stage: ApprovalStep["stage"], rtl: boolean) => stage === "manager" ? (rtl ? "لم يتم تحديد مدير للموظف" : "No manager assigned") : (rtl ? "لم يتم تعيين مسؤول موارد بشرية" : "No HR responsible assigned");
const stepName = (step: ApprovalStep, rtl: boolean) => (rtl ? step.nameAr || step.name : step.name || step.nameAr) || "";
const when = (value: unknown, rtl: boolean) => new Intl.DateTimeFormat(rtl ? "ar-SA-u-nu-arab" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(String(value)));
const icon = { approved: <Check />, rejected: <X />, pending: <Clock3 />, upcoming: <UserRound />, stopped: <Minus /> };

/** Manager then HR: who approved or rejected, and who the request is still waiting on. */
export function ApprovalChain({ rtl, request, history }: { rtl: boolean; request: Row; history: Row[] }) {
  const steps = buildApprovalChain(request, history);
  return <ol className="approval-chain" aria-label={rtl ? "مسار الاعتماد" : "Approval chain"}>{steps.map(step => {
    const name = stepName(step, rtl), waiting = step.state === "pending" || step.state === "upcoming";
    return <li key={step.stage} className={`approval-chain-step ${step.state}`}>
      <span className="approval-chain-icon">{icon[step.state]}</span>
      <div>
        <small>{stageLabel(step.stage, rtl)}</small>
        <b>{name || (waiting ? missingLabel(step.stage, rtl) : "—")}</b>
        {step.state==='pending'&&request.workflow_unavailable&&<span role="status">{rtl?'الموافق غير متاح — تواصل مع مسؤول النظام':'Approver unavailable — contact your administrator'}</span>}
        <span className="approval-chain-state">{stateLabel[step.state][rtl ? 1 : 0]}{step.at ? ` · ${when(step.at, rtl)}` : ""}</span>
        {step.reason && <p>{rtl ? "السبب: " : "Reason: "}{step.reason}</p>}
      </div>
    </li>;
  })}</ol>;
}

/** One line for lists: the person the request is waiting on now. */
export function approvalWaitingOn(request: Row, history: Row[], rtl: boolean): string {
  const step = buildApprovalChain(request, history).find(item => item.state === "pending");
  if (!step) return "";
  const name = stepName(step, rtl) || missingLabel(step.stage, rtl);
  return rtl ? `بانتظار: ${name} (${stageLabel(step.stage, rtl)})` : `Waiting on: ${name} (${stageLabel(step.stage, rtl)})`;
}
