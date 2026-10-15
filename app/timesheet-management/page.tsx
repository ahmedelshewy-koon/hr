import { HRApp } from "../hr-app";

/** /timesheet-management opens the Attendance page on its Timesheet tab. */
export default function TimesheetManagementRoute() {
  return <HRApp initialPage="attendance" />;
}
