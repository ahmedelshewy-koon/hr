import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import postgres from 'postgres';
const vars=Object.fromEntries(fs.readFileSync('.dev.vars','utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const sql=postgres(vars.DATABASE_URL,{max:1}),base='http://localhost:3000',marker=`reporting-${Date.now()}`,ids=[],deps=[];
try{
 const [admin]=await sql`SELECT u.id,u.email,u.session_version FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Super Admin' AND u.status='active' LIMIT 1`;
 const p=Buffer.from(JSON.stringify({userId:admin.id,email:admin.email,sessionVersion:admin.session_version,exp:Math.floor(Date.now()/1000)+900})).toString('base64url');
 const cookie=`koon_portal_session=${p}.${crypto.createHmac('sha256',vars.KOON_AUTH_SECRET).update(p).digest('base64url')}`;
 const call=async(body,status=200)=>{const r=await fetch(base+'/api/hr',{method:body?'POST':'GET',headers:{cookie,origin:base,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await r.json();assert.equal(r.status,status,JSON.stringify(result));return result;};
 for(const n of ['a','b']){const [d]=await sql`INSERT INTO departments(name_en,name_ar) VALUES(${marker+n},${marker+n}) RETURNING id`;deps.push(d.id);}
 const [root]=await sql`SELECT id FROM departments WHERE name_en ~* 'Managing Director|Asas Company' AND status!='deleted' ORDER BY id LIMIT 1`;
 if(root)await sql`UPDATE departments SET parent_id=${root.id} WHERE id IN ${sql(deps)}`;
 for(const n of ['boss','supervisor','other']){const [e]=await sql`INSERT INTO employees(employee_code,name_en,name_ar,work_email,start_date,country,department_id,organizational_level) VALUES(${marker+n},${marker+n},${marker+n},${marker+n+'@example.invalid'},'2020-01-01','Egypt',${deps[0]},0) RETURNING id`;ids.push(e.id);}
 const [boss,supervisor,other]=ids;
 await sql`UPDATE departments SET manager_employee_id=${boss} WHERE id=${deps[0]}`;
 await sql`UPDATE employees SET manager_id=${boss},organizational_level=1 WHERE id IN (${supervisor},${other})`;
 const [leave]=await sql`SELECT id FROM leave_types WHERE status='active' AND code<>'OFFICIAL' LIMIT 1`;
 const [job]=await sql`INSERT INTO job_titles(name_en,name_ar,department_id) VALUES(${marker},${marker},${deps[0]}) RETURNING id`;
 const form={nameAr:marker,nameEn:marker,workEmail:marker+'@example.invalid',startDate:'2026-09-25',country:'Egypt',departmentId:deps[0],jobTitleId:job.id,managerId:supervisor,leaveTypeIds:[leave.id]};
 const employee=(await call({action:'create_employee',...form},201)).id;ids.push(employee);
 const [child]=await sql`INSERT INTO employees(employee_code,name_en,name_ar,work_email,start_date,country,department_id,manager_id,organizational_level) VALUES(${marker+'child'},${marker+'child'},${marker+'child'},${marker+'child@example.invalid'},'2020-01-01','Egypt',${deps[0]},${employee},3) RETURNING id`;ids.push(child.id);
 const read=async id=>(await sql`SELECT manager_id,organizational_level FROM employees WHERE id=${id}`)[0];
 assert.deepEqual(await read(employee),{manager_id:supervisor,organizational_level:2});
 await sql`UPDATE employees SET organizational_level=4 WHERE id=${employee}`;
 await sql`UPDATE employees SET employment_status='suspended' WHERE id=${supervisor}`;
 await call({action:'update_employee',...form,employeeId:employee,personalPhone:'01012345678'});
 assert.equal((await read(employee)).organizational_level,4,'Unrelated edits preserve configured level and existing suspended manager');
 await sql`UPDATE employees SET employment_status='active' WHERE id=${supervisor}`;
 await call({action:'update_employee',...form,employeeId:employee,managerId:boss,nameAr:marker+' updated'});
 assert.deepEqual(await read(employee),{manager_id:boss,organizational_level:1});
 assert.equal((await read(child.id)).organizational_level,2);
 const data=await call();const reloaded=data.employees.find(e=>e.id===employee);
 assert.equal(reloaded.manager_name,marker+'boss');assert.equal(reloaded.name_ar,marker+' updated');
 for(const bad of [employee,child.id,2147483647])await call({action:'update_employee',...form,employeeId:employee,managerId:bad},400);
 assert.equal((await read(employee)).manager_id,boss);
 await call({action:'update_employee',...form,employeeId:employee,managerId:other,departmentId:deps[1]});
 assert.equal((await read(employee)).manager_id,other);
 assert.equal((await call()).employees.find(e=>e.id===employee).department_id,deps[1]);
 await call({action:'update_employee',...form,employeeId:employee,managerId:''});
 assert.equal((await read(employee)).manager_id,null);
 if(process.env.REPORTING_UI==='1'){
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
  const browser=await chromium.launch({headless:true});
  try{
   const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
   await context.addCookies([{name:'koon_portal_session',value:cookie.split('=')[1],url:base}]);
   await context.addInitScript(()=>localStorage.setItem('sanad-language','en'));
   const page=await context.newPage();await page.goto(base);
   await page.locator('.sidebar').getByRole('button',{name:'Employees',exact:true}).click();
   await page.getByRole('button',{name:`Edit ${marker}`,exact:true}).click();
   await page.locator('.employee-profile-tabs').getByRole('button',{name:'Employment',exact:true}).click();
   const jobSelect=page.locator('label.field').filter({hasText:/^Job title/}).locator('select');
   const departmentSelect=page.locator('label.field').filter({hasText:/^Department/}).locator('select');
   const catalog=await call();
   assert.equal(await jobSelect.locator('option').count(),catalog.jobTitles.length+1,'All job titles are available across departments');
   const crossDepartmentJob=catalog.jobTitles.find(j=>Number(j.department_id)!==deps[0]);
   assert.ok(crossDepartmentJob);
   await jobSelect.selectOption(String(crossDepartmentJob.id));
   await departmentSelect.selectOption(String(deps[1]));
   assert.equal(await jobSelect.inputValue(),String(crossDepartmentJob.id),'Department change preserves selected job title');
   await departmentSelect.selectOption(String(deps[0]));
   const managerSelect=page.getByLabel('Direct manager',{exact:true});
   await managerSelect.waitFor();
   assert.equal(await managerSelect.locator(`option[value="${employee}"]`).count(),0);
   assert.equal(await managerSelect.locator(`option[value="${child.id}"]`).count(),0);
   await managerSelect.selectOption(String(supervisor));
   await page.evaluate(()=>{window.reportingRefreshes=0;window.addEventListener('hr-data-changed',()=>{window.reportingRefreshes++;});});
   await page.screenshot({path:'tests/reporting-manager-dropdown.png'});
   await page.locator('.employee-profile-modal').getByRole('button',{name:/Save/}).click();
   await page.locator('.employee-profile-modal').waitFor({state:'hidden'});
   assert.ok(await page.evaluate(()=>window.reportingRefreshes>0),'Profile save publishes data refresh');
   assert.equal((await read(employee)).manager_id,supervisor);
   assert.equal((await call()).employees.find(e=>e.id===employee).job_title_id,crossDepartmentJob.id);
   console.log('PASS browser: all job titles available, selection survives department change, cross-department title saves.');
   await page.locator('.sidebar').getByRole('button',{name:/Organization/}).click();
   const card=page.locator('.org-tree-employee').filter({has:page.locator('b',{hasText:marker})});
   await page.getByText(`Reports to: ${marker}supervisor`,{exact:true}).waitFor();
   assert.ok(await card.count()>0);
   await page.screenshot({path:'tests/reporting-manager-chart.png',fullPage:true});
   console.log('PASS browser: dropdown excludes self/descendants; select, save, open chart and see new manager without page reload.');
  }finally{await browser.close();}
  await call({action:'update_employee',...form,employeeId:employee,managerId:''});
 }
 assert.equal((await call()).employees.find(e=>e.id===employee).manager_name,null);
 const {managerId,...legacy}=form;void managerId;
 await call({action:'update_employee',...legacy,employeeId:employee});
 assert.equal((await read(employee)).manager_id,null);
 console.log('PASS: selected manager on create; profile update; descendant levels; fresh chart data; self/cycle/missing manager rejected; department transfer; clear manager; legacy preservation.');
}finally{
 const fixtureIds=(await sql`SELECT id FROM employees WHERE work_email LIKE ${marker+'%'}`).map(e=>e.id);
 if(fixtureIds.length)await sql.begin(async tx=>{
  await tx`DELETE FROM audit_logs WHERE record_type='employee' AND record_id IN ${sql(fixtureIds.map(String))}`;
  for(const table of ['employee_leave_types','leave_balances','users'])await tx`DELETE FROM ${sql(table)} WHERE employee_id IN ${sql(fixtureIds)}`;
  await tx`DELETE FROM employees WHERE id IN ${sql(fixtureIds)}`;
 });
 if(deps.length){await sql`DELETE FROM job_titles WHERE department_id IN ${sql(deps)}`;await sql`DELETE FROM departments WHERE id IN ${sql(deps)}`;}
 await sql.end();console.log('Reporting fixtures cleaned.');
}
