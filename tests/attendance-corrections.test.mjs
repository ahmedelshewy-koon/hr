import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateDailyAttendance, isScheduledWorkDay } from "../app/attendance/attendance-calculation.ts";
import { correctionFields, decideCorrectionTransition } from "../app/attendance/attendance-workflow.ts";

test("calculates worked, grace-adjusted late, early and insufficient minutes",()=>{
  const result=calculateDailyAttendance({scheduledIn:"09:00",scheduledOut:"17:00",actualIn:"09:17",actualOut:"16:25",requiredMinutes:480,graceMinutes:10,isWorkingDay:true,dayComplete:true});
  assert.equal(result.workedMinutes,428);assert.equal(result.lateMinutes,7);assert.equal(result.earlyMinutes,35);
  assert.deepEqual(result.exceptions,["late_arrival","early_departure","insufficient_hours"]);
});

test("detects missing checkout only after day completion",()=>{
  assert.deepEqual(calculateDailyAttendance({actualIn:"09:00",dayComplete:true,isWorkingDay:true}).exceptions,["missing_check_out"]);
  assert.deepEqual(calculateDailyAttendance({actualIn:"09:00",dayComplete:false,isWorkingDay:true}).exceptions,[]);
});

test("detects missing check-in and absence only on a completed working day",()=>{
  const result=calculateDailyAttendance({isWorkingDay:true,dayComplete:true});
  assert.equal(result.status,"absent");assert.deepEqual(result.exceptions,["missing_check_in","absent"]);
});

test("excludes holidays, approved leave, and non-working days from absence",()=>{
  assert.equal(calculateDailyAttendance({isWorkingDay:true,isHoliday:true,dayComplete:true}).status,"holiday");
  assert.equal(calculateDailyAttendance({isWorkingDay:true,isApprovedLeave:true,dayComplete:true}).status,"leave");
  assert.equal(calculateDailyAttendance({isWorkingDay:false,dayComplete:true}).status,"non_working_day");
  assert.deepEqual(calculateDailyAttendance({isWorkingDay:false,dayComplete:true}).exceptions,[]);
});

test("flags attendance recorded during approved leave as a conflict",()=>{
  assert.deepEqual(calculateDailyAttendance({isApprovedLeave:true,actualIn:"09:00",actualOut:"17:00"}).exceptions,["approved_leave_conflict"]);
});

test("supports an overnight shift without negative worked minutes",()=>{
  const result=calculateDailyAttendance({scheduledIn:"22:00",scheduledOut:"06:00",actualIn:"22:05",actualOut:"06:10",requiredMinutes:480,graceMinutes:10,isWorkingDay:true,dayComplete:true});
  assert.equal(result.workedMinutes,485);assert.equal(result.lateMinutes,0);assert.equal(result.earlyMinutes,0);
});

test("maps four time-changing correction types and keeps justifications time-neutral",()=>{
  assert.deepEqual(correctionFields("forgot_check_in"),["actual_in"]);assert.deepEqual(correctionFields("wrong_check_in"),["actual_in"]);
  assert.deepEqual(correctionFields("forgot_check_out"),["actual_out"]);assert.deepEqual(correctionFields("wrong_check_out"),["actual_out"]);
  assert.deepEqual(correctionFields("late_justification"),[]);assert.deepEqual(correctionFields("early_departure_justification"),[]);
});

test("moves manager approval to HR and final HR approval to resolved",()=>{
  assert.deepEqual(decideCorrectionTransition({status:"pending_manager",stage:"manager",decision:"approve"}),{status:"pending_hr",currentStage:"hr",apply:false});
  assert.deepEqual(decideCorrectionTransition({status:"pending_hr",stage:"hr",decision:"approve"}),{status:"resolved",currentStage:"completed",apply:true});
});

test("supports manager and HR rejection terminal states",()=>{
  assert.deepEqual(decideCorrectionTransition({status:"pending_manager",stage:"manager",decision:"reject"}),{status:"rejected_manager",currentStage:"completed",apply:false});
  assert.deepEqual(decideCorrectionTransition({status:"pending_hr",stage:"hr",decision:"reject"}),{status:"rejected_hr",currentStage:"completed",apply:false});
});

test("blocks duplicate approvals and rejections",()=>{
  assert.throws(()=>decideCorrectionTransition({status:"pending_hr",stage:"manager",decision:"approve"}),/already been processed/);
  assert.throws(()=>decideCorrectionTransition({status:"resolved",stage:"completed",decision:"reject"}),/finalized/);
});

test("recognizes configured working days",()=>{assert.equal(isScheduledWorkDay("2026-08-23","0,1,2,3,4"),true);assert.equal(isScheduledWorkDay("2026-08-22","0,1,2,3,4"),false);});

test("persistence is transactional, guarded, scoped, audited, and never updates raw events",async()=>{
  const [service,route]=await Promise.all([readFile(new URL("../app/attendance/attendance-service.ts",import.meta.url),"utf8"),readFile(new URL("../app/api/hr/route.ts",import.meta.url),"utf8")]);
  assert.match(service,/\.transaction\(async tx/);assert.match(service,/pg_advisory_xact_lock/);assert.match(service,/WHERE id=\? AND status=\? AND current_stage=\?/);
  assert.match(service,/correction_requested/);assert.match(service,/manual_correction/);assert.match(service,/attendance_recalculated/);
  assert.doesNotMatch(service,/UPDATE attendance_logs/);assert.match(route,/assertEmployeeManager\(d1,Number\(correction\.employee_id\),user\.employee_id\)/);
  assert.match(route,/You cannot approve your own attendance correction/);assert.match(route,/Duplicate \$\{eventType\} is not allowed/);assert.match(route,/There is no check-in recorded for today/);
});
