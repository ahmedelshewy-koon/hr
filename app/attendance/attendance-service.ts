import { requireEmployeeHr, assertEmployeeHr, assertEmployeeManager } from "../employees/hr-assignment.ts";
import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";
import { calculateDailyAttendance, isScheduledWorkDay } from "./attendance-calculation.ts";
import { CORRECTION_TYPES, correctionFields, decideCorrectionTransition, type CorrectionDecision, type CorrectionType } from "./attendance-workflow.ts";
import { isHolidayDate } from "../leave/holiday-calendar.ts";
import { loadCalendarHolidays } from "../leave/holiday-store.ts";

type DB=PostgresDatabase|TransactionDatabase;
type Actor={id:number;employeeId:number|null;roleName:string};
type Row=Record<string,unknown>;
const clean=(value:unknown,max=2000)=>typeof value==="string"?value.trim().slice(0,max):"";
const time=(value:unknown)=>{const result=clean(value,5);if(result&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(result))throw new Response("Corrected time must use HH:mm",{status:400});return result||null;};
const json=(value:unknown)=>{try{return JSON.parse(String(value||"{}")) as Row;}catch{return {};}};
const exceptionTypesForCorrection=(type:CorrectionType)=>type==="late_justification"?["late_arrival"]:type==="early_departure_justification"?["early_departure"]:(type==="forgot_check_in"||type==="wrong_check_in")?["missing_check_in","late_arrival","attendance_conflict"]:(type==="forgot_check_out"||type==="wrong_check_out")?["missing_check_out","early_departure","insufficient_hours"]:[];

async function writeAudit(db:DB,request:Request,actor:Actor,action:string,recordType:string,recordId:string,previous:unknown,next:unknown){
  await db.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,previous_value,new_value,ip_address,created_at) VALUES (?,?,'attendance_adjustments',?,?,?,?,?,CURRENT_TIMESTAMP)")
    .bind(actor.id,action,recordType,recordId,previous?JSON.stringify(previous):null,next?JSON.stringify(next):null,request.headers.get("cf-connecting-ip")).run();
}

async function attendanceContext(db:DB,employeeId:number,attendanceDate:string,overrides:Row={}){
  const employee=await db.prepare("SELECT id,work_days,check_in_time,check_out_time,grace_minutes,required_daily_minutes,country FROM employees WHERE id=? AND employment_status!='deleted'").bind(employeeId).first<Row>();
  if(!employee)throw new Response("Employee not found",{status:404});
  const record=await db.prepare("SELECT * FROM daily_attendance WHERE employee_id=? AND work_date=?").bind(employeeId,attendanceDate).first<Row>();
  const holiday=isHolidayDate(await loadCalendarHolidays(db,String(employee.country)),attendanceDate,String(employee.country));
  // Read-only integration with the existing leave engine: no balances or leave rows are changed here.
  const leave=await db.prepare("SELECT id FROM requests WHERE employee_id=? AND leave_type_id IS NOT NULL AND status='hr_approved' AND from_date<=? AND to_date>=? LIMIT 1").bind(employeeId,attendanceDate,attendanceDate).first<Row>();
  const actualIn=overrides.actual_in!==undefined?overrides.actual_in:record?.actual_in;
  const actualOut=overrides.actual_out!==undefined?overrides.actual_out:record?.actual_out;
  // "holiday" and "leave" are results of an earlier calculation, not a working mode to carry into the next one.
  const storedType=record?.attendance_type==="holiday"||record?.attendance_type==="leave"?null:record?.attendance_type;
  const attendanceType=String(overrides.attendance_type??storedType??"office");
  let dayComplete=typeof overrides.day_complete==="boolean"?overrides.day_complete:attendanceDate<new Date().toISOString().slice(0,10);
  // A fingerprint employee's day closes only after their device has synced past it; an offline device must not create early-departure/absence exceptions.
  if(dayComplete){
    const checkIn=String(record?.scheduled_in??employee.check_in_time??"09:00"),checkOut=String(record?.scheduled_out??employee.check_out_time??"17:00");
    const closesOn=checkOut<=checkIn?new Date(new Date(`${attendanceDate}T12:00:00Z`).getTime()+86400000).toISOString().slice(0,10):attendanceDate;
    const device=await db.prepare("SELECT count(*)::integer AS devices,max(to_char(d.last_sync_at AT TIME ZONE d.timezone,'YYYY-MM-DD HH24:MI')) AS synced_at FROM attendance_device_users du JOIN attendance_devices d ON d.id=du.device_id WHERE du.employee_id=? AND du.enabled=1 AND d.enabled=1").bind(employeeId).first<Row>();
    if(Number(device?.devices)>0&&(!device?.synced_at||String(device.synced_at)<`${closesOn} ${checkOut.slice(0,5)}`))dayComplete=false;
  }
  const calculation=calculateDailyAttendance({scheduledIn:String(record?.scheduled_in??employee.check_in_time??"09:00"),scheduledOut:String(record?.scheduled_out??employee.check_out_time??"17:00"),actualIn:actualIn?String(actualIn):null,actualOut:actualOut?String(actualOut):null,requiredMinutes:Number(record?.required_minutes??employee.required_daily_minutes??480),graceMinutes:Number(employee.grace_minutes??0),attendanceType,isWorkingDay:isScheduledWorkDay(attendanceDate,String(employee.work_days||"0,1,2,3,4")),isHoliday:holiday,isApprovedLeave:Boolean(leave),dayComplete});
  return {employee,record,calculation,actualIn,actualOut,attendanceType};
}

async function persistCalculation(db:DB,employeeId:number,attendanceDate:string,overrides:Row={}){
  const context=await attendanceContext(db,employeeId,attendanceDate,overrides),c=context.calculation;
  const scheduledIn=String(context.record?.scheduled_in??context.employee.check_in_time??"09:00"),scheduledOut=String(context.record?.scheduled_out??context.employee.check_out_time??"17:00");
  const row=await db.prepare("INSERT INTO daily_attendance (employee_id,work_date,scheduled_in,scheduled_out,actual_in,actual_out,worked_minutes,required_minutes,late_minutes,early_minutes,overtime_minutes,attendance_type,status,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(employee_id,work_date) DO UPDATE SET actual_in=excluded.actual_in,actual_out=excluded.actual_out,worked_minutes=excluded.worked_minutes,late_minutes=excluded.late_minutes,early_minutes=excluded.early_minutes,overtime_minutes=excluded.overtime_minutes,attendance_type=excluded.attendance_type,status=excluded.status,note=COALESCE(excluded.note,daily_attendance.note),updated_at=CURRENT_TIMESTAMP RETURNING *")
    .bind(employeeId,attendanceDate,scheduledIn,scheduledOut,context.actualIn??null,context.actualOut??null,c.workedMinutes,Number(context.record?.required_minutes??context.employee.required_daily_minutes??480),c.lateMinutes,c.earlyMinutes,c.overtimeMinutes,c.attendanceType,c.status,overrides.note??context.record?.note??null).first<Row>();
  for(const exceptionType of c.exceptions)await db.prepare("INSERT INTO attendance_exceptions (employee_id,daily_attendance_id,attendance_date,exception_type,status,details_json,created_at,updated_at) VALUES (?,?,?,?, 'open',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(employee_id,attendance_date,exception_type) DO UPDATE SET daily_attendance_id=excluded.daily_attendance_id,status=CASE WHEN attendance_exceptions.status='dismissed' THEN 'dismissed' ELSE 'open' END,details_json=excluded.details_json,resolved_at=NULL,updated_at=CURRENT_TIMESTAMP")
    .bind(employeeId,row?.id??null,attendanceDate,exceptionType,JSON.stringify({workedMinutes:c.workedMinutes,lateMinutes:c.lateMinutes,earlyMinutes:c.earlyMinutes})).run();
  if(c.exceptions.length)await db.prepare("UPDATE attendance_exceptions SET status='resolved',resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE employee_id=? AND attendance_date=? AND status IN ('open','correction_requested','pending_manager','pending_hr') AND exception_type NOT IN ("+c.exceptions.map(()=>"?").join(",")+")").bind(employeeId,attendanceDate,...c.exceptions).run();
  else await db.prepare("UPDATE attendance_exceptions SET status='resolved',resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE employee_id=? AND attendance_date=? AND status IN ('open','correction_requested','pending_manager','pending_hr')").bind(employeeId,attendanceDate).run();
  return {row,calculation:c,before:context.record};
}

export async function submitAttendanceCorrection(input:{db:PostgresDatabase;request:Request;actor:Actor;employeeId:number;attendanceDate:string;correctionType:string;requestedTime?:unknown;reason:unknown;notes?:unknown;windowDays:number}){
  const {db,request,actor,employeeId}=input,attendanceDate=clean(input.attendanceDate,10),type=input.correctionType as CorrectionType;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)||Number.isNaN(new Date(`${attendanceDate}T12:00:00Z`).getTime()))throw new Response("A valid attendance date is required",{status:400});
  const today=new Date().toISOString().slice(0,10);if(attendanceDate>today)throw new Response("Future attendance cannot be corrected",{status:400});
  if(!CORRECTION_TYPES.includes(type))throw new Response("Unsupported correction type",{status:400});
  if(input.windowDays>0){const earliest=new Date(Date.now()-input.windowDays*86400000).toISOString().slice(0,10);if(attendanceDate<earliest)throw new Response("Attendance date is outside the correction window",{status:400});}
  const reason=clean(input.reason);if(!reason)throw new Response("Reason is required",{status:400});
  const context=await attendanceContext(db,employeeId,attendanceDate),fields=correctionFields(type),requested:Row={};
  if(fields[0]==="actual_in")requested.actual_in=time(input.requestedTime);
  if(fields[0]==="actual_out")requested.actual_out=time(input.requestedTime);
  if(fields.length&&Object.values(requested).every(value=>!value))throw new Response("Requested corrected time is required",{status:400});
  const original={actual_in:context.record?.actual_in??null,actual_out:context.record?.actual_out??null,worked_minutes:context.record?.worked_minutes??0,late_minutes:context.record?.late_minutes??0,early_minutes:context.record?.early_minutes??0,status:context.record?.status??null};
  return db.transaction(async tx=>{
    await tx.prepare("SELECT pg_advisory_xact_lock(?,?)").bind(employeeId,Number(attendanceDate.replaceAll("-",""))).run();
    await requireEmployeeHr(tx,employeeId);
    const duplicate=await tx.prepare("SELECT id FROM attendance_corrections WHERE employee_id=? AND attendance_date=? AND correction_type=? AND status IN ('pending_manager','pending_hr') LIMIT 1").bind(employeeId,attendanceDate,type).first<Row>();
    if(duplicate)throw new Response("An active correction already exists for this issue and date",{status:409});
    const result=await tx.prepare("INSERT INTO attendance_corrections (employee_id,daily_attendance_id,attendance_date,correction_type,original_values,requested_values,reason,notes,status,current_stage,requested_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'pending_manager','manager',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").bind(employeeId,context.record?.id??null,attendanceDate,type,JSON.stringify(original),JSON.stringify(requested),reason,clean(input.notes)||null,actor.id).first<Row>();
    await tx.prepare("INSERT INTO attendance_correction_actions (correction_id,stage,actor_user_id,action,after_values,created_at) VALUES (?,'employee',?,'correction_requested',?,CURRENT_TIMESTAMP)").bind(result!.id,actor.id,JSON.stringify(requested)).run();
    const related=exceptionTypesForCorrection(type),exceptionFilter=related.length?` AND exception_type IN (${related.map(()=>"?").join(",")})`:"";
    await tx.prepare(`UPDATE attendance_exceptions SET correction_id=?,status='correction_requested',updated_at=CURRENT_TIMESTAMP WHERE employee_id=? AND attendance_date=? AND status='open'${exceptionFilter}`).bind(result!.id,employeeId,attendanceDate,...related).run();
    await writeAudit(tx,request,actor,"correction_requested","attendance_correction",String(result!.id),original,requested);
    return {ok:true,id:Number(result!.id),status:"pending_manager"};
  });
}

export async function processAttendanceCorrection(input:{db:PostgresDatabase;request:Request;actor:Actor;correctionId:number;decision:CorrectionDecision;reason?:unknown}){
  const reason=clean(input.reason);if(input.decision==="reject"&&!reason)throw new Response("Rejection reason is required",{status:400});
  return input.db.transaction(async tx=>{
    await tx.prepare("SELECT pg_advisory_xact_lock(?)").bind(input.correctionId).run();
    const before=await tx.prepare("SELECT * FROM attendance_corrections WHERE id=? FOR UPDATE").bind(input.correctionId).first<Row>();if(!before)throw new Response("Correction not found",{status:404});
    if(before.current_stage==="manager"){if(input.actor.roleName!=="Department Manager")throw new Response("Only the direct manager can process this request",{status:403});await assertEmployeeManager(tx,Number(before.employee_id),input.actor.employeeId);}
    if(before.current_stage==="hr")await assertEmployeeHr(tx,Number(before.employee_id),input.actor.id);
    if(before.current_stage==="manager"&&input.decision==="approve")await requireEmployeeHr(tx,Number(before.employee_id));
    let transition:ReturnType<typeof decideCorrectionTransition>;
    try{transition=decideCorrectionTransition({status:String(before.status),stage:String(before.current_stage),decision:input.decision});}
    catch(cause){throw new Response(cause instanceof Error?cause.message:"This correction has already been processed",{status:409});}
    const update=await tx.prepare("UPDATE attendance_corrections SET status=?,current_stage=?,resolved_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=? AND current_stage=? RETURNING id").bind(transition.status,transition.currentStage,transition.currentStage,input.correctionId,before.status,before.current_stage).first<Row>();
    if(!update)throw new Response("This correction stage has already been processed",{status:409});
    let applied:unknown=null;
    if(transition.apply){
      const requested=json(before.requested_values),note=[clean((await tx.prepare("SELECT note FROM daily_attendance WHERE employee_id=? AND work_date=?").bind(before.employee_id,before.attendance_date).first<Row>())?.note),`Correction #${input.correctionId}: ${before.reason}`].filter(Boolean).join("\n");
      applied=await persistCalculation(tx,Number(before.employee_id),String(before.attendance_date),{...requested,note});
      await tx.prepare("UPDATE attendance_exceptions SET status='resolved',resolved_at=CURRENT_TIMESTAMP,resolved_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE correction_id=?").bind(input.actor.id,input.correctionId).run();
    }else if(transition.currentStage==="completed")await tx.prepare("UPDATE attendance_exceptions SET status='open',correction_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE correction_id=?").bind(input.correctionId).run();
    else await tx.prepare("UPDATE attendance_exceptions SET status='pending_hr',updated_at=CURRENT_TIMESTAMP WHERE correction_id=?").bind(input.correctionId).run();
    const action=input.decision==="approve"?(String(before.current_stage)==="manager"?"manager_approved":"hr_approved"):(String(before.current_stage)==="manager"?"manager_rejected":"hr_rejected");
    await tx.prepare("INSERT INTO attendance_correction_actions (correction_id,stage,actor_user_id,action,reason,before_values,after_values,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(input.correctionId,before.current_stage,input.actor.id,action,reason||null,before.original_values,applied?JSON.stringify(applied):null).run();
    await writeAudit(tx,input.request,input.actor,action,"attendance_correction",String(input.correctionId),before,{status:transition.status,currentStage:transition.currentStage});
    if(transition.apply)await writeAudit(tx,input.request,input.actor,"attendance_recalculated","daily_attendance",String(before.daily_attendance_id??""),json(before.original_values),applied);
    return {ok:true,status:transition.status,currentStage:transition.currentStage};
  });
}

export async function manualAttendanceCorrection(input:{db:PostgresDatabase;request:Request;actor:Actor;employeeId:number;attendanceDate:string;field:string;newValue:unknown;reason:unknown}){
  if(!["actual_in","actual_out","attendance_type"].includes(input.field))throw new Response("Unsupported attendance field",{status:400});
  const reason=clean(input.reason);if(!reason)throw new Response("Reason is required",{status:400});
  const value=input.field==="attendance_type"?clean(input.newValue,30):time(input.newValue);
  return input.db.transaction(async tx=>{
    await tx.prepare("SELECT pg_advisory_xact_lock(?,?)").bind(input.employeeId,Number(input.attendanceDate.replaceAll("-",""))).run();
    const before=await attendanceContext(tx,input.employeeId,input.attendanceDate),applied=await persistCalculation(tx,input.employeeId,input.attendanceDate,{[input.field]:value,note:[clean(before.record?.note),`Manual correction: ${reason}`].filter(Boolean).join("\n")});
    const result=await tx.prepare("INSERT INTO attendance_corrections (employee_id,daily_attendance_id,attendance_date,correction_type,original_values,requested_values,reason,status,current_stage,requested_by_user_id,resolved_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'resolved','completed',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").bind(input.employeeId,applied.row?.id??null,input.attendanceDate,"manual",JSON.stringify(before.record??{}),JSON.stringify({[input.field]:value}),reason,input.actor.id).first<Row>();
    await tx.prepare("INSERT INTO attendance_correction_actions (correction_id,stage,actor_user_id,action,reason,before_values,after_values,created_at) VALUES (?,'hr',?,'manual_correction',?,?,?,CURRENT_TIMESTAMP)").bind(result!.id,input.actor.id,reason,JSON.stringify(before.record??{}),JSON.stringify(applied.row??{})).run();
    await writeAudit(tx,input.request,input.actor,"manual_correction","attendance_correction",String(result!.id),before.record,applied.row);
    return {ok:true,id:Number(result!.id),attendance:applied.row};
  });
}

export async function recalculateAttendance(db:DB,employeeId:number,attendanceDate:string,overrides:Row={}){return persistCalculation(db,employeeId,attendanceDate,overrides);}

const todayIso=()=>new Date().toISOString().slice(0,10);
const ACTIVE_EMPLOYEE_STATUSES="'active','probation','notice_period'";
const nextDay=(date:string)=>{const next=new Date(`${date}T00:00:00Z`);next.setUTCDate(next.getUTCDate()+1);return next.toISOString().slice(0,10);};

/**
 * Re-runs the daily calculation after an approved leave is granted or withdrawn so its days show as leave
 * (never absence) and cancelled days fall back to normal. Every scheduled working day of the leave gets a
 * record straight away, past or future; rest days are left to the nightly scan like any other day.
 */
export async function refreshLeaveAttendance(db:DB,employeeId:number,fromDate:string,toDate:string){
  const today=todayIso();
  const employee=await db.prepare("SELECT work_days FROM employees WHERE id=? AND employment_status!='deleted'").bind(employeeId).first<Row>();
  if(!employee)throw new Response("Employee not found",{status:404});
  const existing=new Set((await db.prepare("SELECT work_date FROM daily_attendance WHERE employee_id=? AND work_date>=? AND work_date<=?").bind(employeeId,fromDate,toDate).all<Row>()).results.map(row=>String(row.work_date)));
  const workDays=String(employee.work_days||"0,1,2,3,4");
  for(let date=fromDate;date<=toDate;date=nextDay(date))if(date<=today||existing.has(date)||isScheduledWorkDay(date,workDays))await persistCalculation(db,employeeId,date);
}

export type HolidayFootprint={holidayDate:string;recurrenceType?:string|null;country:string};

/**
 * Re-runs the daily calculation for every day a holiday change touches (the old and the new dates), so a day that
 * became a holiday stops counting as absence and a day that stopped being one is counted normally again.
 * Explicit dates up to today are created for the covered employees; annual holidays and later dates only correct
 * records that already exist.
 */
export async function refreshHolidayAttendance(db:DB,footprints:HolidayFootprint[]){
  const today=todayIso(),dates=new Set<string>(),monthDays=new Set<string>(),countries=new Set<string>();
  for(const footprint of footprints){
    if(footprint.recurrenceType==="annual")monthDays.add(footprint.holidayDate.slice(5));else dates.add(footprint.holidayDate);
    countries.add(footprint.country);
  }
  const allCountries=["Both","KSA & Egypt"].some(value=>countries.has(value));
  const employees=(await db.prepare(`SELECT id,country,start_date FROM employees WHERE employment_status IN (${ACTIVE_EMPLOYEE_STATUSES})`).all<Row>()).results.filter(employee=>allCountries||countries.has(String(employee.country)));
  const covered=new Set(employees.map(employee=>Number(employee.id))),targets=new Map<string,[number,string]>();
  const add=(employeeId:number,date:string)=>targets.set(`${employeeId}|${date}`,[employeeId,date]);
  for(const date of dates){
    const existing=new Set((await db.prepare("SELECT employee_id FROM daily_attendance WHERE work_date=?").bind(date).all<Row>()).results.map(row=>Number(row.employee_id)));
    for(const employee of employees){
      const employeeId=Number(employee.id);
      if(existing.has(employeeId)||(date<=today&&String(employee.start_date||"")<=date))add(employeeId,date);
    }
  }
  if(monthDays.size){
    const values=[...monthDays];
    const rows=(await db.prepare(`SELECT employee_id,work_date FROM daily_attendance WHERE substring(work_date,6,5) IN (${values.map(()=>"?").join(",")})`).bind(...values).all<Row>()).results;
    for(const row of rows)if(covered.has(Number(row.employee_id)))add(Number(row.employee_id),String(row.work_date));
  }
  for(const [employeeId,date] of targets.values())await persistCalculation(db,employeeId,date);
  return {recalculated:targets.size};
}
