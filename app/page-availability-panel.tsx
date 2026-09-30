"use client";

import { useState } from "react";
import { PAGE_MODULES } from "./page-availability";
import { PAGE_LABELS, type PageId } from "./navigation-labels";
import "./page-availability.css";


export function PageAvailabilityPanel({ rtl, values, onToggle }: {
  rtl: boolean;
  values: Record<string, unknown>;
  onToggle: (page: string, enabled: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function toggle(page: string) {
    setSaving(page);
    setError("");
    try { await onToggle(page, values[page] === false); }
    catch { setError(rtl ? "تعذر حفظ حالة الصفحة. حاول مرة أخرى." : "Unable to save page availability. Please try again."); }
    finally { setSaving(null); }
  }
  return <section className="panel page-availability" aria-labelledby="page-availability-title">
    <div className="panel-head"><div>
      <h2 id="page-availability-title">{rtl ? "إتاحة الصفحات" : "Page availability"}</h2>
    </div></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="page-availability-grid">{Object.keys(PAGE_MODULES).map(page => {
      const enabled = values[page] !== false;
      const label = PAGE_LABELS[page as PageId][rtl ? "ar" : "en"];
      return <article key={page} className="page-availability-row">
        <div><h3>{label}</h3><small>{page === "settings" && !enabled ? (rtl ? "مغلقة للآخرين · متاحة لمدير النظام" : "Closed for others · available to Super Admin") : enabled ? (rtl ? "مفتوحة حسب الصلاحيات" : "Open according to permissions") : (rtl ? "مغلقة للجميع" : "Closed for everyone")}</small></div>
        <button type="button" role="switch" aria-checked={enabled} aria-label={label} disabled={saving !== null} className={enabled ? "outline" : "primary"} onClick={() => void toggle(page)}>
          {saving === page ? (rtl ? "جارٍ الحفظ…" : "Saving…") : enabled ? (rtl ? "إغلاق الصفحة" : "Close page") : (rtl ? "فتح الصفحة" : "Open page")}
        </button>
      </article>;
    })}</div>
  </section>;
}
