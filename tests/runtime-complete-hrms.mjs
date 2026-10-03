import assert from "node:assert/strict";
import {pbkdf2Sync,randomBytes} from "node:crypto";
import postgres from "postgres";

const base=process.env.RUNTIME_BASE_URL||"http://localhost:3000";
const email=process.env.RUNTIME_EMAIL||"runtime.audit.20260822@hr.local";
const password=process.env.RUNTIME_PASSWORD;
if(!password)throw new Error("RUNTIME_PASSWORD is required");
const sql=postgres(process.env.DATABASE_URL||"postgresql://koon_hr_admin@127.0.0.1:5545/koon_hr",{ssl:false,max:1});
const salt=randomBytes(16),hash=pbkdf2Sync(password,salt,210000,32,"sha256"),encoded=`pbkdf2-sha256$210000$${salt.toString("base64url")}$${hash.toString("base64url")}`;
const [role]=await sql`select id from roles where name='Super Admin'`;
await sql`insert into users(email,role_id,password_hash,status,must_change_password,session_version,created_at,updated_at) values(${email},${role.id},${encoded},'active',0,1,current_timestamp,current_timestamp) on conflict(email) do update set password_hash=excluded.password_hash,status='active',must_change_password=0,session_version=users.session_version+1,updated_at=current_timestamp`;

const login=await fetch(`${base}/api/auth`,{method:"POST",headers:{"content-type":"application/json",origin:base,"sec-fetch-site":"same-origin"},body:JSON.stringify({email,password})});
assert.equal(login.status,200,await login.text());const cookie=login.headers.get("set-cookie")?.split(";")[0];assert.ok(cookie,"session cookie");
const call=async(path,payload)=>{const response=await fetch(`${base}${path}`,{method:payload?"POST":"GET",headers:{cookie,origin:base,"sec-fetch-site":"same-origin",...(payload?{"content-type":"application/json"}:{})},body:payload?JSON.stringify(payload):undefined});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`${path} ${response.status}: ${body.error||JSON.stringify(body)}`);return {status:response.status,body};};
const expectStatus=async(path,payload,status)=>{const response=await fetch(`${base}${path}`,{method:"POST",headers:{cookie,origin:base,"sec-fetch-site":"same-origin","content-type":"application/json"},body:JSON.stringify(payload)}),body=await response.json().catch(()=>({}));assert.equal(response.status,status,`${path}: ${JSON.stringify(body)}`);return body;};
const options=(await call("/api/talent/options")).body,manager=options.employees.find(employee=>Number(employee.manager_id)>0)||options.employees[0];assert.ok(manager?.id,"test manager employee");
const stamp=Date.now().toString().slice(-8),date=new Date().toISOString().slice(0,10),future=new Date(Date.now()+90*86400000).toISOString().slice(0,10);

const job=(await call("/api/recruitment",{action:"create_job",title:`Runtime HRMS ${stamp}`,departmentId:manager.department_id,hiringManagerEmployeeId:manager.manager_id||manager.id,location:"Cairo",employmentType:"full_time",openingsCount:1,status:"open"})).body;
const candidate=(await call("/api/recruitment",{action:"add_candidate",jobId:job.id,name:`Runtime Candidate ${stamp}`,email:`runtime.candidate.${stamp}@hr.local`,phone:"01000000000",source:"Runtime audit"})).body;
await call("/api/recruitment",{action:"move_candidate",candidateId:candidate.id,stage:"screening"});await call("/api/recruitment",{action:"move_candidate",candidateId:candidate.id,stage:"interview"});
const interview=(await call("/api/recruitment",{action:"schedule_interview",candidateId:candidate.id,interviewerEmployeeId:manager.id,scheduledAt:new Date(Date.now()+86400000).toISOString(),interviewType:"technical"})).body;
await call("/api/recruitment",{action:"complete_interview",interviewId:interview.id,feedback:"Runtime verified",rating:5,recommendation:"hire"});
await call("/api/recruitment",{action:"move_candidate",candidateId:candidate.id,stage:"final_interview"});await call("/api/recruitment",{action:"move_candidate",candidateId:candidate.id,stage:"offer"});
const offer=(await call("/api/recruitment",{action:"create_offer",candidateId:candidate.id,offerDate:date,joiningDate:date,notes:"Runtime audit offer"})).body;
await call("/api/recruitment",{action:"decide_offer",offerId:offer.id,status:"sent"});await call("/api/recruitment",{action:"decide_offer",offerId:offer.id,status:"accepted"});
const hire=(await call("/api/recruitment",{action:"convert_hire",offerId:offer.id,nameAr:`مرشح اختبار ${stamp}`,country:"Egypt"})).body;assert.ok(hire.employeeId);await expectStatus("/api/recruitment",{action:"convert_hire",offerId:offer.id,nameAr:"duplicate",country:"Egypt"},409);

let lifecycle=(await call(`/api/lifecycle?employeeId=${hire.employeeId}`)).body;const onboarding=lifecycle.lifecycles.find(item=>item.lifecycle_type==="onboarding");assert.ok(onboarding);for(const task of lifecycle.tasks.filter(item=>Number(item.lifecycle_id)===Number(onboarding.id)))await call("/api/lifecycle",{action:"update_task",taskId:task.id,status:"completed",notes:"Runtime complete"});await call("/api/lifecycle",{action:"complete",lifecycleId:onboarding.id});

const asset=(await call("/api/assets",{action:"create",assetCode:`RT-${stamp}`,category:"Laptop",name:"Runtime laptop",brandModel:"AuditBook",serialNumber:`RTSN-${stamp}`,condition:"new"})).body;
await call("/api/assets",{action:"assign",assetId:asset.id,employeeId:hire.employeeId,condition:"new"});await expectStatus("/api/assets",{action:"assign",assetId:asset.id,employeeId:hire.employeeId,condition:"new"},409);
const course=(await call("/api/learning",{action:"create_course",title:`Runtime Safety ${stamp}`,provider:"HR",courseType:"online",startDate:date,endDate:future,mandatory:true,validityMonths:12})).body;
const enrollment=(await call("/api/learning",{action:"enroll",courseId:course.id,employeeId:hire.employeeId,dueDate:future})).body;await expectStatus("/api/learning",{action:"enroll",courseId:course.id,employeeId:hire.employeeId,dueDate:future},409);await call("/api/learning",{action:"update_enrollment",enrollmentId:enrollment.id,status:"in_progress"});const completion=(await call("/api/learning",{action:"update_enrollment",enrollmentId:enrollment.id,status:"completed",completionDate:date,score:96})).body;assert.ok(completion.certificateExpiry);


const offTemplate=options.templates.find(item=>item.lifecycle_type==="offboarding");assert.ok(offTemplate);const off=(await call("/api/lifecycle",{action:"start",lifecycleType:"offboarding",employeeId:hire.employeeId,templateId:offTemplate.id,lastWorkingDate:future,reasonType:"contract_end",deactivateAccountOnCompletion:true})).body;lifecycle=(await call(`/api/lifecycle?employeeId=${hire.employeeId}`)).body;for(const task of lifecycle.tasks.filter(item=>Number(item.lifecycle_id)===Number(off.id)))await call("/api/lifecycle",{action:"update_task",taskId:task.id,status:"completed",notes:"Runtime clearance"});await expectStatus("/api/lifecycle",{action:"complete",lifecycleId:off.id,exitInterview:"Runtime exit interview"},409);await call("/api/assets",{action:"return",assetId:asset.id,condition:"good",notes:"Runtime return"});await call("/api/lifecycle",{action:"complete",lifecycleId:off.id,exitInterview:"Runtime exit interview"});

for(const tab of ["lifecycle","assets","learning"]){const result=await call(`/api/employees/${hire.employeeId}?tab=${tab}`);assert.equal(result.status,200);}
const dashboard=await call("/api/dashboard");assert.ok(dashboard.body.talent);const notifications=await call("/api/notifications");assert.ok(Array.isArray(notifications.body.notifications));
for(const report of ["recruitment","onboarding","offboarding","assets","learning"]){const response=await fetch(`${base}/api/reports?type=${report}&format=csv`,{headers:{cookie}});assert.equal(response.status,200,`${report} report`);assert.match(response.headers.get("content-type")||"",/text\/csv/);}
const [evidence]=await sql`select (select count(*)::int from audit_logs where created_at>current_timestamp-interval '1 hour' and module in ('recruitment','onboarding','offboarding','assets','learning')) as audits,(select count(*)::int from notifications where created_at>current_timestamp-interval '1 hour' and type in ('recruitment','onboarding','assets','learning')) as notifications,(select status from users where employee_id=${hire.employeeId}) as hired_account_status`;
assert.ok(evidence.audits>=10);assert.ok(evidence.notifications>=3);assert.equal(evidence.hired_account_status,"disabled");
console.log(JSON.stringify({jobId:job.id,candidateId:candidate.id,offerId:offer.id,employeeId:hire.employeeId,onboardingId:onboarding.id,assetId:asset.id,courseId:course.id,offboardingId:off.id,audits:evidence.audits,notifications:evidence.notifications,accountStatus:evidence.hired_account_status,reports:5,profileTabs:3},null,2));
await sql.end();
