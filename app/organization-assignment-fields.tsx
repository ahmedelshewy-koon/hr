"use client";
import type { Row } from './ui-types';
import { assignmentFields, assignmentOptions, retainedOptions, changeAssignmentForm, resolvedHrResponsibility, assignmentChanges, assignmentDiagnostics, type OrganizationCatalog } from './organization/assignment-policy';
import type { OrganizationIssue } from './organization/org-errors';
import { hrSourceText } from './organization/hr-responsibility';
import { Building2, FileText, UserCheck } from 'lucide-react';
import './organization-settings.css';

const labels:Record<string,[string,string]>={companyId:['Company','الشركة'],branchId:['Branch','الفرع'],departmentId:['Department','الإدارة'],sectionId:['Section (optional)','القسم الفرعي (اختياري)'],teamId:['Team (optional)','الفريق (اختياري)'],positionId:['Position','الوظيفة'],jobTitleId:['Job title','المسمى الوظيفي'],managerId:['Direct manager','المدير المباشر'],gradeId:['Job grade / level','الدرجة الوظيفية'],workLocationId:['Work location','مقر العمل'],hrUserId:['HR responsible','مسؤول الموارد البشرية'],assignmentEffectiveDate:['Assignment effective date','تاريخ سريان التعيين']};
const label=(key:string,rtl:boolean)=>labels[key]?.[rtl?1:0]||key;
const rowName=(row:Row,rtl:boolean)=>String((rtl?row.name_ar:row.name_en)||row.name||row.email||row.id);
const keyOfColumn=Object.fromEntries(Object.entries(assignmentFields).map(([key,column])=>[column,key])) as Record<string,string>;
function catalogs(catalog:OrganizationCatalog,employees:Row[],hrResponsibles:Row[]):Record<string,Row[]>{return {companyId:catalog.companies,branchId:catalog.branches,departmentId:catalog.departments,sectionId:catalog.departments,teamId:catalog.departments,positionId:catalog.positions,jobTitleId:catalog.jobTitles,managerId:employees,gradeId:catalog.grades,workLocationId:catalog.workLocations,hrUserId:hrResponsibles.map(h=>({...h,id:h.user_id}))};}

export function AssignmentReview({rtl,form,before,catalog,employees,hrResponsibles}:{rtl:boolean;form:Row;before:Row;catalog:OrganizationCatalog;employees:Row[];hrResponsibles:Row[]}){
  const all=catalogs(catalog,employees,hrResponsibles),changes=assignmentChanges(form,before).filter(change=>change.key!=='teamId'&&change.key!=='gradeId');
  const hrBefore=resolvedHrResponsibility(catalog,{employeeId:before.id,companyId:before.company_id,branchId:before.branch_id,hrUserId:before.hr_user_id},hrResponsibles);
  const hrAfter=resolvedHrResponsibility(catalog,{...form,employeeId:before.id??form.employeeId},hrResponsibles);
  const hrText=(hr:ReturnType<typeof resolvedHrResponsibility>)=>`${hr.person?rowName(hr.person,rtl):hr.userId?'#'+hr.userId:(rtl?'يحتاج إعداد الموارد البشرية':'Needs HR setup')} · ${hrSourceText(hr,catalog,rtl)}`;
  const hrChanged=hrBefore.hrUserId!==hrAfter.hrUserId||hrBefore.source!==hrAfter.source||hrBefore.ruleId!==hrAfter.ruleId;
  const value=(key:string,id:unknown)=>{if(id===null||id==='')return rtl?'غير محدد':'Not assigned';if(key==='assignmentEffectiveDate')return String(id);const row=all[key]?.find(r=>Number(r.id)===Number(id));return row?rowName(row,rtl)+' (#'+id+')':'#'+id;};
  return <section className="org-assignment-review" aria-label={rtl?'مراجعة تغييرات التعيين':'Review assignment changes'}><h3>{rtl?'مراجعة قبل الحفظ':'Review before saving'}</h3><p>{rtl?`تُحفظ هذه التغييرات (${changes.length}) معًا في عملية واحدة، ويُتحقق من التعيين النهائي ككل. راجع أيضًا القيم التي ستُمسح.`:`These ${changes.length} changes are saved together in one transaction and the final assignment is validated as a whole. Review cleared values as well.`}</p><table><thead><tr><th>{rtl?'الحقل':'Field'}</th><th>{rtl?'قبل':'Before'}</th><th>{rtl?'بعد':'After'}</th></tr></thead><tbody>{changes.map(change=><tr key={change.key}><th>{label(change.key,rtl)}</th><td>{value(change.key,change.before)}</td><td>{value(change.key,change.after)}</td></tr>)}{hrChanged&&<tr className="org-review-derived" key="resolvedHr"><th>{rtl?'مسؤول الموارد البشرية الفعلي (مشتق)':'Resolved HR Responsible (derived)'}</th><td>{hrText(hrBefore)}</td><td>{hrText(hrAfter)}</td></tr>}</tbody></table>{hrChanged&&<p className="org-review-note">{rtl?'مسؤول الموارد البشرية الفعلي يُشتق من القواعد ولا يُحفظ في ملف الموظف؛ يُحفظ الاستثناء فقط إن اخترته صراحةً.':'The resolved HR Responsible is derived from the rules and is not stored on the employee; only an explicitly chosen override is saved.'}</p>}</section>;
}

/** Why a saved value needs review, in words an HR user can act on. */
export function issueExplanation(issue:OrganizationIssue,rtl:boolean):string{
  const b=(issue.blocking_entity??{}) as Row;
  if(issue.code==='JOB_TITLE_DEPARTMENT_MISMATCH'&&b.department_id)return rtl?`المسمى مرتبط بـ ${b.department_name??''} (#${b.department_id})${b.legacy_binding?' — ارتباط قديم':''}، بينما الإدارة الحالية مختلفة`:`Title is bound to ${b.department_name??''} (#${b.department_id})${b.legacy_binding?' — legacy binding':''}, not the current department`;
  if(issue.code==='LEGACY_UNIT'&&issue.field==='job_title_id')return rtl?`ارتباط قديم: ${b.department_name??''} (#${b.department_id}) — اختر مسمى من الهيكل الجديد أو اطلب ربط المسمى من الإعدادات`:`Legacy binding: ${b.department_name??''} (#${b.department_id}) — choose a title of the new structure, or rebind this title in Settings`;
  if(issue.code==='LEGACY_UNIT')return rtl?`وحدة قديمة بلا شركة (${b.name??''}) — اختر وحدة من الهيكل الجديد`:`Legacy unit without a company (${b.name??''}) — choose a unit from the new structure`;
  return rtl?issue.message_ar:issue.message_en;
}

export function OrganizationAssignmentFields({rtl,form,onChange,catalog,employees,hrResponsibles,before,orgExtra,contractFields}:{rtl:boolean;form:Row;onChange:(next:Row)=>void;catalog:OrganizationCatalog;employees:Row[];hrResponsibles:Row[];/** Saved employee row; enables "Needs review" explanations for retained values. */before?:Row;/** With contractFields: grouped Organization / Contract / HR layout matching the profile view. */orgExtra?:React.ReactNode;contractFields?:React.ReactNode}){
  const position=catalog.positions.find(p=>Number(p.id)===Number(form.positionId));
  const options=assignmentOptions(catalog,form,employees,hrResponsibles),all=catalogs(catalog,employees,hrResponsibles);
  // Diagnostics describe the SAVED value; once the draft replaces it, the final-state validation takes over.
  const diagnostics=before?.id?assignmentDiagnostics(catalog,before,employees).filter(issue=>{const key=keyOfColumn[issue.field??''];return key&&String(form[key]??'')===String(before[issue.field!]??'');}):[];
  const issuesFor=(key:string)=>diagnostics.filter(issue=>keyOfColumn[issue.field??'']===key);
  const companyLevel=Boolean(position&&!position.department_id&&!position.section_id&&!position.team_id);
  // The HR is shown by name at once: the rule's HR for this company + branch, and the one that applies after any override.
  const hrName=(hr:ReturnType<typeof resolvedHrResponsibility>)=>hr.person?rowName(hr.person,rtl):hr.userId?'#'+hr.userId:'';
  const automaticHr=resolvedHrResponsibility(catalog,{...form,employeeId:before?.id??form.employeeId,hrUserId:null},hrResponsibles);
  // Viewers without the rule list still get the saved HR name from the server while company and branch are unchanged.
  const savedAutomatic=before&&!before.hr_user_id&&String(form.companyId??'')===String(before.company_id??'')&&String(form.branchId??'')===String(before.branch_id??'')?String((rtl?before.hr_name_ar||before.hr_name:before.hr_name||before.hr_name_ar)||''):'';
  const automaticName=hrName(automaticHr)||savedAutomatic;
  const automaticLabel=automaticName?(rtl?`تلقائي: ${automaticName}`:`Automatic: ${automaticName}`):(rtl?'تلقائي: لا يوجد مسؤول لهذه الشركة والفرع':'Automatic: no HR set for this company and branch');
  const select=(key:string)=>{
    const column=assignmentFields[key as keyof typeof assignmentFields];
    const locked=Boolean(position&&['companyId','departmentId','sectionId','teamId','gradeId','jobTitleId'].includes(key)&&position[column]!=null)||Boolean(key==='managerId'&&(position?.is_ceo===true||Number(position?.is_ceo)===1));
    const issues=issuesFor(key);
    return <label className={`field${issues.length?' org-field-review':''}`} key={key}><span>{label(key,rtl)}{issues.length>0&&<em className="org-review-chip">{rtl?'يحتاج مراجعة':'Needs review'}</em>}</span><select value={form[key]||''} disabled={locked} aria-invalid={issues.length>0||undefined} onChange={e=>onChange(changeAssignmentForm(form,key,e.target.value,catalog))}><option value="">{key==='hrUserId'?automaticLabel:(rtl?'بدون / اختر':'None / select')}</option>{retainedOptions(options[key],all[key],form[key]).map(r=><option key={r.id} value={r.id} disabled={r.retained}>{rowName(r,rtl)}{r.retained?(rtl?' (قيمة محفوظة — تحتاج مراجعة)':' (retained — needs review)'):''}</option>)}</select>
      {locked&&<small>{rtl?'محدد من الوظيفة؛ أزل اختيار الوظيفة لتعديله.':'Defined by position; clear the position to edit.'}</small>}
      {key==='departmentId'&&companyLevel&&<small>{rtl?'الوظيفة على مستوى الشركة: الإدارة اختيارية ويمكن تركها فارغة.':'Company-level position: the department is optional and may be left empty.'}</small>}
      {issues.map((issue,index)=><small className="org-field-issue" role="note" key={index}>{issueExplanation(issue,rtl)}</small>)}
      {issues.length>0&&(options[key]?.length??0)>0&&<small>{rtl?`بدائل صالحة: ${options[key].length}`:`Valid replacements: ${options[key].length}`}</small>}
    </label>;
  };
  if(contractFields!==undefined)return <div className="org-assignment-groups">
    <section className="org-assignment-section org-group"><h3><Building2/>{rtl?'التنظيم':'Organization'}</h3><div className="org-assignment-fields">{['companyId','branchId','departmentId','sectionId','positionId','jobTitleId','managerId'].map(select)}{orgExtra}</div></section>
    <div className="org-group-split"><section className="org-assignment-section org-group"><h3><FileText/>{rtl?'العقد والدوام':'Contract and schedule'}</h3><div className="org-assignment-fields">{contractFields}</div></section>
    <section className="org-assignment-section org-group"><h3><UserCheck/>{rtl?'الموارد البشرية':'HR responsibility'}</h3><div className="org-assignment-fields">{select('hrUserId')}</div></section></div>
  </div>;
  return <section className="org-assignment-section"><h3>{rtl?'التعيين التنظيمي':'Organizational assignment'}</h3>
    <div className="org-assignment-fields">{['companyId','branchId','departmentId','sectionId','positionId','jobTitleId','managerId','hrUserId'].map(select)}</div>
  </section>;
}
