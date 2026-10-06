"use client";

import { localizeApiMessage } from "./api-messages";
import { useEffect, useRef, useState } from "react";
import { Activity, Check, Clock3, Download, Fingerprint, Link2, RefreshCw, Search, Users, X } from "lucide-react";
import "./biometric-workspace.css";
import type { Row } from "./ui-types";

type Payload = { devices: Row[]; users: Row[]; syncs: Row[]; summary: Row; records: Row[]; page: number; pageSize: number; total: number; canManageDevices?: boolean; setupUnavailable?: boolean; agents?: Row[]; allDevices?: Row[] };
type Props = { rtl: boolean; employees: Row[]; notify: (message: string) => void; onMapped: () => void };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dateTime = (value: unknown, rtl: boolean, timezone = "Africa/Cairo") => {
  if (!value) return "—";
  const instant = new Date(String(value));
  if (!Number.isFinite(instant.getTime())) return "—";
  return new Intl.DateTimeFormat(rtl ? "ar-EG" : "en-GB", { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(instant);
};
const syncLabel = (status: string, rtl: boolean) => ({ queued: rtl ? "بانتظار المزامنة" : "Queued", running: rtl ? "جارٍ السحب" : "Syncing", success: rtl ? "اكتملت" : "Completed", failed: rtl ? "تعذرت المزامنة" : "Failed" }[status] || status);
async function action(payload: Row) {
  const response = await fetch("/api/hr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(localizeApiMessage(data.error || "Unable to complete action"));
  return data;
}

export function BiometricWorkspace({ rtl, employees, notify, onMapped }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState("users");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadedView, setLoadedView] = useState("");
  const [busy, setBusy] = useState(false);
  const [mapping, setMapping] = useState<Row | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [mappingError, setMappingError] = useState("");
  const parentReload = useRef(onMapped);
  useEffect(() => { parentReload.current = onMapped; }, [onMapped]);
  const syncStamp = data?.devices.map(device => device.last_sync_at || "").join("|") || "";
  useEffect(() => { if (syncStamp) parentReload.current(); }, [syncStamp]);
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query), 300); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const params = new URLSearchParams({ view: "biometric", tab: view, from, to, q: search, page: String(page) });
        const response = await fetch("/api/hr?" + params, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(localizeApiMessage(body.error || (rtl ? "تعذر تحميل بيانات البصمة" : "Unable to load biometric attendance")));
        if (!controller.signal.aborted) { setData(body); setLoadedView(view); setError(""); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Request failed");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [view, from, to, search, page, refresh, rtl]);
  const exportRecords = async () => {
    try {
      setExporting(true);
      const params = new URLSearchParams({ tab: view, from, to, q: search, lang: rtl ? "ar" : "en" });
      const response = await fetch("/api/biometric-export?" + params, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(localizeApiMessage(body.error || (rtl ? "تعذر تصدير البصمات" : "Unable to export biometric records"), rtl));
      }
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") || "")?.[1] || "biometric-export.xlsx";
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      notify(response.headers.get("x-report-limited") === "true" ? (rtl ? "تم التصدير، لكن الملف اقتصر على أول 50,000 سجل؛ ضيّق نطاق التاريخ." : "Exported, but limited to the first 50,000 rows; narrow the date range.") : rtl ? "تم تصدير البصمات" : "Biometric records exported");
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Export failed"); }
    finally { setExporting(false); }
  };
  const setRange = (start: string, end: string) => { setFrom(start); setTo(end); setPage(1); };
  const mapUser = async () => {
    try {
      setBusy(true); setMappingError("");
      await action({ action: "map_attendance_device_user", deviceUserId: mapping?.id, employeeId: Number(employeeId) });
      setMapping(null); setRefresh(value => value + 1); onMapped();
      notify(rtl ? "تم ربط الموظف وتحديث حضوره السابق." : "Employee linked and past attendance updated.");
    } catch (cause) { setMappingError(cause instanceof Error ? cause.message : "Link failed"); }
    finally { setBusy(false); }
  };
  const linked = new Set((data?.users || []).filter(user => user.employee_id).map(user => Number(user.employee_id)));
  const users = (data?.users || []).filter(user => [user.display_name, user.employee_name, user.employee_name_ar, user.employee_code, user.device_user_id].join(" ").toLowerCase().includes(query.toLowerCase()));
  const unlinked = (data?.users || []).filter(user => !user.employee_id).length;
  const name = (row: Row) => (rtl ? row.employee_name_ar || row.employee_name : row.employee_name) || row.device_user_name || row.display_name || "—";
  const changeView = (next: string) => { setView(next); setPage(1); };
  return <div className="biometric-workspace">
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setRefresh(value => value + 1)}>{rtl ? "إعادة المحاولة" : "Retry"}</button></div>}
    {data && !data.devices.length && <section className="biometric-empty-device"><Fingerprint size={34}/><h2>{rtl ? "لم تتم إضافة جهاز بصمة بعد" : "No biometric device yet"}</h2><p>{data.canManageDevices ? (rtl ? "أضف الجهاز من الإعدادات ← إعدادات الموارد البشرية ← أجهزة البصمة؛ بعدها تُسحب البصمات تلقائيًا." : "Add the device under Settings → HR Settings → Biometric Devices; punches are then pulled automatically.") : (rtl ? "اطلب من مدير النظام إضافة جهاز البصمة." : "Ask a system administrator to add the biometric device.")}</p></section>}
    <div className="biometric-summary">
      <div><Users size={20}/><b>{data?.users.length || 0}</b><span>{rtl ? "موظف على الجهاز" : "Device users"}</span></div>
      <div><Link2 size={20}/><b>{linked.size}</b><span>{rtl ? "مرتبط بالنظام" : "Linked employees"}</span></div>
      <button onClick={() => changeView("users")} className={unlinked ? "bio-attention" : ""}><Fingerprint size={20}/><b>{unlinked}</b><span>{rtl ? "بحاجة للربط" : "Need linking"}</span></button>
      <div><Clock3 size={20}/><b>{data?.summary?.punch_count || 0}</b><span>{rtl ? "بصمة محفوظة" : "Imported punches"}</span></div>
    </div>
    <section className="panel biometric-panel">
      <div className="biometric-panel-head"><div><h2>{rtl ? "مستخدمو الجهاز والبصمات" : "Device users & punches"}</h2><p>{rtl ? "الموظفون والربط: ربط رقم البصمة بالموظف. كل البصمات: جميع حركات الباب. التوقيت: القاهرة." : "Employees & linking: match each device ID to an employee. Raw punches: every door event. Timezone: Cairo."}</p></div><button className="icon-btn" onClick={() => setRefresh(value => value + 1)} aria-label={rtl ? "تحديث البيانات" : "Refresh records"}><RefreshCw size={18}/></button></div>
      <nav className="biometric-tabs" aria-label={rtl ? "عرض بيانات البصمة" : "Biometric views"}>{[["users", rtl ? "الموظفون والربط" : "Employees & linking"], ["punches", rtl ? "كل البصمات" : "Raw punches"]].map(([id, text]) => <button key={id} className={view === id ? "active" : ""} onClick={() => changeView(id)}>{text}</button>)}</nav>
      <div className="biometric-filters"><label className="biometric-search"><Search size={17}/><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder={rtl ? "اسم الموظف أو رقم البصمة..." : "Employee name or biometric ID..."}/></label>{view !== "users" && <><label><span>{rtl ? "من" : "From"}</span><input type="date" value={from} max={to || undefined} onChange={event => setRange(event.target.value, to && event.target.value > to ? event.target.value : to)}/></label><label><span>{rtl ? "إلى" : "To"}</span><input type="date" value={to} min={from || undefined} onChange={event => setRange(from && event.target.value && event.target.value < from ? event.target.value : from, event.target.value)}/></label><button className="outline" onClick={() => setRange(today(), today())}>{rtl ? "اليوم" : "Today"}</button><button className="outline" onClick={() => setRange(today().slice(0, 8) + "01", today())}>{rtl ? "هذا الشهر" : "This month"}</button><button className="outline" onClick={() => setRange("", "")}>{rtl ? "كل التواريخ" : "All dates"}</button><button className="primary" disabled={exporting || !data?.total || loadedView !== view} onClick={() => void exportRecords()}><Download size={16}/>{exporting ? (rtl ? "جارٍ التصدير..." : "Exporting...") : view === "punches" ? (rtl ? "تصدير البصمات Excel" : "Export punches (Excel)") : (rtl ? "تصدير الحضور Excel" : "Export attendance (Excel)")}</button></>}<span className="biometric-record-count">{view === "users" ? users.length : data?.total || 0} {rtl ? "سجل" : "records"}</span></div>
      {loading || (loadedView !== view && !error) ? <div className="attendance-loading"><Activity/><span>{rtl ? "جارٍ تحميل بيانات البصمة..." : "Loading biometric attendance..."}</span></div> : <div className="biometric-table-scroll">
        {view === "users" ? <table className="biometric-table"><thead><tr>{[rtl ? "رقم البصمة" : "Device ID", rtl ? "الاسم على الجهاز" : "Device name", rtl ? "الموظف في النظام" : "HR employee", rtl ? "القسم" : "Department", rtl ? "آخر بصمة" : "Latest punch", rtl ? "الربط" : "Link"].map(text => <th key={text}>{text}</th>)}</tr></thead><tbody>{users.map(user => <tr key={user.id}><td><span className="bio-pin">{user.device_user_id}</span></td><td><b>{user.display_name}</b></td><td>{user.employee_id ? <><b>{name(user)}</b><small>{user.employee_code}</small></> : <span className="bio-warning">{rtl ? "غير مرتبط بعد" : "Not linked"}</span>}</td><td>{(rtl ? user.department_name_ar : user.department_name) || "—"}</td><td>{dateTime(user.latest_punch_at, rtl)}</td><td>{user.employee_id ? <span className="bio-linked"><Check size={14}/>{rtl ? "مرتبط" : "Linked"}</span> : <button className="outline" onClick={() => { setMapping(user); setEmployeeId(""); setMappingError(""); }}><Link2 size={14}/>{rtl ? "ربط بموظف" : "Link employee"}</button>}</td></tr>)}</tbody></table>
        : <table className="biometric-table"><thead><tr>{[rtl ? "الموظف" : "Employee", rtl ? "رقم البصمة" : "Device ID", rtl ? "وقت البصمة" : "Punch time", rtl ? "الجهاز" : "Device", rtl ? "الربط" : "Link"].map(text => <th key={text}>{text}</th>)}</tr></thead><tbody>{data?.records.map(row => <tr key={row.id}><td><b>{name(row)}</b><small>{row.employee_code || (rtl ? "مستخدم الجهاز" : "Device user")}</small></td><td><span className="bio-pin">{row.device_user_id}</span></td><td>{dateTime(row.punched_at, rtl, row.timezone)}</td><td>{row.device_name}</td><td><span className={row.employee_id ? "bio-linked" : "bio-warning"}>{row.employee_id ? (rtl ? "مرتبط" : "Linked") : (rtl ? "بانتظار ربط الموظف" : "Awaiting employee link")}</span></td></tr>)}</tbody></table>}
        {(view === "users" ? !users.length : !data?.records.length) && <div className="attendance-empty"><Fingerprint/><h3>{rtl ? "لا توجد سجلات مطابقة" : "No matching records"}</h3><p>{rtl ? "جرّب كل التواريخ." : "Try all dates."}</p></div>}
      </div>}
      {view !== "users" && <footer className="biometric-pagination"><button className="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{rtl ? "السابق" : "Previous"}</button><span>{rtl ? "صفحة" : "Page"} {page} / {Math.max(1, Math.ceil((data?.total || 0) / 50))}</span><button className="outline" disabled={page * 50 >= (data?.total || 0)} onClick={() => setPage(value => value + 1)}>{rtl ? "التالي" : "Next"}</button></footer>}
    </section>
    <details className="panel biometric-sync-history"><summary>{rtl ? "سجل المزامنة" : "Sync history"}</summary><div className="biometric-table-scroll"><table className="biometric-table"><thead><tr><th>{rtl ? "الوقت" : "Time"}</th><th>{rtl ? "الحالة" : "Status"}</th><th>{rtl ? "بصمات جديدة" : "New punches"}</th><th>{rtl ? "التفاصيل" : "Details"}</th></tr></thead><tbody>{data?.syncs.map(sync => <tr key={sync.id}><td>{dateTime(sync.requested_at, rtl)}</td><td>{syncLabel(sync.status, rtl)}</td><td>{sync.punches_imported}</td><td>{sync.error || (rtl ? "مستخدمو الجهاز: " : "Device users: ") + sync.users_found}</td></tr>)}</tbody></table></div></details>
    {mapping && <div className="modal-layer"><button className="modal-scrim" onClick={() => !busy && setMapping(null)} aria-label={rtl ? "إغلاق" : "Close"}/><aside className="drawer attendance-drawer" role="dialog" aria-modal="true" aria-labelledby="bio-map-title"><header><div><small>{rtl ? "ربط رقم البصمة" : "LINK BIOMETRIC ID"}</small><h2 id="bio-map-title">{mapping.display_name} · {mapping.device_user_id}</h2><p>{rtl ? "اختر الموظف المطابق. سيتم احتساب بصماته السابقة تلقائيًا." : "Select the matching employee. Past punches will be applied automatically."}</p></div><button className="icon-btn" disabled={busy} onClick={() => setMapping(null)} aria-label={rtl ? "إغلاق" : "Close"}><X/></button></header><div className="attendance-form">{mappingError && <div className="form-error" role="alert">{mappingError}</div>}<label><span>{rtl ? "الموظف" : "Employee"}</span><select value={employeeId} onChange={event => setEmployeeId(event.target.value)}><option value="">{rtl ? "اختر الموظف..." : "Select employee..."}</option>{employees.filter(employee => !linked.has(Number(employee.id)) && (!employee.fingerprint_code || String(employee.fingerprint_code) === String(mapping.device_user_id))).map(employee => <option key={employee.id} value={employee.id}>{rtl ? employee.name_ar || employee.name_en : employee.name_en} · {employee.employee_code}</option>)}</select></label></div><footer><button className="outline" disabled={busy} onClick={() => setMapping(null)}>{rtl ? "إلغاء" : "Cancel"}</button><button className="primary" disabled={busy || !employeeId} onClick={() => void mapUser()}><Link2 size={16}/>{rtl ? "ربط وتحديث الحضور" : "Link & update attendance"}</button></footer></aside></div>}
  </div>;
}
