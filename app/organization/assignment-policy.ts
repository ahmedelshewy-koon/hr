import type { Row } from '../ui-types';
import { validateReportingManager } from './reporting-line.ts';
import { OrganizationError, isOrganizationError, issueOf, orgError, type OrganizationIssue } from './org-errors.ts';
import { resolveEmployeeHrResponsibility } from './hr-responsibility.ts';

export type OrganizationCatalog = {
  companies: Row[]; branches: Row[]; companyBranches: Row[]; departments: Row[];
  branchScopes: Row[]; positions: Row[]; grades: Row[]; workLocations: Row[];
  hrRules: Row[]; jobTitles: Row[];
};
export const assignmentFields = {
  companyId:'company_id', branchId:'branch_id', departmentId:'department_id', sectionId:'section_id',
  teamId:'team_id', positionId:'position_id', gradeId:'grade_id', workLocationId:'work_location_id',
  jobTitleId:'job_title_id', managerId:'manager_id', hrUserId:'hr_user_id',
} as const;
export const ASSIGNMENT_COLUMNS = Object.values(assignmentFields);
export const CURRENT_EMPLOYMENT = ['active','probation','notice_period'];
export function assignmentId(value: unknown): number|null {
  if(value===null||value===undefined||value==='')return null;
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<=0)throw orgError('INVALID_SELECTION',null,'اختيار تنظيمي غير صالح','Invalid organizational selection',{details:{value}});
  return id;
}
export function assignmentFromPayload(payload:Row,before:Row={}):Row {
  return Object.fromEntries(Object.entries(assignmentFields).map(([key,column])=>{
    try{return [column,assignmentId(payload[key]===undefined?before[column]:payload[key])];}
    catch(error){if(isOrganizationError(error))throw orgError('INVALID_SELECTION',column,error.message_ar,error.message_en,{details:error.details});throw error;}
  }));
}
const isCeo=(position?:Row|null)=>Boolean(position&&(position.is_ceo===true||Number(position.is_ceo)===1));
const unitName=(unit?:Row|null)=>unit?String(unit.name_en||unit.name_ar||unit.name||`#${unit.id}`):null;
/** Unit availability for a company+branch: active, owned by the company and inside the unit's branch scope. */
export function unitAvailable(unit:Row,companyId:unknown,branchId:unknown,catalog:OrganizationCatalog):boolean {
  if(Number(unit.company_id)!==Number(companyId)||unit.status!=='active')return false;
  if(unit.branch_scope==='selected'&&!catalog.branchScopes.some(s=>Number(s.department_id)===Number(unit.id)&&Number(s.branch_id)===Number(branchId)))return false;
  return true;
}
export { resolveHrRule } from './hr-responsibility.ts';

type Mode = 'change'|'diagnose';
/**
 * The single organizational assignment policy. In 'change' mode it judges a proposed FINAL assignment against the
 * saved one (retained legacy values stay valid while untouched). In 'diagnose' mode every present value is judged
 * as if newly chosen, which is how the profile explains retained legacy or inconsistent data.
 * Values are never inferred; this only reports.
 */
export function assignmentIssues(catalog:OrganizationCatalog,input:Row,before:Row={},mode:Mode='change'):OrganizationIssue[] {
  const next={...input};const issues:OrganizationIssue[]=[];
  const add=(error:OrganizationError)=>issues.push(issueOf(error));
  const changed=(key:string)=>mode==='diagnose'||Number(next[key]||0)!==Number(before[key]||0);
  const structural=['company_id','branch_id','department_id','section_id','team_id','position_id','grade_id','work_location_id','job_title_id'];
  const structuralChange=mode==='diagnose'||!before.id||structural.some(changed);
  const selectedPosition=catalog.positions.find(p=>Number(p.id)===Number(next.position_id));
  const ceoManager=()=>orgError('CEO_HAS_MANAGER','manager_id','الرئيس التنفيذي يجب أن يكون جذرًا للشركة','Company CEO must have no direct manager',{blocking:{type:'position',id:selectedPosition?.id,name:unitName(selectedPosition)}});
  if(isCeo(selectedPosition)&&next.manager_id&&(structuralChange||changed('manager_id'))){add(ceoManager());if(mode==='change')return issues;}
  if(!structuralChange)return issues;
  const retained=mode==='diagnose';
  const lookup=(rows:Row[],key:string,label:[string,string],missing:'INVALID_COMPANY'|'INVALID_BRANCH'|'INVALID_SELECTION'='INVALID_SELECTION')=>{
    if(!next[key])return undefined;
    const row=rows.find(r=>Number(r.id)===Number(next[key]));
    if(!row){add(orgError(missing,key,`${label[0]}: السجل غير موجود`,`${label[1]}: record not found`,{blocking:{type:key.replace(/_id$/,''),id:next[key]}}));return undefined;}
    if(row.status!=='active'&&changed(key))add(orgError(retained?'INACTIVE_RETAINED_VALUE':'INACTIVE_SELECTION',key,`${label[0]}: ${retained?'القيمة المحفوظة غير نشطة':'اختر سجلًا نشطًا'}`,`${label[1]}: ${retained?'the retained value is inactive':'Select an active record'}`,{blocking:{type:key.replace(/_id$/,''),id:row.id,name:unitName(row),status:row.status}}));
    return row;
  };
  const company=lookup(catalog.companies,'company_id',['الشركة','Company'],'INVALID_COMPANY');
  if(company&&company.status!=='active'&&!changed('company_id')){/* retained inactive company stays readable */}
  const branch=lookup(catalog.branches,'branch_id',['الفرع','Branch'],'INVALID_BRANCH');
  if(next.branch_id&&(!next.company_id||!catalog.companyBranches.some(r=>Number(r.company_id)===Number(next.company_id)&&Number(r.branch_id)===Number(next.branch_id))))
    add(orgError('BRANCH_NOT_LINKED','branch_id','الفرع غير مرتبط بالشركة','Branch does not belong to company',{blocking:{type:'branch',id:next.branch_id,name:unitName(branch),company_id:next.company_id??null}}));
  const position=lookup(catalog.positions,'position_id',['الوظيفة','Position']);
  if(position){
    for(const key of ['company_id','department_id','section_id','team_id','grade_id','job_title_id']){
      if(position[key]!=null&&Number(next[key])!==Number(position[key])){
        add(orgError('POSITION_CONTRADICTION',key,'التعيين يتعارض مع الوظيفة: '+key,'Assignment contradicts position: '+key,{blocking:{type:'position',id:position.id,name:unitName(position),expected:position[key],actual:next[key]??null}}));
        if(mode==='change')break;
      }
    }
  }
  for(const [key,kind] of [['department_id','department'],['section_id','section'],['team_id','team']]){
    const unit=lookup(catalog.departments,key,[kind==='department'?'الإدارة':kind==='section'?'القسم الفرعي':'الفريق',kind]);
    if(!unit)continue;
    const legacy=!unit.company_id&&!changed(key)&&!changed('company_id')&&!changed('branch_id');
    const blocking={type:'unit',id:unit.id,name:unitName(unit),company_id:unit.company_id??null,kind:unit.organization_kind??null};
    if(!legacy){
      if(!unit.company_id)add(orgError('LEGACY_UNIT',key,`وحدة قديمة بلا شركة (${unitName(unit)}) — اخترها من الهيكل الجديد`,`Legacy unit without a company (${unitName(unit)}) — choose a unit from the new structure`,{blocking:{...blocking,legacy:true}}));
      else if(Number(unit.company_id)!==Number(next.company_id))add(orgError('UNIT_OUTSIDE_COMPANY',key,'الوحدة غير متاحة للشركة والفرع','Unit outside company or branch scope',{blocking}));
      else if(unit.status==='active'&&!unitAvailable(unit,next.company_id,next.branch_id,catalog))add(orgError('UNIT_OUTSIDE_BRANCH_SCOPE',key,'الوحدة غير متاحة للشركة والفرع','Unit outside company or branch scope',{blocking:{...blocking,branch_id:next.branch_id??null}}));
      if(unit.company_id&&(unit.organization_kind||'department')!==kind)add(orgError('INVALID_UNIT_KIND',key,'نوع الوحدة غير صالح','Invalid unit type',{blocking}));
    }
    if(kind==='section'&&Number(unit.parent_id)!==Number(next.department_id))add(orgError('INVALID_PARENT',key,'القسم الفرعي لا يتبع الإدارة','Section does not belong to department',{blocking}));
    if(kind==='team'&&Number(unit.parent_id)!==Number(next.section_id||next.department_id))add(orgError('INVALID_PARENT',key,'الفريق لا يتبع الوحدة المحددة','Team does not belong to selected unit',{blocking}));
  }
  if((next.section_id||next.team_id)&&!next.department_id)add(orgError('DEPARTMENT_REQUIRED','department_id','الإدارة مطلوبة','Department is required'));
  lookup(catalog.grades,'grade_id',['الدرجة','Grade']);
  const location=lookup(catalog.workLocations,'work_location_id',['مقر العمل','Work location']);
  if(location?.branch_id&&Number(location.branch_id)!==Number(next.branch_id))add(orgError('WORK_LOCATION_BRANCH','work_location_id','مقر العمل لا يتبع الفرع','Work location does not belong to branch',{blocking:{type:'work_location',id:location.id,name:unitName(location),branch_id:location.branch_id}}));
  const title=lookup(catalog.jobTitles,'job_title_id',['المسمى الوظيفي','Job title']);
  if(title?.department_id&&Number(title.department_id)!==Number(next.department_id)&&(changed('job_title_id')||changed('department_id'))){
    const bound=catalog.departments.find(d=>Number(d.id)===Number(title.department_id));
    add(orgError('JOB_TITLE_DEPARTMENT_MISMATCH','job_title_id','المسمى لا يتبع الإدارة','Job title does not belong to department',{blocking:{type:'job_title',id:title.id,name:unitName(title),department_id:title.department_id,department_name:unitName(bound),legacy_binding:Boolean(bound&&!bound.company_id)}}));
  }
  if(isCeo(position)&&next.manager_id&&!issues.some(i=>i.code==='CEO_HAS_MANAGER'))add(ceoManager());
  return issues;
}
/** Pure policy shared by forms, services and rehearsal tests. Legacy values are retained, never mapped by name. */
export function validateAssignment(catalog:OrganizationCatalog,input:Row,before:Row={}):Row {
  const issues=assignmentIssues(catalog,input,before,'change');
  if(issues.length){const first=issues[0];throw new OrganizationError({...first,details:issues.length>1?{issue:first.details??null,issues}:first.details});}
  return {...input};
}
/** Why the SAVED assignment needs review (retained legacy, inactive or inconsistent values). Read-only. */
export function assignmentDiagnostics(catalog:OrganizationCatalog,row:Row,employees:Row[]=[]):OrganizationIssue[] {
  const issues=assignmentIssues(catalog,row,{},'diagnose').filter(issue=>issue.code!=='INVALID_SELECTION'||row[issue.field??'']);
  const title=catalog.jobTitles.find(t=>Number(t.id)===Number(row.job_title_id));
  const binding=title?.department_id?catalog.departments.find(d=>Number(d.id)===Number(title.department_id)):undefined;
  // A title still bound to a legacy unit needs review even while it matches the (equally legacy) department.
  if(binding&&!binding.company_id&&!issues.some(i=>i.field==='job_title_id'))issues.push(issueOf(orgError('LEGACY_UNIT','job_title_id',`ارتباط قديم: ${unitName(binding)} (#${binding.id})`,`Legacy binding: ${unitName(binding)} (#${binding.id})`,{blocking:{type:'job_title',id:title!.id,name:unitName(title),department_id:binding.id,department_name:unitName(binding),legacy_binding:true}})));
  if(row.manager_id){
    const manager=employees.find(e=>Number(e.id)===Number(row.manager_id));
    if(manager&&manager.employment_status&&!CURRENT_EMPLOYMENT.includes(manager.employment_status))issues.push(issueOf(orgError('MANAGER_INACTIVE','manager_id','المدير المباشر غير نشط','Direct manager is not active',{blocking:{type:'employee',id:manager.id,name:unitName(manager)}})));
    if(manager&&(row.company_id||manager.company_id)&&Number(manager.company_id||0)!==Number(row.company_id||0))issues.push(issueOf(orgError('MANAGER_COMPANY_MISMATCH','manager_id',manager.company_id?'المدير المباشر يتبع شركة أخرى':'شركة المدير المباشر غير محددة',manager.company_id?'Direct manager belongs to another company':'Direct manager has no company assignment',{blocking:{type:'employee',id:manager.id,name:unitName(manager),company_id:manager.company_id??null}})));
  }
  return issues;
}

export type AssignmentChange = { id:number; before:Row; next:Row; status?:string };
type GroupRow = { id:number; manager_id?:number|null; employment_status?:string; company_id?:number|null; position_id?:number|null; name_en?:string; name_ar?:string };
/**
 * Validates a set of FINAL assignments together (one employee for a profile save, several for a team transfer).
 * Manager/company consistency is judged against the managers' final state, so a manager and their direct reports
 * can move company in the same transaction without any intermediate state, and without clearing manager_id.
 */
export function assignmentGroupIssues(catalog:OrganizationCatalog,rows:GroupRow[],changes:AssignmentChange[],options:{visibleEmployeeIds?:Set<number>;teamTransfer?:boolean}={}):OrganizationIssue[] {
  const issues:OrganizationIssue[]=[];
  const moved=new Map(changes.map(c=>[Number(c.id),c]));
  const finalRows:GroupRow[]=rows.map(r=>{const c=moved.get(Number(r.id));return c?{...r,company_id:c.next.company_id??null,manager_id:c.next.manager_id??null,position_id:c.next.position_id??null,employment_status:c.status??r.employment_status}:r;});
  for(const c of changes)if(!rows.some(r=>Number(r.id)===Number(c.id)))finalRows.push({id:Number(c.id),company_id:c.next.company_id??null,manager_id:c.next.manager_id??null,position_id:c.next.position_id??null,employment_status:c.status??'active'});
  const byId=new Map(finalRows.map(r=>[Number(r.id),r]));
  const tag=(issue:OrganizationIssue,employeeId:number)=>({...issue,details:{...(issue.details&&typeof issue.details==='object'?issue.details as object:{}),employee_id:employeeId}});
  for(const c of changes){
    const id=Number(c.id),next=c.next,before=c.before;
    const managerChanged=Number(next.manager_id||0)!==Number(before.manager_id||0);
    const companyChanged=Number(next.company_id||0)!==Number(before.company_id||0);
    if(managerChanged||!before.id){
      try{validateReportingManager(finalRows as {id:number;manager_id:number|null;employment_status:string}[],id,next.manager_id??null);}
      catch(error){if(isOrganizationError(error))issues.push(tag(issueOf(error),id));else throw error;}
    }
    if(next.manager_id&&(managerChanged||companyChanged)){
      if(options.visibleEmployeeIds&&!options.visibleEmployeeIds.has(Number(next.manager_id)))issues.push(tag(issueOf(orgError('MANAGER_OUT_OF_SCOPE','manager_id','المدير خارج نطاق الصلاحيات','Manager outside visibility scope',{blocking:{type:'employee',id:next.manager_id}})),id));
      const manager=byId.get(Number(next.manager_id));
      if(next.company_id&&Number(manager?.company_id)!==Number(next.company_id))issues.push(tag(issueOf(orgError('MANAGER_COMPANY_MISMATCH','manager_id','المدير لا يتبع الشركة','Manager does not belong to company',{blocking:{type:'employee',id:next.manager_id,name:unitName(manager),company_id:manager?.company_id??null,expected_company_id:next.company_id}})),id));
    }
    try{validateAssignment(catalog,next,before);}catch(error){if(isOrganizationError(error))issues.push(tag(issueOf(error),id));else throw error;}
    const position=catalog.positions.find(p=>Number(p.id)===Number(next.position_id));
    if(isCeo(position)){
      if(next.manager_id&&!issues.some(i=>i.code==='CEO_HAS_MANAGER'&&(i.details as Row)?.employee_id===id))issues.push(tag(issueOf(orgError('CEO_HAS_MANAGER','manager_id','الرئيس التنفيذي يجب أن يكون جذرًا للشركة','Company CEO must have no direct manager')),id));
      const status=c.status??before.employment_status??'active';
      const others=finalRows.filter(r=>Number(r.id)!==id&&Number(r.position_id)===Number(position!.id)&&CURRENT_EMPLOYMENT.includes(String(r.employment_status)));
      if(others.length&&CURRENT_EMPLOYMENT.includes(status))issues.push(tag(issueOf(orgError('CEO_OCCUPIED','position_id','وظيفة الرئيس التنفيذي مشغولة','CEO position is already occupied',{blocking:{type:'employee',id:others[0].id,name:unitName(others[0])}})),id));
    }
    if(options.teamTransfer&&companyChanged&&before.id){
      const outside=finalRows.filter(r=>Number(r.manager_id)===id&&r.employment_status!=='deleted'&&Number(r.company_id||0)!==Number(next.company_id||0));
      if(outside.length)issues.push(tag(issueOf(options.teamTransfer
        ?orgError('PARTIAL_TEAM_TRANSFER','manager_id','لا يمكن نقل جزء من الفريق: أضف المرؤوسين المباشرين إلى النقل','Partial team transfer: include these direct reports in the transfer',{blocking:{type:'employee',id},details:{reports:outside.map(r=>({id:r.id,name:unitName(r),company_id:r.company_id??null}))}})
        :orgError('DIRECT_REPORTS_OUTSIDE_COMPANY','company_id','انقل تبعية المرؤوسين قبل نقل المدير','Reassign direct reports before transferring their manager',{blocking:{type:'employee',id},details:{reports:outside.map(r=>({id:r.id,name:unitName(r),company_id:r.company_id??null})),resolution:'team_transfer'}})),id));
    }
  }
  return issues;
}
export function validateAssignmentGroup(catalog:OrganizationCatalog,rows:GroupRow[],changes:AssignmentChange[],options:{visibleEmployeeIds?:Set<number>;teamTransfer?:boolean}={}){
  const issues=assignmentGroupIssues(catalog,rows,changes,options);
  if(issues.length)throw new OrganizationError({...issues[0],details:{...(issues[0].details as object),issues}});
}

/** A position constrains only the fields it defines; a company-level Position (e.g. CEO) defines no unit. */
const positionDefines=(position:Row|undefined,column:string)=>Boolean(position&&position[column]!=null);
export function prefillPosition(form:Row,position?:Row):Row {
  if(!position)return {...form,positionId:''};
  const next:Row={...form,sectionId:'',teamId:'',positionId:String(position.id)};
  for(const [key,column] of Object.entries(assignmentFields))if(['company_id','department_id','section_id','team_id','grade_id','job_title_id'].includes(column)&&position[column]!=null)next[key]=String(position[column]);
  if(isCeo(position))next.managerId='';
  return next;
}

/** Draft changes never infer a company, branch, manager or HR override. */
export function changeAssignmentForm(form:Row,key:string,value:string,catalog:OrganizationCatalog):Row {
  const position=catalog.positions.find(p=>Number(p.id)===Number(form.positionId));
  const column=assignmentFields[key as keyof typeof assignmentFields];
  if(key!=='positionId'&&column&&position?.[column]!=null&&['company_id','department_id','section_id','team_id','grade_id','job_title_id'].includes(column))throw orgError('POSITION_CONTRADICTION',column,'أزل اختيار الوظيفة قبل تعديل حقل تحدده الوظيفة','Clear the position before changing a position-defined field');
  if(key==='managerId'&&isCeo(position)&&value)throw orgError('CEO_HAS_MANAGER','manager_id','الرئيس التنفيذي يجب أن يكون جذرًا للشركة','Company CEO must have no direct manager');
  const next={...form,[key]:value};
  const dependents:Record<string,string[]>={companyId:['branchId','departmentId','sectionId','teamId','positionId','workLocationId'],branchId:['departmentId','sectionId','teamId','positionId','workLocationId'],departmentId:['sectionId','teamId','positionId'],sectionId:['teamId','positionId'],teamId:['positionId']};
  if(String(form[key]??'')!==value)for(const child of dependents[key]||[]){
    // A company-level position stays valid when a unit or branch changes; it depends only on its company.
    if(child==='positionId'&&key!=='companyId'&&position&&!['department_id','section_id','team_id'].some(c=>positionDefines(position,c)))continue;
    next[child]='';
  }
  return key==='positionId'?prefillPosition(next,catalog.positions.find(p=>Number(p.id)===Number(value))):next;
}

export function assignmentOptions(catalog:OrganizationCatalog,form:Row,employees:Row[],hrResponsibles:Row[]=[]):Record<string,Row[]> {
  const active=(rows:Row[])=>rows.filter(r=>r.status==='active');
  const units=(kind:string)=>form.companyId&&form.branchId?catalog.departments.filter(d=>d.organization_kind===kind&&unitAvailable(d,form.companyId,form.branchId,catalog)):[];
  const positions=active(catalog.positions).filter(p=>Number(p.company_id)===Number(form.companyId)&&(!p.department_id||Number(p.department_id)===Number(form.departmentId))&&(!p.section_id||!form.sectionId||Number(p.section_id)===Number(form.sectionId))&&(!p.team_id||!form.teamId||Number(p.team_id)===Number(form.teamId))&&[p.department_id,p.section_id,p.team_id].filter(Boolean).every(id=>{const unit=catalog.departments.find(d=>Number(d.id)===Number(id));return form.branchId&&unit&&unitAvailable(unit,form.companyId,form.branchId,catalog);}));
  const position=catalog.positions.find(p=>Number(p.id)===Number(form.positionId));
  const managers=isCeo(position)?[]:employees.filter(e=>{
    if(!form.companyId||Number(e.company_id)!==Number(form.companyId))return false;
    try{validateReportingManager(employees as {id:number;manager_id:number|null;employment_status:string}[],Number(form.employeeId)||0,Number(e.id));return true;}catch{return false;}
  });
  return {companyId:active(catalog.companies),branchId:active(catalog.branches).filter(b=>catalog.companyBranches.some(l=>Number(l.company_id)===Number(form.companyId)&&Number(l.branch_id)===Number(b.id))),departmentId:units('department'),sectionId:units('section').filter(d=>Number(d.parent_id)===Number(form.departmentId)),teamId:units('team').filter(d=>Number(d.parent_id)===Number(form.sectionId||form.departmentId)),positionId:positions,jobTitleId:active(catalog.jobTitles).filter(j=>!j.department_id||Number(j.department_id)===Number(form.departmentId)),gradeId:active(catalog.grades).sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)||String(a.name_en||'').localeCompare(String(b.name_en||''))||Number(a.id)-Number(b.id)),workLocationId:active(catalog.workLocations).filter(w=>!w.branch_id||Number(w.branch_id)===Number(form.branchId)),managerId:managers,hrUserId:hrResponsibles.filter(h=>h.status==='active'&&h.eligible&&(!form.employeeId||Number(h.employee_id)!==Number(form.employeeId))).map(h=>({...h,id:h.user_id}))};
}

export function retainedOptions(allowed:Row[],all:Row[],value:unknown):Row[] {
  const options:Row[]=allowed.map(row=>({...row,retained:false}));
  if(value&&!options.some(r=>Number(r.id)===Number(value))){
    const saved=all.find(r=>Number(r.id)===Number(value))??{id:Number(value),name_en:`Unavailable record #${value}`,name_ar:`سجل غير متاح #${value}`};
    options.push({...saved,retained:true});
  }
  return options;
}

export function assignmentChanges(form:Row,before:Row):{key:string;before:unknown;after:unknown}[] {
  const next=assignmentFromPayload(form,before);
  const changes=Object.entries(assignmentFields).filter(([,column])=>Number(next[column]||0)!==Number(before[column]||0)).map(([key,column])=>({key,before:before[column]??null,after:next[column]??null}));
  const date=form.assignmentEffectiveDate===undefined?before.assignment_effective_date:form.assignmentEffectiveDate;
  if(String(date||'')!==String(before.assignment_effective_date||''))changes.push({key:'assignmentEffectiveDate',before:before.assignment_effective_date||null,after:date||null});
  return changes;
}

/** Profile draft preview through the shared resolver; source is 'employee_override' | 'company_branch' | 'branch_fallback' | 'none'. */
export function resolvedHrResponsibility(catalog:OrganizationCatalog,form:Row,roster:Row[]) {
  const resolution=resolveEmployeeHrResponsibility({employee:{id:form.employeeId,company_id:form.companyId,branch_id:form.branchId,hr_user_id:form.hrUserId},catalog,roster});
  return {...resolution,userId:resolution.hrUserId,person:resolution.hr};
}

export function validateAssignmentDate(value:unknown) {
  if(!value)return;
  const text=String(value),date=new Date(`${text}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==text)throw orgError('INVALID_DATE','assignment_effective_date','تاريخ سريان غير صالح','Invalid assignment effective date');
}

export function profilePatch(form:Row,initial:Row):Row {
  return Object.fromEntries(Object.entries(form).filter(([key,value])=>key==='employeeId'||JSON.stringify(value)!==JSON.stringify(initial[key])));
}

export const REVIEW_COLUMNS=[...ASSIGNMENT_COLUMNS,'assignment_effective_date'];
export function assertAssignmentReviewCurrent(reviewed:Row,before:Row) {
  for(const column of REVIEW_COLUMNS){
    if(String(reviewed[column]??'')!==String(before[column]??''))throw orgError('STALE_REVIEW',column,'تغير التعيين منذ فتح الملف؛ أعد تحميله وراجع التغييرات','Assignment changed; reload the profile and review again',{status:409,blocking:{type:'employee',id:before.id??null}});
  }
}
