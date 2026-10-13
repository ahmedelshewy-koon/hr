"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";
const KEY = "hr-theme";

function applyTheme(theme: Theme) {
  if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
}

/** Light/Dark switch. The pre-paint script in layout.tsx applies the saved choice; this only mirrors and changes it. */
export function ThemeToggle({ rtl }: { rtl: boolean }) {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time post-hydration read of the attribute set before paint
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  }, []);
  useEffect(() => {
    // Printouts (org chart, payslips, certificates) are designed for paper: always print in Light.
    let restore = false;
    const before = () => { restore = document.documentElement.getAttribute("data-theme") === "dark"; if (restore) applyTheme("light"); };
    const after = () => { if (restore) applyTheme("dark"); restore = false; };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? (rtl ? "الوضع الداكن" : "Dark mode") : (rtl ? "الوضع الفاتح" : "Light mode");
  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
        try { window.localStorage.setItem(KEY, next); } catch { /* storage blocked: the choice lasts for this visit only */ }
      }}
    >
      {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}
