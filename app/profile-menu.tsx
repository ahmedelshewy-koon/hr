"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Building2, Download, LogOut, Mail, Smartphone } from "lucide-react";
import { promptInstall, useInstallMode } from "./pwa-install";

type ProfileMenuProps = {
  initials: string;
  name: string;
  /** Set when `name` is really the email address, so it renders left-to-right. */
  nameIsEmail?: boolean;
  email: string;
  role: string;
  department?: string;
  rtl: boolean;
  /** Called when the menu opens, so the caller can close other top-bar panels. */
  onOpen?: () => void;
  onLogout: () => void;
};

export function ProfileMenu({ initials, name, nameIsEmail, email, role, department, rtl, onOpen, onLogout }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const label = rtl ? "الحساب" : "Account";
  const installMode = useInstallMode();
  const installHint = installMode === "ios"
    ? (rtl ? "لتثبيت التطبيق: اضغط زر المشاركة في Safari ثم «إضافة إلى الشاشة الرئيسية»." : "To install: tap Share in Safari, then “Add to Home Screen”.")
    : installMode === "manual"
      ? (rtl ? "لتثبيت التطبيق: افتح قائمة المتصفح (⋮) ثم «إضافة إلى الشاشة الرئيسية»." : "To install: open the browser menu (⋮), then “Add to Home screen”.")
      : null;

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

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="profile-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(value => !value);
        }}
      >
        <span className="avatar small blue">{initials}</span>
      </button>
      {open && (
        <div className="profile-pop" id={menuId} role="dialog" aria-label={label}>
          <div className="profile-pop-head">
            <span className="avatar blue">{initials}</span>
            <div>
              <b dir={nameIsEmail ? "ltr" : undefined}>{name}</b>
              <span className="profile-pop-role">{role}</span>
            </div>
          </div>
          <div className="profile-pop-rows">
            <div><Mail size={16} /><span dir="ltr">{email}</span></div>
            {department && <div><Building2 size={16} /><span>{department}</span></div>}
          </div>
          {installMode === "prompt" && (
            <button type="button" className="profile-pop-install" onClick={() => { setOpen(false); void promptInstall(); }}>
              <Download size={17} />{rtl ? "تثبيت التطبيق على الجهاز" : "Install app"}
            </button>
          )}
          {installHint && <p className="profile-pop-install-hint"><Smartphone size={16} /><span>{installHint}</span></p>}
          <button type="button" className="profile-pop-logout" onClick={onLogout}>
            <LogOut size={17} />{rtl ? "تسجيل الخروج" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
