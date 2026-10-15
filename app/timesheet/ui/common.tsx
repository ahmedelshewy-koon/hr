"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { localizeApiMessage } from "../../api-messages";
import type { Row } from "../../ui-types";

export const API = "/api/timesheet-management";

/** Western digits in Arabic too, so dates and counts match the HH:mm times beside them. */
export const locale = (rtl: boolean) => (rtl ? "ar-EG-u-nu-latn" : "en-GB");
export const formatNumber = (value: unknown, rtl: boolean, digits = 0) => new Intl.NumberFormat(locale(rtl), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value) || 0);
export const formatMoney = (value: unknown, rtl: boolean) => formatNumber(value, rtl, 2);
export const formatDay = (date: unknown, rtl: boolean, options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? new Intl.DateTimeFormat(locale(rtl), { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)) : "—";
export const weekdayName = (date: unknown, rtl: boolean) => formatDay(date, rtl, { weekday: "short" });

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

/** Calls the timesheet API; failures carry the server's message, translated for the Arabic interface. */
export async function call(rtl: boolean, query?: Record<string, string | number | null | undefined>, body?: Row): Promise<Row> {
  const url = query ? `${API}?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => [key, String(value)]))}` : API;
  const response = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  if (response.status === 401) window.dispatchEvent(new Event("portal-session-expired"));
  const payload = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new ApiError(localizeApiMessage(String(payload.error || `Request failed (${response.status})`), rtl), response.status);
  return payload;
}

export function Modal({ title, subtitle, rtl, onClose, children, footer, wide, className = "" }: { title: string; subtitle?: string; rtl: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="modal-layer ts-modal-layer" dir={rtl ? "rtl" : "ltr"}>
    <button type="button" className="modal-scrim" onClick={onClose} aria-label={rtl ? "إغلاق" : "Close"} />
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`ts-dialog ${wide ? "wide" : ""} ${className}`}>
      <header className="ts-dialog-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="ts-icon-button" onClick={onClose} aria-label={rtl ? "إغلاق" : "Close"}><X size={18} /></button></header>
      <div className="ts-dialog-body">{children}</div>
      {footer && <footer className="ts-dialog-foot">{footer}</footer>}
    </div>
  </div>;
}

export type PickerEmployee = { id: number; employee_code: string; name_en: string; name_ar: string; department_id: number | null };
const personName = (employee: PickerEmployee, rtl: boolean) => (rtl ? employee.name_ar || employee.name_en : employee.name_en || employee.name_ar);

/** Searchable employee combobox ("Search employee...", "All Employees", "No results found"). */
export function EmployeeCombobox({ rtl, employees, value, onChange, allowAll, disabled, id }: { rtl: boolean; employees: PickerEmployee[]; value: number; onChange: (id: number) => void; allowAll?: boolean; disabled?: boolean; id?: string }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const selected = employees.find(employee => employee.id === value);
  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    return text ? employees.filter(employee => `${employee.name_en} ${employee.name_ar} ${employee.employee_code}`.toLowerCase().includes(text)) : employees;
  }, [employees, query]);
  const label = selected ? `${personName(selected, rtl)} · ${selected.employee_code}` : allowAll ? (rtl ? "كل الموظفين" : "All Employees") : (rtl ? "اختر الموظف" : "Select employee");
  const pick = (next: number) => { onChange(next); setOpen(false); setQuery(""); };
  return <div className="ts-combobox" ref={box}>
    <button type="button" id={id} className="ts-select-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>{label}</button>
    {open && <div className="ts-combobox-panel">
      <label className="ts-combobox-search"><Search size={15} /><input ref={input => input?.focus()} value={query} onChange={event => setQuery(event.target.value)} placeholder={rtl ? "ابحث عن موظف..." : "Search employee..."} aria-label={rtl ? "ابحث عن موظف" : "Search employee"} /></label>
      <ul role="listbox">
        {allowAll && !query && <li><button type="button" role="option" aria-selected={!value} onClick={() => pick(0)}>{rtl ? "كل الموظفين" : "All Employees"}</button></li>}
        {matches.map(employee => <li key={employee.id}><button type="button" role="option" aria-selected={employee.id === value} onClick={() => pick(employee.id)}><b>{personName(employee, rtl)}</b><small dir="ltr">{employee.employee_code}</small></button></li>)}
        {!matches.length && <li className="ts-empty-option">{rtl ? "لا توجد نتائج" : "No results found"}</li>}
      </ul>
    </div>}
  </div>;
}

export type DepartmentNode = { id: number; parent_id: number | null; name_en: string; name_ar: string };
/** Departments as an indented list (parents before children) so a tree reads in a plain select. */
export function departmentOptions(departments: DepartmentNode[], rtl: boolean) {
  const byParent = new Map<number | null, DepartmentNode[]>();
  const ids = new Set(departments.map(department => department.id));
  for (const department of departments) {
    const parent = department.parent_id !== null && ids.has(department.parent_id) ? department.parent_id : null;
    (byParent.get(parent) ?? byParent.set(parent, []).get(parent)!).push(department);
  }
  const out: { id: number; label: string }[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const department of (byParent.get(parent) ?? []).sort((a, b) => a.name_en.localeCompare(b.name_en))) {
      out.push({ id: department.id, label: `${"  ".repeat(depth * 2)}${depth ? "└ " : ""}${rtl ? department.name_ar || department.name_en : department.name_en}` });
      walk(department.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function Badge({ tone, children }: { tone: "green" | "amber" | "red" | "blue" | "gray" | "violet"; children: ReactNode }) {
  return <span className={`ts-badge ${tone}`}>{children}</span>;
}

/** sessionStorage can be blocked; the page must work without it. */
export function readSession<T>(key: string, fallback: T): T {
  try { const raw = window.sessionStorage.getItem(key); return raw ? { ...fallback, ...JSON.parse(raw) } : fallback; } catch { return fallback; }
}
export function writeSession(key: string, value: unknown) {
  try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
