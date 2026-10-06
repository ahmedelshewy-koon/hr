import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import {
  ArrowLeft, BadgeCheck, Building2, CalendarCheck, CalendarDays, ChartColumn, Check, ClipboardCheck, Clock3, Eye,
  Fingerprint, GraduationCap, IdCard, Layers, LogIn, Menu, Network, ShieldCheck, Smartphone, TrendingUp, UserPlus,
  UsersRound, Wallet, X,
} from "lucide-react";
import { SanaBrand } from "./sana-brand";
import { StarMark } from "./login-showcase";
import "./landing.css";

/** The sign-in screen is the same SPA view, reached through this hash so the browser back button returns here. */
export const LOGIN_HASH = "#login";
const DEMO_HREF = `mailto:?subject=${encodeURIComponent("طلب عرض توضيحي لنظام SANA HR")}`;

const NAV = [
  { href: "#platform", label: "الوحدات" },
  { href: "#benefits", label: "المزايا" },
  { href: "#why", label: "لماذا سنع HR" },
  { href: "#start", label: "كيف تبدأ" },
];

/** The modules in the order an employee meets them, grouped into the three stages of the roadmap. */
const STAGES = [
  {
    title: "الاستقطاب والتعيين",
    modules: [
      { Icon: UserPlus, name: "التوظيف", lead: "من نشر الوظيفة حتى قبول العرض، كل مرشح ومقابلة في مسار واحد.", points: ["مراحل المرشحين", "جدولة المقابلات"] },
      { Icon: IdCard, name: "ملفات الموظفين", lead: "ملف رقمي شامل يجمع بيانات الموظف وعقده ومستنداته وتاريخ خدمته.", points: ["بيانات وظيفية", "عقود ومستندات"] },
      { Icon: Network, name: "الهيكل التنظيمي", lead: "الشركات والفروع والإدارات والمسميات الوظيفية في هيكل واحد واضح.", points: ["مخطط مرئي", "تعدد الفروع"] },
    ],
  },
  {
    title: "العمل اليومي",
    modules: [
      { Icon: Fingerprint, name: "الحضور والانصراف", lead: "سجلات الحضور تصل تلقائيًا من أجهزة البصمة، مع ورديات وجداول دوام مرنة.", points: ["أجهزة البصمة", "رصد التأخير"] },
      { Icon: CalendarDays, name: "الإجازات", lead: "طلبات إجازة واضحة وأرصدة محدّثة لكل موظف وفق سياسة شركتك.", points: ["سياسات مرنة", "أرصدة تلقائية"] },
      { Icon: ClipboardCheck, name: "الاعتمادات والإجراءات", lead: "كل طلب يصل إلى المسؤول الصحيح ويُعتمد بخطوة واحدة مع سجل موثّق.", points: ["موافقات متعددة", "سجل كامل"] },
    ],
  },
  {
    title: "المكافأة والنمو",
    modules: [
      { Icon: Wallet, name: "الرواتب", lead: "مسيرات رواتب مبنية على الحضور والإجازات والسلف، جاهزة للمراجعة والاعتماد.", points: ["بدلات وسلف", "كشوف رواتب"] },
      { Icon: GraduationCap, name: "التدريب والتقييم", lead: "برامج تدريب ومسارات تعلّم تُقاس نتائجها بالتقييمات والشهادات.", points: ["دورات وبرامج", "شهادات إتمام"] },
      { Icon: ChartColumn, name: "التقارير والتحليلات", lead: "مؤشرات القوى العاملة لحظة بلحظة: الحضور والإجازات وتكلفة الرواتب.", points: ["لوحات مؤشرات", "تقارير للإدارة"] },
    ],
  },
] as const;

const BENEFITS = [
  { Icon: Layers, title: "ملف واحد لكل موظف", text: "البيانات الوظيفية والحضور والإجازات والرواتب في ملف واحد محدّث، بلا جداول متفرقة ولا إدخال مكرر للبيانات.", wide: true },
  { Icon: Fingerprint, title: "حضور بلا متابعة يدوية", text: "سجلات البصمة تصل تلقائيًا، والتأخير والغياب يُرصدان دون جداول أو مراجعة يدوية." },
  { Icon: Wallet, title: "رواتب دقيقة في موعدها", text: "المسير يُبنى على بيانات الحضور والإجازات والسلف، ويُعتمد بثقة كل شهر." },
  { Icon: ClipboardCheck, title: "موافقات أسرع", text: "طلبات الإجازة والسلف والإجراءات تصل إلى المسؤول الصحيح فورًا." },
  { Icon: TrendingUp, title: "جاهزة لنموّك", text: "أضف شركات وفروعًا وإدارات جديدة دون أن تغيّر نظامك أو طريقة عملك." },
  { Icon: Smartphone, title: "خدمة ذاتية للموظف", text: "يقدّم الموظف طلباته ويتابع رصيد إجازاته وكشف راتبه من المكتب أو الجوال." },
] as const;

const PILLARS = [
  { Icon: Eye, title: "الوضوح", text: "مصدر واحد لبيانات الموظفين يتفق عليه فريق الموارد البشرية والمديرون والإدارة العليا." },
  { Icon: ShieldCheck, title: "التحكم", text: "صلاحيات دقيقة لكل دور، ومسارات موافقة موثقة، وسجل كامل لكل إجراء." },
  { Icon: Network, title: "قابلية التوسع", text: "هيكل مرن يدعم تعدد الشركات والفروع والدول مع نمو فريقك." },
] as const;

const STATS = [
  { value: "1", unit: "ملف", label: "لكل موظف من التعيين حتى نهاية الخدمة" },
  { value: "9", unit: "وحدات", label: "تغطي رحلة الموظف كاملة" },
  { value: "100%", unit: "", label: "واجهة عربية أصيلة من اليمين لليسار" },
  { value: "24/7", unit: "", label: "وصول آمن للموظفين والمديرين من المكتب أو الجوال" },
] as const;

const STEPS = [
  { title: "احجز عرضًا", text: "نتعرف على شركتك وسياسات الموارد البشرية لديك، ونعرض لك سنع HR على سيناريوهاتك الفعلية." },
  { title: "نهيّئ نظامك", text: "نبني الهيكل التنظيمي والصلاحيات وسياسات الإجازات، ونرحّل بيانات موظفيك بإشراف فريقك." },
  { title: "ابدأ العمل", text: "يسجّل فريق الموارد البشرية والموظفون الدخول ويعملون من اليوم الأول على نظام واحد واضح." },
] as const;

function Wordmark() {
  return <a className="landing-wordmark" href="#top" aria-label="SANA HR — الصفحة الرئيسية"><SanaBrand module="HR" /></a>;
}

const SCENE_TEAM = 139;
const SCENE_PROFILES = [
  { initial: "س", name: "سارة العتيبي", role: "أخصائية موارد بشرية", branch: "الرياض", unit: "إدارة الموارد البشرية" },
  { initial: "م", name: "محمد القحطاني", role: "محاسب أول", branch: "جدة", unit: "الإدارة المالية" },
  { initial: "ن", name: "نورة الدوسري", role: "مطوّرة برمجيات", branch: "الدمام", unit: "إدارة التقنية" },
] as const;
const SCENE_LEAVES = [
  { initial: "خ", name: "خالد الشهري", type: "إجازة سنوية", days: 5, period: "5 أيام", balance: 21 },
  { initial: "ر", name: "ريم الحربي", type: "إجازة مرضية", days: 2, period: "يومان", balance: 12 },
  { initial: "ف", name: "فهد المطيري", type: "إجازة سنوية", days: 3, period: "3 أيام", balance: 18 },
] as const;
const SCENE_CHECKINS = ["أحمد", "لمى", "يوسف", "هند", "عمر", "دانة", "بدر"] as const;
const SCENE_PAYROLL = [[38, 54, 46, 70, 62, 84], [42, 50, 58, 66, 60, 88], [36, 58, 52, 64, 72, 80]] as const;

/** Link paths from the hub (path start) to each card corner, for the side-by-side and the stacked layouts. */
const SCENE_LINKS = {
  wide: { tl: "M50 50 C 22 50, 26 25, 0 25", bl: "M50 50 C 22 50, 26 75, 0 75", tr: "M50 50 C 78 50, 74 25, 100 25", br: "M50 50 C 78 50, 74 75, 100 75" },
  stacked: { tr: "M50 50 C 50 22, 75 26, 75 0", tl: "M50 50 C 50 22, 25 26, 25 0", br: "M50 50 C 50 78, 75 74, 75 100", bl: "M50 50 C 50 78, 25 74, 25 100" },
} as const;
type SceneLink = keyof typeof SCENE_LINKS.wide;

/** The live story, one beat at a time: each module sends an update into the shared record or receives one from it. */
const SCENE_BEATS = [
  { card: "attendance", link: "tl", inbound: true, chip: "بصمة ← حضور", Icon: Fingerprint },
  { card: "payroll", link: "bl", inbound: false, chip: "حضور ← رواتب", Icon: Wallet },
  { card: "leave", link: "br", inbound: true, chip: "طلب ← موافقة", Icon: Check },
  { card: "profile", link: "tr", inbound: false, chip: "رصيد ← ملف الموظف", Icon: IdCard },
] as const;
const SCENE_BEAT_MS = 2400;

/** Advances the scene while it is on screen and the tab is visible; stays on the first frame for reduced motion. */
function useSceneClock(ref: RefObject<HTMLDivElement | null>) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let visible = !("IntersectionObserver" in window);
    let timer = 0;
    const sync = () => {
      if (visible && !document.hidden) {
        if (!timer) timer = window.setInterval(() => setTick(value => value + 1), SCENE_BEAT_MS);
      } else if (timer) {
        window.clearInterval(timer);
        timer = 0;
      }
    };
    const observer = visible ? null : new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer?.observe(node);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [ref]);
  return tick;
}

/** Subtle 3D tilt and glare that follow the mouse; touch and reduced motion keep the panel flat. */
function tiltScene(event: ReactPointerEvent<HTMLDivElement>) {
  const node = event.currentTarget;
  if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rect = node.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  node.style.setProperty("--tilt-x", `${((0.5 - y) * 5).toFixed(2)}deg`);
  node.style.setProperty("--tilt-y", `${((x - 0.5) * 7).toFixed(2)}deg`);
  node.style.setProperty("--glare-x", `${(x * 100).toFixed(1)}%`);
  node.style.setProperty("--glare-y", `${(y * 100).toFixed(1)}%`);
}

function resetScene(event: ReactPointerEvent<HTMLDivElement>) {
  for (const name of ["--tilt-x", "--tilt-y"]) event.currentTarget.style.setProperty(name, "0deg");
}

/** Decorative live product panel: four HR workspaces exchanging updates through the shared SANA HR employee record. */
function HrScene() {
  const rootRef = useRef<HTMLDivElement>(null);
  const tick = useSceneClock(rootRef);
  const beatIndex = tick % SCENE_BEATS.length;
  const round = Math.floor(tick / SCENE_BEATS.length);
  const beat = SCENE_BEATS[beatIndex];
  const previous = SCENE_BEATS[(beatIndex + SCENE_BEATS.length - 1) % SCENE_BEATS.length];

  const present = 127 + (round % 8);
  const percent = Math.round((present / SCENE_TEAM) * 100);
  const arrivals = [0, 1, 2].map(offset => SCENE_CHECKINS[(round - offset + SCENE_CHECKINS.length * 4) % SCENE_CHECKINS.length]);
  const checkInTime = `08:${String(2 + (round % SCENE_CHECKINS.length) * 4).padStart(2, "0")}`;

  const payrollRound = beatIndex >= 1 ? round : Math.max(round - 1, 0);
  const bars = SCENE_PAYROLL[payrollRound % SCENE_PAYROLL.length];

  const leaveIndex = round % SCENE_LEAVES.length;
  const leave = SCENE_LEAVES[leaveIndex];
  const approved = beatIndex >= 2;

  const profileIndex = (beatIndex >= 3 ? round + 1 : round) % SCENE_PROFILES.length;
  const profile = SCENE_PROFILES[profileIndex];

  const feed = [
    `تسجيل حضور: ${arrivals[0]} · ${checkInTime}`,
    "تحديث مسير الرواتب تلقائيًا",
    `اعتماد إجازة ${leave.name}`,
    `تحديث ملف ${profile.name}`,
  ][beatIndex];
  const active = (card: string) => (beat.card === card ? " is-active" : "");

  const links = (layout: keyof typeof SCENE_LINKS) => (Object.entries(SCENE_LINKS[layout]) as [SceneLink, string][]).map(([key, d]) => (
    <path key={key} className={`landing-scene-link${beat.link === key ? " is-active" : ""}`} d={d} />
  ));
  const packet = (layout: keyof typeof SCENE_LINKS) => (
    <path key={`packet-${tick}`} className={`landing-scene-packet${beat.inbound ? " is-in" : ""}`} d={SCENE_LINKS[layout][beat.link]} pathLength={100} />
  );

  return (
    <div ref={rootRef} className="landing-hero-visual" role="img" aria-label="لوحة سنع HR: ملف الموظف والحضور والإجازات والرواتب في نظام واحد" onPointerMove={tiltScene} onPointerLeave={resetScene}>
      <span className="landing-glare" aria-hidden="true" />
      <div className="landing-panel-bar" aria-hidden="true">
        <span className="landing-panel-title"><StarMark size={14} /> لوحة الموارد البشرية</span>
        <span className="landing-panel-status"><span className="landing-panel-live">مباشر</span><span className="landing-panel-dots"><i /><i /><i /></span></span>
      </div>

      <div className="landing-scene" aria-hidden="true">
        <div className={`landing-card landing-card-profile${active("profile")}`}>
          <header><span className="landing-card-tag">الموظفون</span><b>ملف الموظف</b></header>
          <div className="landing-person landing-swap" key={`profile-${profileIndex}`}><i>{profile.initial}</i><div><b>{profile.name}</b><small>{profile.role}</small></div></div>
          <ul className="landing-meta">
            <li><span>الفرع</span><b className="landing-swap" key={`branch-${profileIndex}`}>{profile.branch}</b></li>
            <li><span>الحالة</span><b className="is-ok">على رأس العمل</b></li>
          </ul>
          <p><Network size={14} /> <span className="landing-swap" key={`unit-${profileIndex}`}>تتبع {profile.unit}</span></p>
        </div>

        <div className={`landing-card landing-card-attendance${active("attendance")}`}>
          {beatIndex === 0 && <span className="landing-toast" key={`toast-${tick}`}><Fingerprint size={12} /> {arrivals[0]} · {checkInTime}</span>}
          <header><span className="landing-card-tag">الحضور</span><b>حضور اليوم</b></header>
          <div className="landing-ring-row">
            <span className="landing-ring"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" pathLength="100" style={{ strokeDasharray: `${percent} 100` }} /></svg><b className="landing-swap" key={`pct-${percent}`}>{percent}%</b></span>
            <span className="landing-avatars">{arrivals.map(name => <i key={name} className="landing-pop">{name[0]}</i>)}<i>+</i></span>
          </div>
          <p><Clock3 size={14} /> <span className="landing-swap" key={`present-${present}`}>{present} من {SCENE_TEAM} موظفًا حاضرون</span></p>
        </div>

        <div className="landing-hub">
          <svg className="landing-hub-lines landing-hub-lines-wide" viewBox="0 0 100 100" preserveAspectRatio="none" fill="none">{links("wide")}{packet("wide")}</svg>
          <svg className="landing-hub-lines landing-hub-lines-stacked" viewBox="0 0 100 100" preserveAspectRatio="none" fill="none">{links("stacked")}{packet("stacked")}</svg>
          {(["tr", "tl", "br", "bl"] as const).map(key => <i key={key} className={`landing-hub-node landing-hub-node-${key}${beat.link === key ? " is-active" : ""}`} />)}
          <span className="landing-flow-chip landing-flow-chip-right is-current" key={`chip-${tick}`}><beat.Icon size={13} strokeWidth={2.6} /> {beat.chip}</span>
          <span className="landing-flow-chip landing-flow-chip-left" key={`chip-prev-${tick}`}><previous.Icon size={13} /> {previous.chip}</span>
          <div className="landing-core">
            <span className="landing-core-pulse" key={`pulse-${tick}`} />
            <StarMark size={34} />
            <b dir="ltr">SANA HR</b>
            <small>ملف موظف واحد</small>
          </div>
        </div>

        <div className={`landing-card landing-card-leave${active("leave")}`}>
          <header><span className="landing-card-tag">الإجازات</span><b>طلب إجازة</b></header>
          <div className="landing-person landing-swap" key={`leave-${leaveIndex}`}><i>{leave.initial}</i><div><b>{leave.name}</b><small>{leave.type} · {leave.period}</small></div></div>
          <ul className="landing-meta">
            <li><span>الرصيد المتبقي</span><b className="landing-swap" key={`balance-${leaveIndex}-${approved}`}>{approved ? leave.balance - leave.days : leave.balance} يومًا</b></li>
            <li><span>الحالة</span>{approved ? <b className="is-ok landing-swap" key="approved">تم الاعتماد</b> : <b className="is-pending" key="pending">بانتظار الاعتماد</b>}</li>
          </ul>
          {approved
            ? <div className="landing-leave-done landing-swap"><Check size={14} strokeWidth={3} /> خُصم {leave.period} من الرصيد</div>
            : <div className="landing-leave-actions"><span>اعتماد</span><span>رفض</span></div>}
        </div>

        <div className={`landing-card landing-card-payroll${active("payroll")}`}>
          <header><span className="landing-card-tag">الرواتب</span><b>مسير الشهر</b></header>
          <div className="landing-bars">{bars.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
          <p><CalendarCheck size={14} /> <span className="landing-swap" key={`payroll-${beatIndex === 1}`}>{beatIndex === 1 ? "جارٍ احتساب الحضور…" : "جاهز للاعتماد"}</span></p>
        </div>
      </div>

      <div className="landing-panel-foot" aria-hidden="true">
        <span><UsersRound size={14} /> {SCENE_TEAM} موظفًا</span>
        <span><Network size={14} /> 6 إدارات</span>
        <span><Building2 size={14} /> 3 فروع</span>
        <span className="landing-panel-sync"><i className="landing-feed-dot" /><span className="landing-swap" key={`feed-${tick}`}>{feed}</span></span>
      </div>
    </div>
  );
}

export function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Sections fade in once; without JS or with reduced motion everything is simply visible.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    root.dataset.motion = "on";
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); }
    }, { rootMargin: "0px 0px -8% 0px" });
    root.querySelectorAll("[data-reveal]").forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="landing" id="top" dir="rtl" lang="ar" ref={rootRef}>
      <header className={`landing-header${scrolled ? " is-scrolled" : ""}${menuOpen ? " is-open" : ""}`}>
        <div className="landing-shell landing-header-row">
          <Wordmark />
          <nav className="landing-nav" aria-label="أقسام الصفحة">
            {NAV.map(item => <a key={item.href} href={item.href} onClick={closeMenu}>{item.label}</a>)}
          </nav>
          <div className="landing-header-actions">
            <a className="landing-btn landing-btn-ghost" href={LOGIN_HASH}><LogIn size={18} /> تسجيل الدخول</a>
            <a className="landing-btn landing-btn-primary landing-header-demo" href={DEMO_HREF}>احجز عرضًا</a>
            <button type="button" className="landing-menu" aria-expanded={menuOpen} aria-controls="landing-mobile-nav" aria-label={menuOpen ? "إغلاق القائمة" : "فتح القائمة"} onClick={() => setMenuOpen(open => !open)}>
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
        <nav id="landing-mobile-nav" className="landing-mobile-nav" aria-label="أقسام الصفحة" hidden={!menuOpen}>
          {NAV.map(item => <a key={item.href} href={item.href} onClick={closeMenu}>{item.label}</a>)}
          <a className="landing-btn landing-btn-primary" href={DEMO_HREF} onClick={closeMenu}>احجز عرضًا</a>
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-shell landing-hero-grid">
            <div className="landing-hero-copy" data-reveal>
              <p className="landing-eyebrow"><span dir="ltr">SANA HR</span> نظام متكامل لإدارة الموارد البشرية</p>
              <h1 className="landing-title">كل شؤون موظفيك،<br /><span>في منصة واحدة.</span></h1>
              <p className="landing-lead">سنع HR تجمع ملفات الموظفين والحضور والإجازات والرواتب والاعتمادات في نظام واحد، لتدير فريقك بوضوح وتتخذ قراراتك على بيانات دقيقة ومحدّثة.</p>
              <div className="landing-cta-row">
                <a className="landing-btn landing-btn-primary landing-btn-lg" href={LOGIN_HASH}>ابدأ الآن <ArrowLeft size={20} /></a>
                <a className="landing-btn landing-btn-outline landing-btn-lg" href={DEMO_HREF}>احجز عرضًا</a>
              </div>
            </div>
            <div className="landing-hero-stage" data-reveal>
              <HrScene />
            </div>
          </div>
        </section>

        <section className="landing-section" id="platform" aria-labelledby="platform-title">
          <div className="landing-shell">
            <div className="landing-section-head" data-reveal>
              <p className="landing-kicker">وحدات سنع HR</p>
              <h2 id="platform-title">رحلة الموظف كاملة، في نظام واحد</h2>
              <p>تسع وحدات مترابطة ترافق الموظف في كل مرحلة: من التوظيف والتعيين، إلى العمل اليومي، حتى الرواتب والتطوير والتقارير، وكلها تعمل على ملف واحد.</p>
            </div>
            <ol className="landing-roadmap">
              {STAGES.map((stage, stageIndex) => (
                <li className="landing-stage" key={stage.title}>
                  <header className="landing-stage-head" data-reveal>
                    <span dir="ltr">{String(stageIndex + 1).padStart(2, "0")}</span>
                    <h3>{stage.title}</h3>
                  </header>
                  <ol className="landing-stage-steps">
                    {stage.modules.map(({ Icon, name, lead, points }, index) => (
                      <li key={name} data-reveal>
                        <span className="landing-road-node" dir="ltr">{String(stageIndex * 3 + index + 1).padStart(2, "0")}</span>
                        <article className="landing-step-card">
                          <header><span className="landing-step-icon"><Icon size={20} strokeWidth={1.8} /></span><h4>{name}</h4></header>
                          <p>{lead}</p>
                          <ul>{points.map(point => <li key={point}><Check size={13} strokeWidth={2.6} />{point}</li>)}</ul>
                        </article>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-section landing-section-tint" id="benefits" aria-labelledby="benefits-title">
          <div className="landing-shell">
            <div className="landing-section-head" data-reveal>
              <p className="landing-kicker">المزايا</p>
              <h2 id="benefits-title">مصممة لتجعل إدارة الموظفين أسهل كل يوم</h2>
            </div>
            <div className="landing-bento">
              {BENEFITS.map(({ Icon, title, text, ...rest }) => (
                <article className={`landing-benefit${"wide" in rest ? " is-wide" : ""}`} key={title} data-reveal>
                  <span className="landing-benefit-icon"><Icon size={24} strokeWidth={1.7} /></span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  {"wide" in rest && <div className="landing-benefit-flow" aria-hidden="true"><span>رواتب</span><i /><span>إجازات</span><i /><span>حضور</span></div>}
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section" id="why" aria-labelledby="why-title">
          <div className="landing-shell landing-why">
            <div className="landing-why-copy" data-reveal>
              <p className="landing-kicker">لماذا سنع HR</p>
              <h2 id="why-title">لأن موظفيك يستحقون إدارة أوضح</h2>
              <p className="landing-why-lead">حين تُدار شؤون الموظفين بين الجداول والبريد والرسائل، تضيع الساعات في المتابعة وتتأخر القرارات. سنع HR يضع كل ذلك في مسار واحد واضح.</p>
              <div className="landing-pillars">
                {PILLARS.map(({ Icon, title, text }) => (
                  <div className="landing-pillar" key={title}>
                    <span><Icon size={22} strokeWidth={1.7} /></span>
                    <div><h3>{title}</h3><p>{text}</p></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="landing-compare" data-reveal>
              <div className="landing-compare-col is-before">
                <h3>قبل سنع HR</h3>
                <ul>
                  <li><X size={16} /> بيانات الموظفين في جداول متفرقة</li>
                  <li><X size={16} /> حضور يُجمع يدويًا من أجهزة البصمة</li>
                  <li><X size={16} /> رواتب تُحسب وتُراجع يدويًا</li>
                  <li><X size={16} /> طلبات إجازة تضيع بين الرسائل</li>
                </ul>
              </div>
              <div className="landing-compare-col is-after">
                <h3><StarMark size={16} /> مع سنع HR</h3>
                <ul>
                  <li><Check size={16} strokeWidth={2.5} /> ملف موحّد ومحدّث لكل موظف</li>
                  <li><Check size={16} strokeWidth={2.5} /> حضور يصل تلقائيًا من الأجهزة</li>
                  <li><Check size={16} strokeWidth={2.5} /> مسير رواتب مبني على بيانات الحضور</li>
                  <li><Check size={16} strokeWidth={2.5} /> طلبات تُعتمد بمسار موافقة واضح</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-stats" aria-label="سنع HR بالأرقام">
          <div className="landing-shell">
            <ul>
              {STATS.map(stat => (
                <li key={stat.label} data-reveal>
                  <b dir="ltr">{stat.value}</b>{stat.unit && <span>{stat.unit}</span>}
                  <p>{stat.label}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-section" id="start" aria-labelledby="start-title">
          <div className="landing-shell">
            <div className="landing-section-head" data-reveal>
              <p className="landing-kicker">كيف تبدأ</p>
              <h2 id="start-title">من أول اجتماع إلى أول يوم عمل، بخطوات واضحة</h2>
            </div>
            <ol className="landing-steps">
              {STEPS.map((step, index) => (
                <li key={step.title} data-reveal>
                  <span className="landing-step-number" dir="ltr">{String(index + 1).padStart(2, "0")}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-final" id="demo" aria-labelledby="final-title">
          <div className="landing-shell">
            <div className="landing-final-panel" data-reveal>
              <div>
                <h2 id="final-title">جاهز لإدارة موظفيك من مكان واحد؟</h2>
                <p>سجّل الدخول إلى سنع HR، أو احجز عرضًا توضيحيًا ليرى فريقك كيف يعمل النظام على بياناتكم.</p>
              </div>
              <div className="landing-cta-row">
                <a className="landing-btn landing-btn-light landing-btn-lg" href={LOGIN_HASH}><LogIn size={20} /> تسجيل الدخول</a>
                <a className="landing-btn landing-btn-onDark landing-btn-lg" href={DEMO_HREF}>احجز عرضًا</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-shell landing-footer-grid">
          <div className="landing-footer-brand">
            <Wordmark />
            <p>سنع HR نظام متكامل لإدارة الموارد البشرية ضمن منصة سنع، يجمع الموظفين والحضور والإجازات والرواتب والاعتمادات في مكان واحد.</p>
          </div>
          <div>
            <h3>الوحدات</h3>
            <ul><li><a href="#platform">ملفات الموظفين</a></li><li><a href="#platform">الحضور والإجازات</a></li><li><a href="#platform">الرواتب</a></li></ul>
          </div>
          <div>
            <h3>تعرّف علينا</h3>
            <ul><li><a href="#benefits">المزايا</a></li><li><a href="#why">لماذا سنع HR</a></li><li><a href="#start">كيف تبدأ</a></li></ul>
          </div>
          <div>
            <h3>ابدأ</h3>
            <ul><li><a href={LOGIN_HASH}>تسجيل الدخول</a></li><li><a href={DEMO_HREF}>احجز عرضًا</a></li></ul>
          </div>
        </div>
        <div className="landing-shell landing-footer-base">
          <span>© {new Date().getFullYear()} SANA HR. جميع الحقوق محفوظة.</span>
          <span><BadgeCheck size={16} /> إدارة موارد بشرية بثقة ووضوح</span>
        </div>
      </footer>
    </div>
  );
}
