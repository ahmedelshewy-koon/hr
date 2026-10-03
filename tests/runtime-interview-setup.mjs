import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import postgres from 'postgres';
const local = fs.readFileSync('.dev.vars','utf8');
const url = process.env.DATABASE_URL || local.match(/^DATABASE_URL\s*=\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url,{max:1});
const base = process.env.RUNTIME_BASE_URL || 'http://localhost:3000';
const stamp=Date.now(), password=randomBytes(24).toString('hex'), salt=randomBytes(16);
const hash=`pbkdf2-sha256$210000$${salt.toString('base64url')}$${pbkdf2Sync(password,salt,210000,32,'sha256').toString('base64url')}`;
let userId, templateId, jobId; const questionIds=[];
try {
 const [role]=await sql`SELECT id FROM roles WHERE name='Super Admin'`;
 const email=`setup.test.${stamp}@hr.local`;
 const [user]=await sql`INSERT INTO users(email,role_id,password_hash,status,must_change_password,session_version) VALUES (${email},${role.id},${hash},'active',0,1) RETURNING id`;
 userId=user.id;
 const headers={'content-type':'application/json',origin:base,'sec-fetch-site':'same-origin'};
 const login=await fetch(`${base}/api/auth`,{method:'POST',headers,body:JSON.stringify({email,password})});
 assert.equal(login.status,200,await login.text()); headers.cookie=login.headers.get('set-cookie').split(';')[0];
 const call=async(payload,status=200)=>{const r=await fetch(`${base}/api/recruitment`,{method:'POST',headers,body:JSON.stringify(payload)});const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));return b;};
 const question=await call({action:'create_question',question:'Setup regression original',questionType:'technical'},201);questionIds.push(question.id);
 const stage={nameEn:'Technical',nameAr:'فنية',durationMinutes:30,aggregationWeight:100,requiredFeedback:true,independentEvaluations:true,interviewers:[{roleKey:'recruiter',required:true}],questionIds:[question.id],criteria:[{nameEn:'Skill',nameAr:'مهارة',weight:100,required:true}]};
 const template=await call({action:'create_template',name:`Regression ${stamp}`,scopeType:'company',stages:[stage]},201);templateId=template.id;
 const job=await call({action:'create_job',title:`Setup regression job ${stamp}`,templateId,status:'draft'},201);jobId=job.id;
 await call({action:'update_template',templateId,name:`Edited ${stamp}`,scopeType:'company',status:'active',stages:[{...stage,durationMinutes:60,nameAr:'معدلة'}]});
 const [saved]=await sql`SELECT s.* FROM interview_template_stages s WHERE template_id=${templateId}`;assert.equal(saved.duration_minutes,60);assert.equal(saved.name_ar,'معدلة');
 await call({action:'update_template',templateId,name:'Should rollback',scopeType:'company',stages:[{...stage,aggregationWeight:50}]},400);
 const [unchanged]=await sql`SELECT name FROM interview_templates WHERE id=${templateId}`;assert.equal(unchanged.name,`Edited ${stamp}`);
 const updated=await call({action:'update_question',questionId:question.id,question:'Setup regression edited',questionType:'technical',status:'active'});questionIds.push(updated.id);
 const [old]=await sql`SELECT question,status FROM interview_questions WHERE id=${question.id}`;assert.equal(old.question,'Setup regression original');assert.equal(old.status,'superseded');
 const [link]=await sql`SELECT q.question_id FROM interview_template_stage_questions q JOIN interview_template_stages s ON s.id=q.template_stage_id WHERE s.template_id=${templateId}`;assert.equal(link.question_id,updated.id);
 await call({action:'update_template',templateId,name:`Edited ${stamp}`,scopeType:'company',status:'inactive',stages:[{...stage,nameAr:'الثانية',aggregationWeight:40,criteria:[{nameEn:'Updated criterion',nameAr:'معيار معدل',weight:100}]},{...stage,nameAr:'الأولى',aggregationWeight:60}]});
 const ordered=await sql`SELECT name_ar FROM interview_template_stages WHERE template_id=${templateId} ORDER BY sort_order`;assert.deepEqual(ordered.map(x=>x.name_ar),['الثانية','الأولى']);
 await call({action:'update_template',templateId,name:`Edited ${stamp}`,scopeType:'company',status:'active',stages:[stage]});
 const [count]=await sql`SELECT count(*)::int AS count FROM interview_template_stages WHERE template_id=${templateId}`;assert.equal(count.count,1);
 const [historical]=await sql`SELECT s.duration_minutes,s.name_ar,q.question_id FROM interview_plan_stages s JOIN interview_plans p ON p.id=s.plan_id JOIN interview_stage_questions q ON q.plan_stage_id=s.id WHERE p.job_id=${jobId}`;
 assert.equal(historical.duration_minutes,30);assert.equal(historical.name_ar,'فنية');assert.equal(historical.question_id,question.id);
 const [employeeRole]=await sql`SELECT id FROM roles WHERE name='Employee'`;
 await sql`UPDATE users SET role_id=${employeeRole.id} WHERE id=${userId}`;
 await call({action:'update_template',templateId,name:'Unauthorized',scopeType:'company',stages:[stage]},403);
 await call({action:'update_question',questionId:updated.id,question:'Unauthorized',questionType:'technical'},403);
 console.log('PASS: create/edit template, stage details, invalid weights rollback, versioned question edits and template relinking.');
} finally {
 if(jobId) await sql`DELETE FROM job_openings WHERE id=${jobId}`;
 if(templateId) await sql`DELETE FROM interview_templates WHERE id=${templateId}`;
 for(const id of questionIds) await sql`DELETE FROM interview_questions WHERE id=${id}`;
 if(userId) { await sql`DELETE FROM audit_logs WHERE user_id=${userId}`; await sql`DELETE FROM users WHERE id=${userId}`; }
 await sql.end();
}
