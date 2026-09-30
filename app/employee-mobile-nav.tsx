"use client";

import { CalendarDays, Home, ListChecks, Menu } from "lucide-react";

export type EmployeeSection = "home" | "leave" | "requests";

export function EmployeeMobileNav({ rtl, active, onSelect, onMenu }: {
  rtl: boolean;
  active: EmployeeSection | null;
  onSelect: (section: EmployeeSection) => void;
  onMenu: () => void;
}) {
  const items = [
    { id: "home", ar: "الرئيسية", en: "Home", icon: Home },
    { id: "leave", ar: "إجازاتي", en: "Leave", icon: CalendarDays },
    { id: "requests", ar: "طلباتي", en: "Requests", icon: ListChecks },
  ] as const;
  return <nav className="employee-mobile-nav" aria-label={rtl ? "خدمات الموظف" : "Employee services"}>
    {items.map(({ id, ar, en, icon: Icon }) => <button key={id} type="button" aria-current={active === id ? "page" : undefined} onClick={() => onSelect(id)}>
      <Icon size={21} /><span>{rtl ? ar : en}</span>
    </button>)}
    <button type="button" onClick={onMenu} aria-controls="main-sidebar"><Menu size={21} /><span>{rtl ? "المزيد" : "More"}</span></button>
  </nav>;
}
