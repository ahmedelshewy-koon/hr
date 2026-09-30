"use client";

import {useState} from "react";
import {Building2, Users, Plus, Pencil} from "lucide-react";
import type {Row} from "./ui-types";
import "./company-hr-settings.css";

export function CompanyHrSettings({rtl,companies,hrResponsibles,hrCandidates,onSave,showCompanies=true}: {
  rtl:boolean;showCompanies?:boolean;companies:Row[];hrResponsibles:Row[];hrCandidates:Row[];onSave:(payload:Row)=>Promise<void>;
}) {
  const [name,setName]=useState(""),[companyId,setCompanyId]=useState<number|null>(null),[hrId,setHrId]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const save=async(payload:Row,done?:()=>void)=>{setBusy(true);setError("");try{await onSave(payload);done?.();}catch(reason){setError(reason instanceof Error?reason.message:(rtl?"تعذر الحفظ":"Unable to save"));}finally{setBusy(false);}};
  const hrName=(row:Row)=>String(rtl?row.name_ar||row.name_en:row.name_en||row.name_ar);
  return <section className="company-hr-settings">
    {error&&<p className="error-banner" role="alert">{error}</p>}
    <div className="company-hr-columns">
      {showCompanies&&<section className="panel company-hr-panel"><div className="panel-head"><h2><Building2 size={21}/>{rtl?"الشركات":"Companies"}</h2></div>
        <form onSubmit={event=>{event.preventDefault();void save({action:"save_company",companyId,name,active:companyId?companies.find(row=>Number(row.id)===companyId)?.status==="active":true},()=>{setName("");setCompanyId(null);});}}>
          <label>{rtl?"اسم الشركة":"Company name"}<input value={name} maxLength={200} required onChange={event=>setName(event.target.value)}/></label>
          <button className="primary" disabled={busy||!name.trim()}><Plus size={16}/>{companyId?(rtl?"حفظ التعديل":"Save changes"):(rtl?"إضافة شركة":"Add company")}</button>
          {companyId&&<button type="button" className="ghost" onClick={()=>{setCompanyId(null);setName("");}}>{rtl?"إلغاء":"Cancel"}</button>}
        </form>
        <ul>{companies.map(company=><li key={company.id}><div><b>{company.name}</b><small>{company.status==="active"?(rtl?"مفعّلة":"Active"):(rtl?"غير مفعّلة":"Inactive")}</small></div><button type="button" className="icon-btn" disabled={busy} aria-label={`${rtl?"تعديل":"Edit"} ${company.name}`} onClick={()=>{setCompanyId(Number(company.id));setName(company.name);}}><Pencil size={16}/></button><button className="outline" disabled={busy} onClick={()=>void save({action:"save_company",companyId:company.id,name:company.name,active:company.status!=="active"})}>{company.status==="active"?(rtl?"تعطيل":"Deactivate"):(rtl?"تفعيل":"Activate")}</button></li>)}</ul>
        {!companies.length&&<p>{rtl?"أضف الشركات لتظهر في ملف الموظف.":"Add companies to make them available in employee profiles."}</p>}
      </section>}
      <section className="panel company-hr-panel"><div className="panel-head"><h2><Users size={21}/>{rtl?"مسؤولو الموارد البشرية":"HR responsibles"}</h2></div>
        <form onSubmit={event=>{event.preventDefault();void save({action:"save_hr_responsible",hrUserId:hrId},()=>setHrId(""));}}>
          <label>{rtl?"الموظف المسؤول عن الموارد البشرية":"HR employee"}<select value={hrId} required onChange={event=>setHrId(event.target.value)}><option value="">{rtl?"اختر موظفًا":"Select an employee"}</option>{hrCandidates.filter(candidate=>!hrResponsibles.some(hr=>Number(hr.user_id)===Number(candidate.user_id)&&hr.status==="active")).map(candidate=><option key={candidate.user_id} value={candidate.user_id}>{hrName(candidate)} — {candidate.email}</option>)}</select></label>
          <button className="primary" disabled={busy||!hrId}><Plus size={16}/>{rtl?"إضافة مسؤول":"Add HR responsible"}</button>
        </form>
        <p>{rtl?"يظهر الموظفون المرتبطون بحسابات نشطة بصلاحية الموارد البشرية أو مدير النظام فقط. اختر مسؤول كل موظف من ملفه.":"Only employees linked to active HR or system administrator accounts are available. Assign each employee's HR in their profile."}</p>
        <ul>{hrResponsibles.map(hr=><li key={hr.user_id}><div><b>{hrName(hr)}</b><small>{hr.email} · {hr.status==="active"&&hr.eligible?(rtl?"مفعّل":"Active"):(rtl?"غير متاح للاعتماد":"Unavailable for approval")}</small></div><button className="outline" disabled={busy||(!hr.eligible&&hr.status!=="active")} onClick={()=>void save({action:"save_hr_responsible",hrUserId:hr.user_id,active:hr.status!=="active"})}>{hr.status==="active"?(rtl?"تعطيل":"Deactivate"):(rtl?"تفعيل":"Activate")}</button></li>)}</ul>
      </section>
    </div>
  </section>;
}

export function CompanyHrFields({rtl,companies=[],hrResponsibles=[],companyId,hrUserId,employeeId,onChange}: {
  rtl:boolean;companies?:Row[];hrResponsibles?:Row[];companyId:unknown;hrUserId:unknown;employeeId?:number;onChange:(key:string,value:string)=>void;
}) {
  return <div className="form-row company-hr-fields">
    <label className="field"><span>{rtl?"الشركة":"Company"}</span><select value={String(companyId||"")} onChange={event=>onChange("companyId",event.target.value)}><option value="">{rtl?"اختر الشركة":"Select company"}</option>{companies.filter(row=>row.status==="active"||Number(row.id)===Number(companyId)).map(row=><option key={row.id} value={row.id} disabled={row.status!=="active"}>{row.name}{row.status!=="active"?(rtl?" (غير مفعّلة)":" (inactive)"):""}</option>)}</select></label>
    <label className="field"><span>{rtl?"مسؤول الموارد البشرية":"HR responsible"}</span><select value={String(hrUserId||"")} onChange={event=>onChange("hrUserId",event.target.value)}><option value="">{rtl?"غير محدد":"Not assigned"}</option>{hrResponsibles.filter(row=>(row.status==="active"&&row.eligible&&(!employeeId||Number(row.employee_id)!==employeeId))||Number(row.user_id)===Number(hrUserId)).map(row=><option key={row.user_id} value={row.user_id} disabled={row.status!=="active"||!row.eligible}>{rtl?row.name_ar||row.name_en:row.name_en||row.name_ar}{row.status!=="active"||!row.eligible?(rtl?" (غير متاح)":" (unavailable)"):""}</option>)}</select><small>{rtl?"لا يمكن إرسال الطلبات بدون مسؤول موارد بشرية مفعّل.":"Requests require an active HR responsible."}</small></label>
  </div>;
}
