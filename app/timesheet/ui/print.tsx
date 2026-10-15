"use client";
import { useEffect } from "react";
import type { Row } from "../../ui-types";
import { formatDay, formatMoney, formatNumber, locale } from "./common";
import { hoursText, noticeLabel, num, rowStatusLabel } from "../labels";
import { deductionSummary, summarize } from "../summary";
import { DeductionSummaryTable } from "./dialogs";

export type PrintMode = "grid" | "deductions";

/**
 * A4 print layout: logo, title, "Printed on", the filters in force and the table. It is mounted only while printing and the
 * print stylesheet hides everything else (controls included). Arabic prints right-to-left.
 */
export function PrintView({ rtl, mode, rows, scope, onDone }: { rtl: boolean; mode: PrintMode; rows: Row[]; scope: string[]; onDone: () => void }) {
  useEffect(() => {
    const done = () => onDone();
    window.addEventListener("afterprint", done);
    const timer = window.setTimeout(() => window.print(), 80);
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", done); };
  }, [onDone]);
  const t = (en: string, ar: string) => (rtl ? ar : en);
  const printedOn = new Intl.DateTimeFormat(locale(rtl), { dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const total = summarize(rows), deduction = deductionSummary(rows);
  return <div className="ts-print" dir={rtl ? "rtl" : "ltr"} lang={rtl ? "ar" : "en"}>
    <header className="ts-print-head">
      {/* eslint-disable-next-line @next/next/no-img-element -- print logo, static asset */}
      <img src="/sana-mark.png" alt="SANA HR" width={44} height={44} />
      <div><h1>{mode === "grid" ? t("Timesheet Management", "إدارة كشوف الدوام") : t("Deduction Summary", "ملخص الخصومات")}</h1><p>{scope.filter(Boolean).join(" · ")}</p></div>
      <p className="ts-print-date">{t("Printed on", "تاريخ الطباعة")}: {printedOn}</p>
    </header>
    {mode === "deductions" ? <DeductionSummaryTable rtl={rtl} employees={deduction.employees} grand={deduction.grand} /> :
      <table className="ts-table compact"><thead><tr><th>{t("Date", "التاريخ")}</th><th>{t("Employee", "الموظف")}</th><th>{t("Department", "القسم")}</th><th>{t("Scheduled", "الدوام")}</th><th>{t("Actual", "الفعلي")}</th><th>{t("Work Hours", "ساعات العمل")}</th>
        <th>{t("Late", "التأخير")}</th><th>{t("Early", "المبكر")}</th><th>{t("OT", "الإضافي")}</th><th>{t("Status", "الحالة")}</th><th>{t("Notice", "الإشعار")}</th><th>{t("Deduction", "الخصم")}</th></tr></thead>
        <tbody>{rows.map(row => <tr key={String(row.id)}><td>{formatDay(row.work_date, rtl)}</td><td>{String(rtl ? row.employee_name_ar || row.employee_name : row.employee_name)}</td><td>{String((rtl ? row.department_name_ar || row.department_name : row.department_name) ?? "—")}</td>
          <td dir="ltr">{row.scheduled_start ? `${row.scheduled_start}–${row.scheduled_end}` : "—"}</td><td dir="ltr">{row.actual_start || row.actual_end ? `${row.actual_start ?? "—"}–${row.actual_end ?? "—"}` : "—"}</td><td>{hoursText(row.total_work_minutes, rtl)}</td>
          <td>{num(row.late_minutes) || "—"}</td><td>{num(row.early_leave_minutes) || "—"}</td><td>{num(row.overtime_minutes) || "—"}</td><td>{rowStatusLabel(row, rtl)}</td><td>{noticeLabel(row, rtl) || "—"}</td><td>{num(row.deduction_amount) ? formatMoney(row.deduction_amount, rtl) : "—"}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={5}>{t("Grand Total", "الإجمالي العام")} ({formatNumber(total.total, rtl)})</td><td>{hoursText(total.workMinutes, rtl)}</td><td>{formatNumber(total.lateMinutes, rtl)}</td><td>{formatNumber(total.earlyMinutes, rtl)}</td><td>{formatNumber(total.overtimeMinutes, rtl)}</td><td colSpan={2} /><td>{formatMoney(total.totalDeduction, rtl)}</td></tr></tfoot></table>}
  </div>;
}
