"use client";

import { useEffect, useState } from "react";
import { Activity, CalendarCheck, CalendarDays, Clock3, Download, Hourglass, LogOut, Timer, TimerReset, UserX } from "lucide-react";
import { localizeApiMessage } from "./api-messages";
import { localizedDisplayValue } from "./localization";
import type { Row } from "./ui-types";

type Report = { summary: Record<string, number>; records: Row[]; page: number; pageSize: number; total: number };
type Props = { rtl: boolean; employees: Row[]; notify: (message: string) => void };

const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const duration = (minutes: unknown, rtl: boolean) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0)), hours = Math.floor(total / 60), rest = total % 60;
  if (!total) return "0";
  return rtl ? [hours ? `${hours} س` : "", rest ? `${rest} د` : ""].filter(Boolean).join(" ") : [hours ? `${hours}h` : "", rest ? `${rest}m` : ""].filter(Boolean).join(" ");
};
const COUNTRY_AR: Record<string, string> = { Egypt: "مصر", "Saudi Arabia": "السعودية", Jordan: "الأردن", Cyprus: "قبرص", "United Arab Emirates": "الإمارات", Kuwait: "الكويت", Qatar: "قطر" };
const COUNTRY_ORDER = ["Egypt", "Saudi Arabia"];
const countryLabel = (country: string, rtl: boolean) => (rtl ? COUNTRY_AR[country] : "") || country;
const cellDuration =(minutes: unknown, rtl: boolean) => (Number(minutes) > 0 ? duration(minutes, rtl) : "—");

export function AttendanceReportPanel({ rtl, employees, notify }: Props) {
  const today = cairoToday();
  const [employeeId, setEmployeeId] = useState("");
  const [country, setCountry] = useState("");
  const [from, setFrom] = useState(() => today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Report | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const rangeInvalid = from > to;
  const key = [employeeId, country, from, to, page].join("|");
  const loading = !rangeInvalid && loadedKey !== key;
  useEffect(() => {
    if (from > to) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ employeeId, country, from, to, page: String(page) });
    const load = async () => {
      try {
        const response = await fetch("/api/attendance-report?" + params, { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(localizeApiMessage(body.error || (rtl ? "تعذر تحميل تقرير الحضور" : "Unable to load the attendance report"), rtl));
        if (!controller.signal.aborted) { setData(body); setError(""); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Request failed");
      } finally { if (!controller.signal.aborted) setLoadedKey([employeeId, country, from, to, page].join("|")); }
    };
    void load();
    return () => controller.abort();
  }, [employeeId, country, from, to, page, rtl]);
  const setPeriod = (start: string, end: string) => { setFrom(start); setTo(end); setPage(1); };
  const thisMonth = () => setPeriod(today.slice(0, 8) + "01", today);
  const lastMonth = () => {
    const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
    setPeriod(isoDate(new Date(Date.UTC(year, month - 2, 1))), isoDate(new Date(Date.UTC(year, month - 1, 0))));
  };
  const exportReport = async () => {
    try {
      setExporting(true);
      const params = new URLSearchParams({ employeeId, country, from, to, format: "csv", lang: rtl ? "ar" : "en" });
      const response = await fetch("/api/attendance-report?" + params, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(localizeApiMessage(body.error || (rtl ? "تعذر تصدير التقرير" : "Unable to export the report"), rtl));
      }
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") || "")?.[1] || "attendance-report.csv";
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      notify(rtl ? "تم تصدير تقرير الحضور" : "Attendance report exported");
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Export failed"); }
    finally { setExporting(false); }
  };
  const countries = [...new Set([...COUNTRY_ORDER, ...employees.map(employee => String(employee.country || "")).filter(Boolean)])]
    .sort((a, b) => (COUNTRY_ORDER.indexOf(a) + 1 || 99) - (COUNTRY_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const summary = data?.summary || {};
  const total = data?.total || 0;
  const name = (row: Row) => (rtl ? row.employee_name_ar || row.employee_name : row.employee_name) || "—";
  const cards = [
    { icon: CalendarCheck, label: rtl ? "أيام الحضور" : "Days attended", value: String(summary.attended_days ?? 0) },
    { icon: UserX, label: rtl ? "أيام الغياب" : "Absent days", value: String(summary.absent_days ?? 0) },
    { icon: CalendarDays, label: rtl ? "أيام الإجازة" : "Leave days", value: String(summary.leave_days ?? 0) },
    { icon: Clock3, label: rtl ? "إجمالي ساعات العمل" : "Total hours worked", value: duration(summary.worked_minutes, rtl) },
    { icon: TimerReset, label: rtl ? "أيام التأخير" : "Late days", value: String(summary.late_days ?? 0), tone: Number(summary.late_days) > 0 ? "warn" : "" },
    { icon: Hourglass, label: rtl ? "إجمالي مدة التأخير" : "Total lateness", value: duration(summary.late_minutes, rtl), tone: Number(summary.late_minutes) > 0 ? "warn" : "" },
    { icon: LogOut, label: rtl ? "الانصراف المبكر" : "Early departure", value: duration(summary.early_minutes, rtl), tone: Number(summary.early_minutes) > 0 ? "warn" : "" },
    { icon: Timer, label: rtl ? "العمل الإضافي (أوفر تايم)" : "Overtime", value: duration(summary.overtime_minutes, rtl), tone: Number(summary.overtime_minutes) > 0 ? "good" : "" },
  ];
  const header = [rtl ? "التاريخ" : "Date", ...(employeeId ? [] : [rtl ? "الموظف" : "Employee"]), rtl ? "الحضور" : "Check-in", rtl ? "الانصراف" : "Check-out", rtl ? "الساعات" : "Hours", rtl ? "التأخير" : "Late", rtl ? "انصراف مبكر" : "Early leave", rtl ? "أوفر تايم" : "Overtime", rtl ? "الحالة" : "Status"];
  return <div className="attendance-report">
    <div className="biometric-filters">
      <label><span>{rtl ? "الدولة" : "Country"}</span><select value={country} onChange={event => { const next = event.target.value; setCountry(next); if (next && employeeId && String(employees.find(employee => String(employee.id) === employeeId)?.country || "") !== next) setEmployeeId(""); setPage(1); }}><option value="">{rtl ? "كل الدول" : "All countries"}</option>{countries.map(value => <option key={value} value={value}>{countryLabel(value, rtl)}</option>)}</select></label>
      <label><span>{rtl ? "الموظف" : "Employee"}</span><select value={employeeId} onChange={event => { setEmployeeId(event.target.value); setPage(1); }}><option value="">{rtl ? "كل الموظفين" : "All employees"}</option>{employees.filter(employee => !country || employee.country === country).sort((a, b) => String(rtl ? a.name_ar || a.name_en : a.name_en).localeCompare(String(rtl ? b.name_ar || b.name_en : b.name_en), rtl ? "ar" : "en")).map(employee => <option key={employee.id} value={employee.id}>{rtl ? employee.name_ar || employee.name_en : employee.name_en} · {employee.employee_code}</option>)}</select></label>
      <label><span>{rtl ? "من" : "From"}</span><input type="date" value={from} max={to} onChange={event => { setFrom(event.target.value); setPage(1); }}/></label>
      <label><span>{rtl ? "إلى" : "To"}</span><input type="date" value={to} min={from} onChange={event => { setTo(event.target.value); setPage(1); }}/></label>
      <button className="outline" onClick={thisMonth}>{rtl ? "هذا الشهر" : "This month"}</button>
      <button className="outline" onClick={lastMonth}>{rtl ? "الشهر الماضي" : "Last month"}</button>
      <button className="primary attendance-report-export" disabled={exporting || loading || rangeInvalid || !total} onClick={() => void exportReport()}><Download size={16}/>{exporting ? (rtl ? "جارٍ التصدير..." : "Exporting...") : (rtl ? "تصدير التقرير (CSV)" : "Export report (CSV)")}</button>
    </div>
    {rangeInvalid && <div className="error-banner" role="alert">{rtl ? "تاريخ البداية يجب ألا يكون بعد تاريخ النهاية." : "The start date must not be after the end date."}</div>}
    {error && !rangeInvalid && <div className="error-banner" role="alert">{error}</div>}
    <div className="attendance-report-summary">{cards.map(({ icon: Icon, label, value, tone }) => <div key={label} className={tone || undefined}><Icon size={19}/><b>{value}</b><span>{label}</span></div>)}</div>
    {total > 20000 && <p className="attendance-report-note">{rtl ? "التصدير يشمل أول 20000 سجل فقط. ضيّق الفترة أو اختر موظفًا لتصدير كل السجلات." : "The export includes the first 20,000 records only. Narrow the period or pick an employee to export everything."}</p>}
    {loading ? <div className="attendance-loading"><Activity/><span>{rtl ? "جارٍ تحميل التقرير..." : "Loading the report..."}</span></div> : <div className="biometric-table-scroll">
      <table className="biometric-table"><thead><tr>{header.map(text => <th key={text}>{text}</th>)}</tr></thead><tbody>{(data?.records || []).map(row => <tr key={row.id}>
        <td dir="ltr">{row.work_date}</td>
        {!employeeId && <td><b>{name(row)}</b><small>{row.employee_code}</small></td>}
        <td className="bio-in" dir="ltr">{row.actual_in || "—"}</td>
        <td dir="ltr">{row.actual_out || "—"}</td>
        <td dir="ltr">{row.actual_out ? (Number(row.worked_minutes) / 60).toFixed(2) : "—"}</td>
        <td className={Number(row.late_minutes) > 0 ? "report-late" : ""}>{cellDuration(row.late_minutes, rtl)}</td>
        <td className={Number(row.early_minutes) > 0 ? "report-late" : ""}>{cellDuration(row.early_minutes, rtl)}</td>
        <td className={Number(row.overtime_minutes) > 0 ? "report-overtime" : ""}>{cellDuration(row.overtime_minutes, rtl)}</td>
        <td><span className={"attendance-status " + (["late", "needs_review", "absent"].includes(row.status) ? "amber" : "green")}>{localizedDisplayValue(row.status, rtl)}</span></td>
      </tr>)}</tbody></table>
      {!data?.records.length && !error && <div className="attendance-empty"><CalendarDays/><h3>{rtl ? "لا توجد سجلات في هذه الفترة" : "No records in this period"}</h3><p>{rtl ? "غيّر الموظف أو الفترة، أو تأكد من مزامنة جهاز البصمة." : "Change the employee or period, or make sure the biometric device is synchronized."}</p></div>}
    </div>}
    <footer className="biometric-pagination"><span className="biometric-record-count">{total} {rtl ? "سجل" : "records"}</span><button className="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{rtl ? "السابق" : "Previous"}</button><span>{rtl ? "صفحة" : "Page"} {page} / {Math.max(1, Math.ceil(total / (data?.pageSize || 50)))}</span><button className="outline" disabled={page * (data?.pageSize || 50) >= total} onClick={() => setPage(value => value + 1)}>{rtl ? "التالي" : "Next"}</button></footer>
  </div>;
}
