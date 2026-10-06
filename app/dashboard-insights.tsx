"use client";
import "./dashboard-insights.css";
import type { Row } from "./ui-types";

const COLORS = { dark: "#0B4237", mid: "#1C7B61", light: "#7ECDA9" };

export function DashboardInsights({ rtl, requests, typeLabel, onOpenRequests }: {
  rtl: boolean; requests: Row[]; typeLabel: (type: unknown) => string; onOpenRequests?: () => void;
}) {
  const statusOf = (r: Row) => String(r.status);
  const pending = requests.filter(r => statusOf(r).startsWith("pending")).length;
  const approved = requests.filter(r => statusOf(r) === "approved").length;
  const rejected = requests.filter(r => statusOf(r) === "rejected").length;
  const total = pending + approved + rejected;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  const num = (n: number) => new Intl.NumberFormat(rtl ? "ar-EG" : "en-US").format(n);
  const recent = [...requests].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, 5);
  const statusLabel = (s: string) => s.startsWith("pending") ? (rtl ? "قيد الانتظار" : "Pending") : s === "approved" ? (rtl ? "معتمد" : "Approved") : s === "rejected" ? (rtl ? "مرفوض" : "Rejected") : s;
  const statusTone = (s: string) => s.startsWith("pending") ? "blue" : s === "approved" ? "green" : s === "rejected" ? "red" : "blue";
  return <>
    <section className="insight-grid-side">
      <div className="panel insight-card">
        <div className="insight-head"><h2>{rtl ? "أحدث الطلبات" : "Latest requests"}</h2>{onOpenRequests && <button type="button" className="insight-all" onClick={onOpenRequests}>{rtl ? "الكل" : "All"}</button>}</div>
        {recent.length ? <div className="insight-table"><table>
          <thead><tr><th>{rtl ? "الموظف / الطلب" : "Employee / request"}</th><th>{rtl ? "التاريخ" : "Date"}</th><th>{rtl ? "الحالة" : "Status"}</th></tr></thead>
          <tbody>{recent.map(r => <tr key={r.id ?? r.request_code}>
            <td><b>{rtl ? (r.employee_name_ar || r.employee_name) : r.employee_name}</b><small>{typeLabel(r.type)} · {r.request_code}</small></td>
            <td dir="ltr">{String(r.created_at ?? "").slice(0, 10) || "—"}</td>
            <td><span className={`insight-tag ${statusTone(statusOf(r))}`}>{statusLabel(statusOf(r))}</span></td>
          </tr>)}</tbody>
        </table></div> : <p className="insight-empty">{rtl ? "لا توجد طلبات بعد." : "No requests yet."}</p>}
      </div>
      <div className="panel insight-card">
        <div className="insight-head"><h2>{rtl ? "حالة الطلبات" : "Request status"}</h2></div>
        <div className="insight-donut-wrap">
          <div className="insight-donut" style={{ background: total ? `conic-gradient(${COLORS.mid} 0 ${pct(approved)}%,${COLORS.dark} ${pct(approved)}% ${pct(approved) + pct(pending)}%,${COLORS.light} ${pct(approved) + pct(pending)}% 100%)` : "var(--sana-line)" }}>
            <div><b>{num(total)}</b><small>{rtl ? "إجمالي الطلبات" : "Total requests"}</small></div>
          </div>
          <div className="insight-legend"><span><i style={{ background: COLORS.mid }}/>{rtl ? "معتمد" : "Approved"} {num(approved)}</span><span><i style={{ background: COLORS.dark }}/>{rtl ? "قيد الانتظار" : "Pending"} {num(pending)}</span><span><i style={{ background: COLORS.light }}/>{rtl ? "مرفوض" : "Rejected"} {num(rejected)}</span></div>
        </div>
      </div>
    </section>
  </>;
}
