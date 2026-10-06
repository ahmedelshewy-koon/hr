import type { TransactionDatabase } from '../../db/postgres';
import type { Row } from '../ui-types';
import { assertAssignmentReviewCurrent } from '../organization/assignment-policy.ts';
import { validateEmployeeWrite, persistAssignment } from '../organization/assignment-service.ts';
import { asResponse, orgError } from '../organization/org-errors.ts';
import { refreshReportingLevels } from '../organization/reporting-service.ts';
import { scheduledDailyMinutes } from './schedule-policy.ts';
import { normalizeRemoteDays } from '../attendance/attendance-calculation.ts';
import { resolvedContractEndDate } from './contract-policy.ts';
import { validateCompanyHr } from './company-hr-catalog.ts';
import { resolveEmployeeCostCenter } from '../cost-centers/catalog.ts';
import { assertEmployeeCodeFree, cleanEmployeeCode } from './employee-code.ts';

const textFields:Record<string,string>={nameEn:'name_en',nameAr:'name_ar',workEmail:'work_email',fingerprintCode:'fingerprint_code',personalPhone:'personal_phone',workPhone:'work_phone',nationality:'nationality',nationalityCountry:'nationality_country',religion:'religion',passportNumber:'passport_number',gender:'gender',birthDate:'birth_date',identificationNumber:'identification_number',address:'address',startDate:'start_date',endDate:'end_date',employmentStatus:'employment_status',salaryCurrency:'salary_currency',salaryCountry:'salary_country',country:'country',workLocation:'work_location',employmentType:'employment_type',scheduleType:'schedule_type',workDays:'work_days',checkInTime:'check_in_time',checkOutTime:'check_out_time',bankName:'bank_name',bankAccountNumber:'bank_account_number',bankIban:'bank_iban'};

/** Called inside the authorized API transaction. Omitted fields are never rewritten. */
export async function saveEmployeeProfile(db:TransactionDatabase,employeeId:number,payload:Row,actor:{id:number;ip?:string|null;employeeId?:number|null;roleName?:string},afterSave?:(db:TransactionDatabase)=>Promise<void>) {
  await db.prepare('SELECT pg_advisory_xact_lock(78231)').run();
  const before=await db.prepare("SELECT * FROM employees WHERE id=? AND employment_status!='deleted' FOR UPDATE").bind(employeeId).first<Row>();
  if(!before)throw new Response('Employee not found',{status:404});
  // Nobody but a Super Admin changes the HR responsible of their own employee record.
  if(payload.hrUserId!==undefined&&actor.employeeId&&Number(actor.employeeId)===employeeId&&actor.roleName!=='Super Admin'&&Number(payload.hrUserId||0)!==Number(before.hr_user_id||0))throw asResponse(orgError('HR_OVERRIDE_INVALID','hr_user_id','لا يمكنك تغيير مسؤول الموارد البشرية الخاص بك','You cannot change your own HR responsible',{status:403}),403);
  if(payload.assignmentBefore){try{assertAssignmentReviewCurrent(payload.assignmentBefore,before);}catch(error){throw asResponse(error,409);}}
  const assignment=await validateEmployeeWrite(db,employeeId,payload,before);
  await validateCompanyHr(db,payload,before);
  const updates:Row={};
  // These columns predate the optional organizational tables and must also save in fallback mode.
  for(const column of ['company_id','department_id','job_title_id','manager_id','hr_user_id'])updates[column]=assignment[column];
  for(const [key,column] of Object.entries(textFields)){
    if(payload[key]===undefined)continue;
    const limit=key==='address'?1000:['religion','passportNumber'].includes(key)?100:500;
    const value=String(payload[key]??'').trim().slice(0,limit);
    if(['nameEn','nameAr','workEmail','startDate','country'].includes(key)&&!value)throw new Response(`${key} is required`,{status:400});
    updates[column]=key==='workEmail'?value.toLowerCase():value||null;
  }
  if(payload.salaryCountry!==undefined&&!['','Saudi Arabia','Egypt'].includes(String(payload.salaryCountry??'').trim()))throw new Response('Invalid payroll country',{status:400});
  if(payload.fingerprintRequired!==undefined)updates.fingerprint_required=payload.fingerprintRequired===false||payload.fingerprintRequired==='false'||payload.fingerprintRequired===0||payload.fingerprintRequired==='0'?0:1;
  if(payload.costCenterId!==undefined)updates.cost_center_id=await resolveEmployeeCostCenter(db,payload.costCenterId,before.cost_center_id);
  if(payload.employeeCode!==undefined){
    const code=cleanEmployeeCode(payload.employeeCode);
    if(code!==before.employee_code){await assertEmployeeCodeFree(db,code,employeeId);updates.employee_code=code;}
  }
  for(const [key,column] of Object.entries({salary:'salary',graceMinutes:'grace_minutes',requiredDailyMinutes:'required_daily_minutes'})){
    if(payload[key]===undefined)continue;
    const value=payload[key]===''||payload[key]===null?null:Number(payload[key]);
    if(value!==null&&(!Number.isFinite(value)||value<0))throw new Response(`Invalid ${key}`,{status:400});
    updates[column]=value;
  }
  if(payload.startDate!==undefined||payload.endDate!==undefined){
    const start=String(updates.start_date??before.start_date??'');
    const end=resolvedContractEndDate(start,String(payload.endDate===undefined?before.end_date??'':payload.endDate??''));
    if(!end||end<start)throw new Response('Work end must be on or after work start',{status:400});
    updates.end_date=end;
  }
  if(payload.scheduleType!==undefined||payload.workDays!==undefined){
    const type=updates.schedule_type??before.schedule_type;
    updates.work_days=type==='shift'?'0,1,2,3,4,5,6':String(payload.workDays??before.work_days??'0,1,2,3,4');
  }
  // Remote days must stay inside the working week, so they are re-checked whenever either list changes.
  if(payload.remoteDays!==undefined||updates.work_days!==undefined)updates.remote_days=normalizeRemoteDays(payload.remoteDays??before.remote_days,String(updates.work_days??before.work_days??''));
  if(payload.checkInTime!==undefined||payload.checkOutTime!==undefined){
    const minutes=scheduledDailyMinutes(String(updates.check_in_time??before.check_in_time??''),String(updates.check_out_time??before.check_out_time??''));
    if(minutes!==null)updates.required_daily_minutes=minutes;
  }
  const columns=Object.keys(updates);
  await db.prepare(`UPDATE employees SET ${columns.map(c=>`${c}=?,`).join('')}updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(...columns.map(c=>updates[c]),employeeId).run();
  await persistAssignment(db,employeeId,assignment,payload,before);
  if(Number(assignment.department_id||0)!==Number(before.department_id||0)||Number(assignment.manager_id||0)!==Number(before.manager_id||0))await refreshReportingLevels(db,employeeId);
  if(payload.workEmail!==undefined&&updates.work_email!==before.work_email)await db.prepare('UPDATE users SET email=?,updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT id FROM users WHERE employee_id=? ORDER BY (lower(email)=lower(?)) DESC,id LIMIT 1)').bind(updates.work_email,employeeId,String(before.work_email||'')).run();
  if(afterSave)await afterSave(db);
  const after=await db.prepare('SELECT * FROM employees WHERE id=?').bind(employeeId).first<Row>();
  await db.prepare("INSERT INTO audit_logs(user_id,action,module,record_type,record_id,previous_value,new_value,ip_address) VALUES (?,'update','employees','employee',?,?,?,?)").bind(actor.id,String(employeeId),JSON.stringify(before),JSON.stringify(after),actor.ip??null).run();
  return {before,after};
}
