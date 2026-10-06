export const REQUEST_TYPES = [
  {key:'work_from_home',value:'Work from home',en:'Work from home',ar:'العمل من المنزل'},
  {key:'late_arrival',value:'Late arrival',en:'Late arrival',ar:'التأخر'},
  {key:'early_departure',value:'Early departure',en:'Early departure',ar:'الانصراف المبكر'},
  {key:'expense',value:'Expense reimbursement',en:'Expense reimbursement',ar:'استرداد المصروفات'},
  {key:'experience_certificate',value:'Experience certificate',en:'Experience certificate',ar:'شهادة خبرة'},
  {key:'other',value:'Other request',en:'Other request',ar:'طلب آخر'},
  {key:'attendance_correction',value:'attendance_correction',en:'Attendance correction',ar:'تصحيح الحضور'},
] as const;
export type StepConfig = {kind:'user'|'manager'|'hr';userId?:number};
export type ResolvedStep = {userId:number;name:string;nameAr:string;decision?:'approve'|'reject';reason?:string;at?:string};
export type WorkflowRun = {currentStep:number;state:'pending'|'approved'|'rejected'|'cancelled';steps:ResolvedStep[]};
/** departmentId null = the company-wide default; a department/section workflow overrides it for employees in that unit. */
export type WorkflowConfig = {companyId:number;departmentId:number|null;requestType:string;version:number;active:boolean;steps:StepConfig[]};
const fail=(message:string,status=400):never=>{throw new Response(message,{status});};
export function workflowType(type:string,leaveTypeId?:number|null):string {
  if(leaveTypeId && Number.isSafeInteger(leaveTypeId) && leaveTypeId>0)return `leave:${leaveTypeId}`;
  return REQUEST_TYPES.find(item=>item.value===type)?.key??fail('نوع الطلب غير معروف / Unknown request type');
}
export function validateWorkflow(input:Record<string,unknown>):WorkflowConfig {
  const companyId=Number(input.companyId),version=Number(input.version),requestType=String(input.requestType||'');
  if(!Number.isSafeInteger(companyId)||companyId<1)fail('اختر الشركة / Select a company');
  const departmentId=input.departmentId===null||input.departmentId===undefined||input.departmentId===''?null:Number(input.departmentId);
  if(departmentId!==null&&(!Number.isSafeInteger(departmentId)||departmentId<1))fail('قسم غير صالح / Invalid department');
  if(!Number.isSafeInteger(version)||version<0)fail('إصدار غير صالح / Invalid version');
  if(!REQUEST_TYPES.some(t=>t.key===requestType)&&!/^leave:[1-9]\d*$/.test(requestType))fail('نوع طلب غير صالح / Invalid request type');
  if(typeof input.active!=='boolean')fail('حالة غير صالحة / Invalid state');
  if(!Array.isArray(input.steps)||input.steps.length<1||input.steps.length>30)fail('أضف من مرحلة إلى ٣٠ مرحلة / Add 1–30 stages');
  const seen=new Set<string>();
  const steps=(input.steps as Record<string,unknown>[]).map(s=>{
    if(!s||!['user','manager','hr'].includes(String(s.kind)))fail('موافق غير صالح / Invalid approver');
    const kind=s.kind as StepConfig['kind'],userId=Number(s.userId);
    if(kind==='user'&&(!Number.isSafeInteger(userId)||userId<1))fail('اختر الموافق / Select an approver');
    const key=kind==='user'?`user:${userId}`:kind;
    if(seen.has(key))fail('لا يمكن تكرار الموافق / Duplicate approver');seen.add(key);
    return kind==='user'?{kind,userId}:{kind};
  });
  return {companyId,departmentId,requestType,version,active:input.active as boolean,steps};
}
export function advanceWorkflow(run:WorkflowRun,actorId:number,expectedStage:string,decision:'approve'|'reject',reason:string):WorkflowRun {
  if(run.state!=='pending'||expectedStage!==`workflow:${run.currentStep}`)fail('تمت معالجة هذه المرحلة. حدّث الصفحة / This stage has changed. Refresh.',409);
  if(run.steps[run.currentStep]?.userId!==actorId)fail('هذا الطلب متاح للموافق الحالي فقط / Only the current approver may decide',403);
  if(!['approve','reject'].includes(decision))fail('قرار غير صالح / Invalid decision');
  if(decision==='reject'&&!reason.trim())fail('سبب الرفض مطلوب / Rejection reason required');
  const steps=run.steps.map((s,i)=>i===run.currentStep?{...s,decision,reason:reason.trim(),at:new Date().toISOString()}:{...s});
  const state=decision==='reject'?'rejected':run.currentStep===steps.length-1?'approved':'pending';
  return {steps,state,currentStep:state==='pending'?run.currentStep+1:run.currentStep};
}
