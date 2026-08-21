import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isApprovalActionable, routeApprovalAction, statusCategory, unifiedStatus } from "../app/approvals/approval-presentation.ts";

test("maps raw domain statuses into presentation categories without changing them",()=>{
  assert.equal(unifiedStatus("pending_manager"),"waiting_manager");assert.equal(unifiedStatus("pending_hr"),"waiting_hr");
  assert.equal(unifiedStatus("hr_approved"),"approved");assert.equal(unifiedStatus("resolved"),"approved");assert.equal(unifiedStatus("rejected_hr"),"rejected");
  assert.equal(statusCategory("pending_manager",true),"needs_my_approval");assert.equal(statusCategory("pending_hr",false),"waiting");
});

test("manager can act only on manager-stage requests",()=>{
  assert.equal(isApprovalActionable({roleName:"Department Manager",stage:"manager",status:"pending_manager",employeeId:2,actorEmployeeId:1}),true);
  assert.equal(isApprovalActionable({roleName:"Department Manager",stage:"hr",status:"pending_hr",employeeId:2,actorEmployeeId:1}),false);
});

test("HR and Super Admin actionability follows existing HR-stage semantics",()=>{
  assert.equal(isApprovalActionable({roleName:"HR Manager",stage:"hr",status:"pending_hr",employeeId:2,actorEmployeeId:1}),true);
  assert.equal(isApprovalActionable({roleName:"HR Manager",stage:"manager",status:"pending_manager",employeeId:2,actorEmployeeId:1}),false);
  assert.equal(isApprovalActionable({roleName:"Super Admin",stage:"hr",status:"pending_hr",employeeId:2,actorEmployeeId:null}),true);
});

test("employees and self approvals are never actionable",()=>{
  assert.equal(isApprovalActionable({roleName:"Employee",stage:"manager",status:"pending_manager",employeeId:2,actorEmployeeId:1}),false);
  assert.equal(isApprovalActionable({roleName:"Department Manager",stage:"manager",status:"pending_manager",employeeId:1,actorEmployeeId:1}),false);
});

test("routes decisions to existing domain actions",()=>{
  assert.equal(routeApprovalAction("employee_request"),"request_action");assert.equal(routeApprovalAction("attendance_correction"),"attendance_correction_action");
  assert.throws(()=>routeApprovalAction("payroll"),/Unsupported/);
});

test("aggregation endpoint is focused, recursively scoped, and excludes sensitive employee fields",async()=>{
  const [aggregation,endpoint,ui]=await Promise.all([readFile(new URL("../app/approvals/approval-aggregation.ts",import.meta.url),"utf8"),readFile(new URL("../app/api/approvals/route.ts",import.meta.url),"utf8"),readFile(new URL("../app/approvals-center.tsx",import.meta.url),"utf8")]);
  assert.match(aggregation,/WITH RECURSIVE managed/);assert.match(aggregation,/e\.department_id IN/);assert.match(endpoint,/Approval center access is restricted|aggregateApprovals/);
  assert.doesNotMatch(aggregation,/e\.salary|bank_account|identification_number/);assert.match(ui,/\/api\/approvals/);assert.match(ui,/attendance_correction_action/);assert.match(ui,/request_action/);
});

test("existing domain endpoints re-check scope, stage, self approval, and stale transitions",async()=>{
  const route=await readFile(new URL("../app/api/hr/route.ts",import.meta.url),"utf8");
  assert.match(route,/You cannot approve your own request/);assert.match(route,/You cannot approve your own attendance correction/);
  assert.match(route,/canAccessEmployee\(d1,user,Number\(before\.employee_id\)\)/);assert.match(route,/canAccessEmployee\(d1,user,Number\(correction\.employee_id\)\)/);
  assert.match(route,/SELECT pg_advisory_xact_lock\(\?\)/);assert.match(route,/WHERE id=\? AND status=\? AND current_stage=\? RETURNING id/);
});
