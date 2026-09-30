// Local API integration audit. Dedicated fixtures are removed even on failure.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import postgres from 'postgres';

const vars=Object.fromEntries(fs.readFileSync('.dev.vars','utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const base=process.env.REQUEST_TEST_URL||'http://localhost:3000';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Local test server required');
const sql=postgres(vars.DATABASE_URL,{max:1});
const marker=`workflow-audit-${Date.now()}`, employees=[], users=[], departments=[], results=[];
function session(user){const p=Buffer.from(JSON.stringify({userId:user.id,email:user.email,sessionVersion:1,exp:Math.floor(Date.now()/1000)+1800})).toString('base64url');return `koon_portal_session=${p}.${crypto.createHmac('sha256',vars.KOON_AUTH_SECRET).update(p).digest('base64url')}`;}
async function call(user,path,body,status=200){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie:session(user),origin:base,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,status,`${path}: ${JSON.stringify(data)}`);return data;}
async function actor(name,role,department,manager=null){const [e]=await sql`INSERT INTO employees(employee_code,name_en,name_ar,work_email,start_date,country,department_id,manager_id,work_days) VALUES(${marker+name},${marker+name},${marker+name},${marker+name+'@example.invalid'},'2020-01-01','Egypt',${department},${manager},'0,1,2,3,4,5,6') RETURNING id`;employees.push(e.id);const [u]=await sql`INSERT INTO users(email,employee_id,role_id,status,must_change_password) VALUES(${marker+name+'@example.invalid'},${e.id},(SELECT id FROM roles WHERE name=${role}),'active',0) RETURNING id,email,employee_id`;users.push(u.id);return u;}
async function notification(user,id,key,entity='request'){const d=await call(user,'/api/notifications?limit=50');assert.ok(d.notifications.some(n=>n.entity_type===entity&&String(n.entity_id)===String(id)&&n.title_key===key),`${key} notification for ${id}`);}
try{
  for(const suffix of ['main','outside']){const [d]=await sql`INSERT INTO departments(name_en,name_ar) VALUES(${marker+suffix},${marker+suffix}) RETURNING id`;departments.push(d.id);}
  const manager=await actor('manager','Department Manager',departments[0]);
  await sql`UPDATE departments SET manager_employee_id=${manager.employee_id} WHERE id=${departments[0]}`;
  const supervisor=await actor('supervisor','Employee',departments[0],manager.employee_id);
  const employee=await actor('employee','Employee',departments[0],supervisor.employee_id);
  const hr=await actor('hr','HR Manager',departments[1]);
  const outsider=await actor('outsider','Department Manager',departments[0]);
  await sql`UPDATE departments SET manager_employee_id=${outsider.employee_id} WHERE id=${departments[1]}`;
  const types=await sql`SELECT id,code,name_en,manager_approval,hr_approval,attachment_required FROM leave_types WHERE status='active' AND code<>'OFFICIAL' ORDER BY id`;
  console.log('LEAVE_CONFIGURATION',JSON.stringify(types));
  for(const t of types)await sql`INSERT INTO employee_leave_types(employee_id,leave_type_id) VALUES(${employee.employee_id},${t.id})`;
  const [doc]=await sql`INSERT INTO documents(employee_id,name,category,status,object_key,content_type,size_bytes,uploaded_by_user_id) VALUES(${employee.employee_id},${marker+'-medical.pdf'},'medical_certificate','active',${marker+'/medical.pdf'},'application/pdf',100,${employee.id}) RETURNING id`;
  let day=0;
  const cases=[...['Work from home','Late arrival','Early departure','Expense reimbursement','Experience certificate','Other request'].map(type=>({type})),...types.map(t=>({type:t.name_en,leaveTypeId:t.id,details:{attachmentDocumentId:t.code==='SICK'||t.attachment_required?doc.id:null}}))];
  for(const payload of cases){
    const date=new Date(Date.UTC(2026,10,2+day++)).toISOString().slice(0,10);
    const created=await call(employee,'/api/hr',{action:'create_request',...payload,fromDate:date,toDate:date,requestDate:date,amount:125,currency:'SAR',reason:marker},201),id=created.id;
    const act=(who,decision='approve',status=200)=>call(who,'/api/hr',{action:'request_action',requestId:id,decision},status);
    const portal=async status=>{const d=await call(employee,'/api/hr');assert.equal(d.requests.find(x=>Number(x.id)===Number(id))?.status,status);};
    await portal('pending_manager');
    await notification(manager,id,'request_needs_manager_approval');
    for(const unauthorized of [supervisor,outsider]){const inbox=await call(unauthorized,'/api/notifications?limit=50');assert.ok(!inbox.notifications.some(n=>n.entity_type==='request'&&String(n.entity_id)===String(id)&&n.title_key==='request_needs_manager_approval'),'Only authorized department managers receive approval notifications');}
    let approvals=await call(manager,'/api/approvals');assert.equal(approvals.items.find(x=>x.id===`request:${id}`)?.actionable,true);
    await act(hr,'approve',403);await act(outsider,'approve',403);await act(employee,'approve',403);
    assert.equal((await act(manager)).status,'pending_hr');await portal('pending_hr');
    await act(manager,'approve',403);await notification(hr,id,'request_needs_hr_approval');
    approvals=await call(hr,'/api/approvals');assert.equal(approvals.items.find(x=>x.id===`request:${id}`)?.actionable,true);
    assert.equal((await act(hr)).status,'hr_approved');await portal('hr_approved');
    await notification(employee,id,'request_approved');await act(hr,'approve',409);
    const history=await sql`SELECT stage,action FROM approvals WHERE request_id=${id} ORDER BY id`;
    assert.deepEqual([...history],[{stage:'manager',action:'approve'},{stage:'hr',action:'approve'}]);
    if(payload.leaveTypeId){const [b]=await sql`SELECT pending,used FROM leave_balances WHERE employee_id=${employee.employee_id} AND leave_type_id=${payload.leaveTypeId} AND year=2026`;assert.equal(Number(b.pending),0);}
    results.push({type:payload.type,result:'PASS',checks:'employee → manager → HR → employee status and notification; scope, order, duplicate decision, history'});console.log('PASS',payload.type);
  }
  for(const correctionType of ['forgot_check_in','forgot_check_out','wrong_check_in','wrong_check_out','late_justification','early_departure_justification','other']){
    const attendanceDate=new Date(Date.now()-86400000).toISOString().slice(0,10);
    const created=await call(employee,'/api/hr',{action:'submit_attendance_correction',attendanceDate,correctionType,requestedTime:correctionType.includes('out')?'17:00':'09:00',reason:marker},201),id=created.id;
    const act=(who,status=200)=>call(who,'/api/hr',{action:'attendance_correction_action',correctionId:id,decision:'approve'},status);
    await notification(manager,id,'correction_needs_manager_approval','attendance_correction');
    await act(hr,403);await act(outsider,403);await act(employee,403);
    assert.equal((await act(manager)).status,'pending_hr');
    await notification(hr,id,'correction_needs_hr_approval','attendance_correction');
    await act(manager,403);assert.equal((await act(hr)).status,'resolved');
    await notification(employee,id,'correction_approved','attendance_correction');
    const portal=await call(employee,'/api/hr');assert.equal(portal.attendanceCorrections.find(c=>Number(c.id)===Number(id))?.status,'resolved');
    await act(hr,409);results.push({type:correctionType,result:'PASS'});console.log('PASS',correctionType);
  }
  console.log(JSON.stringify({passed:results.length,results},null,2));
}finally{
  await sql.begin(async tx=>{
    if(employees.length){
      await tx`DELETE FROM notifications WHERE user_id IN ${sql(users)} OR (entity_type='request' AND entity_id IN (SELECT id::text FROM requests WHERE employee_id IN ${sql(employees)})) OR (entity_type='attendance_correction' AND entity_id IN (SELECT id::text FROM attendance_corrections WHERE employee_id IN ${sql(employees)}))`;
      await tx`DELETE FROM audit_logs WHERE user_id IN ${sql(users)}`;
      await tx`DELETE FROM approvals WHERE request_id IN (SELECT id FROM requests WHERE employee_id IN ${sql(employees)})`;
      await tx`DELETE FROM requests WHERE employee_id IN ${sql(employees)}`;
      await tx`DELETE FROM attendance_correction_actions WHERE correction_id IN (SELECT id FROM attendance_corrections WHERE employee_id IN ${sql(employees)})`;
      for(const table of ['attendance_exceptions','attendance_corrections','daily_attendance','documents','leave_balances','employee_leave_types'])await tx`DELETE FROM ${sql(table)} WHERE employee_id IN ${sql(employees)}`;
      await tx`DELETE FROM users WHERE id IN ${sql(users)}`;
      await tx`DELETE FROM employees WHERE id IN ${sql(employees)}`;
    }
    if(departments.length)await tx`DELETE FROM departments WHERE id IN ${sql(departments)}`;
  });
  await sql.end();console.log('Test fixtures cleaned.');
}
