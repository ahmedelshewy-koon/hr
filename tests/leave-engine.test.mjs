import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { availableLeaveBalance, calculateLeaveDuration, completedServiceMonths } from "../app/leave/leave-calculation.ts";
import { decideLeaveTransition } from "../app/leave/leave-workflow.ts";
import { LEAVE_REPORT_CATEGORY, leaveRequiresReport } from "../app/leave/leave-report-policy.ts";

test("calculates one working leave day",()=>{
  const result=calculateLeaveDuration({fromDate:"2026-08-23",toDate:"2026-08-23",workDays:"0,1,2,3,4",country:"Egypt"});
  assert.equal(result.chargeableDays,1);
  assert.deepEqual(result.chargeableDates,["2026-08-23"]);
});

test("excludes weekends from a multi-day request",()=>{
  const result=calculateLeaveDuration({fromDate:"2026-08-20",toDate:"2026-08-24",workDays:"0,1,2,3,4",country:"Egypt"});
  assert.equal(result.chargeableDays,3);
  assert.deepEqual(result.excludedWeekends,["2026-08-21","2026-08-22"]);
});

test("excludes applicable one-time and annual holidays",()=>{
  const result=calculateLeaveDuration({fromDate:"2026-08-23",toDate:"2026-08-27",workDays:"0,1,2,3,4",country:"Egypt",holidays:[{holidayDate:"2026-08-25",country:"Egypt",recurrenceType:"once",status:"active"},{holidayDate:"2024-08-26",country:"Both",recurrenceType:"annual",status:"active"}]});
  assert.equal(result.chargeableDays,3);
  assert.deepEqual(result.excludedHolidays,["2026-08-25","2026-08-26"]);
});

test("honors a different employee schedule",()=>{
  const result=calculateLeaveDuration({fromDate:"2026-08-21",toDate:"2026-08-23",workDays:"5,6",country:"Saudi Arabia"});
  assert.equal(result.chargeableDays,2);
  assert.deepEqual(result.excludedWeekends,["2026-08-23"]);
});

test("calculates completed service months and available balance",()=>{
  assert.equal(completedServiceMonths("2026-01-15","2026-08-14"),6);
  assert.equal(completedServiceMonths("2026-01-15","2026-08-15"),7);
  assert.equal(availableLeaveBalance({entitlement:21,used:5,pending:3}),13);
  assert.equal(availableLeaveBalance({entitlement:5,used:5,pending:2}),0);
});

test("moves manager approval to HR without consuming twice",()=>{
  assert.deepEqual(decideLeaveTransition({status:"pending_manager",stage:"manager",decision:"approve",hrApproval:true}),{status:"pending_hr",currentStage:"hr",balanceAction:"none"});
  assert.deepEqual(decideLeaveTransition({status:"pending_hr",stage:"hr",decision:"approve",hrApproval:true}),{status:"hr_approved",currentStage:"completed",balanceAction:"consume"});
});

test("rejection releases reservation and repeated processing is blocked",()=>{
  assert.deepEqual(decideLeaveTransition({status:"pending_manager",stage:"manager",decision:"reject",hrApproval:true}),{status:"manager_rejected",currentStage:"completed",balanceAction:"release"});
  assert.deepEqual(decideLeaveTransition({status:"pending_hr",stage:"hr",decision:"reject",hrApproval:true}),{status:"hr_rejected",currentStage:"completed",balanceAction:"release"});
  assert.throws(()=>decideLeaveTransition({status:"hr_approved",stage:"completed",decision:"approve",hrApproval:true}),/already been processed/);
});

test("leave persistence uses transactions, locks, guarded balance updates, scope and audits",async()=>{
  const [service,route]=await Promise.all([readFile(new URL("../app/leave/leave-service.ts",import.meta.url),"utf8"),readFile(new URL("../app/api/hr/route.ts",import.meta.url),"utf8")]);
  assert.match(service,/\.transaction\(async tx/);
  assert.match(service,/pg_advisory_xact_lock/);
  assert.match(service,/entitlement-used-pending>=\?/);
  assert.match(service,/pending>=\?/);
  assert.match(service,/leave_balance_reserved/);
  assert.match(service,/leave_balance_consumed/);
  assert.match(service,/leave_balance_released/);
  assert.match(route,/assertEmployeeManager\(d1,Number\(before\.employee_id\),user\.employee_id\)/);
  assert.match(route,/You cannot approve your own request/);
});

test("sick leave requires a medical report while annual leave does not",()=>{
  assert.equal(leaveRequiresReport({code:"SICK",attachment_required:0}),true);
  assert.equal(leaveRequiresReport({code:"ANNUAL_KSA",attachment_required:0}),false);
  assert.equal(leaveRequiresReport({code:"UNPAID",attachment_required:1}),true);
  assert.equal(leaveRequiresReport(undefined),false);
  assert.equal(LEAVE_REPORT_CATEGORY,"medical_certificate");
});

test("leave submission links the uploaded report and the portal exposes annual and sick quick actions",async()=>{
  const read=file=>readFile(new URL(file,import.meta.url),"utf8");
  const [service,route,drawer,portal]=await Promise.all([read("../app/leave/leave-service.ts"),read("../app/api/hr/route.ts"),read("../app/employee-request-drawer.tsx"),read("../app/employee-portal-workspace.tsx")]);
  assert.match(service,/leaveRequiresReport\(leaveType\)&&!report/);
  assert.match(service,/employee_id=\? AND category=\? AND status='active'/);
  assert.match(route,/attachmentDocumentId:Number\(details\.attachmentDocumentId\)\|\|null/);
  assert.match(drawer,/fetch\("\/api\/documents",\{method:"POST"/);
  assert.match(drawer,/attachmentRequired&&!file/);
  assert.match(portal,/openRequest\("leave-kind:annual"\)/);
  assert.match(portal,/openRequest\("leave-kind:sick"\)/);
});
