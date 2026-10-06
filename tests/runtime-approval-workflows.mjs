// Real PostgreSQL service integration. Fixtures and all their mutations roll back.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'node_modules/.cache/workflow-tests/services.mjs');
fs.mkdirSync(path.dirname(out),{recursive:true});
await build({stdin:{contents:"export * from './app/approvals/workflow-service.ts';export * from './app/leave/leave-service.ts';export * from './app/attendance/attendance-service.ts';export * from './app/approvals/approval-aggregation.ts';",resolveDir:root,loader:'ts'},outfile:out,bundle:true,platform:'node',format:'esm',packages:'external'});
const service=await import(pathToFileURL(out).href);
const local=fs.readFileSync(path.join(root,'.dev.vars'),'utf8');
const url=process.env.DATABASE_URL||local.match(/^DATABASE_URL\s*=\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g,'');
const sql=postgres(url,{max:3,connect_timeout:10});
function adapter(tx){return {prepare(query){let values=[];const execute=()=>{let i=0;return tx.unsafe(query.replace(/\?/g,()=>`$${++i}`),values);};return {bind(...args){values=args;return this;},async first(){return (await execute())[0]??null;},async all(){return {results:await execute()};},async run(){return {results:await execute()};}};},transaction:fn=>tx.savepoint(inner=>fn(adapter(inner)))};}
const rollback=new Error('TEST_ROLLBACK');let assertions=0;
try{
 await sql.begin(async tx=>{
  const db=adapter(tx),tag=`workflow-test-${Date.now()}`;
  const [company]=await tx`INSERT INTO companies(name) VALUES (${tag}) RETURNING id`;
  const [otherCompany]=await tx`INSERT INTO companies(name) VALUES (${tag+'-other'}) RETURNING id`;
  const [role]=await tx`SELECT id FROM roles WHERE name='Employee' LIMIT 1`;
  const people=[];
  for(let n=0;n<5;n++){
   const [employee]=await tx`INSERT INTO employees(employee_code,name_en,name_ar,work_email,start_date,country,company_id,work_days) VALUES (${tag+n},${'Test '+n},${'اختبار '+n},${tag+n+'@example.invalid'},'2025-01-01','Egypt',${company.id},'0,1,2,3,4,5,6') RETURNING id`;
   const [user]=await tx`INSERT INTO users(employee_id,email,role_id,status) VALUES (${employee.id},${tag+n+'@example.invalid'},${role.id},'active') RETURNING id`;
   people.push({employeeId:employee.id,id:user.id,roleName:'Employee'});
  }
  const [owner,a,b,c,outsider]=people;
  const [workflow]=await tx`INSERT INTO approval_workflows(company_id,request_type,steps_json,updated_by) VALUES (${company.id},'expense',${JSON.stringify([a,b,c].map(p=>({kind:'user',userId:p.id})))},${a.id}) RETURNING id`;
  const snapshot=await service.resolveWorkflow(db,owner.employeeId,'expense');
  assert.deepEqual(snapshot.steps.map(s=>s.userId),[a.id,b.id,c.id]);assertions++;
  assert.equal(await service.resolveWorkflow(db,owner.employeeId,'other'),null);assertions++;
  await tx`UPDATE employees SET company_id=${otherCompany.id} WHERE id=${owner.employeeId}`;
  assert.equal(await service.resolveWorkflow(db,owner.employeeId,'expense'),null);assertions++;
  await tx`UPDATE employees SET company_id=${company.id} WHERE id=${owner.employeeId}`;
  const [request]=await tx`INSERT INTO requests(request_code,employee_id,type,reason) VALUES (${tag},${owner.employeeId},'Expense reimbursement','Test') RETURNING id`;
  await service.attachWorkflow(db,'employee_request',request.id,snapshot);
  await tx`UPDATE approval_workflows SET steps_json=${JSON.stringify([{kind:'user',userId:outsider.id}])},version=2 WHERE id=${workflow.id}`;
  const rows=[{id:request.id}];await service.enrichWorkflowRows(db,rows,'employee_request');
  assert.deepEqual(rows[0].approval_workflow.steps.map(s=>s.userId),[a.id,b.id,c.id]);assertions++;
  await assert.rejects(()=>service.decideWorkflow(db,'employee_request',request.id,b.id,'workflow:0','approve'),e=>e.status===403);assertions++;
  await tx`UPDATE users SET status='inactive' WHERE id=${a.id}`;
  const unavailable=[{id:request.id}];await service.enrichWorkflowRows(db,unavailable,'employee_request');
  assert.equal(unavailable[0].workflow_unavailable,true);assertions++;
  await assert.rejects(()=>service.decideWorkflow(db,'employee_request',request.id,a.id,'workflow:0','approve'),e=>e.status===403);assertions++;
  await tx`UPDATE users SET status='active' WHERE id=${a.id}`;
  assert.equal((await service.decideWorkflow(db,'employee_request',request.id,a.id,'workflow:0','approve')).currentStage,'workflow:1');assertions++;
  await assert.rejects(()=>service.decideWorkflow(db,'employee_request',request.id,a.id,'workflow:0','approve'),e=>e.status===409);assertions++;
  assert.equal((await service.decideWorkflow(db,'employee_request',request.id,b.id,'workflow:1','approve')).balanceAction,'none');assertions++;
  assert.equal((await service.decideWorkflow(db,'employee_request',request.id,c.id,'workflow:2','approve')).balanceAction,'consume');assertions++;
  // A named employee approver sees only the requests in their snapshot.
  const ownQueue=await service.aggregateApprovals(db,{id:a.id,employee_id:a.employeeId,role_name:'Employee',department_id:null});
  assert.ok(ownQueue.items.some(i=>i.source_id===request.id));assertions++;
  const otherQueue=await service.aggregateApprovals(db,{id:outsider.id,employee_id:outsider.employeeId,role_name:'Employee',department_id:null});
  assert.equal(otherQueue.items.length,0);assertions++;
  await tx`UPDATE approval_workflows SET steps_json=${JSON.stringify([{kind:'user',userId:owner.id}])} WHERE id=${workflow.id}`;
  await assert.rejects(()=>service.resolveWorkflow(db,owner.employeeId,'expense'),e=>e.status===409);assertions++;
  // Leave: submission reserves balance, first approval keeps it reserved, last consumes it.
  const [leaveType]=await tx`INSERT INTO leave_types(code,name_en,name_ar,default_days,status) VALUES (${tag},'Workflow test leave','إجازة اختبار',30,'active') RETURNING id`;
  await tx`INSERT INTO employee_leave_types(employee_id,leave_type_id) VALUES (${owner.employeeId},${leaveType.id})`;
  await tx`INSERT INTO approval_workflows(company_id,request_type,steps_json,updated_by) VALUES (${company.id},${'leave:'+leaveType.id},${JSON.stringify([a,b].map(p=>({kind:'user',userId:p.id})))},${a.id})`;
  const httpRequest=new Request('http://localhost/test');
  const leave=await service.createLeaveRequest({db,request:httpRequest,actor:owner,employeeId:owner.employeeId,leaveTypeId:leaveType.id,fromDate:'2027-02-03',toDate:'2027-02-03',reason:'Test workflow'});
  assert.equal(leave.currentStage,'workflow:0');assertions++;
  const balance=async()=>(await tx`SELECT used,pending FROM leave_balances WHERE employee_id=${owner.employeeId} AND leave_type_id=${leaveType.id}`)[0];
  assert.equal((await balance()).pending,1);assertions++;
  await service.processLeaveRequest({db,request:httpRequest,actor:a,requestId:leave.id,expectedStage:'workflow:0',decision:'approve'});
  assert.equal((await balance()).pending,1);assert.equal((await balance()).used,0);assertions+=2;
  await service.processLeaveRequest({db,request:httpRequest,actor:b,requestId:leave.id,expectedStage:'workflow:1',decision:'approve'});
  const monthQueue=await service.aggregateApprovals(db,{id:a.id,employee_id:a.employeeId,role_name:'Employee',department_id:null});
  assert.equal(monthQueue.metrics.approvedThisMonth,1);assertions++;
  assert.equal((await balance()).pending,0);assert.equal((await balance()).used,1);assertions+=2;
  await assert.rejects(()=>service.processLeaveRequest({db,request:httpRequest,actor:b,requestId:leave.id,expectedStage:'workflow:1',decision:'approve'}));assertions++;
  await service.cancelLeaveRequest({db,request:httpRequest,actor:owner,requestId:leave.id});
  assert.equal((await balance()).used,0);assertions++;
  const rejected=await service.createLeaveRequest({db,request:httpRequest,actor:owner,employeeId:owner.employeeId,leaveTypeId:leaveType.id,fromDate:'2027-02-04',toDate:'2027-02-04',reason:'Test reject'});
  await service.processLeaveRequest({db,request:httpRequest,actor:a,requestId:rejected.id,expectedStage:'workflow:0',decision:'reject',reason:'Test'});
  assert.equal((await balance()).pending,0);assertions++;
  await tx`UPDATE employees SET manager_id=${a.employeeId} WHERE id=${owner.employeeId}`;
  const behalf=await service.createLeaveRequest({db,request:httpRequest,actor:{...a,roleName:'Department Manager'},employeeId:owner.employeeId,leaveTypeId:leaveType.id,fromDate:'2027-02-05',toDate:'2027-02-05',reason:'Test on behalf',onBehalf:'manager'});
  assert.equal(behalf.currentStage,'workflow:0');assert.equal((await balance()).used,0);assertions+=2;
  await service.cancelLeaveRequest({db,request:httpRequest,actor:owner,requestId:behalf.id});
  // Attendance correction does not change the actual clock time before final approval.
  await tx`INSERT INTO approval_workflows(company_id,request_type,steps_json,updated_by) VALUES (${company.id},'attendance_correction',${JSON.stringify([a,b].map(p=>({kind:'user',userId:p.id})))},${a.id})`;
  const date=new Date().toISOString().slice(0,10);
  const correction=await service.submitAttendanceCorrection({db,request:httpRequest,actor:owner,employeeId:owner.employeeId,attendanceDate:date,correctionType:'forgot_check_in',requestedTime:'09:00',reason:'Test',windowDays:30});
  await service.processAttendanceCorrection({db,request:httpRequest,actor:a,correctionId:correction.id,expectedStage:'workflow:0',decision:'approve'});
  const [beforeFinal]=await tx`SELECT actual_in FROM daily_attendance WHERE employee_id=${owner.employeeId} AND work_date=${date}`;
  assert.ok(!beforeFinal?.actual_in);assertions++;
  await service.processAttendanceCorrection({db,request:httpRequest,actor:b,correctionId:correction.id,expectedStage:'workflow:1',decision:'approve'});
  const [afterFinal]=await tx`SELECT actual_in FROM daily_attendance WHERE employee_id=${owner.employeeId} AND work_date=${date}`;
  assert.equal(afterFinal.actual_in,'09:00');assertions++;
  throw rollback;
 }).catch(error=>{if(error!==rollback)throw error;});
 console.log(`${assertions} workflow integration assertions passed; all fixtures rolled back.`);
 // Two independent PostgreSQL connections compete for the same stage in an isolated test schema.
 const schema=`workflow_concurrency_${process.pid}`;
 try{
  await sql.unsafe(`CREATE SCHEMA ${schema}`);
  for(const table of ['employees','users','approval_workflow_runs'])await sql.unsafe(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING DEFAULTS)`);
  await sql.unsafe(`INSERT INTO ${schema}.employees (id,employee_code,name_en,name_ar,work_email,start_date,country) VALUES (1,'one','one','one','one@example.invalid','2025-01-01','Egypt'),(2,'two','two','two','two@example.invalid','2025-01-01','Egypt'),(3,'three','three','three','three@example.invalid','2025-01-01','Egypt')`);
  await sql.unsafe(`INSERT INTO ${schema}.users (id,employee_id,email,role_id,status) VALUES (1,2,'two@example.invalid',1,'active'),(2,3,'three@example.invalid',1,'active')`);
  await sql.unsafe(`INSERT INTO ${schema}.approval_workflow_runs (id,source_type,source_id,employee_id,company_id,workflow_id,version,request_type,steps_json,current_user_id) VALUES (1,'employee_request',1,1,1,1,1,'expense',$1,1)`,[JSON.stringify([{userId:1,name:'A',nameAr:'A'},{userId:2,name:'B',nameAr:'B'}])]);
  const decide=()=>sql.begin(async tx=>{await tx.unsafe(`SET LOCAL search_path TO ${schema},public`);return service.decideWorkflow(adapter(tx),'employee_request',1,1,'workflow:0','approve');});
  const results=await Promise.allSettled([decide(),decide()]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  const [run]=await sql.unsafe(`SELECT current_step,state FROM ${schema}.approval_workflow_runs WHERE id=1`);
  assert.equal(run.current_step,1);assert.equal(run.state,'pending');
  console.log('Concurrent duplicate decision: exactly one success; second rejected; next stage preserved.');
 }finally{await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}
}finally{await sql.end({timeout:5});fs.rmSync(out,{force:true});}
