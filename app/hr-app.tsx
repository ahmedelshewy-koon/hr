"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, Bell, BriefcaseBusiness, Building2, CalendarDays, Check,
  CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleUserRound,
  Clock3, Download, FileText, Globe2, Grid2X2, HelpCircle, Home, KeyRound,
  Languages, LayoutDashboard, LogOut, Menu, MoreHorizontal, Network,
  Plus, Search, Settings, ShieldCheck, SlidersHorizontal, Users, X,
} from "lucide-react";
import { EmployeeDrawer, HolidayDrawer } from "./employee-drawer";
import "./org-chart.css";

type Lang = "en" | "ar";
type Page = "dashboard" | "portal" | "approvals" | "employees" | "leave" | "attendance" | "org" | "users" | "settings";
type RoleId = "hr_manager" | "direct_manager" | "employee" | "super_admin";

const localeFor = (rtl: boolean) => rtl ? "ar-SA-u-nu-arab" : "en-GB";
const formatNumber = (value: number, rtl: boolean) => new Intl.NumberFormat(localeFor(rtl)).format(value);
const formatDate = (value: string | Date, rtl: boolean, options: Intl.DateTimeFormatOptions = { day:"numeric", month:"short", year:"numeric" }) =>
  new Intl.DateTimeFormat(localeFor(rtl), options).format(typeof value === "string" ? new Date(`${value}T12:00:00`) : value);
const formatTime = (value: string, rtl: boolean) => {
  const [hour,minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(localeFor(rtl), { hour:"numeric", minute:"2-digit" }).format(new Date(2026,7,14,hour,minute));
};
const localizedStatus = (value: unknown, rtl: boolean) => {
  const key = String(value || "active").toLowerCase().replaceAll("_"," ");
  const ar:Record<string,string> = { active:"نشط", "on leave":"في إجازة", probation:"تحت التجربة", suspended:"موقوف", "notice period":"فترة إشعار", pending:"قيد الانتظار", waiting:"بانتظار الإجراء", approved:"معتمد", rejected:"مرفوض", present:"حاضر", leave:"إجازة", late:"متأخر", configured:"مُعدّ", standard:"قياسي" };
  return rtl ? (ar[key] || String(value)) : key.replace(/\b\w/g, letter => letter.toUpperCase());
};
const localizedRequestType = (value: unknown, rtl: boolean) => {
  const key = String(value || "");
  const ar:Record<string,string> = { "Annual leave":"إجازة سنوية", "Sick leave":"إجازة مرضية", "Late arrival":"تأخر عن الدوام", "Early departure":"انصراف مبكر", "Work from home":"عمل عن بُعد", "Expense reimbursement":"استرداد مصروفات", "Experience certificate":"شهادة خبرة" };
  return rtl ? (ar[key] || key) : key;
};
const localizedStage = (value: unknown, rtl: boolean) => {
  const key = String(value || "").toLowerCase().replaceAll("_"," ");
  const ar:Record<string,string> = { manager:"المدير المباشر", "direct manager":"المدير المباشر", hr:"الموارد البشرية", employee:"الموظف", completed:"مكتمل" };
  return rtl ? (ar[key] || String(value || "—")) : String(value || "—").replaceAll("_"," ").replace(/\b\w/g,letter=>letter.toUpperCase());
};
const localizedCountry = (value: unknown, rtl: boolean) => {
  const key=String(value||"");
  const ar:Record<string,string>={"Saudi Arabia":"السعودية",KSA:"السعودية",Egypt:"مصر",Both:"السعودية ومصر","KSA & Egypt":"السعودية ومصر"};
  return rtl?(ar[key]||key):key.replace("KSA","Saudi Arabia");
};
const localizedRole = (role: RoleId, rtl: boolean) => ({
  hr_manager: rtl ? "مدير الموارد البشرية" : "HR Manager",
  direct_manager: rtl ? "المدير المباشر" : "Direct Manager",
  employee: rtl ? "موظف" : "Employee",
  super_admin: rtl ? "مدير النظام" : "Super Admin",
}[role]);

const copy = {
  en: {
    dashboard: "Dashboard", portal: "Employee Portal", approvals: "Request Approvals",
    employees: "Employees", leave: "Leave Management", attendance: "Attendance",
    org: "Organization Chart", users: "Users & Permissions", settings: "Settings",
    search: "Search anything...", greeting: "Good morning, Ahmed", subtitle: "Here’s what’s happening with your team today.",
    newRequest: "New request", viewAll: "View all", pending: "Pending approvals",
  },
  ar: {
    dashboard: "لوحة التحكم", portal: "بوابة الموظف", approvals: "اعتماد الطلبات",
    employees: "الموظفون", leave: "إدارة الإجازات", attendance: "الحضور والانصراف",
    org: "الهيكل التنظيمي", users: "المستخدمون والصلاحيات", settings: "الإعدادات",
    search: "ابحث في النظام...", greeting: "صباح الخير، أحمد", subtitle: "إليك ملخص فريقك لهذا اليوم.",
    newRequest: "طلب جديد", viewAll: "عرض الكل", pending: "طلبات بانتظار الاعتماد",
  },
};

const employees = [
  { name: "Mona Hassan", ar: "منى حسن", initials: "MH", id: "EMP-00042", dept: "People & Culture", deptAr:"الموارد البشرية والثقافة", role: "HR Specialist", roleAr:"أخصائية موارد بشرية", location: "Cairo, Egypt", locationAr:"القاهرة، مصر", status: "Active", tone: "violet" },
  { name: "Omar Alharbi", ar: "عمر الحربي", initials: "OA", id: "EMP-00037", dept: "Engineering", deptAr:"الهندسة", role: "Senior Frontend Engineer", roleAr:"مهندس واجهات أول", location: "Riyadh, Saudi Arabia", locationAr:"الرياض، السعودية", status: "Active", tone: "blue" },
  { name: "Sara Mostafa", ar: "سارة مصطفى", initials: "SM", id: "EMP-00029", dept: "Customer Success", deptAr:"نجاح العملاء", role: "Customer Success Team Lead", roleAr:"قائدة فريق نجاح العملاء", location: "Cairo, Egypt", locationAr:"القاهرة، مصر", status: "On leave", tone: "rose" },
  { name: "Fahad Alqahtani", ar: "فهد القحطاني", initials: "FA", id: "EMP-00018", dept: "Sales", deptAr:"المبيعات", role: "Account Executive", roleAr:"تنفيذي حسابات", location: "Riyadh, Saudi Arabia", locationAr:"الرياض، السعودية", status: "Probation", tone: "amber" },
];

const requests = [
  { id: "REQ-1048", name: "Mona Hassan", nameAr:"منى حسن", type: "Annual leave", from:"2026-08-18", to:"2026-08-21", submitted:"2026-08-14", time:"09:15", status: "Manager approved", statusAr:"اعتمد المدير", tone: "blue" },
  { id: "REQ-1047", name: "Omar Alharbi", nameAr:"عمر الحربي", type: "Work from home", from:"2026-08-17", to:"2026-08-17", submitted:"2026-08-14", time:"08:42", status: "Pending manager", statusAr:"بانتظار اعتماد المدير", tone: "amber" },
  { id: "REQ-1045", name: "Fahad Alqahtani", nameAr:"فهد القحطاني", type: "Expense reimbursement", amount:640, submitted:"2026-08-13", time:"16:20", status: "Pending HR", statusAr:"بانتظار الموارد البشرية", tone: "violet" },
];

type HRData = {
  employees: Record<string, any>[]; departments: Record<string, any>[]; jobTitles: Record<string, any>[];
  requests: Record<string, any>[]; attendance: Record<string, any>[]; holidays: Record<string, any>[];
  roles: Record<string, any>[]; users: Record<string, any>[]; permissions: Record<string, any>[]; audit: Record<string, any>[];
  currentUser?: Record<string, any>;
};

async function hrApi(payload?: Record<string, unknown>) {
  const response = await fetch("/api/hr", payload ? { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(payload) } : { cache:"no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status})`);
  return body;
}

function useHRData() {
  const [data,setData]=useState<HRData|null>(null); const [error,setError]=useState("");
  const load=async()=>{try{setError("");setData(await hrApi());}catch(e){setError(e instanceof Error?e.message:"Unable to load data");}};
  useEffect(()=>{void load();},[]);
  return {data,error,reload:load};
}

function Avatar({ initials, tone = "blue", small = false }: { initials: string; tone?: string; small?: boolean }) {
  return <span className={`avatar ${tone} ${small ? "small" : ""}`}>{initials}</span>;
}

function Status({ children, tone = "green" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`status ${tone}`}><span />{children}</span>;
}

function personInitials(name: unknown) {
  return String(name || "—").split(/\s+/).filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();
}

function Empty({ icon: Icon = FileText, title, text }: { icon?: typeof FileText; title: string; text: string }) {
  return <div className="empty"><span className="empty-icon"><Icon size={22} /></span><h3>{title}</h3><p>{text}</p></div>;
}

export function HRApp() {
  const [lang, setLang] = useState<Lang>("en");
  const [page, setPage] = useState<Page>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [checkedIn, setCheckedIn] = useState(true);
  const [role, setRole] = useState<RoleId>("hr_manager");
  const t = copy[lang];
  const rtl = lang === "ar";
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
  }, [lang, rtl]);

  const nav = [
    { id: "dashboard" as Page, label: t.dashboard, icon: LayoutDashboard },
    { id: "portal" as Page, label: t.portal, icon: CircleUserRound },
    { id: "approvals" as Page, label: t.approvals, icon: CheckCircle2, badge: 6 },
    { id: "employees" as Page, label: t.employees, icon: Users },
    { id: "leave" as Page, label: t.leave, icon: CalendarDays },
    { id: "attendance" as Page, label: t.attendance, icon: Clock3 },
    { id: "org" as Page, label: t.org, icon: Network },
    { id: "users" as Page, label: t.users, icon: ShieldCheck },
    { id: "settings" as Page, label: t.settings, icon: Settings },
  ];

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const currentTitle = nav.find(n => n.id === page)?.label;

  return (
    <div className="app" dir={rtl ? "rtl" : "ltr"} data-lang={lang}>
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="brand"><img className="brand-logo" src="/sanad-logo.png" alt={rtl?"سند":"Sanad"} /><button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label={rtl?"إغلاق القائمة":"Close menu"}><X size={20} /></button></div>
        <div className="workspace-label">{rtl ? "مساحة العمل" : "WORKSPACE"}</div>
        <nav>
          {nav.map(({ id, label, icon: Icon, badge }) => (
            <button key={id} className={page === id ? "active" : ""} onClick={() => { setPage(id); setMobileOpen(false); }}>
              <Icon size={19} strokeWidth={1.8} /><span>{label}</span>{badge && <em>{badge}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => notify(rtl ? "مركز المساعدة قريباً" : "Help center is coming soon")}><HelpCircle size={19} /><span>{rtl ? "المساعدة والدعم" : "Help & support"}</span></button>
          <div className="profile-mini"><Avatar initials="AE" small /><div><b>{rtl ? "أحمد الشيوي" : "Ahmed Elshewy"}</b><span>{localizedRole(role,rtl)}</span></div><MoreHorizontal size={18} /></div>
        </div>
      </aside>
      {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}

      <main className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setMobileOpen(true)} aria-label={rtl?"فتح قائمة التنقل":"Open navigation"}><Menu size={21} /></button>
          <div className="mobile-title">{currentTitle}</div>
          <button className="global-search"><Search size={18} /><span>{t.search}</span><kbd>⌘ K</kbd></button>
          <div className="top-actions">
            <label className="role-select"><ShieldCheck size={16} /><select aria-label={rtl?"الدور الحالي":"Current role"} value={role} onChange={e => setRole(e.target.value as RoleId)}>{(["hr_manager","direct_manager","employee","super_admin"] as RoleId[]).map(id=><option value={id} key={id}>{localizedRole(id,rtl)}</option>)}</select><ChevronDown size={14} /></label>
            <button className="language" onClick={() => setLang(lang === "en" ? "ar" : "en")}><Languages size={17} />{lang === "en" ? "العربية" : "English"}</button>
            <button className="icon-btn notification-btn" onClick={() => setNotificationsOpen(!notificationsOpen)} aria-label={rtl?"الإشعارات":"Notifications"}><Bell size={19} /><span /></button>
            <Avatar initials="AE" small />
          </div>
          {notificationsOpen && <Notifications rtl={rtl} onClose={() => setNotificationsOpen(false)} />}
        </header>

        <div className="content">
          {page === "dashboard" && <Dashboard rtl={rtl} t={t} setPage={setPage} openRequest={() => setRequestOpen(true)} />}
          {page === "portal" && <Portal rtl={rtl} openRequest={() => setRequestOpen(true)} checkedIn={checkedIn} setCheckedIn={setCheckedIn} notify={notify} />}
          {page === "approvals" && <Approvals rtl={rtl} notify={notify} />}
          {page === "employees" && <EmployeesPage rtl={rtl} notify={notify} />}
          {page === "leave" && <LeavePage rtl={rtl} notify={notify} />}
          {page === "attendance" && <AttendancePage rtl={rtl} notify={notify} />}
          {page === "org" && <OrgPage rtl={rtl} />}
          {page === "users" && <UsersPage rtl={rtl} notify={notify} />}
          {page === "settings" && <SettingsPage rtl={rtl} notify={notify} />}
        </div>
      </main>
      {requestOpen && <RequestDrawer rtl={rtl} close={() => setRequestOpen(false)} submit={() => { void hrApi({action:"create_request",type:"Annual leave",fromDate:"2026-08-18",toDate:"2026-08-21",reason:"Submitted from employee portal"}).then(()=>{setRequestOpen(false);notify(rtl?"تم إرسال الطلب وحفظه بنجاح":"Request submitted and saved successfully");}).catch(e=>notify(e instanceof Error?e.message:"Request failed")); }} />}
      {toast && <div className="toast"><CheckCircle2 size={19} />{toast}</div>}
    </div>
  );
}

function Dashboard({ rtl, t, setPage, openRequest }: { rtl: boolean; t: typeof copy.en; setPage: (p: Page) => void; openRequest: () => void }) {
  const stats = [
    { label: rtl ? "إجمالي الموظفين" : "Total employees", value: formatNumber(126,rtl), note: rtl ? `+${formatNumber(4,rtl)} هذا الشهر` : "+4 this month", icon: Users, tone: "blue" },
    { label: rtl ? "الحاضرون اليوم" : "Present today", value: formatNumber(109,rtl), note: new Intl.NumberFormat(localeFor(rtl),{style:"percent",maximumFractionDigits:1}).format(.865), icon: CheckCircle2, tone: "green" },
    { label: rtl ? "في إجازة" : "On leave", value: formatNumber(8,rtl), note: rtl ? `${formatNumber(3,rtl)} أقسام` : "3 departments", icon: CalendarDays, tone: "violet" },
    { label: rtl ? "المتأخرون اليوم" : "Late today", value: formatNumber(5,rtl), note: rtl ? `أقل بـ${formatNumber(2,rtl)} من الأمس` : "2 fewer than yesterday", icon: Clock3, tone: "orange" },
  ];
  return <>
    <section className="page-heading"><div><span className="eyebrow">{formatDate("2026-08-14",rtl,{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</span><h1>{t.greeting} <span>👋</span></h1><p>{t.subtitle}</p></div><button className="primary" onClick={openRequest}><Plus size={17} />{t.newRequest}</button></section>
    <section className="stat-grid">{stats.map(({ label, value, note, icon: Icon, tone }) => <div className="stat-card" key={label}><div className={`stat-icon ${tone}`}><Icon size={20} /></div><div className="stat-value">{value}</div><div className="stat-label">{label}</div><div className={`stat-note ${tone}`}>{note}</div></div>)}</section>
    <section className="dashboard-grid">
      <div className="panel attendance-overview"><div className="panel-head"><div><h2>{rtl ? "ملخص الحضور" : "Attendance overview"}</h2><p>{rtl ? "معدل الحضور اليومي خلال الأسبوع الحالي" : "Daily attendance across the current week"}</p></div><button className="select-button">{rtl ? "الأسبوع الحالي" : "This week"}<ChevronDown size={15} /></button></div><div className="legend"><span className="present">{rtl ? "حضور مكتبي" : "On-site"}</span><span className="remote">{rtl ? "عمل عن بُعد" : "Remote"}</span><span className="away">{rtl ? "غياب أو إجازة" : "Absent or on leave"}</span></div><div className="chart">{[72,88,81,92,86,0,0].map((v,i) => <div className="bar-col" key={i}><div className="bar-track"><span className="bar-away" style={{height: `${v ? 100-v : 2}%`}}/><span className="bar-remote" style={{height: `${v ? 10+i%3*3 : 0}%`}}/><span className="bar-present" style={{height: `${v}%`}}/></div><small>{(rtl?["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"]:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"])[i]}</small></div>)}</div>
      </div>
      <div className="panel today-card"><div className="panel-head"><div><h2>{rtl ? "حضوري اليوم" : "My attendance today"}</h2><p>{formatDate("2026-08-14",rtl)}</p></div><Status>{rtl ? "حاضر" : "Present"}</Status></div><div className="time-ring"><div><Clock3 size={25}/><strong>{rtl?"٠٦:١٨":"06:18"}</strong><span>{rtl ? "ساعات مسجلة" : "hours worked"}</span></div></div><div className="time-points"><div><span>{formatTime("08:57",rtl)}</span><small>{rtl ? "وقت الحضور" : "Check-in"}</small></div><div><span>—</span><small>{rtl ? "وقت الانصراف" : "Check-out"}</small></div></div><button className="outline wide directional" onClick={() => setPage("portal")}>{rtl ? "إدارة الحضور عن بُعد" : "Manage remote attendance"}<ChevronRight size={16}/></button></div>
    </section>
    <section className="dashboard-grid lower">
      <div className="panel approvals-card"><div className="panel-head"><div><h2>{t.pending}</h2><p>{rtl ? `${formatNumber(6,rtl)} طلبات تتطلب إجراءك` : "6 requests need your action"}</p></div><button className="text-button directional" onClick={() => setPage("approvals")}>{t.viewAll}<ChevronRight size={15}/></button></div>{requests.map(r => <div className="approval-row" key={r.id}><Avatar initials={r.name.split(" ").map(x=>x[0]).join("")} tone={r.tone}/><div className="request-main"><b>{rtl?r.nameAr:r.name}</b><span>{localizedRequestType(r.type,rtl)} · {r.amount?new Intl.NumberFormat(localeFor(rtl),{style:"currency",currency:"SAR",maximumFractionDigits:0}).format(r.amount):r.from===r.to?formatDate(r.from,rtl,{day:"numeric",month:"short"}):`${formatDate(r.from!,rtl,{day:"numeric"})}–${formatDate(r.to!,rtl,{day:"numeric",month:"short"})}`}</span></div><small>{formatDate(r.submitted,rtl,{day:"numeric",month:"short"})}</small><button className="round-check" aria-label={rtl?"اعتماد الطلب":"Approve request"}><Check size={16}/></button><button className="round-more" aria-label={rtl?"المزيد":"More actions"}><MoreHorizontal size={17}/></button></div>)}</div>
      <div className="panel leave-card"><div className="panel-head"><div><h2>{rtl ? "رصيد الإجازات" : "Leave balance"}</h2><p>{rtl ? `العام ${formatNumber(2026,rtl)}` : "For 2026"}</p></div><button className="text-button directional" onClick={() => setPage("portal")}>{t.viewAll}<ChevronRight size={15}/></button></div><div className="balance"><div className="balance-ring"><strong>{formatNumber(18,rtl)}</strong><span>{rtl ? "يوماً متبقياً" : "days left"}</span></div><div className="balance-info"><div><span>{rtl ? "الرصيد السنوي" : "Annual entitlement"}</span><b>{rtl?`${formatNumber(30,rtl)} يوماً`:"30 days"}</b></div><div><span>{rtl ? "المستخدم" : "Used"}</span><b>{rtl?`${formatNumber(10,rtl)} أيام`:"10 days"}</b></div><div><span>{rtl ? "طلبات معلقة" : "Pending"}</span><b>{rtl?`${formatNumber(2,rtl)} يومان`:"2 days"}</b></div></div></div><div className="holiday-next"><CalendarDays size={19}/><div><small>{rtl ? "العطلة القادمة" : "Next holiday"}</small><b>{rtl ? "المولد النبوي الشريف" : "Prophet’s Birthday"}</b></div><span>{formatDate("2026-08-26",rtl,{day:"numeric",month:"short"})}</span></div></div>
    </section>
  </>;
}

function Portal({ rtl, openRequest, checkedIn, setCheckedIn, notify }: { rtl:boolean; openRequest:()=>void; checkedIn:boolean; setCheckedIn:(v:boolean)=>void; notify:(s:string)=>void }) {
  const [tab,setTab]=useState("requests");
  const recordAttendance=async()=>{try{await hrApi({action:"attendance_event",eventType:checkedIn?"check_out":"check_in"});setCheckedIn(!checkedIn);notify(checkedIn?(rtl?"تم تسجيل الانصراف بنجاح":"Check-out recorded"):(rtl?"تم تسجيل الحضور بنجاح":"Check-in recorded"));}catch(e){notify(e instanceof Error?e.message:(rtl?"تعذر تسجيل الحضور، حاول مرة أخرى":"Attendance action failed"));}};
  const weekDays = rtl?["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس"]:["Sunday","Monday","Tuesday","Wednesday","Thursday"];
  return <><PageHeader eyebrow={rtl?"الخدمة الذاتية للموظف":"EMPLOYEE SELF-SERVICE"} title={rtl?"بوابة الموظف":"Employee portal"} text={rtl?"تابع طلباتك وحضورك ورصيد إجازاتك من مكان واحد.":"Manage your requests, attendance and leave balance in one place."} action={<button className="primary" onClick={openRequest}><Plus size={17}/>{rtl?"تقديم طلب":"New request"}</button>}/><Tabs items={[{id:"requests",label:rtl?"طلباتي":"My requests"},{id:"remote",label:rtl?"الحضور عن بُعد":"Remote attendance"}]} active={tab} setActive={setTab}/>{tab==="requests"?<div className="panel table-panel"><FilterBar rtl={rtl}/><RequestTable rtl={rtl}/></div>:<div className="remote-layout"><div className="panel remote-card"><span className="date-chip">{formatDate("2026-08-14",rtl,{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</span><div className="live-time">{formatTime("10:42",rtl)}</div><p>{rtl?"توقيت الرياض (UTC+3)":"Riyadh time (UTC+3)"}</p><div className={`pulse ${checkedIn?"active":""}`}><Clock3 size={28}/></div><Status tone={checkedIn?"green":"gray"}>{checkedIn?(rtl?"الدوام مسجّل":"Active session"):(rtl?"لم تسجّل الحضور":"Not checked in")}</Status><div className="session-summary"><div><small>{rtl?"وقت الحضور":"CHECK-IN"}</small><b>{checkedIn?formatTime("08:57",rtl):"—"}</b></div><div><small>{rtl?"المدة المسجلة":"WORKED"}</small><b>{checkedIn?(rtl?"ساعة و٤٥ دقيقة":"1 hr 45 min"):"—"}</b></div></div><button className={checkedIn?"danger-action":"primary wide"} onClick={()=>void recordAttendance()}>{checkedIn?(rtl?"تسجيل الانصراف":"Check out"):(rtl?"تسجيل الحضور":"Check in")}</button><small className="privacy"><ShieldCheck size={14}/>{rtl?"يُستخدم موقعك التقريبي لإثبات الحضور فقط":"Approximate location is used for attendance verification only"}</small></div><div className="panel week-card"><div className="panel-head"><div><h2>{rtl?"الأسبوع الحالي":"This week"}</h2><p>{rtl?"سجل ساعات العمل اليومية":"Your daily work record"}</p></div><b>{rtl?"٣٢ ساعة و١٤ دقيقة":"32 hr 14 min"}</b></div>{weekDays.map((day,i)=><div className="day-row" key={day}><span className={i===4?"day-badge today":"day-badge"}>{formatNumber(i+10,rtl)}</span><div><b>{day}</b><small>{i===4?`${formatTime("08:57",rtl)} — ${rtl?"الدوام مستمر":"Active"}`:`${formatTime("09:00",rtl)} — ${formatTime("17:05",rtl)}`}</small></div><span>{i===4?(rtl?"ساعة و٤٥ د":"1 hr 45 min"):(rtl?"٨ ساعات و٤ د":"8 hr 4 min")}</span></div>)}</div></div>}</>;
}

function Approvals({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){const [tab,setTab]=useState("pending");const {data,error,reload}=useHRData();const all=data?.requests??[];const list=all.filter(r=>tab==="all"||(tab==="pending"?String(r.status).startsWith("pending"):tab==="approved"?String(r.status).includes("approved"):String(r.status).includes("rejected")));const decide=async(id:number,decision:"approve"|"reject")=>{const reason=decision==="reject"?(window.prompt(rtl?"اكتب سبب الرفض":"Rejection reason")||""):"";if(decision==="reject"&&!reason)return;try{await hrApi({action:"request_action",requestId:id,decision,reason});await reload();notify(decision==="approve"?(rtl?"تم اعتماد الطلب وتحويله إلى المرحلة التالية":"Request approved and moved to the next stage"):(rtl?"تم رفض الطلب وحفظ السبب":"Request rejected and the reason was recorded"));}catch(e){notify(e instanceof Error?e.message:(rtl?"تعذر تنفيذ الإجراء":"Action failed"));}};return <><PageHeader eyebrow={rtl?"مسار الاعتمادات":"WORKFLOW"} title={rtl?"اعتماد الطلبات":"Request approvals"} text={rtl?"راجع طلبات فريقك واتخذ الإجراء المناسب من قائمة موحّدة.":"Review team requests and take action from one focused queue."}/><Tabs items={[{id:"pending",label:`${rtl?"بانتظار اعتمادي":"Awaiting my approval"} (${formatNumber(all.filter(r=>String(r.status).startsWith("pending")).length,rtl)})`},{id:"approved",label:rtl?"المعتمدة":"Approved"},{id:"rejected",label:rtl?"المرفوضة":"Rejected"},{id:"all",label:rtl?"جميع الطلبات":"All requests"}]} active={tab} setActive={setTab}/><div className="panel table-panel">{error&&<div className="error-banner">{error}</div>}<FilterBar rtl={rtl}/>{list.length===0?<Empty title={rtl?"لا توجد طلبات":"No requests found"} text={rtl?"لا توجد طلبات مطابقة لعوامل التصفية الحالية.":"No requests match the current filters."}/>:<div className="data-table approval-table"><div className="tr th"><span>{rtl?"الموظف":"Employee"}</span><span>{rtl?"نوع الطلب":"Request"}</span><span>{rtl?"الفترة":"Period"}</span><span>{rtl?"مرحلة الاعتماد":"Approval stage"}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{list.map((r,i)=><div className="tr" key={r.id}><span className="person"><Avatar initials={personInitials(r.employee_name)} small tone={["blue","violet","rose"][i%3]}/><span><b>{rtl?(r.employee_name_ar||r.employee_name):r.employee_name}</b><small>{rtl?(r.department_name_ar||r.department_name):r.department_name||"—"}</small></span></span><span><b>{localizedRequestType(r.type,rtl)}</b><small>{r.request_code}</small></span><span>{r.from_date&&r.to_date?`${formatDate(r.from_date,rtl,{day:"numeric",month:"short"})} — ${formatDate(r.to_date,rtl,{day:"numeric",month:"short"})}`:(r.request_date?formatDate(r.request_date,rtl):"—")}</span><span><small>{localizedStage(r.current_stage,rtl)}</small></span><span><Status tone={String(r.status).includes("rejected")?"rose":String(r.status).includes("approved")?"green":"amber"}>{localizedStatus(r.status,rtl)}</Status></span><span className="row-actions">{String(r.status).startsWith("pending")&&<><button onClick={()=>void decide(r.id,"approve")} aria-label={rtl?"اعتماد الطلب":"Approve request"}><Check size={15}/></button><button onClick={()=>void decide(r.id,"reject")} aria-label={rtl?"رفض الطلب":"Reject request"}><X size={15}/></button></>}</span></div>)}</div>}</div></>}

function EmployeesPage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){
  const [tab,setTab]=useState("employees"); const [open,setOpen]=useState(false); const {data,error,reload}=useHRData();
  const total=data?.employees.length??0, active=data?.employees.filter(e=>e.employment_status==="active").length??0;
  const ksa=data?.employees.filter(e=>e.country==="Saudi Arabia").length??0, egypt=data?.employees.filter(e=>e.country==="Egypt").length??0;
  return <><PageHeader eyebrow={rtl?"إدارة الموارد البشرية":"PEOPLE MANAGEMENT"} title={rtl?"الموظفون":"Employees"} text={rtl?"إدارة ملفات الموظفين والمسميات الوظيفية والأقسام من مكان واحد.":"Manage employee records, job titles and departments in one place."} action={<button className="primary" onClick={()=>setOpen(true)}><Plus size={17}/>{rtl?"إضافة موظف":"Add employee"}</button>}/>
  {error&&<div className="error-banner">{error}<button onClick={()=>void reload()}>{rtl?"إعادة المحاولة":"Retry"}</button></div>}
  <section className="mini-stats"><div><Users/><span><b>{total?formatNumber(total,rtl):"—"}</b>{rtl?"إجمالي الموظفين":"Total employees"}</span></div><div><CheckCircle2/><span><b>{active?formatNumber(active,rtl):"—"}</b>{rtl?"الموظفون النشطون":"Active employees"}</span></div><div><Globe2/><span><b>{formatNumber(ksa,rtl)} / {formatNumber(egypt,rtl)}</b>{rtl?"السعودية / مصر":"Saudi Arabia / Egypt"}</span></div><div><BriefcaseBusiness/><span><b>{formatNumber(data?.employees.filter(e=>String(e.created_at).startsWith("2026-08")).length??0,rtl)}</b>{rtl?"منضمون هذا الشهر":"Joined this month"}</span></div></section>
  <Tabs items={[{id:"employees",label:rtl?"الموظفون":"Employees"},{id:"jobs",label:rtl?"المسميات الوظيفية":"Job titles"},{id:"departments",label:rtl?"الأقسام":"Departments"}]} active={tab} setActive={setTab}/><div className="panel table-panel"><FilterBar rtl={rtl}/>{tab==="employees"?<EmployeeTable rtl={rtl} rows={data?.employees}/>:tab==="jobs"?<JobTitleTable rtl={rtl} rows={data?.jobTitles} departments={data?.departments}/>:<DepartmentGrid rtl={rtl} rows={data?.departments} jobs={data?.jobTitles} employees={data?.employees} reload={reload} notify={notify}/>}</div>
  {open&&<EmployeeDrawer rtl={rtl} data={data} close={()=>setOpen(false)} submit={async(form)=>{await hrApi({action:"create_employee",...form});setOpen(false);await reload();notify(rtl?"تم إنشاء الموظف وحساب المستخدم بنجاح":"Employee and user account created successfully");}}/>}</>}

function LeavePage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){const [tab,setTab]=useState("holidays"),[open,setOpen]=useState(false);const {data,error,reload}=useHRData();const settings=tab==="settings"?(rtl?[{t:"تعديل مواعيد العطلات",d:"نقل العطلة الرسمية إلى يوم بديل عند الحاجة",n:"إعدادان نشطان"},{t:"تقويم الدول",d:"تحديد أيام العمل والعطلات لكل دولة",n:"دولتان"},{t:"مسار الاعتماد",d:"مراحل اعتماد المدير المباشر والموارد البشرية",n:"قياسي"}]:[{t:"Holiday adjustments",d:"Move an official holiday to a replacement date",n:"2 active"},{t:"Country calendars",d:"Configure working days and holidays by country",n:"2 countries"},{t:"Approval workflow",d:"Manager and HR approval stages",n:"Standard"}]):(rtl?[{t:"الإجازة السنوية",d:"استحقاق يراعي الدولة ومدة الخدمة",n:"سياستان"},{t:"الإجازة المرضية",d:"يلزم تقرير طبي بعد يومين",n:"نشطة"},{t:"ترحيل الرصيد",d:"ترحيل ٥ أيام بحد أقصى لمدة ٩٠ يوماً",n:"مُعدّ"}]:[{t:"Annual leave",d:"Entitlement based on country and length of service",n:"2 policies"},{t:"Sick leave",d:"Medical certificate required after 2 days",n:"Active"},{t:"Carry forward",d:"Up to 5 days, expiring after 90 days",n:"Configured"}]);return <><PageHeader eyebrow={rtl?"السياسات والتقويم":"POLICIES & CALENDAR"} title={rtl?"إدارة الإجازات":"Leave management"} text={rtl?"إدارة العطلات الرسمية وسياسات الإجازات في السعودية ومصر.":"Manage official holidays and leave policies across Saudi Arabia and Egypt."} action={<button className="primary" onClick={()=>setOpen(true)}><Plus size={17}/>{rtl?"إضافة عطلة رسمية":"Add holiday"}</button>}/>{error&&<div className="error-banner">{error}</div>}<Tabs items={[{id:"holidays",label:rtl?"العطلات الرسمية":"Official holidays"},{id:"settings",label:rtl?"إعدادات الإجازات":"Leave settings"},{id:"policies",label:rtl?"سياسات الإجازات":"Leave policies"}]} active={tab} setActive={setTab}/>{tab==="holidays"?<HolidayCalendar rtl={rtl} rows={data?.holidays}/>:<div className="settings-grid">{settings.map((x,i)=><button className="panel setting-card setting-button directional" key={x.t} onClick={()=>notify(rtl?"تم فتح الإعداد في محرر السياسات":"Setting opened in the policy editor")}><span className={`setting-icon ${["blue","violet","green"][i]}`}><SlidersHorizontal/></span><div><h3>{x.t}</h3><p>{x.d}</p></div><Status tone={i===1?"violet":"green"}>{x.n}</Status><ChevronRight/></button>)}</div>}{open&&<HolidayDrawer rtl={rtl} close={()=>setOpen(false)} submit={async form=>{await hrApi({action:"create_holiday",...form});setOpen(false);await reload();notify(rtl?"تم حفظ العطلة وإضافتها إلى احتساب الحضور":"Holiday saved and included in attendance calculations");}}/>}</>}

function AttendancePage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){const [tab,setTab]=useState("management");return <><PageHeader eyebrow={rtl?"الوقت والحضور":"TIME & ATTENDANCE"} title={rtl?"الحضور والانصراف":"Attendance"} text={rtl?"سجلات موحدة من أجهزة البصمة والعمل عن بعد والتعديلات.":"One reconciled view across devices, remote work and corrections."} action={<button className="outline" onClick={()=>notify(rtl?"جارٍ إعداد ملف Excel":"Excel export prepared with active filters")}><Download size={17}/>{rtl?"تصدير Excel":"Export Excel"}</button>}/><Tabs items={[{id:"logs",label:rtl?"سجلات الحضور":"Attendance logs"},{id:"management",label:rtl?"إدارة الحضور":"Attendance management"}]} active={tab} setActive={setTab}/><div className="panel table-panel"><FilterBar rtl={rtl}/><AttendanceTable rtl={rtl} logs={tab==="logs"}/></div></>}

function OrgPage({rtl}:{rtl:boolean}){
  const {data,error,reload}=useHRData();
  const [query,setQuery]=useState("");
  const [expandedDepartment,setExpandedDepartment]=useState<number|null>(null);
  const departments=data?.departments??[], employeesData=data?.employees??[], jobs=data?.jobTitles??[];
  const directorDepartment=departments.find(department=>/Managing Director|العضو المنتدب/i.test(`${department.name_en} ${department.name_ar}`));
  const director=employeesData.find(employee=>Number(employee.department_id)===Number(directorDepartment?.id)) ?? employeesData.find(employee=>/Chief Executive|الرئيس التنفيذ/i.test(String(employee.job_title_name||"")));
  const jobById=new Map(jobs.map(job=>[Number(job.id),job]));
  const employeeJob=(employee:Record<string,any>)=>jobById.get(Number(employee.job_title_id));
  const employeeRole=(employee:Record<string,any>)=>rtl?(employeeJob(employee)?.name_ar||employee.job_title_name):(employeeJob(employee)?.name_en||employee.job_title_name);
  const leadershipPattern=/manager|director|head|lead|chief|مدير|رئيس|قائد/i;
  const normalized=query.trim().toLocaleLowerCase();
  const branches=departments
    .filter(department=>Number(department.id)!==Number(directorDepartment?.id))
    .map((department,index)=>({
      department,
      tone:["blue","violet","green","rose","amber"][index%5],
      members:employeesData.filter(employee=>Number(employee.department_id)===Number(department.id)),
      jobs:jobs.filter(job=>Number(job.department_id)===Number(department.id)),
    }))
    .filter(branch=>!normalized||`${branch.department.name_en} ${branch.department.name_ar} ${branch.members.map(member=>`${member.name_en} ${member.name_ar}`).join(" ")}`.toLocaleLowerCase().includes(normalized))
    .sort((a,b)=>b.members.length-a.members.length||String(rtl?a.department.name_ar:a.department.name_en).localeCompare(String(rtl?b.department.name_ar:b.department.name_en),rtl?"ar":"en"));
  const directorJob=director?jobById.get(Number(director.job_title_id)):undefined;
  const totalEmployees=employeesData.length;
  const activeDepartments=departments.filter(department=>Number(department.id)!==Number(directorDepartment?.id));
  const leaders=activeDepartments.reduce((count,department)=>count+(employeesData.some(employee=>Number(employee.department_id)===Number(department.id)&&leadershipPattern.test(`${employeeRole(employee)} ${employee.job_title_name||""}`))?1:0),0);
  const largestBranch=branches[0];
  const leadershipCoverage=activeDepartments.length?Math.round(leaders/activeDepartments.length*100):0;
  return <><PageHeader eyebrow={rtl?"صورة واحدة للشركة":"COMPANY AT A GLANCE"} title={rtl?"خريطة الفرق والقيادة":"Teams & leadership map"} text={rtl?"اعرف فوراً أين يتركز الموظفون، من يقود كل فريق، وكيف تتوزع الشركة.":"See where people sit, who leads each team, and how the company is distributed."}/>
  {error&&<div className="error-banner">{error}<button onClick={()=>void reload()}>{rtl?"إعادة المحاولة":"Retry"}</button></div>}
  <section className="org-insights" aria-label={rtl?"ملخص الهيكل":"Structure summary"}>
    <div className="org-insight primary-insight"><span><Users size={19}/></span><div><b>{formatNumber(totalEmployees,rtl)}</b><small>{rtl?"إجمالي الموظفين":"total employees"}</small></div><em>{rtl?`${formatNumber(activeDepartments.length,rtl)} قسم`:`${activeDepartments.length} departments`}</em></div>
    <div className="org-insight"><span><Building2 size={19}/></span><div><b>{largestBranch?rtl?largestBranch.department.name_ar:largestBranch.department.name_en:"—"}</b><small>{rtl?"أكبر قسم":"largest team"}</small></div><em>{largestBranch?formatNumber(largestBranch.members.length,rtl):0}</em></div>
    <div className="org-insight"><span><ShieldCheck size={19}/></span><div><b>{formatNumber(leadershipCoverage,rtl)}%</b><small>{rtl?"تغطية قيادة الأقسام":"leadership coverage"}</small></div><em>{formatNumber(leaders,rtl)}/{formatNumber(activeDepartments.length,rtl)}</em></div>
    <div className="org-insight"><span><BriefcaseBusiness size={19}/></span><div><b>{formatNumber(jobs.length,rtl)}</b><small>{rtl?"مسمى وظيفي":"job titles"}</small></div><em>{rtl?"تنوع الأدوار":"role mix"}</em></div>
  </section>
  <div className="org-toolbar"><div><b>{rtl?"الفرق التابعة للإدارة":"Teams reporting to leadership"}</b><small>{rtl?"كل قسم مرتب حسب الليفل التنظيمي":"Each team is ordered by organization level"}</small></div><span></span><label className="org-search"><Search size={17}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={rtl?"ابحث عن قسم أو موظف":"Find a team or employee"}/>{query&&<button onClick={()=>setQuery("")} aria-label={rtl?"مسح البحث":"Clear search"}><X size={14}/></button>}</label></div>
  <div className="panel org-canvas">
    {director?<div className="org-executive"><span className="org-level-label">{rtl?"القيادة التنفيذية":"EXECUTIVE LEADERSHIP"}</span><div className="org-executive-card"><Avatar initials={personInitials(director.name_en)} tone="blue"/><div><small>{rtl?"تقارير جميع الأقسام إلى":"ALL TEAMS REPORT TO"}</small><b>{rtl?director.name_ar:director.name_en}</b><span>{rtl?(directorJob?.name_ar||director.job_title_name):(directorJob?.name_en||director.job_title_name)}</span></div><em>{director.employee_code}</em></div><div className="org-main-connector"><span>{formatNumber(activeDepartments.length,rtl)} {rtl?"تقارير مباشرة":"direct reports"}</span></div></div>:<Empty icon={Network} title={rtl?"لم يتم العثور على العضو المنتدب":"Managing director not found"} text={rtl?"تحقق من بيانات قسم العضو المنتدب في ملف الموظفين.":"Check the managing-director department in the employee file."}/>}
    <div className="org-department-grid">{branches.map(({department,members,tone,jobs:departmentJobs})=>{const leader=members.find(member=>Number(member.id)===Number(department.manager_employee_id))||members.find(member=>Number(member.organizational_level)===0)||members.find(member=>leadershipPattern.test(`${employeeRole(member)} ${member.job_title_name||""}`));const orderedMembers=[...members].sort((a,b)=>Number(a.organizational_level??1)-Number(b.organizational_level??1)||String(rtl?a.name_ar:a.name_en).localeCompare(String(rtl?b.name_ar:b.name_en),rtl?"ar":"en"));const share=totalEmployees?Math.round(members.length/totalEmployees*100):0;const open=expandedDepartment===Number(department.id)||Boolean(normalized);return <section className={`org-department-branch ${tone} ${open?"open":""}`} key={department.id}>
      <button className="org-department-card" onClick={()=>setExpandedDepartment(open&&!normalized?null:Number(department.id))} aria-expanded={open}><div className="org-department-top"><span className={`department-icon ${tone}`}><Building2/></span><div><h3>{rtl?department.name_ar:department.name_en}</h3><p>{rtl?department.name_en:department.name_ar}</p></div><ChevronDown size={18}/></div><div className="org-headcount"><b>{formatNumber(members.length,rtl)}</b><span>{rtl?"موظف":"people"}</span><div><i style={{width:`${Math.max(share,4)}%`}}/></div><em>{formatNumber(share,rtl)}% {rtl?"من الشركة":"of company"}</em></div><div className="org-leader"><small>{rtl?"قائد الفريق":"TEAM LEAD"}</small>{leader?<span><Avatar initials={personInitials(leader.name_en)} small tone={tone}/><span><b>{rtl?leader.name_ar:leader.name_en}</b><em>{employeeRole(leader)}</em></span></span>:<span className="org-no-leader"><span>!</span>{rtl?"لا يوجد قائد محدد":"No leader identified"}</span>}</div><footer><span><BriefcaseBusiness size={14}/>{formatNumber(departmentJobs.length,rtl)} {rtl?"أدوار":"roles"}</span><span className="org-avatar-stack">{members.slice(0,4).map(member=><Avatar key={member.id} initials={personInitials(member.name_en)} small tone={tone}/>)}{members.length>4&&<i>+{formatNumber(members.length-4,rtl)}</i>}</span></footer></button>
      {open&&<div className="org-team-list"><div className="org-team-list-head"><b>{rtl?"التسلسل التنظيمي":"Reporting hierarchy"}</b><span>{formatNumber(members.length,rtl)}</span></div>{orderedMembers.map(member=>{const level=Number(member.organizational_level??1);return <div className="org-employee-node org-leveled-node" key={member.id} style={{"--org-level":Math.min(level,5)} as React.CSSProperties}><span className={`org-node-level ${level===0?"manager":""}`}>{rtl?"ليفل":"L"} {formatNumber(level,rtl)}</span><Avatar initials={personInitials(member.name_en)} small tone={tone}/><div><b>{rtl?member.name_ar:member.name_en}</b><span>{employeeRole(member)}</span><small>{level===0?(rtl?"مدير القسم":"Department manager"):`${rtl?"يتبع":"Reports to"}: ${rtl?(member.manager_name_ar||member.manager_name||"—"):(member.manager_name||"—")}`}</small></div></div>})}</div>}
    </section>})}</div>
    {data&&branches.length===0&&<Empty icon={Building2} title={rtl?"لا توجد أقسام مطابقة":"No matching departments"} text={rtl?"غيّر عبارة البحث لعرض بقية الهيكل.":"Change the search to show the rest of the chart."}/>}
  </div></>}

function UsersPage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){const [tab,setTab]=useState("users");return <><PageHeader eyebrow={rtl?"إدارة الوصول":"ACCESS CONTROL"} title={rtl?"المستخدمون والصلاحيات":"Users & permissions"} text={rtl?"تحكم دقيق بالوصول بناءً على الدور ونطاق البيانات.":"Granular role-based access with clear data scope."} action={<button className="primary"><Plus size={17}/>{rtl?"إضافة مستخدم":"Add user"}</button>}/><Tabs items={[{id:"users",label:rtl?"المستخدمون":"Users"},{id:"roles",label:rtl?"الأدوار والصلاحيات":"Roles & permissions"}]} active={tab} setActive={setTab}/>{tab==="users"?<div className="panel table-panel"><FilterBar rtl={rtl}/><EmployeeTable rtl={rtl} users/></div>:<PermissionEditor rtl={rtl} notify={notify}/>}</>}

function SettingsPage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){const items=rtl?[{i:Building2,t:"بيانات المنشأة",d:"الكيانات القانونية وقطاعات الأعمال والفروع"},{i:Clock3,t:"الجداول والورديات",d:"أيام العمل وفترات السماح وأنماط الورديات"},{i:Activity,t:"سياسات الحضور",d:"العمل الإضافي والتأخير وطلبات التصحيح"},{i:CalendarDays,t:"سياسات الإجازات",d:"الاستحقاقات وترحيل الرصيد ومسارات الاعتماد"},{i:CheckCircle2,t:"مسارات الاعتماد",d:"تحديد مراحل الاعتماد حسب نوع الطلب"},{i:Bell,t:"الإشعارات",d:"القنوات والقوالب والفئات المستهدفة"},{i:Globe2,t:"اللغات والمناطق",d:"العربية والإنجليزية والمناطق الزمنية والتنسيقات"},{i:ShieldCheck,t:"الأمان",d:"الجلسات وكلمات المرور وسجل التدقيق"}]:[{i:Building2,t:"Company information",d:"Legal entities, business units and offices"},{i:Clock3,t:"Schedules & shifts",d:"Working days, grace periods and shift patterns"},{i:Activity,t:"Attendance policies",d:"Overtime, lateness and correction rules"},{i:CalendarDays,t:"Leave policies",d:"Entitlements, carry-forward and approvals"},{i:CheckCircle2,t:"Approval workflows",d:"Configure stages by request type"},{i:Bell,t:"Notifications",d:"Channels, templates and audience rules"},{i:Globe2,t:"Languages & regions",d:"Arabic, English, time zones and formats"},{i:ShieldCheck,t:"Security",d:"Sessions, passwords and audit controls"}];return <><PageHeader eyebrow={rtl?"إعداد النظام":"SYSTEM CONFIGURATION"} title={rtl?"الإعدادات":"Settings"} text={rtl?"خصّص إعدادات المنشأة والسياسات بما يناسب آلية العمل.":"Configure company settings and policies to match how your organization works."}/><div className="settings-grid wide">{items.map(({i:Icon,t,d},idx)=><button className="panel setting-card setting-button directional" key={t} onClick={()=>notify(rtl?`تم فتح إعدادات ${t}`:`${t} opened`)}><span className={`setting-icon ${["blue","violet","green","amber"][idx%4]}`}><Icon/></span><div><h3>{t}</h3><p>{d}</p></div><ChevronRight/></button>)}</div></>}

function PageHeader({eyebrow,title,text,action}:{eyebrow:string;title:string;text:string;action?:React.ReactNode}){return <section className="page-heading compact"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{action}</section>}
function Tabs({items,active,setActive}:{items:{id:string;label:string}[];active:string;setActive:(s:string)=>void}){return <div className="tabs">{items.map(x=><button className={active===x.id?"active":""} key={x.id} onClick={()=>setActive(x.id)}>{x.label}</button>)}</div>}
function FilterBar({rtl}:{rtl:boolean}){return <div className="filterbar"><label><Search size={17}/><input placeholder={rtl?"البحث...":"Search..."}/></label><button><SlidersHorizontal size={16}/>{rtl?"التصفية":"Filters"}<span className="filter-count">2</span></button><button className="desktop-filter">{rtl?"كل الأقسام":"All departments"}<ChevronDown size={14}/></button><button className="desktop-filter">{rtl?"هذا الشهر":"This month"}<ChevronDown size={14}/></button><span className="spacer"/><button className="icon-only"><Grid2X2 size={17}/></button></div>}

function RequestTable({rtl}:{rtl:boolean}){return <div className="data-table"><div className="tr th"><span>{rtl?"نوع الطلب":"Request"}</span><span>{rtl?"تاريخ التقديم":"Submitted"}</span><span>{rtl?"الفترة أو القيمة":"Period / value"}</span><span>{rtl?"اعتماد المدير":"Manager"}</span><span>{rtl?"اعتماد الموارد البشرية":"HR"}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{requests.map((r,i)=>{const period=r.amount?new Intl.NumberFormat(localeFor(rtl),{style:"currency",currency:"SAR",maximumFractionDigits:0}).format(r.amount):r.from===r.to?formatDate(r.from!,rtl,{day:"numeric",month:"short"}):`${formatDate(r.from!,rtl,{day:"numeric",month:"short"})} — ${formatDate(r.to!,rtl,{day:"numeric",month:"short"})}`;return <div className="tr" key={r.id}><span><b>{localizedRequestType(r.type,rtl)}</b><small>{r.id}</small></span><span>{formatDate(r.submitted,rtl,{day:"numeric",month:"short"})} · {formatTime(r.time,rtl)}</span><span>{period}</span><span><Status tone={i===1?"amber":"green"}>{localizedStatus(i===1?"pending":"approved",rtl)}</Status></span><span><Status tone={i===2?"amber":"gray"}>{localizedStatus(i===2?"pending":"waiting",rtl)}</Status></span><span><Status tone={r.tone}>{rtl?r.statusAr:r.status}</Status></span><span><button className="plain-icon" aria-label={rtl?"إجراءات الطلب":"Request actions"}><MoreHorizontal size={18}/></button></span></div>})}</div>}
function EmployeeTable({rtl,users=false,rows}:{rtl:boolean;users?:boolean;rows?:Record<string,any>[]}){const list=rows?.map((e,i)=>({name:e.name_en,ar:e.name_ar,initials:personInitials(e.name_en),id:e.employee_code,dept:e.department_name||"—",deptAr:e.department_name_ar||e.department_name||"—",role:e.job_title_name||"—",roleAr:e.job_title_name_ar||e.job_title_name||"—",location:e.work_location||e.country,locationAr:e.work_location_ar||localizedCountry(e.country,true),status:String(e.employment_status||"active").replaceAll("_"," "),tone:["violet","blue","rose","amber"][i%4]}))||employees;const roles:RoleId[]=["hr_manager","employee","direct_manager","employee"];return <div className="data-table employee-table"><div className="tr th"><span>{rtl?"الموظف":"Employee"}</span><span>{rtl?"القسم":"Department"}</span><span>{rtl?"المسمى الوظيفي":"Job title"}</span><span>{users?(rtl?"الدور والصلاحية":"Role"):(rtl?"موقع العمل":"Location")}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{list.map((e,i)=><div className="tr" key={e.id}><span className="person"><Avatar initials={e.initials} small tone={e.tone}/><span><b>{rtl?e.ar:e.name}</b><small>{e.id}</small></span></span><span>{rtl?e.deptAr:e.dept}</span><span>{rtl?e.roleAr:e.role}</span><span>{users?localizedRole(roles[i%4],rtl):(rtl?e.locationAr:e.location)}</span><span><Status tone={String(e.status).toLowerCase()==="active"?"green":String(e.status).toLowerCase()==="on leave"?"violet":"amber"}>{localizedStatus(e.status,rtl)}</Status></span><span><button className="plain-icon" aria-label={rtl?"إجراءات الموظف":"Employee actions"}><MoreHorizontal size={18}/></button></span></div>)}</div>}

function JobTitleTable({rtl,rows,departments}:{rtl:boolean;rows?:Record<string,any>[];departments?:Record<string,any>[]}){const list=rows??[];const departmentById=new Map((departments??[]).map(department=>[Number(department.id),department]));return list.length?<div className="data-table job-title-table"><div className="tr th"><span>{rtl?"الاسم بالإنجليزية":"English name"}</span><span>{rtl?"الاسم بالعربية":"Arabic name"}</span><span>{rtl?"القسم":"Department"}</span><span>{rtl?"عدد الموظفين":"Employees"}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{list.map(job=>{const department=departmentById.get(Number(job.department_id));return <div className="tr" key={job.id}><span><b>{job.name_en}</b></span><span>{job.name_ar}</span><span>{rtl?(department?.name_ar||job.department_name):(department?.name_en||job.department_name)||"—"}</span><span>{formatNumber(Number(job.employee_count)||0,rtl)}</span><span><Status tone={job.status==="active"?"green":"gray"}>{localizedStatus(job.status||"active",rtl)}</Status></span><span><button className="plain-icon" aria-label={rtl?"إجراءات المسمى الوظيفي":"Job title actions"}><MoreHorizontal size={18}/></button></span></div>})}</div>:<Empty icon={BriefcaseBusiness} title={rtl?"لا توجد مسميات وظيفية":"No job titles"} text={rtl?"لم تُضف أي مسميات وظيفية حتى الآن.":"No job titles have been added yet."}/>} 
function DepartmentGrid({rtl,rows,jobs,employees,notify,reload}:{rtl:boolean;rows?:Record<string,any>[];jobs?:Record<string,any>[];employees?:Record<string,any>[];notify:(s:string)=>void;reload:()=>Promise<void>}){const list=rows??[];const [selected,setSelected]=useState<Record<string,any>|null>(null);return <>{list.length?<div className="department-grid">{list.map((department,index)=>{const tone=["blue","violet","green","rose","amber"][index%5];const titleCount=(jobs??[]).filter(job=>Number(job.department_id)===Number(department.id)).length;return <button className="department-card department-card-button" key={department.id} onClick={()=>setSelected(department)}><span className={`department-icon ${tone}`}><Building2/></span><span className="department-open"><ChevronLeft size={18}/></span><h3>{rtl?department.name_ar:department.name_en}</h3><p>{rtl?department.name_en:department.name_ar}</p><div className="department-manager"><small>{rtl?"مدير القسم":"DEPARTMENT MANAGER"}</small><b>{rtl?(department.manager_name_ar||department.manager_name||"غير محدد"):(department.manager_name||"Not assigned")}</b></div><div className="department-summary"><BriefcaseBusiness size={17}/><span><small>{rtl?"المسميات الوظيفية":"Job titles"}</small><b>{formatNumber(titleCount,rtl)}</b></span></div><footer><Users size={15}/>{formatNumber(Number(department.employee_count)||0,rtl)} {rtl?"موظفاً":"employees"}<span>{rtl?"فتح القسم":"Open department"}</span></footer></button>})}</div>:<Empty icon={Building2} title={rtl?"لا توجد أقسام":"No departments"} text={rtl?"لم يتم تحميل الأقسام بعد.":"Departments have not loaded yet."}/>} {selected&&<DepartmentHierarchyDrawer rtl={rtl} department={selected} employees={employees??[]} jobs={jobs??[]} close={()=>setSelected(null)} save={async(managerEmployeeId,assignments)=>{await hrApi({action:"save_department_hierarchy",departmentId:selected.id,managerEmployeeId,assignments});await reload();setSelected(null);notify(rtl?"تم حفظ مدير القسم والمستويات التنظيمية":"Department manager and organization levels saved");}}/>}</>}

function DepartmentHierarchyDrawer({rtl,department,employees,jobs,close,save}:{rtl:boolean;department:Record<string,any>;employees:Record<string,any>[];jobs:Record<string,any>[];close:()=>void;save:(managerEmployeeId:number,assignments:{employeeId:number;managerId:number|null}[])=>Promise<void>}){
  const team=employees.filter(employee=>Number(employee.department_id)===Number(department.id));
  const initialManager=Number(department.manager_employee_id)||Number(team.find(employee=>Number(employee.organizational_level)===0)?.id)||Number(team[0]?.id)||0;
  const [managerId,setManagerId]=useState(initialManager);
  const [reports,setReports]=useState<Record<number,number|null>>(()=>Object.fromEntries(team.map(employee=>[Number(employee.id),Number(employee.manager_id)||null])));
  const [saving,setSaving]=useState(false); const [error,setError]=useState("");
  const jobById=new Map(jobs.map(job=>[Number(job.id),job]));
  const levels=useMemo(()=>{const result:Record<number,number>={};const walk=(id:number,path:Set<number>):number=>{if(id===managerId)return 0;if(result[id]!==undefined)return result[id];if(path.has(id))return 99;const next=new Set(path);next.add(id);const parent=reports[id]||managerId;return result[id]=parent===id?99:walk(parent,next)+1;};team.forEach(employee=>{result[Number(employee.id)]=walk(Number(employee.id),new Set());});return result;},[managerId,reports,team]);
  const ordered=[...team].sort((a,b)=>(levels[Number(a.id)]??99)-(levels[Number(b.id)]??99)||String(rtl?a.name_ar:a.name_en).localeCompare(String(rtl?b.name_ar:b.name_en),rtl?"ar":"en"));
  const changeManager=(id:number)=>{const previous=managerId;setManagerId(id);setReports(current=>{const next={...current,[id]:null};if(previous&&previous!==id)next[previous]=id;return next;});};
  const submit=async()=>{try{setSaving(true);setError("");await save(managerId,team.map(employee=>({employeeId:Number(employee.id),managerId:Number(employee.id)===managerId?null:(reports[Number(employee.id)]||managerId)})));}catch(reason){setError(reason instanceof Error?reason.message:(rtl?"تعذر حفظ الهيكل":"Unable to save structure"));setSaving(false);}};
  return <div className="modal-layer"><button className="modal-scrim" onClick={close} aria-label={rtl?"إغلاق":"Close"}/><aside className="drawer department-drawer"><div className="drawer-head"><div><span className="eyebrow">{rtl?"إدارة القسم":"DEPARTMENT STRUCTURE"}</span><h2>{rtl?department.name_ar:department.name_en}</h2><p>{rtl?"حدد مدير القسم والمدير المباشر لكل موظف؛ وسيُحسب الليفل تلقائياً.":"Choose the department manager and each reporting line; levels are calculated automatically."}</p></div><button className="icon-btn" onClick={close}><X size={20}/></button></div><div className="form-body department-structure-body">{error&&<div className="error-banner">{error}</div>}{team.length?<><label className="field manager-field"><span>{rtl?"مدير القسم · ليفل ٠":"Department manager · Level 0"}</span><select value={managerId} onChange={event=>changeManager(Number(event.target.value))}>{team.map(employee=><option value={employee.id} key={employee.id}>{rtl?employee.name_ar:employee.name_en}</option>)}</select></label><div className="hierarchy-key"><span><b>0</b>{rtl?"مدير القسم":"Department manager"}</span><i/><span><b>1+</b>{rtl?"مستويات الفريق":"Team levels"}</span></div><div className="hierarchy-list">{ordered.map((employee,index)=>{const level=levels[Number(employee.id)]??1;const job=jobById.get(Number(employee.job_title_id));const isManager=Number(employee.id)===managerId;return <div className="hierarchy-row" key={employee.id} style={{"--org-level":Math.min(level,5)} as React.CSSProperties}><span className={`level-badge ${isManager?"manager":""}`}>{rtl?"ليفل":"L"} {formatNumber(level,rtl)}</span><Avatar initials={personInitials(employee.name_en)} small tone={["blue","violet","green","amber"][index%4]}/><div className="hierarchy-person"><b>{rtl?employee.name_ar:employee.name_en}</b><small>{rtl?(job?.name_ar||employee.job_title_name):(job?.name_en||employee.job_title_name)||"—"}</small></div>{isManager?<Status tone="blue">{rtl?"مدير القسم":"Manager"}</Status>:<label><small>{rtl?"المدير المباشر":"Reports to"}</small><select value={reports[Number(employee.id)]||managerId} onChange={event=>setReports(current=>({...current,[Number(employee.id)]:Number(event.target.value)}))}>{team.filter(option=>Number(option.id)!==Number(employee.id)).map(option=><option value={option.id} key={option.id}>{rtl?option.name_ar:option.name_en}</option>)}</select></label>}</div>})}</div></>:<Empty icon={Users} title={rtl?"لا يوجد موظفون في هذا القسم":"No employees in this department"} text={rtl?"أضف موظفاً للقسم أولاً لتحديد المدير والمستويات.":"Add an employee before configuring its manager and levels."}/>}</div><div className="drawer-footer"><span/><button className="outline" onClick={close}>{rtl?"إلغاء":"Cancel"}</button><button className="primary" disabled={!team.length||saving} onClick={()=>void submit()}><Check size={16}/>{saving?(rtl?"جارٍ الحفظ...":"Saving..."):(rtl?"حفظ الهيكل":"Save structure")}</button></div></aside></div>
}
function HolidayCalendar({rtl,rows}:{rtl:boolean;rows?:Record<string,any>[]}){const list=rows?.map((h,i)=>({d:String(h.holiday_date||"").slice(8,10),m:new Date(h.holiday_date).toLocaleString("en",{month:"short"}).toUpperCase(),n:rtl?h.name_ar:h.name_en,c:h.country,t:["green","blue","rose"][i%3]}))||[{d:"26",m:"AUG",n:"Prophet’s Birthday",c:"KSA & Egypt",t:"green"}];return <div className="holiday-layout"><div className="panel calendar"><div className="calendar-head"><button><ChevronLeft/></button><h2>August 2026</h2><button><ChevronRight/></button></div><div className="weekdays">{["SUN","MON","TUE","WED","THU","FRI","SAT"].map(x=><span key={x}>{x}</span>)}</div><div className="dates">{Array.from({length:35},(_,i)=>i+1).map((n,i)=><span key={i} className={`${n===14?"today":""} ${list.some(h=>Number(h.d)===n)?"holiday":""}`}>{n<=31?n:""}{list.find(h=>Number(h.d)===n)&&<small>{list.find(h=>Number(h.d)===n)?.n}</small>}</span>)}</div></div><div className="panel holiday-list"><div className="panel-head"><div><h2>{rtl?"العطلات القادمة":"Upcoming holidays"}</h2><p>2026</p></div><button><MoreHorizontal/></button></div>{list.map(x=><div className="holiday-row" key={`${x.n}${x.d}`}><span className={`holiday-date ${x.t}`}><b>{x.d}</b><small>{x.m}</small></span><div><b>{x.n}</b><small>{x.c}</small></div><Status tone={x.t}>Active</Status></div>)}</div></div>}

function AttendanceTable({rtl,logs}:{rtl:boolean;logs:boolean}){return <div className="data-table attendance-table"><div className="tr th"><span>{rtl?"الموظف":"Employee"}</span><span>{rtl?"التاريخ":"Date"}</span><span>{logs?(rtl?"الوقت / الحدث":"Time / Event"):(rtl?"المقرر":"Scheduled")}</span><span>{logs?(rtl?"المصدر":"Source"):(rtl?"الفعلي":"Actual")}</span><span>{logs?(rtl?"الجهاز":"Device"):(rtl?"ساعات العمل":"Worked")}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{employees.map((e,i)=><div className="tr" key={e.id}><span className="person"><Avatar initials={e.initials} small tone={e.tone}/><span><b>{rtl?e.ar:e.name}</b><small>{e.id}</small></span></span><span>14 Aug 2026</span><span>{logs?(i%2?"08:59 · Check in":"08:54 · Check in"):"09:00 — 17:00"}</span><span>{logs?(i===1?"Remote":"Fingerprint"):i===2?"On leave":"08:57 — 17:12"}</span><span>{logs?(i===1?"Remote web":"ZK-Office-01"):i===2?"—":"8h 15m"}</span><span><Status tone={i===2?"violet":i===3?"amber":"green"}>{i===2?"Leave":i===3?"Late":"Present"}</Status></span><span><MoreHorizontal size={18}/></span></div>)}</div>}
function OrgCard({initials,name,role,tone}:{initials:string;name:string;role:string;tone:string}){return <button className="org-card"><Avatar initials={initials} tone={tone}/><div><b>{name}</b><span>{role}</span></div><MoreHorizontal size={16}/></button>}
function PermissionEditor({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){const modules=["Employees","Attendance","Leave management","Requests","Salaries","Users & permissions"];return <div className="permission-layout"><aside className="panel role-list"><div className="panel-head"><h2>{rtl?"الأدوار":"Roles"}</h2><button><Plus size={16}/></button></div>{["Super Admin","HR Manager","HR Specialist","Direct Manager","Employee"].map((r,i)=><button className={i===2?"active":""} key={r}><span className={`role-symbol ${["navy","violet","blue","green","gray"][i]}`}><ShieldCheck size={17}/></span><span><b>{r}</b><small>{[1,3,5,18,99][i]} users</small></span><ChevronRight size={15}/></button>)}</aside><div className="panel permissions"><div className="panel-head"><div><h2>HR Specialist</h2><p>{rtl?"صلاحيات الموارد البشرية التشغيلية":"Operational HR access"}</p></div><button className="primary" onClick={()=>notify(rtl?"تم حفظ الصلاحيات":"Permissions saved")}><Check size={16}/>{rtl?"حفظ التغييرات":"Save changes"}</button></div><div className="permission-table"><div className="permission-row head"><span>{rtl?"الوحدة":"Module"}</span>{["View","Create","Edit","Delete","Approve","Export"].map(x=><span key={x}>{x}</span>)}</div>{modules.map((m,i)=><div className="permission-row" key={m}><b>{m}</b>{Array.from({length:6},(_,j)=><label className="check-control" key={j}><input type="checkbox" defaultChecked={(i<4&&j<3)||(i===1&&j===5)||(i===3&&j===4)}/><span><Check size={12}/></span></label>)}</div>)}</div></div></div>}

function RequestDrawer({rtl,close,submit}:{rtl:boolean;close:()=>void;submit:()=>void}){const [type,setType]=useState("Annual leave");const days=useMemo(()=>type.includes("leave")?"4 days":"",[type]);return <div className="modal-layer"><button className="modal-scrim" onClick={close} aria-label="Close"/><aside className="drawer"><div className="drawer-head"><div><span className="eyebrow">{rtl?"خدمة الموظف":"EMPLOYEE SERVICE"}</span><h2>{rtl?"إنشاء طلب جديد":"Create new request"}</h2><p>{rtl?"سيُرسل الطلب إلى مديرك المباشر أولاً.":"Your direct manager will review this first."}</p></div><button className="icon-btn" onClick={close}><X size={20}/></button></div><div className="form-progress"><span className="active"><b>1</b>{rtl?"التفاصيل":"Details"}</span><i/><span><b>2</b>{rtl?"المراجعة":"Review"}</span></div><div className="form-body"><label className="field"><span>{rtl?"نوع الطلب":"Request type"}</span><select value={type} onChange={e=>setType(e.target.value)}><option>Annual leave</option><option>Sick leave</option><option>Late arrival</option><option>Early departure</option><option>Work from home</option><option>Expense reimbursement</option><option>Experience certificate</option></select></label>{type==="Expense reimbursement"?<><div className="form-row"><label className="field"><span>Expense date</span><input type="date" defaultValue="2026-08-14"/></label><label className="field"><span>Amount</span><input placeholder="0.00"/></label></div><label className="field"><span>Description</span><textarea placeholder="Tell us about this expense..."/></label></>:<><div className="form-row"><label className="field"><span>{rtl?"من تاريخ":"From date"}</span><input type="date" defaultValue="2026-08-18"/></label><label className="field"><span>{rtl?"إلى تاريخ":"To date"}</span><input type="date" defaultValue="2026-08-21"/></label></div>{days&&<div className="duration-note"><CalendarDays size={18}/><span><b>{rtl?"مدة الطلب: 4 أيام عمل":"Request duration: 4 working days"}</b><small>{rtl?"رصيدك المتاح 18 يوماً":"Your available balance is 18 days"}</small></span></div>}<label className="field"><span>{rtl?"السبب":"Reason"}</span><textarea placeholder={rtl?"اكتب سبب الطلب...":"Add a clear reason for your manager..."}/></label></>}<label className="upload"><FileText size={21}/><span><b>{rtl?"إضافة مرفق":"Add an attachment"}</b><small>PDF, JPG or PNG · Max 10 MB</small></span><Plus size={17}/></label></div><div className="drawer-footer"><button className="ghost" onClick={close}>{rtl?"حفظ كمسودة":"Save draft"}</button><span/><button className="outline" onClick={close}>{rtl?"إلغاء":"Cancel"}</button><button className="primary" onClick={submit}>{rtl?"إرسال الطلب":"Submit request"}<ChevronRight size={16}/></button></div></aside></div>}
function Notifications({rtl,onClose}:{rtl:boolean;onClose:()=>void}){return <div className="notification-pop"><div className="panel-head"><div><h2>{rtl?"الإشعارات":"Notifications"}</h2><p>{rtl?"لديك 3 إشعارات جديدة":"You have 3 new updates"}</p></div><button onClick={onClose}><X size={17}/></button></div>{[{i:CheckCircle2,t:"Leave request approved",d:"Your manager approved REQ-1048",c:"green"},{i:Clock3,t:"Attendance reminder",d:"You have an active remote session",c:"blue"},{i:Users,t:"New request to review",d:"Omar submitted a work from home request",c:"violet"}].map(({i:Icon,t,d,c})=><button className="notification-item" key={t}><span className={`notification-icon ${c}`}><Icon size={17}/></span><span><b>{t}</b><small>{d}</small></span><i/></button>)}<button className="view-notifications">{rtl?"عرض كل الإشعارات":"View all notifications"}</button></div>}
