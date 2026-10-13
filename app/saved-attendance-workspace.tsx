"use client";
import { useCallback, useEffect, useState } from "react";
import { localizeApiMessage } from "./api-messages";
import { payrollExcel } from "./payroll/export";
import "./payroll-rebuild.css";

type Row=Record<string,unknown>;
const date=new Date().toISOString().slice(0,10);
const str=(value:unknown)=>String(value??"");

export function SavedAttendanceWorkspace() {
  const [rtl,setRtl]=useState(false),[country,setCountry]=useState("Egypt"),[from,setFrom]=useState(date.slice(0,7)+"-01"),[to,setTo]=useState(date),[search,setSearch]=useState("");
  const [sort,setSort]=useState("work_date"),[secondSort,setSecondSort]=useState(""),[direction,setDirection]=useState("desc"),[rows,setRows]=useState<Row[]>([]),[offset,setOffset]=useState(0),[hasMore,setHasMore]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const t=(en:string,ar:string)=>rtl?ar:en;
  const query=(page:number,limit=100)=>`/api/saved-attendance?${new URLSearchParams({country,from,to,search,sort,secondSort,direction,offset:String(page),limit:String(limit)})}`;
  const load=useCallback(async(page=0)=>{
    try{setError("");const response=await fetch(query(page));if(!response.ok)throw Error(localizeApiMessage(await response.text(),rtl));const data=await response.json() as {rows:Row[];hasMore:boolean};setRows(data.rows);setOffset(page);setHasMore(data.hasMore);}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  },[country,from,to,search,sort,secondSort,direction,rtl]);
  useEffect(()=>{setRtl((localStorage.getItem("hr-language")||"en")==="ar");},[]);
  useEffect(()=>{void load(0);},[load]);
  const confirm=async()=>{
    setBusy(true);setError("");setMessage("");
    try{const response=await fetch("/api/saved-attendance",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"confirm",country,from,to})});if(!response.ok)throw Error(localizeApiMessage(await response.text(),rtl));const result=await response.json() as {confirmed:number;existing:number};setMessage(t(`Confirmed ${result.confirmed}; already saved ${result.existing}`,`تم اعتماد ${result.confirmed}؛ محفوظ مسبقًا ${result.existing}`));await load(0);}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  };
  const notifyAttendance=async()=>{setBusy(true);setError("");setMessage("");try{const response=await fetch("/api/saved-attendance",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"send_notifications",country,from,to})});if(!response.ok)throw Error(localizeApiMessage(await response.text(),rtl));const result=await response.json() as {sent:number;skipped:number;failed:Row[];hasMore:boolean};setMessage(t(`Sent ${result.sent}; skipped ${result.skipped}; failed ${result.failed.length}${result.hasMore?". More records remain; send again.":""}`,`أُرسلت ${result.sent} رسالة، وتُخطّي ${result.skipped}، وفشلت ${result.failed.length}${result.hasMore?". توجد سجلات إضافية؛ أعد الإرسال.":""}`));await load(0);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);}};
  const exportAll=async()=>{
    try{setBusy(true);const all:Row[]=[];let page=0,more=true;while(more){const response=await fetch(query(page,500));if(!response.ok)throw Error(localizeApiMessage(await response.text(),rtl));const result=await response.json() as {rows:Row[];hasMore:boolean};all.push(...result.rows);more=result.hasMore;page+=500;if(page>20000)throw Error(t("Export exceeds 20,000 rows; narrow the dates.","تجاوز التصدير ٢٠٠٠٠ صف؛ قلّص نطاق التواريخ."));}if(!all.length)throw Error(t("No data to export","لا توجد بيانات للتصدير"));const blob=new Blob(["\ufeff",payrollExcel(all,"saved-attendance")],{type:"application/vnd.ms-excel;charset=utf-8"}),url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=`saved-attendance-${from}-${to}.xls`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  };
  return <main className="pr-page" dir={rtl?"rtl":"ltr"}><header className="pr-header"><div><p className="pr-eyebrow">Sanaa · {t("Attendance","الحضور")}</p><h1>{t("Saved Attendance","الحضور المحفوظ")}</h1><p>{t("Confirmed daily snapshots preserve reviewed Timesheet values.","تحفظ اللقطات اليومية المعتمدة بيانات كشف الدوام بعد مراجعتها.")}</p></div><button className="outline" onClick={()=>{const next=!rtl;setRtl(next);localStorage.setItem("hr-language",next?"ar":"en");}}>{rtl?"English":"العربية"}</button></header>
    {error&&<p className="error-banner">{error}</p>}{message&&<p className="error-banner info">{message}</p>}
    <div className="panel pr-toolbar"><label>{t("From","من")}<input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label>{t("To","إلى")}<input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label><label>{t("Country","الدولة")}<select value={country} onChange={event=>setCountry(event.target.value)}><option>Egypt</option><option>KSA</option></select></label><label>{t("Search","بحث")}<input value={search} onChange={event=>setSearch(event.target.value)}/></label><label>{t("Sort","ترتيب")}<select value={sort} onChange={event=>setSort(event.target.value)}><option value="work_date">{t("Date","التاريخ")}</option><option value="employee">{t("Employee","الموظف")}</option><option value="status">{t("Status","الحالة")}</option><option value="deduction">{t("Deduction","الخصم")}</option></select></label><button className="outline" onClick={()=>setDirection(direction==="asc"?"desc":"asc")}>{direction==="asc"?"↑":"↓"}</button></div>
    <div className="panel pr-toolbar"><label>{t("Second sort","الترتيب الثاني")}<select value={secondSort} onChange={event=>setSecondSort(event.target.value)}><option value="">{t("None","بدون")}</option><option value="work_date">{t("Date","التاريخ")}</option><option value="employee">{t("Employee","الموظف")}</option><option value="status">{t("Status","الحالة")}</option><option value="deduction">{t("Deduction","الخصم")}</option></select></label></div>
    <div className="pr-actions pr-global-actions"><button className="primary" disabled={busy} onClick={()=>void confirm()}>{t("Confirm attendance","اعتماد الحضور")}</button><button className="outline" disabled={busy} onClick={()=>void notifyAttendance()}>{t("Send attendance notices","إرسال إشعارات الحضور")}</button><button className="outline" disabled={busy} onClick={()=>void exportAll()}>{t("Export Excel","تصدير Excel")}</button><button className="outline" onClick={()=>window.print()}>{t("Print","طباعة")}</button></div>
    <div className="panel pr-panel"><div className="pr-scroll"><table><thead><tr><th>{t("Date","التاريخ")}</th><th>{t("Employee","الموظف")}</th><th>{t("In","الدخول")}</th><th>{t("Out","الخروج")}</th><th>{t("Worked","العمل")}</th><th>{t("Expected","المتوقع")}</th><th>{t("Difference","الفرق")}</th><th>{t("Status","الحالة")}</th><th>{t("Notice","الإشعار")}</th><th>{t("Deduction","الخصم")}</th><th>{t("Batch","الدفعة")}</th></tr></thead><tbody>{rows.map(row=><tr key={str(row.id)}><td>{str(row.work_date)}</td><td>{str(rtl?row.name_ar:row.name_en)} · {str(row.employee_code)}</td><td>{str(row.check_in)}</td><td>{str(row.check_out)}</td><td>{str(row.work_minutes)}</td><td>{str(row.expected_minutes)}</td><td>{str(row.difference_minutes)}</td><td>{str(row.status)}</td><td>{row.absence_has_notice==null?"—":Number(row.absence_has_notice)===1?t("With notice","بعذر"):t("Without notice","دون عذر")}</td><td>{str(row.deduction_amount)}</td><td>{str(row.batch_id)}</td></tr>)}</tbody></table></div>{!rows.length&&<p>{t("No records found","لا توجد سجلات")}</p>}<div className="pr-actions"><button className="outline" disabled={busy||offset===0} onClick={()=>void load(Math.max(0,offset-100))}>{t("Previous","السابق")}</button><button className="outline" disabled={busy||!hasMore} onClick={()=>void load(offset+100)}>{t("Next","التالي")}</button></div></div>
  </main>;
}
