import { spanMinutes } from "../timesheet/time.ts";

type Row = Record<string, unknown>;
const number = (value: unknown) => Number(value) || 0;
const value = (entry: unknown) => entry == null ? null : String(entry);

/** Snapshot a reviewed Timesheet row without recalculating or changing its money. */
export function savedAttendanceSnapshot(row: Row, batchId: string) {
  const scheduledStart=value(row.scheduled_start),scheduledEnd=value(row.scheduled_end);
  const expectedMinutes=scheduledStart&&scheduledEnd?spanMinutes(scheduledStart,scheduledEnd)-number(row.break_duration_minutes):0;
  const workMinutes=number(row.total_work_minutes);
  return {
    employeeId:number(row.employee_id),employeeCode:String(row.employee_code??""),
    workDate:String(row.work_date??""),checkIn:value(row.actual_start),checkOut:value(row.actual_end),
    workMinutes,expectedMinutes,differenceMinutes:workMinutes-expectedMinutes,
    status:String(row.status??""),vacationType:value(row.label_en),
    deductionRuleId:row.deduction_rule_id == null?null:number(row.deduction_rule_id),
    deductionAmount:number(row.deduction_amount),
    absenceHasNotice:row.absence_has_notice == null?null:number(row.absence_has_notice),
    isConfirmed:1,batchId,
    entryNotificationSent:number(row.entry_notification_sent),exitNotificationSent:number(row.exit_notification_sent),
    deductionNotificationSent:number(row.deduction_notification_sent),
  };
}
