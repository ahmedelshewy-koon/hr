"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CalendarDays, Clock3, Eye, FileCheck2, FileText, HeartPulse, Pencil, Phone, Plus, Printer, ShieldCheck, Trash2, User, X } from "lucide-react";
import { localizeApiMessage } from "./api-messages";
import { bilingualMessage } from "./organization/settings-model";
import { localizedDisplayValue } from "./localization";
import { CheckField, MasterDataDrawer, SelectField, TextAreaField, TextField } from "./settings/settings-ui";
import type { Row } from "./ui-types";
import "./employee-profile-tabs.css";

/* ------------------------------------------------------------------ helpers */

const locale = (rtl: boolean) => rtl ? "ar-SA-u-nu-arab" : "en-GB";
const num = (value: unknown, rtl: boolean) => new Intl.NumberFormat(locale(rtl), { maximumFractionDigits: 2 }).format(Number(value) || 0);
const day = (value: unknown) => value ? String(value).slice(0, 10) : "—";
const dash = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);
const pick = (row: Row, key: string, rtl: boolean) => String((rtl ? row[`${key}_ar`] || row[key] : row[key] || row[`${key}_ar`]) ?? "");
/** Catalog rows carry name_en / name_ar. */
const nm = (row: Row, rtl: boolean) => String((rtl ? row.name_ar || row.name_en : row.name_en || row.name_ar) ?? "");
const today = () => new Date().toISOString().slice(0, 10);
const LABELS: Record<string, [string, string]> = {
  male: ["Male", "ذكر"], female: ["Female", "أنثى"], single: ["Single", "أعزب"], married: ["Married", "متزوج"], divorced: ["Divorced", "مطلق"], widowed: ["Widowed", "أرمل"],
  fixed: ["Fixed", "ثابت"], shift: ["Shift", "ورديات"], flexible: ["Flexible", "مرن"],
  pending_manager: ["Pending manager", "بانتظار المدير"], pending_hr: ["Pending HR", "بانتظار الموارد البشرية"], hr_approved: ["Approved", "معتمدة"], approved: ["Approved", "معتمدة"],
  rejected: ["Rejected", "مرفوضة"], manager_rejected: ["Rejected", "مرفوضة"], hr_rejected: ["Rejected", "مرفوضة"], cancelled: ["Cancelled", "ملغاة"],
  present: ["Present", "حاضر"], late: ["Late", "متأخر"], absent: ["Absent", "غائب"], leave: ["On leave", "إجازة"], holiday: ["Holiday", "عطلة"], remote: ["Remote", "عن بُعد"],
  non_working_day: ["Day off", "راحة"], scheduled: ["Scheduled", "مجدول"], incomplete: ["Incomplete", "غير مكتمل"],
  spouse: ["Spouse", "زوج/زوجة"], parent: ["Parent", "أب/أم"], sibling: ["Sibling", "أخ/أخت"], child: ["Child", "ابن/ابنة"], relative: ["Relative", "قريب"], friend: ["Friend", "صديق"], other: ["Other", "أخرى"],
  basic: ["Basic", "أساسي"], standard: ["Standard", "قياسي"], premium: ["Premium", "مميز"], vip: ["VIP", "كبار الشخصيات"],
  administrative_decision: ["Administrative decision", "قرار إداري"], circular: ["Circular", "تعميم"], policy: ["Policy", "سياسة"],
  current_assignment: ["Current assignment", "التعيين الحالي"],
};
export const tr = (value: unknown, rtl: boolean) => LABELS[String(value)]?.[rtl ? 1 : 0] ?? (value ? localizedDisplayValue(value, rtl) : "—");
const tone = (status: unknown) => {
  const value = String(status);
  if (["absent", "rejected", "manager_rejected", "hr_rejected", "withdrawn"].includes(value)) return "red";
  if (["late", "pending_manager", "pending_hr", "pending", "incomplete"].includes(value)) return "orange";
  if (["leave", "holiday", "remote", "non_working_day", "scheduled", "cancelled"].includes(value)) return "gray";
  return "green";
};
const Badge = ({ status, rtl, text }: { status: unknown; rtl: boolean; text?: string }) => <span className={`status ${tone(status)}`}><span />{text ?? tr(status, rtl)}</span>;

/** "ar / en" server messages become one language; anything else goes through the shared API message map. */
export function apiMessage(body: Row, status: number, rtl: boolean) {
  const raw = String(body.error || body.message || `Request failed (${status})`);
  return (rtl ? body.message_ar : body.message_en) as string || bilingualMessage(raw, rtl) || localizeApiMessage(raw, rtl);
}
async function post(url: string, payload: Row, rtl: boolean) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({})) as Row;
  if (response.status === 401) window.dispatchEvent(new Event("portal-session-expired"));
  if (!response.ok) throw new Error(apiMessage(body, response.status, rtl));
  window.dispatchEvent(new Event("hr-data-changed"));
  return body;
}
const profilePost = (employeeId: number, payload: Row, rtl: boolean) => post(`/api/employees/${employeeId}/profile`, payload, rtl);
const hrPost = (payload: Row, rtl: boolean) => post("/api/hr", payload, rtl);

function Panel({ icon, title, action, children, className = "" }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`pt-panel ${className}`}><header><h2>{icon}{title}</h2>{action}</header>{children}</section>;
}
function Facts({ items }: { items: [string, ReactNode][] }) {
  return <dl className="pt-facts">{items.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value === "" || value === null || value === undefined ? "—" : value}</dd></div>)}</dl>;
}
function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="pt-empty">{empty}</p>;
  return <div className="pt-table-wrap"><table className="pt-table"><thead><tr>{head.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
    <tbody>{rows.map((cells, i) => <tr key={i}>{cells.map((cell, j) => <td key={j} data-label={head[j]}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
const IconButton = ({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) =>
  <button type="button" className={`pt-icon${danger ? " danger" : ""}`} onClick={onClick} aria-label={label} title={label}>{children}</button>;

/* ------------------------------------------------------------------ overview */

export function OverviewTab({ rtl, data, employeeId }: { rtl: boolean; data: Row; employeeId: number }) {
  const p = (data.permissions || {}) as Row;
  const [personal, setPersonal] = useState<Row>({});
  // Personal details come from a separate HR/self-only endpoint; the general profile API never carries them.
  useEffect(() => {
    if (!p.canViewPersonalDetails) return;
    let live = true;
    const load = () => fetch(`/api/employees/${employeeId}/profile`, { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(body => { if (live && body?.personal) setPersonal(body.personal); }).catch(() => {});
    void load();
    window.addEventListener("hr-data-changed", load);
    return () => { live = false; window.removeEventListener("hr-data-changed", load); };
  }, [employeeId, p.canViewPersonalDetails]);
  const e = { ...(data.employee as Row), ...personal };
  return <div className="pt-grid">
    {p.canViewPersonalDetails ? <Panel icon={<User />} title={rtl ? "المعلومات الشخصية" : "Personal information"}>
      <Facts items={[[rtl ? "تاريخ الميلاد" : "Date of birth", dash(e.birth_date)], [rtl ? "الجنس" : "Gender", e.gender ? tr(e.gender, rtl) : "—"], [rtl ? "الجنسية" : "Nationality", dash(e.nationality)],
        [rtl ? "رقم الهوية" : "ID number", <span dir="ltr" key="id">{dash(e.identification_number)}</span>], [rtl ? "جواز السفر" : "Passport", <span dir="ltr" key="pp">{dash(e.passport_number)}</span>], [rtl ? "الحالة الاجتماعية" : "Marital status", e.marital_status ? tr(e.marital_status, rtl) : "—"]]} />
      <div className="pt-address"><span>{rtl ? "العنوان" : "Address"}</span><p>{dash(e.address)}</p></div>
    </Panel> : <Panel icon={<User />} title={rtl ? "المعلومات الشخصية" : "Personal information"}><p className="pt-empty">{rtl ? "البيانات الشخصية متاحة للموارد البشرية والموظف نفسه." : "Personal details are visible to HR and the employee only."}</p></Panel>}
    <Panel icon={<Clock3 />} title={rtl ? "معلومات الوردية" : "Shift information"}>
      <Facts items={[[rtl ? "نوع الوردية" : "Shift type", e.schedule_type ? tr(e.schedule_type, rtl) : "—"], [rtl ? "بداية الوردية" : "Shift start", <span dir="ltr" key="in">{dash(e.check_in_time)}</span>],
        [rtl ? "نهاية الوردية" : "Shift end", <span dir="ltr" key="out">{dash(e.check_out_time)}</span>], [rtl ? "سماحية التأخير" : "Late allowance", e.grace_minutes ? `${num(e.grace_minutes, rtl)} ${rtl ? "دقيقة" : "min"}` : "—"]]} />
    </Panel>
  </div>;
}

/* ------------------------------------------------------------------ job history */

export function HistoryTab({ rtl, data }: { rtl: boolean; data: Row }) {
  const rows = (data.jobHistory || []) as Row[];
  return <Panel icon={<FileText />} title={rtl ? "السجل الوظيفي" : "Job history"}>
    <Table empty={rtl ? "لا يوجد سجل وظيفي" : "No job history"} head={[rtl ? "القسم" : "Department", rtl ? "المسمى الوظيفي" : "Job title", rtl ? "تاريخ البدء" : "Start date", rtl ? "تاريخ الانتهاء" : "End date", rtl ? "سبب التغيير" : "Reason"]}
      rows={rows.map(r => [<span key="d" className="pt-name"><b>{pick(r, "department_name", rtl) || "—"}</b>{r.section_name ? <small>{pick(r, "section_name", rtl)}</small> : null}<small>{String(r.company_name ?? "")}</small></span>,
        pick(r, "job_title_name", rtl) || pick(r, "position_name", rtl) || "—", <span key="s" dir="ltr">{day(r.start_date)}</span>,
        r.end_date ? <span key="e" dir="ltr">{day(r.end_date)}</span> : <Badge key="e" status="active" rtl={rtl} text={rtl ? "حالي" : "Current"} />, r.change_reason ? tr(r.change_reason, rtl) : "—"])} />
  </Panel>;
}

/* ------------------------------------------------------------------ leave */

type LeaveDraft = { requestId?: number; leaveTypeId: string; fromDate: string; toDate: string; reason: string; notes: string };
const cancellable = (row: Row) => ["pending_manager", "pending_hr"].includes(String(row.status)) || (String(row.status) === "hr_approved" && String(row.from_date) > today());

export function LeaveTab({ rtl, data, employeeId }: { rtl: boolean; data: Row; employeeId: number }) {
  const p = (data.permissions || {}) as Row, balances = (data.summary?.leaveBalances || []) as Row[], rows = (data.leaveRequests || []) as Row[], types = (data.leaveTypes || []) as Row[];
  const [draft, setDraft] = useState<LeaveDraft | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [printing, setPrinting] = useState<Row | null>(null), [notice, setNotice] = useState("");
  const open = (row?: Row) => { setError(""); setDraft(row ? { requestId: Number(row.id), leaveTypeId: String(row.leave_type_id ?? ""), fromDate: day(row.from_date), toDate: day(row.to_date), reason: String(row.reason ?? ""), notes: String(row.notes ?? "") } : { leaveTypeId: String(types[0]?.id ?? ""), fromDate: today(), toDate: today(), reason: "", notes: "" }); };
  const submit = async () => {
    if (!draft) return; setBusy(true); setError("");
    try {
      const common = { leaveTypeId: Number(draft.leaveTypeId), fromDate: draft.fromDate, toDate: draft.toDate, reason: draft.reason, notes: draft.notes };
      const result = draft.requestId ? await hrPost({ action: "edit_leave_request", requestId: draft.requestId, ...common }, rtl) : await hrPost({ action: "create_request", employeeId, type: "Leave", ...common }, rtl);
      setNotice(result.status === "hr_approved" ? (rtl ? "تم تسجيل الإجازة واعتمادها وخصمها من الرصيد." : "Leave recorded, approved and deducted from the balance.") : (rtl ? "تم تسجيل الإجازة وإرسالها للاعتماد." : "Leave recorded and sent for approval."));
      setDraft(null);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  const remove = async (row: Row) => {
    if (!window.confirm(rtl ? `حذف الإجازة ${row.request_code ?? ""}؟ سيُعاد رصيدها.` : `Delete leave ${row.request_code ?? ""}? Its balance will be restored.`)) return;
    try { await hrPost({ action: "cancel_leave_request", requestId: row.id, reason: "Deleted from employee profile" }, rtl); setNotice(rtl ? "تم حذف الإجازة وإعادة الرصيد." : "Leave deleted and balance restored."); }
    catch (cause) { setNotice((cause as Error).message); }
  };
  return <>
    <Panel icon={<CalendarDays />} title={rtl ? "رصيد الإجازات حسب النوع" : "Leave balance by type"}>
      {balances.length ? <div className="pt-balances">{balances.map(b => <article key={String(b.id)}><b>{nm(b, rtl)}</b><strong>{num(b.available, rtl)}</strong><small>{rtl ? "مستخدم" : "Used"}: {num(b.used, rtl)} / {num(b.entitlement, rtl)}{Number(b.pending) ? ` · ${rtl ? "معلّق" : "Pending"}: ${num(b.pending, rtl)}` : ""}</small></article>)}</div>
        : <p className="pt-empty">{rtl ? "لا توجد أرصدة إجازات." : "No leave balances."}</p>}
    </Panel>
    <Panel icon={<FileText />} title={rtl ? "طلبات الإجازات" : "Leave requests"} action={p.canManageLeave && types.length ? <button type="button" className="primary" onClick={() => open()}><Plus size={16} />{rtl ? "إضافة إجازة" : "Add leave"}</button> : null}>
      {notice && <p className="pt-notice" role="status">{notice}</p>}
      {p.canViewRequests ? <Table empty={rtl ? "لا توجد طلبات إجازة" : "No leave requests"} head={[rtl ? "النوع" : "Type", rtl ? "من" : "From", rtl ? "إلى" : "To", rtl ? "عدد الأيام" : "Days", rtl ? "بواسطة" : "By", rtl ? "الحالة" : "Status", rtl ? "الإجراءات" : "Actions"]}
        rows={rows.map(r => [pick(r, "leave_type_name", rtl), <span key="f" dir="ltr">{day(r.from_date)}</span>, <span key="t" dir="ltr">{day(r.to_date)}</span>, num(r.requested_days, rtl), pick(r, "created_by_name", rtl) || "—", <Badge key="s" status={r.status} rtl={rtl} />,
          <span key="a" className="pt-actions"><IconButton label={rtl ? "طباعة" : "Print"} onClick={() => setPrinting(r)}><Printer size={16} /></IconButton>
            {p.canEditLeave && cancellable(r) && <IconButton label={rtl ? "تعديل" : "Edit"} onClick={() => open(r)}><Pencil size={16} /></IconButton>}
            {p.canEditLeave && cancellable(r) && <IconButton danger label={rtl ? "حذف" : "Delete"} onClick={() => void remove(r)}><Trash2 size={16} /></IconButton>}</span>])} />
        : <p className="pt-empty">{rtl ? "لا تملك صلاحية عرض طلبات هذا الموظف." : "You cannot view this employee's requests."}</p>}
    </Panel>
    {draft && <MasterDataDrawer rtl={rtl} eyebrow={rtl ? "إجازة" : "LEAVE"} title={draft.requestId ? (rtl ? "تعديل الإجازة" : "Edit leave") : (rtl ? "إضافة إجازة" : "Add leave")}
      subtitle={rtl ? "تُسجّل الإجازة التي يضيفها المدير المباشر معتمدة مباشرة وتُخصم من الرصيد." : "Leave added by the direct manager is approved immediately and deducted from the balance."}
      onClose={() => setDraft(null)} onSubmit={submit} busy={busy} error={error} submitLabel={draft.requestId ? (rtl ? "حفظ التعديل" : "Save changes") : (rtl ? "إضافة الإجازة" : "Add leave")}>
      <SelectField label={rtl ? "نوع الإجازة" : "Leave type"} required value={draft.leaveTypeId} onChange={value => setDraft({ ...draft, leaveTypeId: value })} options={types.map(t => ({ value: String(t.id), label: nm(t, rtl) }))} />
      <div className="form-row">
        <TextField label={rtl ? "من" : "From"} type="date" required value={draft.fromDate} onChange={value => setDraft({ ...draft, fromDate: value, toDate: draft.toDate < value ? value : draft.toDate })} />
        <TextField label={rtl ? "إلى" : "To"} type="date" required value={draft.toDate} onChange={value => setDraft({ ...draft, toDate: value })} />
      </div>
      <TextField label={rtl ? "السبب" : "Reason"} required maxLength={1000} value={draft.reason} onChange={value => setDraft({ ...draft, reason: value })} />
      <TextAreaField label={rtl ? "ملاحظات" : "Notes"} value={draft.notes} maxLength={2000} onChange={value => setDraft({ ...draft, notes: value })} />
    </MasterDataDrawer>}
    {printing && <LeavePrint rtl={rtl} row={printing} employee={data.employee as Row} close={() => setPrinting(null)} />}
  </>;
}

function LeavePrint({ rtl, row, employee, close }: { rtl: boolean; row: Row; employee: Row; close: () => void }) {
  useEffect(() => { document.body.classList.add("pt-printing"); return () => document.body.classList.remove("pt-printing"); }, []);
  const facts: [string, ReactNode][] = [[rtl ? "الموظف" : "Employee", nm(employee, rtl)], [rtl ? "رقم الموظف" : "Employee code", <span dir="ltr" key="c">{String(employee.employee_code ?? "")}</span>],
    [rtl ? "القسم" : "Department", pick(employee, "department_name", rtl) || "—"], [rtl ? "المسمى الوظيفي" : "Job title", pick(employee, "job_title_name", rtl) || "—"],
    [rtl ? "رقم الطلب" : "Request no.", <span dir="ltr" key="r">{String(row.request_code ?? row.id)}</span>], [rtl ? "نوع الإجازة" : "Leave type", pick(row, "leave_type_name", rtl)],
    [rtl ? "من" : "From", <span dir="ltr" key="f">{day(row.from_date)}</span>], [rtl ? "إلى" : "To", <span dir="ltr" key="t">{day(row.to_date)}</span>],
    [rtl ? "عدد الأيام" : "Days", num(row.requested_days, rtl)], [rtl ? "الحالة" : "Status", tr(row.status, rtl)], [rtl ? "بواسطة" : "Filed by", pick(row, "created_by_name", rtl) || (rtl ? "الموظف" : "Employee")], [rtl ? "السبب" : "Reason", dash(row.reason)]];
  return <div className="modal-layer pt-print-layer"><button type="button" className="modal-scrim" onClick={close} aria-label={rtl ? "إغلاق" : "Close"} />
    <section className="pt-print-sheet" dir={rtl ? "rtl" : "ltr"} role="dialog" aria-modal="true">
      <div className="pt-print-controls"><button type="button" className="outline" onClick={close}><X size={16} />{rtl ? "إغلاق" : "Close"}</button><button type="button" className="primary" onClick={() => window.print()}><Printer size={16} />{rtl ? "طباعة" : "Print"}</button></div>
      <header><img src="/hr-logo.png" alt="SANA HR" /><div><h1>{rtl ? "نموذج إجازة" : "Leave form"}</h1><p>{rtl ? "تاريخ الطباعة" : "Printed"}: <span dir="ltr">{today()}</span></p></div></header>
      <dl className="pt-print-facts">{facts.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
      <footer><div><span>{rtl ? "توقيع الموظف" : "Employee signature"}</span></div><div><span>{rtl ? "توقيع المدير المباشر" : "Manager signature"}</span></div><div><span>{rtl ? "الموارد البشرية" : "Human Resources"}</span></div></footer>
    </section></div>;
}

/* ------------------------------------------------------------------ attendance */

const monthOf = (offset: number) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 7); };
const duration = (minutes: unknown, rtl: boolean) => { const m = Number(minutes) || 0; return rtl ? `${num(Math.floor(m / 60), rtl)}س ${num(m % 60, rtl)}د` : `${Math.floor(m / 60)}h ${m % 60}m`; };

export function AttendanceTab({ rtl, employeeId }: { rtl: boolean; employeeId: number }) {
  const [offset, setOffset] = useState(0), [rows, setRows] = useState<Row[] | null>(null), [error, setError] = useState("");
  const load = useCallback(async (value: number) => {
    setRows(null); setError("");
    try { const response = await fetch(`/api/employees/${employeeId}?tab=attendance&month=${monthOf(value)}`, { cache: "no-store" }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(apiMessage(body, response.status, rtl)); setRows(body.attendance ?? []); }
    catch (cause) { setError((cause as Error).message); }
  }, [employeeId, rtl]);
  useEffect(() => { const timer = window.setTimeout(() => void load(offset), 0); return () => window.clearTimeout(timer); }, [load, offset]);
  return <Panel icon={<Clock3 />} title={rtl ? "سجل الحضور" : "Attendance record"} action={<div className="pt-toggle" role="group">
      <button type="button" className={offset === -1 ? "primary" : "outline"} onClick={() => setOffset(-1)}>{rtl ? "الشهر الماضي" : "Last month"}</button>
      <button type="button" className={offset === 0 ? "primary" : "outline"} onClick={() => setOffset(0)}>{rtl ? "الشهر الحالي" : "This month"}</button></div>}>
    {error ? <p className="error-banner">{error}</p> : rows === null ? <p className="pt-empty" role="status">{rtl ? "جارٍ التحميل..." : "Loading..."}</p> :
      <Table empty={rtl ? "لا توجد سجلات حضور لهذا الشهر" : "No attendance records this month"} head={[rtl ? "التاريخ" : "Date", rtl ? "الحضور" : "Check-in", rtl ? "الانصراف" : "Check-out", rtl ? "ساعات العمل" : "Worked", rtl ? "التأخير" : "Late", rtl ? "الإضافي" : "Overtime", rtl ? "الحالة" : "Status"]}
        rows={rows.map(r => [<span key="d" dir="ltr">{day(r.work_date)}</span>, <span key="i" dir="ltr">{dash(r.actual_in)}</span>, <span key="o" dir="ltr">{dash(r.actual_out)}</span>, duration(r.worked_minutes, rtl),
          Number(r.late_minutes) ? `${num(r.late_minutes, rtl)} ${rtl ? "د" : "min"}` : "—", Number(r.overtime_minutes) ? `${num(r.overtime_minutes, rtl)} ${rtl ? "د" : "min"}` : "—", <Badge key="s" status={r.status} rtl={rtl} />])} />}
  </Panel>;
}

/* ------------------------------------------------------------------ insurance */

export function InsuranceTab({ rtl, data, employeeId }: { rtl: boolean; data: Row; employeeId: number }) {
  const p = (data.permissions || {}) as Row, records = (data.insurance || []) as Row[], plans = (data.insurancePlans || []) as Row[];
  const active = records.find(r => r.status === "active"), past = records.filter(r => r !== active);
  const [draft, setDraft] = useState<Row | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const canManage = Boolean(p.canManageProfile);
  const open = (row?: Row) => { setError(""); setDraft(row ? { id: row.id, plan_id: String(row.plan_id), card_number: row.card_number ?? "", start_date: day(row.start_date), end_date: row.end_date ? day(row.end_date) : "", dependents: String(row.dependents ?? 0), notes: row.notes ?? "" } : { plan_id: String(plans[0]?.id ?? ""), card_number: "", start_date: today(), end_date: "", dependents: "0", notes: "" }); };
  const save = async () => { setBusy(true); setError(""); try { await profilePost(employeeId, { action: "save_insurance", record: draft! }, rtl); setDraft(null); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } };
  const end = async () => { if (!window.confirm(rtl ? "إنهاء التأمين الطبي الحالي؟" : "End the current medical insurance?")) return; try { await profilePost(employeeId, { action: "end_insurance" }, rtl); } catch (cause) { window.alert((cause as Error).message); } };
  return <>
    <Panel icon={<HeartPulse />} title={rtl ? "التأمين الطبي" : "Medical insurance"} action={canManage ? <span className="pt-actions">
        {active && <button type="button" className="outline" onClick={() => open(active)}><Pencil size={14} />{rtl ? "تعديل" : "Edit"}</button>}
        {plans.length > 0 && <button type="button" className="primary" onClick={() => open()}><Plus size={16} />{active ? (rtl ? "تغيير الخطة" : "Change plan") : (rtl ? "إسناد خطة" : "Assign plan")}</button>}
        {active && <button type="button" className="outline danger" onClick={() => void end()}>{rtl ? "إنهاء" : "End"}</button>}</span> : null}>
      {active ? <Facts items={[[rtl ? "الخطة" : "Plan", <b key="p">{pick(active, "plan_name", rtl)}</b>], [rtl ? "شركة التأمين" : "Provider", String(active.provider ?? "")], [rtl ? "نوع التغطية" : "Coverage", tr(active.coverage_type, rtl)],
          [rtl ? "الحد الأقصى" : "Maximum coverage", <span key="m" dir="ltr">{num(active.max_coverage, rtl)} {String(active.currency ?? "")}</span>], [rtl ? "رقم البطاقة" : "Card number", <span key="c" dir="ltr">{dash(active.card_number)}</span>],
          [rtl ? "من" : "From", <span key="f" dir="ltr">{day(active.start_date)}</span>], [rtl ? "إلى" : "To", active.end_date ? <span key="t" dir="ltr">{day(active.end_date)}</span> : "—"],
          [rtl ? "التابعون" : "Dependents", num(active.dependents, rtl)], [rtl ? "مساهمة الموظف / الشركة" : "Employee / company share", <span key="s" dir="ltr">{num(active.employee_contribution, rtl)}% / {num(active.company_contribution, rtl)}%</span>]]} />
        : <p className="pt-empty">{rtl ? "لا يوجد تأمين طبي" : "No medical insurance"}{canManage && !plans.length ? (rtl ? " — أضف خطة من إعدادات الموارد البشرية أولًا." : " — add a plan in HR Settings first.") : ""}</p>}
    </Panel>
    {past.length > 0 && <Panel icon={<FileText />} title={rtl ? "تأمين سابق" : "Previous insurance"}>
      <Table empty="" head={[rtl ? "الخطة" : "Plan", rtl ? "من" : "From", rtl ? "إلى" : "To", rtl ? "رقم البطاقة" : "Card"]} rows={past.map(r => [pick(r, "plan_name", rtl), <span key="f" dir="ltr">{day(r.start_date)}</span>, <span key="t" dir="ltr">{day(r.end_date)}</span>, <span key="c" dir="ltr">{dash(r.card_number)}</span>])} />
    </Panel>}
    {draft && <MasterDataDrawer rtl={rtl} eyebrow={rtl ? "التأمين الطبي" : "MEDICAL INSURANCE"} title={draft.id ? (rtl ? "تعديل التأمين" : "Edit insurance") : (rtl ? "إسناد خطة تأمين" : "Assign insurance plan")}
      subtitle={!draft.id && active ? (rtl ? "تنتهي الخطة الحالية في اليوم السابق لبداية الخطة الجديدة." : "The current plan ends the day before the new one starts.") : undefined} onClose={() => setDraft(null)} onSubmit={save} busy={busy} error={error}>
      <SelectField label={rtl ? "الخطة" : "Plan"} required value={draft.plan_id} onChange={value => setDraft({ ...draft, plan_id: value })} options={plans.map(plan => ({ value: String(plan.id), label: `${nm(plan, rtl)} — ${plan.provider}` }))} />
      <TextField label={rtl ? "رقم البطاقة" : "Card number"} dir="ltr" maxLength={60} value={draft.card_number} onChange={value => setDraft({ ...draft, card_number: value })} />
      <div className="form-row">
        <TextField label={rtl ? "من" : "From"} type="date" required value={draft.start_date} onChange={value => setDraft({ ...draft, start_date: value })} />
        <TextField label={rtl ? "إلى (اختياري)" : "To (optional)"} type="date" value={draft.end_date} onChange={value => setDraft({ ...draft, end_date: value })} />
      </div>
      <TextField label={rtl ? "عدد التابعين" : "Dependents"} type="number" min={0} value={draft.dependents} onChange={value => setDraft({ ...draft, dependents: value })} />
      <TextAreaField label={rtl ? "ملاحظات" : "Notes"} value={draft.notes} onChange={value => setDraft({ ...draft, notes: value })} />
    </MasterDataDrawer>}
  </>;
}

/* ------------------------------------------------------------------ emergency contacts */

const RELATIONSHIPS = ["spouse", "parent", "sibling", "child", "relative", "friend", "other"];
export function ContactsTab({ rtl, data, employeeId }: { rtl: boolean; data: Row; employeeId: number }) {
  const p = (data.permissions || {}) as Row, contacts = (data.contacts || []) as Row[], canManage = Boolean(p.canManageProfile);
  const [draft, setDraft] = useState<Row | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const save = async () => { setBusy(true); setError(""); try { await profilePost(employeeId, { action: "save_contact", record: draft! }, rtl); setDraft(null); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } };
  const remove = async (row: Row) => { if (!window.confirm(rtl ? `حذف جهة الاتصال «${row.name}»؟` : `Delete contact "${row.name}"?`)) return; try { await profilePost(employeeId, { action: "delete_contact", record: { id: row.id } }, rtl); } catch (cause) { window.alert((cause as Error).message); } };
  return <>
    <Panel icon={<Phone />} title={rtl ? "جهات الاتصال في الطوارئ" : "Emergency contacts"} action={canManage ? <button type="button" className="primary" onClick={() => { setError(""); setDraft({ name: "", relationship: "parent", phone: "", alternate_phone: "", is_primary: contacts.length === 0 }); }}><Plus size={16} />{rtl ? "إضافة جهة اتصال" : "Add contact"}</button> : null}>
      <Table empty={rtl ? "لا توجد جهات اتصال" : "No emergency contacts"} head={[rtl ? "الاسم" : "Name", rtl ? "صلة القرابة" : "Relationship", rtl ? "الهاتف" : "Phone", rtl ? "هاتف بديل" : "Alternate", ...(canManage ? [rtl ? "الإجراءات" : "Actions"] : [])]}
        rows={contacts.map(c => [<span key="n" className="pt-name"><b>{String(c.name)}</b>{Number(c.is_primary) ? <Badge status="active" rtl={rtl} text={rtl ? "أساسي" : "Primary"} /> : null}</span>, tr(c.relationship, rtl), <span key="p" dir="ltr">{String(c.phone)}</span>, <span key="a" dir="ltr">{dash(c.alternate_phone)}</span>,
          ...(canManage ? [<span key="x" className="pt-actions"><IconButton label={rtl ? "تعديل" : "Edit"} onClick={() => { setError(""); setDraft({ ...c, alternate_phone: c.alternate_phone ?? "", is_primary: Number(c.is_primary) === 1 }); }}><Pencil size={16} /></IconButton><IconButton danger label={rtl ? "حذف" : "Delete"} onClick={() => void remove(c)}><Trash2 size={16} /></IconButton></span>] : [])])} />
    </Panel>
    {draft && <MasterDataDrawer rtl={rtl} eyebrow={rtl ? "جهة اتصال" : "CONTACT"} title={draft.id ? String(draft.name) : (rtl ? "جهة اتصال جديدة" : "New contact")} onClose={() => setDraft(null)} onSubmit={save} busy={busy} error={error}>
      <TextField label={rtl ? "الاسم" : "Name"} required maxLength={120} value={draft.name} onChange={value => setDraft({ ...draft, name: value })} />
      <SelectField label={rtl ? "صلة القرابة" : "Relationship"} required value={draft.relationship} onChange={value => setDraft({ ...draft, relationship: value })} options={RELATIONSHIPS.map(value => ({ value, label: tr(value, rtl) }))} />
      <div className="form-row">
        <TextField label={rtl ? "الهاتف" : "Phone"} required dir="ltr" type="tel" maxLength={20} value={draft.phone} onChange={value => setDraft({ ...draft, phone: value })} />
        <TextField label={rtl ? "هاتف بديل" : "Alternate phone"} dir="ltr" type="tel" maxLength={20} value={draft.alternate_phone} onChange={value => setDraft({ ...draft, alternate_phone: value })} />
      </div>
      <CheckField label={rtl ? "جهة الاتصال الأساسية" : "Primary contact"} checked={Boolean(draft.is_primary)} onChange={value => setDraft({ ...draft, is_primary: value })} />
    </MasterDataDrawer>}
  </>;
}

/* ------------------------------------------------------------------ acknowledgements */

export function AcknowledgementsTab({ rtl, data }: { rtl: boolean; data: Row }) {
  const rows = (data.acknowledgements || []) as Row[];
  const [viewing, setViewing] = useState<Row | null>(null);
  const state = (r: Row) => r.acknowledged_at ? <Badge status="active" rtl={rtl} text={rtl ? "موقّع" : "Signed"} /> : r.status === "withdrawn" ? <Badge status="cancelled" rtl={rtl} text={rtl ? "مسحوب" : "Withdrawn"} /> : <Badge status="pending" rtl={rtl} text={rtl ? "بانتظار الإقرار" : "Awaiting"} />;
  return <>
    <Panel icon={<FileCheck2 />} title={rtl ? "الإقرارات الموقعة" : "Signed acknowledgements"}>
      <Table empty={rtl ? "لا توجد إقرارات" : "No acknowledgements"} head={[rtl ? "الإقرار" : "Acknowledgement", rtl ? "تاريخ التوقيع" : "Signed at", rtl ? "الحالة" : "Status", ""]}
        rows={rows.map(r => [<span key="t" className="pt-name"><b>{String(r.title)}</b><small>{tr(r.decision_type, rtl)} · <span dir="ltr">{String(r.decision_number)}</span></small></span>,
          r.acknowledged_at ? <span key="d" dir="ltr">{String(r.acknowledged_at).slice(0, 16).replace("T", " ")}</span> : "—", state(r),
          <IconButton key="v" label={rtl ? "عرض" : "View"} onClick={() => setViewing(r)}><Eye size={16} /></IconButton>])} />
    </Panel>
    {viewing && <MasterDataDrawer rtl={rtl} readOnly eyebrow={`${tr(viewing.decision_type, rtl)} · ${viewing.decision_number}`} title={String(viewing.title)} subtitle={viewing.effective_date ? `${rtl ? "تاريخ السريان" : "Effective"}: ${day(viewing.effective_date)}` : undefined} onClose={() => setViewing(null)}>
      <div className="pt-decision-body">{String(viewing.body)}</div>
      <p className="pt-sub"><ShieldCheck size={14} /> {viewing.acknowledged_at ? `${rtl ? "تم الإقرار في" : "Acknowledged on"} ${String(viewing.acknowledged_at).slice(0, 16).replace("T", " ")}` : (rtl ? "لم يتم الإقرار بعد" : "Not acknowledged yet")}</p>
    </MasterDataDrawer>}
  </>;
}
