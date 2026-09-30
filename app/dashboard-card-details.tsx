"use client";

import { useEffect, useRef } from "react";
import { Users, X } from "lucide-react";
import type { Row } from "./ui-types";
import "./dashboard-card-details.css";

export type DashboardDetailRow = { employee: Row; attendance?: Row };

export function DashboardCardDetails({ title, rows, kind, rtl, date, onClose }: {
  title: string;
  rows: DashboardDetailRow[];
  kind: "employees" | "present" | "away" | "late" | "unrecorded";
  rtl: boolean;
  date: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    closeButton.current?.focus();
    return () => {
      element?.close();
      trigger?.focus();
    };
  }, []);
  // A click on the ::backdrop is delivered to the <dialog> itself; close only when it lands outside the dialog box.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const closeOnBackdrop = (event: MouseEvent) => {
      if (event.target !== element) return;
      const box = element.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    };
    element.addEventListener("click", closeOnBackdrop);
    return () => element.removeEventListener("click", closeOnBackdrop);
  }, [onClose]);
  const number = (value: number) => value.toLocaleString(rtl ? "ar-SA-u-nu-arab" : "en-GB");
  const showAttendance = kind === "present" || kind === "late";
  return <dialog ref={dialog} className="dashboard-details-dialog" dir={rtl ? "rtl" : "ltr"}
    aria-labelledby="dashboard-details-title" onCancel={onClose}>
    <header className="dashboard-details-header">
      <div className="dashboard-details-heading"><span className="dashboard-details-icon"><Users size={23}/></span><div><h2 id="dashboard-details-title">{title}</h2><p><span className="dashboard-details-count">{rtl ? `${number(rows.length)} موظف` : `${number(rows.length)} employees`}</span>{kind !== "employees" && <time dateTime={date}>{date}</time>}</p></div></div>
      <button ref={closeButton} type="button" className="icon-btn" onClick={onClose} aria-label={rtl ? "إغلاق" : "Close"}><X size={20}/></button>
    </header>
    {rows.length ? <div className="dashboard-details-table-wrap"><table>
      <thead><tr><th>{rtl ? "الموظف" : "Employee"}</th><th>{rtl ? "القسم" : "Department"}</th>
        {showAttendance && <><th>{rtl ? "وقت الحضور" : "Check-in"}</th><th>{rtl ? "وقت الانصراف" : "Check-out"}</th><th>{rtl ? "التأخير بالدقائق" : "Late minutes"}</th></>}
        {(kind === "away" || kind === "unrecorded") && <th>{rtl ? "الحالة" : "Status"}</th>}
      </tr></thead>
      <tbody>{rows.map(({ employee, attendance }, index) => <tr key={`${employee.id}-${attendance?.id ?? index}`}>
        <td><strong className="dashboard-detail-name">{(rtl ? employee.name_ar || employee.name_en : employee.name_en || employee.name_ar) || "—"}</strong><small>{employee.employee_code || "—"}</small></td>
        <td>{(rtl ? employee.department_name_ar || employee.department_name : employee.department_name || employee.department_name_ar) || "—"}</td>
        {showAttendance && <><td dir="ltr">{attendance?.actual_in || "—"}</td><td dir="ltr">{attendance?.actual_out || "—"}</td><td>{number(Number(attendance?.late_minutes) || 0)}</td></>}
        {kind === "away" && <td>{attendance?.status === "leave" ? (rtl ? "في إجازة" : "On leave") : (rtl ? "غائب" : "Absent")}</td>}
        {kind === "unrecorded" && <td>{rtl ? "لم يسجل بعد" : "Not recorded yet"}</td>}
      </tr>)}</tbody>
    </table></div> : <p className="dashboard-details-empty">{rtl ? "لا يوجد موظفون لعرضهم في هذا الكارت حسب الفلاتر الحالية." : "No employees to display for this card with the current filters."}</p>}
  </dialog>;
}
