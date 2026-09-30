import { MANAGED_DEPARTMENTS_CTE } from "../../organization/department-scope";
import { withDatabase } from "../route-helpers";
import type { PostgresDatabase } from "../../../db/postgres";
import { enforceRateLimit, enforceWriteOrigin, hasPermission, requireActor } from "../api-security";
import type { ApiActor } from "../api-security";
import { audit, body, notifyEmployee, number, required, requireEmployeeScope, requireModule, text, transition } from "../../talent/talent-service";
import type { Db, Input } from "../../talent/talent-service";
import { COURSE_MOVES, ENROLLMENT_MOVES, LEARNER_STATUS_SQL, LEARNING_ADMIN_ROLES, canRenewEnrollment, optionalIsoDate, optionalScore, parseCourseInput } from "../../talent/learning-rules";
import { parseEvaluation } from "../../talent/learning-evaluation";
import type { Evaluation } from "../../talent/learning-evaluation";
import { approveCertificate, buildCertificate, saveCertificate } from "../../talent/learning-certificate";
import { branchHrEmployeeIds } from "../../employees/hr-data-scope";

type Row=Record<string,unknown>;
const dbToday=async(db:Db)=>String((await db.prepare("SELECT CURRENT_DATE::text AS today").first<{today:string}>())?.today);
const isLearningAdmin=(actor:ApiActor)=>LEARNING_ADMIN_ROLES.includes(actor.roleName);

export async function GET(request:Request){
  return withDatabase("Unable to load learning", async db => {
    const actor=await requireActor(request,db);await requireModule(db,actor,"learning","view");
    const url=new URL(request.url),employeeId=number(url.searchParams.get("employeeId"));if(employeeId)await requireEmployeeScope(db,actor,employeeId);
    let courseScope="",enrollmentScope="",scopeArgs:(number|null)[]=[],ownCourses=false;
    // An employee account that is not linked to an employee record must see nothing (id -1 matches no row), never everyone.
    const exactEmployeeId=employeeId||(actor.roleName==="Employee"?actor.employeeId||-1:0);
    if(exactEmployeeId){courseScope="AND e.employee_id=?";enrollmentScope="WHERE x.employee_id=?";scopeArgs=[exactEmployeeId];}
    else if(actor.roleName==="Department Manager"&&actor.employeeId){
      const managedScope=`${MANAGED_DEPARTMENTS_CTE} SELECT emp.id FROM employees emp WHERE emp.employment_status!='deleted' AND (emp.department_id IN (SELECT id FROM managed) OR emp.id=?)`;
      courseScope=`AND e.employee_id IN (${managedScope})`;enrollmentScope=`WHERE x.employee_id IN (${managedScope})`;scopeArgs=[actor.employeeId,actor.employeeId];
      // A manager's own new program has nobody assigned yet; it must stay visible so they can attach materials and assign it.
      ownCourses=true;
    }
    // A branch HR sees the whole program catalog but only its own employees' enrollments.
    let enrollmentArgs:unknown[]=[];
    if(!courseScope){const branchHr=await branchHrEmployeeIds(db,actor);if(branchHr){enrollmentScope="WHERE x.employee_id=ANY(?::int[])";enrollmentArgs=[branchHr];}}
    const scoped=Boolean(courseScope);
    // Course statistics only count live work: cancelled assignments and people who left are excluded so they cannot skew the rates.
    const liveEnrollments=`(SELECT x.* FROM training_enrollments x JOIN employees emp ON emp.id=x.employee_id AND emp.employment_status IN ${LEARNER_STATUS_SQL} WHERE x.status!='cancelled')`;
    const courseSql=`SELECT c.*,(SELECT i.name_en FROM employees i WHERE i.id=c.instructor_employee_id) AS instructor_employee_name,(SELECT i.name_ar FROM employees i WHERE i.id=c.instructor_employee_id) AS instructor_employee_name_ar,COUNT(e.id)::int AS enrollment_count,COUNT(e.id) FILTER(WHERE e.status='assigned')::int AS assigned_count,COUNT(e.id) FILTER(WHERE e.status='in_progress')::int AS in_progress_count,COUNT(e.id) FILTER(WHERE e.status='completed')::int AS completion_count,COUNT(e.id) FILTER(WHERE e.status='failed')::int AS failed_count,COUNT(e.id) FILTER(WHERE e.status IN ('assigned','in_progress') AND e.due_date<CURRENT_DATE::text)::int AS overdue_count,CASE WHEN COUNT(e.id)=0 THEN 0 ELSE ROUND(100.0*COUNT(e.id) FILTER(WHERE e.status='completed')/COUNT(e.id))::int END AS completion_rate FROM training_courses c LEFT JOIN ${liveEnrollments} e ON e.course_id=c.id ${courseScope} GROUP BY c.id ${scoped?`HAVING COUNT(e.id)>0${ownCourses?" OR c.created_by_user_id=?":""}`:""} ORDER BY CASE WHEN c.status='active' THEN 0 ELSE 1 END,c.start_date DESC NULLS LAST,c.id DESC LIMIT 1000`;
    const enrollmentSql=`SELECT x.*,c.title AS course_title,c.duration_hours,c.instructor_name,(SELECT i.name_en FROM employees i WHERE i.id=c.instructor_employee_id) AS instructor_employee_name,c.provider,c.course_type,c.mandatory,c.status AS course_status,c.start_date AS course_start_date,c.end_date AS course_end_date,c.validity_months,e.employee_code,e.name_en AS employee_name,e.name_ar AS employee_name_ar,d.name_en AS department_name,d.name_ar AS department_name_ar FROM training_enrollments x JOIN training_courses c ON c.id=x.course_id JOIN employees e ON e.id=x.employee_id AND e.employment_status IN ${LEARNER_STATUS_SQL} LEFT JOIN departments d ON d.id=e.department_id ${enrollmentScope} ORDER BY CASE WHEN x.status IN ('assigned','in_progress') AND x.due_date<CURRENT_DATE::text THEN 0 WHEN x.status IN ('assigned','in_progress') THEN 1 ELSE 2 END,x.due_date NULLS LAST,x.id DESC LIMIT 5000`;
    const [courses,enrollments,today,canCreate,canEdit]=await Promise.all([db.prepare(courseSql).bind(...scopeArgs,...(ownCourses?[actor.id]:[])).all(),db.prepare(enrollmentSql).bind(...scopeArgs,...enrollmentArgs).all(),dbToday(db),hasPermission(db,actor,"learning","create"),hasPermission(db,actor,"learning","edit")]);
    // Materials travel with the programs the caller can already see; uploaded files carry no storage key, they are opened through /api/learning/materials/:id.
    const courseIds=courses.results.map(course=>Number(course.id));
    const materials=courseIds.length?(await db.prepare(`SELECT id,course_id,title,kind,url,file_name,content_type,size_bytes,created_by_user_id,created_at FROM training_materials WHERE course_id IN (${courseIds.map(()=>"?").join(",")}) ORDER BY id`).bind(...courseIds).all()).results:[];
    return Response.json({courses:courses.results,materials,enrollments:enrollments.results,today,permissions:{canCreate,canEdit,isAdmin:isLearningAdmin(actor)},actor:{id:actor.id,roleName:actor.roleName,employeeId:actor.employeeId}});
  });
}

async function createCourse(db:PostgresDatabase,actor:ApiActor,input:Input){
  await requireModule(db,actor,"learning","create");
  const title=text(required(input.title,"title"),200),{courseType,startDate,endDate,validityMonths,durationHours,instructorEmployeeId,instructorName}=parseCourseInput(input);
  if(instructorEmployeeId){
    // An internal instructor is just a name on the program, but a manager may only pick people from their own scope.
    if(!isLearningAdmin(actor))await requireEmployeeScope(db,actor,instructorEmployeeId);
    if(!(await db.prepare(`SELECT id FROM employees WHERE id=? AND employment_status IN ${LEARNER_STATUS_SQL}`).bind(instructorEmployeeId).first()))throw new Response("Instructor is not an active employee",{status:409});
  }
  const row=await db.prepare("INSERT INTO training_courses(title,provider,course_type,description,start_date,end_date,status,mandatory,validity_months,duration_hours,instructor_employee_id,instructor_name,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").bind(title,text(input.provider,200)||null,courseType,text(input.description)||null,startDate,endDate,input.mandatory?1:0,validityMonths,durationHours,instructorEmployeeId,instructorName,actor.id).first<{id:number}>();
  await audit(db,actor,"create","learning","course",row!.id,{title,mandatory:Boolean(input.mandatory),durationHours,instructorEmployeeId,instructorName});
  return Response.json({ok:true,id:row!.id},{status:201});
}

async function enroll(db:PostgresDatabase,actor:ApiActor,input:Input){
  await requireModule(db,actor,"learning","create");
  const employeeId=number(input.employeeId),courseId=number(input.courseId);
  if(!employeeId||!courseId)throw new Response("Employee and program are required",{status:400});
  await requireEmployeeScope(db,actor,employeeId);
  const dueDate=optionalIsoDate(input.dueDate,"due date"),today=await dbToday(db);
  if(!dueDate)throw new Response("Due date is required",{status:400});
  if(dueDate<today)throw new Response("Due date cannot be in the past",{status:400});
  if(!(await db.prepare(`SELECT id FROM employees WHERE id=? AND employment_status IN ${LEARNER_STATUS_SQL}`).bind(employeeId).first()))throw new Response("Employee is not active",{status:409});
  if(!(await db.prepare("SELECT id FROM training_courses WHERE id=? AND status='active'").bind(courseId).first()))throw new Response("Active course not found",{status:404});
  const outcome=await db.transaction(async tx=>{
    const created=await tx.prepare("INSERT INTO training_enrollments(course_id,employee_id,status,due_date,assigned_by_user_id,created_at,updated_at) VALUES (?,?,'assigned',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(course_id,employee_id) DO NOTHING RETURNING id").bind(courseId,employeeId,dueDate,actor.id).first<{id:number}>();
    if(created)return {id:created.id,previous:null as Row|null};
    const existing=await tx.prepare("SELECT * FROM training_enrollments WHERE course_id=? AND employee_id=? FOR UPDATE").bind(courseId,employeeId).first<Row>();
    if(!existing||!canRenewEnrollment(existing,today))throw new Response("Employee already enrolled",{status:409});
    // A failed, cancelled or lapsed enrollment is assigned again on the same row (the pair is unique); the earlier result is kept in the audit trail.
    await tx.prepare("UPDATE training_enrollments SET status='assigned',due_date=?,completion_date=NULL,score=NULL,certificate_document_id=NULL,certificate_expiry=NULL,evaluation_json=NULL,certificate_number=NULL,certificate_json=NULL,certificate_issued_at=NULL,completed_by_user_id=NULL,assigned_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(dueDate,actor.id,existing.id).run();
    // Free this enrollment's notification keys so the new cycle can notify again (assigned, overdue, completed ...).
    await tx.prepare("UPDATE notifications SET dedupe_key=dedupe_key||? WHERE entity_type='training_enrollment' AND dedupe_key LIKE ?").bind(`:cycle-${Date.now()}`,`training:${Number(existing.id)}:%`).run();
    return {id:Number(existing.id),previous:{status:existing.status,completionDate:existing.completion_date,score:existing.score,certificateExpiry:existing.certificate_expiry,certificateDocumentId:existing.certificate_document_id,certificateNumber:existing.certificate_number,evaluation:existing.evaluation_json}};
  });
  await notifyEmployee(db,employeeId,{type:"learning",title:"training_assigned",message:dueDate,entityType:"training_enrollment",entityId:outcome.id,path:"learning",key:`training:${outcome.id}:assigned`});
  await audit(db,actor,outcome.previous?"reassign":"enroll","learning","training_enrollment",outcome.id,{courseId,employeeId,dueDate,...(outcome.previous?{previous:outcome.previous}:{})});
  return Response.json({ok:true,id:outcome.id,renewed:Boolean(outcome.previous)},{status:201});
}

async function updateEnrollment(db:PostgresDatabase,actor:ApiActor,input:Input){
  const id=number(input.enrollmentId),next=required(input.status,"status");
  // Permission checks run on the pooled connection before the transaction opens: this pool is a single
  // connection (see db/postgres.ts), so calling back into `db` from inside db.transaction would deadlock
  // the transaction against itself. The status transition is re-validated below once the row is locked.
  const found=await db.prepare("SELECT employee_id,status FROM training_enrollments WHERE id=?").bind(id).first<{employee_id:number;status:string}>();
  if(!found)throw new Response("Enrollment not found",{status:404});
  const employeeId=Number(found.employee_id),own=actor.employeeId===employeeId;
  await requireEmployeeScope(db,actor,employeeId);
  // A learner may only start their own assigned course; every other change needs the edit permission.
  if(!(own&&actor.roleName==="Employee"&&found.status==="assigned"&&next==="in_progress"))await requireModule(db,actor,"learning","edit");
  // Nobody signs off their own result, except HR who is the final verifier.
  if(own&&next!=="in_progress"&&!isLearningAdmin(actor))throw new Response("Completion requires manager or HR verification",{status:403});
  // A scored evaluation (weighted criteria) decides the result: at or above the pass mark the training is completed and a certificate is issued.
  const evaluation=(next==="completed"||next==="failed")&&input.evaluation?parseEvaluation(input.evaluation):null;
  if(next==="completed"&&!evaluation)throw new Response("Every evaluation criterion needs a score",{status:400});
  if(next==="failed"&&evaluation?.passed)throw new Response("A passing evaluation cannot be recorded as failed",{status:400});
  if(next==="completed"&&evaluation&&!evaluation.passed)throw new Response("Overall score is below the pass mark; record the training as failed",{status:400});
  const outcome=await db.transaction(async tx=>{
    const row=await tx.prepare("SELECT x.*,c.validity_months FROM training_enrollments x JOIN training_courses c ON c.id=x.course_id WHERE x.id=? FOR UPDATE OF x").bind(id).first<Row>();
    if(!row)throw new Response("Enrollment not found",{status:404});
    // Re-check against the locked row in case another request changed its status between the permission check above and this lock.
    transition(String(row.status),next,ENROLLMENT_MOVES,"training transition");
    const today=await dbToday(tx);
    let completion:string|null=null,score:number|null=null,expiry:string|null=null;
    if(next==="completed"||next==="failed")score=evaluation?evaluation.overall:optionalScore(input.score);
    if(next==="completed"){
      completion=optionalIsoDate(input.completionDate,"completion date")||today;
      if(completion>today)throw new Response("Completion date cannot be in the future",{status:400});
      expiry=optionalIsoDate(input.certificateExpiry,"certificate expiry");
      if(expiry&&expiry<completion)throw new Response("Certificate expiry cannot be before the completion date",{status:400});
      if(!expiry&&Number(row.validity_months)>0)expiry=(await tx.prepare("SELECT (?::date + (? * INTERVAL '1 month'))::date::text AS expiry").bind(completion,Number(row.validity_months)).first<{expiry:string}>())?.expiry||null;
    }
    await tx.prepare("UPDATE training_enrollments SET status=?,completion_date=?,score=?,certificate_document_id=?,certificate_expiry=?,evaluation_json=?,completed_by_user_id=CASE WHEN ? IN ('completed','failed') THEN ?::integer ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(next,completion,score,next==="completed"?number(input.certificateDocumentId)||null:null,expiry,evaluation?JSON.stringify({...evaluation,evaluatedAt:today}):null,next,actor.id,id).run();
    // The certificate is frozen inside the same transaction as the completion, so a completed training never exists without one.
    const certificate=next==="completed"?await buildCertificate(tx,{enrollmentId:id,actor,today,completionDate:completion!,expiry,evaluation,score,certificateDetails:input.certificateDetails}):null;
    if(certificate)await saveCertificate(tx,id,certificate);
    return {from:String(row.status),employeeId,own,expiry,score,certificate};
  });
  if(!outcome.own)await notifyEmployee(db,outcome.employeeId,{type:"learning",title:next==="completed"?"training_completed":"training_updated",message:next,entityType:"training_enrollment",entityId:id,path:"learning",key:`training:${id}:${next}`});
  await audit(db,actor,"status_change","learning","training_enrollment",id,{from:outcome.from,to:next,expiry:outcome.expiry,score:outcome.score,...(evaluation?{evaluation:{scores:evaluation.scores,overall:evaluation.overall,grade:evaluation.grade}}:{}),...(outcome.certificate?{certificateNumber:outcome.certificate.number}:{})});
  return Response.json({ok:true,certificateExpiry:outcome.expiry,certificate:outcome.certificate});
}

// Backfills a certificate for a training completed before certificates existed. Idempotent: an issued certificate is returned unchanged.
async function issueCertificate(db:PostgresDatabase,actor:ApiActor,input:Input){
  const id=number(input.enrollmentId);
  const found=await db.prepare("SELECT employee_id,status FROM training_enrollments WHERE id=?").bind(id).first<{employee_id:number;status:string}>();
  if(!found)throw new Response("Enrollment not found",{status:404});
  await requireEmployeeScope(db,actor,Number(found.employee_id));
  await requireModule(db,actor,"learning","edit");
  const certificate=await db.transaction(async tx=>{
    const row=await tx.prepare("SELECT status,completion_date,score,certificate_expiry,evaluation_json,certificate_json FROM training_enrollments WHERE id=? FOR UPDATE").bind(id).first<Row>();
    if(!row)throw new Response("Enrollment not found",{status:404});
    if(row.status!=="completed")throw new Response("A certificate can only be issued for completed training",{status:409});
    if(row.certificate_json)return JSON.parse(String(row.certificate_json));
    const today=await dbToday(tx);
    let evaluation:Evaluation|null=null;
    try{evaluation=row.evaluation_json?JSON.parse(String(row.evaluation_json)) as Evaluation:null}catch{evaluation=null}
    const issued=await buildCertificate(tx,{enrollmentId:id,actor,today,completionDate:String(row.completion_date||today),expiry:row.certificate_expiry?String(row.certificate_expiry):null,evaluation,score:row.score==null?null:Number(row.score)});
    await saveCertificate(tx,id,issued);
    return issued;
  });
  await audit(db,actor,"issue_certificate","learning","training_enrollment",id,{certificateNumber:certificate.number});
  return Response.json({ok:true,certificate});
}

async function approveEnrollmentCertificate(db:PostgresDatabase,actor:ApiActor,input:Input){
  await requireModule(db,actor,"learning","edit");
  const id=number(input.enrollmentId);
  const found=await db.prepare("SELECT employee_id FROM training_enrollments WHERE id=?").bind(id).first<{employee_id:number}>();
  if(!found)throw new Response("Enrollment not found",{status:404});
  await requireEmployeeScope(db,actor,Number(found.employee_id));
  const certificate=await db.transaction(async tx=>{
    const row=await tx.prepare("SELECT status,certificate_json FROM training_enrollments WHERE id=? FOR UPDATE").bind(id).first<Row>();
    if(row?.status!=="completed"||!row.certificate_json)throw new Response("A certificate can only be issued for completed training",{status:409});
    const updated=await approveCertificate(tx,JSON.parse(String(row.certificate_json)),actor,String(input.role));
    await saveCertificate(tx,id,updated);
    return updated;
  });
  await audit(db,actor,"approve_certificate","learning","training_enrollment",id,{role:input.role,certificateNumber:certificate.number,status:certificate.status});
  return Response.json({ok:true,certificate});
}

async function setCourseStatus(db:PostgresDatabase,actor:ApiActor,input:Input){
  await requireModule(db,actor,"learning","edit");
  // A program is shared by every team, so only HR may close or cancel it (cancelling also cancels open assignments).
  if(!isLearningAdmin(actor))throw new Response("Only HR can change a program's status",{status:403});
  const id=number(input.courseId),next=required(input.status,"status");
  const outcome=await db.transaction(async tx=>{
    const course=await tx.prepare("SELECT status FROM training_courses WHERE id=? FOR UPDATE").bind(id).first<{status:string}>();
    if(!course)throw new Response("Course not found",{status:404});
    transition(course.status,next,COURSE_MOVES,"program status");
    await tx.prepare("UPDATE training_courses SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(next,id).run();
    const cancelled=next==="cancelled"?(await tx.prepare("UPDATE training_enrollments SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE course_id=? AND status IN ('assigned','in_progress') RETURNING id").bind(id).all()).results.length:0;
    return {from:course.status,cancelled};
  });
  await audit(db,actor,"status_change","learning","course",id,{from:outcome.from,to:next,cancelledEnrollments:outcome.cancelled});
  return Response.json({ok:true,cancelledEnrollments:outcome.cancelled});
}

export async function POST(request:Request){
  return withDatabase("Learning action failed", async db => {
    enforceWriteOrigin(request);
    const actor=await requireActor(request,db);
    await enforceRateLimit(db,request,"learning-write",180,60,actor.id);
    const input=await body(request),action=required(input.action,"action");
    if(action==="create_course")return await createCourse(db,actor,input);
    if(action==="enroll")return await enroll(db,actor,input);
    if(action==="update_enrollment")return await updateEnrollment(db,actor,input);
    if(action==="approve_certificate")return await approveEnrollmentCertificate(db,actor,input);
    if(action==="issue_certificate")return await issueCertificate(db,actor,input);
    if(action==="set_course_status")return await setCourseStatus(db,actor,input);
    throw new Response("Unsupported learning action",{status:400});
  });
}
