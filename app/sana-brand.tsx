/** Shared bilingual wordmark: Arabic above English, beside the existing S mark. */
export function SanaBrand({ className = "", module = "HR", mark = true }: { className?: string; module?: string | null; mark?: boolean }) {
  return <span className={`sana-brand ${className}`} dir="ltr" role="img" aria-label={module ? `سنع — SANA ${module}` : "سنع — SANA"}>
    {mark && <img className="sana-brand-mark" src="/sana-mark.png" alt="" aria-hidden="true" />}
    <span className="sana-brand-wordmark" aria-hidden="true">
      <strong className="sana-brand-ar" lang="ar" dir="rtl">سنــع</strong>
      <span className="sana-brand-en" lang="en" dir="ltr">{module ? `SANA ${module}` : "SANA"}</span>
    </span>
  </span>;
}
