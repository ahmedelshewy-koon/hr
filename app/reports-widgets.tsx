"use client";

import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Download, Loader2, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { personDepartment, personName, trend } from "./reports/report-format";
import type { Person } from "./reports/report-types";

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";

/** Shared by every report panel so they format, label and export the same way. */
export type ReportContext = {
  rtl: boolean;
  fmt: (value: number) => string;
  dateLabel: (iso: string) => string;
  exportCsv: (type: string) => void;
  exporting: string;
};

export const reportLocale = (rtl: boolean) => (rtl ? "ar-EG-u-nu-arab" : "en-GB");
export const makeNumberFormat = (rtl: boolean) => {
  const format = new Intl.NumberFormat(reportLocale(rtl), { maximumFractionDigits: 1 });
  return (value: number) => format.format(Number.isFinite(value) ? value : 0);
};
export const makeDateLabel = (rtl: boolean) => {
  const format = new Intl.DateTimeFormat(reportLocale(rtl), { day: "numeric", month: "short", timeZone: "UTC" });
  return (iso: string) => {
    const time = Date.parse(`${iso}T00:00:00Z`);
    return Number.isNaN(time) ? iso : format.format(new Date(time));
  };
};

export function Panel({ title, note, action, children, className = "" }: { title: string; note?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`rp-panel ${className}`.trim()}>
    <header><div><h2>{title}</h2>{note && <p>{note}</p>}</div>{action}</header>
    {children}
  </section>;
}

export function Empty({ text }: { text: string }) {
  return <p className="rp-empty">{text}</p>;
}

/**
 * Up/down chip against the previous period. `worseWhenUp` flips the colour for figures like absence where growth is bad,
 * `neutral` drops the good/bad colour for figures with no right direction, and `points` compares two percentages in points.
 */
export function Delta({ current, previous, worseWhenUp = false, neutral = false, points = false, rtl, fmt }: { current: number; previous: number | null; worseWhenUp?: boolean; neutral?: boolean; points?: boolean; rtl: boolean; fmt: (value: number) => string }) {
  if (previous == null) return null;
  let direction: "up" | "down" | "flat", amount: number;
  if (points) {
    const diff = Math.round((current - previous) * 10) / 10;
    direction = Math.abs(diff) < 0.5 ? "flat" : diff > 0 ? "up" : "down";
    amount = Math.abs(diff);
  } else {
    const change = trend(current, previous);
    if (!change) return null;
    direction = change.direction;
    amount = change.change;
  }
  const tone = direction === "flat" || neutral ? "neutral" : (direction === "up") === worseWhenUp ? "bad" : "good";
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  const size = points ? (rtl ? `${fmt(amount)} نقطة` : `${fmt(amount)} pts`) : `${fmt(amount)}%`;
  return <span className={`rp-delta ${tone}`} title={rtl ? "مقارنة بالفترة السابقة لها بنفس الطول" : "Compared with the previous period of the same length"}>
    <Icon size={13}/>{direction === "flat" ? (rtl ? "بدون تغيير" : "No change") : size}<small>{rtl ? "عن السابقة" : "vs previous"}</small>
  </span>;
}

export function Kpi({ icon: Icon, label, value, hint, tone = "neutral", delta }: { icon: LucideIcon; label: string; value: string; hint?: string; tone?: Tone; delta?: ReactNode }) {
  return <div className={`rp-kpi ${tone}`}>
    <span className="rp-kpi-icon"><Icon size={18}/></span>
    <div><b>{value}</b><span>{label}</span>{hint && <small>{hint}</small>}{delta}</div>
  </div>;
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="rp-kpis">{children}</div>;
}

export function BarList({ rows, fmt, empty, suffix = "" }: { rows: { label: string; value: number; note?: string; tone?: Tone }[]; fmt: (value: number) => string; empty: string; suffix?: string }) {
  const max = Math.max(1, ...rows.map(row => row.value));
  if (!rows.length) return <Empty text={empty}/>;
  return <ul className="rp-bars">{rows.map(row => <li key={row.label} title={`${row.label}: ${fmt(row.value)}${suffix}`}>
    <span className="rp-bar-label">{row.label}</span>
    <span className="rp-bar-track"><i className={row.tone || "info"} style={{ width: `${Math.max(row.value > 0 ? 3 : 0, (row.value / max) * 100)}%` }}/></span>
    <b>{fmt(row.value)}{suffix}</b>
    {row.note && <small>{row.note}</small>}
  </li>)}</ul>;
}

/** One proportional bar split into labelled parts, e.g. approved / waiting / rejected. */
export function StackBar({ parts, fmt }: { parts: { label: string; value: number; tone: Tone }[]; fmt: (value: number) => string }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (!total) return null;
  return <div className="rp-stack">
    <div className="rp-stack-bar" role="img" aria-label={parts.map(part => `${part.label} ${fmt(part.value)}`).join("، ")}>
      {parts.filter(part => part.value > 0).map(part => <i key={part.label} className={part.tone} style={{ flexGrow: part.value }} title={`${part.label}: ${fmt(part.value)}`}/>)}
    </div>
    <ul>{parts.map(part => <li key={part.label}><i className={part.tone}/>{part.label}<b>{fmt(part.value)}</b></li>)}</ul>
  </div>;
}

type DayPoint = { date: string; attended: number; late: number; absent: number };
type Column = { onTime: number; late: number; absent: number; label: string };

/** Days with no data (weekends, holidays) are dropped; long periods are folded into weeks so the chart stays readable. */
function chartColumns(points: DayPoint[], dateLabel: (iso: string) => string): Column[] {
  const days = points.filter(point => point.attended + point.absent > 0);
  const size = days.length > 31 ? 7 : 1;
  const columns: Column[] = [];
  for (let index = 0; index < days.length; index += size) {
    const chunk = days.slice(index, index + size);
    columns.push({
      onTime: chunk.reduce((sum, day) => sum + Math.max(0, day.attended - day.late), 0),
      late: chunk.reduce((sum, day) => sum + day.late, 0),
      absent: chunk.reduce((sum, day) => sum + day.absent, 0),
      label: dateLabel(chunk[0].date),
    });
  }
  return columns;
}

export function AttendanceChart({ points, labels, dateLabel, fmt }: { points: DayPoint[]; labels: { onTime: string; late: string; absent: string; empty: string }; dateLabel: (iso: string) => string; fmt: (value: number) => string }) {
  const columns = chartColumns(points, dateLabel);
  if (!columns.length) return <Empty text={labels.empty}/>;
  const max = Math.max(1, ...columns.map(column => column.onTime + column.late + column.absent));
  const every = Math.ceil(columns.length / 8);
  return <div className="rp-chart">
    <ul className="rp-legend"><li><i className="good"/>{labels.onTime}</li><li><i className="warn"/>{labels.late}</li><li><i className="bad"/>{labels.absent}</li></ul>
    <div className="rp-columns" style={{ gridTemplateColumns: `repeat(${columns.length},minmax(0,1fr))` }}>
      {columns.map((column, index) => <div key={index} className="rp-column" title={`${column.label} — ${labels.onTime}: ${fmt(column.onTime)} · ${labels.late}: ${fmt(column.late)} · ${labels.absent}: ${fmt(column.absent)}`}>
        <div className="rp-column-stack" style={{ height: `${((column.onTime + column.late + column.absent) / max) * 100}%` }}>
          {column.absent > 0 && <i className="bad" style={{ flexGrow: column.absent }}/>}
          {column.late > 0 && <i className="warn" style={{ flexGrow: column.late }}/>}
          {column.onTime > 0 && <i className="good" style={{ flexGrow: column.onTime }}/>}
        </div>
        <span>{index % every === 0 ? column.label : ""}</span>
      </div>)}
    </div>
  </div>;
}

export type TableColumn<T> = { header: string; cell: (row: T) => ReactNode; number?: boolean };

export function DataTable<T>({ columns, rows, empty, footer }: { columns: TableColumn<T>[]; rows: T[]; empty: string; footer?: string }) {
  if (!rows.length) return <Empty text={empty}/>;
  return <div className="rp-table-scroll">
    <table className="rp-table">
      <thead><tr>{columns.map(column => <th key={column.header} className={column.number ? "num" : undefined}>{column.header}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{columns.map(column => <td key={column.header} className={column.number ? "num" : undefined}>{column.cell(row)}</td>)}</tr>)}</tbody>
    </table>
    {footer && <p className="rp-table-note">{footer}</p>}
  </div>;
}

export function PersonCell({ person, rtl }: { person: Person; rtl: boolean }) {
  const department = personDepartment(person, rtl);
  return <div className="rp-person"><b>{personName(person, rtl)}</b><small>{person.employee_code}{department ? ` · ${department}` : ""}</small></div>;
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`rp-badge ${tone}`}>{children}</span>;
}

export function Ltr({ children }: { children: ReactNode }) {
  return <span dir="ltr" style={{ whiteSpace: "nowrap" }}>{children}</span>;
}

export function Meter({ value, tone }: { value: number; tone?: Tone }) {
  const bounded = Math.max(0, Math.min(100, value));
  return <span className="rp-meter" role="img" aria-label={`${Math.round(bounded)}%`}><i className={tone ?? (bounded >= 90 ? "bad" : bounded >= 70 ? "warn" : "info")} style={{ width: `${bounded}%` }}/></span>;
}

export function ExportButton({ label, busy, onClick, primary = false }: { label: string; busy: boolean; onClick: () => void; primary?: boolean }) {
  return <button type="button" className={primary ? "primary rp-export" : "outline rp-export"} disabled={busy} onClick={onClick}>
    {busy ? <Loader2 size={15} className="rp-spin"/> : <Download size={15}/>}{label}
  </button>;
}
