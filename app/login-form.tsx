"use client";

import { useState, useSyncExternalStore } from "react";
import { ArrowLeft, Check, CircleAlert, CircleHelp, Eye, EyeOff, LoaderCircle, Lock, Mail, Moon, ShieldCheck, Sunrise, SunMedium, Sunset, TriangleAlert } from "lucide-react";
import { localizeApiMessage } from "./api-messages";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function timeOfDay(hour: number) {
  if (hour >= 5 && hour < 12) return { text: "صباح الخير", Icon: Sunrise };
  if (hour >= 12 && hour < 17) return { text: "مساء الخير", Icon: SunMedium };
  if (hour >= 17 && hour < 20) return { text: "مساء الخير", Icon: Sunset };
  if (hour >= 20) return { text: "مساء الخير", Icon: Moon };
  return { text: "أهلًا بعودتك", Icon: Moon };
}

// The greeting depends on the visitor's clock: the server render (and hydration) stays neutral and it fills in on the client.
// getSnapshot must be referentially stable, so the Date is cached per minute.
let cachedNow: { minute: number; date: Date } | null = null;
function clientNow() {
  const minute = Math.floor(Date.now() / 60000);
  if (cachedNow?.minute !== minute) cachedNow = { minute, date: new Date() };
  return cachedNow.date;
}
const subscribeNever = () => () => {};
const serverNow = () => null;

function Greeting() {
  const now = useSyncExternalStore<Date | null>(subscribeNever, clientNow, serverNow);
  const { text, Icon } = now ? timeOfDay(now.getHours()) : { text: "أهلًا بعودتك", Icon: SunMedium };
  return (
    <p className="login-greeting" data-ready={now ? "true" : "false"}>
      <Icon size={15} aria-hidden="true" />
      <span>{text}</span>
      {now && <><i aria-hidden="true" /><time dateTime={now.toISOString()}>{new Intl.DateTimeFormat("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long" }).format(now)}</time></>}
    </p>
  );
}

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
            <img className="login-logo" src="/sanad-logo-glass.png" alt="سند" />
          </div>
          <div className="login-card">
            <div className="login-card-head">
              <span className="login-mark" aria-hidden="true"><span className="login-mark-ring" /><ShieldCheck size={26} strokeWidth={1.8} /></span>
              <div className="login-copy">
                <Greeting />
                <h1>تسجيل الدخول</h1>
              </div>
            </div>
            <p className="login-lead">أدخل بيانات حسابك للوصول إلى مساحة عملك.</p>
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
              {helpOpen && <p className="login-help" id="login-help"><CircleHelp size={16} aria-hidden="true" />لإعادة تعيين كلمة المرور، تواصل مع مسؤول الموارد البشرية أو مدير النظام في شركتك.</p>}
              {error && <p className="login-error" role="alert"><CircleAlert size={17} aria-hidden="true" />{error}</p>}
              <button className="login-submit" type="submit" disabled={loading}>
                {loading ? <><LoaderCircle className="login-spin" size={19} />جارٍ تسجيل الدخول...</> : <>تسجيل الدخول<ArrowLeft size={18} /></>}
              </button>
            </form>
            <p className="login-note"><strong>دخول مخصص لمستخدمي سند</strong>للحصول على حساب، تواصل مع مسؤول الموارد البشرية.</p>
          </div>
        </div>
        <footer className="login-footer"><span>© {new Date().getFullYear()} سند. جميع الحقوق محفوظة.</span><span>منصة موثوقة لإدارة فريقك</span></footer>
      </div>
    </section>
  );
}
