"use client";
import { useEffect, useMemo, useState } from "react";
import { Lock, Printer, Send, Unlock } from "lucide-react";
import type { Row } from "../../ui-types";
import { Badge, EmployeeCombobox, Modal, call, formatDay, formatMoney, formatNumber, type PickerEmployee } from "./common";
import { componentRuleName, hoursText, kindLabel, num } from "../labels";
import { components, deductionSummary, lateRecords } from "../summary";

type Notify = (message: string) => void;
const text = (rtl: boolean, en: string, ar: string) => (rtl ? ar : en);
const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

// ---------- Add / Edit Timesheet Entry ----------

type EntryForm = { employeeId: number; workDate: string; scheduledStart: string; scheduledEnd: string; actualStart: string; actualEnd: string; breakDurationMinutes: string; isAbsent: boolean; absenceReason: string; notes: string };

export function EntryDialog({ rtl, row, employees, defaultDate, onClose, onSaved, notify }: { rtl: boolean; row: Row | null; employees: PickerEmployee[]; defaultDate: string; onClose: () => void; onSaved: () => void; notify: Notify }) {
  const editing = Boolean(row);
  const [form, setForm] = useState<EntryForm>(() => ({
    employeeId: Number(row?.employee_id) || 0, workDate: String(row?.work_date || defaultDate), scheduledStart: String(row?.scheduled_start ?? ""), scheduledEnd: String(row?.scheduled_end ?? ""),
    actualStart: String(row?.actual_start ?? ""), actualEnd: String(row?.actual_end ?? ""), breakDurationMinutes: row ? String(row.break_duration_minutes ?? 0) : "", isAbsent: Boolean(Number(row?.is_absent)),
    absenceReason: String(row?.absence_reason ?? ""), notes: String(row?.notes ?? ""),
  }));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [hint, setHint] = useState("");
  const set = (patch: Partial<EntryForm>) => setForm(current => ({ ...current, ...patch }));

  // Prefill the shift (and any day already saved) whenever employee and date are both chosen.
  useEffect(() => {
    if (editing || !form.employeeId || !form.workDate) return;
    let active = true;
    void call(rtl, { view: "schedule", employeeId: form.employeeId, date: form.workDate }).then(schedule => {
      if (!active) return;
      setForm(current => ({ ...current, scheduledStart: String(schedule.scheduledStart ?? ""), scheduledEnd: String(schedule.scheduledEnd ?? ""), breakDurationMinutes: String(schedule.breakDurationMinutes ?? 0) }));
      setHint(schedule.lock && schedule.lock !== "open" ? (schedule.lock === "payroll" ? text(rtl, "This day belongs to a locked payroll period.", "هذا اليوم ضمن فترة رواتب مقفلة.") : text(rtl, "This month is confirmed and editing is locked.", "هذا الشهر معتمد والتعديل مقفل."))
        : schedule.existingId ? text(rtl, "An entry already exists for this day; saving updates it.", "يوجد سجل لهذا اليوم؛ سيتم تحديثه عند الحفظ.")
        : !schedule.scheduledStart ? text(rtl, "No shift is scheduled for this day.", "لا يوجد دوام مجدول في هذا اليوم.") : "");
    }).catch(() => { if (active) setHint(""); });
    return () => { active = false; };
  }, [editing, form.employeeId, form.workDate, rtl]);

  const save = async () => {
    if (!form.employeeId || !form.workDate) { setError(text(rtl, "Please select employee and date", "اختر الموظف والتاريخ")); return; }
    try {
      setBusy(true); setError("");
      await call(rtl, undefined, { action: "save_entry", entry: { id: row?.id, ...form, breakDurationMinutes: form.breakDurationMinutes === "" ? undefined : Number(form.breakDurationMinutes) } });
      notify(text(rtl, "Entry saved and calculated", "تم حفظ السجل وحسابه"));
      onSaved();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };
  const timeInput = (key: "scheduledStart" | "scheduledEnd" | "actualStart" | "actualEnd", label: string, clears?: boolean) =>
    <label className="ts-field"><span>{label}</span><input type="time" dir="ltr" value={form[key]} onChange={event => set({ [key]: event.target.value, ...(clears && event.target.value ? { isAbsent: false } : {}) })} /></label>;
  return <Modal rtl={rtl} onClose={onClose} title={editing ? text(rtl, "Edit Timesheet Entry", "تعديل سجل الدوام") : text(rtl, "Add Timesheet Entry", "إضافة سجل دوام")}
    subtitle={editing ? `${rtl ? row?.employee_name_ar || row?.employee_name : row?.employee_name} · ${formatDay(row?.work_date, rtl)}` : undefined}
    footer={<><button type="button" className="outline" onClick={onClose}>{text(rtl, "Cancel", "إلغاء")}</button><button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? text(rtl, "Saving...", "جارٍ الحفظ...") : text(rtl, "Save & Calculate", "حفظ وحساب")}</button></>}>
    <div className="ts-form">
      <label className="ts-field wide"><span>{text(rtl, "Employee", "الموظف")} *</span><EmployeeCombobox rtl={rtl} employees={employees} value={form.employeeId} onChange={id => set({ employeeId: id })} disabled={editing} /></label>
      <label className="ts-field"><span>{text(rtl, "Date", "التاريخ")} *</span><input type="date" dir="ltr" value={form.workDate} disabled={editing} onChange={event => set({ workDate: event.target.value })} /></label>
      <label className="ts-field"><span>{text(rtl, "Break duration (minutes)", "مدة الاستراحة (دقيقة)")}</span><input type="number" min={0} max={600} dir="ltr" value={form.breakDurationMinutes} onChange={event => set({ breakDurationMinutes: event.target.value })} /></label>
      {timeInput("scheduledStart", text(rtl, "Scheduled start", "بداية الدوام"))}
      {timeInput("scheduledEnd", text(rtl, "Scheduled end", "نهاية الدوام"))}
      {timeInput("actualStart", text(rtl, "Actual start", "الحضور الفعلي"), true)}
      {timeInput("actualEnd", text(rtl, "Actual end", "الانصراف الفعلي"), true)}
      <label className="ts-check wide"><input type="checkbox" checked={form.isAbsent} onChange={event => set({ isAbsent: event.target.checked, ...(event.target.checked ? { actualStart: "", actualEnd: "" } : {}) })} /><span>{text(rtl, "Absent", "غائب")}</span></label>
      {form.isAbsent && <label className="ts-field wide"><span>{text(rtl, "Absence reason", "سبب الغياب")}</span><input value={form.absenceReason} maxLength={300} onChange={event => set({ absenceReason: event.target.value })} /></label>}
      <label className="ts-field wide"><span>{text(rtl, "Notes", "ملاحظات")}</span><textarea rows={3} maxLength={1000} value={form.notes} onChange={event => set({ notes: event.target.value })} /></label>
      {hint && <p className="ts-hint wide" role="status">{hint}</p>}
      {error && <p className="ts-error wide" role="alert">{error}</p>}
    </div>
  </Modal>;
}

// ---------- Recalculate ----------

export function RecalculateDialog({ rtl, scope, busy, onConfirm, onClose }: { rtl: boolean; scope: string; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return <Modal rtl={rtl} onClose={onClose} title={text(rtl, "Recalculate Timesheet", "إعادة حساب كشف الدوام")}
    footer={<><button type="button" className="outline" onClick={onClose} disabled={busy}>{text(rtl, "Cancel", "إلغاء")}</button><button type="button" className="primary" disabled={busy} onClick={onConfirm}>{busy ? text(rtl, "Recalculating...", "جارٍ إعادة الحساب...") : text(rtl, "Confirm Recalculate", "تأكيد إعادة الحساب")}</button></>}>
    <p>{text(rtl, "Recalculate timesheet for selected filter", "إعادة حساب كشف الدوام حسب عوامل التصفية المحددة")}</p>
    <p className="ts-hint">{scope}</p>
    <p className="ts-hint">{text(rtl, "Manual time changes, approved requests, notes, notice status and manual absence decisions are kept. Confirmed months and locked payroll periods are skipped.", "تبقى التعديلات اليدوية والطلبات المعتمدة والملاحظات وحالة الإشعار وقرارات الغياب اليدوية كما هي، ويتم تخطي الأشهر المعتمدة وفترات الرواتب المقفلة.")}</p>
  </Modal>;
}

// ---------- Manager note ----------

export function NoteDialog({ rtl, row, canWrite, onClose, onSaved, notify }: { rtl: boolean; row: Row; canWrite: boolean; onClose: () => void; onSaved: () => void; notify: Notify }) {
  const [note, setNote] = useState(String(row.manager_note ?? "")), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const save = async () => {
    try { setBusy(true); setError(""); await call(rtl, undefined, { action: "save_note", id: row.id, note }); notify(text(rtl, "Note saved", "تم حفظ الملاحظة")); onSaved(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };
  return <Modal rtl={rtl} onClose={onClose} title={text(rtl, "Manager Note", "ملاحظة المدير")} subtitle={`${rtl ? row.employee_name_ar || row.employee_name : row.employee_name} · ${formatDay(row.work_date, rtl)}`}
    footer={<><button type="button" className="outline" onClick={onClose}>{text(rtl, "Close", "إغلاق")}</button>{canWrite && <button type="button" className="primary" disabled={busy} onClick={() => void save()}>{text(rtl, "Save", "حفظ")}</button>}</>}>
    <label className="ts-field"><span>{text(rtl, "Note", "الملاحظة")}</span><textarea rows={5} maxLength={1000} readOnly={!canWrite} value={note} placeholder={text(rtl, "Add your note here...", "اكتب ملاحظتك هنا...")} onChange={event => setNote(event.target.value)} /></label>
    {row.manager_note_by_name && <p className="ts-hint">{text(rtl, "Last note by", "آخر ملاحظة بواسطة")} {String(rtl ? row.manager_note_by_name_ar || row.manager_note_by_name : row.manager_note_by_name)}</p>}
    {error && <p className="ts-error" role="alert">{error}</p>}
  </Modal>;
}

// ---------- Deduction details ----------

export function DeductionDetailsDialog({ rtl, row, onClose }: { rtl: boolean; row: Row; onClose: () => void }) {
  const parts = components(row);
  return <Modal rtl={rtl} onClose={onClose} title={text(rtl, "Deduction Details", "تفاصيل الخصم")} subtitle={`${rtl ? row.employee_name_ar || row.employee_name : row.employee_name} · ${formatDay(row.work_date, rtl)}`}
    footer={<button type="button" className="outline" onClick={onClose}>{text(rtl, "Close", "إغلاق")}</button>}>
    {parts.length ? <div className="ts-table-wrap"><table className="ts-table compact"><thead><tr><th>{text(rtl, "Type", "النوع")}</th><th>{text(rtl, "Rule", "القاعدة")}</th><th>{text(rtl, "Minutes", "الدقائق")}</th><th>{text(rtl, "Days of wage", "أيام الأجر")}</th><th>{text(rtl, "Amount", "المبلغ")}</th></tr></thead>
      <tbody>{parts.map((part, index) => <tr key={index}><td>{kindLabel(part.kind, rtl)}</td><td>{componentRuleName(part, rtl) || "—"}</td><td>{part.kind === "absence" ? "—" : hoursText(part.minutes, rtl)}</td><td>{num(part.wageDays) ? formatNumber(part.wageDays, rtl, 2) : "—"}</td><td><b>{formatMoney(part.amount, rtl)}</b></td></tr>)}</tbody>
      <tfoot><tr><td colSpan={4}>{text(rtl, "Total", "الإجمالي")}</td><td><b>{formatMoney(row.deduction_amount, rtl)}</b></td></tr></tfoot></table></div>
      : <p>{text(rtl, "No deduction applies to this day.", "لا ينطبق أي خصم على هذا اليوم.")}</p>}
    {num(row.overtime_amount) > 0 && <p className="ts-hint">{text(rtl, "Overtime pay", "أجر العمل الإضافي")}: {formatMoney(row.overtime_amount, rtl)}</p>}
  </Modal>;
}

// ---------- Naughty corner drilldown ----------

export function NaughtyDrilldown({ rtl, employee, rows, onClose }: { rtl: boolean; employee: Row; rows: Row[]; onClose: () => void }) {
  const records = lateRecords(rows, Number(employee.employee_id));
  return <Modal rtl={rtl} wide onClose={onClose} title={String(rtl ? employee.employee_name_ar || employee.employee_name : employee.employee_name)} subtitle={text(rtl, "Late records in the selected period", "سجلات التأخير في الفترة المحددة")}
    footer={<button type="button" className="outline" onClick={onClose}>{text(rtl, "Close", "إغلاق")}</button>}>
    <div className="ts-table-wrap"><table className="ts-table compact"><thead><tr><th>{text(rtl, "Date", "التاريخ")}</th><th>{text(rtl, "Scheduled start", "بداية الدوام")}</th><th>{text(rtl, "Actual start", "الحضور الفعلي")}</th><th>{text(rtl, "Minutes", "الدقائق")}</th><th>{text(rtl, "Rule", "القاعدة")}</th></tr></thead>
      <tbody>{records.map(record => <tr key={String(record.id)}><td>{formatDay(record.work_date, rtl)}</td><td dir="ltr">{String(record.scheduled_start ?? "—")}</td><td dir="ltr">{String(record.actual_start ?? "—")}</td><td>{formatNumber(record.late_minutes, rtl)}</td><td>{String((rtl ? record.rule_ar || record.rule_en : record.rule_en || record.rule_ar) ?? "—")}</td></tr>)}</tbody></table></div>
  </Modal>;
}

// ---------- Deduction summary report ----------

export function DeductionSummaryDialog({ rtl, rows, period, onPrint, onClose, notify }: { rtl: boolean; rows: Row[]; period: string; onPrint: () => void; onClose: () => void; notify: Notify }) {
  const { employees, grand } = useMemo(() => deductionSummary(rows), [rows]);
  const print = () => { if (!employees.length) { notify(text(rtl, "No deductions to print", "لا توجد خصومات للطباعة")); return; } onPrint(); };
  return <Modal rtl={rtl} wide onClose={onClose} title={text(rtl, "Deduction Summary", "ملخص الخصومات")} subtitle={period}
    footer={<><button type="button" className="outline" onClick={print}><Printer size={16} />{text(rtl, "Print", "طباعة")}</button><button type="button" className="outline" onClick={onClose}>{text(rtl, "Close", "إغلاق")}</button></>}>
    {employees.length ? <DeductionSummaryTable rtl={rtl} employees={employees} grand={grand} /> : <p>{text(rtl, "No deductions in this period.", "لا توجد خصومات في هذه الفترة.")}</p>}
  </Modal>;
}

export function DeductionSummaryTable({ rtl, employees, grand }: { rtl: boolean; employees: ReturnType<typeof deductionSummary>["employees"]; grand: ReturnType<typeof deductionSummary>["grand"] }) {
  return <div className="ts-table-wrap"><table className="ts-table compact"><thead><tr>
    <th>{text(rtl, "Employee", "الموظف")}</th><th>{text(rtl, "Late Count", "عدد التأخيرات")}</th><th>{text(rtl, "Total Delay Min", "إجمالي دقائق التأخير")}</th><th>{text(rtl, "Early Leave Count", "عدد الانصراف المبكر")}</th><th>{text(rtl, "Total Early Leave Min", "إجمالي دقائق الانصراف المبكر")}</th>
    <th>{text(rtl, "Absent (with notice)", "غياب بإشعار")}</th><th>{text(rtl, "Absent (without notice)", "غياب بدون إشعار")}</th><th>{text(rtl, "Absent (unset)", "غياب غير محدد")}</th><th>{text(rtl, "Total Deduction", "إجمالي الخصم")}</th></tr></thead>
    <tbody>{employees.map(line => <tr key={line.employee_id}><td><b>{rtl ? line.employee_name_ar || line.employee_name : line.employee_name}</b><small>{line.employee_code}</small></td><td>{formatNumber(line.lateCount, rtl)}</td><td>{formatNumber(line.delayMinutes, rtl)}</td><td>{formatNumber(line.earlyCount, rtl)}</td><td>{formatNumber(line.earlyMinutes, rtl)}</td>
      <td>{formatNumber(line.absentWithNotice, rtl)}</td><td>{formatNumber(line.absentWithoutNotice, rtl)}</td><td>{line.absentUnset ? <Badge tone="amber">{formatNumber(line.absentUnset, rtl)}</Badge> : "0"}</td><td><b>{formatMoney(line.totalDeduction, rtl)}</b></td></tr>)}</tbody>
    <tfoot><tr><td>{text(rtl, "Grand Total", "الإجمالي العام")}</td><td>{formatNumber(grand.lateCount, rtl)}</td><td>{formatNumber(grand.delayMinutes, rtl)}</td><td>{formatNumber(grand.earlyCount, rtl)}</td><td>{formatNumber(grand.earlyMinutes, rtl)}</td><td>{formatNumber(grand.absentWithNotice, rtl)}</td><td>{formatNumber(grand.absentWithoutNotice, rtl)}</td><td>{formatNumber(grand.absentUnset, rtl)}</td><td><b>{formatMoney(grand.totalDeduction, rtl)}</b></td></tr></tfoot></table></div>;
}

// ---------- Payroll deductions ----------

export function PayrollDialog({ rtl, monthKey, country, canEdit, isMaster, onClose, notify, onChanged }: { rtl: boolean; monthKey: string | null; country: string; canEdit: boolean; isMaster: boolean; onClose: () => void; notify: Notify; onChanged: () => void }) {
  const [periods, setPeriods] = useState<Row[] | null>(null), [view, setView] = useState<Row | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = async () => { try { setPeriods(((await call(rtl, { view: "payroll_periods" })).periods as Row[]) ?? []); } catch (cause) { setError(errorText(cause)); setPeriods([]); } };
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const act = async (body: Row, done: string) => { try { setBusy(true); setError(""); await call(rtl, undefined, body); notify(done); await load(); onChanged(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  const open = async (period: Row) => { try { setError(""); setView(await call(rtl, { view: "payroll_period", month: String(period.period_key), country: String(period.payroll_country) })); } catch (cause) { setError(errorText(cause)); } };
  const canSend = canEdit && Boolean(monthKey) && (country === "Egypt" || country === "KSA");
  return <Modal rtl={rtl} wide onClose={onClose} title={text(rtl, "Payroll Deductions", "خصومات الرواتب")} subtitle={text(rtl, "Deductions sent to payroll", "الخصومات المرسلة إلى الرواتب")}
    footer={<><button type="button" className="primary" disabled={busy || !canSend} title={canSend ? undefined : text(rtl, "Choose Full Month and a payroll country first", "اختر شهرًا كاملًا ودولة الرواتب أولًا")} onClick={() => void act({ action: "send_to_payroll", month: monthKey, country }, text(rtl, "Deductions sent to payroll", "تم إرسال الخصومات إلى الرواتب"))}><Send size={16} />{text(rtl, `Send ${monthKey ?? ""} ${country} to payroll`, `إرسال ${monthKey ?? ""} ${country === "KSA" ? "السعودية" : country === "Egypt" ? "مصر" : ""} إلى الرواتب`)}</button><button type="button" className="outline" onClick={onClose}>{text(rtl, "Close", "إغلاق")}</button></>}>
    {error && <p className="ts-error" role="alert">{error}</p>}
    {periods === null ? <p>{text(rtl, "Loading...", "جارٍ التحميل...")}</p> : !periods.length ? <p>{text(rtl, "No month has been sent to payroll yet.", "لم يتم إرسال أي شهر إلى الرواتب بعد.")}</p>
      : <div className="ts-table-wrap"><table className="ts-table compact"><thead><tr><th>{text(rtl, "Month", "الشهر")}</th><th>{text(rtl, "Country", "الدولة")}</th><th>{text(rtl, "Period", "الفترة")}</th><th>{text(rtl, "Employees", "الموظفون")}</th><th>{text(rtl, "Delay", "التأخير")}</th><th>{text(rtl, "Absence", "الغياب")}</th><th>{text(rtl, "Status", "الحالة")}</th><th /></tr></thead>
        <tbody>{periods.map(period => <tr key={`${period.period_key}-${period.payroll_country}`}><td><b>{String(period.period_key)}</b></td><td>{String(period.payroll_country)}</td><td dir="ltr">{String(period.from)} → {String(period.to)}</td><td>{formatNumber(period.employees_count, rtl)}</td><td>{formatMoney(period.delay_total, rtl)}</td><td>{formatMoney(period.absence_total, rtl)}</td>
          <td>{Number(period.locked) ? <Badge tone="red"><Lock size={12} /> {text(rtl, "Locked", "مقفل")}</Badge> : <Badge tone="green">{text(rtl, "Sent", "مرسل")}</Badge>}</td>
          <td className="ts-actions-cell"><button type="button" className="outline" onClick={() => void open(period)}>{text(rtl, "View", "عرض")}</button>
            {Number(period.locked) ? isMaster && <button type="button" className="outline" disabled={busy} onClick={() => void act({ action: "set_payroll_lock", month: period.period_key, country: period.payroll_country, locked: false }, text(rtl, "Payroll month unlocked", "تم فتح شهر الرواتب"))}><Unlock size={14} />{text(rtl, "Unlock", "فتح")}</button>
              : canEdit && <button type="button" className="outline" disabled={busy} onClick={() => void act({ action: "set_payroll_lock", month: period.period_key, country: period.payroll_country, locked: true }, text(rtl, "Payroll month locked", "تم قفل شهر الرواتب"))}><Lock size={14} />{text(rtl, "Lock", "قفل")}</button>}
            {isMaster&&!Number(period.locked)&&<button type="button" className="outline" disabled={busy} onClick={() => { if(window.confirm(text(rtl,"Roll back these payroll deductions?","هل تريد التراجع عن خصومات الرواتب؟")))void act({action:"rollback_payroll_period",month:period.period_key,country:period.payroll_country},text(rtl,"Payroll deductions rolled back","تم التراجع عن خصومات الرواتب")); }}>{text(rtl,"Rollback","تراجع")}</button>}</td></tr>)}</tbody></table></div>}
    {view && <section className="ts-subsection"><h3>{text(rtl, "Month", "الشهر")} {String(view.periodKey)} · {String(view.country)}</h3>
      <div className="ts-table-wrap"><table className="ts-table compact"><thead><tr><th>{text(rtl, "Employee", "الموظف")}</th><th>{text(rtl, "Delay min", "دقائق التأخير")}</th><th>{text(rtl, "Delay amount", "مبلغ التأخير")}</th><th>{text(rtl, "Absence days", "أيام الغياب")}</th><th>{text(rtl, "Absence amount", "مبلغ الغياب")}</th><th>{text(rtl, "Overtime amount", "مبلغ الإضافي")}</th></tr></thead>
        <tbody>{((view.entries as Row[]) ?? []).map(entry => <tr key={String(entry.employee_id)}><td><b>{String(rtl ? entry.employee_name_ar || entry.employee_name : entry.employee_name)}</b><small>{String(entry.employee_code)}</small></td><td>{formatNumber(entry.delay_minutes, rtl)}</td><td>{formatMoney(entry.delay_amount, rtl)}</td><td>{formatNumber(entry.absence_days, rtl)}</td><td>{formatMoney(entry.absence_amount, rtl)}</td><td>{formatMoney(entry.overtime_amount, rtl)}</td></tr>)}</tbody></table></div></section>}
  </Modal>;
}
