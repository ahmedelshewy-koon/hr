"use client";

import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { GripVertical } from 'lucide-react';
import { movePage, normalizePageOrder } from './page-order';
import { PAGE_LABELS, type PageId } from "./navigation-labels";
import "./page-availability.css";


export function PageAvailabilityPanel({ rtl, values, order, onToggle, onReorder }: {
  rtl: boolean;
  values: Record<string, unknown>;
  order?: unknown;
  onToggle: (page: string, enabled: boolean) => Promise<void>;
  onReorder: (pages: string[]) => Promise<void>;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<string[] | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ page: string; target: string; x: number; y: number; gx: number; gy: number; moved: boolean } | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number; gx: number; gy: number } | null>(null);
  const pages = draft ?? normalizePageOrder(order);
  // While dragging, the other cards close up around the lifted one so the drop position is visible.
  const shown = dragged && over ? movePage(pages, dragged, over) : pages;
  // The lifted card follows the pointer: it is translated from wherever its slot currently is to where the pointer holds it.
  useLayoutEffect(() => {
    const cards = grid.current?.querySelectorAll<HTMLElement>('[data-page-order]');
    if (!cards) return;
    cards.forEach(card => { if (card.dataset.pageOrder !== dragged || !pointer) card.style.transform = ''; });
    const card = dragged ? Array.from(cards).find(item => item.dataset.pageOrder === dragged) : null;
    if (!card || !pointer) return;
    card.style.transform = '';
    const slot = card.getBoundingClientRect();
    card.style.transform = `translate(${pointer.x - pointer.gx - slot.left}px, ${pointer.y - pointer.gy - slot.top}px)`;
  }, [dragged, pointer, over, shown]);
  async function reorder(source: string, target: string) {
    if (busy.current || source === target) return;
    const next = movePage(pages, source, target);
    if (next === pages) return;
    busy.current = true; setSaving('order'); setError(''); setDraft(next); setMessage('');
    try { await onReorder(next); setMessage(rtl ? 'تم حفظ ترتيب القائمة الجانبية' : 'Sidebar order saved'); }
    catch { setError(rtl ? 'تعذر حفظ الترتيب. تم استعادة الترتيب السابق.' : 'Unable to save order. The previous order was restored.'); }
    finally {
      busy.current = false; setSaving(null); setDraft(null);
      requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-page-order="${source}"] .page-order-handle`)?.focus());
    }
  }
  function cancelDrag() { gesture.current = null; setDragged(null); setOver(null); setPointer(null); }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current) return;
    if (!current.moved && Math.hypot(event.clientX-current.x, event.clientY-current.y) < 6) return;
    current.moved = true; setDragged(current.page); setPointer({ x: event.clientX, y: event.clientY, gx: current.gx, gy: current.gy });
    // The lifted card sits under the pointer, so hit-test through it and ignore it; over a gap the last target stays.
    const hit = document.elementsFromPoint(event.clientX, event.clientY).map(item => item.closest<HTMLElement>('[data-page-order]')).find(item => item && item.dataset.pageOrder !== current.page && grid.current?.contains(item));
    if (hit) current.target = hit.dataset.pageOrder!;
    setOver(current.target);
  }
  async function toggle(page: string) {
    if (busy.current || gesture.current) return;
    busy.current = true;
    setSaving(page);
    setError("");
    try { await onToggle(page, values[page] === false); }
    catch { setError(rtl ? "تعذر حفظ حالة الصفحة. حاول مرة أخرى." : "Unable to save page availability. Please try again."); }
    finally { busy.current = false; setSaving(null); }
  }
  return <section className="panel page-availability" aria-labelledby="page-availability-title">
    <div className="panel-head"><div>
      <h2 id="page-availability-title">{rtl ? "إتاحة الصفحات" : "Page availability"}</h2>
      <p id="page-order-help">{rtl ? 'اسحب مقبض الصفحة لترتيبها في القائمة الجانبية، أو استخدم الأسهم عند تحديد المقبض. يُحفظ الترتيب تلقائيًا لجميع المستخدمين حسب صلاحياتهم.' : 'Drag a page handle to reorder the sidebar, or use arrow keys while the handle is focused. Order saves automatically for all users, respecting their permissions.'}</p>
    </div></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <p className="page-order-status" role="status">{saving === 'order' ? (rtl ? 'جارٍ حفظ الترتيب…' : 'Saving order…') : message}</p>
    <div ref={grid} className="page-availability-grid" aria-busy={saving !== null}>{shown.map((page, index) => {
      const enabled = values[page] !== false;
      const label = PAGE_LABELS[page as PageId][rtl ? "ar" : "en"];
      return <article key={page} data-page-order={page} className={`page-availability-row${dragged === page ? ' is-dragging' : ''}`}>
        <button type="button" className="page-order-handle" disabled={saving !== null} aria-label={rtl ? `ترتيب ${label}` : `Reorder ${label}`} aria-describedby="page-order-help" title={rtl ? 'اسحب لتغيير الترتيب' : 'Drag to reorder'}
          onPointerDown={event => { if (event.button !== 0 || busy.current) return; event.currentTarget.setPointerCapture(event.pointerId); const card = event.currentTarget.closest('article')!.getBoundingClientRect(); gesture.current = { page, target: page, x: event.clientX, y: event.clientY, gx: event.clientX - card.left, gy: event.clientY - card.top, moved: false }; }}
          onPointerMove={pointerMove}
          onPointerUp={event => { const current = gesture.current; cancelDrag(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (current?.moved) void reorder(current.page, current.target); }}
          onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
          onKeyDown={event => {
            if (event.key === 'Escape') { cancelDrag(); return; }
            if (gesture.current) return;
            const delta = event.key === 'ArrowUp' || event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : 0;
            if (!delta) return;
            event.preventDefault();
            const target = pages[pages.indexOf(page) + delta];
            if (target) void reorder(page, target);
          }}><GripVertical size={18} aria-hidden="true"/><span className="page-order-position" aria-hidden="true">{index + 1}</span></button>
        <div><h3>{label}</h3><small>{page === "settings" && !enabled ? (rtl ? "مغلقة للآخرين · متاحة لمدير النظام" : "Closed for others · available to Super Admin") : enabled ? (rtl ? "مفتوحة حسب الصلاحيات" : "Open according to permissions") : (rtl ? "مغلقة للجميع" : "Closed for everyone")}</small></div>
        <button type="button" role="switch" aria-checked={enabled} aria-label={label} disabled={saving !== null} className={enabled ? "outline" : "primary"} onClick={() => void toggle(page)}>
          {saving === page ? (rtl ? "جارٍ الحفظ…" : "Saving…") : enabled ? (rtl ? "إغلاق الصفحة" : "Close page") : (rtl ? "فتح الصفحة" : "Open page")}
        </button>
      </article>;
    })}</div>
  </section>;
}
