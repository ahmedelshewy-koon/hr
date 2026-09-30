import assert from "node:assert/strict";
import test from "node:test";
import { buildApprovalChain } from "../app/approvals/approval-chain.ts";

const names={pending_manager_name:"Mona Manager",pending_manager_name_ar:"منى المديرة",pending_hr_name:"Hany HR",pending_hr_name_ar:"هاني الموارد"};
const act=(stage,action,actor)=>({stage,action,actor_name:actor,actor_name_ar:actor,created_at:"2026-09-28T09:00:00Z",reason:action==="reject"?"No cover":null});
const summary=steps=>steps.map(step=>`${step.stage}:${step.state}:${step.name??"-"}`);

test("a new request waits on the manager, with HR named as the next approver",()=>{
  assert.deepEqual(summary(buildApprovalChain({status:"pending_manager",...names},[])),["manager:pending:Mona Manager","hr:upcoming:Hany HR"]);
});

test("after the manager approves, the manager's name is shown and HR is pending",()=>{
  assert.deepEqual(summary(buildApprovalChain({status:"pending_hr",...names},[act("manager","approve","Ali Actual")])),["manager:approved:Ali Actual","hr:pending:Hany HR"]);
});

test("final approval shows both people who approved",()=>{
  assert.deepEqual(summary(buildApprovalChain({status:"hr_approved",...names},[act("manager","approve","Ali Actual"),act("hr","approve","Heba Actual")])),["manager:approved:Ali Actual","hr:approved:Heba Actual"]);
});

test("a manager rejection stops the chain before HR",()=>{
  const steps=buildApprovalChain({status:"manager_rejected",...names},[act("manager","reject","Ali Actual")]);
  assert.deepEqual(summary(steps),["manager:rejected:Ali Actual","hr:stopped:-"]);
  assert.equal(steps[0].reason,"No cover");
});

test("a waiting step without a resolved approver has no name",()=>{
  assert.deepEqual(summary(buildApprovalChain({status:"pending_manager"},[])),["manager:pending:-","hr:upcoming:-"]);
});

test("a cancellation keeps recorded decisions and stops the rest",()=>{
  assert.deepEqual(summary(buildApprovalChain({status:"cancelled",...names},[act("manager","approve","Ali Actual"),{stage:"employee",action:"cancel"}])),["manager:approved:Ali Actual","hr:stopped:-"]);
});
