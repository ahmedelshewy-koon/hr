"use client";
import { useCallback, useEffect, useState } from "react";
import { localizeApiMessage } from "./api-messages";
import { payrollExcel } from "./payroll/export";
import "./payroll-rebuild.css";

type Row = Record<string, unknown>;
type View = { employee: Row; sessions: Row[]; hasMore:boolean; days: Row[]; eligibleToday: boolean; riyadhDate: string };
const str = (value: unknown) => String(value ?? "");
const nowCairo = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).replace(" ", "T");

export function WfhWorkspace() {
  const [rtl,setRtl]=useState(false),[people,setPeople]=useState<Row[]>([]),[selected,setSelected]=useState(0);
  const [view,setView]=useState<View|null>(null),[ownId,setOwnId]=useState(0),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [day,setDay]=useState(""),[forceTime,setForceTime]=useState(nowCairo()),[sessionOffset,setSessionOffset]=useState(0);
  const [search,setSearch]=useState(""),[status,setStatus]=useState(""),[firstSort,setFirstSort]=useState("work_date"),[secondSort,setSecondSort]=useState(""),[descending,setDescending]=useState(true);
  const t=(en:string,ar:string)=>rtl?ar:en;
  const get=useCallback(async(id=0,page=0)=>{
    const response=await fetch(`/api/wfh-checkin?${new URLSearchParams({...(id?{employeeId:String(id)}:{}),offset:String(page)})}`);
    if(!response.ok) throw new Error(localizeApiMessage(await response.text(),rtl));
    const result=await response.json() as View;setView(result);setSessionOffset(page);return result;
  },[rtl]);
  useEffect(()=>{setRtl((localStorage.getItem("hr-language")||"en")==="ar");void (async()=>{
    try {
      const own=await get();setOwnId(Number(own.employee.id));setSelected(Number(own.employee.id));
    } catch {
      const response=await fetch("/api/wfh-checkin?view=people");
      if(!response.ok){setError(localizeApiMessage(await response.text(),rtl));return;}
      const result=await response.json() as {employees:Row[]};setPeople(result.employees);
      const first=Number(result.employees[0]?.id)||0;if(first){setSelected(first);await get(first);}
    }
    const response=await fetch("/api/wfh-checkin?view=people");
    if(response.ok){const result=await response.json() as {employees:Row[]};setPeople(result.employees);}
  })();},[get,rtl]);
  const act=async(action:string,extra:Row={})=>{
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/wfh-checkin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,employeeId:selected,...extra})});
      if(!response.ok)throw new Error(localizeApiMessage(await response.text(),rtl));
      await get(selected);
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  };
  const open=view?.sessions.find(row=>!row.checked_out_at);
  const filtered=(items:Row[])=>items.filter(row=>{
    const state=row.forced_by?"forced":row.checked_out_at?"closed":"open";
    return (!status||state===status)&&(!search||Object.values(row).some(value=>str(value).toLocaleLowerCase().includes(search.toLocaleLowerCase())));
  }).sort((a,b)=>{
    const compare=(key:string)=>str(a[key]).localeCompare(str(b[key]),rtl?"ar":"en",{numeric:true});
    return (descending?-1:1)*(compare(firstSort)||(secondSort?compare(secondSort):0));
  });
  const sessionRows=filtered(view?.sessions||[]);
  const exportExcel=async()=>{try{setBusy(true);const all:Row[]=[];let offset=0,more=true;while(more){const response=await fetch(`/api/wfh-checkin?${new URLSearchParams({employeeId:String(selected),offset:String(offset)})}`);if(!response.ok)throw new Error(localizeApiMessage(await response.text(),rtl));const page=await response.json() as View;all.push(...page.sessions);more=page.hasMore;offset+=100;if(offset>20000)throw new Error(t("Export exceeds 20,000 sessions; narrow the employee selection.","تجاوز التصدير ٢٠٬٠٠٠ جلسة؛ قلّص اختيار الموظف."));}const blob=new Blob(["\ufeff",payrollExcel(filtered(all),"WFH Sessions")],{type:"application/vnd.ms-excel;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="wfh-sessions.xls";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);}};
  return <main className="pr-page" dir={rtl?"rtl":"ltr"}>
    <header className="pr-header"><div><p className="pr-eyebrow">Sanaa · {t("Attendance","الحضور")}</p><h1>{t("Work From Home","العمل من المنزل")}</h1><p>{t("Check in and out; all recorded times are stored as Riyadh instants.","تسجيل الدخول والخروج؛ تُحفظ الأوقات بتوقيت الرياض.")}</p></div><button className="outline" onClick={()=>{const next=!rtl;setRtl(next);localStorage.setItem("hr-language",next?"ar":"en");}}>{rtl?"English":"العربية"}</button></header>
    {error&&<p className="error-banner">{error}</p>}
    {people.length>0&&<div className="panel pr-toolbar"><label>{t("Employee","الموظف")}<select value={selected} onChange={event=>{const id=Number(event.target.value);setSelected(id);void get(id);}}>{people.map(row=><option key={str(row.id)} value={Number(row.id)}>{str(rtl?row.name_ar:row.name_en)} · {str(row.employee_code)}</option>)}</select></label></div>}
    {view&&<><div className="panel pr-panel"><h2>{str(rtl?view.employee.name_ar:view.employee.name_en)}</h2><p>{t("Riyadh work date","يوم العمل بتوقيت الرياض")}: {view.riyadhDate} · {view.eligibleToday?t("Approved WFH day","يوم عمل منزلي معتمد"):t("WFH approval required","يلزم اعتماد العمل المنزلي")}</p>
      {selected===ownId&&<div className="pr-actions"><button className="primary" disabled={busy||Boolean(open)||!view.eligibleToday} onClick={()=>void act("check_in")}>{t("Check in","تسجيل الدخول")}</button><button className="outline" disabled={busy||!open} onClick={()=>void act("check_out")}>{t("Check out","تسجيل الخروج")}</button></div>}
      {people.length>0&&<div className="pr-form"><label>{t("Approved WFH date","تاريخ العمل المنزلي المعتمد")}<input type="date" value={day} onChange={event=>setDay(event.target.value)}/></label><button className="outline" disabled={busy||!day} onClick={()=>void act("assign_day",{date:day})}>{t("Approve day","اعتماد اليوم")}</button><button className="outline" disabled={busy||!day} onClick={()=>void act("assign_day",{date:day,remove:true})}>{t("Remove day","إزالة اليوم")}</button></div>}
      {people.length>0&&open&&<div className="pr-form"><label>{t("Force checkout (Cairo time)","خروج إجباري (توقيت القاهرة)")}<input type="datetime-local" value={forceTime} onChange={event=>setForceTime(event.target.value)}/></label><button className="outline" disabled={busy} onClick={()=>void act("force_checkout",{cairoDateTime:forceTime})}>{t("Force checkout","تسجيل خروج إجباري")}</button></div>}
    </div><div className="panel pr-panel"><h2>{t("Sessions","الجلسات")}</h2><div className="pr-toolbar"><label>{t("Search","بحث")}<input value={search} onChange={event=>setSearch(event.target.value)}/></label><label>{t("Status","الحالة")}<select value={status} onChange={event=>setStatus(event.target.value)}><option value="">{t("All","الكل")}</option><option value="open">{t("Open","مفتوحة")}</option><option value="closed">{t("Closed","مغلقة")}</option><option value="forced">{t("Forced checkout","خروج إجباري")}</option></select></label><label>{t("First sort","الترتيب الأول")}<select value={firstSort} onChange={event=>setFirstSort(event.target.value)}><option value="work_date">{t("Date","التاريخ")}</option><option value="checked_in_at">{t("Check in","الدخول")}</option><option value="checked_out_at">{t("Check out","الخروج")}</option></select></label><label>{t("Second sort","الترتيب الثاني")}<select value={secondSort} onChange={event=>setSecondSort(event.target.value)}><option value="">{t("None","بدون")}</option><option value="work_date">{t("Date","التاريخ")}</option><option value="checked_in_at">{t("Check in","الدخول")}</option><option value="checked_out_at">{t("Check out","الخروج")}</option></select></label><button className="outline" onClick={()=>setDescending(!descending)}>{descending?"↓":"↑"}</button><button className="outline" onClick={exportExcel}>{t("Export Excel","تصدير Excel")}</button><button className="outline" onClick={()=>window.print()}>{t("Print","طباعة")}</button></div><div className="pr-scroll"><table><thead><tr><th>{t("Date","التاريخ")}</th><th>{t("Check in","الدخول")}</th><th>{t("Check out","الخروج")}</th><th>{t("Status","الحالة")}</th></tr></thead><tbody>{sessionRows.map(row=><tr key={str(row.id)}><td>{str(row.work_date)}</td><td>{new Date(str(row.checked_in_at)).toLocaleString(rtl?"ar-EG":"en-GB",{timeZone:"Africa/Cairo"})}</td><td>{row.checked_out_at?new Date(str(row.checked_out_at)).toLocaleString(rtl?"ar-EG":"en-GB",{timeZone:"Africa/Cairo"}):"—"}</td><td>{row.forced_by?t("Forced checkout","خروج إجباري"):row.checked_out_at?t("Closed","مغلقة"):t("Open","مفتوحة")}</td></tr>)}</tbody></table></div><div className="pr-actions"><button className="outline" disabled={sessionOffset===0} onClick={()=>void get(selected,Math.max(0,sessionOffset-100))}>{t("Previous","السابق")}</button><button className="outline" disabled={!view.hasMore} onClick={()=>void get(selected,sessionOffset+100)}>{t("Next","التالي")}</button></div></div></>}
  </main>;
}
