// Local HTTP integration with dedicated disposable fixture accounts and companies only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import postgres from 'postgres';
const vars=Object.fromEntries(fs.readFileSync('.dev.vars','utf8').split(/\r?\n/).filter(s=>/^[A-Z_]+=/.test(s)).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const base=process.env.REQUEST_TEST_URL||'http://localhost:3000';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const sql=postgres(vars.DATABASE_URL,{max:1}),marker=`approval-api-${Date.now()}`,companies=[],employees=[],users=[];
let checks=0;
function cookie(user){const payload=Buffer.from(JSON.stringify({userId:user.id,email:user.email,sessionVersion:1,exp:Math.floor(Date.now()/1000)+1200})).toString('base64url');return `koon_portal_session=${payload}.${crypto.createHmac('sha256',vars.KOON_AUTH_SECRET).update(payload).digest('base64url')}`;}
async function call(user,path,body,expected=200){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie:cookie(user),origin:base,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const text=await response.text();assert.equal(response.status,expected,`${path}: ${text.slice(0,300)}`);checks++;return JSON.parse(text);}
async function actor(name,role){const email=`${marker}-${name}@example.invalid`;const [e]=await sql`INSERT INTO employees(employee_code,name_en,name_ar,work_email,start_date,country,company_id) VALUES (${marker+name},${name},${name},${email},'2025-01-01','Egypt',${companies[0]}) RETURNING id`;employees.push(e.id);const [u]=await sql`INSERT INTO users(email,employee_id,role_id,status,must_change_password) VALUES (${email},${e.id},(SELECT id FROM roles WHERE name=${role}),'active',0) RETURNING id,email,employee_id`;users.push(u.id);return u;}
try{
 for(let i=0;i<2;i++){const [c]=await sql`INSERT INTO companies(name) VALUES (${marker+i}) RETURNING id`;companies.push(c.id);}
 const admin=await actor('admin','Super Admin'),owner=await actor('owner','Employee'),a=await actor('first','Employee'),b=await actor('second','Employee'),outsider=await actor('outsider','Employee');
 await call(outsider,'/api/approval-workflows',undefined,403);
 const catalog=await call(admin,'/api/approval-workflows');assert.ok(catalog.companies.some(c=>c.id===companies[0]));
 const config={companyId:companies[0],requestType:'expense',version:0,active:true,steps:[{kind:'user',userId:a.id},{kind:'user',userId:b.id}]};
 await call(outsider,'/api/approval-workflows',config,403);
 await call(admin,'/api/approval-workflows',{...config,steps:[]},400);
 await call(admin,'/api/approval-workflows',config);
 await call(admin,'/api/approval-workflows',config,409);
 await call(admin,'/api/approval-workflows',{...config,companyId:companies[1],steps:[{kind:'user',userId:b.id}]});
 await call(admin,'/api/approval-workflows',{...config,requestType:'other',steps:[{kind:'user',userId:b.id}]});
 const request=await call(owner,'/api/hr',{action:'create_request',type:'Expense reimbursement',reason:'Dedicated workflow API test',amount:10,currency:'SAR'},201);
 const auth=await call(a,'/api/auth');assert.ok(auth.user.allowed_pages.includes('approvals'));
 const firstQueue=await call(a,'/api/approvals');const item=firstQueue.items.find(i=>i.source_id===request.id);assert.equal(item.actionable,true);assert.equal(item.approval_workflow.steps.length,2);
 const secondQueue=await call(b,'/api/approvals');assert.equal(secondQueue.items.find(i=>i.source_id===request.id).actionable,false);
 await call(outsider,'/api/approvals',undefined,403);
 const decision={sourceType:'employee_request',sourceId:request.id,expectedStage:'workflow:0',decision:'approve'};
 await call(b,'/api/approval-workflows/decide',decision,403);
 await call(owner,'/api/approval-workflows/decide',decision,403);
 await call(admin,'/api/hr',{action:'request_action',requestId:request.id,decision:'approve'},409);
 // Settings changes do not alter the already submitted request.
 await call(admin,'/api/approval-workflows',{...config,version:1,steps:[{kind:'user',userId:outsider.id}]});
 const first=await call(a,'/api/approval-workflows/decide',decision);assert.equal(first.currentStage,'workflow:1');
 await call(a,'/api/approval-workflows/decide',decision,403);
 const final=await call(b,'/api/approval-workflows/decide',{...decision,expectedStage:'workflow:1'});assert.equal(final.status,'hr_approved');
 const [saved]=await sql`SELECT state,current_user_id FROM approval_workflow_runs WHERE source_type='employee_request' AND source_id=${request.id}`;assert.equal(saved.state,'approved');assert.equal(saved.current_user_id,null);
 console.log(`${checks} HTTP checks passed: management permissions, validation, optimistic save, company/type scopes, assigned page access, ordered decisions, immutable submitted path.`);
}finally{
 await sql.begin(async tx=>{
  if(users.length){await tx`DELETE FROM notifications WHERE user_id=ANY(${users}::int[])`;await tx`DELETE FROM audit_logs WHERE user_id=ANY(${users}::int[])`;}
  if(employees.length){await tx`DELETE FROM approvals WHERE request_id IN (SELECT id FROM requests WHERE employee_id=ANY(${employees}::int[]))`;await tx`DELETE FROM approval_workflow_runs WHERE employee_id=ANY(${employees}::int[])`;await tx`DELETE FROM requests WHERE employee_id=ANY(${employees}::int[])`;}
  if(companies.length){await tx`DELETE FROM approval_workflow_versions WHERE workflow_id IN (SELECT id FROM approval_workflows WHERE company_id=ANY(${companies}::int[]))`;await tx`DELETE FROM approval_workflows WHERE company_id=ANY(${companies}::int[])`;}
  if(users.length)await tx`DELETE FROM users WHERE id=ANY(${users}::int[])`;
  if(employees.length)await tx`DELETE FROM employees WHERE id=ANY(${employees}::int[])`;
  if(companies.length)await tx`DELETE FROM companies WHERE id=ANY(${companies}::int[])`;
 });await sql.end({timeout:5});
}
