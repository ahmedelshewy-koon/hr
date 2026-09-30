// Local integration fixtures are always removed; existing accounts are read only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import postgres from 'postgres';
const vars=Object.fromEntries(fs.readFileSync('.dev.vars','utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const base=process.env.COMPANY_HR_TEST_URL||'http://localhost:3000';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const sql=postgres(vars.DATABASE_URL,{max:1}), marker=`company-hr-${Date.now()}`,employees=[],users=[];
let companyId,departmentId;
function session(u){const p=Buffer.from(JSON.stringify({userId:u.id,email:u.email,sessionVersion:u.session_version||1,exp:Math.floor(Date.now()/1000)+1800})).toString('base64url');return `koon_portal_session=${p}.${crypto.createHmac('sha256',vars.KOON_AUTH_SECRET).update(p).digest('base64url')}`;}
async function call(u,body,status=200,path='/api/hr'){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie:session(u),origin:base,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const text=await r.text();assert.equal(r.status,status,`${path}: ${text}`);return JSON.parse(text);}
async function actor(name,role,hr=null){const [e]=await sql`INSERT INTO employees(employee_code,name_en,name_ar,work_email,start_date,country,department_id,company_id,hr_user_id) VALUES(${marker+name},${marker+name},${marker+name},${marker+name+'@example.invalid'},'2020-01-01','Egypt',${departmentId},${companyId},${hr}) RETURNING id`;employees.push(e.id);const [u]=await sql`INSERT INTO users(email,employee_id,role_id,status,must_change_password) VALUES(${marker+name+'@example.invalid'},${e.id},(SELECT id FROM roles WHERE name=${role}),'active',0) RETURNING id,email,employee_id`;users.push(u.id);return u;}
try{
  const [admin]=await sql`SELECT u.id,u.email,u.session_version FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Super Admin' AND u.status='active' LIMIT 1`;
  companyId=(await call(admin,{action:'save_company',name:marker})).id;
  await call(admin,{action:'save_company',companyId,name:marker+' updated'});
  await call(admin,{action:'save_company',name:marker+' updated'},409);
  const [d]=await sql`INSERT INTO departments(name_en,name_ar) VALUES(${marker},${marker}) RETURNING id`;departmentId=d.id;
  const hr1=await actor('hr1','HR Manager'),hr2=await actor('hr2','HR Manager'),manager=await actor('manager','Department Manager');
  await sql`UPDATE departments SET manager_employee_id=${manager.employee_id} WHERE id=${departmentId}`;
  for(const hr of [hr1,hr2])await call(admin,{action:'save_hr_responsible',hrUserId:hr.id});
  const staff1=await actor('staff1','Employee',hr1.id),staff2=await actor('staff2','Employee',hr2.id),unassigned=await actor('unassigned','Employee');
  const [leave]=await sql`SELECT id FROM leave_types WHERE status='active' AND code<>'OFFICIAL' LIMIT 1`;
  const form={leaveTypeIds:[leave.id],nameAr:marker+' api',nameEn:marker+' api',workEmail:marker+'api@example.invalid',startDate:'2026-09-25',country:'Egypt',companyId,hrUserId:hr1.id};
  const created=(await call(admin,{action:'create_employee',...form},201)).id;employees.push(created);
  await call(admin,{action:'update_employee',employeeId:created,...form,hrUserId:hr2.id});
  const {companyId:ignoredCompany,hrUserId:ignoredHr,...legacy}=form;void ignoredCompany;void ignoredHr;
  await call(admin,{action:'update_employee',employeeId:created,...legacy});
  const [saved]=await sql`SELECT company_id,hr_user_id FROM employees WHERE id=${created}`;assert.deepEqual(saved,{company_id:companyId,hr_user_id:hr2.id});
  const catalog=await call(admin);assert.ok(catalog.companies.some(x=>x.id===companyId));assert.ok(catalog.hrResponsibles.some(x=>x.user_id===hr1.id));assert.ok(catalog.hrCandidates.some(x=>x.user_id===hr2.id));
  console.log('PASS company/HR catalogs, create, update, legacy preservation');
  const request={action:'create_request',type:'Other request',requestDate:'2026-11-01',fromDate:'2026-11-01',toDate:'2026-11-01',reason:marker};
  const rejected=await fetch(base+'/api/hr',{method:'POST',headers:{cookie:session(unassigned),origin:base,'content-type':'application/json'},body:JSON.stringify(request)});assert.ok([400,409].includes(rejected.status),`Missing HR status ${rejected.status}: ${await rejected.text()}`);
  assert.equal(Number((await sql`SELECT count(*) FROM requests WHERE employee_id=${unassigned.employee_id}`)[0].count),0);
  const id1=(await call(staff1,request,201)).id,id2=(await call(staff2,request,201)).id;
  const approve=(u,id,status=200)=>call(u,{action:'request_action',requestId:id,decision:'approve'},status);
  assert.equal((await approve(manager,id1)).status,'pending_hr');assert.equal((await approve(manager,id2)).status,'pending_hr');
  await approve(hr2,id1,403);
  assert.equal(Number((await sql`SELECT count(*) FROM approvals WHERE request_id=${id1} AND stage='hr'`)[0].count),0);
  const scoped=await call(hr1);assert.ok(scoped.requests.some(x=>Number(x.id)===Number(id1)));assert.ok(!scoped.requests.some(x=>Number(x.id)===Number(id2)));
  const inbox=await call(hr1,undefined,200,'/api/approvals');assert.ok(inbox.items.some(x=>x.id===`request:${id1}`));assert.ok(!inbox.items.some(x=>x.id===`request:${id2}`));
  assert.equal((await approve(hr1,id1)).status,'hr_approved');
  await call(admin,{action:'save_hr_responsible',hrUserId:hr2.id,active:false});
  await approve(hr2,id2,409);
  assert.equal(Number((await sql`SELECT count(*) FROM approvals WHERE request_id=${id2} AND stage='hr'`)[0].count),0);
  console.log('PASS missing HR rollback, manager → assigned HR, wrong/inactive HR denial, list and aggregate scope');
  const report=await call(admin,undefined,200,`/api/reports?type=missing_employee_data&employeeId=${created}`);assert.equal(report.rows.length,1);
  const download=await fetch(`${base}/api/reports?type=missing_employee_data&format=xlsx&employeeId=${created}`,{headers:{cookie:session(admin)}});assert.equal(download.status,200);assert.ok(download.headers.get('content-type').includes('spreadsheetml'));assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0,2).toString(),'PK');
  console.log('PASS filtered missing-data JSON and XLSX download');
}finally{
  await sql.begin(async tx=>{
    const found=await tx`SELECT id FROM employees WHERE work_email LIKE ${marker+'%'} `;const ids=[...new Set([...employees,...found.map(x=>x.id)])];
    if(ids.length){
      await tx`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE employee_id IN ${sql(ids)}) OR (entity_type='request' AND entity_id IN (SELECT id::text FROM requests WHERE employee_id IN ${sql(ids)}))`;
      await tx`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE employee_id IN ${sql(ids)}) OR (record_type='employee' AND record_id IN ${sql(ids.map(String))}) OR new_value LIKE ${'%'+marker+'%'} OR (record_type='save_hr_responsible' AND (new_value::jsonb->'payload'->>'hrUserId')::int IN ${sql(users.length?users:[-1])})`;
      await tx`DELETE FROM approvals WHERE request_id IN (SELECT id FROM requests WHERE employee_id IN ${sql(ids)})`;
      await tx`DELETE FROM requests WHERE employee_id IN ${sql(ids)}`;
      for(const table of ['employee_leave_types','leave_balances'])await tx`DELETE FROM ${sql(table)} WHERE employee_id IN ${sql(ids)}`;
      await tx`UPDATE employees SET hr_user_id=NULL,manager_id=NULL WHERE id IN ${sql(ids)}`;
      await tx`DELETE FROM hr_responsibles WHERE user_id IN (SELECT id FROM users WHERE employee_id IN ${sql(ids)})`;
      await tx`DELETE FROM users WHERE employee_id IN ${sql(ids)}`;
      await tx`DELETE FROM employees WHERE id IN ${sql(ids)}`;
    }
    if(departmentId)await tx`DELETE FROM departments WHERE id=${departmentId}`;
    await tx`DELETE FROM companies WHERE name LIKE ${marker+'%'}`;
  });await sql.end();console.log('Test fixtures cleaned.');
}



