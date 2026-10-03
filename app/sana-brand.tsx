/** Shared SANA module wordmark. The supplied SVGs do not include a separate logo asset. Pass module={null} for the platform-level mark. */
export function SanaBrand({ className = "", module = "HR" }: { className?: string; module?: string | null }) {
  return <span className={`sana-brand ${className}`} dir="ltr" aria-label={module ? `SANA ${module}` : "SANA"}><strong>SANA</strong>{module && <i>{module}</i>}</span>;
}
