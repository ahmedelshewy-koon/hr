import test from 'node:test';
import assert from 'node:assert/strict';
import { readOrganizationUsage, assertCanDeactivate, assertUnreferenced } from '../app/organization/reference-policy.ts';
import { organizationDuplicateError } from '../app/organization/duplicate-error.ts';

const database=(active,total)=>({prepare(){return {bind(){return this;},async all(){return {results:[{record_id:7,active,total}]};}};}});
test('historical usage is reported but only active usage blocks deactivation',async()=>{
  const db=database(0,3);
  const usage=await readOrganizationUsage(db,'positions',7);
  assert.equal(usage.total,3);assert.equal(usage.active,0);assert.equal(usage.historical,3);
  await assertCanDeactivate(db,'positions',7);
  await assert.rejects(assertUnreferenced(db,'positions',7),e=>e.status===409);
  await assert.rejects(assertCanDeactivate(database(1,3),'positions',7),e=>e.status===409);
});
test('unique constraints translate wrapped and direct database errors without exposing SQL',async()=>{
  for(const [constraint,phrase] of [['companies_code_unique','code'],['branches_code_unique','code'],['job_grades_code_unique','code'],['positions_code_unique','code'],['work_locations_code_unique','code'],['hr_rules_active_scope','scope'],['positions_company_ceo','CEO']]){
    const error=organizationDuplicateError({cause:{code:'23505',constraint_name:constraint}});
    assert.equal(error.status,409);assert.match(await error.text(),new RegExp(phrase));
  }
  assert.equal(organizationDuplicateError({code:'23503'}),null);
  const ceo=await organizationDuplicateError({cause:{code:'23505',constraint_name:'positions_company_ceo'}}).json();
  assert.equal(ceo.code,'CEO_OCCUPIED');assert.equal(ceo.field,'is_ceo');assert.ok(ceo.message_ar&&ceo.message_en);
});

import { saveOrganizationEntity } from '../app/organization/catalog-service.ts';
import { filterAvailablePages } from '../app/page-availability.ts';
import { validateAssignment } from '../app/organization/assignment-policy.ts';
const emptyCatalog={companies:[],branches:[],companyBranches:[],departments:[],branchScopes:[],positions:[],grades:[],workLocations:[],hrRules:[],jobTitles:[]};
function serviceDb(before=null,catalog=emptyCatalog,counts={total:0,active:0}){
  const writes=[];
  const tables={companies:'companies',branches:'branches',company_branches:'companyBranches',departments:'departments',organization_branch_scopes:'branchScopes',positions:'positions',job_grades:'grades',work_locations:'workLocations',hr_responsibility_rules:'hrRules',job_titles:'jobTitles'};
  return {writes,prepare(sql){let params=[];return {bind(...args){params=args;return this;},async run(){writes.push({sql,params});},async first(){if(sql.includes('FOR UPDATE'))return before;if(/^(UPDATE|INSERT)/.test(sql)){writes.push({sql,params});return {id:before?.id||7};}return null;},async all(){if(sql.includes('count(*)'))return {results:[{record_id:7,...counts}]};const table=sql.match(/FROM (\w+)/)?.[1];return {results:catalog[tables[table]]||[]};}};}};
}
const company={id:1,name:'Old',name_en:'Old',name_ar:'قديم',status:'active',code:'C1'};
const root={id:7,name_en:'Root',name_ar:'إدارة',company_id:1,organization_kind:'department',parent_id:null,branch_scope:'all',status:'active'};
test('bilingual saves synchronize legacy company name',async()=>{
  const db=serviceDb(company);await saveOrganizationEntity(db,'companies',{id:1,name_en:'New'});
  const update=db.writes.find(w=>w.sql.startsWith('UPDATE companies'));assert.equal(update.params[0],'New');
});
test('grade order accepts zero and rejects fractions, negatives and overflow',async()=>{
  for(const sort_order of [-1,1.2,2147483648])await assert.rejects(saveOrganizationEntity(serviceDb(),'grades',{name_ar:'درجة',name_en:'Grade',code:'G',sort_order}),e=>e.status===400);
  const db=serviceDb();await saveOrganizationEntity(db,'grades',{name_ar:'درجة',name_en:'Grade',code:'G',sort_order:0});assert.ok(db.writes.some(w=>w.sql.includes('sort_order')));
});
test('department roots reject parents; sections and teams enforce kind, company and cycles',async()=>{
  const catalog={...emptyCatalog,companies:[company,{...company,id:2}],departments:[root,{...root,id:8,organization_kind:'section',parent_id:7},{...root,id:9,company_id:2}]};
  for(const record of [{organization_kind:'department',parent_id:7},{organization_kind:'section',parent_id:8},{organization_kind:'team',parent_id:9},{id:7,organization_kind:'section',parent_id:7},{id:7,organization_kind:'team',parent_id:8}]){
    await assert.rejects(saveOrganizationEntity(serviceDb(record.id?root:null,catalog),'departments',{...root,id:undefined,...record}),e=>e.status===400);
  }
  for(const parent_id of [7,8])await saveOrganizationEntity(serviceDb(null,catalog),'departments',{...root,id:undefined,organization_kind:'team',parent_id});
});
test('inactive references permit retirement even when ancestors are inactive, but structural changes remain blocked',async()=>{
  const before={id:7,name_ar:'وظيفة',name_en:'Position',code:'P',company_id:1,is_ceo:0,status:'active'};
  await saveOrganizationEntity(serviceDb(before,emptyCatalog,{active:0,total:4}),'positions',{id:7,status:'inactive'});
  await assert.rejects(saveOrganizationEntity(serviceDb(before,emptyCatalog,{active:1,total:4}),'positions',{id:7,status:'inactive'}),e=>e.status===409);
});
test('settings page remains role restricted regardless of unrelated module grants',()=>{
  for(const role of ['Department Manager','Employee'])assert.deepEqual(filterAvailablePages(['settings'],role,{}),[]);
  assert.deepEqual(filterAvailablePages(['settings'],'HR Manager',{}),['settings']);
});
test('generic titles work across departments; linked titles remain department scoped',()=>{
  const catalog={...emptyCatalog,companies:[company],departments:[root,{...root,id:8}],jobTitles:[{id:1,status:'active',department_id:null},{id:2,status:'active',department_id:7}]};
  for(const department_id of [7,8])assert.doesNotThrow(()=>validateAssignment(catalog,{company_id:1,department_id,job_title_id:1}));
  assert.throws(()=>validateAssignment(catalog,{company_id:1,department_id:8,job_title_id:2}),/Job title/);
});

test('structural edits are blocked even when every employee reference is historical',async()=>{
  const before={id:7,name_ar:'مقر',name_en:'Location',code:'W',branch_id:1,status:'active'};
  const catalog={...emptyCatalog,branches:[{id:2,status:'active'}]};
  await assert.rejects(saveOrganizationEntity(serviceDb(before,catalog,{active:0,total:3}),'workLocations',{id:7,branch_id:2}),e=>e.status===409);
});
test('invalid IDs return validation errors rather than unexpected server errors',async()=>{
  await assert.rejects(saveOrganizationEntity(serviceDb(),'grades',{id:-1}),e=>e.status===400);
});
