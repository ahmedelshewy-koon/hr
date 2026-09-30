import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../app/organization/assignment-policy.ts';
const active=(id,extra={})=>({id,status:'active',...extra});
const catalog={companies:[active(1),active(2)],branches:[active(1),active(2)],companyBranches:[{company_id:1,branch_id:1}],departments:[active(10,{company_id:1,organization_kind:'department',branch_scope:'all'}),active(20,{company_id:1,organization_kind:'section',parent_id:10,branch_scope:'all'}),active(30,{company_id:1,organization_kind:'team',parent_id:20,branch_scope:'all'}),active(31,{company_id:1,organization_kind:'team',parent_id:10,branch_scope:'all'}),{id:99,company_id:2,organization_kind:'department',status:'inactive'}],positions:[active(1,{company_id:1,department_id:10,section_id:20,team_id:30,grade_id:1,job_title_id:5})],grades:[active(1)],workLocations:[active(1,{branch_id:1})],jobTitles:[active(5,{department_id:10})],hrRules:[active(1,{company_id:null,branch_id:1,hr_user_id:8}),active(2,{company_id:1,branch_id:1,hr_user_id:9})]};
test('company selection clears structural dependents but preserves independently reviewed fields',()=>{
  assert.equal(typeof policy.changeAssignmentForm,'function');
  const next=policy.changeAssignmentForm({companyId:'1',branchId:'1',departmentId:'10',sectionId:'20',teamId:'30',positionId:'',jobTitleId:'5',gradeId:'1',managerId:'7',hrUserId:'8',workLocationId:'1'},'companyId','2',catalog);
  for(const k of ['branchId','departmentId','sectionId','teamId','positionId','workLocationId'])assert.equal(next[k],'');
  for(const [k,v] of Object.entries({jobTitleId:'5',gradeId:'1',managerId:'7',hrUserId:'8'}))assert.equal(next[k],v);
});
test('position fields cannot be changed while position remains selected',()=>{
  assert.equal(typeof policy.changeAssignmentForm,'function');
  assert.throws(()=>policy.changeAssignmentForm({positionId:'1',departmentId:'10'},'departmentId','99',catalog),/position/i);
  const next=policy.changeAssignmentForm({managerId:'7'},'positionId','1',catalog);
  assert.equal(next.teamId,'30');assert.equal(next.sectionId,'20');assert.equal(next.gradeId,'1');assert.equal(next.jobTitleId,'5');assert.equal(next.managerId,'7');
});
test('options filter optional hierarchy and inactive Agency units without inferring branches',()=>{
  assert.equal(typeof policy.assignmentOptions,'function');
  const options=policy.assignmentOptions(catalog,{companyId:1,branchId:1,departmentId:10,sectionId:20},[]);
  assert.deepEqual(options.teamId.map(r=>r.id),[30]);assert.deepEqual(options.sectionId.map(r=>r.id),[20]);
  assert.deepEqual(policy.assignmentOptions(catalog,{companyId:2},[]).departmentId,[]);
  assert.deepEqual(policy.assignmentOptions(catalog,{companyId:1},[]).departmentId,[]);
});
test('retained missing and out-of-scope values stay visible but cannot be newly chosen',()=>{
  assert.equal(typeof policy.retainedOptions,'function');
  assert.deepEqual(policy.retainedOptions([],catalog.departments,99).map(r=>[r.id,r.retained]),[[99,true]]);
  const unknown=policy.retainedOptions([],[],123)[0];assert.equal(unknown.id,123);assert.equal(unknown.retained,true);
});
test('review contains explicit clears and every changed organizational field only',()=>{
  assert.equal(typeof policy.assignmentChanges,'function');
  const before={company_id:null,branch_id:1,department_id:10,manager_id:7};
  const diff=policy.assignmentChanges({companyId:1,branchId:'',departmentId:10,managerId:7,nameEn:'changed'},before);
  assert.deepEqual(diff.map(r=>r.key),['companyId','branchId']);assert.equal(diff[1].after,null);
});
test('HR rule and employee override remain distinct; unavailable overrides do not silently fall back',()=>{
  assert.equal(typeof policy.resolvedHrResponsibility,'function');
  const roster=[{user_id:8,status:'active',eligible:true},{user_id:9,status:'active',eligible:true},{user_id:7,status:'inactive',eligible:false}];
  const base={companyId:1,branchId:1};
  assert.equal(policy.resolvedHrResponsibility(catalog,base,roster).source,'company_branch');
  assert.equal(policy.resolvedHrResponsibility(catalog,base,roster).userId,9);
  const overridden=policy.resolvedHrResponsibility(catalog,{...base,hrUserId:7},roster);assert.equal(overridden.source,'employee_override');assert.equal(overridden.available,false);assert.equal(overridden.userId,7);
});
test('effective date rejects calendar-invalid dates and accepts leap days',()=>{
  assert.equal(typeof policy.validateAssignmentDate,'function');
  assert.throws(()=>policy.validateAssignmentDate('2026-02-30'));
  assert.doesNotThrow(()=>policy.validateAssignmentDate('2028-02-29'));assert.doesNotThrow(()=>policy.validateAssignmentDate(null));
});
test('manager-only updates cannot contradict an existing CEO position',()=>{
  const c={...catalog,positions:[active(2,{company_id:1,is_ceo:1})]};
  const before={id:7,company_id:1,position_id:2,manager_id:null};
  assert.throws(()=>policy.validateAssignment(c,{...before,manager_id:8},before),/CEO|الرئيس/);
});
test('legacy values survive unrelated edits, including missing master records',()=>{
  const old={id:99,department_id:987,job_title_id:654,company_id:null};
  assert.deepEqual(policy.validateAssignment(catalog,old,old),old);
});
test('profile patch omits unchanged defaults and includes explicit clears',()=>{
  assert.equal(typeof policy.profilePatch,'function');
  assert.deepEqual(policy.profilePatch({employeeId:7,departmentId:'',salary:'',nameEn:'A'},{employeeId:7,departmentId:10,salary:'',nameEn:'A'}),{employeeId:7,departmentId:''});
});
test('review rejects an assignment changed since the profile was opened',()=>{
  assert.equal(typeof policy.assertAssignmentReviewCurrent,'function');
  assert.throws(()=>policy.assertAssignmentReviewCurrent({company_id:null},{company_id:1}),/changed|تغير/);
  assert.doesNotThrow(()=>policy.assertAssignmentReviewCurrent({company_id:1},{company_id:1}));
});
