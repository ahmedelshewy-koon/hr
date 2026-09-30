"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Globe2 } from "lucide-react";
import "./country-flag-filter.css";

import { COUNTRIES } from "./employees/countries";
import { activeWorkCountries } from "./employees/work-country";

function CountryFlag({ country }: { country: string }) {
  const entry = COUNTRIES.find(item => item.value === country);
  return entry ? <img src={`/flags/${entry.code.toLowerCase()}.svg`} alt="" aria-hidden="true" /> : <Globe2 size={20}/>;
}

/** Top-bar button that shows the selected flag(s) and opens a panel with countries represented by employee work locations. An empty selection means all countries. */
export function CountryFlagFilter({ rtl, selected, available, onChange, onOpen }: {
  rtl: boolean;
  selected: string[];
  available: string[];
  onChange: (next: string[]) => void;
  /** Called when the panel opens, so the caller can close other top-bar panels. */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const label = rtl ? "الدولة حسب مقر العمل" : "Work location country";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const shown = activeWorkCountries(selected, available);
  const toggle = (country: string) => onChange([country]);

  return <div className="country-flag-filter" ref={rootRef}>
    <button ref={triggerRef} type="button" className="icon-btn country-flag-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} aria-label={label} title={label}
      onClick={() => { if (!open) onOpen?.(); setOpen(value => !value); }}>
      {shown.length ? <>{shown.slice(0,3).map(country => <span key={country} className="country-flag-mini"><CountryFlag country={country}/></span>)}{shown.length>3&&<span>+{shown.length-3}</span>}</> : <Globe2 size={20} />}
    </button>
    {open && <div className="country-flag-pop" id={panelId} role="dialog" aria-label={label}>
      <button type="button" className="country-flag-all" aria-pressed={!shown.length} onClick={()=>onChange([])}>{rtl?"كل مقار العمل":"All work locations"}</button>
      {!available.length&&<p>{rtl?"لا توجد مقار عمل مسجلة":"No work locations recorded"}</p>}
      {available.map(country => {
        const active = shown.includes(country);
        const entry = COUNTRIES.find(item => item.value === country);
        const name = rtl ? entry?.ar || country : country;
        return <button key={country} type="button" className={`country-flag${active ? " selected" : ""}`} aria-pressed={active} aria-label={name} title={name} onClick={() => toggle(country)}>
          <span className="country-flag-art"><CountryFlag country={country}/>{active && <span className="country-flag-check"><Check size={11} strokeWidth={3} /></span>}</span>
          <span className="country-flag-name">{name}</span>
        </button>;
      })}
    </div>}
  </div>;
}
