"use client";
import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2, GitBranch, RefreshCw } from 'lucide-react';
import type { StepConfig } from './approvals/workflow-policy';
import './approval-workflow-settings.css';
type Company={id:number;name:string;status:string};
type User={id:number;name_en:string;name_ar:string;email:string};
type Kind={key:string;en:string;ar:string};
type Department={id:number;company_id:number;parent_id:number|null;organization_kind:string|null;name_en:string;name_ar:string};
type Workflow={id:number;company_id:number;department_id:number|null;request_type:string;version:number;active:boolean;steps:StepConfig[]};
type Data={companies:Company[];departments:Department[];users:User[];types:Kind[];workflows:Workflow[];canManage:boolean};
/** department_id null is the company-wide workflow; a department or section workflow overrides it for that unit. */
const findWorkflow=(data:Data,companyId:number,departmentId:number|null,requestType:string)=>data.workflows.find(w=>Number(w.company_id)===companyId&&Number(w.department_id||0)===Number(departmentId||0)&&w.request_type===requestType);

function WorkflowEditor({data,companyId,departmentId,requestType,rtl,reload,notify}:{data:Data;companyId:number;departmentId:number|null;requestType:string;rtl:boolean;reload:()=>Promise<void>;notify:(s:string)=>void}){
  const saved=findWorkflow(data,companyId,departmentId,requestType);
  const companyWide=departmentId?findWorkflow(data,companyId,null,requestType):undefined;
  const [steps,setSteps]=useState<StepConfig[]>(saved?.steps??[{kind:'manager'},{kind:'hr'}]);
  const [active,setActive]=useState(saved?.active??true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState('');
  const name=(user:User)=>rtl?(user.name_ar||user.name_en):(user.name_en||user.name_ar);
  const stepName=(step:StepConfig)=>step.kind==='manager'?(rtl?'المدير المباشر':'Direct manager'):step.kind==='hr'?(rtl?'مسؤول الموارد البشرية للموظف':"Employee’s HR responsible"):name(data.users.find(u=>Number(u.id)===step.userId)??{id:0,name_ar:'موافق غير متاح',name_en:'Unavailable approver',email:''});
  const move=(index:number,offset:number)=>setSteps(old=>{const copy=[...old];[copy[index],copy[index+offset]]=[copy[index+offset],copy[index]];return copy;});
  const save=async()=>{setBusy(true);setError('');try{
    const response=await fetch('/api/approval-workflows',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({companyId,departmentId,requestType,version:saved?.version??0,active,steps})});
    const body=await response.json();if(!response.ok)throw new Error(body.error||'Unable to save');
    await reload();notify(rtl?'تم حفظ مسار الاعتماد':'Approval workflow saved');
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  return <form className="workflow-editor panel" onSubmit={e=>{e.preventDefault();void save();}}>
    <div className="workflow-editor-head"><div><h3>{rtl?'ترتيب الموافقين':'Approval order'}</h3><p>{saved?(rtl?`الإصدار ${saved.version}`:`Version ${saved.version}`):departmentId?(companyWide?.active?(rtl?'لا يوجد مسار خاص بهذا القسم؛ يتبع موظفوه مسار الشركة حتى الحفظ.':'No workflow for this department yet. Its employees follow the company workflow until saved.'):(rtl?'لا يوجد مسار خاص بهذا القسم ولا مسار للشركة؛ يُستخدم الإجراء الحالي حتى الحفظ.':'No department or company workflow yet. Existing rules apply until saved.')):(rtl?'لا يوجد مسار مخصص محفوظ؛ يُستخدم الإجراء الحالي حتى الحفظ.':'No custom workflow saved. Existing rules apply until saved.')}</p></div><label className="workflow-toggle"><input type="checkbox" checked={active} disabled={!data.canManage||busy} onChange={e=>setActive(e.target.checked)}/>{rtl?'مسار مفعّل':'Active workflow'}</label></div>
    {error&&<p className="error-banner" role="alert">{error}</p>}
    <fieldset disabled={!data.canManage||busy}>
      <label className="field"><span>{rtl?'بحث عن الموافق بالاسم أو البريد':'Find an approver by name or email'}</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder={rtl?'ابحث عن موظف…':'Search employees…'}/></label>
      <ol className="workflow-stages">{steps.map((step,index)=><li key={index}><span className="workflow-stage-number">{index+1}</span><label className="field"><span>{rtl?`الموافق ${index+1}`:`Approver ${index+1}`}</span><select value={step.kind==='user'?`user:${step.userId||''}`:step.kind} onChange={e=>{const value=e.target.value;setSteps(old=>old.map((s,i)=>i!==index?s:value.startsWith('user:')?{kind:'user',userId:Number(value.split(':')[1])}:{kind:value as 'manager'|'hr'}));}}>
        <option value="user:">{rtl?'اختر موظفًا':'Select an employee'}</option><option value="manager">{rtl?'المدير المباشر':'Direct manager'}</option><option value="hr">{rtl?'مسؤول الموارد البشرية للموظف':"Employee’s HR responsible"}</option>
        {step.kind==='user'&&step.userId&&!data.users.some(u=>Number(u.id)===step.userId)&&<option value={`user:${step.userId}`} disabled>{rtl?'موافق غير متاح':'Unavailable approver'}</option>}
        {data.users.filter(u=>Number(u.id)===step.userId||`${u.name_en} ${u.name_ar} ${u.email}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(u=><option key={u.id} value={`user:${u.id}`}>{name(u)} — {u.email}</option>)}
      </select></label><div className="workflow-stage-actions"><button type="button" className="icon-btn" disabled={index===0} onClick={()=>move(index,-1)} aria-label={rtl?'نقل لأعلى':'Move up'}><ArrowUp size={16}/></button><button type="button" className="icon-btn" disabled={index===steps.length-1} onClick={()=>move(index,1)} aria-label={rtl?'نقل لأسفل':'Move down'}><ArrowDown size={16}/></button><button type="button" className="icon-btn" disabled={steps.length===1} onClick={()=>setSteps(old=>old.filter((_,i)=>i!==index))} aria-label={rtl?'حذف المرحلة':'Remove stage'}><Trash2 size={16}/></button></div></li>)}</ol>
      <button type="button" className="outline" disabled={steps.length>=30} onClick={()=>setSteps(old=>[...old,{kind:'user'}])}><Plus size={16}/>{rtl?'إضافة مرحلة':'Add stage'}</button>
    </fieldset>
    <div className="workflow-preview"><b>{rtl?'مسار الطلب':'Request path'}</b><ol>{steps.map((s,i)=><li key={i}><span>{i+1}</span>{stepName(s)}</li>)}</ol></div>
    <p className="workflow-note">{active?(rtl?'تسري التعديلات على الطلبات الجديدة فقط. يحتفظ كل طلب جارٍ بالموافقين وترتيبهم وقت إرساله.':'Changes apply to new requests only. Existing requests retain their original approvers and order.'):departmentId?(rtl?'عند تعطيل مسار القسم، تتبع طلبات موظفيه مسار الشركة إن وُجد، وإلا الإجراء الحالي.':'When disabled, this department’s requests follow the company workflow if one exists, otherwise the existing rules.'):(rtl?'عند تعطيل هذا المسار، تتبع الطلبات الجديدة الإجراء الحالي للمدير والموارد البشرية.':'When disabled, new requests follow the existing manager and HR rules.')}</p>
    {data.canManage&&<button className="primary" disabled={busy||steps.some(s=>s.kind==='user'&&!s.userId)}><Save size={16}/>{busy?(rtl?'جارٍ الحفظ…':'Saving…'):(rtl?'حفظ مسار الاعتماد':'Save approval workflow')}</button>}
  </form>;
}
export function ApprovalWorkflowSettings({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[company,setCompany]=useState(''),[department,setDepartment]=useState(''),[type,setType]=useState('');
  const load=useCallback(async()=>{try{const response=await fetch('/api/approval-workflows',{cache:'no-store'}),body=await response.json();if(!response.ok)throw new Error(body.error||'Unable to load');setData(body);setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}},[]);
  const STORE='hr.approvalWorkflowSelection';
  // Restore the last selection after a refresh; it is applied once the data has loaded so stale ids are dropped.
  const [restored,setRestored]=useState(false);
  useEffect(()=>{if(!data||restored)return;const timer=window.setTimeout(()=>{setRestored(true);try{const v=JSON.parse(window.localStorage.getItem(STORE)||'{}');const c=data.companies.find(x=>String(x.id)===String(v.company));if(!c)return;setCompany(String(c.id));if(data.departments.some(d=>String(d.id)===String(v.department)&&Number(d.company_id)===Number(c.id)))setDepartment(String(v.department));if(data.types.some(t=>t.key===v.type))setType(String(v.type));}catch{/* saved selection unreadable */}},0);return()=>window.clearTimeout(timer);},[data,restored]);
  useEffect(()=>{if(!restored)return;try{window.localStorage.setItem(STORE,JSON.stringify({company,department,type}));}catch{/* storage unavailable */}},[restored,company,department,type]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer);},[load]);
  const departmentId=department?Number(department):null;
  const selected=data?findWorkflow(data,Number(company),departmentId,type):undefined;
  // Departments first, each followed by its sections, so the list reads like the organization tree.
  const units=(data?.departments??[]).filter(d=>Number(d.company_id)===Number(company));
  const unitName=(d:Department)=>rtl?(d.name_ar||d.name_en):(d.name_en||d.name_ar);
  const unitOptions=units.filter(d=>!d.parent_id||!units.some(p=>Number(p.id)===Number(d.parent_id))).flatMap(d=>[{unit:d,depth:0},...units.filter(c=>Number(c.parent_id)===Number(d.id)).map(c=>({unit:c,depth:1}))]);
  const customized=(id:number)=>Boolean(type&&data&&findWorkflow(data,Number(company),id,type));
  return <section className="workflow-settings"><header><div><h2><GitBranch size={24}/>{rtl?'إدارة مسارات الاعتماد':'Approval workflows'}</h2><p>{rtl?'حدد من يوافق على كل نوع طلب في كل شركة أو قسم، وبأي ترتيب.':'Choose who approves each request type for each company or department, in order.'}</p></div><button className="outline" onClick={()=>void load()}><RefreshCw size={16}/>{rtl?'تحديث':'Refresh'}</button></header>
    {error&&<p className="error-banner" role="alert">{error}</p>}
    {!data&&!error&&<p role="status">{rtl?'جارٍ التحميل…':'Loading…'}</p>}
    {data&&<><div className="workflow-selectors panel"><label className="field"><span>{rtl?'الشركة':'Company'}</span><select value={company} onChange={e=>{setCompany(e.target.value);setDepartment('');}}><option value="">{rtl?'اختر الشركة':'Select company'}</option>{data.companies.filter(c=>c.status==='active').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="field"><span>{rtl?'القسم':'Department'}</span><select value={department} disabled={!company} onChange={e=>setDepartment(e.target.value)}><option value="">{rtl?'كل الأقسام (مسار الشركة)':'All departments (company workflow)'}</option>{unitOptions.map(({unit,depth})=><option key={unit.id} value={unit.id}>{depth?'— ':''}{unitName(unit)}{customized(Number(unit.id))?(rtl?' • مسار خاص':' • custom'):''}</option>)}</select><small>{rtl?'مسار القسم يتقدّم على مسار الشركة لموظفي هذا القسم.':'A department workflow overrides the company workflow for that department’s employees.'}</small></label><label className="field"><span>{rtl?'نوع الطلب':'Request type'}</span><select value={type} onChange={e=>setType(e.target.value)}><option value="">{rtl?'اختر نوع الطلب':'Select request type'}</option>{data.types.map(t=><option key={t.key} value={t.key}>{rtl?t.ar:t.en}</option>)}</select></label></div>
      {company&&type?<WorkflowEditor key={`${company}:${department}:${type}:${selected?.version||0}`} data={data} companyId={Number(company)} departmentId={departmentId} requestType={type} rtl={rtl} reload={load} notify={notify}/>:<div className="workflow-empty panel"><GitBranch size={36}/><p>{rtl?'اختر الشركة ونوع الطلب لإعداد ترتيب الموافقين.':'Select a company and request type to configure approvers.'}</p></div>}</>}
  </section>;
}
