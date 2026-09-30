import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import {saveOrganizationEntity} from '../app/organization/catalog-service.ts';
import {createEmployeeRecord} from '../app/employees/employee-service.ts';
import {saveEmployeeProfile} from '../app/employees/profile-update.ts';
import {requireEmployeeHr} from '../app/employees/hr-assignment.ts';
import {buildReportingForest} from '../app/organization/reporting-tree.ts';

// Hardcoded isolated endpoint: never reads DATABASE_URL or connects to the live port.
const sql=postgres('postgresql://postgres@127.0.0.1:5659/agency_rehearsal',{max:1});
const {dir}=JSON.parse(fs.readFileSync('outputs/koon-agency-approved-mapping/latest.json','utf8'));
function adapter(tx){return {prepare(source){let values=[];const execute=()=>{let i=0;return tx.unsafe(source.replace(/\?/g,()=>'$'+ ++i),values);};return {bind(...v){values=v;return this;},async all(){return {results:await execute()};},async first(){return (await execute())[0]??null;},async run(){return execute();}};}};}
async function inventory(tx){const rows=await tx`SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN ('public','drizzle') ORDER BY table_schema,table_name`;return Promise.all(rows.map(async r=>{const [value]=await tx.unsafe(`SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM "${r.table_schema}"."${r.table_name}" t`);return {...r,...value};}));}
const passed=[];const check=async(name,fn)=>{await fn();passed.push(name);};const rollback=new Error('ROLLBACK_STAGE3');
try{
  const [server]=await sql`SELECT current_database() AS database,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  assert.equal(server.port,5659);assert.equal(server.database,'agency_rehearsal');assert.equal(path.resolve(server.directory),path.resolve(dir,'cluster'));
  const baseline=await inventory(sql);
  try{await sql.begin(async tx=>{
    await tx`SET LOCAL lock_timeout='5s'`;await tx`SET LOCAL statement_timeout='30s'`;
    const db=adapter(tx),save=(entity,input)=>saveOrganizationEntity(db,entity,input);
    const [actor]=await tx`SELECT id FROM users WHERE status='active' ORDER BY id LIMIT 1`;
    const branch=(await save('branches',{name_en:'Stage3 A',name_ar:'اختبار أ',code:'STAGE3-A'})).id;
    const otherBranch=(await save('branches',{name_en:'Stage3 B',name_ar:'اختبار ب',code:'STAGE3-B'})).id;
    const company=(await save('companies',{name_en:'Stage3',name_ar:'اختبار',branchIds:[branch,otherBranch]})).id;
    const department=(await save('departments',{name_en:'Stage3 department',name_ar:'إدارة اختبار',company_id:company,organization_kind:'department',branch_scope:'all'})).id;
    const section=(await save('departments',{name_en:'Stage3 section',name_ar:'قسم اختبار',company_id:company,organization_kind:'section',parent_id:department,branch_scope:'all'})).id;
    const team=(await save('departments',{name_en:'Stage3 team',name_ar:'فريق اختبار',company_id:company,organization_kind:'team',parent_id:section,branch_scope:'all'})).id;
    const grade=(await save('grades',{name_en:'Stage3 grade',name_ar:'درجة اختبار',code:'STAGE3-G'})).id;
    const location=(await save('workLocations',{name_en:'Stage3 office',name_ar:'مكتب اختبار',code:'STAGE3-W',branch_id:branch})).id;
    const position=(await save('positions',{name_en:'Stage3 position',name_ar:'وظيفة اختبار',code:'STAGE3-P',company_id:company,department_id:department,section_id:section,team_id:team,grade_id:grade})).id;
    const input={nameAr:'اختبار',startDate:'2026-01-01',country:'Egypt',companyId:company,departmentId:department};
    const manager=await createEmployeeRecord(db,{...input,nameEn:'Stage3 manager',workEmail:'stage3-manager@example.invalid'});
    const employee=await createEmployeeRecord(db,{...input,nameEn:'Stage3 employee',workEmail:'stage3-employee@example.invalid'});
    const read=async id=>(await tx`SELECT * FROM employees WHERE id=${id}`)[0];
    const update=async(id,payload)=>saveEmployeeProfile(db,id,payload,actor);
    const before=await read(employee.id);
    await check('audited save persists all organizational fields and preserves every unrelated field',async()=>{
      const payload={branchId:branch,sectionId:section,teamId:team,positionId:position,gradeId:grade,workLocationId:location,managerId:manager.id,assignmentEffectiveDate:'2026-09-26',assignmentBefore:before};
      const {after}=await update(employee.id,payload);
      for(const [key,value] of Object.entries({branch_id:branch,section_id:section,team_id:team,position_id:position,grade_id:grade,work_location_id:location,manager_id:manager.id,assignment_effective_date:'2026-09-26'}))assert.equal(after[key],value);
      const changed=new Set(['branch_id','section_id','team_id','position_id','grade_id','work_location_id','manager_id','assignment_effective_date','updated_at','organizational_level']);
      for(const key of Object.keys(before))if(!changed.has(key))assert.deepEqual(after[key],before[key],key);
      const [audit]=await tx`SELECT * FROM audit_logs WHERE record_type='employee' AND record_id=${String(employee.id)} ORDER BY id DESC LIMIT 1`;
      assert.deepEqual(JSON.parse(audit.previous_value),JSON.parse(JSON.stringify(before)));assert.equal(JSON.parse(audit.new_value).position_id,position);
    });
    await check('stale reviewed snapshot rejects with 409 and preserves employee',async()=>{
      const current=await read(employee.id);await assert.rejects(update(employee.id,{branchId:otherBranch,assignmentBefore:before}),e=>e instanceof Response&&e.status===409);assert.deepEqual(await read(employee.id),current);
    });
    await check('position contradictions, invalid date, wrong location and self/cyclic managers reject',async()=>{
      for(const payload of [{branchId:'invalid'},{gradeId:null},{teamId:null},{assignmentEffectiveDate:'2026-02-30'},{branchId:otherBranch},{managerId:employee.id}])await assert.rejects(update(employee.id,payload),e=>e instanceof Response&&e.status===400);
      await assert.rejects(update(manager.id,{managerId:employee.id}),e=>e instanceof Response&&e.status===400);
    });
    await check('inactive and cross-company managers reject',async()=>{
      const outsider=await createEmployeeRecord(db,{nameEn:'Outside',nameAr:'اختبار',workEmail:'stage3-outside@example.invalid',startDate:'2026-01-01',country:'Egypt'});
      await assert.rejects(update(employee.id,{managerId:outsider.id}));
      await tx`UPDATE employees SET employment_status='suspended' WHERE id=${manager.id}`;
      await update(employee.id,{managerId:null});await assert.rejects(update(employee.id,{managerId:manager.id}));
      await tx`UPDATE employees SET employment_status='active' WHERE id=${manager.id}`;
      await update(employee.id,{managerId:manager.id});
    });
    await check('persisted profile assignments feed existing chart without chart writes',async()=>{
      const rows=await tx`SELECT * FROM employees WHERE id IN (${employee.id},${manager.id})`;
      assert.equal(buildReportingForest(rows).find(n=>n.employee.id===manager.id).children[0].employee.id,employee.id);
    });
    await check('legacy employee edits retain all organizational fields and defaults',async()=>{
      const legacy=(await tx`SELECT * FROM employees WHERE company_id IS NULL AND employment_status='active' ORDER BY id LIMIT 1`)[0];
      const {after}=await update(legacy.id,{nameEn:legacy.name_en+' test'});
      for(const key of Object.keys(legacy))if(!['name_en','updated_at'].includes(key))assert.deepEqual(after[key],legacy[key],key);
    });
    await check('HR rules resolve without populating employee override; explicit override stays separate',async()=>{
      const [role]=await tx`SELECT id FROM roles WHERE name='HR Manager'`;
      const [u]=await tx`INSERT INTO users(email,role_id,status) VALUES ('stage3-hr@example.invalid',${role.id},'active') RETURNING id`;
      const [v]=await tx`INSERT INTO users(email,role_id,status) VALUES ('stage3-override@example.invalid',${role.id},'active') RETURNING id`;
      await tx`INSERT INTO hr_responsibles(user_id,status) VALUES (${u.id},'active'),(${v.id},'active')`;
      await save('hrRules',{company_id:company,branch_id:branch,hr_user_id:u.id});
      assert.equal(await requireEmployeeHr(db,employee.id),u.id);assert.equal((await read(employee.id)).hr_user_id,null);
      await update(employee.id,{hrUserId:v.id});assert.equal(await requireEmployeeHr(db,employee.id),v.id);
      await update(employee.id,{hrUserId:null});assert.equal(await requireEmployeeHr(db,employee.id),u.id);
    });
    await check('audit failure rolls back the employee save',async()=>{
      const current=await read(employee.id);
      await assert.rejects(tx.savepoint(async nested=>{
        const normal=adapter(nested);
        const failing={prepare(source){return normal.prepare(source.startsWith('INSERT INTO audit_logs')?'SELECT 1/0':source);}};
        await saveEmployeeProfile(failing,employee.id,{nameEn:'Must roll back'},actor);
      }));
      assert.deepEqual(await read(employee.id),current);
    });
    await check('pre-readiness fallback still persists validated legacy assignment columns',async()=>{
      const fallback={prepare(source){return db.prepare(source.includes(' AS ready')?'SELECT FALSE AS ready':source);}};
      await saveEmployeeProfile(fallback,manager.id,{departmentId:null},actor);
      assert.equal((await read(manager.id)).department_id,null);
    });
    throw rollback;
  });}catch(error){if(error!==rollback)throw error;}
  assert.deepEqual(await inventory(sql),baseline);
  fs.mkdirSync('outputs/stage3',{recursive:true});fs.writeFileSync('outputs/stage3/isolated-verification.json',JSON.stringify({at:new Date().toISOString(),server,passed,fixtures:'rolled back',allOriginalTablesPreserved:true,liveConnected:false},null,2));
  console.log(JSON.stringify({passed:passed.length,checks:passed,fixtures:'rolled back',allOriginalTablesPreserved:true,liveConnected:false},null,2));
}catch(error){console.error(error instanceof Response?await error.text():error);process.exitCode=1;}finally{await sql.end();}
