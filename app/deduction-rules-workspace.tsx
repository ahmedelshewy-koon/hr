"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DeductionRulesSection } from "./settings/hr/deduction-rules";
import { payrollExcel } from "./payroll/export";
import type { HrSettingsData, HrSettingsEntity } from "./settings/hr/shared";
import type { Row } from "./ui-types";
import "./payroll-rebuild.css";

export function DeductionRulesWorkspace(){
  const [rtl,setRtl]=useState(false),[data,setData]=useState<HrSettingsData|null>(null),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [firstSort,setFirstSort]=useState("name_en"),[secondSort,setSecondSort]=useState(""),[descending,setDescending]=useState(false);
  useEffect(()=>setRtl(localStorage.getItem("hr-language")==="ar"),[]);
  const reload=useCallback(async()=>{try{const response=await fetch("/api/deduction-rules-setup",{cache:"no-store"});if(!response.ok)throw new Error(await response.text());const result=await response.json() as {deductionRules:Row[];canManage:boolean};setData({deductionRules:result.deductionRules,canManage:result.canManage,attendanceTypes:[],documentTypes:[],medicalPlans:[]});setError("");}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}},[]);
  useEffect(()=>{void reload();},[reload]);
  const post=async(action:string,record:Row)=>{const response=await fetch("/api/deduction-rules-setup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,record})});if(!response.ok)throw new Error(await response.text());await reload();setMessage(rtl?"تم حفظ قواعد الخصم":"Deduction rules saved");};
  const save=async(_entity:HrSettingsEntity,record:Row)=>post("save",record);
  const remove=async(_entity:HrSettingsEntity,row:Row,question:string)=>{if(window.confirm(question))await post("delete",{id:row.id});};
  const sorted=useMemo(()=>[...(data?.deductionRules||[])].sort((a,b)=>{const compare=(key:string)=>String(a[key]??"").localeCompare(String(b[key]??""),rtl?"ar":"en",{numeric:true});return (descending?-1:1)*(compare(firstSort)||(secondSort?compare(secondSort):0));}),[data,firstSort,secondSort,descending,rtl]);
  const exportExcel=()=>{if(!data)return;const xml=payrollExcel(sorted,"Deduction Rules"),blob=new Blob(["\ufeff",xml],{type:"application/vnd.ms-excel;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="deduction-rules.xls";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const sortOptions=[["name_en","Name","الاسم"],["rule_type","Type","النوع"],["min_minutes","Minutes","الدقائق"],["value","Value","القيمة"],["status","Status","الحالة"]];
  return <section className="pr-page" dir={rtl?"rtl":"ltr"}><header className="pr-header"><h1>{rtl?"قواعد الخصم والعمل الإضافي":"Deduction & Overtime Rules"}</h1><div className="pr-actions"><button className="outline" onClick={exportExcel} disabled={!data}>{rtl?"تصدير Excel":"Export Excel"}</button><button className="outline" onClick={()=>window.print()}>{rtl?"طباعة":"Print"}</button></div></header>{error&&<div className="error-banner">{error}</div>}{message&&<div role="status">{message}</div>}<div className="panel pr-toolbar"><label>{rtl?"الترتيب الأول":"First sort"}<select value={firstSort} onChange={event=>setFirstSort(event.target.value)}>{sortOptions.map(([key,en,ar])=><option key={key} value={key}>{rtl?ar:en}</option>)}</select></label><label>{rtl?"الترتيب الثاني":"Second sort"}<select value={secondSort} onChange={event=>setSecondSort(event.target.value)}><option value="">{rtl?"بدون":"None"}</option>{sortOptions.filter(([key])=>key!==firstSort).map(([key,en,ar])=><option key={key} value={key}>{rtl?ar:en}</option>)}</select></label><button className="outline" onClick={()=>setDescending(!descending)}>{descending?"↓":"↑"}</button></div>{data&&<div className="panel pr-panel"><DeductionRulesSection rtl={rtl} data={{...data,deductionRules:sorted}} save={save} remove={remove}/></div>}</section>;
}
