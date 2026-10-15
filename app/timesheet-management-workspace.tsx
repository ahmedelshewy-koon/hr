"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BadgeMinus, CalendarCheck, CalendarDays, CheckCircle2, Clock3, Download, FileText, Home, Hourglass, Lock, LogOut, Mail, Pencil, Plane, Plus, Printer, RefreshCw, StickyNote, Timer, Unlock, UserX, Wallet, Calculator, Trophy, XCircle } from "lucide-react";
import type { Row } from "./ui-types";
import "./timesheet-management.css";
import { Badge, EmployeeCombobox, ApiError, call, departmentOptions, formatDay, formatMoney, formatNumber, readSession, writeSession, type DepartmentNode, type PickerEmployee } from "./timesheet/ui/common";
import { DeductionDetailsDialog, DeductionSummaryDialog, EntryDialog, NaughtyDrilldown, NoteDialog, PayrollDialog, RecalculateDialog } from "./timesheet/ui/dialogs";
import { PrintView, type PrintMode } from "./timesheet/ui/print";
import { hoursText, isNoShift, noticeLabel, num, rowStatusLabel, wfhExtraHours } from "./timesheet/labels";
import { filterByCard, summarize, type CardKey } from "./timesheet/summary";
import { monthKeyOf, periodForMonth } from "./timesheet/time";
import { filterSortTimesheetRows, TIMESHEET_SORT_FIELDS } from "./timesheet/grid";

type Filters = { mode: "date" | "range" | "month"; date: string; from: string; to: string; month: string; departmentId: number; country: string; employeeId: number };
const STORE = "timesheet-management-filters";
const todayCairo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const initialFilters = (): Filters => {
  const today = todayCairo();
  return readSession<Filters>(STORE, { mode: "month", date: today, from: today.slice(0, 8) + "01", to: today, month: monthKeyOf(today), departmentId: 0, country: "default", employeeId: 0 });
};
const query = (f: Filters) => ({ mode: f.mode, date: f.date, from: f.from, to: f.to, month: f.month, departmentId: f.departmentId || "", country: f.country, employeeId: f.employeeId || "" });

const statusTone = (row: Row): "green" | "amber" | "red" | "blue" | "gray" | "violet" => {
  const s = String(row.status);
  if (s === "approved") return "green";
  if (s === "absent" || s === "rejected") return "red";
  if (s === "waiting_for_exit" || s === "pending") return "amber";
  if (s === "wfh") return "blue";
  if (s === "vacation") return "violet";
  return "gray";
};

export function TimesheetWorkspace({ rtl, notify }: { rtl: boolean; notify: (message: string) => void }) {
  const t = (en: string, ar: string) => (rtl ? ar : en);
  const sortLabel=(key:string)=>({work_date:t("Date","التاريخ"),employee_name:t("Employee","الموظف"),department_name:t("Department","القسم"),status:t("Status","الحالة"),late_minutes:t("Late minutes","دقائق التأخير"),early_leave_minutes:t("Early leave","الانصراف المبكر"),overtime_minutes:t("Overtime","الإضافي"),deduction_amount:t("Deduction","الخصم")}[key]||key);
  const [filters, setFilters] = useState<Filters>(() => ({ mode: "month", date: "", from: "", to: "", month: "", departmentId: 0, country: "default", employeeId: 0 }));
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Row | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [card, setCard] = useState<CardKey | null>(null);
  const [search,setSearch]=useState(""),[firstSort,setFirstSort]=useState("work_date"),[secondSort,setSecondSort]=useState("employee_name"),[sortDescending,setSortDescending]=useState(true);
  const [entry, setEntry] = useState<{ row: Row | null } | null>(null), [recalc, setRecalc] = useState(false), [recalcBusy, setRecalcBusy] = useState(false);
  const [note, setNote] = useState<Row | null>(null), [details, setDetails] = useState<Row | null>(null), [drill, setDrill] = useState<Row | null>(null);
  const [showDeductions, setShowDeductions] = useState(false), [showPayroll, setShowPayroll] = useState(false), [printMode, setPrintMode] = useState<PrintMode | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  useEffect(() => { const saved = initialFilters(); const timer = window.setTimeout(() => { setFilters(saved); setReady(true); }, 0); return () => window.clearTimeout(timer); }, []);

  const load = useCallback(async (next: Filters) => {
    const request = ++latest.current;
    setLoading(true);
    try {
      const payload = await call(rtl, query(next));
      if (request !== latest.current) return;
      setData(payload); setError("");
      const resolved = String((payload.filters as Row).country ?? "");
      if (next.country === "default") { const settled = { ...next, country: resolved }; setFilters(settled); writeSession(STORE, settled); }
    } catch (cause) {
      if (request !== latest.current) return;
      setError(cause instanceof ApiError || cause instanceof Error ? cause.message : String(cause));
    } finally { if (request === latest.current) setLoading(false); }
  }, [rtl]);

  const invalid = (f: Filters) => f.mode === "date" ? (!f.date ? t("Please select a date", "اختر التاريخ") : "") : f.mode === "range" ? (!f.from || !f.to || f.from > f.to ? t("Select a valid period", "اختر فترة صحيحة") : "") : (!f.month ? t("Select a valid month", "اختر شهرًا صحيحًا") : "");
  useEffect(() => { if (ready && !invalid(filters)) { const timer = window.setTimeout(() => void load(filters), 0); return () => window.clearTimeout(timer); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ready, filters, load]);

  const update = (patch: Partial<Filters>) => { setCard(null); setFilters(current => { const next = { ...current, ...patch }; if ("country" in patch || "departmentId" in patch) next.employeeId = 0; writeSession(STORE, next); return next; }); };
  const refresh = () => void load(filters);
  const access = (data?.access ?? {}) as Row;
  const rows = useMemo(() => (data?.rows as Row[]) ?? [], [data]);
  const searched=useMemo(()=>filterSortTimesheetRows(rows,{search}),[rows,search]);
  const shown = useMemo(() => filterSortTimesheetRows(filterByCard(searched, card),{first:firstSort,second:secondSort,descending:sortDescending}), [searched, card, firstSort, secondSort, sortDescending]);
  const summary = useMemo(()=>summarize(searched),[searched]);
  const totals = useMemo(() => summarize(shown), [shown]);
  const employees = (data?.employees as PickerEmployee[]) ?? [];
  const departments = useMemo(() => departmentOptions(((data?.departments as DepartmentNode[]) ?? []), rtl), [data, rtl]);
  const month = (data?.month ?? {}) as Row;
  const period = (data?.period ?? {}) as Row;
  const editPerms = ((data?.editPermissions as Row[]) ?? []);
  const periodText = period.from ? `${formatDay(period.from, rtl)} → ${formatDay(period.to, rtl)}` : "";
  const scope = [periodText, filters.country && (filters.country === "KSA" ? t("KSA", "السعودية") : t("Egypt", "مصر")), departments.find(d => d.id === filters.departmentId)?.label.replace(/[\u00A0\u2514 ]/g, ""), employees.find(e => e.id === filters.employeeId)?.name_en];

  const run = async (body: Row, done: string) => {
    try { setBusy(true); await call(rtl, undefined, body); notify(done); await load(filters); } catch (cause) { notify(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  };
  const doRecalc = async () => {
    try { setRecalcBusy(true); const result = await call(rtl, undefined, { action: "recalculate", ...query(filters) }); const s = result.summary as Row; notify(t(`Recalculated ${s.days} days (${s.skippedLocked} locked days skipped)`, `تمت إعادة حساب ${s.days} يومًا (تم تخطي ${s.skippedLocked} يومًا مقفلًا)`)); setRecalc(false); await load(filters); }
    catch (cause) { notify(cause instanceof Error ? cause.message : String(cause)); } finally { setRecalcBusy(false); }
  };
  const sendMails = async () => {
    if (!window.confirm(t("Send deduction e-mails to the employees in this view?", "إرسال رسائل الخصم إلى الموظفين المعروضين؟"))) return;
    try {
      setBusy(true); const r = await call(rtl, undefined, { action: "send_deduction_mails", ...query(filters) });
      if (!r.configured) notify(t("Mail service is not configured (MAIL_API_URL, MAIL_API_KEY, MAIL_FROM)", "خدمة البريد غير مُعدّة (MAIL_API_URL و MAIL_API_KEY و MAIL_FROM)"));
      else notify(t(`Mail sent to ${r.sent} employees${(r.failed as Row[]).length ? `, ${(r.failed as Row[]).length} failed` : ""}${(r.noEmail as string[]).length ? `, ${(r.noEmail as string[]).length} without e-mail` : ""}`, `تم إرسال البريد إلى ${r.sent} موظف${(r.failed as Row[]).length ? `، فشل ${(r.failed as Row[]).length}` : ""}`));
      await load(filters);
    } catch (cause) { notify(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  };
  const exportExcel = () => {
    if (!shown.length) { notify(t("No data to export", "لا توجد بيانات للتصدير")); return; }
    const params = new URLSearchParams(Object.entries({ ...query(filters), format: "xlsx", lang: rtl ? "ar" : "en", card: card ?? "", search, firstSort, secondSort, descending:sortDescending?"1":"0" }).filter(([, v]) => v !== "" && v !== undefined).map(([k, v]) => [k, String(v)]));
    window.location.assign(`/api/timesheet-management?${params}`);
  };
  const monthMode = filters.mode === "month";
  const confirmed = Boolean(month.confirmed);

  const cards: { key: CardKey | "total"; icon: typeof Clock3; label: string; value: string; sub?: string; tone: string }[] = [
    { key: "total", icon: FileText, label: t("Total Entries", "إجمالي السجلات"), value: formatNumber(summary.total, rtl), tone: "gray" },
    { key: "approved", icon: CheckCircle2, label: t("Approved", "معتمد"), value: formatNumber(summary.approved, rtl), tone: "green" },
    { key: "waiting", icon: Hourglass, label: t("Waiting for Exit / Pending", "بانتظار الانصراف / قيد المراجعة"), value: formatNumber(summary.waiting, rtl), tone: "amber" },
    { key: "absent", icon: UserX, label: t("Absent Days", "أيام الغياب"), value: formatNumber(summary.absent, rtl), tone: "red" },
    { key: "late", icon: Clock3, label: t("Late", "التأخير"), value: formatNumber(summary.lateCount, rtl), sub: `${t("Total Late (min)", "إجمالي التأخير (د)")}: ${formatNumber(summary.lateMinutes, rtl)}`, tone: "amber" },
    { key: "early", icon: LogOut, label: t("Early Leave", "الانصراف المبكر"), value: formatNumber(summary.earlyCount, rtl), sub: `${t("Total Early Leave Min", "إجمالي دقائق الانصراف المبكر")}: ${formatNumber(summary.earlyMinutes, rtl)}`, tone: "amber" },
    { key: "overtime", icon: Timer, label: t("Overtime", "العمل الإضافي"), value: formatNumber(summary.overtimeCount, rtl), sub: `${formatNumber(summary.overtimeMinutes, rtl)} ${t("min", "د")}`, tone: "green" },
    { key: "vacation", icon: Plane, label: t("Vacation", "إجازة"), value: formatNumber(summary.vacation, rtl), tone: "violet" },
    { key: "holiday", icon: CalendarDays, label: t("Holiday", "عطلة رسمية"), value: formatNumber(summary.holiday, rtl), tone: "gray" },
    { key: "wfh", icon: Home, label: t("Work From Home", "عمل من المنزل"), value: formatNumber(summary.wfh, rtl), tone: "blue" },
  ];

  const rowActions = (row: Row) => {
    const pending = ["pending", "waiting_for_exit"].includes(String(row.status));
    const monthKey = monthKeyOf(String(row.work_date));
    const hasPermission = editPerms.some(p => p.employee_id === row.employee_id && p.month_key === monthKey);
    return <div className="ts-row-actions">
      {row.editable && <button type="button" className="ts-icon-button" title={t("Edit", "تعديل")} aria-label={t("Edit", "تعديل")} onClick={() => setEntry({ row })}><Pencil size={15} /></button>}
      {row.editable && pending && <><button type="button" className="ts-icon-button ok" title={t("Approve", "اعتماد")} aria-label={t("Approve", "اعتماد")} disabled={busy} onClick={() => void run({ action: "decide", id: row.id, decision: "approve" }, t("Entry approved", "تم اعتماد السجل"))}><CheckCircle2 size={15} /></button>
        <button type="button" className="ts-icon-button bad" title={t("Reject", "رفض")} aria-label={t("Reject", "رفض")} disabled={busy} onClick={() => void run({ action: "decide", id: row.id, decision: "reject" }, t("Entry rejected", "تم رفض السجل"))}><XCircle size={15} /></button></>}
      <button type="button" className="ts-icon-button" title={t("Manager Note", "ملاحظة المدير")} aria-label={t("Manager Note", "ملاحظة المدير")} onClick={() => setNote(row)}><StickyNote size={15} className={row.manager_note ? "filled" : ""} /></button>
      {(num(row.deduction_amount) > 0 || num(row.overtime_amount) > 0) && <button type="button" className="ts-icon-button" title={t("Deduction Details", "تفاصيل الخصم")} aria-label={t("Deduction Details", "تفاصيل الخصم")} onClick={() => setDetails(row)}><BadgeMinus size={15} /></button>}
      {row.can_open_edit && (row.lock === "month"
        ? <button type="button" className="ts-icon-button" title={t("Open edit", "فتح التعديل")} aria-label={t("Open edit", "فتح التعديل")} disabled={busy} onClick={() => void run({ action: "set_edit_permission", month: monthKey, employeeId: row.employee_id, active: true }, t("Edit opened for employee", "تم فتح التعديل للموظف"))}><Unlock size={15} /></button>
        : hasPermission && <button type="button" className="ts-icon-button" title={t("Close edit", "إغلاق التعديل")} aria-label={t("Close edit", "إغلاق التعديل")} disabled={busy} onClick={() => void run({ action: "set_edit_permission", month: monthKey, employeeId: row.employee_id, active: false }, t("Edit closed for employee", "تم إغلاق التعديل للموظف"))}><Lock size={15} /></button>)}
    </div>;
  };

  return <section className="ts-page" dir={rtl ? "rtl" : "ltr"} aria-labelledby="ts-title">
    <header className="ts-head">
      <div><small>{t("TIME & PAYROLL", "الدوام والرواتب")}</small><h1 id="ts-title">{t("Timesheet Management", "إدارة كشوف الدوام")}</h1>
        <p>{t("Daily timesheets built from punches, shifts, holidays, leave and work-from-home, with deductions, approval and month lock.", "كشوف الدوام اليومية المبنية على البصمات والورديات والعطلات والإجازات والعمل من المنزل، مع الخصومات والاعتماد وقفل الشهر.")}</p></div>
      <div className="ts-toolbar" role="toolbar" aria-label={t("Timesheet actions", "إجراءات كشف الدوام")}>
        <button type="button" className="outline" onClick={refresh} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />{t("Refresh", "تحديث")}</button>
        {access.canEdit && <button type="button" className="primary" onClick={() => setEntry({ row: null })}><Plus size={16} />{t("Add Entry", "إضافة سجل")}</button>}
        {access.canEdit && <button type="button" className="outline" onClick={() => setRecalc(true)}><Calculator size={16} />{t("Recalculate", "إعادة الحساب")}</button>}
        <button type="button" className="outline" onClick={() => setShowDeductions(true)}><BadgeMinus size={16} />{t("Deduction Summary", "ملخص الخصومات")}</button>
        <button type="button" className="outline" onClick={() => setShowPayroll(true)}><Wallet size={16} />{t("Payroll Deductions", "خصومات الرواتب")}</button>
        {access.canEdit && <button type="button" className="outline" disabled={busy} onClick={() => void sendMails()}><Mail size={16} />{t("Send Deduction Mails", "إرسال رسائل الخصم")}</button>}
        {access.canEdit && <button type="button" className="outline" disabled={busy || !monthMode || confirmed} title={monthMode ? undefined : t("Choose Full Month", "اختر شهرًا كاملًا")} onClick={() => void run({ action: "confirm_month", month: filters.month, country: filters.country }, t("Month confirmed and editing locked", "تم اعتماد الشهر وقفل التعديل"))}><CalendarCheck size={16} />{t("Confirm Month", "اعتماد الشهر")}</button>}
        {access.isMaster && <button type="button" className="outline" disabled={busy || !monthMode || !month.anyConfirmed} onClick={() => void run({ action: "unlock_month", month: filters.month, country: filters.country }, t("Month editing unlocked", "تم فتح تعديل الشهر"))}><Unlock size={16} />{t("Unlock Edit", "فتح التعديل")}</button>}
        <button type="button" className="outline" onClick={exportExcel}><Download size={16} />{t("Export Excel", "تصدير Excel")}</button>
        <button type="button" className="outline" onClick={() => shown.length ? setPrintMode("grid") : notify(t("No records found", "لا توجد سجلات"))}><Printer size={16} />{t("Print", "طباعة")}</button>
      </div>
    </header>

    <div className="panel ts-filters">
      <label className="ts-field"><span>{t("Filter By", "التصفية حسب")}</span><select value={filters.mode} onChange={event => update({ mode: event.target.value as Filters["mode"] })}><option value="date">{t("Specific Date", "تاريخ محدد")}</option><option value="range">{t("Date Range", "نطاق تاريخ")}</option><option value="month">{t("Full Month", "شهر كامل")}</option></select></label>
      {filters.mode === "date" && <label className="ts-field"><span>{t("Date", "التاريخ")}</span><input type="date" dir="ltr" value={filters.date} onChange={event => update({ date: event.target.value })} /></label>}
      {filters.mode === "range" && <><label className="ts-field"><span>{t("Date From", "من تاريخ")}</span><input type="date" dir="ltr" value={filters.from} onChange={event => update({ from: event.target.value })} /></label><label className="ts-field"><span>{t("Date To", "إلى تاريخ")}</span><input type="date" dir="ltr" value={filters.to} onChange={event => update({ to: event.target.value })} /></label></>}
      {filters.mode === "month" && <label className="ts-field"><span>{t("Month", "الشهر")}</span><input type="month" dir="ltr" value={filters.month} onChange={event => update({ month: event.target.value })} />{filters.month && <small>{formatDay(periodForMonth(filters.month).from, rtl)} → {formatDay(periodForMonth(filters.month).to, rtl)}</small>}</label>}
      <label className="ts-field"><span>{t("Department", "القسم")}</span><select value={filters.departmentId} onChange={event => update({ departmentId: Number(event.target.value) })}><option value={0}>{t("All Departments", "كل الأقسام")}</option>{departments.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
      <label className="ts-field"><span>{t("Payroll Country", "دولة الرواتب")}</span><select value={filters.country === "default" ? "" : filters.country} onChange={event => update({ country: event.target.value })}><option value="">{t("All Countries", "كل الدول")}</option><option value="Egypt">{t("Egypt", "مصر")}</option><option value="KSA">{t("KSA", "السعودية")}</option></select></label>
      <label className="ts-field"><span>{t("Employee", "الموظف")}</span><EmployeeCombobox rtl={rtl} employees={employees} value={filters.employeeId} onChange={id => update({ employeeId: id })} allowAll /></label>
    </div>
    <div className="panel ts-filters">
      <label className="ts-field"><span>{t("Search", "بحث")}</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder={t("Name, code, department or status", "الاسم أو الرمز أو القسم أو الحالة")}/></label>
      <label className="ts-field"><span>{t("First sort", "الترتيب الأول")}</span><select value={firstSort} onChange={event=>setFirstSort(event.target.value)}>{TIMESHEET_SORT_FIELDS.map(key=><option key={key} value={key}>{sortLabel(key)}</option>)}</select></label>
      <label className="ts-field"><span>{t("Second sort", "الترتيب الثاني")}</span><select value={secondSort} onChange={event=>setSecondSort(event.target.value)}><option value="">{t("None", "بدون")}</option>{TIMESHEET_SORT_FIELDS.filter(key=>key!==firstSort).map(key=><option key={key} value={key}>{sortLabel(key)}</option>)}</select></label>
      <button type="button" className="outline" onClick={()=>setSortDescending(value=>!value)}>{sortDescending?t("Descending", "تنازلي"):t("Ascending", "تصاعدي")}</button>
    </div>
    {invalid(filters) && <p className="ts-error" role="alert">{invalid(filters)}</p>}
    {error && <div className="ts-error-banner" role="alert"><strong>{t("Timesheet data could not be loaded", "تعذر تحميل بيانات كشوف الدوام")}</strong><span>{error}</span><button type="button" className="outline" onClick={refresh} disabled={loading}>{t("Retry", "إعادة المحاولة")}</button></div>}
    {confirmed && <p className="ts-banner"><Lock size={15} />{t("This month is confirmed: editing is locked except for employees with an open edit.", "هذا الشهر معتمد: التعديل مقفل إلا للموظفين الذين فُتح لهم التعديل.")}</p>}
    {Boolean(month.payrollLocked) && <p className="ts-banner bad"><Lock size={15} />{t("A payroll period in this range is locked; its days cannot change.", "توجد فترة رواتب مقفلة ضمن هذا النطاق؛ لا يمكن تغيير أيامها.")}</p>}

    <div className="ts-cards" role="group" aria-label={t("Summary", "الملخص")}>
      {cards.map(item => { const Icon = item.icon, key = item.key === "total" ? null : item.key; return <button key={item.key} type="button" className={`ts-card ${item.tone} ${card === key && key ? "active" : ""}`} disabled={!key} aria-pressed={Boolean(key && card === key)} onClick={() => key && setCard(card === key ? null : key)}>
        <span className="ts-card-icon"><Icon size={18} /></span><b>{item.value}</b><small>{item.label}</small>{item.sub && <em>{item.sub}</em>}</button>; })}
      <div className="ts-card red static"><span className="ts-card-icon"><BadgeMinus size={18} /></span><b>{formatMoney(summary.totalDeduction, rtl)}</b><small>{t("Total Deduction", "إجمالي الخصم")}</small></div>
      <div className="ts-card naughty"><span className="ts-card-icon"><Trophy size={18} /></span><small>{t("Naughty Corner", "ركن المتأخرين")}</small>
        {((data?.naughty as Row[]) ?? []).length ? <ol>{((data?.naughty as Row[]) ?? []).slice(0, 5).map(item => <li key={String(item.employee_id)}><button type="button" onClick={() => setDrill(item)}>{String(rtl ? item.employee_name_ar || item.employee_name : item.employee_name)}</button><span>{formatNumber(item.count, rtl)} · {formatNumber(item.minutes, rtl)} {t("min", "د")}</span></li>)}</ol> : <em>{t("No frequent offenders", "لا يوجد متأخرون متكررون")}</em>}</div>
    </div>
    {card && <p className="ts-hint">{t("Filtered by card.", "مفلتر حسب البطاقة.")} <button type="button" className="ts-link" onClick={() => setCard(null)}>{t("Clear", "إلغاء")}</button></p>}
    {Boolean(data?.truncated) && <p className="ts-error">{t("Too many records: narrow the filters to see all of them.", "عدد السجلات كبير: ضيّق عوامل التصفية لعرضها كلها.")}</p>}

    <div className="panel ts-grid-panel">
      <div className="ts-table-wrap"><table className="ts-table">
        <thead><tr><th>{t("Date", "التاريخ")}</th><th>{t("Employee", "الموظف")}</th><th>{t("Department", "القسم")}</th><th>{t("Scheduled", "الدوام")}</th><th>{t("Actual", "الفعلي")}</th><th>{t("Changed In / Out", "الحضور / الانصراف المعدّل")}</th><th>{t("Work Hours", "ساعات العمل")}</th><th>{t("Late (min)", "التأخير (د)")}</th><th>{t("Early Leave (min)", "الانصراف المبكر (د)")}</th><th>{t("Overtime (min)", "الإضافي (د)")}</th><th>{t("Status", "الحالة")}</th><th>{t("Absent", "غياب")}</th><th>{t("Notice Status", "حالة الإشعار")}</th><th>{t("Deduction", "الخصم")}</th><th>{t("Manager Note", "ملاحظة المدير")}</th><th>{t("Mail", "البريد")}</th><th>{t("Actions", "الإجراءات")}</th></tr></thead>
        <tbody>
          {shown.map(row => <tr key={String(row.id)} className={`s-${String(row.status)}`}>
            <td><b>{formatDay(row.work_date, rtl)}</b><small>{formatDay(row.work_date, rtl, { weekday: "short" })}</small></td>
            <td><b>{String(rtl ? row.employee_name_ar || row.employee_name : row.employee_name)}</b><small dir="ltr">{String(row.employee_code)}</small></td>
            <td>{String((rtl ? row.department_name_ar || row.department_name : row.department_name) ?? "—")}</td>
            <td dir="ltr">{row.scheduled_start ? `${row.scheduled_start} – ${row.scheduled_end}` : "—"}</td>
            <td dir="ltr">{row.actual_start || row.actual_end ? `${row.actual_start ?? "—"} – ${row.actual_end ?? "—"}` : "—"}</td>
            <td dir="ltr">{row.changed_start || row.changed_end ? <><span>{String(row.changed_start ?? "—")} – {String(row.changed_end ?? "—")}</span><small>{String(rtl ? row.changed_by_name_ar || row.changed_by_name : row.changed_by_name)} · {row.changed_at ? formatDay(String(row.changed_at).slice(0, 10), rtl) : ""}</small></> : "—"}</td>
            <td>{hoursText(row.total_work_minutes, rtl)}{wfhExtraHours(row) && <small>{t("WFH Extra Hours", "ساعات إضافية من المنزل")}</small>}</td>
            <td>{num(row.late_minutes) || "—"}</td><td>{num(row.early_leave_minutes) || "—"}</td><td>{num(row.overtime_minutes) || "—"}</td>
            <td><Badge tone={isNoShift(row) ? "gray" : statusTone(row)}>{rowStatusLabel(row, rtl)}</Badge></td>
            <td>{num(row.is_absent) ? <Badge tone="red">{t("Absent", "غائب")}</Badge> : "—"}</td>
            <td>{num(row.is_absent) ? (row.editable
              ? <select className="ts-notice" aria-label={t("Notice Status", "حالة الإشعار")} value={row.absence_has_notice === null ? "unset" : num(row.absence_has_notice) === 1 ? "with" : "without"} disabled={busy} onChange={event => void run({ action: "set_notice", id: row.id, notice: event.target.value }, t("Notice status updated", "تم تحديث حالة الإشعار"))}><option value="unset">{t("Unset", "غير محدد")}</option><option value="with">{t("With Notice", "بإشعار")}</option><option value="without">{t("Without Notice", "بدون إشعار")}</option></select>
              : noticeLabel(row, rtl)) : "—"}{num(row.is_absent) === 1 && row.absence_has_notice === null && <small className="warn">{t("Not charged until set", "لا يُخصم حتى يُحدد")}</small>}</td>
            <td>{num(row.deduction_amount) ? <><b>{formatMoney(row.deduction_amount, rtl)}</b><small>{String((rtl ? row.rule_ar || row.rule_en : row.rule_en || row.rule_ar) ?? "")}</small></> : "—"}</td>
            <td className="ts-note-cell">{row.manager_note ? String(row.manager_note) : "—"}</td>
            <td>{num(row.deduction_notification_sent) ? <Badge tone="green"><Mail size={12} /> {t("Mail Sent", "تم الإرسال")}</Badge> : "—"}</td>
            <td>{rowActions(row)}</td></tr>)}
          {!shown.length && <tr><td colSpan={17} className="ts-empty">{loading ? t("Loading...", "جارٍ التحميل...") : <>{t("No records found", "لا توجد سجلات")}{!rows.length && access.canEdit && <><br /><small>{t("Press Recalculate to build the timesheet for this filter.", "اضغط إعادة الحساب لبناء كشف الدوام لهذه التصفية.")}</small></>}</>}</td></tr>}
        </tbody>
        {shown.length > 0 && <tfoot><tr><td colSpan={6}>{t("Grand Total", "الإجمالي العام")} ({formatNumber(totals.total, rtl)})</td><td>{hoursText(totals.workMinutes, rtl)}</td><td>{formatNumber(totals.lateMinutes, rtl)}</td><td>{formatNumber(totals.earlyMinutes, rtl)}</td><td>{formatNumber(totals.overtimeMinutes, rtl)}</td><td colSpan={4} /><td>{formatMoney(totals.totalDeduction, rtl)}</td><td colSpan={3} /></tr></tfoot>}
      </table></div>
    </div>

    {entry && <EntryDialog rtl={rtl} row={entry.row} employees={employees} defaultDate={filters.mode === "date" ? filters.date : todayCairo()} onClose={() => setEntry(null)} onSaved={() => { setEntry(null); refresh(); }} notify={notify} />}
    {recalc && <RecalculateDialog rtl={rtl} scope={scope.filter(Boolean).join(" · ")} busy={recalcBusy} onConfirm={() => void doRecalc()} onClose={() => setRecalc(false)} />}
    {note && <NoteDialog rtl={rtl} row={note} canWrite={Boolean(access.canView)} onClose={() => setNote(null)} onSaved={() => { setNote(null); refresh(); }} notify={notify} />}
    {details && <DeductionDetailsDialog rtl={rtl} row={details} onClose={() => setDetails(null)} />}
    {drill && <NaughtyDrilldown rtl={rtl} employee={drill} rows={rows} onClose={() => setDrill(null)} />}
    {showDeductions && <DeductionSummaryDialog rtl={rtl} rows={rows} period={periodText} notify={notify} onClose={() => setShowDeductions(false)} onPrint={() => { setShowDeductions(false); setPrintMode("deductions"); }} />}
    {showPayroll && <PayrollDialog rtl={rtl} monthKey={monthMode ? filters.month : null} country={filters.country === "default" ? "" : filters.country} canEdit={Boolean(access.canEdit)} isMaster={Boolean(access.isMaster)} onClose={() => setShowPayroll(false)} notify={notify} onChanged={refresh} />}
    {printMode && <PrintView rtl={rtl} mode={printMode} rows={printMode === "grid" ? shown : rows} scope={scope.map(String)} onDone={() => setPrintMode(null)} />}
  </section>;
}
