"use client";
import { useEffect, useState } from "react";
import { AttendanceWorkspace } from "./attendance-workspace";
import { TimesheetWorkspace } from "./timesheet-management-workspace";
import { TimesheetSettingsWorkspace } from "./timesheet-settings-workspace";
import "./timesheet-management.css";

const TIMESHEET_PATH = "/timesheet-management";
type Tab = "attendance" | "timesheet" | "schedules";

/** One Attendance page: daily records, exceptions and corrections, and the Timesheet (deductions, approval, month lock) as a second tab. */
export function AttendanceHub({ rtl, notify, canTimesheet }: { rtl: boolean; notify: (message: string) => void; canTimesheet: boolean }) {
  const [tab, setTab] = useState<Tab>("attendance");
  useEffect(() => {
    // /timesheet-management opens the Attendance page on the Timesheet tab.
    const timer = window.setTimeout(() => { if (canTimesheet && window.location.pathname === TIMESHEET_PATH) setTab("timesheet"); }, 0);
    return () => window.clearTimeout(timer);
  }, [canTimesheet]);
  const choose = (next: Tab) => {
    setTab(next);
    const path = next === "attendance" ? "/" : TIMESHEET_PATH;
    if (window.location.pathname !== path) window.history.replaceState(null, "", path + window.location.search + window.location.hash);
  };
  const tabs: [Tab, string][] = [["attendance", rtl ? "الحضور والانصراف" : "Attendance"], ...(canTimesheet ? [["timesheet", rtl ? "كشوف الدوام والخصومات" : "Timesheet & deductions"] as [Tab, string], ["schedules", rtl ? "الجداول والقواعد" : "Schedules & rules"] as [Tab, string]] : [])];
  return <div className="ts-hub">
    {tabs.length > 1 && <nav className="ts-hub-tabs" aria-label={rtl ? "الحضور والانصراف" : "Attendance"}>
      {tabs.map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} className={tab === id ? "active" : ""} onClick={() => choose(id)}>{label}</button>)}
    </nav>}
    {tab === "timesheet" && canTimesheet ? <TimesheetWorkspace rtl={rtl} notify={notify} /> : tab === "schedules" && canTimesheet ? <TimesheetSettingsWorkspace rtl={rtl} notify={notify} /> : <AttendanceWorkspace rtl={rtl} notify={notify} />}
  </div>;
}
