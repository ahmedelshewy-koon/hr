"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock, MoreHorizontal, Pencil, Undo2 } from "lucide-react";
import "./holiday-actions.css";

const MENU_WIDTH = 200;

/**
 * Row actions for an official holiday. The register scrolls horizontally, which would clip an absolutely
 * positioned menu, so the menu is fixed to the viewport at the button and closes on any outside interaction.
 */
export function HolidayActionsMenu({ rtl, postponed, onEdit, onPostpone, onCancelPostponement }: {
  rtl: boolean; postponed: boolean; onEdit: () => void; onPostpone: () => void; onCancelPostponement: () => void;
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const onPointer = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [position]);

  const toggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (position) { setPosition(null); return; }
    const box = event.currentTarget.getBoundingClientRect();
    const left = rtl ? box.left : box.right - MENU_WIDTH;
    setPosition({ top: box.bottom + 4, left: Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8)) });
  };
  const choose = (action: () => void) => () => { setPosition(null); action(); };

  return <>
    <button className="plain-icon" type="button" aria-haspopup="menu" aria-expanded={Boolean(position)} aria-label={rtl ? "إجراءات الإجازة" : "Holiday actions"} onClick={toggle}><MoreHorizontal size={20} /></button>
    {position && <div className="holiday-menu" role="menu" ref={menu} style={{ top: position.top, left: position.left, width: MENU_WIDTH }}>
      <button type="button" role="menuitem" onClick={choose(onEdit)}><Pencil size={16} />{rtl ? "تعديل" : "Edit"}</button>
      {postponed
        ? <button type="button" role="menuitem" onClick={choose(onCancelPostponement)}><Undo2 size={16} />{rtl ? "إلغاء الترحيل" : "Cancel postponement"}</button>
        : <button type="button" role="menuitem" onClick={choose(onPostpone)}><CalendarClock size={16} />{rtl ? "ترحيل" : "Postpone"}</button>}
    </div>}
  </>;
}
