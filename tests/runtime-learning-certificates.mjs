// Local integration test; creates isolated fixtures and removes only those fixtures in finally.
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import postgres from "postgres";
const vars=Object.fromEntries(fs.readFileSync(".dev.vars","utf8").split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const at=line.indexOf("=");return [line.slice(0,at),line.slice(at+1).trim().replace(/^["']|["']$/g,"")]}));
const sql=postgres(vars.DATABASE_URL,{max:1}),base=process.env.LEARNING_TEST_URL||"http://localhost:3000";
const key=`learning-test-${Date.now()}`,employees=[],users=[],courses=[],enrollments=[];
let department;
const cookie=user=>{const payload=Buffer.from(JSON.stringify({userId:user.id,email:user.email,sessionVersion:1,exp:Math.floor(Date.now()/1000)+900})).toString("base64url");return `koon_portal_session=${payload}.${crypto.createHmac("sha256",vars.KOON_AUTH_SECRET).update(payload).digest("base64url")}`};
async function call(user,input,expected=200){const response=await fetch(`${base}/api/learning`,{method:input?"POST":"GET",headers:{cookie:cookie(user),origin:base,"content-type":"application/json"},...(input?{body:JSON.stringify(input)}:{})});const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result}
const ratings=value=>({scores:{knowledge:value,practical:value,assessment:value,attendance:value,participation:value},notes:"Automated test fixture"});
try{
 [department]=await sql`insert into departments(name_en,name_ar) values(${key},${key}) returning id`;
 for(const [index,role] of ["Super Admin","HR Manager","Employee"].entries()){
  const email=`${key}-${index}@example.invalid`;
  const [employee]=await sql`insert into employees(employee_code,name_en,name_ar,work_email,start_date,country,department_id) values(${`${key}-${index}`},${`Test Person ${index}`},${`Test Person ${index}`},${email},current_date::text,'Egypt',${department.id}) returning id`;
  employees.push(employee.id);
  const [user]=await sql`insert into users(email,employee_id,role_id,status,must_change_password) select ${email},${employee.id},id,'active',0 from roles where name=${role} returning id,email`;
  assert.ok(user);users.push(user);
 }
 await sql`update departments set manager_employee_id=${employees[0]} where id=${department.id}`;
 const today=new Date().toISOString().slice(0,10);
 const course=await call(users[0],{action:"create_course",title:key,courseType:"internal",startDate:today,endDate:today,durationHours:12,instructorName:"Test Instructor"},201);courses.push(course.id);
 const enrollment=await call(users[0],{action:"enroll",employeeId:employees[2],courseId:course.id,dueDate:today},201);enrollments.push(enrollment.id);
 await call(users[0],{action:"update_enrollment",enrollmentId:enrollment.id,status:"completed"},400);
 await call(users[0],{action:"update_enrollment",enrollmentId:enrollment.id,status:"completed",evaluation:ratings(40)},400);
 await call(users[0],{action:"update_enrollment",enrollmentId:enrollment.id,status:"completed",evaluation:ratings(90),certificateDetails:{instructorName:"",durationHours:-1}},400);
 const completed=await call(users[0],{action:"update_enrollment",enrollmentId:enrollment.id,status:"completed",evaluation:ratings(90),certificateDetails:{instructorName:"Certificate Instructor",durationHours:16}});
 assert.equal(completed.certificate.status,"pending");assert.equal(completed.certificate.signatories.length,0);
 assert.equal(completed.certificate.issuer.en,"Koon software solo");
 assert.equal(completed.certificate.instructor.nameEn,"Certificate Instructor");assert.equal(completed.certificate.program.durationHours,16);
 assert.equal((await sql`select certificate_number from training_enrollments where id=${enrollment.id}`)[0].certificate_number,null);
 const approve=(user,role,status=200)=>call(user,{action:"approve_certificate",enrollmentId:enrollment.id,role},status);
 await approve(users[2],"department_manager",403);
 await approve(users[1],"department_manager",403);
 const first=await approve(users[0],"department_manager");assert.equal(first.certificate.status,"pending");
 await approve(users[0],"hr_manager",403);
 const final=await approve(users[1],"hr_manager");assert.equal(final.certificate.status,"issued");assert.equal(final.certificate.signatories.length,2);
 assert.ok(final.certificate.signatories.every(item=>item.approvedAt&&item.userId));
 const loaded=await call(users[2]);const saved=JSON.parse(loaded.enrollments.find(item=>item.id===enrollment.id).certificate_json);
 assert.deepEqual(saved,final.certificate);
 const repeat=await call(users[0],{action:"issue_certificate",enrollmentId:enrollment.id});assert.deepEqual(repeat.certificate,final.certificate);
 const failedEnrollment=await call(users[0],{action:"enroll",employeeId:employees[1],courseId:course.id,dueDate:today},201);enrollments.push(failedEnrollment.id);
 const failed=await call(users[0],{action:"update_enrollment",enrollmentId:failedEnrollment.id,status:"failed",evaluation:ratings(40)});assert.equal(failed.certificate,null);
 console.log("PASS: evaluation validation, pending certificate, permissions, independent approvals, persistence, learner access, repeat issuance, and failure without certificate.");
}finally{
 await sql.begin(async tx=>{
  if(users.length){const ids=users.map(user=>user.id);await tx`delete from notifications where user_id in ${tx(ids)}`;await tx`delete from audit_logs where user_id in ${tx(ids)}`;}
  if(enrollments.length)await tx`delete from training_enrollments where id in ${tx(enrollments)}`;
  if(courses.length)await tx`delete from training_courses where id in ${tx(courses)}`;
  if(users.length)await tx`delete from users where id in ${tx(users.map(user=>user.id))}`;
  if(department)await tx`update departments set manager_employee_id=null where id=${department.id}`;
  if(employees.length)await tx`delete from employees where id in ${tx(employees)}`;
  if(department)await tx`delete from departments where id=${department.id}`;
 });
 await sql.end();
}
