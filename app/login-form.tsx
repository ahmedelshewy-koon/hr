"use client";
import { SanaBrand } from "./sana-brand";

import { useState } from "react";
import { ArrowLeft, Check, CircleAlert, CircleHelp, Eye, EyeOff, LoaderCircle, Lock, Mail, TriangleAlert } from "lucide-react";
import { localizeApiMessage } from "./api-messages";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function LoginForm<User>({ onSuccess }: { onSuccess: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const emailValid = EMAIL_PATTERN.test(email.trim());

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(localizeApiMessage(body.error || "تعذر تسجيل الدخول"));
      onSuccess(body.user as User);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "تعذر تسجيل الدخول");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="login-panel">
      <div className="login-panel-inner">
        <div className="login-main">
          <div className="login-brand">
            <SanaBrand />
          </div>
          <div className="login-card">
            <div className="login-card-head">
              <div className="login-copy">
                <h1>تسجيل الدخول</h1>
              </div>
            </div>
            <form className="login-form" onSubmit={event => void submit(event)}>
              <div className="login-field">
                <div className="login-field-head"><label htmlFor="login-email">البريد الإلكتروني</label></div>
                <div className="login-input">
                  <span className="login-input-icon"><Mail size={19} aria-hidden="true" /></span>
                  <input id="login-email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} value={email} onChange={event => setEmail(event.target.value)} placeholder="name@company.com" aria-invalid={error ? true : undefined} required dir="ltr" />
                  {emailValid && !error && <span className="login-valid" aria-hidden="true"><Check size={13} strokeWidth={3.2} /></span>}
                </div>
              </div>
              <div className="login-field">
                <div className="login-field-head">
                  <label htmlFor="login-password">كلمة المرور</label>
                  <button className="login-link login-forgot" type="button" onClick={() => setHelpOpen(value => !value)} aria-expanded={helpOpen} aria-controls="login-help">نسيت كلمة المرور؟</button>
                </div>
                <div className="login-input">
                  <span className="login-input-icon"><Lock size={19} aria-hidden="true" /></span>
                  <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} onKeyDown={event => setCapsLock(event.getModifierState("CapsLock"))} onKeyUp={event => setCapsLock(event.getModifierState("CapsLock"))} onBlur={() => setCapsLock(false)} placeholder="••••••••" aria-invalid={error ? true : undefined} required dir="ltr" />
                  <button className="password-toggle" type="button" onClick={() => setShowPassword(value => !value)} aria-pressed={showPassword} aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>
                {capsLock && <p className="login-caps" role="status"><TriangleAlert size={14} aria-hidden="true" />زر Caps Lock مفعّل</p>}
              </div>
              {helpOpen && <p className="login-help" id="login-help"><CircleHelp size={16} aria-hidden="true" />لإعادة تعيين كلمة المرور، تواصل مع مسؤول الموارد البشرية.</p>}
              {error && <p className="login-error" role="alert"><CircleAlert size={17} aria-hidden="true" />{error}</p>}
              <button className="login-submit" type="submit" disabled={loading}>
                {loading ? <><LoaderCircle className="login-spin" size={19} />جارٍ تسجيل الدخول...</> : <>تسجيل الدخول<ArrowLeft size={18} /></>}
              </button>
            </form>
          </div>
        </div>
        <footer className="login-footer"><span>© {new Date().getFullYear()} HR. جميع الحقوق محفوظة.</span><span>منصة موثوقة لإدارة فريقك</span></footer>
      </div>
    </section>
  );
}
