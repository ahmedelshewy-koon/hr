"use client";
import { useCallback, useEffect, useState } from "react";
import { AttendanceTypesSection } from "./settings/hr/attendance-types";
import type { HrSettingsData, HrSettingsEntity } from "./settings/hr/shared";
import type { Row } from "./ui-types";
import { TimesheetSettingsWorkspace } from "./timesheet-settings-workspace";
export function TimesheetSetupRoute({tab}:{tab:"types"|"plans"}){
  const [rtl,setRtl]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>setRtl(localStorage.getItem("hr-language")==="ar"),[]);
  return <>{tab==="types"&&<AttendanceTypeCatalog rtl={rtl} notify={setMessage}/>}<TimesheetSettingsWorkspace rtl={rtl} initialTab={tab} routePage notify={setMessage}/>{message&&<p role="status">{message}</p>}</>;
}

function AttendanceTypeCatalog({rtl,notify}:{rtl:boolean;notify:(message:string)=>void}) {
  const [data,setData]=useState<HrSettingsData|null>(null),[error,setError]=useState("");
  const [firstSort,setFirstSort]=useState("name_en"),[secondSort,setSecondSort]=useState(""),[descending,setDescending]=useState(false);
  const reload=useCallback(async()=>{try{const response=await fetch("/api/attendance-type-setup",{cache:"no-store"});if(!response.ok)throw new Error(await response.text());const result=await response.json() as {attendanceTypes:Row[];canManage:boolean};setData({attendanceTypes:result.attendanceTypes,canManage:result.canManage,documentTypes:[],deductionRules:[],medicalPlans:[]});setError("");}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}},[]);
  useEffect(()=>{void reload();},[reload]);
  const post=async(action:string,record:Row)=>{try{const response=await fetch("/api/attendance-type-setup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,record})});if(!response.ok)throw new Error(await response.text());await reload();window.dispatchEvent(new Event("timesheet-setup-changed"));notify(rtl?"تم حفظ نوع الحضور":"Attendance type saved");}catch(cause){setError(cause instanceof Error?cause.message:String(cause));throw cause;}};
  const save=async(_entity:HrSettingsEntity,record:Row)=>post("save",record);
  const remove=async(_entity:HrSettingsEntity,row:Row,question:string)=>{if(window.confirm(question))await post("delete",{id:row.id});};
  const sorted=[...(data?.attendanceTypes||[])].sort((a,b)=>{const compare=(key:string)=>String(a[key]??"").localeCompare(String(b[key]??""),rtl?"ar":"en",{numeric:true});return (descending?-1:1)*(compare(firstSort)||(secondSort?compare(secondSort):0));});
  return <section className="pr-page" dir={rtl?"rtl":"ltr"}>{error&&<p className="error-banner">{error}</p>}{data&&<div className="panel pr-panel"><h2>{rtl?"تعريف أنواع الحضور":"Attendance type definitions"}</h2><div className="pr-toolbar"><label>{rtl?"الترتيب الأول":"First sort"}<select value={firstSort} onChange={event=>setFirstSort(event.target.value)}><option value="name_en">{rtl?"الاسم":"Name"}</option><option value="code">{rtl?"الرمز":"Code"}</option><option value="status">{rtl?"الحالة":"Status"}</option></select></label><label>{rtl?"الترتيب الثاني":"Second sort"}<select value={secondSort} onChange={event=>setSecondSort(event.target.value)}><option value="">{rtl?"بدون":"None"}</option>{["name_en","code","status"].filter(key=>key!==firstSort).map(key=><option key={key} value={key}>{key}</option>)}</select></label><button className="outline" onClick={()=>setDescending(!descending)}>{descending?"↓":"↑"}</button></div><AttendanceTypesSection rtl={rtl} data={{...data,attendanceTypes:sorted}} save={save} remove={remove}/></div>}</section>;
}
