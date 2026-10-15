import test from "node:test";
import assert from "node:assert/strict";
import { savedAttendanceSnapshot } from "../app/attendance/saved-attendance.ts";

test("saved attendance captures the reviewed Timesheet facts and notification state", () => {
  const snapshot=savedAttendanceSnapshot({
    employee_id:4,employee_code:"E-4",work_date:"2026-10-13",actual_start:"09:15",actual_end:"17:00",
    scheduled_start:"09:00",scheduled_end:"17:00",total_work_minutes:465,status:"approved",
    absence_has_notice:null,deduction_rule_id:9,deduction_amount:50,deduction_notification_sent:1,
    label_en:"",label_ar:"",
  },"B-1");
  assert.equal(snapshot.employeeCode,"E-4");
  assert.equal(snapshot.differenceMinutes,-15);
  assert.equal(snapshot.absenceHasNotice,null);
  assert.equal(snapshot.deductionNotificationSent,1);
  assert.equal(snapshot.batchId,"B-1");
});
