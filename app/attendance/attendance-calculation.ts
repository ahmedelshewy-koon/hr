export type AttendanceExceptionType =
  | "missing_check_in" | "missing_check_out" | "late_arrival" | "early_departure"
  | "insufficient_hours" | "absent" | "attendance_conflict" | "approved_leave_conflict";

export type AttendanceCalculationInput = {
  scheduledIn?: string | null; scheduledOut?: string | null;
  actualIn?: string | null; actualOut?: string | null;
  requiredMinutes?: number | null; graceMinutes?: number | null;
  attendanceType?: string | null; isWorkingDay?: boolean;
  isHoliday?: boolean; isApprovedLeave?: boolean; dayComplete?: boolean;
  /** false = employee is not required to punch; a working day counts as attended with no late/absence. */
  fingerprintRequired?: boolean;
};

export type AttendanceCalculation = {
  workedMinutes: number; lateMinutes: number; earlyMinutes: number; overtimeMinutes: number;
  status: string; attendanceType: string; exceptions: AttendanceExceptionType[];
};

const validTime = (value: string | null | undefined) => !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const minutes = (value: string) => Number(value.slice(0,2)) * 60 + Number(value.slice(3,5));

/** Authoritative daily calculation. Times are company-local HH:mm values. */
export function calculateDailyAttendance(input: AttendanceCalculationInput): AttendanceCalculation {
  for (const value of [input.scheduledIn,input.scheduledOut,input.actualIn,input.actualOut]) {
    if (!validTime(value)) throw new Error("Attendance times must use HH:mm");
  }
  const required=Math.max(0,Number(input.requiredMinutes)||0),grace=Math.max(0,Number(input.graceMinutes)||0);
  const type=input.attendanceType||"office", exceptions:AttendanceExceptionType[]=[];
  if(input.isHoliday)return {workedMinutes:0,lateMinutes:0,earlyMinutes:0,overtimeMinutes:0,status:"holiday",attendanceType:"holiday",exceptions};
  if(input.isApprovedLeave){
    if(input.actualIn||input.actualOut)exceptions.push("approved_leave_conflict");
    return {workedMinutes:0,lateMinutes:0,earlyMinutes:0,overtimeMinutes:0,status:"leave",attendanceType:"leave",exceptions};
  }
  if(input.isWorkingDay===false)return {workedMinutes:0,lateMinutes:0,earlyMinutes:0,overtimeMinutes:0,status:"non_working_day",attendanceType:type,exceptions};
  if(input.fingerprintRequired===false)return {workedMinutes:required,lateMinutes:0,earlyMinutes:0,overtimeMinutes:0,status:type==="remote"?"remote":"present",attendanceType:type,exceptions};
  if(!input.actualIn){
    if(input.actualOut)exceptions.push("attendance_conflict");
    if(input.dayComplete!==false)exceptions.push("missing_check_in","absent");
    return {workedMinutes:0,lateMinutes:0,earlyMinutes:0,overtimeMinutes:0,status:input.dayComplete===false?"scheduled":"absent",attendanceType:type,exceptions};
  }
  if(!input.actualOut&&input.dayComplete!==false)exceptions.push("missing_check_out");
  let worked=0;
  if(input.actualOut){
    const start=minutes(input.actualIn),rawEnd=minutes(input.actualOut);
    const end=rawEnd<start?rawEnd+1440:rawEnd;
    worked=Math.max(0,end-start);
  }
  const scheduledIn=input.scheduledIn?minutes(input.scheduledIn):null;
  const scheduledOut=input.scheduledOut?minutes(input.scheduledOut):null;
  const late=scheduledIn===null?0:Math.max(0,minutes(input.actualIn)-scheduledIn-grace);
  let early=0;
  // While the day is open the latest punch is not a checkout yet (door punches), so only a closed day can end early.
  if(input.actualOut&&scheduledOut!==null&&input.dayComplete!==false){
    const scheduledEnd=scheduledIn!==null&&scheduledOut<=scheduledIn?scheduledOut+1440:scheduledOut;
    const actualEnd=minutes(input.actualOut)<minutes(input.actualIn)?minutes(input.actualOut)+1440:minutes(input.actualOut);
    early=Math.max(0,scheduledEnd-actualEnd);
  }
  if(late>0)exceptions.push("late_arrival");
  if(early>0)exceptions.push("early_departure");
  if(input.actualOut&&required>0&&worked<required&&input.dayComplete!==false)exceptions.push("insufficient_hours");
  const overtime=Math.max(0,worked-required);
  const status=!input.actualOut?"needs_review":late>0?"late":type==="remote"?"remote":"present";
  return {workedMinutes:worked,lateMinutes:late,earlyMinutes:early,overtimeMinutes:overtime,status,attendanceType:type,exceptions:[...new Set(exceptions)]};
}

export function isScheduledWorkDay(workDate:string,workDays:string|null|undefined){
  const date=new Date(`${workDate}T12:00:00Z`);
  if(Number.isNaN(date.getTime()))throw new Error("Invalid attendance date");
  return String(workDays||"0,1,2,3,4").split(",").map(Number).includes(date.getUTCDay());
}

/** Keeps only valid weekdays (0–6) that are also working days, sorted, e.g. "4,2,9" with work days "0,1,2,3,4" → "2,4". */
export function normalizeRemoteDays(remoteDays:unknown,workDays:string|null|undefined){
  const working=new Set(String(workDays||"0,1,2,3,4").split(",").filter(Boolean));
  return [...new Set(String(remoteDays??"").split(",").map(value=>value.trim()).filter(value=>/^[0-6]$/.test(value)&&working.has(value)))].sort().join(",");
}

/** The work mode an employee's schedule expects on a date: "remote" on their remote weekdays, otherwise "office". */
export function scheduledWorkMode(workDate:string,remoteDays:string|null|undefined):"office"|"remote"{
  const date=new Date(`${workDate}T12:00:00Z`);
  if(Number.isNaN(date.getTime()))throw new Error("Invalid attendance date");
  return String(remoteDays||"").split(",").includes(String(date.getUTCDay()))?"remote":"office";
}

/** An employee who punches on a device checks in remotely only on their remote weekdays or a rest day; office days come from the device. */
export function remoteCheckInAllowed(input:{workDate:string;workDays:string|null|undefined;remoteDays:string|null|undefined;punchesOnDevice:boolean}){
  if(!input.punchesOnDevice||!isScheduledWorkDay(input.workDate,input.workDays))return true;
  return scheduledWorkMode(input.workDate,input.remoteDays)==="remote";
}
