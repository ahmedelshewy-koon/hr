import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import {saveOrganizationEntity,previewOrganizationEntity,deleteOrganizationEntity} from '../app/organization/catalog-service.ts';
import {createEmployeeRecord} from '../app/employees/employee-service.ts';
import {saveEmployeeProfile} from '../app/employees/profile-update.ts';
import {previewTeamTransfer,commitTeamTransfer} from '../app/organization/team-transfer.ts';
import {saveJobTitle,previewJobTitle} from '../app/organization/job-title-service.ts';

// Isolated only: hard-coded disposable cluster (outputs/org-manageability/setup-cluster.mjs). Never reads
// DATABASE_URL and never connects to the live port. Every fixture write happens in one transaction that is
// rolled back; full table fingerprints are compared before and after.
const {cluster,port,database}=JSON.parse(fs.readFileSync('outputs/org-manageability/cluster.json','utf8'));
assert.notEqual(port,5545);
const sql=postgres(`postgresql://koon_hr_admin@127.0.0.1:${port}/${database}`,{max:1});
function adapter(tx){return {prepare(source){let values=[];const execute=()=>{let i=0;return tx.unsafe(source.replace(/\?/g,()=>'$'+ ++i),values);};return {bind(...v){values=v;return this;},async all(){return {results:await execute()};},async first(){return (await execute())[0]??null;},async run(){return execute();}};},async batch(){throw new Error('unused');}};}
async function inventory(tx){const rows=await tx`SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN ('public','drizzle') ORDER BY 1,2`;const out={};for(const r of rows){const [v]=await tx.unsafe(`SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM "${r.table_schema}"."${r.table_name}" t`);out[`${r.table_schema}.${r.table_name}`]=v;}return out;}
/** Rejection with a structured organizational code. */
async function rejects(promise,code,status){
  const error=await promise.then(()=>null,e=>e);
  assert.ok(error,`expected rejection ${code}`);
  const body=error instanceof Response?await error.clone().json().catch(async()=>({error:await error.clone().text()})):error;
  if(status)assert.equal(error.status,status,`${code}: status`);
  assert.equal(body.code,code,`expected ${code}, got ${body.code}: ${body.error??body.message}`);
  return body;
}
const passed=[];const check=async(name,fn)=>{try{await fn();}catch(error){if(error instanceof Response)throw new Error(`${name}: unexpected ${error.status} ${await error.text()}`);throw error;}passed.push(name);console.log('✔',name);};const rollback=new Error('ROLLBACK_ORG_MANAGEABILITY');
const result={startedAt:new Date().toISOString(),database:`127.0.0.1:${port}/${database}`};
try{
  const [server]=await sql`SELECT current_database() AS database,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  assert.equal(server.port,port);assert.equal(server.database,database);assert.equal(path.resolve(server.directory),path.resolve(cluster));
  const baseline=await inventory(sql);
  try{await sql.begin(async tx=>{
    await tx`SET LOCAL lock_timeout='5s'`;await tx`SET LOCAL statement_timeout='60s'`;
    const db=adapter(tx);const [actor]=await tx`SELECT id FROM users WHERE status='active' ORDER BY id LIMIT 1`;
    const read=async id=>(await tx`SELECT * FROM employees WHERE id=${id}`)[0];
    const save=(id,payload)=>saveEmployeeProfile(db,id,payload,actor);
    const reviewOf=row=>Object.fromEntries(['company_id','branch_id','department_id','section_id','team_id','position_id','grade_id','work_location_id','job_title_id','manager_id','hr_user_id','assignment_effective_date'].map(k=>[k,row[k]??null]));
    const auditCount=async()=>(await tx`SELECT count(*)::int c FROM audit_logs`)[0].c;

    // Fixture: a legacy employee (legacy unit U4 + title T14 bound to U4), created then set to the legacy state.
    const legacy=await createEmployeeRecord(db,{nameEn:'Legacy fixture',nameAr:'موظف قديم',workEmail:'legacy-fixture@example.invalid',startDate:'2026-01-01',country:'Egypt'});
    await tx`UPDATE employees SET department_id=4,job_title_id=14 WHERE id=${legacy.id}`;

    await check('legacy Department + legacy Title → new Company/Branch/Department/Position/Title in one audited save',async()=>{
      const before=await read(legacy.id);
      const {after}=await save(legacy.id,{companyId:5,branchId:3,departmentId:1,positionId:1,jobTitleId:1,assignmentBefore:reviewOf(before)});
      assert.deepEqual([after.company_id,after.branch_id,after.department_id,after.position_id,after.job_title_id],[5,3,1,1,1]);
      const [audit]=await tx`SELECT * FROM audit_logs WHERE record_type='employee' AND record_id=${String(legacy.id)} ORDER BY id DESC LIMIT 1`;
      assert.equal(JSON.parse(audit.previous_value).department_id,4);assert.equal(JSON.parse(audit.new_value).department_id,1);
    });
    await check('intermediate legacy state is refused with LEGACY_UNIT; stale review with STALE_REVIEW 409',async()=>{
      const other=await createEmployeeRecord(db,{nameEn:'Legacy two',nameAr:'قديم',workEmail:'legacy-two@example.invalid',startDate:'2026-01-01',country:'Egypt'});
      await tx`UPDATE employees SET department_id=4,job_title_id=14 WHERE id=${other.id}`;
      await rejects(save(other.id,{companyId:5,branchId:3}),'LEGACY_UNIT',400);
      await rejects(save(other.id,{companyId:5,branchId:3,departmentId:1}),'JOB_TITLE_DEPARTMENT_MISMATCH',400);
      const stale=reviewOf(await read(other.id));stale.department_id=1;
      await rejects(save(other.id,{companyId:5,branchId:3,departmentId:1,jobTitleId:1,assignmentBefore:stale}),'STALE_REVIEW',409);
    });
    await check('legacy CEO (U14 + T26) moves to company-level CEO Position with no Department in one save',async()=>{
      const before=await read(33);assert.deepEqual([before.company_id,before.department_id,before.job_title_id,before.position_id],[6,14,26,5]);
      await rejects(save(33,{branchId:2,departmentId:null}),'JOB_TITLE_DEPARTMENT_MISMATCH',400);
      const {after}=await save(33,{branchId:2,departmentId:null,jobTitleId:null,assignmentBefore:reviewOf(before)});
      assert.deepEqual([after.company_id,after.branch_id,after.department_id,after.position_id,after.manager_id],[6,2,null,5,null]);
    });
    await check('manager cannot move alone (DIRECT_REPORTS_OUTSIDE_COMPANY); reporting cycle refused (REPORTING_CYCLE)',async()=>{
      const body=await rejects(save(5,{companyId:6,branchId:3,departmentId:3,jobTitleId:15}),'DIRECT_REPORTS_OUTSIDE_COMPANY',400);
      assert.deepEqual(body.details.reports.map(r=>r.id).sort((a,b)=>a-b),[14,30]);
      await rejects(save(5,{managerId:14}),'REPORTING_CYCLE',400);
    });
    const members=[{employeeId:5,companyId:6,branchId:3,departmentId:3,jobTitleId:15},{employeeId:14,companyId:6,branchId:3},{employeeId:30,companyId:6,branchId:3}];
    await check('partial team transfer refused; manager_id cannot be submitted; unreviewed commit refused',async()=>{
      const partial=await previewTeamTransfer(db,{rootEmployeeId:5,members:members.slice(0,2)});
      assert.equal(partial.valid,false);assert.equal(partial.issues[0].code,'PARTIAL_TEAM_TRANSFER');assert.deepEqual(partial.issues[0].details.reports.map(r=>r.id),[30]);
      await rejects(previewTeamTransfer(db,{rootEmployeeId:5,members:[{...members[0],managerId:14},...members.slice(1)]}),'INVALID_SELECTION',400);
      await rejects(commitTeamTransfer(db,{rootEmployeeId:5,members},actor),'STALE_REVIEW',409);
    });
    await check('team transfer: manager + reports change company atomically, manager_id preserved, every employee audited',async()=>{
      const before=Object.fromEntries(await Promise.all([5,14,30].map(async id=>[id,await read(id)])));
      const preview=await previewTeamTransfer(db,{rootEmployeeId:5,members,assignmentEffectiveDate:'2026-10-01'});
      assert.equal(preview.valid,true,JSON.stringify(preview.issues));
      assert.deepEqual((await read(5)).company_id,null,'preview writes nothing');
      const audits=await auditCount();
      const reviewed=members.map(m=>({...m,reviewed:preview.changes.find(c=>c.employee_id===m.employeeId).before}));
      const done=await commitTeamTransfer(db,{rootEmployeeId:5,members:reviewed,assignmentEffectiveDate:'2026-10-01'},actor);
      assert.deepEqual(done.changed.sort((a,b)=>a-b),[5,14,30]);
      for(const id of [5,14,30]){const row=await read(id);assert.equal(row.company_id,6);assert.equal(row.branch_id,3);assert.equal(row.manager_id,before[id].manager_id,'manager_id preserved');assert.equal(row.assignment_effective_date,'2026-10-01');}
      assert.equal((await read(5)).department_id,3);
      assert.equal(await auditCount(),audits+4,'three employee rows + one transfer summary');
      const [summary]=await tx`SELECT * FROM audit_logs WHERE record_type='team_transfer' ORDER BY id DESC LIMIT 1`;
      assert.equal(JSON.parse(summary.new_value).changes.length,3);
    });
    await check('job title rebinding: saves directly while employee and position assignments stay untouched',async()=>{
      const preview=await previewJobTitle(db,{jobTitleId:14,nameEn:'Technology Director',nameAr:'مدير قطاع التكنولوجيا',departmentId:1,status:'active'});
      assert.equal(preview.ok,true);assert.ok(preview.impact.mismatch.created.some(e=>e.id===19)&&preview.impact.mismatch.created.every(e=>e.department_id===4),'every current user outside U1 is listed');assert.ok(preview.impact.binding.before_legacy);
      assert.equal(preview.confirmationToken,null);
      const e19=await read(19);
      await saveJobTitle(db,{jobTitleId:14,nameEn:'Technology Director',nameAr:'مدير قطاع التكنولوجيا',departmentId:1,status:'active'},actor);
      assert.equal((await tx`SELECT department_id FROM job_titles WHERE id=14`)[0].department_id,1);
      assert.deepEqual(await read(19),e19,'employee assignments are never rewritten by a catalog change');
      await saveJobTitle(db,{jobTitleId:1,nameEn:'Software Developer',nameAr:'مطور برامج',departmentId:6,status:'active'},actor);
      assert.equal((await tx`SELECT department_id FROM job_titles WHERE id=1`)[0].department_id,6);
      await saveJobTitle(db,{jobTitleId:26,nameEn:'Chief Executive Officer',nameAr:'الرئيس التنفيذي',departmentId:null,status:'active'},actor);
    });
    await check('department branch scope: removing a branch with current unit employees is blocked and names them',async()=>{
      const u1=(await tx`SELECT * FROM departments WHERE id=1`)[0];
      const preview=await previewOrganizationEntity(db,'departments',{...u1,branch_scope:'selected',branchIds:[2]});
      assert.equal(preview.ok,false);assert.equal(preview.blocking[0].code,'UNIT_OUTSIDE_BRANCH_SCOPE');assert.ok(preview.blocking[0].details.employees.some(e=>e.id===legacy.id));
      const noBranch=await rejects(saveOrganizationEntity(db,'departments',{...u1,branch_scope:'selected',branchIds:[2,3]}),'UNIT_OUTSIDE_BRANCH_SCOPE',409);
      assert.ok(noBranch.details.employees.some(e=>e.branch_id===null),'members without a branch would fall outside any selected scope');
      const unit=await saveOrganizationEntity(db,'departments',{name_ar:'وحدة اختبار',name_en:'Scope fixture',company_id:5,organization_kind:'department',branch_scope:'all'},actor.id);
      await save(legacy.id,{departmentId:unit.id,positionId:null,jobTitleId:null});
      const created=(await tx`SELECT * FROM departments WHERE id=${unit.id}`)[0];
      await rejects(saveOrganizationEntity(db,'departments',{...created,branch_scope:'selected',branchIds:[2]}),'UNIT_OUTSIDE_BRANCH_SCOPE',409);
      await saveOrganizationEntity(db,'departments',{...created,branch_scope:'selected',branchIds:[3]},actor.id);
      assert.deepEqual((await tx`SELECT branch_id FROM organization_branch_scopes WHERE department_id=${unit.id}`).map(r=>r.branch_id),[3]);
      result.scopeUnitId=unit.id;
    });
    await check('unit manager: actionable reason; a retained manager no longer blocks unrelated edits',async()=>{
      const u3=(await tx`SELECT * FROM departments WHERE id=3`)[0];assert.equal(u3.manager_employee_id,20);
      await saveOrganizationEntity(db,'departments',{...u3,name_en:'Human Resources'},actor.id);
      const body=await rejects(saveOrganizationEntity(db,'departments',{...u3,manager_employee_id:19}),'INVALID_UNIT_MANAGER',400);
      assert.match(body.message_en,/Company assignment is incomplete/);
    });
    await check('deactivation lists active dependents; delete only for never-used records',async()=>{
      const u1=(await tx`SELECT * FROM departments WHERE id=1`)[0];
      const body=await rejects(saveOrganizationEntity(db,'departments',{...u1,status:'inactive'}),'ACTIVE_DEPENDENTS',409);
      assert.match(body.message_en,/active employee/);
      const grade=await saveOrganizationEntity(db,'grades',{name_ar:'درجة',name_en:'Temp grade',code:'TMP-G',sort_order:5},actor.id);
      await deleteOrganizationEntity(db,'grades',grade.id,actor.id);
      assert.equal((await tx`SELECT count(*)::int c FROM job_grades WHERE id=${grade.id}`)[0].c,0);
      await rejects(deleteOrganizationEntity(db,'positions',5,actor.id),'REFERENCED_ENTITY_CONFLICT',409);
    });
    await check('company↔branch link removal blocked by that pair only',async()=>{
      const asus=(await tx`SELECT * FROM companies WHERE id=6`)[0];
      const body=await rejects(saveOrganizationEntity(db,'companies',{...asus,branchIds:[3]}),'REFERENCED_ENTITY_CONFLICT',409);
      assert.ok(body.details.issues[0].details.employees.some(e=>e.id===33),'E33 now sits in Asus/Riyadh');
      await rejects(saveOrganizationEntity(db,'companies',{...asus,branchIds:[2]}),'REFERENCED_ENTITY_CONFLICT',409);
    });
    await check('legacy unit adoption requires confirmation; inactive unit reactivation requires scope review',async()=>{
      const u22=(await tx`SELECT * FROM departments WHERE id=22`)[0];
      const record={...u22,company_id:5,organization_kind:'department',parent_id:null,branch_scope:'all'};
      const body=await rejects(saveOrganizationEntity(db,'departments',record),'IMPACT_NOT_CONFIRMED',409);
      await saveOrganizationEntity(db,'departments',{...record,confirmImpact:body.details.confirmationToken},actor.id);
      assert.equal((await tx`SELECT company_id FROM departments WHERE id=22`)[0].company_id,5);
      const u65=(await tx`SELECT * FROM departments WHERE id=65`)[0];
      const preview=await previewOrganizationEntity(db,'departments',{...u65,status:'active'});
      assert.equal(preview.warnings[0].code,'SCOPE_REVIEW_REQUIRED');
      await rejects(saveOrganizationEntity(db,'departments',{...u65,status:'active'}),'IMPACT_NOT_CONFIRMED',409);
      assert.equal((await tx`SELECT status FROM departments WHERE id=65`)[0].status,'inactive','never activated implicitly');
    });
    await check('every settings save above wrote an audit row with before/after inside the transaction',async()=>{
      const rows=await tx`SELECT record_type,previous_value,new_value FROM audit_logs WHERE module='system_settings' AND record_type='departments' AND record_id=${String(result.scopeUnitId)} ORDER BY id DESC LIMIT 1`;
      const after=JSON.parse(rows[0].new_value);assert.deepEqual(after.relationChanges.branchIds,{added:[3],removed:[]});assert.equal(JSON.parse(rows[0].previous_value).branch_scope,'all');assert.equal(after.branch_scope,'selected');
    });
    throw rollback;
  });}catch(error){if(error!==rollback)throw error;}
  const after=await inventory(sql);
  const differences=Object.keys({...baseline,...after}).filter(k=>JSON.stringify(baseline[k])!==JSON.stringify(after[k]));
  assert.deepEqual(differences,[],'all fixture writes rolled back');
  Object.assign(result,{passed,tablesCompared:Object.keys(baseline).length,differences,finishedAt:new Date().toISOString()});
  fs.writeFileSync('outputs/org-manageability/isolated-verification.json',JSON.stringify(result,null,2));
  console.log(`${passed.length} isolated checks passed; ${Object.keys(baseline).length} tables unchanged after rollback`);
}finally{await sql.end({timeout:5});}
