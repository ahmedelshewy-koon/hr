import { OrgScene } from "./login-artwork";

/** Eight-pointed star (Khatam), the geometric motif shared with the hero pattern. */
export function StarMark({ size = 14 }: { size?: number }) {
  return (
    <svg className="login-star" width={size} height={size} viewBox="-16 -16 32 32" aria-hidden="true">
      <path d="M-11.3-11.3H11.3V11.3H-11.3Z M0-16L16 0 0 16-16 0Z" fill="currentColor" fillRule="nonzero" />
    </svg>
  );
}

// Replaces the hero on narrow screens, where the two-column layout is not available.
export function LoginBand() {
  return (
    <header className="login-band">
      <p>أدر فريقك <strong>بثقة</strong><span>كل ما تحتاجه في مكان واحد.</span></p>
    </header>
  );
}

export function LoginShowcase() {
  return (
    <section className="login-visual" aria-label="مزايا منصة HR">
      <div className="login-visual-top">
        <span className="login-visual-brand" dir="ltr"><i>HR</i> PLATFORM</span>
      </div>
      <div className="login-visual-content">
        <h2>أدر فريقك <span>بثقة</span></h2>
        <p className="login-hero-subtitle">كل ما تحتاجه لإدارة الموارد البشرية في مكان واحد</p>
        <OrgScene />
      </div>
    </section>
  );
}
