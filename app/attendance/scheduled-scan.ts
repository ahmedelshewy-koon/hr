import type { PostgresDatabase } from "../../db/postgres";
import { recalculateAttendance } from "./attendance-service";
import { completedBusinessDate } from "./scheduled-scan-policy";
export async function runScheduledAttendanceScan(db:PostgresDatabase,input:{timeZone:string;attendanceDate?:string;actorUserId?:number|null}){
  const date=input.attendanceDate||completedBusinessDate(input.timeZone);if(date>=new Date().toISOString().slice(0,10))throw new Response("Only completed business days can be scanned",{status:400});
  const employees=(await db.prepare("SELECT id FROM employees WHERE employment_status IN ('active','probation','notice_period') ORDER BY id").all<{id:number}>()).results;
  for(const employee of employees)await recalculateAttendance(db,Number(employee.id),date);
  await db.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,new_value,created_at) VALUES (?,'scheduled_exception_scan','attendance_adjustments','attendance_date',?,?,CURRENT_TIMESTAMP)").bind(input.actorUserId??null,date,JSON.stringify({employees:employees.length,timeZone:input.timeZone})).run();
  return {ok:true,date,count:employees.length,timeZone:input.timeZone};
}
