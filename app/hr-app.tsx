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
  { name: "Mona Hassan", ar: "منى حسن", initials: "MH", id: "EMP-00042", dept: "People & Culture", role: "HR Specialist", location: "Cairo, Egypt", status: "Active", tone: "violet" },
  { name: "Omar Alharbi", ar: "عمر الحربي", initials: "OA", id: "EMP-00037", dept: "Engineering", role: "Senior Frontend Engineer", location: "Riyadh, KSA", status: "Active", tone: "blue" },
  { name: "Sara Mostafa", ar: "سارة مصطفى", initials: "SM", id: "EMP-00029", dept: "Customer Success", role: "CS Team Lead", location: "Cairo, Egypt", status: "On leave", tone: "rose" },
  { name: "Fahad Alqahtani", ar: "فهد القحطاني", initials: "FA", id: "EMP-00018", dept: "Sales", role: "Account Executive", location: "Riyadh, KSA", status: "Probation", tone: "amber" },
];

const requests = [
  { id: "REQ-1048", name: "Mona Hassan", type: "Annual leave", period: "18–21 Aug", date: "14 Aug, 09:15", status: "Manager approved", tone: "blue" },
  { id: "REQ-1047", name: "Omar Alharbi", type: "Work from home", period: "17 Aug", date: "14 Aug, 08:42", status: "Pending manager", tone: "amber" },
  { id: "REQ-1045", name: "Fahad Alqahtani", type: "Expense reimbursement", period: "SAR 640", date: "13 Aug, 16:20", status: "Pending HR", tone: "violet" },
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
  const [role, setRole] = useState("HR Manager");
  const t = copy[lang];
  const rtl = lang === "ar";

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
        <div className="brand"><div className="brand-mark">K</div><div><b>Koon</b><span>Human Resources</span></div><button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={20} /></button></div>
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
          <div className="profile-mini"><Avatar initials="AE" small /><div><b>{rtl ? "أحمد الشيوي" : "Ahmed Elshewy"}</b><span>{role}</span></div><MoreHorizontal size={18} /></div>
        </div>
      </aside>
      {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}

      <main className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div className="mobile-title">{currentTitle}</div>
          <button className="global-search"><Search size={18} /><span>{t.search}</span><kbd>⌘ K</kbd></button>
          <div className="top-actions">
            <label className="role-select"><ShieldCheck size={16} /><select value={role} onChange={e => setRole(e.target.value)}><option>HR Manager</option><option>Direct Manager</option><option>Employee</option><option>Super Admin</option></select><ChevronDown size={14} /></label>
            <button className="language" onClick={() => setLang(lang === "en" ? "ar" : "en")}><Languages size={17} />{lang === "en" ? "العربية" : "English"}</button>
            <button className="icon-btn notification-btn" onClick={() => setNotificationsOpen(!notificationsOpen)} aria-label="Notifications"><Bell size={19} /><span /></button>
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
    { label: rtl ? "إجمالي الموظفين" : "Total employees", value: "126", note: rtl ? "+4 هذا الشهر" : "+4 this month", icon: Users, tone: "blue" },
    { label: rtl ? "الحاضرون اليوم" : "Present today", value: "109", note: "86.5%", icon: CheckCircle2, tone: "green" },
    { label: rtl ? "في إجازة" : "On leave", value: "8", note: rtl ? "3 أقسام" : "3 departments", icon: CalendarDays, tone: "violet" },
    { label: rtl ? "متأخرون اليوم" : "Late today", value: "5", note: rtl ? "−2 عن الأمس" : "−2 vs yesterday", icon: Clock3, tone: "orange" },
  ];
  return <>
    <section className="page-heading"><div><span className="eyebrow">{rtl ? "الجمعة، 14 أغسطس 2026" : "FRIDAY, 14 AUGUST 2026"}</span><h1>{t.greeting} <span>👋</span></h1><p>{t.subtitle}</p></div><button className="primary" onClick={openRequest}><Plus size={17} />{t.newRequest}</button></section>
    <section className="stat-grid">{stats.map(({ label, value, note, icon: Icon, tone }) => <div className="stat-card" key={label}><div className={`stat-icon ${tone}`}><Icon size={20} /></div><div className="stat-value">{value}</div><div className="stat-label">{label}</div><div className={`stat-note ${tone}`}>{note}</div></div>)}</section>
    <section className="dashboard-grid">
      <div className="panel attendance-overview"><div className="panel-head"><div><h2>{rtl ? "نظرة عامة على الحضور" : "Attendance overview"}</h2><p>{rtl ? "الحضور اليومي خلال هذا الأسبوع" : "Daily attendance this week"}</p></div><button className="select-button">{rtl ? "هذا الأسبوع" : "This week"}<ChevronDown size={15} /></button></div><div className="legend"><span className="present">{rtl ? "حاضر" : "Present"}</span><span className="remote">{rtl ? "عن بعد" : "Remote"}</span><span className="away">{rtl ? "غياب / إجازة" : "Away / Leave"}</span></div><div className="chart">{[72,88,81,92,86,0,0].map((v,i) => <div className="bar-col" key={i}><div className="bar-track"><span className="bar-away" style={{height: `${v ? 100-v : 2}%`}}/><span className="bar-remote" style={{height: `${v ? 10+i%3*3 : 0}%`}}/><span className="bar-present" style={{height: `${v}%`}}/></div><small>{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][i]}</small></div>)}</div>
      </div>
      <div className="panel today-card"><div className="panel-head"><div><h2>{rtl ? "حضوري اليوم" : "My attendance today"}</h2><p>14 Aug 2026</p></div><Status>{rtl ? "تم الحضور" : "Present"}</Status></div><div className="time-ring"><div><Clock3 size={25}/><strong>06:18</strong><span>{rtl ? "ساعات العمل" : "hours worked"}</span></div></div><div className="time-points"><div><span>08:57</span><small>{rtl ? "تسجيل الدخول" : "Check in"}</small></div><div><span>—</span><small>{rtl ? "تسجيل الخروج" : "Check out"}</small></div></div><button className="outline wide" onClick={() => setPage("portal")}>{rtl ? "فتح الحضور عن بعد" : "Open remote attendance"}<ChevronRight size={16}/></button></div>
    </section>
    <section className="dashboard-grid lower">
      <div className="panel approvals-card"><div className="panel-head"><div><h2>{t.pending}</h2><p>{rtl ? "6 طلبات تحتاج إلى إجراء" : "6 requests need your action"}</p></div><button className="text-button" onClick={() => setPage("approvals")}>{t.viewAll}<ChevronRight size={15}/></button></div>{requests.map(r => <div className="approval-row" key={r.id}><Avatar initials={r.name.split(" ").map(x=>x[0]).join("")} tone={r.tone}/><div className="request-main"><b>{r.name}</b><span>{r.type} · {r.period}</span></div><small>{r.date.split(",")[0]}</small><button className="round-check"><Check size={16}/></button><button className="round-more"><MoreHorizontal size={17}/></button></div>)}</div>
      <div className="panel leave-card"><div className="panel-head"><div><h2>{rtl ? "رصيد الإجازات" : "Leave balance"}</h2><p>{rtl ? "لعام 2026" : "For 2026"}</p></div><button className="text-button" onClick={() => setPage("portal")}>{t.viewAll}<ChevronRight size={15}/></button></div><div className="balance"><div className="balance-ring"><strong>18</strong><span>{rtl ? "يوم متبقٍ" : "days left"}</span></div><div className="balance-info"><div><span>{rtl ? "الاستحقاق السنوي" : "Annual entitlement"}</span><b>30 days</b></div><div><span>{rtl ? "المستخدم" : "Used"}</span><b>10 days</b></div><div><span>{rtl ? "قيد الانتظار" : "Pending"}</span><b>2 days</b></div></div></div><div className="holiday-next"><CalendarDays size={19}/><div><small>{rtl ? "الإجازة القادمة" : "Next holiday"}</small><b>{rtl ? "المولد النبوي الشريف" : "Prophet’s Birthday"}</b></div><span>26 Aug</span></div></div>
    </section>
  </>;
}

function Portal({ rtl, openRequest, checkedIn, setCheckedIn, notify }: { rtl:boolean; openRequest:()=>void; checkedIn:boolean; setCheckedIn:(v:boolean)=>void; notify:(s:string)=>void }) {
  const [tab,setTab]=useState("requests");
  const recordAttendance=async()=>{try{await hrApi({action:"attendance_event",eventType:checkedIn?"check_out":"check_in"});setCheckedIn(!checkedIn);notify(checkedIn?(rtl?"تم تسجيل الخروج وحفظه":"Checked out and saved"):(rtl?"تم تسجيل الدخول وحفظه":"Checked in and saved"));}catch(e){notify(e instanceof Error?e.message:"Attendance action failed");}};
  return <><PageHeader eyebrow={rtl?"الخدمة الذاتية":"EMPLOYEE SELF-SERVICE"} title={rtl?"بوابة الموظف":"Employee portal"} text={rtl?"طلباتك، حضورك، ورصيد إجازاتك في مكان واحد.":"Your requests, attendance and leave in one place."} action={<button className="primary" onClick={openRequest}><Plus size={17}/>{rtl?"طلب جديد":"New request"}</button>}/><Tabs items={[{id:"requests",label:rtl?"طلباتي":"My requests"},{id:"remote",label:rtl?"الحضور عن بعد":"Remote attendance"}]} active={tab} setActive={setTab}/>{tab==="requests"?<div className="panel table-panel"><FilterBar rtl={rtl}/><RequestTable rtl={rtl}/></div>:<div className="remote-layout"><div className="panel remote-card"><span className="date-chip">Friday · 14 August 2026</span><div className="live-time">10:42<span>AM</span></div><p>{rtl?"توقيت القاهرة (UTC+3)":"Cairo time (UTC+3)"}</p><div className={`pulse ${checkedIn?"active":""}`}><Clock3 size={28}/></div><Status tone={checkedIn?"green":"gray"}>{checkedIn?(rtl?"جلسة نشطة":"Active session"):(rtl?"لم يبدأ الدوام":"Not checked in")}</Status><div className="session-summary"><div><small>{rtl?"الدخول":"CHECK IN"}</small><b>{checkedIn?"08:57 AM":"—"}</b></div><div><small>{rtl?"مدة العمل":"WORKED"}</small><b>{checkedIn?"01h 45m":"—"}</b></div></div><button className={checkedIn?"danger-action":"primary wide"} onClick={()=>void recordAttendance()}>{checkedIn?(rtl?"تسجيل الخروج":"Check out"):(rtl?"تسجيل الدخول":"Check in")}</button><small className="privacy"><ShieldCheck size={14}/>{rtl?"يُسجّل الموقع التقريبي لأغراض الحضور فقط":"Approximate location is recorded for attendance only"}</small></div><div className="panel week-card"><div className="panel-head"><div><h2>{rtl?"هذا الأسبوع":"This week"}</h2><p>{rtl?"سجل ساعاتك اليومية":"Your daily work record"}</p></div><b>32h 14m</b></div>{["Sunday","Monday","Tuesday","Wednesday","Thursday"].map((d,i)=><div className="day-row" key={d}><span className={i===4?"day-badge today":"day-badge"}>{i+10}</span><div><b>{rtl?["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس"][i]:d}</b><small>{i===4?"08:57 — Active":"09:00 — 17:05"}</small></div><span>{i===4?"1h 45m":"8h 04m"}</span></div>)}</div></div>}</>;
}

function Approvals({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){const [tab,setTab]=useState("pending");const {data,error,reload}=useHRData();const all=data?.requests??[];const list=all.filter(r=>tab==="all"||(tab==="pending"?String(r.status).startsWith("pending"):tab==="approved"?String(r.status).includes("approved"):String(r.status).includes("rejected")));const decide=async(id:number,decision:"approve"|"reject")=>{const reason=decision==="reject"?(window.prompt(rtl?"سبب الرفض (مطلوب)":"Rejection reason (required)")||""):"";if(decision==="reject"&&!reason)return;try{await hrApi({action:"request_action",requestId:id,decision,reason});await reload();notify(decision==="approve"?(rtl?"تم اعتماد الطلب وتحديث مرحلته":"Request approved and advanced"):(rtl?"تم رفض الطلب وتسجيل السبب":"Request rejected and reason recorded"));}catch(e){notify(e instanceof Error?e.message:"Action failed");}};return <><PageHeader eyebrow={rtl?"سير العمل":"WORKFLOW"} title={rtl?"اعتماد الطلبات":"Request approvals"} text={rtl?"راجع واعتمد طلبات فريقك في الوقت المناسب.":"Review and action team requests in one focused queue."}/><Tabs items={[{id:"pending",label:`${rtl?"بانتظار اعتمادي":"Pending my approval"} (${all.filter(r=>String(r.status).startsWith("pending")).length})`},{id:"approved",label:rtl?"معتمدة":"Approved"},{id:"rejected",label:rtl?"مرفوضة":"Rejected"},{id:"all",label:rtl?"كل الطلبات":"All requests"}]} active={tab} setActive={setTab}/><div className="panel table-panel">{error&&<div className="error-banner">{error}</div>}<FilterBar rtl={rtl}/>{list.length===0?<Empty title={rtl?"لا توجد طلبات":"No requests found"} text={rtl?"لا توجد نتائج ضمن المرشحات الحالية.":"Nothing matches the current filters."}/>:<div className="data-table approval-table"><div className="tr th"><span>{rtl?"الموظف":"Employee"}</span><span>{rtl?"الطلب":"Request"}</span><span>{rtl?"الفترة":"Period"}</span><span>{rtl?"مرحلة الاعتماد":"Approval stage"}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{list.map((r,i)=><div className="tr" key={r.id}><span className="person"><Avatar initials={String(r.employee_name||"E").split(" ").map((x:string)=>x[0]).join("")} small tone={["blue","violet","rose"][i%3]}/><span><b>{rtl?r.employee_name_ar:r.employee_name}</b><small>{r.department_name||"—"}</small></span></span><span><b>{r.type}</b><small>{r.request_code}</small></span><span>{r.from_date&&r.to_date?`${r.from_date} — ${r.to_date}`:r.request_date||"—"}</span><span><small>{r.current_stage}</small></span><span><Status tone={String(r.status).includes("rejected")?"rose":String(r.status).includes("approved")?"green":"amber"}>{String(r.status).replaceAll("_"," ")}</Status></span><span className="row-actions">{String(r.status).startsWith("pending")&&<><button onClick={()=>void decide(r.id,"approve")} aria-label="Approve"><Check size={15}/></button><button onClick={()=>void decide(r.id,"reject")} aria-label="Reject"><X size={15}/></button></>}</span></div>)}</div>}</div></>}

function EmployeesPage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){
  const [tab,setTab]=useState("employees"); const [open,setOpen]=useState(false); const {data,error,reload}=useHRData();
  const total=data?.employees.length??0, active=data?.employees.filter(e=>e.employment_status==="active").length??0;
  const ksa=data?.employees.filter(e=>e.country==="Saudi Arabia").length??0, egypt=data?.employees.filter(e=>e.country==="Egypt").length??0;
  return <><PageHeader eyebrow={rtl?"إدارة الأفراد":"PEOPLE MANAGEMENT"} title={rtl?"الموظفون":"Employees"} text={rtl?"إدارة بيانات الموظفين والوظائف والأقسام.":"Manage your people, roles and company structure."} action={<button className="primary" onClick={()=>setOpen(true)}><Plus size={17}/>{rtl?"إضافة موظف":"Add employee"}</button>}/>
  {error&&<div className="error-banner">{error}<button onClick={()=>void reload()}>{rtl?"إعادة المحاولة":"Retry"}</button></div>}
  <section className="mini-stats"><div><Users/><span><b>{total||"—"}</b>{rtl?"إجمالي الموظفين":"Total employees"}</span></div><div><CheckCircle2/><span><b>{active||"—"}</b>{rtl?"موظف نشط":"Active employees"}</span></div><div><Globe2/><span><b>{ksa} / {egypt}</b>{rtl?"السعودية / مصر":"KSA / Egypt"}</span></div><div><BriefcaseBusiness/><span><b>{data?.employees.filter(e=>String(e.created_at).startsWith("2026-08")).length??0}</b>{rtl?"موظفون جدد":"New this month"}</span></div></section>
  <Tabs items={[{id:"employees",label:rtl?"الموظفون":"Employees"},{id:"jobs",label:rtl?"المسميات الوظيفية":"Job titles"},{id:"departments",label:rtl?"الأقسام":"Departments"}]} active={tab} setActive={setTab}/><div className="panel table-panel"><FilterBar rtl={rtl}/>{tab==="employees"?<EmployeeTable rtl={rtl} rows={data?.employees}/>:tab==="jobs"?<JobTitleTable rtl={rtl} rows={data?.jobTitles} departments={data?.departments}/>:<DepartmentGrid rtl={rtl} rows={data?.departments} jobs={data?.jobTitles}/>}</div>
  {open&&<EmployeeDrawer rtl={rtl} data={data} close={()=>setOpen(false)} submit={async(form)=>{await hrApi({action:"create_employee",...form});setOpen(false);await reload();notify(rtl?"تم إنشاء الموظف وحساب المستخدم بنجاح":"Employee and user account created successfully");}}/>}</>}

function LeavePage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){const [tab,setTab]=useState("holidays"),[open,setOpen]=useState(false);const {data,error,reload}=useHRData();return <><PageHeader eyebrow={rtl?"السياسات والمواعيد":"POLICIES & CALENDAR"} title={rtl?"إدارة الإجازات":"Leave management"} text={rtl?"إدارة العطلات الرسمية وسياسات الإجازات لكلا البلدين.":"Configure holidays and leave policies across both countries."} action={<button className="primary" onClick={()=>setOpen(true)}><Plus size={17}/>{rtl?"إضافة عطلة":"Add holiday"}</button>}/>{error&&<div className="error-banner">{error}</div>}<Tabs items={[{id:"holidays",label:rtl?"العطلات الرسمية":"Official holidays"},{id:"settings",label:rtl?"إعدادات الإجازات":"Leave settings"},{id:"policies",label:rtl?"سياسات الإجازة":"Leave policies"}]} active={tab} setActive={setTab}/>{tab==="holidays"?<HolidayCalendar rtl={rtl} rows={data?.holidays}/>:<div className="settings-grid">{(tab==="settings"?[{t:"Holiday adjustments",d:"Move an official holiday to a replacement date",n:"2 active"},{t:"Country calendars",d:"Configure working-day behavior by country",n:"2 countries"},{t:"Approval workflow",d:"Manager and HR approval stages",n:"Standard"}]:[{t:"Annual leave",d:"Country and service-length based entitlement",n:"2 policies"},{t:"Sick leave",d:"Medical certificate required after 2 days",n:"Active"},{t:"Carry forward",d:"Maximum 5 days, expires after 90 days",n:"Configured"}]).map((x,i)=><button className="panel setting-card setting-button" key={x.t} onClick={()=>notify(rtl?"تم فتح الإعداد ويمكن تعديله من لوحة السياسات":"Setting opened in policy editor")}><span className={`setting-icon ${["blue","violet","green"][i]}`}><SlidersHorizontal/></span><div><h3>{x.t}</h3><p>{x.d}</p></div><Status tone={i===1?"violet":"green"}>{x.n}</Status><ChevronRight/></button>)}</div>}{open&&<HolidayDrawer rtl={rtl} close={()=>setOpen(false)} submit={async form=>{await hrApi({action:"create_holiday",...form});setOpen(false);await reload();notify(rtl?"تم حفظ العطلة وإضافتها للحضور":"Holiday saved and added to attendance calculations");}}/>}</>}

function AttendancePage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){const [tab,setTab]=useState("management");return <><PageHeader eyebrow={rtl?"الوقت والحضور":"TIME & ATTENDANCE"} title={rtl?"الحضور والانصراف":"Attendance"} text={rtl?"سجلات موحدة من أجهزة البصمة والعمل عن بعد والتعديلات.":"One reconciled view across devices, remote work and corrections."} action={<button className="outline" onClick={()=>notify(rtl?"جارٍ إعداد ملف Excel":"Excel export prepared with active filters")}><Download size={17}/>{rtl?"تصدير Excel":"Export Excel"}</button>}/><Tabs items={[{id:"logs",label:rtl?"سجلات الحضور":"Attendance logs"},{id:"management",label:rtl?"إدارة الحضور":"Attendance management"}]} active={tab} setActive={setTab}/><div className="panel table-panel"><FilterBar rtl={rtl}/><AttendanceTable rtl={rtl} logs={tab==="logs"}/></div></>}

function OrgPage({rtl}:{rtl:boolean}){
  const {data,error,reload}=useHRData();
  const [query,setQuery]=useState("");
  const [zoom,setZoom]=useState(90);
  const departments=data?.departments??[], employeesData=data?.employees??[], jobs=data?.jobTitles??[];
  const directorDepartment=departments.find(department=>/Managing Director|العضو المنتدب/i.test(`${department.name_en} ${department.name_ar}`));
  const director=employeesData.find(employee=>Number(employee.department_id)===Number(directorDepartment?.id)) ?? employeesData.find(employee=>/Chief Executive|الرئيس التنفيذ/i.test(String(employee.job_title_name||"")));
  const jobById=new Map(jobs.map(job=>[Number(job.id),job]));
  const normalized=query.trim().toLocaleLowerCase();
  const branches=departments
    .filter(department=>Number(department.id)!==Number(directorDepartment?.id))
    .map((department,index)=>({
      department,
      tone:["blue","violet","green","rose","amber"][index%5],
      members:employeesData.filter(employee=>Number(employee.department_id)===Number(department.id)),
    }))
    .filter(branch=>!normalized||`${branch.department.name_en} ${branch.department.name_ar} ${branch.members.map(member=>`${member.name_en} ${member.name_ar}`).join(" ")}`.toLocaleLowerCase().includes(normalized))
    .sort((a,b)=>String(rtl?a.department.name_ar:a.department.name_en).localeCompare(String(rtl?b.department.name_ar:b.department.name_en),rtl?"ar":"en"));
  const directorJob=director?jobById.get(Number(director.job_title_id)):undefined;
  return <><PageHeader eyebrow={rtl?"هيكل الشركة":"COMPANY STRUCTURE"} title={rtl?"الهيكل التنظيمي":"Organization chart"} text={rtl?"العضو المنتدب أولاً، ثم الأقسام والموظفون طبقاً لملف الموظفين.":"Managing director first, followed by departments and employees from the workforce file."}/>
  {error&&<div className="error-banner">{error}<button onClick={()=>void reload()}>{rtl?"إعادة المحاولة":"Retry"}</button></div>}
  <div className="org-toolbar"><button onClick={()=>setZoom(value=>Math.min(120,value+10))} aria-label={rtl?"تكبير":"Zoom in"}><Plus size={16}/></button><button onClick={()=>setZoom(90)}>{zoom}%</button><button onClick={()=>setZoom(value=>Math.max(60,value-10))} aria-label={rtl?"تصغير":"Zoom out"}>−</button><span></span><label className="org-search"><Search size={15}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={rtl?"ابحث عن قسم أو موظف":"Find a department or employee"}/></label><label><Building2 size={16}/>{branches.length} {rtl?"قسم":"departments"}</label></div>
  <div className="panel org-canvas"><div className="org-chart" style={{transform:`scale(${zoom/100})`,transformOrigin:"top center"}}>
    {director?<div className="org-root"><span className="org-level-label">{rtl?"العضو المنتدب":"MANAGING DIRECTOR"}</span><OrgCard initials={personInitials(director.name_en)} name={rtl?director.name_ar:director.name_en} role={rtl?(directorJob?.name_ar||director.job_title_name):(directorJob?.name_en||director.job_title_name)} tone="blue"/><small>{director.employee_code}</small></div>:<Empty icon={Network} title={rtl?"لم يتم العثور على العضو المنتدب":"Managing director not found"} text={rtl?"تحقق من بيانات قسم العضو المنتدب في ملف الموظفين.":"Check the managing-director department in the employee file."}/>}
    {director&&<div className="org-main-connector"/>}
    <div className="org-department-list">{branches.map(({department,members,tone})=><section className="org-department-branch" key={department.id}><div className="org-department-card"><span className={`department-icon ${tone}`}><Building2/></span><div><h3>{rtl?department.name_ar:department.name_en}</h3><p>{rtl?department.name_en:department.name_ar}</p></div><b>{members.length}<small>{rtl?"موظف":"employees"}</small></b></div><div className="org-team-list">{members.map(member=>{const job=jobById.get(Number(member.job_title_id));return <div className="org-employee-node" key={member.id}><Avatar initials={personInitials(member.name_en)} small tone={tone}/><div><b>{rtl?member.name_ar:member.name_en}</b><span>{rtl?(job?.name_ar||member.job_title_name):(job?.name_en||member.job_title_name)}</span><small>{member.employee_code}</small></div></div>})}</div></section>)}</div>
    {data&&branches.length===0&&<Empty icon={Building2} title={rtl?"لا توجد أقسام مطابقة":"No matching departments"} text={rtl?"غيّر عبارة البحث لعرض بقية الهيكل.":"Change the search to show the rest of the chart."}/>}
  </div></div></>}

function UsersPage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){const [tab,setTab]=useState("users");return <><PageHeader eyebrow={rtl?"إدارة الوصول":"ACCESS CONTROL"} title={rtl?"المستخدمون والصلاحيات":"Users & permissions"} text={rtl?"تحكم دقيق بالوصول بناءً على الدور ونطاق البيانات.":"Granular role-based access with clear data scope."} action={<button className="primary"><Plus size={17}/>{rtl?"إضافة مستخدم":"Add user"}</button>}/><Tabs items={[{id:"users",label:rtl?"المستخدمون":"Users"},{id:"roles",label:rtl?"الأدوار والصلاحيات":"Roles & permissions"}]} active={tab} setActive={setTab}/>{tab==="users"?<div className="panel table-panel"><FilterBar rtl={rtl}/><EmployeeTable rtl={rtl} users/></div>:<PermissionEditor rtl={rtl} notify={notify}/>}</>}

function SettingsPage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){return <><PageHeader eyebrow={rtl?"تهيئة النظام":"SYSTEM CONFIGURATION"} title={rtl?"الإعدادات":"Settings"} text={rtl?"اضبط سياسات الشركة دون تغيير منطق النظام.":"Configure company policies without changing application logic."}/><div className="settings-grid wide">{[{i:Building2,t:"Company information",d:"Legal entities, business units and offices"},{i:Clock3,t:"Schedules & shifts",d:"Working days, grace periods and shift patterns"},{i:Activity,t:"Attendance policies",d:"Overtime, lateness and correction rules"},{i:CalendarDays,t:"Leave policies",d:"Entitlements, carry-forward and approvals"},{i:CheckCircle2,t:"Approval workflows",d:"Configure stages by request type"},{i:Bell,t:"Notifications",d:"Channels, templates and audience rules"},{i:Globe2,t:"Languages & regions",d:"Arabic, English, timezones and formats"},{i:ShieldCheck,t:"Security",d:"Sessions, passwords and audit controls"}].map(({i:Icon,t,d},idx)=><button className="panel setting-card setting-button" key={t} onClick={()=>notify(`${t} opened`)}><span className={`setting-icon ${["blue","violet","green","amber"][idx%4]}`}><Icon/></span><div><h3>{t}</h3><p>{d}</p></div><ChevronRight/></button>)}</div></>}

function PageHeader({eyebrow,title,text,action}:{eyebrow:string;title:string;text:string;action?:React.ReactNode}){return <section className="page-heading compact"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{action}</section>}
function Tabs({items,active,setActive}:{items:{id:string;label:string}[];active:string;setActive:(s:string)=>void}){return <div className="tabs">{items.map(x=><button className={active===x.id?"active":""} key={x.id} onClick={()=>setActive(x.id)}>{x.label}</button>)}</div>}
function FilterBar({rtl}:{rtl:boolean}){return <div className="filterbar"><label><Search size={17}/><input placeholder={rtl?"البحث...":"Search..."}/></label><button><SlidersHorizontal size={16}/>{rtl?"التصفية":"Filters"}<span className="filter-count">2</span></button><button className="desktop-filter">{rtl?"كل الأقسام":"All departments"}<ChevronDown size={14}/></button><button className="desktop-filter">{rtl?"هذا الشهر":"This month"}<ChevronDown size={14}/></button><span className="spacer"/><button className="icon-only"><Grid2X2 size={17}/></button></div>}

function RequestTable({rtl}:{rtl:boolean}){return <div className="data-table"><div className="tr th"><span>{rtl?"الطلب":"Request"}</span><span>{rtl?"تاريخ التقديم":"Submitted"}</span><span>{rtl?"الفترة":"Period"}</span><span>{rtl?"اعتماد المدير":"Manager"}</span><span>{rtl?"اعتماد الموارد البشرية":"HR"}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{requests.map((r,i)=><div className="tr" key={r.id}><span><b>{r.type}</b><small>{r.id}</small></span><span>{r.date}</span><span>{r.period}</span><span><Status tone={i===1?"amber":"green"}>{i===1?"Pending":"Approved"}</Status></span><span><Status tone={i===2?"amber":"gray"}>{i===2?"Pending":"Waiting"}</Status></span><span><Status tone={r.tone}>{r.status}</Status></span><span><button className="plain-icon"><MoreHorizontal size={18}/></button></span></div>)}</div>}
function EmployeeTable({rtl,users=false,rows}:{rtl:boolean;users?:boolean;rows?:Record<string,any>[]}){const list=rows?.map((e,i)=>({name:e.name_en,ar:e.name_ar,initials:String(e.name_en||"E").split(" ").map((x:string)=>x[0]).join("").slice(0,2),id:e.employee_code,dept:e.department_name||"—",role:e.job_title_name||"—",location:e.work_location||e.country,status:String(e.employment_status||"active").replaceAll("_"," "),tone:["violet","blue","rose","amber"][i%4]}))||employees;return <div className="data-table employee-table"><div className="tr th"><span>{rtl?"الموظف":"Employee"}</span><span>{rtl?"القسم":"Department"}</span><span>{rtl?"المسمى الوظيفي":"Job title"}</span><span>{users?(rtl?"الدور":"Role"):(rtl?"الموقع":"Location")}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{list.map((e,i)=><div className="tr" key={e.id}><span className="person"><Avatar initials={e.initials} small tone={e.tone}/><span><b>{rtl?e.ar:e.name}</b><small>{e.id}</small></span></span><span>{e.dept}</span><span>{e.role}</span><span>{users?["HR Specialist","Employee","Direct Manager","Employee"][i%4]:e.location}</span><span><Status tone={String(e.status).toLowerCase()==="active"?"green":String(e.status).toLowerCase()==="on leave"?"violet":"amber"}>{e.status}</Status></span><span><button className="plain-icon" aria-label={rtl?"إجراءات الموظف":"Employee actions"}><MoreHorizontal size={18}/></button></span></div>)}</div>}

function JobTitleTable({rtl,rows,departments}:{rtl:boolean;rows?:Record<string,any>[];departments?:Record<string,any>[]}){const list=rows??[];const departmentById=new Map((departments??[]).map(department=>[Number(department.id),department]));return list.length?<div className="data-table job-title-table"><div className="tr th"><span>{rtl?"الاسم الإنجليزي":"English name"}</span><span>{rtl?"الاسم العربي":"Arabic name"}</span><span>{rtl?"القسم":"Department"}</span><span>{rtl?"عدد الموظفين":"Employees"}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{list.map(job=>{const department=departmentById.get(Number(job.department_id));return <div className="tr" key={job.id}><span><b>{job.name_en}</b></span><span>{job.name_ar}</span><span>{rtl?(department?.name_ar||job.department_name):(department?.name_en||job.department_name)||"—"}</span><span>{Number(job.employee_count)||0}</span><span><Status tone={job.status==="active"?"green":"gray"}>{job.status||"active"}</Status></span><span><button className="plain-icon" aria-label={rtl?"إجراءات المسمى":"Job title actions"}><MoreHorizontal size={18}/></button></span></div>})}</div>:<Empty icon={BriefcaseBusiness} title={rtl?"لا توجد مسميات وظيفية":"No job titles"} text={rtl?"لم يتم تحميل المسميات الوظيفية بعد.":"Job titles have not loaded yet."}/>}
function DepartmentGrid({rtl,rows,jobs}:{rtl:boolean;rows?:Record<string,any>[];jobs?:Record<string,any>[]}){const list=rows??[];return list.length?<div className="department-grid">{list.map((department,index)=>{const tone=["blue","violet","green","rose","amber"][index%5];const titleCount=(jobs??[]).filter(job=>Number(job.department_id)===Number(department.id)).length;return <div className="department-card" key={department.id}><span className={`department-icon ${tone}`}><Building2/></span><h3>{rtl?department.name_ar:department.name_en}</h3><p>{rtl?department.name_en:department.name_ar}</p><div className="department-summary"><BriefcaseBusiness size={17}/><span><small>{rtl?"المسميات الوظيفية":"Job titles"}</small><b>{titleCount}</b></span></div><footer><Users size={15}/>{Number(department.employee_count)||0} {rtl?"موظفاً":"employees"}</footer></div>})}</div>:<Empty icon={Building2} title={rtl?"لا توجد أقسام":"No departments"} text={rtl?"لم يتم تحميل الأقسام بعد.":"Departments have not loaded yet."}/>}
function HolidayCalendar({rtl,rows}:{rtl:boolean;rows?:Record<string,any>[]}){const list=rows?.map((h,i)=>({d:String(h.holiday_date||"").slice(8,10),m:new Date(h.holiday_date).toLocaleString("en",{month:"short"}).toUpperCase(),n:rtl?h.name_ar:h.name_en,c:h.country,t:["green","blue","rose"][i%3]}))||[{d:"26",m:"AUG",n:"Prophet’s Birthday",c:"KSA & Egypt",t:"green"}];return <div className="holiday-layout"><div className="panel calendar"><div className="calendar-head"><button><ChevronLeft/></button><h2>August 2026</h2><button><ChevronRight/></button></div><div className="weekdays">{["SUN","MON","TUE","WED","THU","FRI","SAT"].map(x=><span key={x}>{x}</span>)}</div><div className="dates">{Array.from({length:35},(_,i)=>i+1).map((n,i)=><span key={i} className={`${n===14?"today":""} ${list.some(h=>Number(h.d)===n)?"holiday":""}`}>{n<=31?n:""}{list.find(h=>Number(h.d)===n)&&<small>{list.find(h=>Number(h.d)===n)?.n}</small>}</span>)}</div></div><div className="panel holiday-list"><div className="panel-head"><div><h2>{rtl?"العطلات القادمة":"Upcoming holidays"}</h2><p>2026</p></div><button><MoreHorizontal/></button></div>{list.map(x=><div className="holiday-row" key={`${x.n}${x.d}`}><span className={`holiday-date ${x.t}`}><b>{x.d}</b><small>{x.m}</small></span><div><b>{x.n}</b><small>{x.c}</small></div><Status tone={x.t}>Active</Status></div>)}</div></div>}

function AttendanceTable({rtl,logs}:{rtl:boolean;logs:boolean}){return <div className="data-table attendance-table"><div className="tr th"><span>{rtl?"الموظف":"Employee"}</span><span>{rtl?"التاريخ":"Date"}</span><span>{logs?(rtl?"الوقت / الحدث":"Time / Event"):(rtl?"المقرر":"Scheduled")}</span><span>{logs?(rtl?"المصدر":"Source"):(rtl?"الفعلي":"Actual")}</span><span>{logs?(rtl?"الجهاز":"Device"):(rtl?"ساعات العمل":"Worked")}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{employees.map((e,i)=><div className="tr" key={e.id}><span className="person"><Avatar initials={e.initials} small tone={e.tone}/><span><b>{rtl?e.ar:e.name}</b><small>{e.id}</small></span></span><span>14 Aug 2026</span><span>{logs?(i%2?"08:59 · Check in":"08:54 · Check in"):"09:00 — 17:00"}</span><span>{logs?(i===1?"Remote":"Fingerprint"):i===2?"On leave":"08:57 — 17:12"}</span><span>{logs?(i===1?"Remote web":"ZK-Office-01"):i===2?"—":"8h 15m"}</span><span><Status tone={i===2?"violet":i===3?"amber":"green"}>{i===2?"Leave":i===3?"Late":"Present"}</Status></span><span><MoreHorizontal size={18}/></span></div>)}</div>}
function OrgCard({initials,name,role,tone}:{initials:string;name:string;role:string;tone:string}){return <button className="org-card"><Avatar initials={initials} tone={tone}/><div><b>{name}</b><span>{role}</span></div><MoreHorizontal size={16}/></button>}
function PermissionEditor({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){const modules=["Employees","Attendance","Leave management","Requests","Salaries","Users & permissions"];return <div className="permission-layout"><aside className="panel role-list"><div className="panel-head"><h2>{rtl?"الأدوار":"Roles"}</h2><button><Plus size={16}/></button></div>{["Super Admin","HR Manager","HR Specialist","Direct Manager","Employee"].map((r,i)=><button className={i===2?"active":""} key={r}><span className={`role-symbol ${["navy","violet","blue","green","gray"][i]}`}><ShieldCheck size={17}/></span><span><b>{r}</b><small>{[1,3,5,18,99][i]} users</small></span><ChevronRight size={15}/></button>)}</aside><div className="panel permissions"><div className="panel-head"><div><h2>HR Specialist</h2><p>{rtl?"صلاحيات الموارد البشرية التشغيلية":"Operational HR access"}</p></div><button className="primary" onClick={()=>notify(rtl?"تم حفظ الصلاحيات":"Permissions saved")}><Check size={16}/>{rtl?"حفظ التغييرات":"Save changes"}</button></div><div className="permission-table"><div className="permission-row head"><span>{rtl?"الوحدة":"Module"}</span>{["View","Create","Edit","Delete","Approve","Export"].map(x=><span key={x}>{x}</span>)}</div>{modules.map((m,i)=><div className="permission-row" key={m}><b>{m}</b>{Array.from({length:6},(_,j)=><label className="check-control" key={j}><input type="checkbox" defaultChecked={(i<4&&j<3)||(i===1&&j===5)||(i===3&&j===4)}/><span><Check size={12}/></span></label>)}</div>)}</div></div></div>}

function RequestDrawer({rtl,close,submit}:{rtl:boolean;close:()=>void;submit:()=>void}){const [type,setType]=useState("Annual leave");const days=useMemo(()=>type.includes("leave")?"4 days":"",[type]);return <div className="modal-layer"><button className="modal-scrim" onClick={close} aria-label="Close"/><aside className="drawer"><div className="drawer-head"><div><span className="eyebrow">{rtl?"خدمة الموظف":"EMPLOYEE SERVICE"}</span><h2>{rtl?"إنشاء طلب جديد":"Create new request"}</h2><p>{rtl?"سيُرسل الطلب إلى مديرك المباشر أولاً.":"Your direct manager will review this first."}</p></div><button className="icon-btn" onClick={close}><X size={20}/></button></div><div className="form-progress"><span className="active"><b>1</b>{rtl?"التفاصيل":"Details"}</span><i/><span><b>2</b>{rtl?"المراجعة":"Review"}</span></div><div className="form-body"><label className="field"><span>{rtl?"نوع الطلب":"Request type"}</span><select value={type} onChange={e=>setType(e.target.value)}><option>Annual leave</option><option>Sick leave</option><option>Late arrival</option><option>Early departure</option><option>Work from home</option><option>Expense reimbursement</option><option>Experience certificate</option></select></label>{type==="Expense reimbursement"?<><div className="form-row"><label className="field"><span>Expense date</span><input type="date" defaultValue="2026-08-14"/></label><label className="field"><span>Amount</span><input placeholder="0.00"/></label></div><label className="field"><span>Description</span><textarea placeholder="Tell us about this expense..."/></label></>:<><div className="form-row"><label className="field"><span>{rtl?"من تاريخ":"From date"}</span><input type="date" defaultValue="2026-08-18"/></label><label className="field"><span>{rtl?"إلى تاريخ":"To date"}</span><input type="date" defaultValue="2026-08-21"/></label></div>{days&&<div className="duration-note"><CalendarDays size={18}/><span><b>{rtl?"مدة الطلب: 4 أيام عمل":"Request duration: 4 working days"}</b><small>{rtl?"رصيدك المتاح 18 يوماً":"Your available balance is 18 days"}</small></span></div>}<label className="field"><span>{rtl?"السبب":"Reason"}</span><textarea placeholder={rtl?"اكتب سبب الطلب...":"Add a clear reason for your manager..."}/></label></>}<label className="upload"><FileText size={21}/><span><b>{rtl?"إضافة مرفق":"Add an attachment"}</b><small>PDF, JPG or PNG · Max 10 MB</small></span><Plus size={17}/></label></div><div className="drawer-footer"><button className="ghost" onClick={close}>{rtl?"حفظ كمسودة":"Save draft"}</button><span/><button className="outline" onClick={close}>{rtl?"إلغاء":"Cancel"}</button><button className="primary" onClick={submit}>{rtl?"إرسال الطلب":"Submit request"}<ChevronRight size={16}/></button></div></aside></div>}
function Notifications({rtl,onClose}:{rtl:boolean;onClose:()=>void}){return <div className="notification-pop"><div className="panel-head"><div><h2>{rtl?"الإشعارات":"Notifications"}</h2><p>{rtl?"لديك 3 إشعارات جديدة":"You have 3 new updates"}</p></div><button onClick={onClose}><X size={17}/></button></div>{[{i:CheckCircle2,t:"Leave request approved",d:"Your manager approved REQ-1048",c:"green"},{i:Clock3,t:"Attendance reminder",d:"You have an active remote session",c:"blue"},{i:Users,t:"New request to review",d:"Omar submitted a work from home request",c:"violet"}].map(({i:Icon,t,d,c})=><button className="notification-item" key={t}><span className={`notification-icon ${c}`}><Icon size={17}/></span><span><b>{t}</b><small>{d}</small></span><i/></button>)}<button className="view-notifications">{rtl?"عرض كل الإشعارات":"View all notifications"}</button></div>}
