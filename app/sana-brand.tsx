/** Shared SANA logo: the S mark (public/sana-mark.png) plus the wordmark. Pass module={null} for the platform-level mark. */
export function SanaBrand({ className = "", module = "HR", mark = true }: { className?: string; module?: string | null; mark?: boolean }) {
  return <span className={`sana-brand ${className}`} dir="ltr" aria-label={module ? `SANA ${module}` : "SANA"}>{mark && <img className="sana-brand-mark" src="/sana-mark.png" alt="" aria-hidden="true" />}<strong>SANA</strong>{module && <i>{module}</i>}</span>;
}
