import fs from 'node:fs';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { saveOrganizationEntity, assertUnreferenced } from '../app/organization/catalog-service.ts';
import { validateEmployeeWrite, persistAssignment, readOrganizationCatalog } from '../app/organization/assignment-service.ts';
import { createEmployeeRecord } from '../app/employees/employee-service.ts';
import { buildReportingForest } from '../app/organization/reporting-tree.ts';
import { effectiveHrSql, requireEmployeeHr } from '../app/employees/hr-assignment.ts';

const config=JSON.parse(fs.readFileSync('outputs/organization-implementation/latest-rehearsal.json','utf8'));
const target=new URL(config.cloneUrl);
if(target.hostname!=='127.0.0.1'||target.port!=='5657'||target.pathname!=='/hr_org_rehearsal')throw new Error('Only the isolated rehearsal target is allowed');
const sql=postgres(config.cloneUrl,{max:1});
function adapter(tx){return {prepare(source){let values=[];return {bind(...args){values=args;return this;},async all(){return {results:await execute()};},async first(){return (await execute())[0]||null;},async run(){return {results:await execute()};}};async function execute(){let i=0;return tx.unsafe(source.replace(/\?/g,()=>'$'+(++i)),values);}},async batch(queries){return Promise.all(queries.map(q=>q.run()));}};}
const passed=[];
const check=(name,fn)=>Promise.resolve().then(fn).then(()=>passed.push(name));
const rollback=new Error('ROLLBACK_TEST_FIXTURES');
try{
  await sql.begin(async tx=>{
    const db=adapter(tx);
    const save=(entity,record)=>saveOrganizationEntity(db,entity,record);
    const branchA=(await save('branches',{name_ar:'فرع اختبار أ',name_en:'Rehearsal A',code:'REHEARSAL-A'})).id;
    const branchB=(await save('branches',{name_ar:'فرع اختبار ب',name_en:'Rehearsal B',code:'REHEARSAL-B'})).id;
    const company=(await save('companies',{name:'Rehearsal company',name_ar:'شركة اختبار',name_en:'Rehearsal company',branchIds:[branchA,branchB]})).id;
    const department=(await save('departments',{name_ar:'إدارة اختبار',name_en:'Rehearsal department',company_id:company,branch_scope:'all',organization_kind:'department'})).id;
    const restricted=(await save('departments',{name_ar:'إدارة مقيدة',name_en:'Restricted department',company_id:company,branch_scope:'selected',branchIds:[branchA],organization_kind:'department'})).id;
    const grade=(await save('grades',{name_ar:'درجة اختبار',name_en:'Rehearsal grade',code:'REHEARSAL-GRADE'})).id;
    const position=(await save('positions',{name_ar:'وظيفة اختبار',name_en:'Rehearsal position',code:'REHEARSAL-POSITION',company_id:company,department_id:department,grade_id:grade})).id;
    const base={nameAr:'موظف اختبار',startDate:'2026-09-26',country:'Egypt',companyId:company,branchId:branchA,departmentId:department,positionId:position,gradeId:grade};
    const a=await createEmployeeRecord(db,{...base,nameEn:'Manager A',workEmail:'org-rehearsal-a@example.invalid'});
    const b=await createEmployeeRecord(db,{...base,nameEn:'Manager B',workEmail:'org-rehearsal-b@example.invalid'});
    const employee=await createEmployeeRecord(db,{...base,nameEn:'Employee',workEmail:'org-rehearsal-c@example.invalid',managerId:a.id});
    const rows=async()=>(await tx`SELECT * FROM employees WHERE company_id=${company} ORDER BY id`);
    await check('persisted assignment supports no section or team',async()=>{const e=(await rows()).find(e=>e.id===employee.id);assert.equal(e.section_id,null);assert.equal(e.team_id,null);assert.equal(e.position_id,position);});
    await check('source of truth: profile save moves employee from A to B and changes branch metadata',async()=>{
      assert.equal(buildReportingForest(await rows()).find(n=>n.employee.id===a.id).children[0].employee.id,employee.id);
      const before=(await rows()).find(e=>e.id===employee.id),payload={managerId:b.id,branchId:branchB};
      const next=await validateEmployeeWrite(db,employee.id,payload,before);await persistAssignment(db,employee.id,next,payload,before);
      const forest=buildReportingForest(await rows());assert.equal(forest.find(n=>n.employee.id===a.id).children.length,0);const moved=forest.find(n=>n.employee.id===b.id).children[0].employee;assert.equal(moved.id,employee.id);assert.equal(moved.branch_id,branchB);
    });
    const before=(await rows()).find(e=>e.id===employee.id);
    await check('server rejects mismatched position department',()=>assert.rejects(validateEmployeeWrite(db,employee.id,{departmentId:restricted},before),e=>e instanceof Response&&e.status===400));
    await check('server rejects restricted branch',()=>assert.rejects(validateEmployeeWrite(db,employee.id,{positionId:null,departmentId:restricted},before),e=>e instanceof Response&&e.status===400));
    await check('server rejects self manager and long cycle',async()=>{await assert.rejects(validateEmployeeWrite(db,employee.id,{managerId:employee.id},before));const manager=(await rows()).find(e=>e.id===b.id);await assert.rejects(validateEmployeeWrite(db,b.id,{managerId:employee.id},manager));});
    await check('server enforces visible manager set',()=>assert.rejects(validateEmployeeWrite(db,employee.id,{managerId:a.id},before,new Set([employee.id])),e=>e instanceof Response&&e.status===400));
    await check('referenced position cannot be deactivated',()=>assert.rejects(save('positions',{id:position,status:'inactive'}),e=>e instanceof Response&&e.status===409));
    await check('referenced company and department are protected',async()=>{await assert.rejects(assertUnreferenced(db,'companies',company));await assert.rejects(assertUnreferenced(db,'departments',department));});
    await check('legacy organizational fields survive unrelated update',async()=>{const [legacy]=await tx`SELECT * FROM employees WHERE company_id IS DISTINCT FROM ${company} LIMIT 1`;const next=await validateEmployeeWrite(db,legacy.id,{nameEn:legacy.name_en},legacy);for(const key of ['company_id','department_id','job_title_id','manager_id','hr_user_id'])assert.equal(next[key]??null,legacy[key]??null);});
    await check('HR resolution uses rules without storing a second assignment',async()=>{
      const [hrUser]=await tx`INSERT INTO users(email,role_id,status) SELECT 'org-hr@example.invalid',id,'active' FROM roles WHERE name='HR Manager' RETURNING id`;
      const [hr]=await tx`INSERT INTO hr_responsibles(user_id,status) VALUES (${hrUser.id},'active') RETURNING user_id`;
      await save('hrRules',{branch_id:branchB,company_id:company,hr_user_id:hr.user_id});assert.match(await effectiveHrSql(db),/hr_responsibility_rules/);assert.equal(await requireEmployeeHr(db,employee.id),hr.user_id);assert.equal((await rows()).find(e=>e.id===employee.id).hr_user_id,null);
    });
    await check('CEO is an occupied position with one current employee',async()=>{
      const ceo=(await save('positions',{name_ar:'رئيس تنفيذي',name_en:'Rehearsal CEO',code:'REHEARSAL-CEO',company_id:company,is_ceo:1})).id;
      const person=(await rows()).find(e=>e.id===a.id),next=await validateEmployeeWrite(db,a.id,{positionId:ceo},person);await persistAssignment(db,a.id,next,{},person);
      await assert.rejects(validateEmployeeWrite(db,b.id,{positionId:ceo},(await rows()).find(e=>e.id===b.id)));
    });
    await check('catalog contains no manually maintained employee tree',async()=>{const catalog=await readOrganizationCatalog(db);assert.ok(catalog.positions.some(p=>p.id===position));assert.equal('hierarchy' in catalog,false);});
    throw rollback;
  });
}catch(e){if(e!==rollback)throw e;}finally{await sql.end({timeout:5});}
fs.writeFileSync('outputs/organization-implementation/runtime-tests.json',JSON.stringify({target:{host:target.hostname,port:target.port,database:target.pathname.slice(1)},passed,fixtures:'rolled back'},null,2));
console.log(JSON.stringify({passed:passed.length,checks:passed,fixtures:'rolled back'},null,2));
