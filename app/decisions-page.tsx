"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, FileCheck2, Plus, RefreshCw, ScrollText, ShieldCheck, Undo2, Users } from "lucide-react";
import { MasterDataDrawer, SelectField, TextAreaField, TextField } from "./settings/settings-ui";
import { apiMessage, tr } from "./employee-profile-tabs";
import type { Row } from "./ui-types";
import "./decisions-page.css";

const TYPES = ["administrative_decision", "circular", "policy"];
const stamp = (value: unknown) => value ? String(value).slice(0, 16).replace("T", " ") : "—";
const nameOf = (row: Row, rtl: boolean, key = "name") => String((rtl ? row[`${key}_ar`] || row[`${key}_en`] || row[key] : row[`${key}_en`] || row[key] || row[`${key}_ar`]) ?? "");

async function call(path: string, rtl: boolean, payload?: Row) {
  const response = await fetch(path, payload ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : { cache: "no-store" });
  const body = await response.json().catch(() => ({})) as Row;
  if (response.status === 401) window.dispatchEvent(new Event("portal-session-expired"));
  if (!response.ok) throw new Error(apiMessage(body, response.status, rtl));
  return body;
}

/* ------------------------------------------------------------------ management page */

export function DecisionsPage({ rtl, notify }: { rtl: boolean; notify: (message: string) => void }) {
  const [data, setData] = useState<{ decisions: Row[]; canCreate: boolean } | null>(null), [error, setError] = useState("");
  const [creating, setCreating] = useState(false), [viewing, setViewing] = useState<Row | null>(null);
  const load = useCallback(async () => { try { setData(await call("/api/decisions", rtl) as never); setError(""); } catch (cause) { setError((cause as Error).message); } }, [rtl]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const withdraw = async (row: Row) => {
    if (!window.confirm(rtl ? `سحب القرار «${row.title}»؟ لن يظهر لمن لم يقر به بعد.` : `Withdraw "${row.title}"? It will stop prompting employees who have not acknowledged it.`)) return;
    try { await call("/api/decisions", rtl, { action: "withdraw", decisionId: row.id }); notify(rtl ? "تم سحب القرار" : "Decision withdrawn"); await load(); } catch (cause) { notify((cause as Error).message); }
  };
  return <section className="decisions-page" dir={rtl ? "rtl" : "ltr"}>
    <header className="decisions-head">
      <div><h1><ScrollText />{rtl ? "القرارات الإدارية" : "Administrative decisions"}</h1><p>{rtl ? "أرسل القرار لموظفين محددين؛ يظهر لكل منهم عند الدخول ولا يُغلق إلا بعد الإقرار به." : "Send a decision to specific employees; each sees it on sign-in and can only close it by acknowledging."}</p></div>
      <div className="decisions-head-actions"><button type="button" className="outline" onClick={() => void load()}><RefreshCw size={16} />{rtl ? "تحديث" : "Refresh"}</button>
        {data?.canCreate && <button type="button" className="primary" onClick={() => setCreating(true)}><Plus size={16} />{rtl ? "قرار جديد" : "New decision"}</button>}</div>
    </header>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {!data && !error && <p role="status" className="decisions-muted">{rtl ? "جارٍ التحميل..." : "Loading..."}</p>}
    {data && (data.decisions.length ? <div className="decisions-table-wrap"><table className="decisions-table">
      <thead><tr><th>{rtl ? "القرار" : "Decision"}</th><th>{rtl ? "النوع" : "Type"}</th><th>{rtl ? "المرسل" : "Sent by"}</th><th>{rtl ? "التاريخ" : "Date"}</th><th>{rtl ? "الإقرار" : "Acknowledged"}</th><th>{rtl ? "الحالة" : "Status"}</th><th /></tr></thead>
      <tbody>{data.decisions.map(row => { const total = Number(row.recipients), done = Number(row.acknowledged), pct = total ? Math.round(done * 100 / total) : 0; return <tr key={String(row.id)}>
        <td data-label={rtl ? "القرار" : "Decision"}><span className="decisions-name"><b>{String(row.title)}</b><small dir="ltr">{String(row.decision_number)}</small></span></td>
        <td data-label={rtl ? "النوع" : "Type"}>{tr(row.decision_type, rtl)}</td>
        <td data-label={rtl ? "المرسل" : "Sent by"}>{nameOf(row, rtl, "created_by_name")}</td>
        <td data-label={rtl ? "التاريخ" : "Date"}><span dir="ltr">{stamp(row.created_at)}</span></td>
        <td data-label={rtl ? "الإقرار" : "Acknowledged"}><span className="decisions-progress"><span><i style={{ inlineSize: `${pct}%` }} /></span><small>{done} / {total}</small></span></td>
        <td data-label={rtl ? "الحالة" : "Status"}><span className={`status ${row.status === "active" ? (done === total ? "green" : "orange") : "gray"}`}><span />{row.status !== "active" ? (rtl ? "مسحوب" : "Withdrawn") : done === total ? (rtl ? "مكتمل" : "Complete") : (rtl ? "بانتظار الإقرار" : "Awaiting")}</span></td>
        <td className="decisions-actions"><button type="button" className="outline" onClick={() => setViewing(row)}><Eye size={14} />{rtl ? "الموظفون" : "Recipients"}</button>
          {row.status === "active" && data.canCreate && <button type="button" className="outline danger" onClick={() => void withdraw(row)}><Undo2 size={14} />{rtl ? "سحب" : "Withdraw"}</button>}</td>
      </tr>; })}</tbody></table></div>
      : <div className="decisions-empty"><FileCheck2 /><p>{rtl ? "لا توجد قرارات بعد." : "No decisions yet."}</p></div>)}
    {creating && <CreateDecision rtl={rtl} close={() => setCreating(false)} saved={async count => { setCreating(false); notify(rtl ? `تم إرسال القرار إلى ${count} موظف` : `Decision sent to ${count} employee(s)`); await load(); }} />}
    {viewing && <Recipients rtl={rtl} decision={viewing} close={() => setViewing(null)} />}
  </section>;
}

function CreateDecision({ rtl, close, saved }: { rtl: boolean; close: () => void; saved: (count: number) => Promise<void> }) {
  const [form, setForm] = useState({ decisionType: "administrative_decision", title: "", body: "", effectiveDate: "" });
  const [audience, setAudience] = useState<Row[] | null>(null), [selected, setSelected] = useState<Set<number>>(new Set()), [search, setSearch] = useState("");
  const [group, setGroup] = useState({ kind: "department", id: "" }), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { let live = true; call("/api/decisions?view=audience", rtl).then(body => { if (live) setAudience(body.employees as Row[]); }).catch(cause => { if (live) setError((cause as Error).message); }); return () => { live = false; }; }, [rtl]);
  const people = useMemo(() => audience ?? [], [audience]);
  // Quick groups are only a way to tick many names at once; the final list is exactly the ticked employees.
  const groups = useMemo(() => {
    const key = group.kind === "company" ? "company_id" : group.kind === "branch" ? "branch_id" : "department_id";
    const label = (row: Row) => group.kind === "company" ? String(row.company_name ?? "") : group.kind === "branch" ? nameOf(row, rtl, "branch_name") : nameOf(row, rtl, "department_name");
    const map = new Map<string, string>();
    for (const row of people) if (row[key]) map.set(String(row[key]), label(row));
    return { key, options: [...map].map(([value, text]) => ({ value, label: `${text} (${people.filter(row => String(row[key]) === value).length})` })).sort((a, b) => a.label.localeCompare(b.label)) };
  }, [people, group.kind, rtl]);
  const needle = search.trim().toLowerCase();
  const shown = people.filter(row => !needle || `${row.name_en} ${row.name_ar} ${row.employee_code} ${row.department_name ?? ""} ${row.department_name_ar ?? ""}`.toLowerCase().includes(needle));
  const toggle = (id: number) => setSelected(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const addGroup = () => { if (!group.id) return; setSelected(old => new Set([...old, ...people.filter(row => String(row[groups.key]) === group.id).map(row => Number(row.id))])); };
  const submit = async () => {
    if (!selected.size) { setError(rtl ? "اختر موظفًا واحدًا على الأقل" : "Select at least one employee"); return; }
    if (!window.confirm(rtl ? `إرسال القرار إلى ${selected.size} موظف؟ لا يمكن تعديل القائمة بعد الإرسال.` : `Send this decision to ${selected.size} employee(s)? The list cannot be changed after sending.`)) return;
    setBusy(true); setError("");
    try { await call("/api/decisions", rtl, { action: "create", ...form, employeeIds: [...selected] }); await saved(selected.size); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  return <MasterDataDrawer rtl={rtl} eyebrow={rtl ? "قرار إداري" : "ADMINISTRATIVE DECISION"} title={rtl ? "قرار جديد" : "New decision"} onClose={close} onSubmit={submit} busy={busy} error={error}
    submitLabel={rtl ? `إرسال إلى ${selected.size} موظف` : `Send to ${selected.size} employee(s)`} submitDisabled={!selected.size}>
    <div className="form-row">
      <SelectField label={rtl ? "النوع" : "Type"} required value={form.decisionType} onChange={value => setForm({ ...form, decisionType: value })} options={TYPES.map(value => ({ value, label: tr(value, rtl) }))} />
      <TextField label={rtl ? "تاريخ السريان (اختياري)" : "Effective date (optional)"} type="date" value={form.effectiveDate} onChange={value => setForm({ ...form, effectiveDate: value })} />
    </div>
    <TextField label={rtl ? "العنوان" : "Title"} required maxLength={200} value={form.title} onChange={value => setForm({ ...form, title: value })} />
    <TextAreaField label={rtl ? "نص القرار" : "Decision text"} required maxLength={10000} value={form.body} onChange={value => setForm({ ...form, body: value })} />
    <fieldset className="decisions-picker">
      <legend><Users size={16} />{rtl ? "المرسل إليهم" : "Recipients"} <b>{selected.size}</b></legend>
      {audience === null ? <p className="decisions-muted">{rtl ? "جارٍ تحميل الموظفين..." : "Loading employees..."}</p> : !people.length ? <p className="decisions-muted">{rtl ? "لا يوجد موظفون ضمن نطاق صلاحياتك." : "No employees within your scope."}</p> : <>
        <div className="decisions-group">
          <select aria-label={rtl ? "نوع المجموعة" : "Group type"} value={group.kind} onChange={event => setGroup({ kind: event.target.value, id: "" })}>
            <option value="department">{rtl ? "قسم" : "Department"}</option><option value="company">{rtl ? "شركة" : "Company"}</option><option value="branch">{rtl ? "فرع" : "Branch"}</option></select>
          <select aria-label={rtl ? "المجموعة" : "Group"} value={group.id} onChange={event => setGroup({ ...group, id: event.target.value })}>
            <option value="">{rtl ? "اختر..." : "Choose..."}</option>{groups.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <button type="button" className="outline" disabled={!group.id} onClick={addGroup}><Plus size={14} />{rtl ? "إضافة المجموعة" : "Add group"}</button>
          <button type="button" className="outline" onClick={() => setSelected(new Set(people.map(row => Number(row.id))))}>{rtl ? "الكل" : "Everyone"}</button>
          <button type="button" className="outline" disabled={!selected.size} onClick={() => setSelected(new Set())}>{rtl ? "مسح" : "Clear"}</button>
        </div>
        <input type="search" className="decisions-search" value={search} onChange={event => setSearch(event.target.value)} placeholder={rtl ? "ابحث بالاسم أو الكود أو القسم..." : "Search by name, code or department..."} />
        <ul className="decisions-people">{shown.map(row => <li key={String(row.id)}><label><input type="checkbox" checked={selected.has(Number(row.id))} onChange={() => toggle(Number(row.id))} />
          <span><b>{nameOf(row, rtl)}</b><small><span dir="ltr">{String(row.employee_code ?? "")}</span> · {nameOf(row, rtl, "department_name") || "—"} · {String(row.company_name ?? "")}</small></span></label></li>)}</ul>
      </>}
    </fieldset>
  </MasterDataDrawer>;
}

function Recipients({ rtl, decision, close }: { rtl: boolean; decision: Row; close: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null), [error, setError] = useState("");
  useEffect(() => { let live = true; call(`/api/decisions?view=recipients&id=${decision.id}`, rtl).then(body => { if (live) setRows(body.recipients as Row[]); }).catch(cause => { if (live) setError((cause as Error).message); }); return () => { live = false; }; }, [decision.id, rtl]);
  return <MasterDataDrawer rtl={rtl} readOnly eyebrow={`${tr(decision.decision_type, rtl)} · ${decision.decision_number}`} title={String(decision.title)} onClose={close} error={error}>
    <div className="decisions-body">{String(decision.body ?? "")}</div>
    {rows === null ? <p className="decisions-muted">{rtl ? "جارٍ التحميل..." : "Loading..."}</p> : <ul className="decisions-people readonly">{rows.map(row => <li key={String(row.employee_id)}><span><b>{nameOf(row, rtl)}</b><small><span dir="ltr">{String(row.employee_code ?? "")}</span> · {nameOf(row, rtl, "department_name") || "—"}</small></span>
      {row.acknowledged_at ? <span className="status green"><span />{rtl ? "أقر" : "Acknowledged"} <small dir="ltr">{stamp(row.acknowledged_at)}</small></span> : <span className="status orange"><span />{rtl ? "لم يقر بعد" : "Pending"}</span>}</li>)}</ul>}
  </MasterDataDrawer>;
}

/* ------------------------------------------------------------------ blocking acknowledgement prompt */

/**
 * Shown to the signed-in employee on load (and when the tab becomes visible again) while they have unacknowledged
 * decisions. It has no close button; the only way out is to acknowledge each decision in turn.
 */
export function DecisionPrompt({ rtl }: { rtl: boolean }) {
  const [pending, setPending] = useState<Row[]>([]), [agreed, setAgreed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = useCallback(async () => { try { const body = await call("/api/decisions?view=pending", rtl); setPending((body.decisions as Row[]) ?? []); } catch { /* silent: never block the app on a failed check */ } }, [rtl]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);
  const current = pending[0];
  if (!current) return null;
  const acknowledge = async () => {
    setBusy(true); setError("");
    try { await call("/api/decisions", rtl, { action: "acknowledge", decisionId: current.id }); setAgreed(false); setPending(old => old.slice(1)); window.dispatchEvent(new Event("hr-data-changed")); }
    catch (cause) { setError((cause as Error).message); await load(); } finally { setBusy(false); }
  };
  return <div className="decision-prompt-layer" role="presentation">
    <section className="decision-prompt" role="alertdialog" aria-modal="true" aria-labelledby="decision-prompt-title" dir={rtl ? "rtl" : "ltr"}>
      <header><span className="decision-prompt-icon"><ScrollText /></span><div><small>{tr(current.decision_type, rtl)} · <span dir="ltr">{String(current.decision_number)}</span>{pending.length > 1 ? ` · ${rtl ? `1 من ${pending.length}` : `1 of ${pending.length}`}` : ""}</small><h2 id="decision-prompt-title">{String(current.title)}</h2>
        <p>{rtl ? "من" : "From"}: {nameOf(current, rtl, "created_by_name")} · <span dir="ltr">{stamp(current.created_at)}</span>{current.effective_date ? ` · ${rtl ? "يسري من" : "Effective"} ${String(current.effective_date)}` : ""}</p></div></header>
      <div className="decision-prompt-body">{String(current.body)}</div>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <label className="decision-prompt-agree"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} /><span>{rtl ? "قرأت هذا القرار وأقر بالاطلاع عليه والالتزام بما فيه." : "I have read this decision and acknowledge it."}</span></label>
      <button type="button" className="primary" disabled={!agreed || busy} onClick={() => void acknowledge()}><ShieldCheck size={18} />{busy ? (rtl ? "جارٍ الحفظ..." : "Saving...") : (rtl ? "إقرار وموافقة" : "Acknowledge")}</button>
    </section>
  </div>;
}
