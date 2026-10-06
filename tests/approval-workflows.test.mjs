import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkflow, advanceWorkflow, workflowType } from '../app/approvals/workflow-policy.ts';
import { workflowStatusLabel, workflowStageLabel } from '../app/approvals/workflow-presentation.ts';

test('workflow presentation does not mislabel ordinary approvers as HR',()=>{
  assert.equal(workflowStatusLabel({approval_workflow:{},status:'pending_hr'},false),'Waiting for approval');
  assert.equal(workflowStatusLabel({approval_workflow:{},status:'hr_rejected'},false),'Rejected');
  assert.equal(workflowStatusLabel({status:'pending_hr'},false),null);
  assert.equal(workflowStageLabel('workflow:2',false),'Stage 3');
  assert.equal(workflowStatusLabel({approval_workflow:{},workflow_unavailable:true,status:'pending_hr'},false),'Approver unavailable — contact your administrator');
});

test('request types are stable and distinguish leave kinds', () => {
  assert.equal(workflowType('Annual leave', 4), 'leave:4');
  assert.equal(workflowType('Sick leave', 5), 'leave:5');
  assert.equal(workflowType('Expense reimbursement'), 'expense');
  assert.throws(() => workflowType('made up'));
});
test('validate ordered steps and reject empty, duplicate or invalid approvers', () => {
  const value = { companyId: 2, requestType: 'expense', version: 0, active: true, steps: [{kind:'user',userId:3},{kind:'manager'}] };
  assert.equal(validateWorkflow(value).steps.length, 2);
  assert.throws(() => validateWorkflow({...value,steps:[]}));
  assert.throws(() => validateWorkflow({...value,steps:[{kind:'user',userId:3},{kind:'user',userId:3}]}));
  assert.throws(() => validateWorkflow({...value,steps:[{kind:'user',userId:-2}]}));
  assert.throws(() => validateWorkflow({...value,requestType:'unknown'}));
  assert.throws(() => validateWorkflow({...value,companyId:0}));
});
const snapshot=()=>({currentStep:0,state:'pending',steps:[{userId:10,name:'A',nameAr:'أ'},{userId:20,name:'B',nameAr:'ب'},{userId:30,name:'C',nameAr:'ج'}]});
test('three approvals advance in order and complete only after the last', () => {
  const original=snapshot();
  let run=advanceWorkflow(original,10,'workflow:0','approve','');
  assert.equal(run.state,'pending'); assert.equal(run.currentStep,1);
  assert.equal(original.steps[0].decision,undefined,'input snapshot must remain unchanged');
  run=advanceWorkflow(run,20,'workflow:1','approve','');
  assert.equal(run.state,'pending');
  run=advanceWorkflow(run,30,'workflow:2','approve','');
  assert.equal(run.state,'approved');
  assert.throws(()=>advanceWorkflow(run,30,'workflow:2','approve',''));
});
test('out of order and stale decisions fail; rejection stops the chain', () => {
  assert.throws(()=>advanceWorkflow(snapshot(),20,'workflow:0','approve',''));
  assert.throws(()=>advanceWorkflow(snapshot(),10,'workflow:1','approve',''));
  assert.throws(()=>advanceWorkflow(snapshot(),10,'workflow:0','reject',''));
  const rejected=advanceWorkflow(snapshot(),10,'workflow:0','reject','Missing receipt');
  assert.equal(rejected.state,'rejected');
  assert.equal(rejected.steps[0].reason,'Missing receipt');
  assert.throws(()=>advanceWorkflow(rejected,20,'workflow:1','approve',''));
});
test('one-step approval finishes and cancellation cannot be approved', () => {
  assert.equal(advanceWorkflow({...snapshot(),steps:[snapshot().steps[0]]},10,'workflow:0','approve','').state,'approved');
  assert.throws(()=>advanceWorkflow({...snapshot(),state:'cancelled'},10,'workflow:0','approve',''));
});
