import type { TransactionDatabase } from "../../db/postgres";

import { validateEmployeeWrite, persistAssignment } from '../organization/assignment-service.ts';
import type { Row } from '../ui-types';

export type NewEmployeeInput=Row & {nameEn:string;nameAr:string;workEmail:string;startDate:string;country:string;departmentId?:number|null;jobTitleId?:number|null;managerId?:number|null;workLocation?:string|null;employmentType?:string|null};

/** Single employee-creation source used by HR and ATS hire conversion. */
export async function createEmployeeRecord(tx:TransactionDatabase,input:NewEmployeeInput){
  const assignment=await validateEmployeeWrite(tx,0,input);
  const sequence=await tx.prepare("SELECT nextval(pg_get_serial_sequence('employees','id'))::int AS id").first<{id:number}>();
  const id=Number(sequence!.id),code=`EMP-${String(id).padStart(5,"0")}`;
  await tx.prepare("INSERT INTO employees (id,employee_code,name_en,name_ar,work_email,department_id,job_title_id,manager_id,start_date,employment_status,country,work_location,employment_type,schedule_type,work_days,check_in_time,check_out_time,grace_minutes,required_daily_minutes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',?,?,?,'fixed','0,1,2,3,4','09:00','17:00',15,480,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
    .bind(id,code,input.nameEn,input.nameAr,input.workEmail.toLowerCase(),input.departmentId||null,input.jobTitleId||null,input.managerId||null,input.startDate,input.country,input.workLocation||null,input.employmentType||"full_time").run();
  if(input.managerId)await tx.prepare("UPDATE employees SET organizational_level=COALESCE((SELECT organizational_level+1 FROM employees WHERE id=?),1) WHERE id=?").bind(input.managerId,id).run();
  await persistAssignment(tx,id,assignment,input);
  return {id,code};
}
