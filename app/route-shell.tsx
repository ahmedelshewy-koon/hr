"use client";
import "./route-shell.css";
import { useEffect, useState, type ReactNode } from "react";

/** Frame for the stand-alone Payroll, Timesheet-setup and attendance route pages: language/direction, page gutter and a way back to the main app. */
export function RouteShell({ children }: { children: ReactNode }) {
  const [rtl, setRtl] = useState(false);
  useEffect(() => {
    const saved = window.localStorage.getItem("hr-language") ?? window.localStorage.getItem("sanad-language");
    const arabic = saved === "ar";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time post-hydration read of a browser-only value
    setRtl(arabic);
    document.documentElement.lang = arabic ? "ar" : "en";
    document.documentElement.dir = arabic ? "rtl" : "ltr";
  }, []);
  return <div className="route-shell" dir={rtl ? "rtl" : "ltr"}>
    <a className="route-shell-back" href="/">{rtl ? "→ العودة إلى سنــع HR" : "← Back to SANA HR"}</a>
    {children}
  </div>;
}
