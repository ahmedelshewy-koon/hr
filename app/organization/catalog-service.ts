import { readOrganizationUsage, usageSummary } from './reference-policy.ts';
export { assertUnreferenced } from './reference-policy.ts';
import type { TransactionDatabase } from '../../db/postgres';
import type { Row } from '../ui-types';
import { assignmentId as parseAssignmentId, validateAssignment, type OrganizationCatalog } from './assignment-policy.ts';
import { readOrganizationCatalog } from './assignment-service.ts';
import { OrganizationError, asResponse, isOrganizationError, issueOf, orgError, type OrganizationIssue } from './org-errors.ts';
import { hrImpactChanges, hrImpactToken, hrRuleImpact, hrRuleIssues, hrRuleType, type HrRuleImpact } from './hr-responsibility.ts';
import { readHrEmployees, readHrRoster } from './hr-responsibility-service.ts';
import { emptyPlan, legacyAdoptionImpact, linkRemovalImpact, positionOccupantsImpact, reactivationImpact, unitManagerIssue, unitScopeImpact, type ImpactContext, type ImpactPlan } from './impact-policy.ts';

const fail=(code:Parameters<typeof orgError>[0],field:string|null,ar:string,en:string,extra:Parameters<typeof orgError>[4]={})=>asResponse(orgError(code,field,ar,en,extra),extra.status??400);
function assignmentId(value:unknown,field:string|null=null){try{return parseAssignmentId(value);}catch(error){throw fail('INVALID_SELECTION',field,'اختيار تنظيمي غير صالح','Invalid organizational selection',{details:(error as OrganizationError).details});}}

export const catalogEntities:Record<string,{table:string;fields:string[];structural:string[]}>={
  companies:{table:'companies',fields:['name','name_ar','name_en','code','status'],structural:[]},
  branches:{table:'branches',fields:['name_ar','name_en','code','country','city','status'],structural:[]},
  departments:{table:'departments',fields:['name_ar','name_en','company_id','organization_kind','parent_id','manager_employee_id','branch_scope','status'],structural:['company_id','organization_kind','parent_id','branch_scope']},
  positions:{table:'positions',fields:['name_ar','name_en','code','company_id','department_id','section_id','team_id','grade_id','job_title_id','is_ceo','status'],structural:['company_id','department_id','section_id','team_id','grade_id','job_title_id','is_ceo']},
  grades:{table:'job_grades',fields:['name_ar','name_en','code','sort_order','status'],structural:[]},
  workLocations:{table:'work_locations',fields:['name_ar','name_en','code','branch_id','status'],structural:['branch_id']},
  hrRules:{table:'hr_responsibility_rules',fields:['company_id','branch_id','hr_user_id','status'],structural:[]},
};

export async function readImpactContext(db:TransactionDatabase,catalog?:OrganizationCatalog):Promise<ImpactContext>{
  const employees=(await db.prepare('SELECT id,employee_code,name_en,name_ar,employment_status,company_id,branch_id,department_id,section_id,team_id,position_id,job_title_id,work_location_id,grade_id,manager_id FROM employees ORDER BY id').all()).results as Row[];
  return {catalog:catalog??await readOrganizationCatalog(db),employees:employees??[]};
}
const mergePlan=(target:ImpactPlan,source:ImpactPlan)=>{target.blocking.push(...source.blocking);target.warnings.push(...source.warnings);Object.assign(target.impact,source.impact);if(source.confirmationToken)target.confirmationToken=[target.confirmationToken,source.confirmationToken].filter(Boolean).join('|');};
async function relationsOf(db:TransactionDatabase,entity:string,id:number){
  if(entity==='companies')return {branchIds:((await db.prepare('SELECT branch_id FROM company_branches WHERE company_id=? ORDER BY branch_id').bind(id).all()).results??[]).map(r=>Number(r.branch_id))};
  if(entity==='branches')return {companyIds:((await db.prepare('SELECT company_id FROM company_branches WHERE branch_id=? ORDER BY company_id').bind(id).all()).results??[]).map(r=>Number(r.company_id))};
  if(entity==='departments')return {branchIds:((await db.prepare('SELECT branch_id FROM organization_branch_scopes WHERE department_id=? ORDER BY branch_id').bind(id).all()).results??[]).map(r=>Number(r.branch_id))};
  return {};
}

export type PreparedEntity={entity:string;config:(typeof catalogEntities)[string];id:number|null;before:Row|null;values:Row;catalog:OrganizationCatalog;branchIds:number[]|null;companyIds:number[]|null;plan:ImpactPlan};
/** Normalizes, validates and plans a Settings change without writing. Shared by preview and save. */
export async function prepareOrganizationEntity(db:TransactionDatabase,entity:string,input:Row):Promise<PreparedEntity>{
  const config=catalogEntities[entity];if(!config)throw fail('INVALID_SELECTION','entity','نوع سجل غير معروف','Unknown organizational entity');
  await db.prepare('SELECT pg_advisory_xact_lock(78231)').run();
  const id=assignmentId(input.id,'id');
  const before=id?await db.prepare(`SELECT * FROM ${config.table} WHERE id=? FOR UPDATE`).bind(id).first<Row>():null;
  if(id&&!before)throw fail('NOT_FOUND','id','السجل غير موجود','Record not found',{status:404});
  const values:Row={};
  for(const field of config.fields){const raw=input[field]===undefined?before?.[field]:input[field];values[field]=field.endsWith('_id')?assignmentId(raw,field):field==='is_ceo'?(raw===true||Number(raw)===1?1:0):String(raw??'').trim()||null;}
  values.status=values.status||'active';
  if(!['active','inactive'].includes(values.status))throw fail('INVALID_SELECTION','status','حالة غير صالحة','Invalid status');
  if(entity==='companies'){values.name=values.name_en||values.name_ar||values.name;if(!values.name)throw fail('REQUIRED_FIELD','name_en','اسم الشركة مطلوب','Company name required');}
  else if(entity!=='hrRules'&&(!values.name_ar||!values.name_en||(entity!=='departments'&&!values.code)))throw fail('REQUIRED_FIELD',!values.name_ar?'name_ar':!values.name_en?'name_en':'code','الأسماء والرمز مطلوبة','Names and code are required');
  if(Object.values(values).some(v=>typeof v==='string'&&v.length>200))throw fail('INVALID_SELECTION',null,'القيمة طويلة جدًا','Value is too long');
  if(entity==='grades'){values.sort_order=Number(values.sort_order??0);if(!Number.isInteger(values.sort_order)||values.sort_order<0||values.sort_order>2147483647)throw fail('INVALID_SELECTION','sort_order','ترتيب الدرجة يجب أن يكون عددًا صحيحًا غير سالب','Grade order must be a non-negative integer');}
  const catalog=await readOrganizationCatalog(db);
  const activeIn=(rows:Row[],value:unknown)=>rows.some(r=>Number(r.id)===Number(value)&&r.status==='active');
  const changed=(key:string)=>Boolean(before)&&String(values[key]??'')!==String(before?.[key]??'');
  const adoption=entity==='departments'&&Boolean(before)&&!before?.company_id&&Boolean(values.company_id);
  const validateRelations=!before||values.status==='active'||config.structural.some(changed);
  if(validateRelations&&values.company_id&&!activeIn(catalog.companies,values.company_id))throw fail('INVALID_COMPANY','company_id','اختر شركة نشطة','Select active company',{blocking:{type:'company',id:values.company_id}});
  if(validateRelations&&values.branch_id&&!activeIn(catalog.branches,values.branch_id))throw fail('INVALID_BRANCH','branch_id','اختر فرعًا نشطًا','Select active branch',{blocking:{type:'branch',id:values.branch_id}});
  if(validateRelations&&values.company_id&&values.branch_id&&!catalog.companyBranches.some(r=>Number(r.company_id)===Number(values.company_id)&&Number(r.branch_id)===Number(values.branch_id)))throw fail('BRANCH_NOT_LINKED','branch_id','الفرع غير مرتبط بالشركة','Branch does not belong to company',{blocking:{type:'company_branch',company_id:values.company_id,branch_id:values.branch_id}});
  if(entity==='departments'&&validateRelations){
    values.organization_kind=values.organization_kind||'department';values.branch_scope=values.branch_scope||'all';
    if(!['department','section','team'].includes(values.organization_kind)||!['all','selected'].includes(values.branch_scope))throw fail('INVALID_UNIT_KIND','organization_kind','نوع الوحدة أو نطاقها غير صالح','Invalid unit scope or kind');
    if(!values.company_id)throw fail('LEGACY_UNIT','company_id','الشركة مطلوبة؛ الوحدات القديمة تحتاج ربطًا مُراجَعًا','Company required; legacy records require reviewed mapping',{blocking:{type:'unit',id}});
    const parent=catalog.departments.find(r=>Number(r.id)===Number(values.parent_id));
    const parentBlock={type:'unit',id:values.parent_id,name:parent?.name_en??null,company_id:parent?.company_id??null,status:parent?.status??null};
    if(values.parent_id&&(!parent||Number(parent.company_id)!==Number(values.company_id)||parent.status!=='active'))throw fail('INVALID_PARENT','parent_id','الوحدة الأم غير صالحة (يجب أن تكون نشطة وفي الشركة نفسها)','Invalid parent unit (it must be active and in the same company)',{blocking:parentBlock});
    if(values.organization_kind==='department'&&values.parent_id)throw fail('INVALID_PARENT','parent_id','الإدارة لا تتبع وحدة أخرى','Department must have no parent',{blocking:parentBlock});
    if(values.organization_kind==='section'&&(!parent||(parent.organization_kind||'department')!=='department'))throw fail('INVALID_PARENT','parent_id','القسم الفرعي يتبع إدارة','Section requires a department',{blocking:parentBlock});
    if(values.organization_kind==='team'&&(!parent||!['department','section'].includes(parent.organization_kind||'department')))throw fail('INVALID_PARENT','parent_id','الفريق يتبع إدارة أو قسمًا فرعيًا','Team requires a department or section',{blocking:parentBlock});
    const seen=new Set(id?[id]:[]);let cursor=parent;while(cursor){if(seen.has(Number(cursor.id)))throw fail('HIERARCHY_CYCLE','parent_id','التسلسل الهرمي للوحدات يحتوي على حلقة','Unit hierarchy cycle',{blocking:{type:'unit',id:cursor.id}});seen.add(Number(cursor.id));cursor=catalog.departments.find(r=>Number(r.id)===Number(cursor?.parent_id));}
    if(values.manager_employee_id&&(changed('manager_employee_id')||!before||changed('company_id')||(values.status==='active'&&before?.status!=='active'))){
      const employee=await db.prepare('SELECT id,name_en,name_ar,employment_status,company_id FROM employees WHERE id=?').bind(values.manager_employee_id).first<Row>();
      const issue=unitManagerIssue(employee);
      if(issue)throw asResponse(new OrganizationError(issue),400);
    }
  }
  if(entity==='positions'&&validateRelations){
    if(!values.company_id)throw fail('INVALID_COMPANY','company_id','شركة الوظيفة مطلوبة','Position company required');
    // Validate every possible branch; a position must be usable somewhere in its company.
    const branches=catalog.companyBranches.filter(r=>Number(r.company_id)===Number(values.company_id));
    if(!branches.length)throw fail('BRANCH_NOT_LINKED','company_id','اربط الشركة بفرع أولًا','Configure company branches first',{blocking:{type:'company',id:values.company_id}});
    let lastIssue:OrganizationIssue|null=null;let valid=false;
    for(const link of branches){try{validateAssignment(catalog,{...values,branch_id:link.branch_id,position_id:null});valid=true;break;}catch(error){if(isOrganizationError(error))lastIssue=issueOf(error);}}
    if(!valid)throw asResponse(orgError(lastIssue?.code??'POSITION_CONTRADICTION',lastIssue?.field??null,`وحدات الوظيفة أو درجتها أو مسماها غير متسقة: ${lastIssue?.message_ar??''}`,`Position units, grade or title are inconsistent: ${lastIssue?.message_en??''}`,{blocking:lastIssue?.blocking_entity??null}),400);
  }
  let hrPlan:{impact:HrRuleImpact;token:string}|null=null;
  if(entity==='hrRules'){
    // rule_type is explicit on input so an empty company never silently becomes a Branch Fallback.
    const ruleType=input.rule_type??(before?hrRuleType(before):values.company_id?'company_branch':null);
    const roster=await readHrRoster(db);
    // Deactivation stays possible even when the rule's HR person or scope has since become invalid.
    const issues=values.status==='active'?hrRuleIssues(catalog,roster,{...values,id,rule_type:ruleType}):hrRuleIssues(catalog,roster,{...values,id,rule_type:ruleType}).filter(issue=>issue.code==='HR_RULE_TYPE_INVALID'||issue.code==='REQUIRED_FIELD');
    if(issues.length){const first=issues[0];throw asResponse(new OrganizationError({...first,details:{...(first.details&&typeof first.details==='object'?first.details as object:{}),issues}}),first.code==='HR_RULE_DUPLICATE'?409:400);}
    const impact=hrRuleImpact(catalog,roster,await readHrEmployees(db),{...values,id});
    hrPlan={impact,token:hrImpactToken({...values,id},impact)};
  }
  const companyIds=entity==='branches'&&Array.isArray(input.companyIds)?[...new Set(input.companyIds.map(v=>assignmentId(v,'companyIds')))].filter((value):value is number=>Boolean(value)):null;
  const branchIds=['companies','departments'].includes(entity)&&Array.isArray(input.branchIds)?[...new Set(input.branchIds.map(v=>assignmentId(v,'branchIds')))].filter((value):value is number=>Boolean(value)):null;
  if(branchIds&&branchIds.some(branch=>!activeIn(catalog.branches,branch)&&!(entity==='companies'?catalog.companyBranches:catalog.branchScopes).some(link=>Number(link[entity==='companies'?'company_id':'department_id'])===id&&Number(link.branch_id)===branch)))throw fail('INVALID_BRANCH','branchIds','اختر فروعًا نشطة','Select active branches');
  if(companyIds&&companyIds.some(company=>!activeIn(catalog.companies,company)&&!catalog.companyBranches.some(link=>Number(link.branch_id)===id&&Number(link.company_id)===company)))throw fail('INVALID_COMPANY','companyIds','اختر شركات نشطة','Select active companies');
  if(entity==='departments'&&values.branch_scope==='selected'){
    const selected=branchIds??catalog.branchScopes.filter(r=>Number(r.department_id)===id).map(r=>Number(r.branch_id));
    if(!selected.length)throw fail('UNIT_OUTSIDE_BRANCH_SCOPE','branchIds','اختر فرعًا واحدًا على الأقل','Select at least one branch');
    if(selected.some(branch=>!catalog.companyBranches.some(r=>Number(r.company_id)===Number(values.company_id)&&Number(r.branch_id)===branch)))throw fail('BRANCH_NOT_LINKED','branchIds','اختر فروعًا مرتبطة بالشركة','Select branches linked to the company');
  }
  // Impact plan: what the change would do to existing references. Blocking items are refused on save.
  const plan=emptyPlan();
  if(hrPlan){
    plan.impact.hr=hrPlan.impact;
    if(hrImpactChanges(hrPlan.impact)){
      const i=hrPlan.impact;
      plan.warnings.push(issueOf(orgError('HR_ROUTING_CHANGE',null,`يتغير مسؤول الموارد البشرية الفعلي لـ ${hrImpactChanges(i)} موظف (${i.toThisRule.length} إلى هذه القاعدة، ${i.toOtherRule.length} إلى قاعدة أخرى، ${i.toNone.length} بلا مسؤول)`,`The effective HR responsible changes for ${hrImpactChanges(i)} employee(s) (${i.toThisRule.length} to this rule, ${i.toOtherRule.length} to another rule, ${i.toNone.length} with no HR responsible)`,{details:{employees:[...i.toThisRule,...i.toOtherRule,...i.toNone]}})));
      plan.confirmationToken=hrPlan.token;
    }
  }
  if(id&&before){
    let ctx:ImpactContext|null=null;const context=async()=>ctx??=await readImpactContext(db,catalog);
    const block=(issue:OrganizationIssue)=>plan.blocking.push(issue);
    const usage=async()=>readOrganizationUsage(db,entity,id);
    if(values.status!=='active'&&before.status==='active'){
      const u=await usage();
      if(u.active){const s=usageSummary(u,{activeOnly:true});const extra=entity==='positions'?{occupants:positionOccupantsImpact(await context(),id).current}:{};
        block(issueOf(orgError('ACTIVE_DEPENDENTS','status',`لا يمكن إلغاء التفعيل: مستخدم حاليًا (${s.ar})`,`Cannot deactivate: in use (${s.en})`,{blocking:{type:entity,id,name:before.name_en??null},details:{usage:s.lines,...extra}})));}
      plan.impact.usage=usageSummary(u).lines;
    }
    const scopeBefore=catalog.branchScopes.filter(r=>Number(r.department_id)===id).map(r=>Number(r.branch_id)).sort((a,b)=>a-b);
    const scopeAfter=values.branch_scope==='selected'?[...(branchIds??scopeBefore)].sort((a,b)=>a-b):[];
    const scopeChanged=entity==='departments'&&(changed('branch_scope')||(values.branch_scope==='selected'&&scopeAfter.join(',')!==scopeBefore.join(',')));
    const structural=config.structural.filter(key=>key!=='branch_scope'||entity!=='departments').filter(changed);
    if(adoption){
      if(structural.some(k=>k!=='company_id'&&k!=='organization_kind'&&k!=='parent_id'))block(issueOf(orgError('REFERENCED_ENTITY_CONFLICT',null,'غيّر الشركة فقط عند ربط وحدة قديمة','Only the company may change while adopting a legacy unit')));
      mergePlan(plan,legacyAdoptionImpact(await context(),before,Number(values.company_id)));
      if(scopeChanged)mergePlan(plan,unitScopeImpact(await context(),id,{company_id:values.company_id,branch_scope:values.branch_scope,branchIds:scopeAfter}));
    }else{
      if(structural.length&&entity!=='positions'){const u=await usage();if(Object.entries(u.references).some(([ref,c])=>!ref.startsWith('company_branches:')&&c.total>0)){const s=usageSummary(u);
        block(issueOf(orgError('REFERENCED_ENTITY_CONFLICT',structural[0],`الحقول الهيكلية مقفلة لوجود ارتباطات (${s.ar})`,`Structural fields are locked: referenced by ${s.en}`,{blocking:{type:entity,id,name:before.name_en??null},details:{fields:structural,usage:s.lines}})));}}
      if(scopeChanged)mergePlan(plan,unitScopeImpact(await context(),id,{company_id:values.company_id,branch_scope:values.branch_scope,branchIds:scopeAfter}));
    }
    if(entity==='departments'&&values.status==='active'&&before.status!=='active'&&before.company_id)mergePlan(plan,reactivationImpact(before,{branch_scope:values.branch_scope,branchIds:scopeAfter}));
    if(entity==='branches'&&companyIds)for(const link of catalog.companyBranches.filter(r=>Number(r.branch_id)===id&&!companyIds.includes(Number(r.company_id))))mergePlan(plan,linkRemovalImpact(await context(),Number(link.company_id),id));
    if(entity==='companies'&&branchIds)for(const link of catalog.companyBranches.filter(r=>Number(r.company_id)===id&&!branchIds.includes(Number(r.branch_id))))mergePlan(plan,linkRemovalImpact(await context(),id,Number(link.branch_id)));
  }
  return {entity,config,id,before,values,catalog,branchIds,companyIds,plan};
}

/** Read-only preview: validation failures and blocking impact come back as issues instead of errors. */
export async function previewOrganizationEntity(db:TransactionDatabase,entity:string,input:Row){
  try{
    const {plan,before,values}=await prepareOrganizationEntity(db,entity,input);
    return {ok:!plan.blocking.length,blocking:plan.blocking,warnings:plan.warnings,confirmationToken:plan.confirmationToken,impact:plan.impact,before,after:values};
  }catch(error){
    const issue=await issueFromThrown(error);if(!issue)throw error;
    return {ok:false,blocking:[issue],warnings:[],confirmationToken:null,impact:{},before:null,after:null};
  }
}
export async function issueFromThrown(error:unknown):Promise<OrganizationIssue|null>{
  if(isOrganizationError(error))return issueOf(error);
  if(error instanceof Response&&(error.headers.get('content-type')||'').includes('application/json')){const body=await error.clone().json().catch(()=>null);if(body?.code)return {code:body.code,field:body.field??null,message_ar:body.message_ar,message_en:body.message_en,blocking_entity:body.blocking_entity??null,details:body.details??null};}
  return null;
}
/** Enforces the plan: blocking issues refuse the save; reviewed impact must be confirmed with the current token. */
export function enforcePlan(plan:ImpactPlan,confirmImpact:unknown){
  if(plan.blocking.length){const first=plan.blocking[0];throw asResponse(new OrganizationError({...first,details:{...(first.details&&typeof first.details==='object'?first.details as object:{}),issues:plan.blocking,warnings:plan.warnings,impact:plan.impact}}),409);}
  if(plan.confirmationToken&&confirmImpact&&String(confirmImpact)!==plan.confirmationToken)throw asResponse(orgError('STALE_REVIEW',null,'تغير أثر هذا التعديل منذ مراجعته؛ راجعه مرة أخرى','The impact of this change has changed since it was reviewed; review it again',{status:409,details:{warnings:plan.warnings,impact:plan.impact,confirmationToken:plan.confirmationToken}}),409);
  if(plan.confirmationToken&&String(confirmImpact??'')!==plan.confirmationToken)throw asResponse(orgError('IMPACT_NOT_CONFIRMED',null,'راجع أثر التغيير وأكده قبل الحفظ','Review and confirm the impact of this change before saving',{status:409,details:{warnings:plan.warnings,impact:plan.impact,confirmationToken:plan.confirmationToken}}),409);
}

export async function saveOrganizationEntity(db:TransactionDatabase,entity:string,input:Row,actorId?:number){
  const {config,id,before,values,branchIds,companyIds,plan}=await prepareOrganizationEntity(db,entity,input);
  enforcePlan(plan,input.confirmImpact);
  const relationsBefore=id?await relationsOf(db,entity,id):{};
  const fields=config.fields;
  const result=id?await db.prepare(`UPDATE ${config.table} SET ${fields.map(f=>`${f}=?`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING id`).bind(...fields.map(f=>values[f]),id).first<{id:number}>():await db.prepare(`INSERT INTO ${config.table} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')}) RETURNING id`).bind(...fields.map(f=>values[f])).first<{id:number}>();
  const savedId=Number(result!.id);
  if(branchIds&&['companies','departments'].includes(entity)){
    const table=entity==='companies'?'company_branches':'organization_branch_scopes',column=entity==='companies'?'company_id':'department_id';
    await db.prepare(`DELETE FROM ${table} WHERE ${column}=?`).bind(savedId).run();
    for(const branch of branchIds)await db.prepare(`INSERT INTO ${table} (${column},branch_id) VALUES (?,?)`).bind(savedId,branch).run();
  }
  if(companyIds){await db.prepare('DELETE FROM company_branches WHERE branch_id=?').bind(savedId).run();for(const company of companyIds)await db.prepare('INSERT INTO company_branches (company_id,branch_id) VALUES (?,?)').bind(company,savedId).run();}
  // Audit in the same transaction: exact before/after master rows, relationship additions/removals, status change.
  const after=await db.prepare(`SELECT * FROM ${config.table} WHERE id=?`).bind(savedId).first<Row>();
  const relationsAfter=(branchIds||companyIds)?{...(branchIds?{branchIds}:{}),...(companyIds?{companyIds}:{})}:await relationsOf(db,entity,savedId);
  const diff=(key:'branchIds'|'companyIds')=>{const b=((relationsBefore as Row)[key]??[]) as number[],a=((relationsAfter as Row)[key]??[]) as number[];return {added:a.filter(x=>!b.includes(x)),removed:b.filter(x=>!a.includes(x))};};
  const relationChanges=Object.fromEntries((['branchIds','companyIds'] as const).filter(k=>k in relationsAfter).map(k=>[k,diff(k)]));
  const action=!before?'create':'update';
  await db.prepare(`INSERT INTO audit_logs(user_id,action,module,record_type,record_id,previous_value,new_value) VALUES (?,'${action}','system_settings',?,?,?,?)`).bind(actorId||null,config.table,String(savedId),before?JSON.stringify({...before,...relationsBefore}):null,JSON.stringify({...(after??values),...relationsAfter,...(Object.keys(relationChanges).length?{relationChanges}:{}),...(before&&before.status!==values.status?{statusChange:{before:before.status,after:values.status}}:{}),...(plan.warnings.length?{confirmedImpact:plan.warnings.map(w=>w.code)}:{})})).run();
  return {id:savedId};
}

/**
 * Permanent removal, only for records nothing has ever referenced (no employees, units, positions, titles, rules or
 * scopes, active or historical). Anything referenced must be deactivated instead; the error lists what uses it.
 */
export async function deleteOrganizationEntity(db:TransactionDatabase,entity:string,rawId:unknown,actorId?:number){
  const config=catalogEntities[entity];if(!config)throw fail('INVALID_SELECTION','entity','نوع سجل غير معروف','Unknown organizational entity');
  await db.prepare('SELECT pg_advisory_xact_lock(78231)').run();
  const id=assignmentId(rawId,'id');if(!id)throw fail('INVALID_SELECTION','id','اختر سجلًا','Select a record');
  const before=await db.prepare(`SELECT * FROM ${config.table} WHERE id=? FOR UPDATE`).bind(id).first<Row>();
  if(!before)throw fail('NOT_FOUND','id','السجل غير موجود','Record not found',{status:404});
  const usage=await readOrganizationUsage(db,entity,id);
  const linkOnly=Object.entries(usage.references).every(([ref,c])=>ref.startsWith('company_branches:')||c.total===0);
  if(!linkOnly){const s=usageSummary(usage);throw fail('REFERENCED_ENTITY_CONFLICT',null,`لا يمكن الحذف لأن السجل مستخدم (${s.ar}). ألغِ تفعيله بدلًا من ذلك`,`Cannot delete: the record is in use (${s.en}). Deactivate it instead`,{status:409,blocking:{type:entity,id,name:before.name_en??null},details:{usage:s.lines}});}
  if(entity==='departments'&&!before.company_id)throw fail('LEGACY_UNIT',null,'لا تُحذف الوحدات القديمة؛ ألغِ تفعيلها','Legacy units are never deleted; deactivate them instead',{status:409});
  const relations=await relationsOf(db,entity,id);
  if(entity==='companies')await db.prepare('DELETE FROM company_branches WHERE company_id=?').bind(id).run();
  if(entity==='branches')await db.prepare('DELETE FROM company_branches WHERE branch_id=?').bind(id).run();
  if(entity==='departments')await db.prepare('DELETE FROM organization_branch_scopes WHERE department_id=?').bind(id).run();
  try{await db.prepare(`DELETE FROM ${config.table} WHERE id=?`).bind(id).run();}
  catch(error){const e=error as {code?:string;cause?:{code?:string}};if(e?.code==='23503'||e?.cause?.code==='23503')throw fail('REFERENCED_ENTITY_CONFLICT',null,'السجل مستخدم في بيانات أخرى؛ ألغِ تفعيله بدلًا من الحذف','The record is referenced elsewhere; deactivate it instead',{status:409});throw error;}
  await db.prepare("INSERT INTO audit_logs(user_id,action,module,record_type,record_id,previous_value,new_value) VALUES (?,'delete','system_settings',?,?,?,NULL)").bind(actorId||null,config.table,String(id),JSON.stringify({...before,...relations})).run();
  return {id,deleted:true};
}

/**
 * Super Admin only (the route checks the role). Deletes a unit and every sub-unit under it even when they are in use:
 * employee, position and job-title references are cleared, branch scopes removed; recruitment rows follow their
 * foreign-key rules. Each removed unit gets an audit row listing exactly which records were detached from it.
 */
export async function forceDeleteDepartment(db:TransactionDatabase,rawId:unknown,actorId?:number){
  await db.prepare('SELECT pg_advisory_xact_lock(78231)').run();
  const id=assignmentId(rawId,'id');if(!id)throw fail('INVALID_SELECTION','id','اختر سجلًا','Select a record');
  const units=(await db.prepare('SELECT * FROM departments ORDER BY id FOR UPDATE').all()).results as Row[];
  if(!units.some(u=>Number(u.id)===id))throw fail('NOT_FOUND','id','السجل غير موجود','Record not found',{status:404});
  const order:number[]=[];const queue=[id];
  while(queue.length){const current=queue.shift()!;if(order.includes(current))continue;order.push(current);for(const u of units)if(Number(u.parent_id)===current)queue.push(Number(u.id));}
  const detach=async(unitId:number)=>{
    const cleared:Record<string,number[]>={};
    const clear=async(table:string,column:string)=>{const rows=(await db.prepare(`UPDATE ${table} SET ${column}=NULL,updated_at=CURRENT_TIMESTAMP WHERE ${column}=? RETURNING id`).bind(unitId).all()).results??[];if(rows.length)cleared[`${table}:${column}`]=rows.map(r=>Number(r.id));};
    for(const column of ['department_id','section_id','team_id']){await clear('employees',column);await clear('positions',column);}
    await clear('job_titles','department_id');
    return cleared;
  };
  // Deepest units first so no remaining row still points at a deleted parent.
  for(const unitId of [...order].reverse()){
    const before=units.find(u=>Number(u.id)===unitId)!;
    const relations=await relationsOf(db,'departments',unitId);
    const detached=await detach(unitId);
    await db.prepare('UPDATE departments SET parent_id=NULL WHERE parent_id=?').bind(unitId).run();
    await db.prepare('DELETE FROM organization_branch_scopes WHERE department_id=?').bind(unitId).run();
    await db.prepare('DELETE FROM departments WHERE id=?').bind(unitId).run();
    await db.prepare("INSERT INTO audit_logs(user_id,action,module,record_type,record_id,previous_value,new_value) VALUES (?,'delete','system_settings','departments',?,?,?)").bind(actorId||null,String(unitId),JSON.stringify({...before,...relations}),JSON.stringify({forced:true,requestedUnitId:id,detached})).run();
  }
  return {id,deleted:true,forced:true,deletedUnitIds:order};
}

/** References cleared (set to NULL) before a forced delete of a position or job title. */
const forceClears:Record<string,{table:string;refs:[string,string,boolean][]}>={
  positions:{table:'positions',refs:[['employees','position_id',true]]},
  jobTitles:{table:'job_titles',refs:[['employees','job_title_id',true],['positions','job_title_id',true],['job_openings','job_title_id',false]]},
};
/** Super Admin only (the route checks the role): deletes a position or job title even when in use, clearing every reference. */
export async function forceDeleteOrganizationEntity(db:TransactionDatabase,entity:string,rawId:unknown,actorId?:number){
  if(entity==='departments')return forceDeleteDepartment(db,rawId,actorId);
  const config=forceClears[entity];if(!config)throw fail('INVALID_SELECTION','entity','لا يمكن الحذف بالقوة لهذا النوع','Force delete is not available for this record type');
  await db.prepare('SELECT pg_advisory_xact_lock(78231)').run();
  const id=assignmentId(rawId,'id');if(!id)throw fail('INVALID_SELECTION','id','اختر سجلًا','Select a record');
  const before=await db.prepare(`SELECT * FROM ${config.table} WHERE id=? FOR UPDATE`).bind(id).first<Row>();
  if(!before)throw fail('NOT_FOUND','id','السجل غير موجود','Record not found',{status:404});
  const detached:Record<string,number[]>={};
  for(const [table,column,stamped] of config.refs){const rows=(await db.prepare(`UPDATE ${table} SET ${column}=NULL${stamped?',updated_at=CURRENT_TIMESTAMP':''} WHERE ${column}=? RETURNING id`).bind(id).all()).results??[];if(rows.length)detached[`${table}:${column}`]=rows.map(r=>Number(r.id));}
  await db.prepare(`DELETE FROM ${config.table} WHERE id=?`).bind(id).run();
  await db.prepare("INSERT INTO audit_logs(user_id,action,module,record_type,record_id,previous_value,new_value) VALUES (?,'delete','system_settings',?,?,?,?)").bind(actorId||null,config.table,String(id),JSON.stringify(before),JSON.stringify({forced:true,detached})).run();
  return {id,deleted:true,forced:true};
}
