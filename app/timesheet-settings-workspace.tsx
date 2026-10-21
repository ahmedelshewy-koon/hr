"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Row } from "./ui-types";
import { localizeApiMessage } from "./api-messages";
import { payrollExcel } from "./payroll/export";
import { EmployeeCombobox, formatDay, type PickerEmployee } from "./timesheet/ui/common";
import "./timesheet-management.css";

const URL_ = "/api/timesheet-management/schedules";
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
type Tab = "employees" | "types" | "plans" | "rotation" | "holidays" | "wfh";

async function request(rtl: boolean, body?: Row, query = ""): Promise<Row> {
  const response = await fetch(URL_ + query, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new Error(localizeApiMessage(String(payload.error || `Request failed (${response.status})`), rtl));
  return payload;
}
const today = () => new Date().toISOString().slice(0, 10);
const plus = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);

/** Where HR maintains what the timesheet calculation reads: shift types, attendance types, weekly plans, rotating shifts, holiday religion and company WFH days. */
export function TimesheetSettingsWorkspace({ rtl, notify, initialTab="employees", routePage=false }: { rtl: boolean; notify: (message: string) => void; initialTab?: "employees"|"types"|"plans"|"rotation"|"holidays"|"wfh"; routePage?:boolean }) {
  const t = (en: string, ar: string) => (rtl ? ar : en);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [listSearch,setListSearch]=useState(""),[statusFilter,setStatusFilter]=useState(""),[firstSort,setFirstSort]=useState("name_en"),[secondSort,setSecondSort]=useState(""),[descending,setDescending]=useState(false);
  const [data, setData] = useState<Row | null>(null), [error, setError] = useState(""), [range] = useState({ from: plus(today(), -7), to: plus(today(), 60) });
  const load = useCallback(async () => { try { setData(await request(rtl, undefined, `?from=${range.from}&to=${range.to}${routePage?`&page=${initialTab}`:""}`)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }, [rtl, range,routePage,initialTab]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(()=>{const listener=()=>void load();window.addEventListener("timesheet-setup-changed",listener);return ()=>window.removeEventListener("timesheet-setup-changed",listener);},[load]);
  const canEdit = Boolean((data?.access as Row | undefined)?.canEdit);
  const act = async (body: Row, done: string) => { try { await request(rtl, body); notify(done); await load(); } catch (cause) { notify(cause instanceof Error ? cause.message : String(cause)); } };
  const employees = useMemo(() => (data?.employees as Row[]) ?? [], [data]);
  const types = (data?.attendanceTypes as Row[]) ?? [], plans = (data?.shiftPlans as Row[]) ?? [];
  const picker = employees as unknown as PickerEmployee[];
  const name = (row: Row) => String(rtl ? row.name_ar || row.name_en : row.name_en || row.name_ar);
  const tabs: [Tab, string][] = [["employees", t("Employee schedules", "جداول الموظفين")], ["types", t("Attendance types", "أنواع الحضور")], ["plans", t("Shift plans", "خطط الورديات")], ["rotation", t("Rotating shifts", "الورديات الدوارة")], ["holidays", t("Holiday religion", "ديانة العطلات")], ["wfh", t("Company WFH days", "أيام العمل من المنزل للشركة")]];
  const listRows=(rows:Row[])=>rows.filter(row=>(!statusFilter||String(row.status||"")===statusFilter)&&(!listSearch||Object.values(row).some(value=>String(value??"").toLocaleLowerCase().includes(listSearch.toLocaleLowerCase())))).sort((a,b)=>{const compare=(key:string)=>String(a[key]??"").localeCompare(String(b[key]??""),rtl?"ar":"en",{numeric:true});return (descending?-1:1)*(compare(firstSort)||(secondSort?compare(secondSort):0));});
  const setupRows=tab==="types"?listRows(types):tab==="plans"?listRows(plans):[];
  const exportSetup=()=>{const blob=new Blob(["\ufeff",payrollExcel(setupRows,tab)],{type:"application/vnd.ms-excel;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`${tab}-setup.xls`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

  return <section className="ts-page" dir={rtl ? "rtl" : "ltr"}>
    <header className="ts-head"><div><small>{t("TIMESHEET SETTINGS", "إعدادات كشف الدوام")}</small><h1>{t("Schedules & rules", "الجداول والقواعد")}</h1>
      <p>{t("These settings feed the timesheet calculation. Changes apply the next time you press Recalculate; confirmed months and locked payroll periods never change.", "تغذي هذه الإعدادات حساب كشف الدوام. تُطبّق التغييرات عند الضغط على إعادة الحساب، ولا تتغير الأشهر المعتمدة أو فترات الرواتب المقفلة.")}</p></div></header>
    {!routePage&&<nav className="ts-hub-tabs" aria-label={t("Schedule settings", "إعدادات الجداول")}>{tabs.map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>}
    {routePage&&<div className="panel pr-toolbar"><label>{t("Search","بحث")}<input value={listSearch} onChange={event=>setListSearch(event.target.value)}/></label><label>{t("Status","الحالة")}<select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="">{t("All","الكل")}</option><option value="active">{t("Active","نشط")}</option><option value="inactive">{t("Inactive","غير نشط")}</option></select></label><label>{t("First sort","الترتيب الأول")}<select value={firstSort} onChange={event=>setFirstSort(event.target.value)}><option value="name_en">{t("Name","الاسم")}</option><option value="code">{t("Code","الرمز")}</option><option value="status">{t("Status","الحالة")}</option></select></label><label>{t("Second sort","الترتيب الثاني")}<select value={secondSort} onChange={event=>setSecondSort(event.target.value)}><option value="">{t("None","بدون")}</option><option value="name_en">{t("Name","الاسم")}</option><option value="code">{t("Code","الرمز")}</option><option value="status">{t("Status","الحالة")}</option></select></label><button className="outline" onClick={()=>setDescending(!descending)}>{descending?"↓":"↑"}</button><button className="outline" onClick={exportSetup}>{t("Export Excel","تصدير Excel")}</button><button className="outline" onClick={()=>window.print()}>{t("Print","طباعة")}</button></div>}
    {error && <p className="ts-error" role="alert">{error}</p>}
    {!data && !error && <p className="ts-hint">{t("Loading...", "جارٍ التحميل...")}</p>}
    {data && !canEdit && <p className="ts-banner">{t("View only: editing needs the Timesheet edit permission.", "عرض فقط: التعديل يحتاج صلاحية تعديل كشف الدوام.")}</p>}

    {data && tab === "employees" && <div className="panel ts-grid-panel"><div className="ts-table-wrap"><table className="ts-table"><thead><tr><th>{t("Employee", "الموظف")}</th><th>{t("Shift type", "نوع الدوام")}</th><th>{t("Attendance type", "نوع الحضور")}</th><th>{t("Weekly shift plan", "خطة الورديات الأسبوعية")}</th><th>{t("Own shift", "الدوام الخاص")}</th></tr></thead>
      <tbody>{employees.map(e => <tr key={e.id}><td><b>{name(e)}</b><small dir="ltr">{e.employee_code}</small></td>
        <td><select disabled={!canEdit} value={String(e.schedule_type || "fixed")} onChange={ev => void act({ action: "save_employee_schedule", employeeIds: [e.id], scheduleType: ev.target.value }, t("Saved", "تم الحفظ"))}><option value="fixed">{t("Fixed", "ثابت")}</option><option value="shift">{t("Shift plan", "خطة ورديات")}</option><option value="rotating">{t("Rotating", "دوار")}</option></select></td>
        <td><select disabled={!canEdit} value={e.attendance_type_id ?? 0} onChange={ev => void act({ action: "save_employee_schedule", employeeIds: [e.id], attendanceTypeId: Number(ev.target.value) }, t("Saved", "تم الحفظ"))}><option value={0}>{t("None (own shift)", "بدون (الدوام الخاص)")}</option>{types.filter(x => x.status === "active").map(x => <option key={x.id} value={x.id}>{name(x)}</option>)}</select></td>
        <td><select disabled={!canEdit} value={e.shift_plan_id ?? 0} onChange={ev => void act({ action: "save_employee_schedule", employeeIds: [e.id], shiftPlanId: Number(ev.target.value) }, t("Saved", "تم الحفظ"))}><option value={0}>{t("None", "بدون")}</option>{plans.filter(x => x.status === "active").map(x => <option key={x.id} value={x.id}>{name(x)}</option>)}</select></td>
        <td dir="ltr">{String(e.check_in_time || "—")} – {String(e.check_out_time || "—")}</td></tr>)}</tbody></table></div></div>}

    {data && tab === "types" && <div className="panel ts-grid-panel"><div className="ts-table-wrap"><table className="ts-table"><thead><tr><th>{t("Type", "النوع")}</th><th>{t("Hours", "الساعات")}</th><th>{t("Late allowance (min)", "سماح التأخير (د)")}</th><th>{t("Early exit allowance (min)", "سماح الانصراف المبكر (د)")}</th><th>{t("Rest days", "أيام الراحة")}</th><th /></tr></thead>
      <tbody>{(routePage?setupRows:types).map(x => <TypeRow key={`${x.id}-${x.early_exit_allowance_minutes}-${x.weekend_days}`} rtl={rtl} row={x} canEdit={canEdit} label={name(x)} onSave={(early, days) => act({ action: "save_attendance_type", id: x.id, earlyExitAllowanceMinutes: early, weekendDays: days }, t("Saved", "تم الحفظ"))} />)}</tbody></table></div>
      <p className="ts-hint" style={{ padding: 12 }}>{t("Names, hours and late allowance are managed in Settings → HR Settings → Attendance types.", "الأسماء والساعات وسماح التأخير تُدار من الإعدادات ← إعدادات الموارد البشرية ← أنواع الحضور.")}</p></div>}

    {data && tab === "plans" && <PlansEditor rtl={rtl} plans={routePage?setupRows:plans} canEdit={canEdit} act={act} />}
    {data && tab === "rotation" && <RotationEditor rtl={rtl} employees={picker} assignments={(data.assignments as Row[]) ?? []} canEdit={canEdit} act={act} />}

    {data && tab === "holidays" && <div className="panel ts-grid-panel"><div className="ts-table-wrap"><table className="ts-table"><thead><tr><th>{t("Date", "التاريخ")}</th><th>{t("Holiday", "العطلة")}</th><th>{t("Country", "الدولة")}</th><th>{t("Applies to", "تنطبق على")}</th></tr></thead>
      <tbody>{((data.holidays as Row[]) ?? []).map(h => <tr key={h.id}><td>{formatDay(h.holiday_date, rtl)}</td><td>{name(h)}</td><td>{String(h.country)}</td>
        <td><select disabled={!canEdit} value={String(h.religion || "")} onChange={ev => void act({ action: "set_holiday_religion", id: h.id, religion: ev.target.value }, t("Saved", "تم الحفظ"))}><option value="">{t("Everyone", "الجميع")}</option><option value="muslim">{t("Muslim employees", "الموظفون المسلمون")}</option><option value="christian">{t("Christian employees", "الموظفون المسيحيون")}</option></select></td></tr>)}</tbody></table></div></div>}

    {data && tab === "wfh" && <WfhEditor rtl={rtl} days={(data.companyWfh as Row[]) ?? []} canEdit={canEdit} act={act} />}
  </section>;
}

function TypeRow({ rtl, row, canEdit, label, onSave }: { rtl: boolean; row: Row; canEdit: boolean; label: string; onSave: (early: number, days: string) => void }) {
  const [early, setEarly] = useState(String(row.early_exit_allowance_minutes ?? 0)), [days, setDays] = useState(new Set(String(row.weekend_days || "").split(",").filter(Boolean)));
  const names = rtl ? DAYS_AR : DAYS_EN;
  return <tr><td><b>{label}</b></td><td dir="ltr">{row.shift_based ? "—" : `${row.start_time ?? "—"} – ${row.end_time ?? "—"}`}</td><td>{String(row.late_allowance_minutes ?? 0)}</td>
    <td><input type="number" min={0} max={240} dir="ltr" disabled={!canEdit} value={early} onChange={e => setEarly(e.target.value)} style={{ width: 80 }} /></td>
    <td><div className="ts-days">{names.map((n, i) => <label key={i} className="ts-check"><input type="checkbox" disabled={!canEdit} checked={days.has(String(i))} onChange={e => { const next = new Set(days); if (e.target.checked) next.add(String(i)); else next.delete(String(i)); setDays(next); }} />{n}</label>)}</div></td>
    <td>{canEdit && <button type="button" className="outline" onClick={() => onSave(Number(early) || 0, [...days].join(","))}>{rtl ? "حفظ" : "Save"}</button>}</td></tr>;
}

type Day = { weekday: number; isOff: boolean; startTime: string; endTime: string; breakMinutes: number };
const blankDays = (): Day[] => Array.from({ length: 7 }, (_, weekday) => ({ weekday, isOff: weekday === 5 || weekday === 6, startTime: "09:00", endTime: "17:00", breakMinutes: 0 }));

function PlansEditor({ rtl, plans, canEdit, act }: { rtl: boolean; plans: Row[]; canEdit: boolean; act: (body: Row, done: string) => Promise<void> }) {
  const t = (en: string, ar: string) => (rtl ? ar : en);
  const [editing, setEditing] = useState<{ id?: number; nameEn: string; nameAr: string; status: string; days: Day[] } | null>(null);
  const open = (plan?: Row) => setEditing(plan ? { id: plan.id, nameEn: plan.name_en, nameAr: plan.name_ar, status: plan.status, days: blankDays().map(d => { const x = (plan.days as Row[]).find(r => Number(r.weekday) === d.weekday); return x ? { weekday: d.weekday, isOff: Boolean(Number(x.is_off)), startTime: String(x.start_time ?? "09:00"), endTime: String(x.end_time ?? "17:00"), breakMinutes: Number(x.break_minutes) || 0 } : { ...d, isOff: true }; }) } : { nameEn: "", nameAr: "", status: "active", days: blankDays() });
  const names = rtl ? DAYS_AR : DAYS_EN;
  return <div className="panel" style={{ padding: 16 }}>
    {canEdit && <button type="button" className="primary" onClick={() => open()}><Plus size={16} />{t("New shift plan", "خطة ورديات جديدة")}</button>}
    <div className="ts-table-wrap"><table className="ts-table compact"><thead><tr><th>{t("Plan", "الخطة")}</th><th>{t("Week", "الأسبوع")}</th><th /></tr></thead><tbody>
      {plans.map(p => <tr key={p.id}><td><b>{String(rtl ? p.name_ar : p.name_en)}</b><small>{p.status}</small></td><td dir="ltr">{(p.days as Row[]).map(d => `${names[Number(d.weekday)]} ${Number(d.is_off) ? "off" : `${d.start_time}-${d.end_time}`}`).join(" · ")}</td>
        <td className="ts-actions-cell">{canEdit && <><button type="button" className="outline" onClick={() => open(p)}>{t("Edit", "تعديل")}</button><button type="button" className="outline" onClick={() => { if (window.confirm(t("Delete this shift plan?", "حذف خطة الورديات؟"))) void act({ action: "delete_shift_plan", id: p.id }, t("Deleted", "تم الحذف")); }}><Trash2 size={14} /></button></>}</td></tr>)}
      {!plans.length && <tr><td colSpan={3} className="ts-empty">{t("No shift plans yet", "لا توجد خطط ورديات")}</td></tr>}</tbody></table></div>
    {editing && <div className="ts-subsection"><h3>{editing.id ? t("Edit plan", "تعديل الخطة") : t("New plan", "خطة جديدة")}</h3>
      <div className="ts-form"><label className="ts-field"><span>{t("Name (English)", "الاسم بالإنجليزية")}</span><input value={editing.nameEn} onChange={e => setEditing({ ...editing, nameEn: e.target.value })} /></label><label className="ts-field"><span>{t("Name (Arabic)", "الاسم بالعربية")}</span><input value={editing.nameAr} onChange={e => setEditing({ ...editing, nameAr: e.target.value })} /></label></div>
      <table className="ts-table compact"><thead><tr><th>{t("Day", "اليوم")}</th><th>{t("Day off", "إجازة")}</th><th>{t("Start", "البداية")}</th><th>{t("End", "النهاية")}</th><th>{t("Break (min)", "الاستراحة (د)")}</th></tr></thead><tbody>
        {editing.days.map((d, i) => { const set = (patch: Partial<Day>) => setEditing({ ...editing, days: editing.days.map((x, j) => j === i ? { ...x, ...patch } : x) }); return <tr key={d.weekday}><td>{names[d.weekday]}</td><td><input type="checkbox" checked={d.isOff} onChange={e => set({ isOff: e.target.checked })} /></td><td><input type="time" dir="ltr" disabled={d.isOff} value={d.startTime} onChange={e => set({ startTime: e.target.value })} /></td><td><input type="time" dir="ltr" disabled={d.isOff} value={d.endTime} onChange={e => set({ endTime: e.target.value })} /></td><td><input type="number" min={0} max={600} dir="ltr" disabled={d.isOff} value={d.breakMinutes} onChange={e => set({ breakMinutes: Number(e.target.value) })} style={{ width: 80 }} /></td></tr>; })}</tbody></table>
      <div className="ts-dialog-foot"><button type="button" className="outline" onClick={() => setEditing(null)}>{t("Cancel", "إلغاء")}</button><button type="button" className="primary" onClick={() => void act({ action: "save_shift_plan", ...editing }, t("Shift plan saved", "تم حفظ خطة الورديات")).then(() => setEditing(null))}>{t("Save", "حفظ")}</button></div></div>}
  </div>;
}

function RotationEditor({ rtl, employees, assignments, canEdit, act }: { rtl: boolean; employees: PickerEmployee[]; assignments: Row[]; canEdit: boolean; act: (body: Row, done: string) => Promise<void> }) {
  const t = (en: string, ar: string) => (rtl ? ar : en);
  const [picked, setPicked] = useState<number[]>([]), [form, setForm] = useState({ from: today(), to: plus(today(), 13), startTime: "08:00", endTime: "16:00", breakMinutes: 0, isOff: false }), [who, setWho] = useState(0);
  const byName = new Map(employees.map(e => [Number(e.id), e]));
  const shown = assignments.filter(a => !who || Number(a.employee_id) === who).slice(0, 300);
  const body = { employeeIds: picked, ...form };
  return <div className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>
    {canEdit && <div className="ts-form">
      <label className="ts-field wide"><span>{t("Employees", "الموظفون")}</span><EmployeeCombobox rtl={rtl} employees={employees} value={0} onChange={id => id && setPicked(p => p.includes(id) ? p : [...p, id])} /><small>{picked.map(id => byName.get(id)?.name_en).join("، ") || t("Pick one or more employees", "اختر موظفًا أو أكثر")} {picked.length > 0 && <button type="button" className="ts-link" onClick={() => setPicked([])}>{t("Clear", "مسح")}</button>}</small></label>
      <label className="ts-field"><span>{t("From", "من")}</span><input type="date" dir="ltr" value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} /></label><label className="ts-field"><span>{t("To", "إلى")}</span><input type="date" dir="ltr" value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} /></label>
      <label className="ts-check wide"><input type="checkbox" checked={form.isOff} onChange={e => setForm({ ...form, isOff: e.target.checked })} /><span>{t("Day off", "إجازة")}</span></label>
      {!form.isOff && <><label className="ts-field"><span>{t("Start", "البداية")}</span><input type="time" dir="ltr" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} /></label><label className="ts-field"><span>{t("End", "النهاية")}</span><input type="time" dir="ltr" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} /></label><label className="ts-field"><span>{t("Break (min)", "الاستراحة (د)")}</span><input type="number" min={0} max={600} dir="ltr" value={form.breakMinutes} onChange={e => setForm({ ...form, breakMinutes: Number(e.target.value) })} /></label></>}
      <div className="wide ts-actions-cell"><button type="button" className="primary" disabled={!picked.length} onClick={() => void act({ action: "save_assignments", ...body }, t("Assignments saved", "تم حفظ التعيينات"))}>{t("Assign shift", "تعيين الوردية")}</button><button type="button" className="outline" disabled={!picked.length} onClick={() => void act({ action: "clear_assignments", employeeIds: picked, from: form.from, to: form.to }, t("Assignments cleared", "تم مسح التعيينات"))}>{t("Clear range", "مسح الفترة")}</button></div></div>}
    <label className="ts-field"><span>{t("Show employee", "عرض موظف")}</span><EmployeeCombobox rtl={rtl} employees={employees} value={who} onChange={setWho} allowAll /></label>
    <div className="ts-table-wrap"><table className="ts-table compact"><thead><tr><th>{t("Date", "التاريخ")}</th><th>{t("Employee", "الموظف")}</th><th>{t("Shift", "الوردية")}</th></tr></thead><tbody>
      {shown.map(a => <tr key={`${a.employee_id}-${a.shift_date}`}><td>{formatDay(a.shift_date, rtl)}</td><td>{String(byName.get(Number(a.employee_id))?.name_en ?? a.employee_id)}</td><td dir="ltr">{Number(a.is_off) ? t("Day off", "إجازة") : `${a.start_time} – ${a.end_time}`}</td></tr>)}
      {!shown.length && <tr><td colSpan={3} className="ts-empty">{t("No rotating assignments in this period", "لا توجد تعيينات دوارة في هذه الفترة")}</td></tr>}</tbody></table></div>
  </div>;
}

function WfhEditor({ rtl, days, canEdit, act }: { rtl: boolean; days: Row[]; canEdit: boolean; act: (body: Row, done: string) => Promise<void> }) {
  const t = (en: string, ar: string) => (rtl ? ar : en);
  const [date, setDate] = useState(today()), [country, setCountry] = useState(""), [note, setNote] = useState("");
  return <div className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>
    {canEdit && <div className="ts-form"><label className="ts-field"><span>{t("Date", "التاريخ")}</span><input type="date" dir="ltr" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="ts-field"><span>{t("Payroll country", "دولة الرواتب")}</span><select value={country} onChange={e => setCountry(e.target.value)}><option value="">{t("All countries", "كل الدول")}</option><option value="Egypt">{t("Egypt", "مصر")}</option><option value="KSA">{t("KSA", "السعودية")}</option></select></label>
      <label className="ts-field wide"><span>{t("Note", "ملاحظة")}</span><input value={note} maxLength={300} onChange={e => setNote(e.target.value)} /></label>
      <div className="wide"><button type="button" className="primary" onClick={() => void act({ action: "set_company_wfh", date, country, note }, t("Company WFH day saved", "تم حفظ يوم العمل من المنزل"))}><Plus size={16} />{t("Add day", "إضافة يوم")}</button></div></div>}
    <div className="ts-table-wrap"><table className="ts-table compact"><thead><tr><th>{t("Date", "التاريخ")}</th><th>{t("Country", "الدولة")}</th><th>{t("Note", "ملاحظة")}</th><th /></tr></thead><tbody>
      {days.map(d => <tr key={d.id}><td>{formatDay(d.wfh_date, rtl)}</td><td>{String(d.payroll_country || t("All", "الكل"))}</td><td>{String(d.note ?? "—")}</td><td>{canEdit && <button type="button" className="outline" onClick={() => void act({ action: "set_company_wfh", date: d.wfh_date, country: d.payroll_country, remove: true }, t("Removed", "تمت الإزالة"))}><Trash2 size={14} /></button>}</td></tr>)}
      {!days.length && <tr><td colSpan={4} className="ts-empty">{t("No company WFH days", "لا توجد أيام عمل من المنزل للشركة")}</td></tr>}</tbody></table></div>
  </div>;
}
