"use client";

import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { localizeApiMessage } from "./api-messages";
import { PAGE_LABELS } from "./navigation-labels";
import { ApprovalsTab, AttendanceTab, DocumentsTab, LeaveTab, OverviewTab, TalentTab, WorkforceTab } from "./reports-sections";
import { Badge, ExportButton, Panel, makeDateLabel, makeNumberFormat, type ReportContext } from "./reports-widgets";
import { buildHighlights, type ReportTab } from "./reports/report-highlights";
import { REPORT_MAX_DAYS, cairoToday, daysBetween, periodPreset, presetOf } from "./reports/report-period";
import type { ReportOverview } from "./reports/report-types";
import { statusLabel } from "./reports/report-labels";
import "./reports-workspace.css";

type TabId = ReportTab | "exports";
type ExportItem = { type: string; ar: string; en: string; arNote: string; enNote: string; byPeriod: boolean; available: (data: ReportOverview) => boolean };

const EXPORTS: ExportItem[] = [
  { type: "missing_employee_data", ar: "بيانات الموظفين المطلوبة الناقصة", en: "Missing required employee data", arNote: "ملف Excel بالموظفين الذين تنقصهم بيانات مطلوبة فقط، مع الشركة وموقع العمل وأسماء الحقول الناقصة. بحد أقصى ١٠٬٠٠٠ موظف.", enNote: "Excel file listing only employees with missing required data, their company, work location and missing field names. Up to 10,000 employees.", byPeriod: false, available: () => true },
  { type: "attendance", ar: "سجل الحضور", en: "Attendance log", arNote: "حضور وانصراف كل يوم، التأخير، والاستثناءات.", enNote: "Daily check-in/out, lateness and exceptions.", byPeriod: true, available: () => true },
  { type: "leave", ar: "طلبات الإجازة", en: "Leave requests", arNote: "كل طلب: النوع والمدة والحالة والمرحلة.", enNote: "Every request: type, dates, status and stage.", byPeriod: true, available: () => true },
  { type: "approvals", ar: "سجل الاعتمادات", en: "Approvals log", arNote: "كل قرار اعتماد أو رفض مع السبب والمعتمِد.", enNote: "Every approve/reject decision with reason and approver.", byPeriod: true, available: () => true },
  { type: "employees", ar: "بيانات الموظفين", en: "Employee data", arNote: "بيانات العمل الأساسية وحالة التوظيف.", enNote: "Core work details and employment status.", byPeriod: false, available: () => true },
  { type: "documents", ar: "المستندات", en: "Documents", arNote: "المستندات وتواريخ انتهائها وصلاحيتها.", enNote: "Documents with expiry dates and validity.", byPeriod: false, available: data => Boolean(data.documents) },
  { type: "recruitment", ar: "التوظيف", en: "Recruitment", arNote: "الوظائف والمرشحون ومراحلهم.", enNote: "Jobs, candidates and their stages.", byPeriod: false, available: data => Boolean(data.recruitment) },
  { type: "onboarding", ar: "التهيئة", en: "Onboarding", arNote: "مهام التهيئة ونسبة إنجاز كل موظف.", enNote: "Onboarding tasks and each employee's progress.", byPeriod: false, available: data => Boolean(data.lifecycle) },
  { type: "offboarding", ar: "إنهاء الخدمة", en: "Offboarding", arNote: "حالات إنهاء الخدمة ومهامها.", enNote: "Exit cases and their tasks.", byPeriod: false, available: data => Boolean(data.lifecycle) },
  { type: "assets", ar: "العهد والأصول", en: "Assets", arNote: "العهد وحالتها ومن يحوزها.", enNote: "Assets, their condition and who holds them.", byPeriod: false, available: data => Boolean(data.assets) },
  { type: "learning", ar: "التعلم والتطوير", en: "Learning & development", arNote: "البرامج التدريبية المسندة والإكمال والدرجات.", enNote: "Assigned courses, completion and scores.", byPeriod: false, available: data => Boolean(data.learning) },
];

export function ReportsWorkspace({ rtl, notify }: { rtl: boolean; notify: (message: string) => void }) {
  const t = (ar: string, en: string) => (rtl ? ar : en);
  const [range, setRange] = useState(() => periodPreset("this_month", cairoToday()));
  const [tab, setTab] = useState<TabId>("overview");
  const [data, setData] = useState<ReportOverview | null>(null);
  const [error, setError] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const [nonce, setNonce] = useState(0);
  const [selectedExport, setSelectedExport] = useState("attendance");
  const [customPeriod, setCustomPeriod] = useState(false);
  const [exporting, setExporting] = useState("");
  const [missingFilters, setMissingFilters] = useState({ companyId: "", country: "", workLocation: "", status: "" });
  const [filterCatalog, setFilterCatalog] = useState<{ companies: { id: number; name: string }[]; countries: string[]; locations: string[]; statuses: string[] } | null>(null);
  const [filterError, setFilterError] = useState("");
  const { from, to } = range;
  const problem = !from || !to || from > to ? "order" : daysBetween(from, to) > REPORT_MAX_DAYS ? "long" : "";
  const key = `${from}|${to}|${nonce}`;
  const loading = !problem && loadedKey !== key;
  const fmt = useMemo(() => makeNumberFormat(rtl), [rtl]);
  const dateLabel = useMemo(() => makeDateLabel(rtl), [rtl]);
  const highlights = useMemo(() => (data ? buildHighlights(data, rtl, fmt) : []), [data, rtl, fmt]);

  useEffect(() => {
    if (tab !== "exports") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/hr", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Unable to load employee filters");
        const body = await response.json();
        const employees = (body.employees || []) as Record<string, unknown>[];
        const values = (key: string) => [...new Set(employees.map(employee => String(employee[key] || "")).filter(Boolean))].sort();
        if (!controller.signal.aborted) {
          setFilterCatalog({ companies: body.companies || [], countries: values("country"), locations: values("work_location"), statuses: values("employment_status") });
          setFilterError("");
        }
      } catch {
        if (!controller.signal.aborted) setFilterError(rtl ? "تعذر تحميل خيارات التصفية. أعد فتح تبويب التصدير للمحاولة مجددًا." : "Unable to load filter choices. Reopen the exports tab to retry.");
      }
    })();
    return () => controller.abort();
  }, [tab, rtl]);

  useEffect(() => {
    if (problem) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/reports/insights?${new URLSearchParams({ from, to })}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(localizeApiMessage(body.error || (rtl ? "تعذر تحميل التقارير" : "Unable to load the reports"), rtl));
        if (!controller.signal.aborted) { setData(body); setError(""); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Request failed");
      } finally {
        if (!controller.signal.aborted) setLoadedKey(`${from}|${to}|${nonce}`);
      }
    };
    void load();
    return () => controller.abort();
  }, [from, to, nonce, problem, rtl]);

  const exportCsv = async (type: string) => {
    try {
      setExporting(type);
      const format = type === "missing_employee_data" ? "xlsx" : "csv";
      const response = await fetch(`/api/reports?${new URLSearchParams({ type, format, from, to, lang: rtl ? "ar" : "en", ...(type === "missing_employee_data" ? missingFilters : {}) })}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(localizeApiMessage(body.error || (rtl ? "تعذر تصدير التقرير" : "Unable to export the report"), rtl));
      }
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") || "")?.[1] || `hr-${type}.${format}`;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      notify(response.headers.get("x-report-limited") === "true" ? (rtl ? "تم تصدير أول ١٠٬٠٠٠ موظف؛ ضيّق عوامل التصفية لتصدير الباقي." : "Exported the first 10,000 employees; narrow the filters to export the rest.") : (rtl ? "تم تصدير الملف" : "File exported"));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Export failed");
    } finally {
      setExporting("");
    }
  };
  const ctx: ReportContext = { rtl, fmt, dateLabel, exporting, exportCsv: type => void exportCsv(type) };

  const hasTalent = Boolean(data?.recruitment || data?.lifecycle || data?.assets || data?.learning);
  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "overview", label: t("نظرة عامة", "Overview") },
    { id: "workforce", label: t("الموظفون", "Workforce") },
    { id: "attendance", label: t("الحضور", "Attendance") },
    { id: "leave", label: t("الإجازات", "Leave") },
    { id: "approvals", label: t("الاعتمادات", "Approvals"), count: data ? data.approvals.pendingNow.manager + data.approvals.pendingNow.hr : undefined },
    ...(data?.documents ? [{ id: "documents" as const, label: t("المستندات", "Documents"), count: data.documents.totals.expired + data.documents.totals.expiring }] : []),
    ...(hasTalent ? [{ id: "talent" as const, label: t("التوظيف", "Recruitment") }] : []),
    { id: "exports", label: t("تصدير الملفات", "File exports") },
  ];
  const today = cairoToday();
  const activePreset = customPeriod ? null : presetOf(from, to, today);
  const availableExports = data ? EXPORTS.filter(item => item.available(data)) : [];
  const exportItem = availableExports.find(item => item.type === selectedExport) ?? availableExports[0];
  const activeTab = tabs.some(item => item.id === tab) ? tab : "overview";

  return <div className="reports-workspace">
    <header className="page-heading">
      <div>
        <span className="eyebrow">{t("تقارير وتحليلات", "REPORTS & INSIGHTS")}</span>
        <h1>{PAGE_LABELS.reports[rtl ? "ar" : "en"]}</h1>
        <p>{t("تابع مؤشرات فريقك، اعرف ما يحتاج إجراء، وحمّل التقرير المناسب.", "Track your team, see what needs action, and download the report you need.")}</p>
      </div>
      <button type="button" className="outline rp-export" onClick={() => setTab("exports")}><Download size={16}/>{t("تصدير تقرير", "Export report")}</button>
    </header>

    <section className="rp-toolbar" aria-label={t("أقسام التقارير والفترة", "Report sections and period")}>
      <div className="rp-presets" role="group" aria-label={t("فترة التقرير", "Report period")}>
        <button type="button" className={activePreset === "this_month" ? "active" : ""} aria-pressed={activePreset === "this_month"} onClick={() => { setCustomPeriod(false); setRange(periodPreset("this_month", cairoToday())); }}>{t("الشهر الحالي", "This month")}</button>
        <button type="button" className={activePreset === "last_month" ? "active" : ""} aria-pressed={activePreset === "last_month"} onClick={() => { setCustomPeriod(false); setRange(periodPreset("last_month", cairoToday())); }}>{t("الشهر السابق", "Last month")}</button>
        <button type="button" className={!activePreset ? "active" : ""} aria-pressed={!activePreset} onClick={() => setCustomPeriod(true)}>{t("فترة مخصصة", "Custom period")}</button>
      </div>
      <div className="rp-dates">
        <label><span>{t("من", "From")}</span><input type="date" value={from} max={to || undefined} onChange={event => { setCustomPeriod(true); setRange(current => ({ ...current, from: event.target.value })); }}/></label>
        <label><span>{t("إلى", "To")}</span><input type="date" value={to} min={from || undefined} onChange={event => { setCustomPeriod(true); setRange(current => ({ ...current, to: event.target.value })); }}/></label>
      </div>
      <button type="button" className="outline rp-refresh" disabled={loading || Boolean(problem)} onClick={() => setNonce(value => value + 1)}><RefreshCw size={16} className={loading ? "rp-spin" : ""}/>{t("تحديث", "Refresh")}</button>
    </section>
    {data && <p className="rp-scope">{t("البيانات المعروضة:", "Showing:")} <span dir="ltr">{data.period.from} — {data.period.to}</span> · {t("الحضور حتى", "Attendance through")} <span dir="ltr">{data.attendance.through}</span>{loading && <span role="status"> · {t("جارٍ التحديث…", "Updating…")}</span>}</p>}
      {data && <div className="rp-tabs" role="tablist" aria-label={t("أقسام التقارير", "Report sections")}>
        {tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={activeTab === item.id} className={activeTab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
          {item.label}{item.count ? <em>{fmt(item.count)}</em> : null}
        </button>)}
      </div>}

    {problem === "order" && <div className="error-banner" role="alert">{t("تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.", "The start date must not be after the end date.")}</div>}
    {problem === "long" && <div className="error-banner" role="alert">{t("لا يمكن أن تتجاوز الفترة 366 يومًا.", "The period cannot exceed 366 days.")}</div>}
    {error && !problem && <div className="error-banner rp-error" role="alert"><AlertTriangle size={16}/><span>{error}</span><button type="button" className="outline" onClick={() => setNonce(value => value + 1)}>{t("إعادة المحاولة", "Try again")}</button></div>}

    {!data && !problem && !error && <div className="rp-skeleton" aria-busy="true" aria-label={t("جارٍ تحميل التقارير", "Loading the reports")}>{Array.from({ length: 4 }, (_, index) => <i key={index}/>)}</div>}

    {data && !problem && !error && <>
      <div className={`rp-body${loading ? " loading" : ""}`} aria-busy={loading}>
        {activeTab === "overview" && <OverviewTab data={data} ctx={ctx} highlights={highlights} goTo={setTab}/>}
        {activeTab === "workforce" && <WorkforceTab data={data} ctx={ctx}/>}
        {activeTab === "attendance" && <AttendanceTab data={data} ctx={ctx}/>}
        {activeTab === "leave" && <LeaveTab data={data} ctx={ctx}/>}
        {activeTab === "approvals" && <ApprovalsTab data={data} ctx={ctx}/>}
        {activeTab === "documents" && <DocumentsTab data={data} ctx={ctx}/>}
        {activeTab === "talent" && <TalentTab data={data} ctx={ctx}/>}
        {activeTab === "exports" && <Panel title={t("تصدير الملفات", "File exports")} note={t("تقرير البيانات الناقصة بصيغة Excel، وبقية الملفات بصيغة CSV. الملفات المعلَّمة «حسب الفترة» تلتزم بالتاريخين المختارين أعلاه.", "Missing employee data exports as Excel; other files use CSV. Files marked “by period” follow the two dates chosen above.")}>
          <label className="rp-export-choice"><span>{t("اختر التقرير", "Choose a report")}</span><select value={exportItem?.type ?? ""} onChange={event => setSelectedExport(event.target.value)}>{availableExports.map(item => <option key={item.type} value={item.type}>{rtl ? item.ar : item.en}</option>)}</select></label>
          <ul className="rp-exports">{(exportItem ? [exportItem] : []).map(item => <li key={item.type}>
            <div><b>{rtl ? item.ar : item.en}</b><p>{rtl ? item.arNote : item.enNote}</p><Badge tone={item.byPeriod ? "info" : "neutral"}>{item.byPeriod ? t("حسب الفترة", "By period") : t("الوضع الحالي", "Current state")}</Badge>
              {item.type === "missing_employee_data" && <>
                <div className="rp-missing-filters" role="group" aria-label={t("تصفية تقرير البيانات الناقصة", "Missing employee data filters")}>
                  <label><span>{t("الشركة", "Company")}</span><select value={missingFilters.companyId} onChange={event => setMissingFilters(current => ({ ...current, companyId: event.target.value }))}><option value="">{t("كل الشركات", "All companies")}</option><option value="unassigned">{t("بدون شركة", "Unassigned company")}</option>{filterCatalog?.companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
                  <label><span>{t("الدولة", "Country")}</span><select value={missingFilters.country} onChange={event => setMissingFilters(current => ({ ...current, country: event.target.value }))}><option value="">{t("كل الدول", "All countries")}</option>{filterCatalog?.countries.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
                  <label><span>{t("موقع العمل", "Work location")}</span><select value={missingFilters.workLocation} onChange={event => setMissingFilters(current => ({ ...current, workLocation: event.target.value }))}><option value="">{t("كل المواقع", "All locations")}</option>{filterCatalog?.locations.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
                  <label><span>{t("حالة التوظيف", "Employment status")}</span><select value={missingFilters.status} onChange={event => setMissingFilters(current => ({ ...current, status: event.target.value }))}><option value="">{t("كل الحالات", "All statuses")}</option>{filterCatalog?.statuses.map(value => <option key={value} value={value}>{statusLabel(value, rtl)}</option>)}</select></label>
                </div>
                {filterError && <p role="alert">{filterError}</p>}
              </>}
            </div>
            <ExportButton primary label={item.type === "missing_employee_data" ? t("تحميل Excel", "Download Excel") : t("تحميل CSV", "Download CSV")} busy={Boolean(exporting)} onClick={() => void exportCsv(item.type)}/>
          </li>)}</ul>
        </Panel>}
      </div>
    </>}
  </div>;
}
