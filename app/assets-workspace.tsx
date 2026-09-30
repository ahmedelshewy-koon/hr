"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, CircleAlert, Cpu, CreditCard, Headphones, Keyboard, Laptop, Monitor, Mouse, Package, PackageCheck, Plus, RefreshCw, Search, Smartphone, Undo2, UserRound, Wrench, X } from "lucide-react";
import { localizeApiMessage } from "./api-messages";
import { localizedDisplayValue } from "./localization";
import type { Row } from "./ui-types";
import "./assets-workspace.css";

type Tone = "green" | "blue" | "amber" | "red" | "gray";
type Dialog = { kind: "add" } | { kind: "assign" | "return" | "status"; asset: Row };
type Translate = (ar: string, en: string) => string;

const PAGE_SIZE = 50;
const UNAVAILABLE = ["maintenance", "lost", "retired"];
const STATUSES: Record<string, { ar: string; en: string; tone: Tone }> = {
  available: { ar: "متاح", en: "Available", tone: "green" },
  assigned: { ar: "مُسند", en: "Assigned", tone: "blue" },
  maintenance: { ar: "قيد الصيانة", en: "In maintenance", tone: "amber" },
  lost: { ar: "مفقود", en: "Lost", tone: "red" },
  retired: { ar: "خارج الخدمة", en: "Retired", tone: "gray" },
};
const CATEGORIES: { value: string; ar: string; en: string; icon: LucideIcon; tone: string }[] = [
  { value: "Laptop", ar: "حاسوب محمول", en: "Laptop", icon: Laptop, tone: "blue" },
  { value: "Mobile", ar: "هاتف محمول", en: "Mobile phone", icon: Smartphone, tone: "violet" },
  { value: "SIM", ar: "شريحة اتصال", en: "SIM card", icon: Cpu, tone: "green" },
  { value: "Monitor", ar: "شاشة", en: "Monitor", icon: Monitor, tone: "amber" },
  { value: "Keyboard", ar: "لوحة مفاتيح", en: "Keyboard", icon: Keyboard, tone: "violet" },
  { value: "Mouse", ar: "ماوس", en: "Mouse", icon: Mouse, tone: "green" },
  { value: "Access Card", ar: "بطاقة دخول", en: "Access card", icon: CreditCard, tone: "rose" },
  { value: "Headset", ar: "سماعة رأس", en: "Headset", icon: Headphones, tone: "blue" },
  { value: "Other", ar: "أخرى", en: "Other", icon: Package, tone: "gray" },
];
const CONDITIONS = [
  { value: "new", ar: "جديدة", en: "New" },
  { value: "good", ar: "جيدة", en: "Good" },
  { value: "fair", ar: "مقبولة", en: "Fair" },
  { value: "damaged", ar: "متضررة", en: "Damaged" },
];
const RETURN_STATUSES = ["available", "maintenance", "lost", "retired"];

async function request(path: string, payload?: Row) {
  const response = await fetch(`/api/${path}`, payload ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(localizeApiMessage(body.error || `Request failed (${response.status})`));
  return body;
}

const categoryOf = (value: unknown) => CATEGORIES.find(item => item.value === value) ?? CATEGORIES[CATEGORIES.length - 1];
const employeeName = (row: Row, rtl: boolean, prefix = "employee_name") => (rtl ? row[`${prefix}_ar`] || row[prefix] : row[prefix] || row[`${prefix}_ar`]) || "—";
const formatDate = (value: unknown, rtl: boolean) => value ? new Intl.DateTimeFormat(rtl ? "ar-SA-u-nu-arab" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(String(value))) : "—";
const conditionLabel = (value: unknown, rtl: boolean) => { const item = CONDITIONS.find(entry => entry.value === value); return item ? (rtl ? item.ar : item.en) : "—"; };
const categoryLabel = (value: unknown, rtl: boolean) => { const item = CATEGORIES.find(entry => entry.value === value); return item ? (rtl ? item.ar : item.en) : localizedDisplayValue(value, rtl); };

function StatusChip({ status, rtl }: { status: unknown; rtl: boolean }) {
  const item = STATUSES[String(status)] ?? { ar: localizedDisplayValue(status, true), en: localizedDisplayValue(status, false), tone: "gray" as Tone };
  return <span className={`asset-status ${item.tone}`}>{rtl ? item.ar : item.en}</span>;
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{error ? <small className="asset-hint error">{error}</small> : hint ? <small className="asset-hint">{hint}</small> : null}</label>;
}

/** Searchable employee field: type a name or employee number, then pick from the suggestions. */
function EmployeePicker({ rtl, employees, value, onChange, label, required }: { rtl: boolean; employees: Row[]; value: string; onChange: (id: string, text: string) => void; label: string; required?: boolean }) {
  const listId = useId();
  const optionText = useCallback((employee: Row) => `${(rtl ? employee.name_ar || employee.name_en : employee.name_en || employee.name_ar) || "—"} · ${employee.employee_code}`, [rtl]);
  const selected = employees.find(employee => String(employee.id) === value);
  const [text, setText] = useState(selected ? optionText(selected) : "");
  const unmatched = Boolean(text) && !selected;
  return <Field label={label} error={unmatched ? (rtl ? "اختر موظفًا من القائمة المقترحة" : "Pick an employee from the suggestions") : undefined} hint={rtl ? "ابحث بالاسم أو الرقم الوظيفي" : "Search by name or employee number"}>
    <input list={listId} value={text} required={required} aria-invalid={unmatched} autoComplete="off" placeholder={rtl ? "ابدأ بكتابة اسم الموظف" : "Start typing an employee name"}
      onChange={event => { const next = event.target.value; setText(next); const match = employees.find(employee => optionText(employee) === next); onChange(match ? String(match.id) : "", next); }} />
    <datalist id={listId}>{employees.map(employee => <option key={employee.id} value={optionText(employee)} />)}</datalist>
  </Field>;
}

function DialogShell({ rtl, title, subtitle, submitLabel, close, onSubmit, children }: { rtl: boolean; title: string; subtitle: string; submitLabel: string; close: () => void; onSubmit: () => Promise<void>; children: React.ReactNode }) {
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    try { setSaving(true); await onSubmit(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setSaving(false); }
  };
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={close} aria-label={rtl ? "إغلاق النافذة" : "Close"} />
    <aside className="drawer asset-drawer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="drawer-head"><div><span className="eyebrow">{rtl ? "العهد والأصول" : "ASSETS"}</span><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-btn" type="button" onClick={close} aria-label={rtl ? "إغلاق" : "Close"}><X size={20} /></button></div>
      <form className="asset-form" onSubmit={submit} noValidate>
        <div className="form-body">{error && <div className="form-error" role="alert">{error}</div>}{children}</div>
        <div className="drawer-footer"><span /><button className="outline" type="button" onClick={close}>{rtl ? "إلغاء" : "Cancel"}</button><button className="primary" type="submit" disabled={saving}>{saving ? (rtl ? "جارٍ الحفظ..." : "Saving...") : submitLabel}<Check size={16} /></button></div>
      </form>
    </aside></div>;
}

function AssetSummary({ asset, rtl, extra }: { asset: Row; rtl: boolean; extra?: React.ReactNode }) {
  const category = categoryOf(asset.category), Icon = category.icon;
  return <div className="asset-summary"><i className={`asset-icon ${category.tone}`}><Icon size={20} /></i><div><b>{asset.name}</b><small><bdi>{asset.asset_code}</bdi> · {categoryLabel(asset.category, rtl)}</small>{extra}</div></div>;
}

function AddAssetDialog({ rtl, t, employees, assets, close, onSubmit }: { rtl: boolean; t: Translate; employees: Row[]; assets: Row[]; close: () => void; onSubmit: (payload: Row) => Promise<void> }) {
  const [form, setForm] = useState({ category: "Laptop", name: "", code: "", model: "", serial: "", condition: "good", employeeId: "", employeeText: "" });
  const nameField = useRef<HTMLInputElement>(null);
  useEffect(() => nameField.current?.focus(), []);
  const set = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  const submit = async () => {
    const code = form.code.trim();
    if (!form.name.trim() || !code) throw new Error(t("اسم الأصل ورمزه مطلوبان", "Asset name and code are required"));
    if (assets.some(asset => String(asset.asset_code).toLowerCase() === code.toLowerCase())) throw new Error(t("رمز الأصل مستخدم بالفعل. اختر رمزًا مختلفًا.", "This asset code is already in use. Choose a different code."));
    if (form.employeeText.trim() && !form.employeeId) throw new Error(t("اختر الموظف من القائمة المقترحة أو امسح الحقل", "Pick the employee from the suggestions or clear the field"));
    await onSubmit({ action: "create", assetCode: code, category: form.category, name: form.name.trim(), brandModel: form.model.trim(), serialNumber: form.serial.trim(), employeeId: Number(form.employeeId) || null, condition: form.condition });
  };
  return <DialogShell rtl={rtl} title={t("إضافة أصل جديد", "Add a new asset")} subtitle={t("سجّل الأصل في المخزون، ويمكنك إسناده لموظف مباشرة.", "Register the asset in stock — you can assign it to an employee right away.")} submitLabel={form.employeeId ? t("إضافة الأصل وإسناده", "Add and assign") : t("إضافة الأصل", "Add asset")} close={close} onSubmit={submit}>
    <div className="asset-category-picker" role="radiogroup" aria-label={t("الفئة", "Category")}>
      {CATEGORIES.map(item => { const Icon = item.icon; return <button type="button" role="radio" aria-checked={form.category === item.value} className={form.category === item.value ? "active" : ""} key={item.value} onClick={() => set("category", item.value)}><i className={`asset-icon ${item.tone}`}><Icon size={18} /></i>{rtl ? item.ar : item.en}</button>; })}
    </div>
    <div className="form-row">
      <Field label={t("اسم الأصل *", "Asset name *")}><input ref={nameField} value={form.name} onChange={event => set("name", event.target.value)} placeholder={t("مثال: لابتوب ديل لاتيتيود", "e.g. Dell Latitude laptop")} /></Field>
      <Field label={t("رمز الأصل *", "Asset code *")} hint={t("رمز فريد لا يتكرر", "Must be unique")}><input dir="ltr" value={form.code} onChange={event => set("code", event.target.value)} placeholder="LAP-001" /></Field>
    </div>
    <div className="form-row">
      <Field label={t("الموديل", "Brand / model")}><input dir="ltr" value={form.model} onChange={event => set("model", event.target.value)} /></Field>
      <Field label={t("الرقم التسلسلي", "Serial number")}><input dir="ltr" value={form.serial} onChange={event => set("serial", event.target.value)} /></Field>
    </div>
    <Field label={t("حالة الأصل", "Condition")}><select value={form.condition} onChange={event => set("condition", event.target.value)}>{CONDITIONS.map(item => <option value={item.value} key={item.value}>{rtl ? item.ar : item.en}</option>)}</select></Field>
    <EmployeePicker rtl={rtl} employees={employees} value={form.employeeId} label={t("إسناد إلى موظف (اختياري)", "Assign to an employee (optional)")} onChange={(id, text) => setForm(current => ({ ...current, employeeId: id, employeeText: text }))} />
  </DialogShell>;
}

function AssignDialog({ rtl, t, asset, employees, close, onSubmit }: { rtl: boolean; t: Translate; asset: Row; employees: Row[]; close: () => void; onSubmit: (payload: Row) => Promise<void> }) {
  const [employeeId, setEmployeeId] = useState(""), [condition, setCondition] = useState(String(asset.asset_condition || "good")), [notes, setNotes] = useState("");
  const submit = async () => {
    if (!employeeId) throw new Error(t("اختر الموظف المستلم", "Choose the receiving employee"));
    await onSubmit({ action: "assign", assetId: asset.id, employeeId: Number(employeeId), condition, notes: notes.trim() });
  };
  return <DialogShell rtl={rtl} title={t("إسناد أصل لموظف", "Assign asset")} subtitle={t("سيصل للموظف إشعار بالاستلام ويُسجَّل الإسناد في السجل.", "The employee is notified and the assignment is logged.")} submitLabel={t("تأكيد الإسناد", "Confirm assignment")} close={close} onSubmit={submit}>
    <AssetSummary asset={asset} rtl={rtl} />
    <EmployeePicker rtl={rtl} employees={employees} value={employeeId} required label={t("الموظف المستلم *", "Receiving employee *")} onChange={id => setEmployeeId(id)} />
    <Field label={t("حالة الأصل عند التسليم", "Condition at handover")}><select value={condition} onChange={event => setCondition(event.target.value)}>{CONDITIONS.map(item => <option value={item.value} key={item.value}>{rtl ? item.ar : item.en}</option>)}</select></Field>
    <Field label={t("ملاحظات", "Notes")}><textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder={t("مثال: يشمل الشاحن والحقيبة", "e.g. includes charger and bag")} /></Field>
  </DialogShell>;
}

function ReturnDialog({ rtl, t, asset, close, onSubmit }: { rtl: boolean; t: Translate; asset: Row; close: () => void; onSubmit: (payload: Row) => Promise<void> }) {
  const [condition, setCondition] = useState("good"), [nextStatus, setNextStatus] = useState("available"), [statusTouched, setStatusTouched] = useState(false), [notes, setNotes] = useState("");
  const changeCondition = (value: string) => { setCondition(value); if (!statusTouched) setNextStatus(value === "damaged" ? "maintenance" : "available"); };
  return <DialogShell rtl={rtl} title={t("استرجاع أصل", "Return asset")} subtitle={t("سجّل حالة الأصل عند الاستلام وحدد وجهته بعد ذلك.", "Record the asset's condition on return and where it goes next.")} submitLabel={t("تأكيد الاسترجاع", "Confirm return")} close={close}
    onSubmit={() => onSubmit({ action: "return", assetId: asset.id, condition, nextStatus, notes: notes.trim() })}>
    <AssetSummary asset={asset} rtl={rtl} extra={<small className="asset-holder-line"><UserRound size={13} />{employeeName(asset, rtl)} · {t("منذ", "since")} {formatDate(asset.assigned_at, rtl)}</small>} />
    <div className="form-row">
      <Field label={t("حالة الأصل عند الاسترجاع", "Condition on return")}><select value={condition} onChange={event => changeCondition(event.target.value)}>{CONDITIONS.map(item => <option value={item.value} key={item.value}>{rtl ? item.ar : item.en}</option>)}</select></Field>
      <Field label={t("يصبح الأصل", "Asset becomes")} hint={condition === "damaged" && nextStatus === "maintenance" ? t("اقتُرحت الصيانة لأن الأصل متضرر", "Maintenance suggested because it is damaged") : undefined}><select value={nextStatus} onChange={event => { setStatusTouched(true); setNextStatus(event.target.value); }}>{RETURN_STATUSES.map(value => <option value={value} key={value}>{rtl ? STATUSES[value].ar : STATUSES[value].en}</option>)}</select></Field>
    </div>
    <Field label={t("ملاحظات الاستلام", "Return notes")}><textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder={t("أي ملاحظات عن الأصل عند الاستلام", "Anything worth noting about the returned asset")} /></Field>
  </DialogShell>;
}

function StatusDialog({ rtl, t, asset, close, onSubmit }: { rtl: boolean; t: Translate; asset: Row; close: () => void; onSubmit: (payload: Row) => Promise<void> }) {
  const options = RETURN_STATUSES.filter(value => value !== asset.status);
  const [status, setStatus] = useState(options[0]);
  return <DialogShell rtl={rtl} title={t("تغيير حالة الأصل", "Change asset status")} subtitle={t("للأصول غير المُسندة فقط. الأصل المُسند يجب استرجاعه أولًا.", "For unassigned assets only — return an assigned asset first.")} submitLabel={t("حفظ الحالة", "Save status")} close={close} onSubmit={() => onSubmit({ action: "status", assetId: asset.id, status })}>
    <AssetSummary asset={asset} rtl={rtl} extra={<span className="asset-status-line"><StatusChip status={asset.status} rtl={rtl} /></span>} />
    <Field label={t("الحالة الجديدة", "New status")}><select value={status} onChange={event => setStatus(event.target.value)}>{options.map(value => <option value={value} key={value}>{rtl ? STATUSES[value].ar : STATUSES[value].en}</option>)}</select></Field>
  </DialogShell>;
}

export function AssetsWorkspace({ rtl, notify }: { rtl: boolean; notify: (message: string) => void }) {
  const t: Translate = useCallback((ar, en) => (rtl ? ar : en), [rtl]);
  const [assets, setAssets] = useState<Row[]>([]), [history, setHistory] = useState<Row[]>([]), [employees, setEmployees] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [error, setError] = useState("");
  const [tab, setTab] = useState<"assets" | "history">("assets"), [query, setQuery] = useState(""), [status, setStatus] = useState(""), [category, setCategory] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null), [shown, setShown] = useState({ key: "", count: PAGE_SIZE });

  const load = useCallback(async () => {
    setRefreshing(true); setError("");
    try {
      const [next, options] = await Promise.all([request("assets"), request("talent/options")]);
      setAssets(next.assets ?? []); setHistory(next.history ?? []); setEmployees(options.employees ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const perform = async (payload: Row, message: string) => { await request("assets", payload); setDialog(null); notify(message); await load(); };

  const counts = useMemo(() => ({
    total: assets.length,
    available: assets.filter(asset => asset.status === "available").length,
    assigned: assets.filter(asset => asset.status === "assigned").length,
    unavailable: assets.filter(asset => UNAVAILABLE.includes(String(asset.status))).length,
  }), [assets]);
  const categories = useMemo(() => [...new Set(assets.map(asset => String(asset.category)))], [assets]);
  const needle = query.trim().toLowerCase();
  const filterKey = `${tab}|${needle}|${status}|${category}`;
  const visibleAssets = useMemo(() => assets.filter(asset =>
    (!status || (status === "unavailable" ? UNAVAILABLE.includes(String(asset.status)) : asset.status === status))
    && (!category || asset.category === category)
    && (!needle || [asset.asset_code, asset.name, asset.brand_model, asset.serial_number, asset.employee_name, asset.employee_name_ar, asset.employee_code].some(value => String(value ?? "").toLowerCase().includes(needle)))), [assets, status, category, needle]);
  const visibleHistory = useMemo(() => history.filter(entry => !needle || [entry.asset_code, entry.asset_name, entry.employee_name, entry.employee_name_ar, entry.employee_code].some(value => String(value ?? "").toLowerCase().includes(needle))), [history, needle]);
  const limit = shown.key === filterKey ? shown.count : PAGE_SIZE;
  const list = tab === "assets" ? visibleAssets : visibleHistory;
  const filtered = Boolean(needle || status || category);
  const clearFilters = () => { setQuery(""); setStatus(""); setCategory(""); };
  const toggleStatus = (value: string) => setStatus(current => (current === value ? "" : value));

  const kpis: { key: string; label: string; value: number; icon: LucideIcon; tone: string }[] = [
    { key: "", label: t("إجمالي الأصول", "Total assets"), value: counts.total, icon: Package, tone: "blue" },
    { key: "available", label: t("متاحة للإسناد", "Available"), value: counts.available, icon: PackageCheck, tone: "green" },
    { key: "assigned", label: t("مُسندة للموظفين", "Assigned"), value: counts.assigned, icon: UserRound, tone: "violet" },
    { key: "unavailable", label: t("صيانة أو غير متاحة", "Maintenance / unavailable"), value: counts.unavailable, icon: Wrench, tone: "amber" },
  ];

  return <section className="assets-page">
    <section className="page-heading compact"><div><h1>{t("العهد والأصول", "Assets")}</h1></div>
      <div className="asset-head-actions">
        <button className="outline" type="button" onClick={() => void load()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "spin" : ""} />{t("تحديث", "Refresh")}</button>
        <button className="primary" type="button" onClick={() => setDialog({ kind: "add" })}><Plus size={16} />{t("إضافة أصل", "Add asset")}</button>
      </div>
    </section>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>{t("إعادة المحاولة", "Retry")}</button></div>}

    <div className="asset-kpis">{kpis.map(({ key, label, value, icon: Icon, tone }) => {
      const active = key ? status === key : !status;
      return <button type="button" className={`asset-kpi ${active ? "active" : ""}`} key={key || "all"} aria-pressed={active} onClick={() => { setTab("assets"); if (key) toggleStatus(key); else setStatus(""); }}>
        <i className={`asset-icon large ${tone}`}><Icon size={22} /></i><span><small>{label}</small><b>{new Intl.NumberFormat(rtl ? "ar-SA-u-nu-arab" : "en-GB").format(value)}</b></span></button>;
    })}</div>

    <div className="tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === "assets"} className={tab === "assets" ? "active" : ""} onClick={() => setTab("assets")}>{t("سجل الأصول", "Asset register")}</button>
      <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>{t("سجل الإسناد", "Assignment history")}</button>
    </div>

    <div className="asset-panel">
      <div className="asset-toolbar">
        <label className="asset-search"><Search size={16} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={tab === "assets" ? t("ابحث بالرمز أو الاسم أو الرقم التسلسلي أو الموظف", "Search by code, name, serial number or employee") : t("ابحث بالأصل أو الموظف", "Search by asset or employee")} aria-label={t("بحث", "Search")} /></label>
        {tab === "assets" && categories.length > 1 && <select className="asset-select" value={category} onChange={event => setCategory(event.target.value)} aria-label={t("تصفية بالفئة", "Filter by category")}><option value="">{t("كل الفئات", "All categories")}</option>{categories.map(value => <option value={value} key={value}>{categoryLabel(value, rtl)}</option>)}</select>}
        <span className="asset-count" aria-live="polite">{filtered ? t(`${list.length} من ${tab === "assets" ? assets.length : history.length}`, `${list.length} of ${tab === "assets" ? assets.length : history.length}`) : t(`${list.length} سجل`, `${list.length} records`)}</span>
        {filtered && <button type="button" className="asset-clear" onClick={clearFilters}>{t("مسح التصفية", "Clear filters")}</button>}
      </div>

      {loading ? <div className="asset-skeleton" aria-busy="true">{[0, 1, 2, 3, 4].map(index => <span key={index} />)}</div>
        : !list.length ? <div className="asset-empty">
          <i><CircleAlert size={26} /></i>
          <b>{filtered ? t("لا توجد نتائج مطابقة", "No matching results") : tab === "assets" ? t("لا توجد أصول مسجلة بعد", "No assets registered yet") : t("لا يوجد سجل إسناد بعد", "No assignments yet")}</b>
          <span>{filtered ? t("جرّب تغيير كلمات البحث أو مسح التصفية.", "Try different search terms or clear the filters.") : tab === "assets" ? t("أضف أول أصل ليظهر هنا ويمكن إسناده للموظفين.", "Add the first asset to track and assign it to employees.") : t("ستظهر هنا عمليات الإسناد والاسترجاع.", "Assignments and returns will appear here.")}</span>
          {filtered ? <button className="outline" type="button" onClick={clearFilters}>{t("مسح التصفية", "Clear filters")}</button> : tab === "assets" && <button className="primary" type="button" onClick={() => setDialog({ kind: "add" })}><Plus size={16} />{t("إضافة أصل", "Add asset")}</button>}
        </div>
        : tab === "assets" ? <div className="asset-table" role="table" aria-label={t("سجل الأصول", "Asset register")}>
          <div className="asset-row head" role="row"><span role="columnheader">{t("الأصل", "Asset")}</span><span role="columnheader">{t("الموديل والرقم التسلسلي", "Model & serial")}</span><span role="columnheader">{t("الحالة", "Status")}</span><span role="columnheader">{t("المستلم", "Holder")}</span><span role="columnheader">{t("الإجراءات", "Actions")}</span></div>
          {visibleAssets.slice(0, limit).map(asset => { const item = categoryOf(asset.category), Icon = item.icon, assigned = asset.status === "assigned"; return <div className="asset-row" role="row" key={asset.id}>
            <span className="asset-cell-main" role="cell"><i className={`asset-icon ${item.tone}`}><Icon size={20} /></i><span><b>{asset.name}</b><small><bdi>{asset.asset_code}</bdi> · {categoryLabel(asset.category, rtl)}</small></span></span>
            <span className="asset-cell-model" role="cell" data-label={t("الموديل والرقم التسلسلي", "Model & serial")}><b dir="ltr">{asset.brand_model || "—"}</b><small dir="ltr">{asset.serial_number ? `S/N ${asset.serial_number}` : t("بدون رقم تسلسلي", "No serial number")}</small></span>
            <span className="asset-cell-status" role="cell"><StatusChip status={asset.status} rtl={rtl} /></span>
            <span className={`asset-cell-holder${assigned ? "" : " is-empty"}`} role="cell" data-label={t("المستلم", "Holder")}>{assigned ? <><b>{employeeName(asset, rtl)}</b><small>{t("منذ", "Since")} {formatDate(asset.assigned_at, rtl)} · {conditionLabel(asset.assigned_condition, rtl)}</small></> : <small>—</small>}</span>
            <span className="asset-cell-actions" role="cell">
              {assigned ? <button type="button" className="asset-btn" onClick={() => setDialog({ kind: "return", asset })}><Undo2 size={15} />{t("استرجاع", "Return")}</button>
                : <>{asset.status === "available" && <button type="button" className="asset-btn accent" onClick={() => setDialog({ kind: "assign", asset })}><UserRound size={15} />{t("إسناد", "Assign")}</button>}
                  <button type="button" className={asset.status === "available" ? "asset-icon-btn" : "asset-btn"} title={t("تغيير الحالة", "Change status")} aria-label={t("تغيير الحالة", "Change status")} onClick={() => setDialog({ kind: "status", asset })}><Wrench size={15} />{asset.status === "available" ? null : t("تغيير الحالة", "Change status")}</button></>}
            </span>
          </div>; })}
        </div>
        : <div className="asset-table" role="table" aria-label={t("سجل الإسناد", "Assignment history")}>
          <div className="asset-row history head" role="row"><span role="columnheader">{t("الأصل", "Asset")}</span><span role="columnheader">{t("الموظف", "Employee")}</span><span role="columnheader">{t("الإسناد", "Assigned")}</span><span role="columnheader">{t("الاسترجاع", "Returned")}</span></div>
          {visibleHistory.slice(0, limit).map(entry => <div className="asset-row history" role="row" key={entry.id}>
            <span className="asset-cell-main" role="cell"><span><b>{entry.asset_name}</b><small><bdi>{entry.asset_code}</bdi></small></span></span>
            <span role="cell" data-label={t("الموظف", "Employee")}><b>{employeeName(entry, rtl)}</b><small><bdi>{entry.employee_code}</bdi></small></span>
            <span role="cell" data-label={t("الإسناد", "Assigned")}><b>{formatDate(entry.assigned_at, rtl)}</b><small>{conditionLabel(entry.assigned_condition, rtl)}</small></span>
            <span role="cell" data-label={t("الاسترجاع", "Returned")}>{entry.returned_at ? <><b>{formatDate(entry.returned_at, rtl)}</b><small>{conditionLabel(entry.return_condition, rtl)}</small></> : <span className="asset-status blue">{t("لدى الموظف حاليًا", "With the employee")}</span>}</span>
          </div>)}
        </div>}
      {!loading && list.length > limit && <div className="asset-more"><button className="outline" type="button" onClick={() => setShown({ key: filterKey, count: limit + PAGE_SIZE })}>{t(`عرض المزيد (${list.length - limit} متبقٍ)`, `Show more (${list.length - limit} left)`)}</button></div>}
    </div>

    {dialog?.kind === "add" && <AddAssetDialog rtl={rtl} t={t} employees={employees} assets={assets} close={() => setDialog(null)} onSubmit={payload => perform(payload, payload.employeeId ? t("تمت إضافة الأصل وإسناده للموظف", "Asset added and assigned") : t("تمت إضافة الأصل", "Asset added"))} />}
    {dialog?.kind === "assign" && <AssignDialog rtl={rtl} t={t} asset={dialog.asset} employees={employees} close={() => setDialog(null)} onSubmit={payload => perform(payload, t("تم إسناد الأصل وإشعار الموظف", "Asset assigned and the employee notified"))} />}
    {dialog?.kind === "return" && <ReturnDialog rtl={rtl} t={t} asset={dialog.asset} close={() => setDialog(null)} onSubmit={payload => perform(payload, t("تم استرجاع الأصل", "Asset returned"))} />}
    {dialog?.kind === "status" && <StatusDialog rtl={rtl} t={t} asset={dialog.asset} close={() => setDialog(null)} onSubmit={payload => perform(payload, t("تم تحديث حالة الأصل", "Asset status updated"))} />}
  </section>;
}
