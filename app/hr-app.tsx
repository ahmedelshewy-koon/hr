"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, Bell, BriefcaseBusiness, Building2, CalendarDays, Check,
  CheckCircle2, ChevronDown, ChevronRight, ChevronUp, CircleUserRound,
  Clock3, Download, Eye, EyeOff, FileText, Globe2, GripVertical, HelpCircle, KeyRound,
  Languages, LayoutDashboard, LayoutGrid, List, Lock, LogOut, Menu, Minus, MoreHorizontal, Network, PanelLeftClose, PanelLeftOpen,
  Pencil, Plus, Printer, RotateCcw, Search, Send, Settings, ShieldCheck, SlidersHorizontal,
  Trash2, Unlock, Users, Wallet, X, Trophy, UserRoundSearch, Workflow, Laptop, GraduationCap,
} from "lucide-react";
import { BankExportLayoutDrawer, EmployeeDetailsDrawer, EmployeeDrawer, HolidayDrawer, InsuranceRateDrawer, LoanDrawer, OrganizationEntityDrawer, PayrollRunDrawer, SalaryStructureDrawer, SettingsDrawer, TaxBracketDrawer } from "./employee-drawer";
import { localizedDisplayValue, localizedJobTitle } from "./localization";
import { EmployeePortalWorkspace } from "./employee-portal-workspace";
import { EmployeeRequestDrawer } from "./employee-request-drawer";
import { ApprovalsBadge, ApprovalsCenter } from "./approvals-center";
import { EmployeeProfile360 } from "./employee-profile-360";
import { LeavePoliciesPanel } from "./leave-policies-panel";
import { AttendanceWorkspace } from "./attendance-workspace";
import { TalentWorkspace } from "./talent-workspaces";
import { RecruitmentWorkspace } from "./recruitment-workspace";
import { PerformanceWorkspace } from "./performance-workspace";
import { LifecycleWorkspace } from "./lifecycle-workspace";
import { LearningWorkspace } from "./learning-workspace";
import { isCompanyOrganizationUnit, organizationManagerLabel } from "./organization/organization-labels";
import "./org-chart.css";
import "./login.css";
import "./leave-types.css";
import "./payroll.css";
import "./employee-portal.css";
import "./attendance.css";
import "./approvals-center.css";
import "./employee-profile-360.css";
import "./employee-profile-filters.css";
import "./page-title.css";
import "./typography.css";

type Lang = "en" | "ar";
type Page = "dashboard" | "portal" | "approvals" | "employees" | "leave" | "attendance" | "performance" | "recruitment" | "lifecycle" | "assets" | "learning" | "org" | "users" | "reports" | "payroll" | "settings";
type RoleId = "hr_manager" | "department_manager" | "employee" | "super_admin";
type AuthUser = { id:number;email:string;role_name:string;role_name_en?:string|null;role_name_ar?:string|null;allowed_pages?:Page[];employee_id?:number|null;employee_name?:string|null;employee_name_ar?:string|null;department_name?:string|null;department_name_ar?:string|null;must_change_password?:number };

const localeFor = (rtl: boolean) => rtl ? "ar-SA-u-nu-arab" : "en-GB";
const formatNumber = (value: number, rtl: boolean) => new Intl.NumberFormat(localeFor(rtl)).format(value);
const formatDate = (value: string | Date, rtl: boolean, options: Intl.DateTimeFormatOptions = { day:"numeric", month:"short", year:"numeric" }) =>
  new Intl.DateTimeFormat(localeFor(rtl), options).format(typeof value === "string" ? new Date(`${value}T12:00:00`) : value);
const localizedStatus =(value: unknown, rtl: boolean) => {
  const key = String(value || "active").toLowerCase().replaceAll("_"," ");
  const ar:Record<string,string> = { active:"نشط", archived:"مؤرشف", "on leave":"في إجازة", probation:"تحت التجربة", suspended:"موقوف", "notice period":"فترة إشعار", pending:"قيد الانتظار", "pending manager":"بانتظار المدير", "pending hr":"بانتظار الموارد البشرية", waiting:"بانتظار الإجراء", approved:"معتمد", "hr approved":"معتمد", "manager rejected":"مرفوض من المدير", "hr rejected":"مرفوض من الموارد البشرية", rejected:"مرفوض", cancelled:"ملغي", present:"حاضر", remote:"عن بُعد", holiday:"عطلة رسمية", leave:"إجازة", late:"متأخر", configured:"مُعدّ", standard:"قياسي" };
  return rtl ? (ar[key] || localizedDisplayValue(value,true)) : key.replace(/\b\w/g, letter => letter.toUpperCase());
};
const localizedRequestType = (value: unknown, rtl: boolean) => {
  const key = String(value || "");
  const ar:Record<string,string> = { "Annual leave":"إجازة سنوية", "Sick leave":"إجازة مرضية", "Late arrival":"تأخر عن الدوام", "Early departure":"انصراف مبكر", "Work from home":"عمل عن بُعد", "Expense reimbursement":"استرداد مصروفات", "Experience certificate":"شهادة خبرة" };
  return rtl ? (ar[key] || localizedDisplayValue(key,true)) : key;
};
const localizedStage = (value: unknown, rtl: boolean) => {
  const key = String(value || "").toLowerCase().replaceAll("_"," ");
  const ar:Record<string,string> = { manager:"المدير المباشر", "direct manager":"المدير المباشر", hr:"الموارد البشرية", employee:"الموظف", completed:"مكتمل" };
  return rtl ? (ar[key] || localizedDisplayValue(value,true)) : String(value || "—").replaceAll("_"," ").replace(/\b\w/g,letter=>letter.toUpperCase());
};
const localizedCountry = (value: unknown, rtl: boolean) => {
  const key=String(value||"");
  const ar:Record<string,string>={"Saudi Arabia":"السعودية",KSA:"السعودية",Egypt:"مصر",Both:"السعودية ومصر","KSA & Egypt":"السعودية ومصر"};
  return rtl?(ar[key]||localizedDisplayValue(key,true)):key.replace("KSA","Saudi Arabia");
};
const parseSetting = (row?:Record<string,any>) => { try { return JSON.parse(String(row?.value_json||"{}")) as Record<string,unknown>; } catch { return {}; } };
const localizedRole = (role: RoleId, rtl: boolean) => ({
  hr_manager: rtl ? "مدير الموارد البشرية" : "HR Manager",
  department_manager: rtl ? "مدير القسم" : "Department Manager",
  employee: rtl ? "موظف" : "Employee",
  super_admin: rtl ? "مدير النظام" : "Super Admin",
}[role]);
const roleIdFromName=(name:unknown):RoleId=>name==="Super Admin"?"super_admin":name==="HR Manager"?"hr_manager":name==="Department Manager"?"department_manager":"employee";
const roleLabel=(role:Record<string,any>|undefined,rtl:boolean)=>role?(rtl?(role.name_ar||role.role_name_ar||localizedRole(roleIdFromName(role.name||role.role_name),true)):(role.name_en||role.role_name_en||(/^(Super Admin|HR Manager|Department Manager|Employee)$/.test(String(role.name||role.role_name))?localizedRole(roleIdFromName(role.name||role.role_name),false):(role.name||role.role_name)))):"—";
const permissionModuleLabel=(module:string,rtl:boolean)=>{const labels:Record<string,[string,string]>={assets:["Assets","الأصول"],attendance:["Attendance","الحضور والانصراف"],attendance_adjustments:["Attendance adjustments","تعديلات الحضور"],dashboard:["Dashboard","لوحة التحكم"],departments:["Departments","الأقسام"],employee_portal:["Employee portal","بوابة الموظف"],employee_requests:["Employee requests","طلبات الموظف"],employee_salaries:["Employee salaries","رواتب الموظفين"],employees:["Employees","الموظفون"],job_titles:["Job titles","المسميات الوظيفية"],learning:["Learning","التعلم"],leave_management:["Leave management","إدارة الإجازات"],offboarding:["Offboarding","إنهاء الخدمة"],onboarding:["Onboarding","التهيئة"],organization_chart:["Organization chart","الهيكل التنظيمي"],payroll:["Payroll","الرواتب"],performance:["Performance","الأداء"],permissions:["Permissions","الصلاحيات"],recruitment:["Recruitment","التوظيف"],reports:["Reports","التقارير والتصدير"],request_approvals:["Request approvals","اعتماد الطلبات"],system_settings:["System settings","إعدادات النظام"],users:["Users","المستخدمون"]};return labels[module]?.[rtl?1:0]||localizedDisplayValue(module,rtl);};

const copy = {
  en: {
    dashboard: "Dashboard", portal: "Employee Portal", approvals: "Request Approvals",
    employees: "Employees", leave: "Leave Management", attendance: "Attendance",
    performance:"Performance",recruitment:"Recruitment",lifecycle:"Onboarding & Offboarding",assets:"Assets",learning:"Learning",org: "Organization Chart", users: "Users & Permissions", reports:"Reports & Exports", payroll: "Payroll", settings: "Settings",
    search: "Search anything...", greeting: "Good morning", subtitle: "Here’s what’s happening with your team today.",
    newRequest: "New request", viewAll: "View all", pending: "Pending approvals",
  },
  ar: {
    dashboard: "لوحة التحكم", portal: "بوابة الموظف", approvals: "اعتماد الطلبات",
    employees: "الموظفون", leave: "إدارة الإجازات", attendance: "الحضور والانصراف",
    performance:"الأداء",recruitment:"التوظيف",lifecycle:"التهيئة وإنهاء الخدمة",assets:"الأصول",learning:"التعلم",org: "الهيكل التنظيمي", users: "المستخدمون والصلاحيات", reports:"التقارير والتصدير", payroll: "الرواتب", settings: "الإعدادات",
    search: "ابحث في النظام...", greeting: "صباح الخير", subtitle: "إليك ملخص فريقك لهذا اليوم.",
    newRequest: "طلب جديد", viewAll: "عرض الكل", pending: "طلبات بانتظار الاعتماد",
  },
};

type HRData = {
  demoDataEnabled?: boolean;
  employees: Record<string,any>[]; departments: Record<string,any>[]; jobTitles: Record<string,any>[];
  requests: Record<string,any>[]; attendance: Record<string,any>[]; holidays: Record<string,any>[];
  leaveTypes: Record<string,any>[];
  employeeLeaveTypes: Record<string,any>[];
  leavePolicies: Record<string,any>[]; leaveBalances: Record<string,any>[]; requestApprovals: Record<string,any>[];
  roles: Record<string,any>[]; users: Record<string,any>[]; permissions: Record<string,any>[]; audit: Record<string,any>[];
  settings: Record<string,any>[];
  salaryStructures: Record<string, any>[]; salaryAllowances: Record<string, any>[]; payrollRuns: Record<string, any>[];
  payrollItems: Record<string, any>[]; payrollAllowanceLines: Record<string, any>[]; loansAdvances: Record<string, any>[];
  taxBrackets: Record<string, any>[]; insuranceRates: Record<string, any>[]; canManagePayroll?: boolean;
  currentUser?: Record<string,any>;
  allowedPages?:Page[];
};

async function hrApi(payload?: Record<string, unknown>) {
  const response = await fetch("/api/hr", payload ? { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(payload) } : { cache:"no-store" });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("portal-session-expired"));
  if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status})`);
  return body;
}

function useHRData(rtl = false) {
  const [data,setData]=useState<HRData|null>(null); const [failed,setFailed]=useState(false);
  // The failure is stored as a flag rather than a message so switching language
  // re-localizes the banner without refetching the whole bootstrap payload.
  const load=useCallback(async()=>{try{const next=await hrApi();setData(next);setFailed(false);}catch{setFailed(true);}},[]);
  useEffect(()=>{const refresh=()=>void load();void load();window.addEventListener("hr-data-changed",refresh);return()=>window.removeEventListener("hr-data-changed",refresh);},[load]);
  const error=failed?(rtl?"تعذر تحميل البيانات. تحقق من الاتصال وحاول مرة أخرى.":"Unable to load data. Check your connection and try again."):"";
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
  return <div className="empty"><span className="empty-icon"><Icon size={24} /></span><h3>{title}</h3><p>{text}</p></div>;
}

const PAYROLL_STATUS_LABELS: Record<string, { en: string; ar: string; tone: string }> = {
  draft: { en: "Draft", ar: "مسودة", tone: "gray" },
  pending_hr: { en: "Pending HR", ar: "بانتظار الموارد البشرية", tone: "amber" },
  approved: { en: "Approved", ar: "معتمدة", tone: "blue" },
  locked: { en: "Locked", ar: "مقفلة", tone: "green" },
};
const payrollStatusLabel = (status: unknown, rtl: boolean) => { const entry = PAYROLL_STATUS_LABELS[String(status)]; return entry ? (rtl ? entry.ar : entry.en) : String(status || "—"); };
const payrollStatusTone = (status: unknown) => PAYROLL_STATUS_LABELS[String(status)]?.tone || "gray";

/** Case-insensitive substring match across the named columns of a row. */
function matchesQuery(row: Record<string,any>, fields: string[], needle: string) {
  if (!needle) return true;
  return fields.some(field => String(row[field] ?? "").toLocaleLowerCase().includes(needle));
}

/** `period` is one of the FilterBar options: all | month (current calendar month) | week (last 7 days). */
function withinPeriod(value: unknown, period: string) {
  if (period === "all") return true;
  const date = String(value ?? "").slice(0, 10);
  if (!date) return false;
  const today = new Date();
  if (period === "month") return date.slice(0, 7) === today.toISOString().slice(0, 7);
  const weekAgo = new Date(today.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  return date >= weekAgo && date <= today.toISOString().slice(0, 10);
}

/** Shared search/period filter state for the list screens. */
function useRowFilter() {
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("all");
  return { query, setQuery, period, setPeriod, needle: query.trim().toLocaleLowerCase() };
}

function downloadCsv(filename: string, columns: { field: string; header: string }[], rows: Record<string,any>[]) {
  const escape = (value: unknown) => { const s = String(value ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [columns.map(c => escape(c.header)).join(","), ...rows.map(row => columns.map(c => escape(row[c.field])).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
}

export function HRApp() {
  const [authState,setAuthState]=useState<"checking"|"signed_in"|"signed_out">("checking");
  const [authUser,setAuthUser]=useState<AuthUser|null>(null);
  const [lang, setLang] = useState<Lang>("ar");
  const [page, setPage] = useState<Page>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestPreset,setRequestPreset]=useState("");
  const [legacyPortalOpen,setLegacyPortalOpen]=useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const t = copy[lang];
  const rtl = lang === "ar";
  useEffect(() => {
    const saved = window.localStorage.getItem("sanad-language");
    if (saved === "ar" || saved === "en") setLang(saved);
    setSidebarCollapsed(window.localStorage.getItem("sanad-sidebar-collapsed")==="true");
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
  }, [lang, rtl]);
  useEffect(()=>{
    let active=true;
    void fetch("/api/auth",{cache:"no-store"}).then(response=>response.json()).then(body=>{if(active){setAuthUser(body.user??null);setAuthState(body.authenticated?"signed_in":"signed_out");}}).catch(()=>{if(active)setAuthState("signed_out");});
    const expire=()=>{setAuthUser(null);setAuthState("signed_out");};
    window.addEventListener("portal-session-expired",expire);
    return()=>{active=false;window.removeEventListener("portal-session-expired",expire);};
  },[]);

  const logout=async()=>{try{await fetch("/api/auth",{method:"DELETE"});}finally{setAuthUser(null);setAuthState("signed_out");setMobileOpen(false);}};
  if(authState==="checking") return <div className="auth-loading"><div><Activity size={20}/><span>جارٍ التحقق من تسجيل الدخول...</span></div></div>;
  if(authState==="signed_out") return <LoginPage onSuccess={user=>{setAuthUser(user);setPage((user.allowed_pages?.[0] as Page)||(user.role_name==="Employee"?"portal":"dashboard"));setAuthState("signed_in");}}/>;

  const role=roleIdFromName(authUser?.role_name);
  const rolePages:Record<RoleId,Page[]>={
    super_admin:["dashboard","portal","approvals","employees","leave","attendance","performance","recruitment","lifecycle","assets","learning","org","users","reports","payroll","settings"],
    hr_manager:["dashboard","portal","approvals","employees","leave","attendance","performance","recruitment","lifecycle","assets","learning","org","users","reports","payroll"],
    department_manager:["dashboard","portal","approvals","employees","leave","attendance","performance","recruitment","lifecycle","assets","learning","org","reports"],
    employee:["dashboard","portal","performance","lifecycle","learning"],
  };

  const nav = [
    { id: "dashboard" as Page, label: t.dashboard, icon: LayoutDashboard },
    { id: "portal" as Page, label: t.portal, icon: CircleUserRound },
    { id: "approvals" as Page, label: t.approvals, icon: CheckCircle2 },
    { id: "employees" as Page, label: t.employees, icon: Users },
    { id: "leave" as Page, label: t.leave, icon: CalendarDays },
    { id: "attendance" as Page, label: t.attendance, icon: Clock3 },
    { id: "performance" as Page, label: t.performance, icon: Trophy },
    { id: "recruitment" as Page, label: t.recruitment, icon: UserRoundSearch },
    { id: "lifecycle" as Page, label: t.lifecycle, icon: Workflow },
    { id: "assets" as Page, label: t.assets, icon: Laptop },
    { id: "learning" as Page, label: t.learning, icon: GraduationCap },
    { id: "org" as Page, label: t.org, icon: Network },
    { id: "users" as Page, label: t.users, icon: ShieldCheck },
    { id: "reports" as Page, label: t.reports, icon: Download },
    { id: "payroll" as Page, label: t.payroll, icon: Wallet },
    { id: "settings" as Page, label: t.settings, icon: Settings },
  ].filter(item=>(Array.isArray(authUser?.allowed_pages)?authUser.allowed_pages:rolePages[role]).includes(item.id));

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const visiblePage=nav.some(item=>item.id===page)?page:(nav[0]?.id||"portal");
  const currentTitle = nav.find(n => n.id === visiblePage)?.label;

  return (
    <div className={`app ${sidebarCollapsed?"sidebar-collapsed":""}`} dir={rtl ? "rtl" : "ltr"} data-lang={lang}>
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="brand"><img className="brand-logo" src="/sanad-logo.png" alt={rtl?"سند":"Sanad"} /><button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label={rtl?"إغلاق القائمة":"Close menu"}><X size={20} /></button></div>
        <div className="workspace-label">{rtl ? "مساحة العمل" : "WORKSPACE"}</div>
        <nav>
          {nav.map(({ id, label, icon: Icon }) => (
            <button key={id} className={visiblePage === id ? "active" : ""} aria-label={label} title={sidebarCollapsed?label:undefined} onClick={() => { setPage(id); setMobileOpen(false); }}>
              <Icon size={20} /><span>{label}</span>{id==="approvals"&&<ApprovalsBadge/>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button aria-label={rtl ? "المساعدة والدعم" : "Help & support"} title={sidebarCollapsed?(rtl ? "المساعدة والدعم" : "Help & support"):undefined} onClick={() => notify(rtl ? "مركز المساعدة قريباً" : "Help center is coming soon")}><HelpCircle size={20} /><span>{rtl ? "المساعدة والدعم" : "Help & support"}</span></button>
          <div className="profile-mini"><Avatar initials={personInitials(authUser?.employee_name||authUser?.email)} small /><div className="profile-copy"><b dir={authUser?.employee_name?undefined:"ltr"} title={rtl?(authUser?.employee_name_ar||authUser?.employee_name||authUser?.email):(authUser?.employee_name||authUser?.email)}>{rtl?(authUser?.employee_name_ar||authUser?.employee_name||authUser?.email):(authUser?.employee_name||authUser?.email)}</b><span>{roleLabel(authUser||undefined,rtl)}</span></div><button className="profile-logout" onClick={()=>void logout()} aria-label={rtl?"تسجيل الخروج":"Sign out"} title={rtl?"تسجيل الخروج":"Sign out"}><LogOut size={16}/></button></div>
        </div>
      </aside>
      {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}

      <main className="main">
        <header className="topbar">
          <button className="sidebar-collapse" onClick={()=>setSidebarCollapsed(value=>{const next=!value;window.localStorage.setItem("sanad-sidebar-collapsed",String(next));return next;})} aria-label={sidebarCollapsed?(rtl?"فتح القائمة الجانبية":"Expand sidebar"):(rtl?"طي القائمة الجانبية":"Collapse sidebar")} title={sidebarCollapsed?(rtl?"فتح القائمة":"Expand sidebar"):(rtl?"طي القائمة":"Collapse sidebar")}>{sidebarCollapsed?<PanelLeftOpen size={19}/>:<PanelLeftClose size={19}/>}</button>
          <button className="menu-btn" onClick={() => setMobileOpen(true)} aria-label={rtl?"فتح قائمة التنقل":"Open navigation"}><Menu size={20} /></button>
          <div className="mobile-title">{currentTitle}</div>
          <div className="top-actions">
            <span className="role-select"><ShieldCheck size={16}/><b>{roleLabel(authUser||undefined,rtl)}</b></span>
            <button className="language" onClick={() => {const next=lang === "en" ? "ar" : "en";setLang(next);window.localStorage.setItem("sanad-language",next);}}><Languages size={16} />{lang === "en" ? "العربية" : "English"}</button>
            <NotificationButton rtl={rtl} open={notificationsOpen} toggle={()=>setNotificationsOpen(value=>!value)}/>
            <Avatar initials={personInitials(authUser?.employee_name||authUser?.email)} small />
          </div>
          {notificationsOpen && <Notifications rtl={rtl} onClose={() => setNotificationsOpen(false)} openPage={setPage} />}
        </header>

        <div className={`content ${visiblePage === "org" ? "org-content-wide" : ""}`}>
          {visiblePage === "dashboard" && <Dashboard rtl={rtl} t={t} setPage={setPage} notify={notify} />}
          {visiblePage === "portal" && (legacyPortalOpen?<><button className="outline portal-back" onClick={()=>setLegacyPortalOpen(false)}><ChevronRight size={16}/>{rtl?"العودة إلى مساحة العمل اليومية":"Back to daily workspace"}</button><Portal rtl={rtl} openRequest={() => {setRequestPreset("");setRequestOpen(true);}} notify={notify}/></>:<EmployeePortalWorkspace rtl={rtl} openRequest={preset=>{setRequestPreset(preset);setRequestOpen(true);}} openPayslips={()=>setLegacyPortalOpen(true)} notify={notify}/>)}
          {visiblePage === "approvals" && <ApprovalsCenter rtl={rtl} notify={notify} />}
          {visiblePage === "employees" && <EmployeesPage rtl={rtl} notify={notify} />}
          {visiblePage === "leave" && <LeavePage rtl={rtl} notify={notify} />}
          {visiblePage === "attendance" && <AttendanceWorkspace rtl={rtl} notify={notify} />}
          {visiblePage === "performance" && <PerformanceWorkspace rtl={rtl} notify={notify} />}
          {visiblePage === "recruitment" && <RecruitmentWorkspace rtl={rtl} notify={notify} />}
          {visiblePage === "lifecycle" && <LifecycleWorkspace rtl={rtl} notify={notify} />}
          {visiblePage === "assets" && <TalentWorkspace kind="assets" rtl={rtl} notify={notify} />}
          {visiblePage === "learning" && <LearningWorkspace rtl={rtl} notify={notify} />}
          {visiblePage === "org" && <OrgPage rtl={rtl} notify={notify} />}
          {visiblePage === "users" && <UsersPage rtl={rtl} notify={notify} />}
          {visiblePage === "reports" && <><ReportsPage rtl={rtl}/><TalentReportLinks rtl={rtl}/></>}
          {visiblePage === "payroll" && <PayrollPage rtl={rtl} notify={notify} />}
          {visiblePage === "settings" && <SettingsPage rtl={rtl} notify={notify} />}
        </div>
      </main>
      {requestOpen && <EmployeeRequestDrawer rtl={rtl} preset={requestPreset} close={() => {setRequestOpen(false);setRequestPreset("");}} submit={async payload => { await hrApi({action:"create_request",...payload}); window.dispatchEvent(new Event("hr-data-changed")); setRequestOpen(false);setRequestPreset(""); notify(rtl?"تم إرسال الطلب وحجز الرصيد بنجاح":"Request submitted and balance reserved successfully"); }} />}
      {Boolean(authUser?.must_change_password)&&<PasswordChange rtl={rtl} forced onChanged={()=>setAuthUser(current=>current?{...current,must_change_password:0}:current)}/>}
      {toast && <div className="toast"><CheckCircle2 size={20} />{toast}</div>}
    </div>
  );
}

function LoginPage({onSuccess}:{onSuccess:(user:AuthUser)=>void}){
  const [email,setEmail]=useState("");const [password,setPassword]=useState("");const [error,setError]=useState("");const [loading,setLoading]=useState(false);const [showPassword,setShowPassword]=useState(false);
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setError("");setLoading(true);try{const response=await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||"تعذر تسجيل الدخول");onSuccess(body.user as AuthUser);}catch(reason){setError(reason instanceof Error?reason.message:"تعذر تسجيل الدخول");}finally{setLoading(false);}};
  return <main className="login-page" dir="rtl" lang="ar">
    <section className="login-panel">
      <div className="login-panel-inner">
        <div className="login-brand"><img className="login-logo" src="/sanad-logo.png" alt="سند"/><span>منصة الموارد البشرية</span></div>
        <div className="login-copy"><small>تسجيل الدخول إلى حسابك</small><h1>مرحبًا بعودتك</h1><p>أدخل بياناتك للوصول إلى مساحة عملك وإدارة فريقك بسهولة.</p></div>
        <form className="login-form" onSubmit={event=>void submit(event)}>
          <label className="login-field"><span>البريد الإلكتروني</span><div className="login-input"><CircleUserRound size={19}/><input type="email" autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)} placeholder="name@company.com" required dir="ltr"/></div></label>
          <label className="login-field"><span>كلمة المرور</span><div className="login-input"><KeyRound size={19}/><input type={showPassword?"text":"password"} autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} placeholder="••••••••" required dir="ltr"/><button className="password-toggle" type="button" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?"إخفاء كلمة المرور":"إظهار كلمة المرور"}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
          {error&&<p className="login-error" role="alert">{error}</p>}
          <button className="login-submit" type="submit" disabled={loading}>{loading?<><Activity size={19}/>جارٍ تسجيل الدخول...</>:<>تسجيل الدخول<LogOut size={18}/></>}</button>
        </form>
        <p className="login-note"><Lock size={14}/>اتصال آمن ومخصص للمستخدمين المصرح لهم</p>
        <footer className="login-footer"><span>© 2026 سند</span><span>منصة موثوقة لإدارة فريقك</span></footer>
      </div>
    </section>
    <section className="login-visual" aria-label="مزايا منصة سند">
      <div className="login-grid-glow"/>
      <div className="login-visual-content">
        <div className="login-visual-badge"><ShieldCheck size={17}/><span>بيانات فريقك في أمان</span></div>
        <h2>كل ما يحتاجه فريقك.<br/><span>في مكان واحد.</span></h2>
        <p>مساحة عمل موحّدة تمنحك رؤية أوضح، وقرارات أسرع، وتجربة أبسط لكل موظف.</p>
        <div className="login-features">
          <article><span><Users size={20}/></span><div><b>إدارة الموظفين</b><small>ملفات وبيانات محدثة</small></div></article>
          <article><span><Clock3 size={20}/></span><div><b>الحضور والانصراف</b><small>متابعة دقيقة ومباشرة</small></div></article>
          <article><span><CalendarDays size={20}/></span><div><b>الإجازات والطلبات</b><small>مسارات اعتماد سلسة</small></div></article>
          <article><span><Network size={20}/></span><div><b>الهيكل التنظيمي</b><small>صورة أوضح لفريقك</small></div></article>
        </div>
        <div className="login-trust"><div className="login-avatars"><span>م</span><span>أ</span><span>س</span></div><p><b>تجربة عمل أكثر تنظيمًا</b><small>مصممة لفرق الموارد البشرية الحديثة</small></p></div>
      </div>
    </section>
  </main>
}

function PasswordChange({rtl,forced=false,onChanged,close}:{rtl:boolean;forced?:boolean;onChanged:()=>void;close?:()=>void}){
  const [currentPassword,setCurrentPassword]=useState(""),[newPassword,setNewPassword]=useState(""),[confirm,setConfirm]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  const save=async()=>{if(newPassword!==confirm){setError(rtl?"تأكيد كلمة المرور غير مطابق":"Password confirmation does not match");return;}try{setSaving(true);setError("");const response=await fetch("/api/auth",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({currentPassword,newPassword})});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||"Unable to change password");onChanged();close?.();}catch(reason){setError(reason instanceof Error?reason.message:(rtl?"تعذر تغيير كلمة المرور":"Unable to change password"));}finally{setSaving(false);}};
  return <div className="modal-layer password-layer"><button className="modal-scrim" disabled={forced} onClick={close} aria-label={rtl?"إغلاق":"Close"}/><section className="password-card" role="dialog" aria-modal="true"><span className="password-card-icon"><KeyRound size={24}/></span><h2>{forced?(rtl?"غيّر كلمة المرور أولاً":"Change your password first"):(rtl?"تغيير كلمة المرور":"Change password")}</h2><p>{rtl?"استخدم 4 خانات على الأقل، ويمكن أن تكون أرقاماً فقط.":"Use at least 4 characters; numbers only are allowed."}</p><label className="login-field"><span>{rtl?"كلمة المرور الحالية":"Current password"}</span><div className="login-input"><Lock size={18}/><input type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)}/></div></label><label className="login-field"><span>{rtl?"كلمة المرور الجديدة":"New password"}</span><div className="login-input"><KeyRound size={18}/><input type="password" autoComplete="new-password" minLength={4} value={newPassword} onChange={event=>setNewPassword(event.target.value)}/></div></label><label className="login-field"><span>{rtl?"تأكيد كلمة المرور":"Confirm password"}</span><div className="login-input"><KeyRound size={18}/><input type="password" autoComplete="new-password" minLength={4} value={confirm} onChange={event=>setConfirm(event.target.value)}/></div></label>{error&&<p className="login-error">{error}</p>}<button className="login-submit" disabled={saving||!currentPassword||newPassword.length<4||!confirm} onClick={()=>void save()}>{saving?<Activity size={18}/>:<Check size={18}/>} {saving?(rtl?"جارٍ الحفظ...":"Saving..."):(rtl?"حفظ كلمة المرور":"Save password")}</button></section></div>;
}

type DashboardData={needs:{kind:string;count:number;target:string}[];workforce:Record<string,number>;approvals:Record<string,unknown>;records:Record<string,number>;talent?:Record<string,Record<string,number>>;upcoming:{holiday?:Record<string,unknown>|null;events:Record<string,unknown>[]}};
function OperationalDashboard({rtl,setPage}:{rtl:boolean;setPage:(page:Page)=>void}){const [data,setData]=useState<DashboardData|null>(null),[error,setError]=useState("");useEffect(()=>{let active=true;void fetch("/api/dashboard",{cache:"no-store"}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error);if(active)setData(body);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:"Unable to load dashboard");});return()=>{active=false;};},[]);const go=(target:string)=>setPage((target.split("?")[0]||"dashboard") as Page);if(!data&&!error)return <div className="profile360-tab-loading"><Activity/>{rtl?"جارٍ تحميل مركز العمل...":"Loading action center..."}</div>;const w=data?.workforce||{},records=data?.records||{},approvals=data?.approvals||{};const cards=[{key:"active",label:rtl?"الموظفون النشطون":"Active employees",value:w.active,icon:Users},{key:"present",label:rtl?"حاضر اليوم":"Present today",value:w.present,icon:CheckCircle2},{key:"late",label:rtl?"متأخر اليوم":"Late today",value:w.late,icon:Clock3},{key:"leave",label:rtl?"في إجازة":"On leave",value:w.onLeave,icon:CalendarDays},{key:"remote",label:rtl?"عن بُعد":"Remote today",value:w.remote,icon:Globe2},{key:"review",label:rtl?"يحتاج مراجعة":"Needs review",value:w.needsReview,icon:AlertTriangle}];const needLabels:Record<string,[string,string]>={approvals:["Approvals waiting for you","اعتمادات بانتظارك"],attendance:["Attendance needs review","الحضور يحتاج مراجعة"],expired_documents:["Expired documents","مستندات منتهية"],expiring_documents:["Documents expiring soon","مستندات قاربت الانتهاء"],missing_documents:["Missing required documents","مستندات مطلوبة مفقودة"],contract_expiring:["Contract expiring soon","عقد عمل قارب على الانتهاء"],password_change:["Password change required","حسابات تتطلب تغيير كلمة المرور"]};return <><header className="page-heading"><div><span className="eyebrow">{rtl?"مركز عمليات الموارد البشرية":"HR OPERATIONS"}</span><h1>{rtl?"ما الذي يحتاج انتباهك الآن؟":"What needs your attention now?"}</h1><p>{rtl?"أرقام تشغيلية مباشرة من الاعتمادات والحضور والإجازات وسجلات الموظفين.":"Live operational signals from approvals, attendance, leave, and employee records."}</p></div></header>{error&&<div className="error-banner">{error}</div>}<section className="action-center panel"><div className="panel-head"><div><h2>{rtl?"يحتاج انتباهك":"Needs your attention"}</h2><p>{rtl?"افتح العنصر للوصول إلى مسار العمل الأصلي":"Open an item to continue in its source workflow"}</p></div></div>{data?.needs.length?<div className="action-items">{data.needs.map(item=><button key={item.kind} onClick={()=>go(item.target)}><span><AlertTriangle/></span><b>{needLabels[item.kind]?.[rtl?1:0]||item.kind}</b><strong>{formatNumber(item.count,rtl)}</strong><ChevronRight/></button>)}</div>:<Empty icon={CheckCircle2} title={rtl?"لا توجد عناصر عاجلة":"No urgent items"} text={rtl?"كل مسارات العمل الحالية محدثة.":"Current operational queues are clear."}/>}</section><section className="stat-grid workforce-stats">{cards.map(({key,label,value,icon:Icon})=><button className="stat-card" key={key} onClick={()=>setPage(key==="leave"?"leave":key==="active"?"employees":"attendance")}><div className="stat-icon blue"><Icon/></div><div className="stat-value">{formatNumber(Number(value)||0,rtl)}</div><div className="stat-label">{label}</div></button>)}</section><section className="dashboard-grid"><article className="panel"><div className="panel-head"><div><h2>{rtl?"الاعتمادات":"Approvals"}</h2></div><button className="text-button" onClick={()=>setPage("approvals")}>{rtl?"فتح المركز":"Open center"}</button></div><div className="operational-metrics"><span><b>{formatNumber(Number(approvals.needsMyApproval)||0,rtl)}</b>{rtl?"تحتاج اعتمادي":"Need my approval"}</span><span><b>{formatNumber(Number(approvals.waitingForOthers)||0,rtl)}</b>{rtl?"بانتظار الآخرين":"Waiting for others"}</span><span><b>{formatNumber(Number(approvals.approvedThisMonth)||0,rtl)}</b>{rtl?"معتمد هذا الشهر":"Approved this month"}</span><span><b>{formatNumber(Number(approvals.rejectedThisMonth)||0,rtl)}</b>{rtl?"مرفوض هذا الشهر":"Rejected this month"}</span></div></article><article className="panel"><div className="panel-head"><div><h2>{rtl?"سجلات الموظفين":"Employee records"}</h2></div><button className="text-button" onClick={()=>setPage("employees")}>{rtl?"فتح الموظفين":"Open employees"}</button></div><div className="operational-metrics"><span><b>{formatNumber(Number(records.expired)||0,rtl)}</b>{rtl?"منتهي":"Expired"}</span><span><b>{formatNumber(Number(records.expiring)||0,rtl)}</b>{rtl?"قارب الانتهاء":"Expiring soon"}</span><span><b>{formatNumber(Number(records.missing)||0,rtl)}</b>{rtl?"مفقود مطلوب":"Required missing"}</span></div></article></section><section className="panel upcoming-events"><div className="panel-head"><div><h2>{rtl?"الأحداث القادمة":"Upcoming events"}</h2></div></div>{data?.upcoming.holiday&&<div className="upcoming-row"><CalendarDays/><b>{rtl?String(data.upcoming.holiday.name_ar):String(data.upcoming.holiday.name_en)}</b><span>{formatDate(String(data.upcoming.holiday.holiday_date),rtl)}</span></div>}{data?.upcoming.events.map(event=><button className="upcoming-row" key={`${event.type}-${event.id}`} onClick={()=>setPage("leave")}><CalendarDays/><b>{rtl?String(event.name_ar):String(event.name_en)}</b><span>{localizedStatus(event.type,rtl)} · {formatDate(String(event.event_date),rtl)}</span></button>)}</section></>}

function ReportsPage({rtl}:{rtl:boolean}){const [from,setFrom]=useState(new Date(Date.now()-30*86400000).toISOString().slice(0,10)),[to,setTo]=useState(new Date().toISOString().slice(0,10));const reports=[{type:"attendance",en:"Attendance report",ar:"تقرير الحضور"},{type:"leave",en:"Leave report",ar:"تقرير الإجازات"},{type:"employees",en:"Employee report",ar:"تقرير الموظفين"},{type:"documents",en:"Documents report",ar:"تقرير المستندات"},{type:"approvals",en:"Approvals report",ar:"تقرير الاعتمادات"}];return <><header className="page-heading"><div><span className="eyebrow">{rtl?"تقارير تشغيلية":"OPERATIONAL REPORTS"}</span><h1>{rtl?"التقارير والتصدير":"Reports & exports"}</h1><p>{rtl?"تصدير محدود بالصلاحيات والنطاق الحالي للمستخدم.":"Exports respect the current user's role, employee scope, and field policy."}</p></div></header><section className="panel reports-panel"><div className="report-dates"><label><span>{rtl?"من":"From"}</span><input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label><span>{rtl?"إلى":"To"}</span><input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label></div><div className="report-grid">{reports.map(report=><article className="report-card" key={report.type}><span className="report-icon"><FileText/></span><div className="report-copy"><h2>{rtl?report.ar:report.en}</h2><p>{rtl?"ملف بيانات متوافق مع الجداول":"Excel-friendly CSV"}</p></div><a className="primary report-export" href={`/api/reports?type=${report.type}&format=csv&from=${from}&to=${to}`}><Download/>{rtl?"تصدير":"Export"}</a></article>)}</div></section></>}

function NotificationButton({rtl,open,toggle}:{rtl:boolean;open:boolean;toggle:()=>void}){const [count,setCount]=useState(0);useEffect(()=>{let active=true;const load=()=>void fetch("/api/notifications?limit=1",{cache:"no-store"}).then(response=>response.ok?response.json():null).then(body=>{if(active&&body)setCount(Number(body.unread)||0);}).catch(()=>{});load();const timer=window.setInterval(load,60000);return()=>{active=false;window.clearInterval(timer);};},[open]);return <button className="icon-btn notification-btn" onClick={toggle} aria-label={rtl?`الإشعارات، ${count} غير مقروء`:`Notifications, ${count} unread`} aria-expanded={open}><Bell size={20}/>{count>0&&<strong>{count>99?"99+":formatNumber(count,rtl)}</strong>}</button>}

function Dashboard({ rtl, t, setPage, notify }: { rtl: boolean; t: typeof copy.en; setPage: (p: Page) => void; notify:(message:string)=>void }) {
  const {data,error}=useHRData(rtl);
  const today=new Date().toISOString().slice(0,10);
  const currentRole=String(data?.currentUser?.role_name||"");
  const selfEmployeeId=Number(data?.currentUser?.employee_id)||0;
  const isManager=currentRole==="Department Manager",isEmployee=currentRole==="Employee",showPersonal=isManager||isEmployee;
  const selfEmployee=(data?.employees??[]).find(row=>Number(row.id)===selfEmployeeId);
  const teamEmployees=isManager?(data?.employees??[]).filter(row=>Number(row.id)!==selfEmployeeId):[];
  const dashboardEmployees=isManager?teamEmployees:isEmployee?(selfEmployee?[selfEmployee]:[]):(data?.employees??[]);
  const dashboardEmployeeIds=new Set(dashboardEmployees.map(row=>Number(row.id)));
  const allAttendanceToday=(data?.attendance??[]).filter(row=>String(row.work_date).slice(0,10)===today);
  const attendanceToday=allAttendanceToday.filter(row=>dashboardEmployeeIds.has(Number(row.employee_id)));
  const ownAttendance=allAttendanceToday.find(row=>Number(row.employee_id)===selfEmployeeId);
  const totalEmployees=dashboardEmployees.length;
  const lateToday=attendanceToday.filter(row=>String(row.status)==="late"||Number(row.late_minutes)>0);
  const onTimeToday=attendanceToday.filter(row=>String(row.status)==="present"&&Number(row.late_minutes)<=0);
  const awayToday=attendanceToday.filter(row=>["absent","leave"].includes(String(row.status)));
  const remoteToday=attendanceToday.filter(row=>String(row.attendance_type)==="remote");
  const presentToday=onTimeToday.length+lateToday.length;
  const unrecordedToday=Math.max(totalEmployees-presentToday-awayToday.length,0);
  const attendanceRate=totalEmployees?Math.round((presentToday/totalEmployees)*100):0;
  const averageLateMinutes=lateToday.length?Math.round(lateToday.reduce((sum,row)=>sum+(Number(row.late_minutes)||0),0)/lateToday.length):0;
  const pendingRequests=(data?.requests??[]).filter(row=>String(row.status).startsWith("pending")&&(!isManager||Number(row.employee_id)!==selfEmployeeId));
  const ownPendingRequests=(data?.requests??[]).filter(row=>Number(row.employee_id)===selfEmployeeId&&String(row.status).startsWith("pending")).length;
  const leaveYear=Number(today.slice(0,4));
  const ownAvailableLeave=(data?.leaveBalances??[]).filter(row=>Number(row.employee_id)===selfEmployeeId&&Number(row.year)===leaveYear).reduce((sum,row)=>sum+(Number(row.available)||0),0);
  const nextHoliday=(data?.holidays??[]).find(row=>String(row.holiday_date)>=today);
  const stats = [
    { label: isManager?(rtl?"أفراد فريقي":"Team members"):(rtl?"إجمالي الموظفين":"Total employees"), value: formatNumber(totalEmployees,rtl), note: isManager?(rtl?"التابعون لي في الهيكل":"My reporting hierarchy"):(rtl?"بيانات فعلية":"Live data"), icon: Users, tone: "blue" },
    { label: isManager?(rtl?"الحاضرون من فريقي":"Team present today"):(rtl?"الحاضرون اليوم":"Present today"), value: formatNumber(attendanceToday.filter(row=>["present","late"].includes(String(row.status))).length,rtl), note: rtl ? "حسب سجلات اليوم" : "From today's records", icon: CheckCircle2, tone: "green" },
    { label: isManager?(rtl?"فريقي في إجازة":"Team on leave"):(rtl?"في إجازة":"On leave"), value: formatNumber(attendanceToday.filter(row=>String(row.status)==="leave").length,rtl), note: rtl ? "حسب سجلات اليوم" : "From today's records", icon: CalendarDays, tone: "violet" },
    { label: isManager?(rtl?"المتأخرون من فريقي":"Team late today"):(rtl?"المتأخرون اليوم":"Late today"), value: formatNumber(attendanceToday.filter(row=>String(row.status)==="late"||Number(row.late_minutes)>0).length,rtl), note: rtl ? "حسب سجلات اليوم" : "From today's records", icon: Clock3, tone: "orange" },
  ];
  return <>
    <h1 className="dashboard-title">{rtl?"لوحة التحكم":"Dashboard"}</h1>
    {error&&<div className="error-banner">{error}</div>}
    {showPersonal&&<section className="panel personal-dashboard-summary"><div className="panel-head"><div><span className="eyebrow">{rtl?"بياناتي":"MY OVERVIEW"}</span><h2>{rtl?"ملخصي الشخصي":"My personal summary"}</h2><p>{rtl?(selfEmployee?.name_ar||selfEmployee?.name_en||"بيانات الموظف"):(selfEmployee?.name_en||selfEmployee?.name_ar||"Employee details")}</p></div><button className="text-button directional" onClick={()=>setPage("portal")}>{rtl?"فتح بوابة الموظف":"Open employee portal"}<ChevronRight size={16}/></button></div><div className="personal-dashboard-metrics"><span><small>{rtl?"حالة اليوم":"Today's status"}</small><b>{ownAttendance?localizedStatus(ownAttendance.status,rtl):(rtl?"لم يسجل بعد":"Not recorded yet")}</b></span><span><small>{rtl?"وقت الحضور":"Check-in"}</small><b dir="ltr">{ownAttendance?.actual_in||"—"}</b></span><span><small>{rtl?"طلبات معلقة":"Pending requests"}</small><b>{formatNumber(ownPendingRequests,rtl)}</b></span><span><small>{rtl?"رصيد الإجازات المتاح":"Available leave balance"}</small><b>{formatNumber(ownAvailableLeave,rtl)}</b></span></div></section>}
    {isManager&&<div className="dashboard-section-heading"><div><span className="eyebrow">{rtl?"فريقي":"MY TEAM"}</span><h2>{rtl?"ملخص الموظفين التابعين لي":"My reporting team overview"}</h2></div><span>{rtl?`${formatNumber(totalEmployees,rtl)} موظف`:`${totalEmployees} employees`}</span></div>}
    {!isEmployee&&<section className="stat-grid">{stats.map(({ label, value, note, icon: Icon, tone }) => <div className="stat-card" key={label}><div className={`stat-icon ${tone}`}><Icon size={20} /></div><div className="stat-value">{value}</div><div className="stat-label">{label}</div><div className={`stat-note ${tone}`}>{note}</div></div>)}</section>}
    <section className="dashboard-grid lower">
      <div className="panel approvals-card"><div className="panel-head"><div><h2>{isEmployee?(rtl?"طلباتي المعلقة":"My pending requests"):t.pending}</h2><p>{isEmployee?(rtl?`${formatNumber(pendingRequests.length,rtl)} من طلباتك قيد المراجعة`:`${pendingRequests.length} of your requests are under review`):(rtl?`${formatNumber(pendingRequests.length,rtl)} طلبات تتطلب إجراءك`:`${pendingRequests.length} requests need action`)}</p></div><button className="text-button directional" onClick={() => setPage(isEmployee?"portal":"approvals")}>{t.viewAll}<ChevronRight size={16}/></button></div>{pendingRequests.slice(0,3).map((r,i)=><div className="approval-row" key={r.id}><Avatar initials={personInitials(r.employee_name)} tone={["blue","violet","rose"][i%3]}/><div className="request-main"><b>{rtl?(r.employee_name_ar||r.employee_name):r.employee_name}</b><span>{localizedRequestType(r.type,rtl)} · {r.request_code}</span></div><button className="round-more" onClick={()=>setPage(isEmployee?"portal":"approvals")} aria-label={rtl?"عرض تفاصيل الطلب":"View request details"}><MoreHorizontal size={16}/></button></div>)}{!pendingRequests.length&&<Empty title={rtl?"لا توجد طلبات معلقة":"No pending requests"} text={rtl?"لا توجد طلبات تحتاج إلى إجراء حاليًا.":"There are no requests requiring action."}/>}</div>
      <div className="panel leave-card"><div className="panel-head"><div><h2>{rtl ? "العطلة القادمة" : "Next holiday"}</h2></div><button className="text-button directional" onClick={() => setPage("leave")}>{t.viewAll}<ChevronRight size={16}/></button></div>{nextHoliday?<div className="holiday-next"><CalendarDays size={20}/><div><b>{rtl?nextHoliday.name_ar:nextHoliday.name_en}</b><small>{localizedCountry(nextHoliday.country,rtl)}</small></div><span>{formatDate(nextHoliday.holiday_date,rtl,{day:"numeric",month:"short",year:"numeric"})}</span></div>:<Empty icon={CalendarDays} title={rtl?"لا توجد عطلات قادمة":"No upcoming holidays"} text={rtl?"لم تتم إضافة عطلات قادمة.":"No upcoming holidays have been added."}/>}</div>
    </section>
    <section className="dashboard-grid">
      <div className="panel attendance-overview"><div className="panel-head"><div><h2>{isManager?(rtl?"حضور فريقي":"My team attendance"):(isEmployee?(rtl?"حضوري اليوم":"My attendance today"):(rtl?"ملخص الحضور":"Attendance overview"))}</h2><p>{isManager?(rtl?"حالة الموظفين التابعين لك اليوم":"Today's status for everyone reporting to you"):(isEmployee?(rtl?"بيانات الحضور المسجلة لك اليوم":"Your recorded attendance for today"):(rtl?"صورة واضحة ومحدّثة لحالة فريق العمل اليوم":"A clear, live view of today's workforce status"))}</p></div><button className="select-button" onClick={()=>setPage(isEmployee?"portal":"attendance")} aria-label={rtl?"فتح سجل حضور اليوم":"Open today's attendance records"}>{rtl ? "اليوم" : "Today"}<ChevronRight size={16} /></button></div>{totalEmployees?<div className="attendance-summary"><div className="attendance-rate-block"><div className="attendance-rate-ring" style={{background:`conic-gradient(#155ae7 0 ${attendanceRate}%,#eaf2ff ${attendanceRate}% 100%)`}}><div><strong>{formatNumber(attendanceRate,rtl)}٪</strong><span>{rtl?"نسبة الحضور":"Attendance rate"}</span></div></div><div className="attendance-rate-copy"><b>{rtl?`${formatNumber(presentToday,rtl)} من ${formatNumber(totalEmployees,rtl)} موظف`:`${presentToday} of ${totalEmployees} employees`}</b><p>{rtl?"سجّلوا حضورهم حتى الآن":"have checked in so far"}</p><span className={attendanceRate>=90?"healthy":attendanceRate>=70?"watch":"low"}>{attendanceRate>=90?(rtl?"الحضور ممتاز":"Excellent attendance"):attendanceRate>=70?(rtl?"الحضور جيد":"Good attendance"):(rtl?"يحتاج متابعة":"Needs attention")}</span></div></div><div className="attendance-kpis"><div className="on-time"><span><CheckCircle2 size={17}/></span><b>{formatNumber(onTimeToday.length,rtl)}</b><small>{rtl?"في الموعد":"On time"}</small></div><div className="late"><span><Clock3 size={17}/></span><b>{formatNumber(lateToday.length,rtl)}</b><small>{rtl?"متأخر":"Late"}</small></div><div className="remote"><span><Globe2 size={17}/></span><b>{formatNumber(remoteToday.length,rtl)}</b><small>{rtl?"عن بُعد":"Remote"}</small></div><div className="away"><span><CalendarDays size={17}/></span><b>{formatNumber(awayToday.length,rtl)}</b><small>{rtl?"غياب أو إجازة":"Absent / leave"}</small></div></div><div className="attendance-distribution"><div className="attendance-distribution-head"><span>{isManager?(rtl?"توزيع حالة الفريق":"Team status distribution"):(rtl?"حالة الحضور":"Attendance status")}</span><b>{rtl?`${formatNumber(unrecordedToday,rtl)} لم يسجلوا بعد`:`${unrecordedToday} not recorded yet`}</b></div><div className="attendance-progress" role="img" aria-label={rtl?`نسبة الحضور ${attendanceRate} بالمائة`:`Attendance rate ${attendanceRate} percent`}><span className="on-time" style={{width:`${(onTimeToday.length/totalEmployees)*100}%`}}/><span className="late" style={{width:`${(lateToday.length/totalEmployees)*100}%`}}/><span className="away" style={{width:`${(awayToday.length/totalEmployees)*100}%`}}/><span className="unrecorded" style={{width:`${(unrecordedToday/totalEmployees)*100}%`}}/></div><div className="attendance-insight"><span>{rtl?"متوسط التأخير":"Average delay"}</span><b>{averageLateMinutes?`${formatNumber(averageLateMinutes,rtl)} ${rtl?"دقيقة":"min"}`:(rtl?"لا يوجد تأخير مسجل":"No delays recorded")}</b></div></div></div>:<Empty icon={Users} title={isManager?(rtl?"لا يوجد موظفون تابعون لك":"No reporting employees"):(rtl?"لا توجد بيانات موظفين":"No employee data")} text={isManager?(rtl?"سيظهر الموظفون هنا عند ربطهم بك في الهيكل التنظيمي.":"Employees will appear here when they are linked to you in the organization structure."):(rtl?"أضف الموظفين لعرض مؤشرات الحضور اليومية.":"Add employees to see daily attendance insights.")}/>}
      </div>
      <div className="panel today-card">{showPersonal?<div className="my-attendance-card"><span className={`my-attendance-icon ${ownAttendance?"recorded":"waiting"}`}><Clock3/></span><small>{rtl?"حضوري الشخصي اليوم":"My attendance today"}</small><h3>{ownAttendance?localizedStatus(ownAttendance.status,rtl):(rtl?"لم يسجل بعد":"Not recorded yet")}</h3><div><span><small>{rtl?"الحضور":"Check-in"}</small><b dir="ltr">{ownAttendance?.actual_in||"—"}</b></span><span><small>{rtl?"الانصراف":"Check-out"}</small><b dir="ltr">{ownAttendance?.actual_out||"—"}</b></span></div></div>:<Empty icon={Clock3} title={rtl?"الحضور الشخصي":"My attendance"} text={rtl?"اربط المستخدم بملف موظف لعرض حضوره الشخصي.":"Link this user to an employee profile to show personal attendance."}/>}<button className="outline wide directional" onClick={() => setPage("portal")}>{rtl ? "فتح حضوري وطلباتي" : "Open my attendance and requests"}<ChevronRight size={16}/></button></div>
    </section>
  </>;
}

function Portal({ rtl, openRequest, notify }: { rtl:boolean; openRequest:()=>void; notify:(s:string)=>void }) {
  const [tab,setTab]=useState("requests");
  const [selectedPayslip,setSelectedPayslip]=useState<Record<string,any>|null>(null);
  const {data,error,reload}=useHRData(rtl);
  const filter=useRowFilter();
  const employeeId=Number(data?.currentUser?.employee_id)||null;
  const ownRequests=(data?.requests??[]).filter(row=>employeeId!==null&&Number(row.employee_id)===employeeId).filter(row=>matchesQuery(row,["request_code","type","reason","notes"],filter.needle)&&withinPeriod(row.created_at,filter.period));
  const ownAttendance=(data?.attendance??[]).filter(row=>employeeId!==null&&Number(row.employee_id)===employeeId);
  const ownPayslips=(data?.payrollItems??[]).filter(row=>employeeId!==null&&Number(row.employee_id)===employeeId&&["approved","locked"].includes(String(row.run_status))).sort((a,b)=>Number(b.year)-Number(a.year)||Number(b.month)-Number(a.month));
  const today=new Date().toISOString().slice(0,10);
  // Derive the session state from today's recorded attendance so a page reload cannot desync it from the server.
  const todayAttendance=ownAttendance.find(row=>String(row.work_date).slice(0,10)===today);
  const checkedIn=Boolean(todayAttendance?.actual_in)&&!todayAttendance?.actual_out;
  const recordAttendance=async()=>{try{await hrApi({action:"attendance_event",eventType:checkedIn?"check_out":"check_in"});await reload();notify(checkedIn?(rtl?"تم تسجيل الانصراف بنجاح":"Check-out recorded"):(rtl?"تم تسجيل الحضور بنجاح":"Check-in recorded"));}catch(e){notify(e instanceof Error?e.message:(rtl?"تعذر تسجيل الحضور، حاول مرة أخرى":"Attendance action failed"));}};
  return <><PageHeader eyebrow={rtl?"الخدمة الذاتية للموظف":"EMPLOYEE SELF-SERVICE"} title={rtl?"بوابة الموظف":"Employee portal"} text={rtl?"تابع طلباتك وحضورك من البيانات المسجلة فعليًا.":"View your requests and attendance from recorded data."} action={<button className="primary" onClick={openRequest}><Plus size={16}/>{rtl?"تقديم طلب":"New request"}</button>}/>{error&&<div className="error-banner">{error}</div>}<Tabs items={[{id:"requests",label:rtl?"طلباتي":"My requests"},{id:"remote",label:rtl?"الحضور عن بُعد":"Remote attendance"},{id:"payslips",label:rtl?"راتبي":"My payslips"}]} active={tab} setActive={setTab}/>{tab==="requests"?<div className="panel table-panel"><FilterBar rtl={rtl} query={filter.query} setQuery={filter.setQuery} period={filter.period} setPeriod={filter.setPeriod} count={ownRequests.length} placeholder={rtl?"ابحث في طلباتك...":"Search your requests..."}/><RequestTable rtl={rtl} rows={ownRequests}/></div>:tab==="remote"?<div className="remote-layout"><div className="panel remote-card"><span className="date-chip">{formatDate(today,rtl,{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</span><div className={`pulse ${checkedIn?"active":""}`}><Clock3 size={24}/></div><Status tone={checkedIn?"green":"gray"}>{checkedIn?(rtl?"الدوام مسجّل":"Active session"):(rtl?"لم تسجّل الحضور":"Not checked in")}</Status><button className={checkedIn?"danger-action":"primary wide"} disabled={!employeeId} onClick={()=>void recordAttendance()}>{checkedIn?(rtl?"تسجيل الانصراف":"Check out"):(rtl?"تسجيل الحضور":"Check in")}</button>{!employeeId&&<small className="privacy"><ShieldCheck size={16}/>{rtl?"يجب ربط حسابك بملف موظف لاستخدام الحضور.":"Link your account to an employee profile to use attendance."}</small>}</div><div className="panel week-card"><div className="panel-head"><div><h2>{rtl?"سجل الحضور":"Attendance history"}</h2><p>{rtl?"البيانات المسجلة فقط":"Recorded data only"}</p></div></div><AttendanceTable rtl={rtl} rows={ownAttendance}/></div></div>:<div className="panel table-panel payslip-list">{ownPayslips.length?<div className="data-table payslip-table"><div className="tr th"><span>{rtl?"الشهر":"Month"}</span><span>{rtl?"صافي الراتب":"Net salary"}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{ownPayslips.map(item=><div className="tr" key={item.id}><span>{new Intl.DateTimeFormat(rtl?"ar-SA-u-nu-arab":"en-GB",{month:"long",year:"numeric"}).format(new Date(Number(item.year),Number(item.month)-1,1))}</span><span>{new Intl.NumberFormat(localeFor(rtl),{style:"currency",currency:item.currency||"SAR",maximumFractionDigits:2}).format(Number(item.net_salary)||0)}</span><span><Status tone={item.run_status==="locked"?"blue":"green"}>{localizedStatus(item.run_status,rtl)}</Status></span><span><button className="plain-icon" onClick={()=>setSelectedPayslip(item)} aria-label={rtl?"عرض القسيمة":"View payslip"}><ChevronRight size={20}/></button></span></div>)}</div>:<Empty icon={Wallet} title={rtl?"لا توجد قسائم رواتب":"No payslips yet"} text={rtl?"ستظهر هنا قسائم رواتبك بعد اعتماد دورة الرواتب.":"Your payslips will appear here once a payroll run is approved."}/>}</div>}
  {selectedPayslip&&<div className="modal-layer"><button className="modal-scrim print-hide" onClick={()=>setSelectedPayslip(null)} aria-label={rtl?"إغلاق":"Close"}/><aside className="drawer payslip-drawer"><button className="icon-btn print-hide payslip-close" onClick={()=>setSelectedPayslip(null)} aria-label={rtl?"إغلاق":"Close"}><X size={20}/></button><PayslipCard rtl={rtl} item={selectedPayslip} allowanceLines={(data?.payrollAllowanceLines??[]).filter(line=>Number(line.payroll_item_id)===Number(selectedPayslip.id))}/></aside></div>}
  </>;
}

function PayslipCard({rtl,item,allowanceLines}:{rtl:boolean;item:Record<string,any>;allowanceLines:Record<string,any>[]}){
  const currency=item.currency||"SAR";
  const money=(value:number)=>new Intl.NumberFormat(localeFor(rtl),{style:"currency",currency,maximumFractionDigits:2}).format(value||0);
  const monthLabel=new Intl.DateTimeFormat(rtl?"ar-SA-u-nu-arab":"en-GB",{month:"long",year:"numeric"}).format(new Date(Number(item.year),Number(item.month)-1,1));
  const deductions=[
    {label:rtl?"العمل الإضافي":"Overtime",value:Number(item.overtime_amount)||0},
    {label:rtl?"خصم الغياب":"Absence deduction",value:-(Number(item.absence_deduction)||0)},
    {label:rtl?"خصم الإجازة بدون راتب":"Unpaid leave deduction",value:-(Number(item.unpaid_leave_deduction)||0)},
    {label:rtl?"خصم السلف":"Loan deduction",value:-(Number(item.loan_deduction)||0)},
    {label:rtl?"خصم التأمينات":"Insurance deduction",value:-(Number(item.insurance_deduction)||0)},
    {label:rtl?"خصم الضريبة":"Tax deduction",value:-(Number(item.tax_deduction)||0)},
  ];
  return <div className="payslip-card">
    <div className="payslip-head"><div><span className="eyebrow">{rtl?"قسيمة الراتب":"PAYSLIP"}</span><h2>{monthLabel}</h2><p>{rtl?(item.employee_name_ar||item.employee_name):item.employee_name} · {item.employee_code}</p></div><button className="outline print-hide" onClick={()=>window.print()}><Printer size={16}/>{rtl?"طباعة":"Print"}</button></div>
    <div className="payslip-rows">
      <div className="payslip-row"><span>{rtl?"الراتب الأساسي":"Basic salary"}</span><b>{money(Number(item.basic_salary))}</b></div>
      {allowanceLines.length?allowanceLines.map((line,i)=><div className="payslip-row" key={i}><span>{rtl?"بدل":"Allowance"} — {line.type}</span><b>{money(Number(line.resolved_amount))}</b></div>):(Number(item.total_allowances)>0&&<div className="payslip-row"><span>{rtl?"إجمالي البدلات":"Total allowances"}</span><b>{money(Number(item.total_allowances))}</b></div>)}
      {deductions.filter(d=>d.value!==0).map(d=><div className="payslip-row" key={d.label}><span>{d.label}</span><b className={d.value<0?"negative":""}>{money(d.value)}</b></div>)}
    </div>
    <div className="payslip-net"><span>{rtl?"صافي الراتب":"Net salary"}</span><b>{money(Number(item.net_salary))}</b></div>
  </div>;
}

function Approvals({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){const [tab,setTab]=useState("pending");const {data,error,reload}=useHRData(rtl);const filter=useRowFilter();const all=data?.requests??[];const list=all.filter(r=>tab==="all"||(tab==="pending"?String(r.status).startsWith("pending"):tab==="approved"?String(r.status).includes("approved"):String(r.status).includes("rejected"))).filter(r=>matchesQuery(r,["employee_name","employee_name_ar","department_name","request_code","type","reason"],filter.needle)&&withinPeriod(r.created_at,filter.period));const decide=async(id:number,decision:"approve"|"reject")=>{const reason=decision==="reject"?(window.prompt(rtl?"اكتب سبب الرفض":"Rejection reason")||""):"";if(decision==="reject"&&!reason)return;try{await hrApi({action:"request_action",requestId:id,decision,reason});await reload();notify(decision==="approve"?(rtl?"تم اعتماد الطلب وتحويله إلى المرحلة التالية":"Request approved and moved to the next stage"):(rtl?"تم رفض الطلب وحفظ السبب":"Request rejected and the reason was recorded"));}catch(e){notify(e instanceof Error?e.message:(rtl?"تعذر تنفيذ الإجراء":"Action failed"));}};return <><PageHeader eyebrow={rtl?"مسار الاعتمادات":"WORKFLOW"} title={rtl?"اعتماد الطلبات":"Request approvals"} text={rtl?"راجع طلبات فريقك واتخذ الإجراء المناسب من قائمة موحّدة.":"Review team requests and take action from one focused queue."}/><Tabs items={[{id:"pending",label:`${rtl?"بانتظار اعتمادي":"Awaiting my approval"} (${formatNumber(all.filter(r=>String(r.status).startsWith("pending")).length,rtl)})`},{id:"approved",label:rtl?"المعتمدة":"Approved"},{id:"rejected",label:rtl?"المرفوضة":"Rejected"},{id:"all",label:rtl?"جميع الطلبات":"All requests"}]} active={tab} setActive={setTab}/><div className="panel table-panel">{error&&<div className="error-banner">{error}</div>}<FilterBar rtl={rtl} query={filter.query} setQuery={filter.setQuery} period={filter.period} setPeriod={filter.setPeriod} count={list.length} placeholder={rtl?"ابحث باسم الموظف أو رقم الطلب...":"Search by employee or request code..."}/>{list.length===0?<Empty title={rtl?"لا توجد طلبات":"No requests found"} text={rtl?"لا توجد طلبات مطابقة لعوامل التصفية الحالية.":"No requests match the current filters."}/>:<div className="data-table approval-table"><div className="tr th"><span>{rtl?"الموظف":"Employee"}</span><span>{rtl?"نوع الطلب":"Request"}</span><span>{rtl?"الفترة":"Period"}</span><span>{rtl?"مرحلة الاعتماد":"Approval stage"}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{list.map((r,i)=><div className="tr" key={r.id}><span className="person"><Avatar initials={personInitials(r.employee_name)} small tone={["blue","violet","rose"][i%3]}/><span><b>{rtl?(r.employee_name_ar||r.employee_name):r.employee_name}</b><small>{rtl?(r.department_name_ar||r.department_name):r.department_name||"—"}</small></span></span><span><b>{localizedRequestType(r.type,rtl)}</b><small>{r.request_code}</small></span><span>{r.from_date&&r.to_date?`${formatDate(r.from_date,rtl,{day:"numeric",month:"short"})} — ${formatDate(r.to_date,rtl,{day:"numeric",month:"short"})}`:(r.request_date?formatDate(r.request_date,rtl):"—")}</span><span><small>{localizedStage(r.current_stage,rtl)}</small></span><span><Status tone={String(r.status).includes("rejected")?"rose":String(r.status).includes("approved")?"green":"amber"}>{localizedStatus(r.status,rtl)}</Status></span><span className="row-actions">{String(r.status).startsWith("pending")&&<><button onClick={()=>void decide(r.id,"approve")} aria-label={rtl?"اعتماد الطلب":"Approve request"}><Check size={16}/></button><button onClick={()=>void decide(r.id,"reject")} aria-label={rtl?"رفض الطلب":"Reject request"}><X size={16}/></button></>}</span></div>)}</div>}</div></>}

function EmployeesPage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){
  const [tab,setTab]=useState("employees"); const [employeeView,setEmployeeView]=useState<"cards"|"rows">("cards"); const [open,setOpen]=useState(false); const [selected,setSelected]=useState<{row:Record<string,any>;edit:boolean}|null>(null);const [entityEditor,setEntityEditor]=useState<{kind:"job_title"|"department";record?:Record<string,any>}|null>(null); const {data,error,reload}=useHRData(rtl);
  const filter=useRowFilter();
  const shownEmployees=(data?.employees??[]).filter(row=>matchesQuery(row,["name_en","name_ar","employee_code","work_email","department_name","job_title_name","work_location","country"],filter.needle)&&withinPeriod(row.created_at,filter.period));
  const shownJobTitles=(data?.jobTitles??[]).filter(row=>matchesQuery(row,["name_en","name_ar","department_name"],filter.needle));
  const shownDepartments=(data?.departments??[]).filter(row=>matchesQuery(row,["name_en","name_ar","manager_name","manager_name_ar","manager_code"],filter.needle));
  const shownCount=tab==="employees"?shownEmployees.length:tab==="jobs"?shownJobTitles.length:shownDepartments.length;
  const total=data?.employees.length??0, active=data?.employees.filter(e=>e.employment_status==="active").length??0;
  const ksa=data?.employees.filter(e=>e.country==="Saudi Arabia").length??0, egypt=data?.employees.filter(e=>e.country==="Egypt").length??0;
  const canDeleteEmployee=data?.currentUser?.role_name==="Super Admin"||(data?.permissions??[]).some(permission=>Number(permission.role_id)===Number(data?.currentUser?.role_id)&&permission.module==="employees"&&permission.action==="delete"&&Number(permission.allowed)===1);
  const deleteEmployee=async(employee:Record<string,any>)=>{const name=rtl?(employee.name_ar||employee.name_en):(employee.name_en||employee.name_ar);if(!window.confirm(rtl?`هل تريد حذف الموظف «${name}»؟ سيتم تعطيل حسابه مع الاحتفاظ بسجلاته السابقة.`:`Delete “${name}”? Their account will be disabled while historical records are retained.`))return;try{await hrApi({action:"delete_employee",employeeId:employee.id});if(Number(selected?.row.id)===Number(employee.id))setSelected(null);await reload();notify(rtl?"تم حذف الموظف وتعطيل حسابه":"Employee deleted and account disabled");}catch(reason){notify(reason instanceof Error?reason.message:(rtl?"تعذر حذف الموظف":"Unable to delete employee"));}};
  const action=tab==="employees"?<button className="primary" onClick={()=>setOpen(true)}><Plus size={16}/>{rtl?"إضافة موظف":"Add employee"}</button>:tab==="jobs"?<button className="primary" onClick={()=>setEntityEditor({kind:"job_title"})}><Plus size={16}/>{rtl?"إضافة مسمى":"Add job title"}</button>:<button className="primary" onClick={()=>setEntityEditor({kind:"department"})}><Plus size={16}/>{rtl?"إضافة قسم":"Add department"}</button>;
  return <section className="employees-page-shell"><PageHeader eyebrow="" title={rtl?"الموظفون":"Employees"} text="" action={action}/>
  {error&&<div className="error-banner">{error}<button onClick={()=>void reload()}>{rtl?"إعادة المحاولة":"Retry"}</button></div>}
  <section className="mini-stats"><div><Users/><span><b>{total?formatNumber(total,rtl):"—"}</b>{rtl?"إجمالي الموظفين":"Total employees"}</span></div><div><CheckCircle2/><span><b>{active?formatNumber(active,rtl):"—"}</b>{rtl?"الموظفون النشطون":"Active employees"}</span></div><div><Globe2/><span><b>{formatNumber(ksa,rtl)} / {formatNumber(egypt,rtl)}</b>{rtl?"السعودية / مصر":"Saudi Arabia / Egypt"}</span></div><div><BriefcaseBusiness/><span><b>{formatNumber(data?.employees.filter(e=>String(e.created_at).startsWith(new Date().toISOString().slice(0,7))).length??0,rtl)}</b>{rtl?"منضمون هذا الشهر":"Joined this month"}</span></div></section>
  <Tabs items={[{id:"employees",label:rtl?"الموظفون":"Employees"},{id:"jobs",label:rtl?"المسميات الوظيفية":"Job titles"},{id:"departments",label:rtl?"الأقسام":"Departments"}]} active={tab} setActive={setTab}/><div className="panel table-panel employee-directory-panel"><FilterBar rtl={rtl} query={filter.query} setQuery={filter.setQuery} period={tab==="employees"?filter.period:undefined} setPeriod={tab==="employees"?filter.setPeriod:undefined} count={shownCount} placeholder={tab==="employees"?(rtl?"ابحث بالاسم أو الكود أو البريد...":"Search by name, code or email..."):tab==="jobs"?(rtl?"ابحث بالمسمى الوظيفي...":"Search job titles..."):(rtl?"ابحث باسم القسم أو مديره...":"Search departments or managers...")} trailing={tab==="employees"?<div className="employee-view-switch" role="group" aria-label={rtl?"طريقة عرض الموظفين":"Employee view mode"}><button className={employeeView==="cards"?"active":""} onClick={()=>setEmployeeView("cards")} aria-label={rtl?"عرض كروت":"Card view"} title={rtl?"عرض كروت":"Card view"}><LayoutGrid size={17}/></button><button className={employeeView==="rows"?"active":""} onClick={()=>setEmployeeView("rows")} aria-label={rtl?"عرض صفوف":"Row view"} title={rtl?"عرض صفوف":"Row view"}><List size={18}/></button></div>:undefined}/><div className="employee-directory-scroll">{tab==="employees"?(employeeView==="cards"?<EmployeeCardGrid rtl={rtl} rows={shownEmployees} departments={data?.departments} jobTitles={data?.jobTitles} canDelete={canDeleteEmployee} onDelete={deleteEmployee} onOpen={(row,edit)=>setSelected({row,edit})}/>:<EmployeeRowList rtl={rtl} rows={shownEmployees} departments={data?.departments} jobTitles={data?.jobTitles} onSave={async form=>{await hrApi({action:"update_employee",...form});await reload();notify(rtl?"تم حفظ التعديل وتحديث كارت الموظف":"Employee row and card updated");}}/>):tab==="jobs"?<JobTitleTable rtl={rtl} rows={shownJobTitles} departments={data?.departments} onEdit={record=>setEntityEditor({kind:"job_title",record})}/>:<DepartmentGrid rtl={rtl} rows={shownDepartments} jobs={data?.jobTitles} employees={data?.employees} reload={reload} notify={notify} onEdit={record=>setEntityEditor({kind:"department",record})}/>}</div></div>
  {open&&<EmployeeDrawer rtl={rtl} data={data} close={()=>setOpen(false)} submit={async(form)=>{await hrApi({action:"create_employee",...form});setOpen(false);await reload();notify(rtl?"تم إنشاء الموظف وحساب المستخدم بنجاح":"Employee and user account created successfully");}}/>}
  {selected&&(selected.edit?<EmployeeDetailsDrawer rtl={rtl} employee={selected.row} startInEdit data={data} close={()=>setSelected(null)} submit={async form=>{await hrApi({action:"update_employee",...form});await reload();setSelected(null);notify(rtl?"تم تحديث بيانات الموظف بنجاح":"Employee details updated successfully");}}/>:<EmployeeProfile360 rtl={rtl} employeeId={Number(selected.row.id)} close={()=>setSelected(null)} onEdit={()=>setSelected(current=>current?{...current,edit:true}:current)}/>)}
  {entityEditor&&<OrganizationEntityDrawer rtl={rtl} kind={entityEditor.kind} record={entityEditor.record} departments={data?.departments??[]} close={()=>setEntityEditor(null)} submit={async form=>{const editing=Boolean(entityEditor.record?.id);await hrApi({action:entityEditor.kind==="job_title"?"save_job_title":"save_department",...form});await reload();setEntityEditor(null);notify(entityEditor.kind==="job_title"?(editing?(rtl?"تم تعديل المسمى الوظيفي":"Job title updated"):(rtl?"تمت إضافة المسمى الوظيفي":"Job title added")):(editing?(rtl?"تم تعديل القسم":"Department updated"):(rtl?"تمت إضافة القسم":"Department added")));}}/>}</section>}

function LeavePage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){
  const [tab,setTab]=useState("holidays"),[open,setOpen]=useState(false);
  const {data,error,reload}=useHRData(rtl);
  return <><PageHeader eyebrow="" title={rtl?"إدارة الإجازات":"Leave management"} text="" action={tab==="holidays"?<button className="primary" onClick={()=>setOpen(true)}><Plus size={16}/>{rtl?"إضافة عطلة رسمية":"Add holiday"}</button>:undefined}/>
    {error&&<div className="error-banner">{error}<button onClick={()=>void reload()}>{rtl?"إعادة المحاولة":"Retry"}</button></div>}
    <Tabs items={[{id:"holidays",label:rtl?"العطلات الرسمية":"Official holidays"},{id:"types",label:rtl?"أنواع الإجازات":"Leave types"},{id:"settings",label:rtl?"إعدادات الإجازات":"Leave settings"},{id:"policies",label:rtl?"سياسات الاستحقاق":"Entitlement policies"}]} active={tab} setActive={setTab}/>
    {tab==="holidays"?<HolidayCalendar rtl={rtl} rows={data?.holidays}/>
      :tab==="types"?<LeaveTypesPanel rtl={rtl} rows={data?.leaveTypes} reload={reload} notify={notify}/>
      :tab==="policies"?<LeavePoliciesPanel rtl={rtl} policies={data?.leavePolicies??[]} leaveTypes={data?.leaveTypes??[]} reload={reload} notify={notify}/>
      :<LeaveConfiguration rtl={rtl} mode="settings" rows={data?.settings} save={async(key,values)=>{await hrApi({action:"save_system_settings",settingKey:key,values});await reload();notify(rtl?"تم حفظ الإعدادات بنجاح":"Settings saved successfully");}}/>}
    {open&&<HolidayDrawer rtl={rtl} close={()=>setOpen(false)} submit={async form=>{await hrApi({action:"create_holiday",...form});setOpen(false);await reload();notify(rtl?"تم حفظ العطلة وإضافتها إلى احتساب الحضور":"Holiday saved and included in attendance calculations");}}/>}
  </>
}

function LeaveTypesPanel({rtl,rows=[],reload,notify}:{rtl:boolean;rows?:Record<string,any>[];reload:()=>Promise<void>;notify:(message:string)=>void}){
  const [editing,setEditing]=useState<Record<string,any>|null|undefined>(undefined);
  const remove=async(row:Record<string,any>)=>{
    if(!window.confirm(rtl?`هل تريد حذف نوع الإجازة «${row.name_ar}»؟`:`Delete “${row.name_en}”?`)) return;
    try{await hrApi({action:"delete_leave_type",leaveTypeId:row.id});await reload();notify(rtl?"تم حذف نوع الإجازة":"Leave type deleted");}
    catch(reason){notify(reason instanceof Error?reason.message:(rtl?"تعذر حذف نوع الإجازة":"Unable to delete leave type"));}
  };
  const booleanIcon=(value:unknown)=><span className={Number(value)?"leave-yes":"leave-no"}>{Number(value)?<Check size={16}/>:<X size={16}/>}</span>;
  return <section className="panel leave-types-panel">
    <header><div><span className="leave-types-title-icon"><CalendarDays size={20}/></span><div><span className="eyebrow">{rtl?"سياسات الإجازات":"LEAVE POLICIES"}</span><h2>{rtl?"إعداد أنواع الإجازات":"Leave type setup"}</h2><p>{rtl?"أنواع الإجازات المعتمدة وأيامها الافتراضية ومسار الموافقة.":"Approved leave types, default days and approval requirements."}</p></div></div><button className="primary" onClick={()=>setEditing(null)}><Plus size={16}/>{rtl?"إضافة نوع":"Add type"}</button></header>
    <div className="leave-types-scroll"><table><thead><tr><th>{rtl?"الرمز":"Code"}</th><th>{rtl?"الاسم (إنجليزي)":"English name"}</th><th>{rtl?"الاسم (عربي)":"Arabic name"}</th><th>{rtl?"الأيام الافتراضية":"Default days"}</th><th>{rtl?"مدفوعة":"Paid"}</th><th>{rtl?"تتطلب موافقة":"Approval required"}</th><th>{rtl?"نشط":"Active"}</th><th>{rtl?"الإجراءات":"Actions"}</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><code>{row.code}</code></td><td>{row.name_en}</td><td className="leave-arabic-name">{row.name_ar}</td><td>{formatNumber(Number(row.default_days)||0,rtl)}</td><td>{booleanIcon(row.paid)}</td><td>{booleanIcon(row.manager_approval||row.hr_approval)}</td><td>{booleanIcon(row.status==="active"?1:0)}</td><td><span className="leave-row-actions"><button onClick={()=>setEditing(row)} aria-label={rtl?"تعديل":"Edit"}><Pencil size={16}/></button><button className="delete" onClick={()=>void remove(row)} aria-label={rtl?"حذف":"Delete"}><Trash2 size={16}/></button></span></td></tr>)}</tbody></table>{rows.length===0&&<Empty icon={CalendarDays} title={rtl?"لا توجد أنواع إجازات":"No leave types"} text={rtl?"أضف أول نوع إجازة لبدء إعداد السياسات.":"Add the first leave type to configure policies."}/>}</div>
    {editing!==undefined&&<LeaveTypeDrawer rtl={rtl} record={editing||undefined} close={()=>setEditing(undefined)} submit={async values=>{await hrApi({action:"save_leave_type",...values});setEditing(undefined);await reload();notify(editing?.id?(rtl?"تم تعديل نوع الإجازة":"Leave type updated"):(rtl?"تمت إضافة نوع الإجازة":"Leave type added"));}}/>}
  </section>;
}

function LeaveTypeDrawer({rtl,record,close,submit}:{rtl:boolean;record?:Record<string,any>;close:()=>void;submit:(values:Record<string,unknown>)=>Promise<void>}){
  const [values,setValues]=useState({code:String(record?.code||""),nameEn:String(record?.name_en||""),nameAr:String(record?.name_ar||""),defaultDays:Number(record?.default_days)||0,paid:record?Boolean(Number(record.paid)):true,requiresApproval:record?Boolean(Number(record.manager_approval)||Number(record.hr_approval)):true,active:record?record.status==="active":true});
  const [saving,setSaving]=useState(false),[error,setError]=useState("");
  const update=(key:string,value:unknown)=>setValues(current=>({...current,[key]:value}));
  const save=async(event:React.FormEvent)=>{event.preventDefault();try{setSaving(true);setError("");await submit({leaveTypeId:record?.id,...values});}catch(reason){setError(reason instanceof Error?reason.message:(rtl?"تعذر حفظ نوع الإجازة":"Unable to save leave type"));}finally{setSaving(false);}};
  return <div className="modal-layer" onMouseDown={event=>{if(event.target===event.currentTarget)close();}}><aside className="drawer leave-type-drawer" role="dialog" aria-modal="true"><header><div><span className="eyebrow">{rtl?"سياسات الإجازات":"LEAVE POLICIES"}</span><h2>{record?(rtl?"تعديل نوع الإجازة":"Edit leave type"):(rtl?"إضافة نوع إجازة":"Add leave type")}</h2></div><button className="icon-button" onClick={close} aria-label={rtl?"إغلاق":"Close"}><X size={20}/></button></header><form onSubmit={save}><div className="drawer-fields"><label><span>{rtl?"الرمز":"Code"}</span><input required maxLength={50} value={values.code} onChange={event=>update("code",event.target.value.toUpperCase())} placeholder="ANNUAL_21"/></label><label><span>{rtl?"الاسم (إنجليزي)":"English name"}</span><input required value={values.nameEn} onChange={event=>update("nameEn",event.target.value)}/></label><label><span>{rtl?"الاسم (عربي)":"Arabic name"}</span><input required dir="rtl" value={values.nameAr} onChange={event=>update("nameAr",event.target.value)}/></label><label><span>{rtl?"الأيام الافتراضية":"Default days"}</span><input required type="number" min="0" max="9999" value={values.defaultDays} onChange={event=>update("defaultDays",Number(event.target.value))}/></label></div><div className="leave-type-options"><label><input type="checkbox" checked={values.paid} onChange={event=>update("paid",event.target.checked)}/><span><b>{rtl?"إجازة مدفوعة":"Paid leave"}</b><small>{rtl?"تُحتسب بأجر كامل":"Counted as paid time off"}</small></span></label><label><input type="checkbox" checked={values.requiresApproval} onChange={event=>update("requiresApproval",event.target.checked)}/><span><b>{rtl?"تتطلب موافقة":"Requires approval"}</b><small>{rtl?"تمر عبر مسار الاعتماد":"Uses the approval workflow"}</small></span></label><label><input type="checkbox" checked={values.active} onChange={event=>update("active",event.target.checked)}/><span><b>{rtl?"نشط":"Active"}</b><small>{rtl?"متاح في طلبات الموظفين":"Available in employee requests"}</small></span></label></div>{error&&<div className="error-banner">{error}</div>}<footer><button type="button" className="outline" onClick={close}>{rtl?"إلغاء":"Cancel"}</button><button type="submit" className="primary" disabled={saving}><Check size={16}/>{saving?(rtl?"جارٍ الحفظ...":"Saving..."):(rtl?"حفظ":"Save")}</button></footer></form></aside></div>;
}

function LeaveConfiguration({rtl,mode,rows,save}:{rtl:boolean;mode:"settings"|"policies";rows?:Record<string,any>[];save:(key:string,values:Record<string,unknown>)=>Promise<void>}){
  const key=mode==="settings"?"leave_settings":"leave_policies";
  const stored=parseSetting(rows?.find(row=>row.setting_key===key));
  const defaults=mode==="settings"?{defaultCountry:"",weekendsExcluded:false,allowHalfDays:false,minimumNoticeDays:0,approvalFlow:"",attachmentAfterDays:0}:{annualDaysEgypt:0,annualDaysSaudi:0,sickDays:0,maxCarryForward:0,carryExpiryDays:0,probationLeaveEnabled:false};
  const [values,setValues]=useState<Record<string,any>>({...defaults,...stored});
  const [saving,setSaving]=useState(false),[message,setMessage]=useState("");
  // Re-seed the form when the tab switches mode or the stored settings are reloaded.
  const signature=`${mode}:${JSON.stringify(stored)}`;
  const [seeded,setSeeded]=useState(signature);
  if(seeded!==signature){setSeeded(signature);setValues({...defaults,...stored});setMessage("");}
  const update=(field:string,value:unknown)=>setValues(current=>({...current,[field]:value}));
  const submit=async()=>{try{setSaving(true);setMessage("");await save(key,values);setMessage(rtl?"تم حفظ التغييرات وتطبيقها":"Changes saved and applied");}finally{setSaving(false);}};
  return <section className="panel leave-config"><div className="leave-config-head"><span className={`setting-icon ${mode==="settings"?"blue":"violet"}`}><SlidersHorizontal/></span><div><span className="eyebrow">{mode==="settings"?(rtl?"إعدادات التشغيل":"OPERATIONAL SETTINGS"):(rtl?"قواعد الاستحقاق":"ENTITLEMENT RULES")}</span><h2>{mode==="settings"?(rtl?"إعدادات الإجازات":"Leave settings"):(rtl?"سياسات الإجازات":"Leave policies")}</h2><p>{mode==="settings"?(rtl?"حدد طريقة حساب الأيام ومسار الاعتماد ومتطلبات الطلب.":"Configure day calculation, approvals and request requirements."):(rtl?"حدد الاستحقاقات والترحيل لكل موظفي مصر والسعودية.":"Set entitlements and carry-forward rules for Egypt and Saudi Arabia.")}</p></div>{message&&<Status tone="green">{message}</Status>}</div>
    <div className="leave-config-grid">{mode==="settings"?<>
      <label><span>{rtl?"التقويم الافتراضي":"Default calendar"}</span><select value={values.defaultCountry} onChange={event=>update("defaultCountry",event.target.value)}><option value="Both">{rtl?"مصر والسعودية":"Egypt & Saudi Arabia"}</option><option value="Egypt">{rtl?"مصر":"Egypt"}</option><option value="Saudi Arabia">{rtl?"السعودية":"Saudi Arabia"}</option></select></label>
      <label><span>{rtl?"مسار الاعتماد":"Approval workflow"}</span><select value={values.approvalFlow} onChange={event=>update("approvalFlow",event.target.value)}><option value="manager_hr">{rtl?"المدير ثم الموارد البشرية":"Manager, then HR"}</option><option value="manager">{rtl?"المدير فقط":"Manager only"}</option><option value="hr">{rtl?"الموارد البشرية فقط":"HR only"}</option></select></label>
      <label><span>{rtl?"الإخطار المسبق بالأيام":"Minimum notice (days)"}</span><input type="number" min="0" value={values.minimumNoticeDays} onChange={event=>update("minimumNoticeDays",Number(event.target.value))}/></label>
      <label><span>{rtl?"طلب مرفق بعد عدد أيام":"Attachment required after days"}</span><input type="number" min="1" value={values.attachmentAfterDays} onChange={event=>update("attachmentAfterDays",Number(event.target.value))}/></label>
      <label className="leave-switch"><span><b>{rtl?"استبعاد عطلة نهاية الأسبوع":"Exclude weekends"}</b><small>{rtl?"لا تُخصم الجمعة والسبت من الرصيد":"Friday and Saturday are not deducted"}</small></span><input type="checkbox" checked={Boolean(values.weekendsExcluded)} onChange={event=>update("weekendsExcluded",event.target.checked)}/><i/></label>
      <label className="leave-switch"><span><b>{rtl?"السماح بنصف يوم":"Allow half-day leave"}</b><small>{rtl?"يمكن للموظف طلب نصف يوم":"Employees can request a half day"}</small></span><input type="checkbox" checked={Boolean(values.allowHalfDays)} onChange={event=>update("allowHalfDays",event.target.checked)}/><i/></label>
    </>:<>
      <label><span>{rtl?"الاستحقاق السنوي — مصر":"Annual entitlement — Egypt"}</span><input type="number" min="0" value={values.annualDaysEgypt} onChange={event=>update("annualDaysEgypt",Number(event.target.value))}/><small>{rtl?"يومًا في السنة":"days per year"}</small></label>
      <label><span>{rtl?"الاستحقاق السنوي — السعودية":"Annual entitlement — Saudi Arabia"}</span><input type="number" min="0" value={values.annualDaysSaudi} onChange={event=>update("annualDaysSaudi",Number(event.target.value))}/><small>{rtl?"يومًا في السنة":"days per year"}</small></label>
      <label><span>{rtl?"رصيد الإجازة المرضية":"Sick leave allowance"}</span><input type="number" min="0" value={values.sickDays} onChange={event=>update("sickDays",Number(event.target.value))}/><small>{rtl?"يومًا في السنة":"days per year"}</small></label>
      <label><span>{rtl?"الحد الأقصى للترحيل":"Maximum carry-forward"}</span><input type="number" min="0" value={values.maxCarryForward} onChange={event=>update("maxCarryForward",Number(event.target.value))}/><small>{rtl?"أيام":"days"}</small></label>
      <label><span>{rtl?"انتهاء الرصيد المرحّل بعد":"Carry-forward expires after"}</span><input type="number" min="1" value={values.carryExpiryDays} onChange={event=>update("carryExpiryDays",Number(event.target.value))}/><small>{rtl?"يومًا":"days"}</small></label>
      <label className="leave-switch"><span><b>{rtl?"إجازات أثناء فترة التجربة":"Leave during probation"}</b><small>{rtl?"السماح بطلب الإجازة قبل اجتياز التجربة":"Allow requests before probation ends"}</small></span><input type="checkbox" checked={Boolean(values.probationLeaveEnabled)} onChange={event=>update("probationLeaveEnabled",event.target.checked)}/><i/></label>
    </>}</div><footer><span>{rtl?"يتم حفظ التغييرات في النظام وتطبيقها على الطلبات الجديدة.":"Changes are saved and applied to new requests."}</span><button className="primary" disabled={saving} onClick={()=>void submit()}><Check size={16}/>{saving?(rtl?"جارٍ الحفظ...":"Saving..."):(rtl?"حفظ التغييرات":"Save changes")}</button></footer></section>
}

/** A row needs attention when it is late, absent, or was never checked out. */
const attendanceNeedsAction=(row:Record<string,any>)=>["late","absent"].includes(String(row.status))||Number(row.late_minutes)>0||(Boolean(row.actual_in)&&!row.actual_out);

function AttendancePage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){
  const [tab,setTab]=useState("logs");
  const {data,error}=useHRData(rtl);
  const filter=useRowFilter();
  const rows=(data?.attendance??[])
    .filter(row=>tab==="logs"||attendanceNeedsAction(row))
    .filter(row=>matchesQuery(row,["employee_name","employee_name_ar","department_name","status","attendance_type","work_date"],filter.needle)&&withinPeriod(row.work_date,filter.period));
  const exportCsv=()=>{
    if(!rows.length){notify(rtl?"لا توجد سجلات للتصدير":"There are no records to export");return;}
    downloadCsv(`attendance-${new Date().toISOString().slice(0,10)}.csv`,[
      {field:"employee_name",header:rtl?"الموظف":"Employee"},{field:"department_name",header:rtl?"القسم":"Department"},
      {field:"work_date",header:rtl?"التاريخ":"Date"},{field:"scheduled_in",header:rtl?"الحضور المقرر":"Scheduled in"},
      {field:"scheduled_out",header:rtl?"الانصراف المقرر":"Scheduled out"},{field:"actual_in",header:rtl?"الحضور الفعلي":"Actual in"},
      {field:"actual_out",header:rtl?"الانصراف الفعلي":"Actual out"},{field:"worked_minutes",header:rtl?"الدقائق المسجلة":"Worked minutes"},
      {field:"late_minutes",header:rtl?"دقائق التأخير":"Late minutes"},{field:"status",header:rtl?"الحالة":"Status"},
    ],rows);
    notify(rtl?`تم تصدير ${formatNumber(rows.length,rtl)} سجلاً`:`Exported ${rows.length} record${rows.length===1?"":"s"}`);
  };
  return <><PageHeader eyebrow={rtl?"الوقت والحضور":"TIME & ATTENDANCE"} title={rtl?"الحضور والانصراف":"Attendance"} text={rtl?"سجلات موحدة من أجهزة البصمة والعمل عن بعد والتعديلات.":"One reconciled view across devices, remote work and corrections."} action={<button className="outline" onClick={exportCsv}><Download size={16}/>{rtl?"تصدير ملف البيانات":"Export CSV"}</button>}/>
    {error&&<div className="error-banner">{error}</div>}
    <Tabs items={[{id:"logs",label:rtl?"سجلات الحضور":"Attendance logs"},{id:"management",label:`${rtl?"يحتاج مراجعة":"Needs review"} (${formatNumber((data?.attendance??[]).filter(attendanceNeedsAction).length,rtl)})`}]} active={tab} setActive={setTab}/>
    <div className="panel table-panel"><FilterBar rtl={rtl} query={filter.query} setQuery={filter.setQuery} period={filter.period} setPeriod={filter.setPeriod} count={rows.length} placeholder={rtl?"ابحث باسم الموظف أو القسم...":"Search by employee or department..."}/><AttendanceTable rtl={rtl} rows={rows}/></div></>;
}

function OrgPage({rtl,notify}:{rtl:boolean;notify:(message:string)=>void}){
  const {data,error,reload}=useHRData(rtl);
  const [query,setQuery]=useState("");
  const [openDepartmentId,setOpenDepartmentId]=useState<number|null>(null);
  const [addingDepartment,setAddingDepartment]=useState(false);
  const [hierarchyOpen,setHierarchyOpen]=useState(false);
  const [printOpen,setPrintOpen]=useState(false);
  const [printDepartmentIds,setPrintDepartmentIds]=useState<Record<number,boolean>>({});
  const orgCanvasRef=useRef<HTMLDivElement|null>(null);
  const orgTreeRef=useRef<HTMLDivElement|null>(null);
  const [chartScale,setChartScale]=useState<number|null>(.7);
  const [treeLayout,setTreeLayout]=useState({scale:1,height:0,width:0,stacked:false});
  const departments=data?.departments??[], employeesData=data?.employees??[], jobs=data?.jobTitles??[];
  const roleName=String(data?.currentUser?.role_name||"");
  const canEditStructure=roleName==="Super Admin"||roleName==="HR Manager";
  const canDeleteStructure=roleName==="Super Admin"||(data?.permissions??[]).some(permission=>Number(permission.role_id)===Number(data?.currentUser?.role_id)&&permission.module==="departments"&&permission.action==="delete"&&Number(permission.allowed)===1);
  const isDepartmentManager=roleName==="Department Manager";
  const directorDepartment=departments.find(department=>/Managing Director|العضو المنتدب|Asas Company|شركة أسس/i.test(`${department.name_en} ${department.name_ar}`));
  const director=employeesData.find(employee=>Number(employee.department_id)===Number(directorDepartment?.id)) ?? employeesData.find(employee=>/Chief Executive|الرئيس التنفيذ/i.test(String(employee.job_title_name||"")));
  const jobById=new Map(jobs.map(job=>[Number(job.id),job]));
  const normalized=query.trim().toLocaleLowerCase();
  const childDepartments=(parentId:number)=>departments.filter(department=>Number(department.parent_id)===parentId);
  const departmentMembers=(departmentId:number)=>employeesData.filter(employee=>Number(employee.department_id)===departmentId);
  const departmentMatches=(department:Record<string,any>):boolean=>{const ownText=`${department.name_en} ${department.name_ar} ${departmentMembers(Number(department.id)).map(member=>`${member.name_en} ${member.name_ar}`).join(" ")}`.toLocaleLowerCase();return !normalized||ownText.includes(normalized)||childDepartments(Number(department.id)).some(departmentMatches);};
  const visibleDepartmentIds=new Set(departments.map(department=>Number(department.id)));
  const scopedRoots=departments.filter(department=>department.status!=="deleted"&&(!Number(department.parent_id)||!visibleDepartmentIds.has(Number(department.parent_id))));
  const rootDepartments=(directorDepartment?childDepartments(Number(directorDepartment.id)):scopedRoots).filter(departmentMatches);
  const directorJob=director?jobById.get(Number(director.job_title_id)):undefined;
  const totalEmployees=employeesData.length;
  const totalDepartments=departments.filter(department=>department.status!=="deleted").length;
  const totalJobTitles=jobs.filter(job=>job.status!=="deleted").length;
  const openDepartment=departments.find(department=>Number(department.id)===openDepartmentId)||null;
  const activeDepartments=departments.filter(department=>department.status!=="deleted");
  const directorDepartmentId=Number(directorDepartment?.id)||0;
  const orderedPrintDepartments=(()=>{const byParent=new Map<number,Record<string,any>[]>();for(const department of activeDepartments){const parentId=Number(department.parent_id)||0;const siblings=byParent.get(parentId)??[];siblings.push(department);byParent.set(parentId,siblings);}const ordered:Record<string,any>[]=[];const visited=new Set<number>();const visit=(department:Record<string,any>)=>{const id=Number(department.id);if(visited.has(id))return;visited.add(id);ordered.push(department);for(const child of byParent.get(id)??[])visit(child);};for(const root of byParent.get(0)??[])visit(root);for(const department of activeDepartments)visit(department);return ordered;})();
  const selectablePrintDepartments=orderedPrintDepartments.filter(department=>Number(department.id)!==directorDepartmentId);
  const selectedPrintDepartments=selectablePrintDepartments.filter(department=>printDepartmentIds[Number(department.id)]);
  const selectedPrintIdSet=new Set(selectedPrintDepartments.map(department=>Number(department.id)));
  const hasSelectedAncestor=(department:Record<string,any>)=>{let parentId=Number(department.parent_id)||0;const visited=new Set<number>();while(parentId&&!visited.has(parentId)){if(selectedPrintIdSet.has(parentId))return true;visited.add(parentId);parentId=Number(departments.find(item=>Number(item.id)===parentId)?.parent_id)||0;}return false;};
  const includedPrintDepartments=selectablePrintDepartments.filter(department=>selectedPrintIdSet.has(Number(department.id))||hasSelectedAncestor(department));
  const belongsToPrintRoot=(department:Record<string,any>,rootId:number)=>{let currentId=Number(department.id)||0;const visited=new Set<number>();while(currentId&&!visited.has(currentId)){if(currentId===rootId)return true;visited.add(currentId);currentId=Number(activeDepartments.find(item=>Number(item.id)===currentId)?.parent_id)||0;}return false;};
  const koonSoftwareDepartment=includedPrintDepartments.find(department=>/Koon Software|كون برمجة/i.test(`${department.name_en} ${department.name_ar}`));
  const koonAgencyDepartment=includedPrintDepartments.find(department=>/Koon Agency|وكالة كون/i.test(`${department.name_en} ${department.name_ar}`));
  const koonSoftwareDepartments=koonSoftwareDepartment?includedPrintDepartments.filter(department=>belongsToPrintRoot(department,Number(koonSoftwareDepartment.id))):[];
  const koonAgencyDepartments=koonAgencyDepartment?includedPrintDepartments.filter(department=>belongsToPrintRoot(department,Number(koonAgencyDepartment.id))):[];
  const separateCompanyIds=new Set([...koonSoftwareDepartments,...koonAgencyDepartments].map(department=>Number(department.id)));
  const asasSelectedDepartments=includedPrintDepartments.filter(department=>!separateCompanyIds.has(Number(department.id)));
  const asasSaudiDepartment=asasSelectedDepartments.find(department=>/Saudi(?: Arabia)? Branch|فرع السعودية/i.test(`${department.name_en} ${department.name_ar}`));
  const asasEgyptDepartment=asasSelectedDepartments.find(department=>/Egypt Branch|Asas Egypt|أسس فرع مصر|فرع مصر/i.test(`${department.name_en} ${department.name_ar}`));
  const asasBranchGroups=[
    {key:"asas-saudi",departments:asasSaudiDepartment?asasSelectedDepartments.filter(department=>belongsToPrintRoot(department,Number(asasSaudiDepartment.id))):[]},
    {key:"asas-egypt",departments:asasEgyptDepartment?asasSelectedDepartments.filter(department=>belongsToPrintRoot(department,Number(asasEgyptDepartment.id))):[]},
  ].filter(group=>group.departments.length>0);
  const asasFallbackDepartments=asasBranchGroups.length?[]:asasSelectedDepartments.length?[...(directorDepartment?[directorDepartment]:[]),...asasSelectedDepartments]:[];
  const printCompanyGroups=[
    ...asasBranchGroups,
    {key:"asas",departments:asasFallbackDepartments},
    {key:"koon-software",departments:koonSoftwareDepartments},
    {key:"koon-agency",departments:koonAgencyDepartments},
  ].filter(group=>group.departments.length>0);
  const printingOverview=Boolean(directorDepartment||includedPrintDepartments.length);
  const totalPrintPages=(printingOverview?1:0)+printCompanyGroups.length;
  const openPrint=()=>{setPrintDepartmentIds(Object.fromEntries(selectablePrintDepartments.map(department=>[Number(department.id),true])));setPrintOpen(true);};
  const printStructure=()=>{const root=document.documentElement;root.classList.add("org-printing");document.getElementById("org-print-page-style")?.remove();const pageStyle=document.createElement("style");pageStyle.id="org-print-page-style";pageStyle.textContent="@page { size: A4 landscape; margin: 8mm; }";document.head.appendChild(pageStyle);const cleanup=()=>{root.classList.remove("org-printing");pageStyle.remove();};window.addEventListener("afterprint",cleanup,{once:true});window.setTimeout(()=>window.print(),120);};
  useLayoutEffect(()=>{
    const canvas=orgCanvasRef.current,tree=orgTreeRef.current;
    if(!canvas||!tree)return;
    let frame=0;
    const update=()=>{
      window.cancelAnimationFrame(frame);
      frame=window.requestAnimationFrame(()=>{
        const canvasStyle=window.getComputedStyle(canvas);
        const availableWidth=Math.max(0,canvas.clientWidth-(Number.parseFloat(canvasStyle.paddingInlineStart)||0)-(Number.parseFloat(canvasStyle.paddingInlineEnd)||0));
        const stacked=availableWidth<900;
        const naturalWidth=Math.max(tree.scrollWidth,tree.offsetWidth,1);
        const scale=stacked?1:(chartScale??Math.min(1,availableWidth/naturalWidth));
        const height=stacked?0:Math.ceil(tree.scrollHeight*scale)+2;
        const width=stacked?0:Math.max(availableWidth,Math.ceil(naturalWidth*scale)+4);
        setTreeLayout(current=>current.stacked===stacked&&Math.abs(current.scale-scale)<.005&&Math.abs(current.height-height)<2&&Math.abs(current.width-width)<2?current:{scale,height,width,stacked});
      });
    };
    const observer=typeof ResizeObserver==="undefined"?null:new ResizeObserver(update);
    observer?.observe(canvas);
    observer?.observe(tree);
    window.addEventListener("resize",update);
    update();
    return()=>{window.cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener("resize",update);};
  },[data,normalized,chartScale]);
  return <div className="org-page"><PageHeader eyebrow={rtl?"الهيكل الإداري":"ORGANIZATION STRUCTURE"} title={isDepartmentManager?(rtl?"هيكل فريقي":"My team structure"):(rtl?"الرئيس التنفيذي وقطاعات الشركة":"CEO & company divisions")} text={isDepartmentManager?(rtl?"قسمك وكل الإدارات والموظفين التابعين لك.":"Your department and every team and employee reporting to you."):(rtl?"قطاعات الشركة، تتفرع منها الإدارات والفرق والموظفون.":"Company divisions, followed by their departments, teams and employees.")}/>
  {error&&<div className="error-banner">{error}<button onClick={()=>void reload()}>{rtl?"إعادة المحاولة":"Retry"}</button></div>}
  <section className="org-insights" aria-label={rtl?"ملخص الهيكل":"Structure summary"}>
    <div className="org-insight primary-insight"><span><Users size={20}/></span><div><b>{formatNumber(totalEmployees,rtl)}</b><small>{rtl?"عدد الموظفين":"Employees"}</small></div></div>
    <div className="org-insight"><span><Building2 size={20}/></span><div><b>{formatNumber(totalDepartments,rtl)}</b><small>{rtl?"عدد الأقسام":"Departments"}</small></div></div>
    <div className="org-insight"><span><BriefcaseBusiness size={20}/></span><div><b>{formatNumber(totalJobTitles,rtl)}</b><small>{rtl?"عدد المسميات الوظيفية":"Job titles"}</small></div></div>
  </section>
  <div className="org-toolbar"><div><b>{isDepartmentManager?(rtl?"التسلسل من قسمك إلى أعضاء الفريق":"Your department-to-team hierarchy"):(rtl?"التسلسل من الرئيس التنفيذي إلى الموظفين":"CEO-to-employee hierarchy")}</b><small>{canEditStructure?(rtl?"اضغط على أي إدارة لعرض موظفيها وتعديل ترتيبهم الوظيفي":"Open any department to view its people and edit their order"):(rtl?"اضغط على أي إدارة لعرض أعضاء الفريق":"Open any department to view its team")}</small></div><span></span><button className="outline org-print-button" onClick={openPrint}><Printer size={16}/>{rtl?"طباعة الهيكل":"Print structure"}</button>{canEditStructure&&<button className="outline org-hierarchy-button" onClick={()=>setHierarchyOpen(true)}><Network size={16}/>{rtl?"ترتيب التبعية":"Manage hierarchy"}</button>}{canEditStructure&&<button className="primary org-add-department" onClick={()=>setAddingDepartment(true)}><Plus size={16}/>{rtl?"إضافة قسم":"Add department"}</button>}<label className="org-search"><Search size={16}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={rtl?"ابحث عن قسم أو موظف":"Find a department or employee"}/>{query&&<button onClick={()=>setQuery("")} aria-label={rtl?"مسح البحث":"Clear search"}><X size={16}/></button>}</label></div>
  <div className="panel org-canvas" ref={orgCanvasRef}>
    {!treeLayout.stacked&&<div className="org-chart-zoom" role="group" aria-label={rtl?"تكبير وتصغير الهيكل":"Organization chart zoom"}><button onClick={()=>setChartScale(Math.max(.35,Number((treeLayout.scale-.15).toFixed(2))))} disabled={treeLayout.scale<=.35} aria-label={rtl?"تصغير":"Zoom out"}><Minus size={16}/></button><button className="org-chart-zoom-value" onClick={()=>setChartScale(1)} title={rtl?"الحجم الأصلي":"Actual size"}>{Math.round(treeLayout.scale*100)}%</button><button onClick={()=>setChartScale(Math.min(1.75,Number((treeLayout.scale+.15).toFixed(2))))} disabled={treeLayout.scale>=1.75} aria-label={rtl?"تكبير":"Zoom in"}><Plus size={16}/></button><button onClick={()=>setChartScale(null)} aria-label={rtl?"ملاءمة الهيكل للشاشة":"Fit chart to screen"} title={rtl?"ملاءمة الشاشة":"Fit to screen"}><RotateCcw size={15}/></button></div>}
    {canEditStructure&&director&&<div className="org-executive"><span className="org-level-label">{rtl?"الرئيس التنفيذي":"CHIEF EXECUTIVE OFFICER"}</span><div className="org-executive-card"><div><small>{rtl?"تتبعه القطاعات الرئيسية":"MAIN DIVISIONS REPORT TO"}</small><b>{rtl?director.name_ar:director.name_en}</b><span>{localizedJobTitle(rtl,directorJob,{name_en:director.job_title_name,name_ar:director.job_title_name_ar})}</span></div><em>{director.employee_code}</em></div><div className="org-main-connector"><span>{formatNumber(rootDepartments.length,rtl)} {rtl?"قطاعات مباشرة":"direct divisions"}</span></div></div>}
    <div className={`org-tree-stage ${treeLayout.stacked?"stacked":"fitted"}`} style={treeLayout.stacked?undefined:{height:treeLayout.height||undefined,width:treeLayout.width||undefined}}><div ref={orgTreeRef} className="org-department-grid org-division-tree" style={treeLayout.stacked?undefined:{transform:`translateX(-50%) scale(${treeLayout.scale})`}}>{rootDepartments.map((department,index)=><OrgDepartmentTreeNode key={department.id} rtl={rtl} department={department} departments={departments} employees={employeesData} jobs={jobs} tone={["blue","violet","green"][index%3]} depth={0} normalizedQuery={normalized} openDepartment={id=>setOpenDepartmentId(id)}/>)}</div></div>
    {data&&rootDepartments.length===0&&(
      <Empty icon={Building2} title={rtl?"لا توجد نتائج مطابقة":"No matching results"} text={normalized?(rtl?"غيّر عبارة البحث لعرض الهيكل بالكامل.":"Change the search to show the complete hierarchy."):(rtl?"لا توجد أقسام ضمن نطاقك الإداري.":"No departments are available in your management scope.")}/>
    )}
  </div>
  <section className="org-print-sheet">{printingOverview&&<OrgPrintSummaryPage rtl={rtl} company={directorDepartment} director={director} directorJob={directorJob} departments={includedPrintDepartments} employees={employeesData} jobs={jobs} totalPages={totalPrintPages}/>} {printCompanyGroups.map((group,index)=><OrgPrintDepartmentPage key={group.key} groupKey={group.key} rtl={rtl} departments={group.departments} allDepartments={[...(directorDepartment?[directorDepartment]:[]),...includedPrintDepartments]} employees={employeesData} jobs={jobs} pageNumber={index+(printingOverview?2:1)} totalPages={totalPrintPages}/>)}</section>
  {printOpen&&<OrgPrintModal rtl={rtl} director={director} departments={selectablePrintDepartments} directorDepartmentId={directorDepartmentId} selected={printDepartmentIds} setSelected={setPrintDepartmentIds} close={()=>setPrintOpen(false)} print={printStructure}/>} {canEditStructure&&hierarchyOpen&&<DepartmentHierarchyManager rtl={rtl} departments={departments.filter(department=>department.status!=="deleted"&&department.status!=="archived")} employees={employeesData} close={()=>setHierarchyOpen(false)} save={async assignments=>{await hrApi({action:"save_department_parents",assignments});await reload();setHierarchyOpen(false);notify(rtl?"تم حفظ تبعية الأقسام وتحديث الهيكل":"Department hierarchy saved successfully");}}/>} {openDepartment&&<DepartmentTeamModal key={openDepartment.id} rtl={rtl} department={openDepartment} departments={departments} employees={employeesData} jobs={jobs} data={data} canEdit={canEditStructure} canDelete={canDeleteStructure} close={()=>setOpenDepartmentId(null)} openDepartment={id=>setOpenDepartmentId(id)} reload={reload} notify={notify} removeDepartment={async()=>{const result=await hrApi({action:"delete_department",departmentId:Number(openDepartment.id)});setOpenDepartmentId(null);await reload();notify(rtl?`تم حذف القسم ونقل ${formatNumber(Number(result.movedEmployees)||0,rtl)} موظف للقسم الأعلى`:`Department deleted; ${Number(result.movedEmployees)||0} employees moved to its parent`);}}/>} {canEditStructure&&addingDepartment&&<NewDepartmentModal rtl={rtl} departments={departments} employees={employeesData} close={()=>setAddingDepartment(false)} save={async values=>{await hrApi({action:"create_department_structure",...values});await reload();setAddingDepartment(false);notify(rtl?"تم إنشاء القسم وربط المدير والموظفين":"Department, manager and employees created successfully");}}/>}</div>}

function OrgPrintPageHeader({rtl,title,subtitle,pageNumber,totalPages}:{rtl:boolean;title:string;subtitle:string;pageNumber:number;totalPages:number}){return <header className="org-print-page-header"><img src="/sanad-logo.png" alt="Sanad"/><div><h1>{title}</h1><p>{subtitle}</p></div><aside><span>{rtl?`صفحة ${formatNumber(pageNumber,rtl)} من ${formatNumber(totalPages,rtl)}`:`Page ${pageNumber} of ${totalPages}`}</span><time>{new Date().toLocaleDateString(rtl?"ar-EG":"en-GB")}</time></aside></header>}

function OrgPrintSummaryPage({rtl,company,director,directorJob,departments,employees,jobs,totalPages}:{rtl:boolean;company?:Record<string,any>;director?:Record<string,any>;directorJob?:Record<string,any>;departments:Record<string,any>[];employees:Record<string,any>[];jobs:Record<string,any>[];totalPages:number}){
  void jobs;
  const all=[...(company?[company]:[]),...departments.filter(department=>Number(department.id)!==Number(company?.id))];
  const ids=new Set(all.map(department=>Number(department.id)));
  const root=company??all.find(department=>!ids.has(Number(department.parent_id)));
  const branches=root?all.filter(department=>Number(department.parent_id)===Number(root.id)):all.filter(department=>!ids.has(Number(department.parent_id)));
  return <section className="org-print-page landscape org-print-summary org-print-redesign org-print-company-overview"><OrgPrintPageHeader rtl={rtl} title={rtl?"الهيكل العام لشركة أسس":"Asas Company — Organization Overview"} subtitle={rtl?"فرعا مصر والسعودية وجميع الأقسام التابعة لهما":"Egypt and Saudi Arabia branches with all reporting departments"} pageNumber={1} totalPages={totalPages}/><div className="org-print-overview-map"><div className="org-print-overview-root"><small>{rtl?"الشركة الرئيسية":"PARENT COMPANY"}</small><b>{root?(rtl?(root.name_ar||root.name_en):(root.name_en||root.name_ar)):(rtl?"شركة أسس":"Asas Company")}</b>{director&&<span>{rtl?"الرئيس التنفيذي":"Chief Executive Officer"}: {rtl?(director.name_ar||director.name_en):(director.name_en||director.name_ar)} · {localizedJobTitle(rtl,directorJob,{name_en:director.job_title_name,name_ar:director.job_title_name_ar})}</span>}</div><div className="org-print-overview-trunk"/><div className={`org-print-overview-branches branches-${Math.min(branches.length,3)}`}>{branches.map(branch=><OrgPrintOverviewNode key={branch.id} rtl={rtl} department={branch} departments={all} employees={employees} depth={0}/>)}</div></div></section>
}

function OrgPrintOverviewNode({rtl,department,departments,employees,depth}:{rtl:boolean;department:Record<string,any>;departments:Record<string,any>[];employees:Record<string,any>[];depth:number}){
  const children=departments.filter(item=>Number(item.parent_id)===Number(department.id));
  const employeeCount=employees.filter(employee=>Number(employee.department_id)===Number(department.id)).length;
  return <section className={`org-print-overview-node depth-${depth}`}><article><small>{depth===0?(rtl?"فرع":"BRANCH"):(rtl?"قسم تابع":"DEPARTMENT")}</small><b>{rtl?(department.name_ar||department.name_en):(department.name_en||department.name_ar)}</b><span>{formatNumber(employeeCount,rtl)} {rtl?"موظف":"employees"}</span></article>{children.length>0&&<div className={`org-print-overview-children children-${Math.min(children.length,8)}`}>{children.map(child=><OrgPrintOverviewNode key={child.id} rtl={rtl} department={child} departments={departments} employees={employees} depth={depth+1}/>)}</div>}</section>;
}

function OrgPrintDepartmentPage({rtl,groupKey,departments,allDepartments,employees,jobs,pageNumber,totalPages}:{rtl:boolean;groupKey:string;departments:Record<string,any>[];allDepartments:Record<string,any>[];employees:Record<string,any>[];jobs:Record<string,any>[];pageNumber:number;totalPages:number}){
  const idSet=new Set(departments.map(department=>Number(department.id)));
  const depthOf=(department:Record<string,any>)=>{let depth=0,parentId=Number(department.parent_id)||0;const visited=new Set<number>();while(parentId&&idSet.has(parentId)&&!visited.has(parentId)){visited.add(parentId);depth++;parentId=Number(departments.find(item=>Number(item.id)===parentId)?.parent_id)||0;}return depth;};
  const maxDepth=Math.max(0,...departments.map(depthOf)),levels=Array.from({length:maxDepth+1},(_,depth)=>departments.filter(department=>depthOf(department)===depth));
  const groupTitle=groupKey==="asas-saudi"?(rtl?"أسس – فرع السعودية":"Asas — Saudi Arabia Branch"):groupKey==="asas-egypt"?(rtl?"أسس – فرع مصر":"Asas — Egypt Branch"):groupKey==="asas"?(rtl?"شركة أسس":"Asas Company"):groupKey==="koon-software"?(rtl?"كون للبرمجة":"Koon Software"):(rtl?"وكالة كون":"Koon Agency");
  return <section className={`org-print-page landscape org-print-department-page org-print-redesign org-print-department-pyramid group-${groupKey}`}><OrgPrintPageHeader rtl={rtl} title={groupTitle} subtitle={rtl?"الأقسام والموظفون حسب التسلسل الهرمي":"Departments and employees in hierarchy order"} pageNumber={pageNumber} totalPages={totalPages}/><div className={`org-print-pyramid levels-${levels.length}`}>{levels.map((level,depth)=><div className={`org-print-pyramid-level level-${depth} nodes-${Math.min(level.length,8)}`} key={depth}>{level.map(department=><div className="org-print-pyramid-node" key={department.id}><OrgPrintDepartmentCard rtl={rtl} department={department} departments={allDepartments} employees={employees} jobs={jobs} tone={["blue","green","violet"][depth%3]}/></div>)}</div>)}</div></section>
}

function OrgPrintDepartmentCard({rtl,department,departments,employees,jobs,tone}:{rtl:boolean;department:Record<string,any>;departments:Record<string,any>[];employees:Record<string,any>[];jobs:Record<string,any>[];tone:string}){
  const id=Number(department.id),manager=employees.find(employee=>Number(employee.id)===Number(department.manager_employee_id));
  const members=employees.filter(employee=>Number(employee.department_id)===id&&Number(employee.id)!==Number(manager?.id)).sort((a,b)=>Number(a.organizational_level??1)-Number(b.organizational_level??1));
  const children=departments.filter(item=>Number(item.parent_id)===id),parent=departments.find(item=>Number(item.id)===Number(department.parent_id));
  const jobById=new Map(jobs.map(job=>[Number(job.id),job]));
  const density=members.length>20?" ultra-dense":members.length>12?" dense":members.length>6?" compact":"";
  return <article className={`org-print-department-panel ${tone}${density}`}><header><div><h2>{rtl?(department.name_ar||department.name_en):(department.name_en||department.name_ar)}</h2><p>{parent?(rtl?`يتبع: ${parent.name_ar||parent.name_en}`:`Reports to: ${parent.name_en||parent.name_ar}`):(rtl?"قطاع رئيسي يتبع الرئيس التنفيذي":"Main division reporting to CEO")}</p></div></header>{manager&&<div className="org-print-manager-card"><span><CircleUserRound size={20}/></span><div><small>{organizationManagerLabel(department,rtl,true)}</small><b>{rtl?manager.name_ar:manager.name_en}</b><em>{localizedJobTitle(rtl,jobById.get(Number(manager.job_title_id)),{name_en:manager.job_title_name,name_ar:manager.job_title_name_ar})}</em></div></div>}{members.length>0&&<div className="org-print-people-grid">{members.map((member,index)=><div key={member.id}><span>{formatNumber(index+1,rtl)}</span><section><b>{rtl?member.name_ar:member.name_en}</b><small>{localizedJobTitle(rtl,jobById.get(Number(member.job_title_id)),{name_en:member.job_title_name,name_ar:member.job_title_name_ar})}</small></section></div>)}</div>}{children.length>0&&<footer><b>{rtl?"إدارات تابعة":"CHILD DEPARTMENTS"}</b><div>{children.map(child=><span key={child.id}><Building2 size={12}/>{rtl?(child.name_ar||child.name_en):(child.name_en||child.name_ar)}</span>)}</div></footer>}</article>;
}

function OrgPrintModal({rtl,director,departments,directorDepartmentId,selected,setSelected,close,print}:{rtl:boolean;director?:Record<string,any>;departments:Record<string,any>[];directorDepartmentId:number;selected:Record<number,boolean>;setSelected:React.Dispatch<React.SetStateAction<Record<number,boolean>>>;close:()=>void;print:()=>void}){
  const selectedCount=departments.filter(department=>selected[Number(department.id)]).length;
  const allSelected=departments.length>0&&selectedCount===departments.length;
  const depthOf=(department:Record<string,any>)=>{let depth=0,parentId=Number(department.parent_id)||0;const visited=new Set<number>();while(parentId&&parentId!==directorDepartmentId&&!visited.has(parentId)){visited.add(parentId);depth++;parentId=Number(departments.find(item=>Number(item.id)===parentId)?.parent_id)||0;}return depth;};
  const toggleAll=()=>setSelected(allSelected?{}:Object.fromEntries(departments.map(department=>[Number(department.id),true])));
  return <div className="modal-layer modal-center org-print-modal-layer"><button className="modal-scrim" onClick={close} aria-label={rtl?"إغلاق":"Close"}/><aside className="modal-dialog org-print-modal" role="dialog" aria-modal="true" aria-labelledby="org-print-title"><div className="drawer-head"><div><span className="eyebrow">{rtl?"طباعة الهيكل":"PRINT ORGANIZATION"}</span><h2 id="org-print-title">{rtl?"اختر الأقسام المطلوب طباعتها":"Choose departments to print"}</h2><p>{rtl?"تعرض الصفحة الأولى الهيكل العام، ثم صفحات واضحة منفصلة لفرع السعودية وفرع مصر وكون للبرمجة ووكالة كون، مع كارت كامل لكل قسم وموظفيه.":"The first page shows the full structure, followed by clear separate pages for the Saudi branch, Egypt branch, Koon Software, and Koon Agency, with a full card for every department and its employees."}</p></div><button className="icon-btn" onClick={close} aria-label={rtl?"إغلاق":"Close"}><X size={20}/></button></div><div className="org-print-modal-body">{director&&<div className="org-print-director"><span><CircleUserRound size={20}/></span><div><b>{rtl?"الرئيس التنفيذي":"Chief Executive Officer"}</b><small>{rtl?(director.name_ar||director.name_en):(director.name_en||director.name_ar)}</small></div><em>{rtl?"أولاً":"First"}</em></div>}<button className="org-print-select-all" onClick={toggleAll}><span>{allSelected?(rtl?"إلغاء تحديد كل الأقسام":"Clear all departments"):(rtl?"تحديد كل الأقسام":"Select all departments")}</span><b>{formatNumber(selectedCount,rtl)} / {formatNumber(departments.length,rtl)}</b></button><div className="org-print-department-list">{departments.map(department=><label key={department.id} style={{"--print-depth":Math.min(depthOf(department),4)} as React.CSSProperties} className={selected[Number(department.id)]?"selected":""}><input type="checkbox" checked={Boolean(selected[Number(department.id)])} onChange={()=>setSelected(current=>({...current,[Number(department.id)]:!current[Number(department.id)]}))}/><span><b>{rtl?(department.name_ar||department.name_en):(department.name_en||department.name_ar)}</b>{!rtl&&<small>{department.name_ar||""}</small>}</span></label>)}</div></div><div className="drawer-footer"><span/><button className="outline" onClick={close}>{rtl?"إلغاء":"Cancel"}</button><button className="primary" disabled={!selectedCount&&!director} onClick={print}><Printer size={16}/>{rtl?"طباعة الهيكل بالترتيب":"Print ordered structure"}</button></div></aside></div>;
}

function DepartmentHierarchyManager({rtl,departments,employees,close,save}:{rtl:boolean;departments:Record<string,any>[];employees:Record<string,any>[];close:()=>void;save:(assignments:{departmentId:number;parentId:number|null}[])=>Promise<void>}){
  const originalParents=useMemo(()=>Object.fromEntries(departments.map(department=>[Number(department.id),Number(department.parent_id)||0])),[departments]);
  const [parents,setParents]=useState<Record<number,number>>(originalParents);
  const [draggedId,setDraggedId]=useState<number|null>(null),[dropTarget,setDropTarget]=useState<number|null>(null);
  const [saving,setSaving]=useState(false),[error,setError]=useState("");
  const departmentById=new Map(departments.map(department=>[Number(department.id),department]));
  const managerByDepartment=new Map(departments.map(department=>[Number(department.id),employees.find(employee=>Number(employee.id)===Number(department.manager_employee_id))]));
  const descendantsOf=(departmentId:number)=>{const descendants=new Set<number>(),queue=[departmentId];while(queue.length){const parent=queue.shift()!;for(const department of departments){const id=Number(department.id);if(parents[id]===parent&&!descendants.has(id)){descendants.add(id);queue.push(id);}}}return descendants;};
  const moveDepartment=(departmentId:number,parentId:number)=>{if(departmentId===parentId||descendantsOf(departmentId).has(parentId)){setError(rtl?"لا يمكن وضع القسم تحت نفسه أو تحت أحد الأقسام التابعة له.":"A department cannot report to itself or one of its descendants.");return;}setError("");setParents(current=>({...current,[departmentId]:parentId}));};
  const changed=departments.filter(department=>parents[Number(department.id)]!==originalParents[Number(department.id)]);
  const roots=departments.filter(department=>!parents[Number(department.id)]||!departmentById.has(parents[Number(department.id)])).sort((a,b)=>String(rtl?a.name_ar:a.name_en).localeCompare(String(rtl?b.name_ar:b.name_en),rtl?"ar":"en"));
  const submit=async()=>{try{setSaving(true);setError("");await save(changed.map(department=>({departmentId:Number(department.id),parentId:parents[Number(department.id)]||null})));}catch(reason){setError(reason instanceof Error?reason.message:(rtl?"تعذر حفظ الهيكل":"Unable to save hierarchy"));setSaving(false);}};
  const row=(department:Record<string,any>,depth:number):React.ReactNode=>{const id=Number(department.id),manager=managerByDepartment.get(id),children=departments.filter(item=>parents[Number(item.id)]===id).sort((a,b)=>String(rtl?a.name_ar:a.name_en).localeCompare(String(rtl?b.name_ar:b.name_en),rtl?"ar":"en")),blocked=descendantsOf(id);return <div className="department-parent-branch" key={id}><div className={`department-parent-row${dropTarget===id?" drop-target":""}${parents[id]!==originalParents[id]?" changed":""}`} style={{"--hierarchy-depth":Math.min(depth,6)} as React.CSSProperties} draggable onDragStart={event=>{setDraggedId(id);event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",String(id));}} onDragEnd={()=>{setDraggedId(null);setDropTarget(null);}} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect="move";setDropTarget(id);}} onDragLeave={()=>setDropTarget(current=>current===id?null:current)} onDrop={event=>{event.preventDefault();const moving=draggedId||Number(event.dataTransfer.getData("text/plain"));if(moving)moveDepartment(moving,id);setDraggedId(null);setDropTarget(null);}}><span className="department-parent-grip" title={rtl?"اسحب لنقل القسم":"Drag to move department"}><GripVertical size={18}/></span><span className="department-parent-icon"><Building2 size={18}/></span><div className="department-parent-name"><b>{rtl?(department.name_ar||department.name_en):(department.name_en||department.name_ar)}</b><small>{manager?`${organizationManagerLabel(department,rtl)}: ${rtl?(manager.name_ar||manager.name_en):(manager.name_en||manager.name_ar)}`:(rtl?"لا يوجد مدير محدد":"No manager assigned")}</small></div><label><span>{rtl?"يتبع":"Reports to"}</span><select value={parents[id]||0} onChange={event=>moveDepartment(id,Number(event.target.value)||0)}><option value="0">{rtl?"المستوى الرئيسي":"Top level"}</option>{departments.filter(option=>Number(option.id)!==id&&!blocked.has(Number(option.id))).map(option=><option value={option.id} key={option.id}>{rtl?(option.name_ar||option.name_en):(option.name_en||option.name_ar)}</option>)}</select></label></div>{children.length>0&&<div className="department-parent-children">{children.map(child=>row(child,depth+1))}</div>}</div>;};
  return <div className="modal-layer modal-center"><button className="modal-scrim" onClick={close} aria-label={rtl?"إغلاق":"Close"}/><aside className="modal-dialog department-parent-modal" role="dialog" aria-modal="true" aria-labelledby="department-parent-title"><div className="drawer-head"><div><span className="eyebrow">{rtl?"الهيكل التنظيمي":"ORGANIZATION STRUCTURE"}</span><h2 id="department-parent-title">{rtl?"ترتيب تبعية الأقسام":"Manage department hierarchy"}</h2><p>{rtl?"اسحب أي قسم وضعه فوق القسم الذي يتبعه، أو اختر التبعية مباشرة من القائمة.":"Drag a department onto its parent, or choose the parent from the list."}</p></div><button className="icon-btn" onClick={close} aria-label={rtl?"إغلاق":"Close"}><X size={20}/></button></div><div className="department-parent-body">{error&&<div className="error-banner">{error}</div>}<div className={`department-root-drop${dropTarget===0?" drop-target":""}`} onDragOver={event=>{event.preventDefault();setDropTarget(0);}} onDragLeave={()=>setDropTarget(current=>current===0?null:current)} onDrop={event=>{event.preventDefault();const moving=draggedId||Number(event.dataTransfer.getData("text/plain"));if(moving)moveDepartment(moving,0);setDraggedId(null);setDropTarget(null);}}><Network size={20}/><div><b>{rtl?"المستوى الرئيسي للشركة":"Company top level"}</b><small>{rtl?"اسحب القسم هنا ليصبح قسماً رئيسياً":"Drop here to make a top-level department"}</small></div></div><div className="department-parent-tree">{roots.map(department=>row(department,0))}</div></div><div className="drawer-footer"><span className="department-parent-change-count">{changed.length?(rtl?`${formatNumber(changed.length,rtl)} تغييرات غير محفوظة`:`${changed.length} unsaved change${changed.length===1?"":"s"}`):(rtl?"لا توجد تغييرات":"No changes")}</span><button className="outline" onClick={close}>{rtl?"إلغاء":"Cancel"}</button><button className="primary" disabled={saving||!changed.length} onClick={()=>void submit()}><Check size={16}/>{saving?(rtl?"جارٍ الحفظ...":"Saving..."):(rtl?"حفظ التبعية":"Save hierarchy")}</button></div></aside></div>;
}

function NewDepartmentModal({rtl,departments,employees,close,save}:{rtl:boolean;departments:Record<string,any>[];employees:Record<string,any>[];close:()=>void;save:(values:Record<string,unknown>)=>Promise<void>}){
  const [nameAr,setNameAr]=useState(""),[nameEn,setNameEn]=useState(""),[unitType,setUnitType]=useState<"company"|"department">("department"),[parentId,setParentId]=useState(0),[managerId,setManagerId]=useState(0);
  const [selectedIds,setSelectedIds]=useState<Record<number,boolean>>({}),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const selectedCount=Object.values(selectedIds).filter(Boolean).length;
  const managerLabel=organizationManagerLabel({unit_type:unitType},rtl);
  const toggleEmployee=(employeeId:number)=>setSelectedIds(current=>({...current,[employeeId]:!current[employeeId]}));
  const submit=async()=>{if(!nameAr.trim()||!nameEn.trim()){setError(rtl?"اسم الكيان بالعربية والإنجليزية مطلوب":"Arabic and English entity names are required");return;}try{setSaving(true);setError("");await save({nameAr,nameEn,unitType,parentId:parentId||null,managerEmployeeId:managerId||null,employeeIds:Object.entries(selectedIds).filter(([,selected])=>selected).map(([id])=>Number(id))});}catch(reason){setError(reason instanceof Error?reason.message:(rtl?"تعذر إنشاء الكيان":"Unable to create organization unit"));setSaving(false);}};
  return <div className="modal-layer modal-center"><button className="modal-scrim" onClick={close} aria-label={rtl?"إغلاق":"Close"}/><aside className="modal-dialog org-new-department-modal" role="dialog" aria-modal="true">
    <div className="drawer-head"><div><span className="eyebrow">{rtl?"الهيكل التنظيمي":"ORGANIZATION STRUCTURE"}</span><h2>{rtl?"إضافة شركة أو قسم":"Add a company or department"}</h2><p>{rtl?"حدد نوع الكيان وتبعيته ومديره والموظفين المنضمين إليه.":"Choose its type, parent, manager, and assigned employees."}</p></div><button className="icon-btn" onClick={close} aria-label={rtl?"إغلاق":"Close"}><X size={20}/></button></div>
    <div className="form-body org-new-department-body">{error&&<div className="error-banner">{error}</div>}
      <div className="form-row"><label className="field"><span>{rtl?"الاسم بالعربية":"Arabic name"}</span><input dir="rtl" value={nameAr} onChange={event=>setNameAr(event.target.value)}/></label><label className="field"><span>{rtl?"الاسم بالإنجليزية":"English name"}</span><input dir="ltr" value={nameEn} onChange={event=>setNameEn(event.target.value)}/></label></div>
      <div className="form-row"><label className="field"><span>{rtl?"نوع الكيان":"Entity type"}</span><select value={unitType} onChange={event=>setUnitType(event.target.value==="company"?"company":"department")}><option value="department">{rtl?"قسم":"Department"}</option><option value="company">{rtl?"شركة":"Company"}</option></select></label><label className="field"><span>{rtl?"يتبع":"Parent entity"}</span><select value={parentId} onChange={event=>setParentId(Number(event.target.value)||0)}><option value="0">{rtl?"كيان رئيسي مستقل":"Independent top-level entity"}</option>{departments.filter(item=>item.status!=="deleted"&&item.status!=="archived").map(item=><option value={item.id} key={item.id}>{rtl?item.name_ar:item.name_en}</option>)}</select></label></div>
      <label className="field"><span>{managerLabel}</span><select value={managerId} onChange={event=>setManagerId(Number(event.target.value)||0)}><option value="0">{rtl?"بدون مدير حالياً":"No manager yet"}</option>{employees.map(employee=><option value={employee.id} key={employee.id}>{rtl?employee.name_ar:employee.name_en} — {employee.employee_code}</option>)}</select></label>
      <div className="org-new-employees-head"><div><b>{rtl?"الموظفون":"Employees"}</b><small>{rtl?"اختر موظفاً أو أكثر لنقلهم إلى الكيان الجديد":"Select employees to move to the new entity"}</small></div><span>{formatNumber(selectedCount,rtl)}</span></div>
      <div className="org-new-employees">{employees.map(employee=><label key={employee.id} className={selectedIds[Number(employee.id)]?"selected":""}><input type="checkbox" checked={Boolean(selectedIds[Number(employee.id)])} onChange={()=>toggleEmployee(Number(employee.id))}/><span><b>{rtl?employee.name_ar:employee.name_en}</b><small>{employee.employee_code}{employee.department_name?` · ${rtl?(employee.department_name_ar||employee.department_name):employee.department_name}`:""}</small></span></label>)}</div>
    </div>
    <div className="drawer-footer"><span/><button className="outline" onClick={close}>{rtl?"إلغاء":"Cancel"}</button><button className="primary" disabled={saving} onClick={()=>void submit()}><Check size={16}/>{saving?(rtl?"جارٍ الإنشاء...":"Creating..."):(rtl?"إنشاء الكيان":"Create entity")}</button></div>
  </aside></div>;
}

function OrgDepartmentTreeNode({rtl,department,departments,employees,jobs,tone,depth,normalizedQuery,openDepartment}:{rtl:boolean;department:Record<string,any>;departments:Record<string,any>[];employees:Record<string,any>[];jobs:Record<string,any>[];tone:string;depth:number;normalizedQuery:string;openDepartment:(departmentId:number)=>void}){
  const children=departments.filter(item=>Number(item.parent_id)===Number(department.id));
  const displayLevel=(employee:Record<string,any>)=>Number(employee.organizational_level??1);
  const members=employees.filter(employee=>Number(employee.department_id)===Number(department.id)).sort((a,b)=>displayLevel(a)-displayLevel(b)||String(rtl?a.name_ar:a.name_en).localeCompare(String(rtl?b.name_ar:b.name_en),rtl?"ar":"en"));
  const manager=employees.find(employee=>Number(employee.id)===Number(department.manager_employee_id));
  const jobById=new Map(jobs.map(job=>[Number(job.id),job]));
  const managerJob=manager?jobById.get(Number(manager.job_title_id)):undefined;
  const open=()=>openDepartment(Number(department.id));
  const childMatches=(child:Record<string,any>):boolean=>{const childMembers=employees.filter(employee=>Number(employee.department_id)===Number(child.id));const text=`${child.name_en} ${child.name_ar} ${childMembers.map(member=>`${member.name_en} ${member.name_ar}`).join(" ")}`.toLocaleLowerCase();return !normalizedQuery||text.includes(normalizedQuery)||departments.filter(item=>Number(item.parent_id)===Number(child.id)).some(childMatches);};
  const visibleChildren=children.filter(childMatches);
  const nonManagerMembers=members.filter(member=>Number(member.id)!==Number(manager?.id));
  const visibleMembers=normalizedQuery?nonManagerMembers.filter(member=>`${member.name_en} ${member.name_ar} ${member.job_title_name}`.toLocaleLowerCase().includes(normalizedQuery)):nonManagerMembers;
  return <section className={`org-tree-node depth-${depth} ${tone}`}>
    <div className="org-tree-heading" role="button" tabIndex={0} aria-label={rtl?`عرض موظفي ${department.name_ar}`:`Open ${department.name_en}`} onClick={open} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();open();}}}>
      <div className="org-tree-department"><div><small>{isCompanyOrganizationUnit(department)?(rtl?"شركة":"COMPANY"):depth===0?(rtl?"قطاع رئيسي":"MAIN DIVISION"):(rtl?"قسم تابع":"DEPARTMENT")}</small><h3>{rtl?department.name_ar:department.name_en}</h3>{!rtl&&<p>{department.name_ar}</p>}</div></div>
      {manager&&<div className="org-tree-manager"><small>{organizationManagerLabel(department,rtl,true)}</small><b>{rtl?manager.name_ar:manager.name_en}</b><em>{localizedJobTitle(rtl,managerJob,{name_en:manager.job_title_name,name_ar:manager.job_title_name_ar})}</em></div>}
    </div>
    {visibleMembers.length>0&&<div className="org-tree-employees">{visibleMembers.map(member=>{const job=jobById.get(Number(member.job_title_id));return <div className="org-tree-employee" key={member.id}><b>{rtl?member.name_ar:member.name_en}</b><small>{localizedJobTitle(rtl,job,{name_en:member.job_title_name,name_ar:member.job_title_name_ar})}</small></div>})}</div>}
    {visibleChildren.length>0&&<div className="org-tree-children">{visibleChildren.map(child=><OrgDepartmentTreeNode key={child.id} rtl={rtl} department={child} departments={departments} employees={employees} jobs={jobs} tone={tone} depth={depth+1} normalizedQuery={normalizedQuery} openDepartment={openDepartment}/>)}</div>}
  </section>
}

function DepartmentTeamModal({rtl,department,departments,employees,jobs,data,canEdit,canDelete,close,openDepartment,reload,notify,removeDepartment}:{rtl:boolean;department:Record<string,any>;departments:Record<string,any>[];employees:Record<string,any>[];jobs:Record<string,any>[];data:HRData|null;canEdit:boolean;canDelete:boolean;close:()=>void;openDepartment:(departmentId:number)=>void;reload:()=>Promise<void>;notify:(message:string)=>void;removeDepartment:()=>Promise<void>}){
  const [drafts,setDrafts]=useState<Record<number,number>>({});
  const [saving,setSaving]=useState(false),[deleting,setDeleting]=useState(false),[error,setError]=useState("");
  const [addOpen,setAddOpen]=useState(false);
  const [profile,setProfile]=useState<Record<string,any>|null>(null);
  const originalMemberIds=employees.filter(employee=>Number(employee.department_id)===Number(department.id)).map(employee=>Number(employee.id));
  const [selectedIds,setSelectedIds]=useState<Record<number,boolean>>(()=>Object.fromEntries(originalMemberIds.map(id=>[id,true])));
  const [managerId,setManagerId]=useState(Number(department.manager_employee_id)||0);
  const [parentId,setParentId]=useState(Number(department.parent_id)||0);
  const originalUnitType=isCompanyOrganizationUnit(department)?"company":"department";
  const [unitType,setUnitType]=useState(originalUnitType);
  const managerLabel=organizationManagerLabel({...department,unit_type:unitType},rtl);
  const members=employees.filter(employee=>selectedIds[Number(employee.id)]);
  const availableEmployees=employees.filter(employee=>!selectedIds[Number(employee.id)]);
  const children=departments.filter(item=>Number(item.parent_id)===Number(department.id));
  const excludedParents=new Set<number>([Number(department.id)]);
  const collectDescendants=(id:number)=>departments.filter(item=>Number(item.parent_id)===id).forEach(item=>{const childId=Number(item.id);if(!excludedParents.has(childId)){excludedParents.add(childId);collectDescendants(childId);}});
  collectDescendants(Number(department.id));
  const parentOptions=departments.filter(item=>!excludedParents.has(Number(item.id))&&item.status!=="deleted");
  const jobById=new Map(jobs.map(job=>[Number(job.id),job]));
  const levelOf=(employee:Record<string,any>)=>Number(employee.id)===managerId?0:Math.min(20,Math.max(1,drafts[Number(employee.id)]??(Number(employee.organizational_level)||1)));
  const setLevel=(employeeId:number,level:number)=>setDrafts(current=>({...current,[employeeId]:Math.max(1,Math.min(20,Math.round(level)||1))}));
  const ordered=[...members].sort((a,b)=>levelOf(a)-levelOf(b)||String(rtl?a.name_ar:a.name_en).localeCompare(String(rtl?b.name_ar:b.name_en),rtl?"ar":"en"));
  const membershipDirty=originalMemberIds.length!==members.length||originalMemberIds.some(id=>!selectedIds[id]);
  const dirty=membershipDirty||unitType!==originalUnitType||parentId!==(Number(department.parent_id)||0)||managerId!==(Number(department.manager_employee_id)||0)||members.some(employee=>levelOf(employee)!==Number(employee.organizational_level??1));
  const jobLabel=(employee:Record<string,any>)=>{const job=jobById.get(Number(employee.job_title_id));return localizedJobTitle(rtl,job,{name_en:employee.job_title_name,name_ar:employee.job_title_name_ar});};
  const departmentName=(id:number)=>{const item=departments.find(row=>Number(row.id)===id);return item?(rtl?item.name_ar:item.name_en):"";};
  const addExistingEmployee=(employeeId:number)=>{if(!employeeId)return;setSelectedIds(current=>({...current,[employeeId]:true}));const employee=employees.find(item=>Number(item.id)===employeeId);if(employee)setLevel(employeeId,Math.max(1,Number(employee.organizational_level)||1));};
  const removeEmployee=(employeeId:number)=>{setSelectedIds(current=>({...current,[employeeId]:false}));if(managerId===employeeId)setManagerId(0);};
  const saveStructure=async()=>{try{setSaving(true);setError("");await hrApi({action:"save_department_structure",departmentId:Number(department.id),unitType,parentId:parentId||null,managerEmployeeId:managerId||null,assignments:members.map(employee=>({employeeId:Number(employee.id),level:levelOf(employee)}))});await reload();notify(rtl?(unitType==="company"?"تم حفظ إعداد الشركة والمدير العام والموظفين":"تم حفظ إعداد القسم ومديره والموظفين"):(unitType==="company"?"Company, general manager, and employees saved":"Department, manager, and employees saved"));close();}catch(reason){setError(reason instanceof Error?reason.message:(rtl?"تعذر حفظ إعداد الكيان":"Unable to save organization unit"));}finally{setSaving(false);}};
  const deleteDepartment=async()=>{if(!window.confirm(rtl?`هل تريد حذف قسم «${department.name_ar||department.name_en}»؟ سيتم نقل موظفيه وإداراته التابعة إلى القسم الأعلى.`:`Delete “${department.name_en||department.name_ar}”? Its employees and child departments will move to the parent department.`))return;try{setDeleting(true);setError("");await removeDepartment();}catch(reason){setError(reason instanceof Error?reason.message:(rtl?"تعذر حذف القسم":"Unable to delete department"));setDeleting(false);}};
  return <div className="modal-layer modal-center"><button className="modal-scrim" onClick={close} aria-label={rtl?"إغلاق":"Close"}/><aside className="modal-dialog org-department-modal" role="dialog" aria-modal="true">
    <div className="drawer-head"><div><span className="eyebrow">{canEdit?(rtl?"إعداد القسم":"DEPARTMENT SETUP"):(rtl?"فريق القسم":"DEPARTMENT TEAM")}</span><h2>{rtl?department.name_ar:department.name_en}</h2><p>{canEdit?(rtl?"حدد القسم التابع له، المدير، الموظفين ومستوى كل موظف.":"Choose the parent, manager, people and each employee level."):(rtl?`عرض ${managerLabel} وكل الموظفين التابعين له.`:`View the ${managerLabel.toLocaleLowerCase()} and everyone reporting through this team.`)}</p></div>{canEdit&&<button className="primary" onClick={()=>setAddOpen(true)}><Plus size={16}/>{rtl?"موظف جديد":"New employee"}</button>}<button className="icon-btn" onClick={close} aria-label={rtl?"إغلاق":"Close"}><X size={20}/></button></div>
    <div className="form-body org-team-body">{error&&<div className="error-banner">{error}</div>}
      {canEdit&&<div className="org-department-settings">
        <label><span>{rtl?"نوع الكيان":"Entity type"}</span><select value={unitType} onChange={event=>setUnitType(event.target.value==="company"?"company":"department")}><option value="department">{rtl?"قسم":"Department"}</option><option value="company">{rtl?"شركة":"Company"}</option></select></label>
        <label><span>{rtl?"يتبع قسم":"Parent department"}</span><select value={parentId} onChange={event=>setParentId(Number(event.target.value)||0)}><option value="0">{rtl?"بدون قسم أب (قسم رئيسي)":"No parent (main division)"}</option>{parentOptions.map(item=><option key={item.id} value={item.id}>{rtl?item.name_ar:item.name_en}</option>)}</select></label>
        <label><span>{managerLabel} {rtl?"(اختياري)":"(optional)"}</span><select value={managerId} onChange={event=>setManagerId(Number(event.target.value)||0)}><option value="0">{rtl?"بدون مدير — يتبع القسم الأعلى":"No manager — reports to parent department"}</option>{employees.map(employee=><option key={employee.id} value={employee.id}>{rtl?employee.name_ar:employee.name_en} — {employee.employee_code}{Number(employee.department_id)!==Number(department.id)&&employee.department_name?` (${rtl?(employee.department_name_ar||employee.department_name):employee.department_name})`:""}</option>)}</select></label>
        <label className="org-add-existing"><span>{rtl?"إضافة موظف موجود للقسم":"Add an existing employee"}</span><select value="" onChange={event=>addExistingEmployee(Number(event.target.value))}><option value="">{rtl?"اختر موظفاً لنقله إلى هذا القسم":"Choose an employee to move here"}</option>{availableEmployees.map(employee=><option key={employee.id} value={employee.id}>{rtl?employee.name_ar:employee.name_en} — {employee.employee_code}{employee.department_id?` (${departmentName(Number(employee.department_id))})`:""}</option>)}</select></label>
      </div>}
      <div className="org-team-list-head"><b>{rtl?"موظفو القسم":"Department employees"}</b><span>{formatNumber(members.length,rtl)}</span><small>{rtl?"المستوى ٠ للمدير، وباقي المستويات من ١ إلى ٢٠":"Level 0 is for the manager; others use 1–20"}</small></div>
      {ordered.length?<div className="org-team-rows">{ordered.map(employee=>{const isManager=Number(employee.id)===managerId;const level=levelOf(employee);return <div className={`org-team-row ${isManager?"manager":""}`} key={employee.id}>
        {isManager?<span className="org-team-level manager">{formatNumber(0,rtl)}</span>:canEdit?<input className="org-team-level-input" type="number" min="1" max="20" value={level} aria-label={`${rtl?"مستوى":"Level"} ${rtl?employee.name_ar:employee.name_en}`} onChange={event=>setLevel(Number(employee.id),Number(event.target.value))}/>:<span className="org-team-level">{formatNumber(level,rtl)}</span>}
        <div className="org-team-person"><b>{rtl?employee.name_ar:employee.name_en}</b><small>{jobLabel(employee)}</small></div>
        <span className="org-team-code">{employee.employee_code}</span>
        {isManager?<Status tone="blue">{managerLabel}</Status>:canEdit&&<div className="org-team-move"><button className="plain-icon" disabled={level<=1} aria-label={rtl?"رفع المستوى":"Move up"} onClick={()=>setLevel(Number(employee.id),level-1)}><ChevronUp size={16}/></button><button className="plain-icon" disabled={level>=20} aria-label={rtl?"خفض المستوى":"Move down"} onClick={()=>setLevel(Number(employee.id),level+1)}><ChevronDown size={16}/></button></div>}
        {canEdit&&<button className="plain-icon" aria-label={rtl?`تعديل بيانات ${employee.name_ar}`:`Edit ${employee.name_en}`} onClick={()=>setProfile(employee)}><Pencil size={16}/></button>}
        {canEdit&&<button className="plain-icon org-team-remove" aria-label={rtl?`إزالة ${employee.name_ar} من القسم`:`Remove ${employee.name_en} from department`} onClick={()=>removeEmployee(Number(employee.id))}><X size={16}/></button>}
      </div>})}</div>:<Empty icon={Users} title={rtl?"لا يوجد موظفون في هذه الإدارة":"No people in this department"} text={rtl?"أضف أول موظف لهذه الإدارة من زر الإضافة بالأعلى.":"Add the first employee from the button above."}/>}
      {children.length>0&&<div className="org-team-children"><small>{rtl?"إدارات تابعة":"Sub-departments"}</small><div>{children.map(child=><button key={child.id} onClick={()=>openDepartment(Number(child.id))}><Building2 size={14}/>{rtl?child.name_ar:child.name_en}<em>{formatNumber(employees.filter(employee=>Number(employee.department_id)===Number(child.id)).length,rtl)}</em></button>)}</div></div>}
    </div>
    <div className="drawer-footer"><span className="org-team-note">{managerId?(rtl?"المدير المحدد هو المسؤول المباشر عن القسم.":"The selected manager owns this department."):(parentId?(rtl?"القسم تحت إشراف مدير القسم الأعلى.":"The parent department manager supervises this department."):(rtl?"قسم رئيسي بدون مدير محدد.":"Top-level department without an assigned manager."))}</span>{canDelete&&Boolean(parentId)&&<button className="danger-action org-delete-department" disabled={saving||deleting} onClick={()=>void deleteDepartment()}><Trash2 size={16}/>{deleting?(rtl?"جارٍ الحذف...":"Deleting..."):(rtl?"حذف القسم":"Delete department")}</button>}<button className="outline" onClick={close}>{canEdit?(rtl?"إلغاء":"Cancel"):(rtl?"إغلاق":"Close")}</button>{canEdit&&<button className="primary" disabled={!dirty||saving||deleting} onClick={()=>void saveStructure()}><Check size={16}/>{saving?(rtl?"جارٍ الحفظ...":"Saving..."):(rtl?"حفظ إعداد القسم":"Save department setup")}</button>}</div>
    {addOpen&&<EmployeeDrawer rtl={rtl} data={data} initial={{departmentId:String(department.id)}} close={()=>setAddOpen(false)} submit={async form=>{const created=await hrApi({action:"create_employee",...form});const createdId=Number(created?.id)||0;if(createdId){setSelectedIds(current=>({...current,[createdId]:true}));setLevel(createdId,1);}setAddOpen(false);await reload();notify(rtl?"تمت إضافة الموظف إلى الإدارة":"Employee added to the department");}}/>}
    {profile&&<EmployeeDetailsDrawer rtl={rtl} employee={profile} startInEdit data={data} close={()=>setProfile(null)} submit={async form=>{await hrApi({action:"update_employee",...form});await reload();setProfile(null);notify(rtl?"تم تحديث بيانات الموظف":"Employee details updated");}}/>}
  </aside></div>;
}

function UsersPage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){
  const [tab,setTab]=useState("users"),[employeeId,setEmployeeId]=useState(""),[newRoleId,setNewRoleId]=useState(""),[creating,setCreating]=useState(false);
  const {data,error,reload}=useHRData(rtl),filter=useRowFilter(),currentRole=String(data?.currentUser?.role_name||""),isSuper=currentRole==="Super Admin";
  const shownUsers=(data?.users??[]).filter(row=>matchesQuery(row,["email","employee_name","role_name","department_name","status"],filter.needle));
  const accountEmployeeIds=new Set((data?.users??[]).map(row=>Number(row.employee_id)).filter(Boolean));
  const candidates=(data?.employees??[]).filter(row=>row.work_email&&!accountEmployeeIds.has(Number(row.id))&&["active","probation","notice_period"].includes(String(row.employment_status)));
  const roles=(data?.roles??[]).filter(role=>isSuper||(Number(role.is_system)===1&&["Department Manager","Employee"].includes(String(role.name)))),defaultRoleId=String(roles.find(role=>role.name==="Employee")?.id||roles[0]?.id||""),selectedRoleId=newRoleId||defaultRoleId;
  const create=async()=>{if(!employeeId||!selectedRoleId)return;try{setCreating(true);await hrApi({action:"create_user",employeeId:Number(employeeId),roleId:Number(selectedRoleId)});setEmployeeId("");setNewRoleId("");await reload();notify(rtl?"تم إنشاء الحساب. كلمة المرور الافتراضية 123456":"Account created. The default password is 123456");}catch(reason){notify(reason instanceof Error?reason.message:(rtl?"تعذر إنشاء الحساب":"Unable to create account"));}finally{setCreating(false);}};
  return <><PageHeader eyebrow={rtl?"إدارة الوصول":"ACCESS CONTROL"} title={rtl?"المستخدمون والصلاحيات":"Users & permissions"} text={rtl?"أنشئ حسابات الدخول وحدد الأدوار وأعد كلمات المرور من مكان واحد.":"Create login accounts, assign roles, and reset passwords in one place."}/>{error&&<div className="error-banner">{error}</div>}{isSuper&&<Tabs items={[{id:"users",label:rtl?"المستخدمون":"Users"},{id:"roles",label:rtl?"الأدوار والصلاحيات":"Roles & permissions"}]} active={tab} setActive={setTab}/>} {tab==="users"?<><section className="panel user-account-create"><div><b>{rtl?"إنشاء حساب لموظف":"Create an employee account"}</b><small>{rtl?"يظهر هنا الموظفون الذين لديهم بريد وظيفي وليس لديهم حساب دخول.":"Employees with a work email and no login account appear here."}</small></div><label><span>{rtl?"الموظف":"Employee"}</span><select value={employeeId} onChange={event=>setEmployeeId(event.target.value)}><option value="">{rtl?"اختر موظفاً":"Select an employee"}</option>{candidates.map(row=><option key={row.id} value={row.id}>{rtl?(row.name_ar||row.name_en):row.name_en} — {row.work_email}</option>)}</select></label><label><span>{rtl?"الدور الوظيفي":"Access role"}</span><select value={selectedRoleId} onChange={event=>setNewRoleId(event.target.value)}>{roles.map(role=><option key={role.id} value={role.id}>{roleLabel(role,rtl)}</option>)}</select></label><button className="primary" disabled={!employeeId||!selectedRoleId||creating} onClick={()=>void create()}><Plus size={16}/>{creating?(rtl?"جارٍ الإنشاء...":"Creating..."):(rtl?"إنشاء الحساب":"Create account")}</button><em>{rtl?"كلمة المرور الافتراضية: 123456 — سيُطلب تغييرها عند أول دخول":"Default password: 123456 — change is required on first login"}</em></section><div className="panel table-panel"><FilterBar rtl={rtl} query={filter.query} setQuery={filter.setQuery} count={shownUsers.length} placeholder={rtl?"ابحث بالبريد أو الاسم أو الدور...":"Search by email, name or role..."}/><UserAccessTable rtl={rtl} rows={shownUsers} roles={roles} currentRole={currentRole} reload={reload} notify={notify}/></div></>:isSuper?<PermissionEditor rtl={rtl} notify={notify} data={data} reload={reload}/>:null}</>;
}

function UserAccessTable({rtl,rows,roles,currentRole,reload,notify}:{rtl:boolean;rows:Record<string,any>[];roles:Record<string,any>[];currentRole:string;reload:()=>Promise<void>;notify:(message:string)=>void}){
  // تسمية البحث القديمة لهذا الإجراء: ريست إلى 123456.
  const save=async(row:Record<string,any>,changes:Record<string,unknown>)=>{try{await hrApi({action:"save_user",userId:row.id,roleId:changes.roleId??row.role_id,status:changes.status??row.status,...changes});await reload();notify(rtl?"تم تحديث صلاحيات الحساب":"User access updated");}catch(reason){notify(reason instanceof Error?reason.message:(rtl?"تعذر تحديث الحساب":"Unable to update user"));}};
  const reset=async(row:Record<string,any>)=>{if(!window.confirm(rtl?"إعادة كلمة المرور إلى 123456؟ سيُطلب من المستخدم تغييرها عند الدخول.":"Reset the password to 123456? The user must change it at sign-in."))return;try{await hrApi({action:"save_user",userId:row.id,roleId:row.role_id,status:row.status,temporaryPassword:"123456"});await reload();notify(rtl?"تمت إعادة كلمة المرور إلى 123456":"Password reset to 123456");}catch(reason){notify(reason instanceof Error?reason.message:(rtl?"تعذر إعادة كلمة المرور":"Unable to reset password"));}};
  if(!rows.length)return <Empty icon={ShieldCheck} title={rtl?"لا توجد حسابات دخول":"No login accounts"} text={rtl?"أنشئ حساباً لموظف لديه بريد وظيفي من النموذج بالأعلى.":"Create an account for an employee with a work email above."}/>;
  return <div className="data-table user-access-table"><div className="tr th"><span>{rtl?"المستخدم":"User"}</span><span>{rtl?"القسم":"Department"}</span><span>{rtl?"الدور الوظيفي":"Access role"}</span><span>{rtl?"الحالة":"Status"}</span><span>{rtl?"كلمة المرور":"Password"}</span></div>{rows.map((row,index)=>{const protectedAccount=currentRole!=="Super Admin"&&["Super Admin","HR Manager"].includes(String(row.role_name));return <div className="tr" key={row.id}><span className="person"><Avatar initials={personInitials(row.employee_name||row.email)} small tone={["blue","violet","green","amber"][index%4]}/><span><b>{rtl?(row.employee_name_ar||row.employee_name||row.email):(row.employee_name||row.email)}</b><small dir="ltr">{row.email}</small></span></span><span>{rtl?(row.department_name_ar||row.department_name||"—"):(row.department_name||"—")}</span><span><select value={row.role_id} disabled={protectedAccount} onChange={event=>void save(row,{roleId:Number(event.target.value)})}>{protectedAccount&&!roles.some(role=>Number(role.id)===Number(row.role_id))&&<option value={row.role_id}>{roleLabel(row,rtl)}</option>}{roles.map(role=><option value={role.id} key={role.id}>{roleLabel(role,rtl)}</option>)}</select></span><span><select value={row.status} disabled={protectedAccount} onChange={event=>void save(row,{status:event.target.value})}><option value="active">{rtl?"نشط":"Active"}</option><option value="disabled">{rtl?"موقوف":"Disabled"}</option></select></span><span><button className="outline" disabled={protectedAccount} onClick={()=>void reset(row)}><KeyRound size={15}/>{rtl?"إعادة إلى 123456":"Reset to 123456"}</button></span></div>})}</div>;
}

function PayrollPage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){
  const [tab,setTab]=useState("runs");
  const [runDrawerOpen,setRunDrawerOpen]=useState(false);
  const [structureDrawerOpen,setStructureDrawerOpen]=useState(false);
  const [loanDrawerOpen,setLoanDrawerOpen]=useState(false);
  const [taxEditor,setTaxEditor]=useState<Record<string,any>|null|undefined>(undefined);
  const [insuranceEditor,setInsuranceEditor]=useState<Record<string,any>|null|undefined>(undefined);
  const [bankExportOpen,setBankExportOpen]=useState(false);
  const [selectedRun,setSelectedRun]=useState<Record<string,any>|null>(null);
  const {data,error,reload}=useHRData(rtl);
  const canManage=Boolean(data?.canManagePayroll);
  const hasPermission=(action:string)=>data?.currentUser?.role_name==="Super Admin"||(data?.permissions??[]).some(p=>Number(p.role_id)===Number(data?.currentUser?.role_id)&&p.module==="payroll"&&p.action===action&&Number(p.allowed)===1);
  const canApprove=hasPermission("approve"), canLock=hasPermission("lock"), canReopen=hasPermission("reopen");
  const runs=(data?.payrollRuns??[]).slice().sort((a,b)=>Number(b.year)-Number(a.year)||Number(b.month)-Number(a.month));
  const employees=(data?.employees??[]).filter(e=>e.employment_status!=="deleted");
  const bankLayout=parseSetting(data?.settings?.find(s=>s.setting_key==="payroll_bank_export")) as {columns?:{field:string;header:string}[]};

  const action=tab==="runs"?<button className="primary" onClick={()=>setRunDrawerOpen(true)}><Plus size={16}/>{rtl?"دورة رواتب جديدة":"New payroll run"}</button>
    :tab==="structures"?<button className="primary" onClick={()=>setStructureDrawerOpen(true)}><Plus size={16}/>{rtl?"إضافة هيكل راتب":"Add salary structure"}</button>
    :tab==="loans"?<button className="primary" onClick={()=>setLoanDrawerOpen(true)}><Plus size={16}/>{rtl?"إضافة سلفة":"Add loan"}</button>
    :undefined;

  return <>
    <PageHeader eyebrow={rtl?"الرواتب والمزايا":"PAYROLL & BENEFITS"} title={rtl?"إدارة الرواتب":"Payroll"} text={rtl?"دورات الرواتب وهياكل الأجور والسلف والضرائب والتأمينات.":"Payroll runs, salary structures, loans, tax and insurance rates."} action={action}/>
    {error&&<div className="error-banner">{error}<button onClick={()=>void reload()}>{rtl?"إعادة المحاولة":"Retry"}</button></div>}
    {!canManage&&<div className="error-banner info">{rtl?"لا تملك صلاحية إدارة الرواتب. يمكنك الاطلاع على قسائم راتبك من بوابة الموظف.":"You don't have payroll management access. View your own payslips from the employee portal."}</div>}
    <Tabs items={[{id:"runs",label:rtl?"دورات الرواتب":"Payroll runs"},{id:"structures",label:rtl?"هياكل الرواتب":"Salary structures"},{id:"loans",label:rtl?"السلف والقروض":"Loans & advances"},{id:"config",label:rtl?"الضرائب والتأمينات":"Tax & insurance"}]} active={tab} setActive={setTab}/>
    {tab==="runs"&&<PayrollRunsTable rtl={rtl} runs={runs} items={data?.payrollItems??[]} onOpen={setSelectedRun}/>}
    {tab==="structures"&&<SalaryStructuresTable rtl={rtl} rows={data?.salaryStructures??[]} allowances={data?.salaryAllowances??[]}/>}
    {tab==="loans"&&<LoansTable rtl={rtl} rows={data?.loansAdvances??[]}/>}
    {tab==="config"&&<TaxInsurancePanel rtl={rtl} brackets={data?.taxBrackets??[]} rates={data?.insuranceRates??[]} onEditBracket={setTaxEditor} onEditRate={setInsuranceEditor} onConfigureExport={()=>setBankExportOpen(true)}/>}

    {runDrawerOpen&&<PayrollRunDrawer rtl={rtl} close={()=>setRunDrawerOpen(false)} submit={async form=>{await hrApi({action:"create_payroll_run",...form});setRunDrawerOpen(false);await reload();notify(rtl?"تم إنشاء دورة الرواتب":"Payroll run created");}}/>}
    {structureDrawerOpen&&<SalaryStructureDrawer rtl={rtl} employees={employees} close={()=>setStructureDrawerOpen(false)} submit={async form=>{await hrApi({action:"save_salary_structure",...form});setStructureDrawerOpen(false);await reload();notify(rtl?"تم حفظ هيكل الراتب":"Salary structure saved");}}/>}
    {loanDrawerOpen&&<LoanDrawer rtl={rtl} employees={employees} close={()=>setLoanDrawerOpen(false)} submit={async form=>{await hrApi({action:"save_loan",...form});setLoanDrawerOpen(false);await reload();notify(rtl?"تم حفظ السلفة":"Loan saved");}}/>}
    {taxEditor!==undefined&&<TaxBracketDrawer rtl={rtl} record={taxEditor||undefined} close={()=>setTaxEditor(undefined)} submit={async form=>{await hrApi({action:"save_tax_bracket",...form});setTaxEditor(undefined);await reload();notify(rtl?"تم حفظ الشريحة الضريبية":"Tax bracket saved");}}/>}
    {insuranceEditor!==undefined&&<InsuranceRateDrawer rtl={rtl} record={insuranceEditor||undefined} close={()=>setInsuranceEditor(undefined)} submit={async form=>{await hrApi({action:"save_insurance_rate",...form});setInsuranceEditor(undefined);await reload();notify(rtl?"تم حفظ نسبة التأمين":"Insurance rate saved");}}/>}
    {bankExportOpen&&<BankExportLayoutDrawer rtl={rtl} initialColumns={bankLayout.columns??[]} close={()=>setBankExportOpen(false)} submit={async columns=>{await hrApi({action:"save_system_settings",settingKey:"payroll_bank_export",values:{columns}});setBankExportOpen(false);await reload();notify(rtl?"تم حفظ إعدادات التصدير":"Export layout saved");}}/>}
    {selectedRun&&<PayrollRunDetail rtl={rtl} run={runs.find(r=>Number(r.id)===Number(selectedRun.id))||selectedRun} items={(data?.payrollItems??[]).filter(item=>Number(item.payroll_run_id)===Number(selectedRun.id))} allowanceLines={data?.payrollAllowanceLines??[]} canApprove={canApprove} canLock={canLock} canReopen={canReopen} close={()=>setSelectedRun(null)} reload={reload} notify={notify}/>}
  </>;
}

function PayrollRunsTable({rtl,runs,items,onOpen}:{rtl:boolean;runs:Record<string,any>[];items:Record<string,any>[];onOpen:(run:Record<string,any>)=>void}){
  if(!runs.length) return <div className="panel table-panel"><Empty icon={Wallet} title={rtl?"لا توجد دورات رواتب":"No payroll runs"} text={rtl?"أنشئ أول دورة رواتب للبدء.":"Create the first payroll run to get started."}/></div>;
  return <div className="panel table-panel"><div className="data-table payroll-runs-table"><div className="tr th"><span>{rtl?"الشهر":"Month"}</span><span>{rtl?"الدولة":"Country"}</span><span>{rtl?"عدد الموظفين":"Employees"}</span><span>{rtl?"صافي الإجمالي":"Total net"}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{runs.map(run=>{const runItems=items.filter(item=>Number(item.payroll_run_id)===Number(run.id));const totalNet=runItems.reduce((sum,item)=>sum+(Number(item.net_salary)||0),0);return <div className="tr" key={run.id}><span><b>{new Intl.DateTimeFormat(rtl?"ar-SA-u-nu-arab":"en-GB",{month:"long",year:"numeric"}).format(new Date(Number(run.year),Number(run.month)-1,1))}</b></span><span>{localizedCountry(run.country,rtl)}</span><span>{formatNumber(runItems.length,rtl)}</span><span>{new Intl.NumberFormat(localeFor(rtl),{style:"currency",currency:run.country==="Egypt"?"EGP":"SAR",maximumFractionDigits:0}).format(totalNet)}</span><span><Status tone={payrollStatusTone(run.status)}>{payrollStatusLabel(run.status,rtl)}</Status></span><span><button className="plain-icon" onClick={()=>onOpen(run)} aria-label={rtl?"فتح الدورة":"Open run"}><ChevronRight size={20}/></button></span></div>;})}</div></div>;
}

function SalaryStructuresTable({rtl,rows,allowances}:{rtl:boolean;rows:Record<string,any>[];allowances:Record<string,any>[]}){
  const sorted=rows.slice().sort((a,b)=>String(b.effective_from).localeCompare(String(a.effective_from)));
  if(!sorted.length) return <div className="panel table-panel"><Empty icon={Wallet} title={rtl?"لا توجد هياكل رواتب":"No salary structures"} text={rtl?"أضف أول هيكل راتب لموظف لبدء احتساب الرواتب.":"Add the first employee salary structure to enable payroll calculation."}/></div>;
  return <div className="panel table-panel"><div className="data-table salary-structures-table"><div className="tr th"><span>{rtl?"الموظف":"Employee"}</span><span>{rtl?"الراتب الأساسي":"Basic salary"}</span><span>{rtl?"البدلات":"Allowances"}</span><span>{rtl?"سريان من":"Effective from"}</span><span>{rtl?"حتى":"Until"}</span><span>{rtl?"الحالة":"Status"}</span></div>{sorted.map(row=>{const lines=allowances.filter(a=>Number(a.salary_structure_id)===Number(row.id));return <div className="tr" key={row.id}><span className="person"><Avatar initials={personInitials(row.employee_name)} small tone="blue"/><span><b>{rtl?(row.employee_name_ar||row.employee_name):row.employee_name}</b><small>{row.employee_code}</small></span></span><span>{new Intl.NumberFormat(localeFor(rtl),{style:"currency",currency:row.currency||"SAR",maximumFractionDigits:0}).format(Number(row.basic_salary)||0)}</span><span>{lines.length?lines.map(l=>l.type).join(", "):"—"}</span><span>{formatDate(row.effective_from,rtl)}</span><span>{row.effective_to?formatDate(row.effective_to,rtl):(rtl?"مستمر":"Ongoing")}</span><span><Status tone={row.effective_to?"gray":"green"}>{row.effective_to?(rtl?"سابق":"Historical"):(rtl?"الحالي":"Current")}</Status></span></div>;})}</div></div>;
}

function LoansTable({rtl,rows}:{rtl:boolean;rows:Record<string,any>[]}){
  if(!rows.length) return <div className="panel table-panel"><Empty icon={Wallet} title={rtl?"لا توجد سلف":"No loans"} text={rtl?"لم تتم إضافة أي سلف أو قروض حتى الآن.":"No loans or advances have been added yet."}/></div>;
  return <div className="panel table-panel"><div className="data-table loans-table"><div className="tr th"><span>{rtl?"الموظف":"Employee"}</span><span>{rtl?"إجمالي المبلغ":"Total amount"}</span><span>{rtl?"المتبقي":"Remaining"}</span><span>{rtl?"القسط الشهري":"Monthly installment"}</span><span>{rtl?"الحالة":"Status"}</span></div>{rows.map(row=>{const total=Number(row.total_amount)||0;const remaining=Number(row.remaining_amount)||0;const progress=total>0?Math.round(((total-remaining)/total)*100):0;return <div className="tr" key={row.id}><span className="person"><Avatar initials={personInitials(row.employee_name)} small tone="violet"/><span><b>{rtl?(row.employee_name_ar||row.employee_name):row.employee_name}</b><small>{row.employee_code}</small></span></span><span>{formatNumber(total,rtl)}</span><span><div className="loan-progress"><div className="loan-progress-bar"><span style={{width:`${progress}%`}}/></div><small>{formatNumber(remaining,rtl)} {rtl?"متبقٍ":"remaining"}</small></div></span><span>{formatNumber(Number(row.monthly_installment)||0,rtl)}</span><span><Status tone={row.status==="paid_off"?"blue":"green"}>{row.status==="paid_off"?(rtl?"مسدد بالكامل":"Paid off"):(rtl?"نشطة":"Active")}</Status></span></div>;})}</div></div>;
}

function TaxInsurancePanel({rtl,brackets,rates,onEditBracket,onEditRate,onConfigureExport}:{rtl:boolean;brackets:Record<string,any>[];rates:Record<string,any>[];onEditBracket:(record:Record<string,any>|null)=>void;onEditRate:(record:Record<string,any>|null)=>void;onConfigureExport:()=>void}){
  const sortedBrackets=brackets.slice().sort((a,b)=>String(b.country).localeCompare(String(a.country))||String(b.effective_from).localeCompare(String(a.effective_from))||Number(a.min_amount)-Number(b.min_amount));
  const sortedRates=rates.slice().sort((a,b)=>String(b.effective_from).localeCompare(String(a.effective_from)));
  return <>
    <section className="panel tax-panel">
      <header><div><span className="eyebrow">{rtl?"الضريبة":"TAX"}</span><h2>{rtl?"الشرائح الضريبية":"Tax brackets"}</h2><p>{rtl?"تُطبَّق تصاعدياً على الدخل الخاضع للضريبة لكل دولة.":"Applied progressively to taxable income, per country."}</p></div><button className="primary" onClick={()=>onEditBracket(null)}><Plus size={16}/>{rtl?"إضافة شريحة":"Add bracket"}</button></header>
      {sortedBrackets.length?<table><thead><tr><th>{rtl?"الدولة":"Country"}</th><th>{rtl?"من":"From"}</th><th>{rtl?"إلى":"To"}</th><th>{rtl?"النسبة":"Rate"}</th><th>{rtl?"سريان من":"Effective from"}</th><th></th></tr></thead><tbody>{sortedBrackets.map(row=><tr key={row.id}><td>{localizedCountry(row.country,rtl)}</td><td>{formatNumber(Number(row.min_amount)||0,rtl)}</td><td>{row.max_amount==null?(rtl?"بلا حد":"No limit"):formatNumber(Number(row.max_amount),rtl)}</td><td>%{formatNumber(Number(row.rate)||0,rtl)}</td><td>{formatDate(row.effective_from,rtl)}</td><td><button className="plain-icon" onClick={()=>onEditBracket(row)} aria-label={rtl?"تعديل":"Edit"}><Pencil size={16}/></button></td></tr>)}</tbody></table>:<Empty title={rtl?"لا توجد شرائح ضريبية":"No tax brackets"} text={rtl?"أضف الشرائح الضريبية لكل دولة لاحتساب الضريبة تلقائياً.":"Add per-country tax brackets to calculate tax automatically."}/>}
    </section>
    <section className="panel tax-panel">
      <header><div><span className="eyebrow">{rtl?"التأمينات":"INSURANCE"}</span><h2>{rtl?"نسب التأمينات الاجتماعية":"Social insurance rates"}</h2><p>{rtl?"نسبة الموظف تُخصم من الراتب، ونسبة صاحب العمل للمرجعية.":"Employee share is deducted from salary; employer share is for reference."}</p></div><button className="primary" onClick={()=>onEditRate(null)}><Plus size={16}/>{rtl?"إضافة نسبة":"Add rate"}</button></header>
      {sortedRates.length?<table><thead><tr><th>{rtl?"الدولة":"Country"}</th><th>{rtl?"نسبة الموظف":"Employee rate"}</th><th>{rtl?"نسبة صاحب العمل":"Employer rate"}</th><th>{rtl?"سريان من":"Effective from"}</th><th></th></tr></thead><tbody>{sortedRates.map(row=><tr key={row.id}><td>{localizedCountry(row.country,rtl)}</td><td>%{formatNumber(Number(row.employee_rate)||0,rtl)}</td><td>%{formatNumber(Number(row.employer_rate)||0,rtl)}</td><td>{formatDate(row.effective_from,rtl)}</td><td><button className="plain-icon" onClick={()=>onEditRate(row)} aria-label={rtl?"تعديل":"Edit"}><Pencil size={16}/></button></td></tr>)}</tbody></table>:<Empty title={rtl?"لا توجد نسب تأمين":"No insurance rates"} text={rtl?"أضف نسب التأمينات لكل دولة لاحتساب الخصم تلقائياً.":"Add per-country insurance rates to calculate the deduction automatically."}/>}
    </section>
    <section className="panel tax-panel export-config"><div><span className="eyebrow">{rtl?"تصدير":"EXPORT"}</span><h2>{rtl?"تنسيق ملف التحويل البنكي":"Bank transfer file layout"}</h2><p>{rtl?"حدد الأعمدة وعناوينها حسب متطلبات البنك.":"Choose the columns and headers your bank requires."}</p></div><button className="outline" onClick={onConfigureExport}><SlidersHorizontal size={16}/>{rtl?"إعداد الأعمدة":"Configure columns"}</button></section>
  </>;
}

function PayrollRunDetail({rtl,run,items,allowanceLines,canApprove,canLock,canReopen,close,reload,notify}:{rtl:boolean;run:Record<string,any>;items:Record<string,any>[];allowanceLines:Record<string,any>[];canApprove:boolean;canLock:boolean;canReopen:boolean;close:()=>void;reload:()=>Promise<void>;notify:(s:string)=>void}){
  const [busy,setBusy]=useState(false);
  const [payslipItem,setPayslipItem]=useState<Record<string,any>|null>(null);
  const monthLabel=new Intl.DateTimeFormat(rtl?"ar-SA-u-nu-arab":"en-GB",{month:"long",year:"numeric"}).format(new Date(Number(run.year),Number(run.month)-1,1));
  const currency=run.country==="Egypt"?"EGP":"SAR";
  const money=(value:number)=>new Intl.NumberFormat(localeFor(rtl),{style:"currency",currency,maximumFractionDigits:2}).format(value||0);
  const totalNet=items.reduce((sum,item)=>sum+(Number(item.net_salary)||0),0);

  const runAction=async(actionName:string,extra:Record<string,unknown>={},successMessage?:string)=>{
    try{setBusy(true);await hrApi({action:actionName,payrollRunId:run.id,...extra});await reload();notify(successMessage||(rtl?"تم تنفيذ الإجراء بنجاح":"Action completed"));}
    catch(e){notify(e instanceof Error?e.message:(rtl?"تعذر تنفيذ الإجراء":"Action failed"));}
    finally{setBusy(false);}
  };

  const exportCsv=async(kind:"bank"|"accounting")=>{
    try{
      setBusy(true);
      if(kind==="bank"){
        const result=await hrApi({action:"export_bank_file",payrollRunId:run.id});
        downloadCsv(`bank-transfer-${run.year}-${String(run.month).padStart(2,"0")}.csv`,result.columns,result.rows);
      } else {
        const result=await hrApi({action:"export_accounting_summary",payrollRunId:run.id});
        const totals=result.totals||{};
        const rows=[
          {label:rtl?"الراتب الأساسي":"Basic salary",amount:totals.basic_salary},
          {label:rtl?"إجمالي البدلات":"Total allowances",amount:totals.total_allowances},
          {label:rtl?"العمل الإضافي":"Overtime",amount:totals.overtime_amount},
          {label:rtl?"خصم الغياب":"Absence deduction",amount:totals.absence_deduction},
          {label:rtl?"خصم الإجازة بدون راتب":"Unpaid leave deduction",amount:totals.unpaid_leave_deduction},
          {label:rtl?"خصم السلف":"Loan deduction",amount:totals.loan_deduction},
          {label:rtl?"خصم التأمينات":"Insurance deduction",amount:totals.insurance_deduction},
          {label:rtl?"خصم الضريبة":"Tax deduction",amount:totals.tax_deduction},
          ...(result.allowancesByType||[]).map((t:Record<string,any>)=>({label:`${rtl?"بدل":"Allowance"} — ${t.type}`,amount:t.amount})),
          {label:rtl?"صافي الرواتب":"Net salary",amount:totals.net_salary},
        ];
        downloadCsv(`accounting-summary-${run.year}-${String(run.month).padStart(2,"0")}.csv`,[{field:"label",header:rtl?"البند":"Line item"},{field:"amount",header:rtl?"المبلغ":"Amount"}],rows);
      }
    } catch(e){notify(e instanceof Error?e.message:(rtl?"تعذر تصدير الملف":"Unable to export the file"));}
    finally{setBusy(false);}
  };

  const canExport=(run.status==="approved"||run.status==="locked")&&canApprove;

  return <div className="modal-layer"><button className="modal-scrim print-hide" onClick={close} aria-label={rtl?"إغلاق":"Close"}/><aside className="drawer payroll-run-detail-drawer" role="dialog" aria-modal="true">
    <header className="print-hide"><div><span className="eyebrow">{rtl?"دورة رواتب":"PAYROLL RUN"}</span><h2>{monthLabel} · {localizedCountry(run.country,rtl)}</h2><p>{rtl?`${formatNumber(items.length,rtl)} موظف · صافي إجمالي ${money(totalNet)}`:`${items.length} employees · total net ${money(totalNet)}`}</p></div><button className="icon-button" onClick={close} aria-label={rtl?"إغلاق":"Close"}><X size={20}/></button></header>

    <div className="payroll-run-actions print-hide">
      <Status tone={payrollStatusTone(run.status)}>{payrollStatusLabel(run.status,rtl)}</Status>
      {run.status==="draft"&&<button className="outline" disabled={busy} onClick={()=>void runAction("calculate_payroll_run",{},rtl?"تم احتساب الرواتب":"Payroll calculated")}><SlidersHorizontal size={16}/>{rtl?"احتساب / إعادة احتساب":"Calculate / Recalculate"}</button>}
      {run.status==="draft"&&<button className="primary" disabled={busy||!items.length} onClick={()=>void runAction("submit_payroll_run",{},rtl?"تم إرسال الدورة للاعتماد":"Submitted for approval")}><Send size={16}/>{rtl?"إرسال للاعتماد":"Submit for approval"}</button>}
      {run.status==="pending_hr"&&canApprove&&<button className="primary" disabled={busy} onClick={()=>void runAction("approve_payroll_run",{},rtl?"تم اعتماد الدورة":"Run approved")}><Check size={16}/>{rtl?"اعتماد":"Approve"}</button>}
      {run.status==="approved"&&canLock&&<button className="primary" disabled={busy} onClick={()=>void runAction("lock_payroll_run",{},rtl?"تم قفل الدورة":"Run locked")}><Lock size={16}/>{rtl?"قفل":"Lock"}</button>}
      {run.status==="locked"&&canReopen&&<button className="outline" disabled={busy} onClick={()=>{const reason=window.prompt(rtl?"اكتب سبب إعادة الفتح":"Reason for reopening");if(reason)void runAction("reopen_payroll_run",{reason},rtl?"تم إعادة فتح الدورة":"Run reopened");}}><Unlock size={16}/>{rtl?"إعادة فتح":"Reopen"}</button>}
      {canExport&&<><button className="outline" disabled={busy} onClick={()=>void exportCsv("bank")}><Download size={16}/>{rtl?"ملف التحويل البنكي":"Bank transfer file"}</button><button className="outline" disabled={busy} onClick={()=>void exportCsv("accounting")}><Download size={16}/>{rtl?"ملخص محاسبي":"Accounting summary"}</button></>}
    </div>

    <div className="payroll-items-scroll">
      {items.length?<div className="data-table payroll-items-table"><div className="tr th"><span>{rtl?"الموظف":"Employee"}</span><span>{rtl?"الأساسي":"Basic"}</span><span>{rtl?"البدلات":"Allowances"}</span><span>{rtl?"إضافي":"Overtime"}</span><span>{rtl?"غياب":"Absence"}</span><span>{rtl?"بدون راتب":"Unpaid"}</span><span>{rtl?"سلف":"Loan"}</span><span>{rtl?"تأمين":"Insurance"}</span><span>{rtl?"ضريبة":"Tax"}</span><span>{rtl?"الصافي":"Net"}</span><span></span></div>
      {items.map(item=><div className="tr" key={item.id}><span className="person"><Avatar initials={personInitials(item.employee_name)} small tone="blue"/><span><b>{rtl?(item.employee_name_ar||item.employee_name):item.employee_name}</b><small>{item.employee_code}</small></span></span><span>{money(Number(item.basic_salary))}</span><span>{money(Number(item.total_allowances))}</span><span>{money(Number(item.overtime_amount))}</span><span className="negative">{money(Number(item.absence_deduction))}</span><span className="negative">{money(Number(item.unpaid_leave_deduction))}</span><span className="negative">{money(Number(item.loan_deduction))}</span><span className="negative">{money(Number(item.insurance_deduction))}</span><span className="negative">{money(Number(item.tax_deduction))}</span><span><b>{money(Number(item.net_salary))}</b></span><span><button className="plain-icon" onClick={()=>setPayslipItem({...item,currency})} aria-label={rtl?"عرض القسيمة":"View payslip"}><FileText size={18}/></button></span></div>)}
      </div>:<Empty icon={Wallet} title={rtl?"لم يتم الاحتساب بعد":"Not calculated yet"} text={rtl?"استخدم زر الاحتساب أعلاه لبناء بيانات الرواتب.":"Use the Calculate button above to build the payroll data."}/>}
    </div>
  </aside>
  {payslipItem&&<div className="modal-layer"><button className="modal-scrim print-hide" onClick={()=>setPayslipItem(null)} aria-label={rtl?"إغلاق":"Close"}/><aside className="drawer payslip-drawer"><button className="icon-btn print-hide payslip-close" onClick={()=>setPayslipItem(null)} aria-label={rtl?"إغلاق":"Close"}><X size={20}/></button><PayslipCard rtl={rtl} item={payslipItem} allowanceLines={allowanceLines.filter(line=>Number(line.payroll_item_id)===Number(payslipItem.id))}/></aside></div>}
  </div>;
}

function SettingsPage({rtl,notify}:{rtl:boolean;notify:(s:string)=>void}){
  const [selected,setSelected]=useState<{key:string;t:string;d:string}|null>(null),[demoSaving,setDemoSaving]=useState(false);const {data,error,reload}=useHRData(rtl);
  const items=rtl?[{key:"company",i:Building2,t:"بيانات المنشأة",d:"الكيانات القانونية وقطاعات الأعمال والفروع"},{key:"schedules",i:Clock3,t:"الجداول والورديات",d:"أيام العمل وفترات السماح وأنماط الورديات"},{key:"attendance",i:Activity,t:"سياسات الحضور",d:"العمل الإضافي والتأخير وطلبات التصحيح"},{key:"leave",i:CalendarDays,t:"سياسات الإجازات",d:"الاستحقاقات وترحيل الرصيد ومسارات الاعتماد"},{key:"approvals",i:CheckCircle2,t:"مسارات الاعتماد",d:"تحديد مراحل الاعتماد حسب نوع الطلب"},{key:"notifications",i:Bell,t:"الإشعارات",d:"القنوات والقوالب والفئات المستهدفة"},{key:"locale",i:Globe2,t:"اللغات والمناطق",d:"العربية والإنجليزية والمناطق الزمنية والتنسيقات"},{key:"security",i:ShieldCheck,t:"الأمان",d:"الجلسات وكلمات المرور وسجل التدقيق"}]:[{key:"company",i:Building2,t:"Company information",d:"Legal entities, business units and offices"},{key:"schedules",i:Clock3,t:"Schedules & shifts",d:"Working days, grace periods and shift patterns"},{key:"attendance",i:Activity,t:"Attendance policies",d:"Overtime, lateness and correction rules"},{key:"leave",i:CalendarDays,t:"Leave policies",d:"Entitlements, carry-forward and approvals"},{key:"approvals",i:CheckCircle2,t:"Approval workflows",d:"Configure stages by request type"},{key:"notifications",i:Bell,t:"Notifications",d:"Channels, templates and audience rules"},{key:"locale",i:Globe2,t:"Languages & regions",d:"Arabic, English, time zones and formats"},{key:"security",i:ShieldCheck,t:"Security",d:"Sessions, passwords and audit controls"}];
  const initial=selected?parseSetting(data?.settings?.find(row=>row.setting_key===selected.key)):{},demoEnabled=Boolean(data?.demoDataEnabled);
  const toggleDemo=async()=>{try{setDemoSaving(true);await hrApi({action:"toggle_demo_data",enabled:!demoEnabled});await reload();notify(!demoEnabled?(rtl?"تم إنشاء بيانات اختبار للموظفين الحاليين وإظهارها":"Test data was created for current employees"):(rtl?"تم حذف كل بيانات الاختبار والعودة للبيانات الحقيقية":"All test data was removed"));}catch(reason){notify(reason instanceof Error?reason.message:(rtl?"تعذر تغيير حالة البيانات التجريبية":"Unable to change test data"));}finally{setDemoSaving(false);}};
  return <><PageHeader eyebrow={rtl?"إعداد النظام":"SYSTEM CONFIGURATION"} title={rtl?"الإعدادات":"Settings"} text={rtl?"خصّص إعدادات المنشأة والسياسات بما يناسب آلية العمل.":"Configure company settings and policies to match how your organization works."}/>{error&&<div className="error-banner">{error}<button onClick={()=>void reload()}>{rtl?"إعادة المحاولة":"Retry"}</button></div>}<section className="panel demo-data-setting"><span className="setting-icon violet"><SlidersHorizontal/></span><div><h3>{rtl?"بيانات اختبار للداشبورد":"Dashboard test data"}</h3><p>{rtl?"أنشئ أرقام حضور وطلبات تجريبية باستخدام الموظفين الحقيقيين الموجودين في النظام فقط، دون إضافة أي موظفين جدد. الحذف يزيل الأرقام التجريبية وحدها.":"Create sample attendance and request figures using only the real employees already in the system. No extra employees are added, and removal deletes test figures only."}</p></div><Status tone={demoEnabled?"green":"gray"}>{demoEnabled?(rtl?"مفعّلة":"Enabled"):(rtl?"غير مفعّلة":"Disabled")}</Status><button className={demoEnabled?"outline remove-demo":"primary"} disabled={demoSaving} onClick={()=>void toggleDemo()}>{demoSaving?(rtl?"جارٍ التحديث...":"Updating..."):(demoEnabled?(rtl?"حذف أرقام الاختبار":"Remove test figures"):(rtl?"إنشاء أرقام اختبار":"Create test figures"))}</button></section><div className="settings-grid wide">{items.map(({key,i:Icon,t,d},idx)=><button className="panel setting-card setting-button directional" key={key} onClick={()=>setSelected({key,t,d})}><span className={`setting-icon ${["blue","violet","green","amber"][idx%4]}`}><Icon/></span><div><h3>{t}</h3><p>{d}</p></div><ChevronRight/></button>)}</div>{selected&&<SettingsDrawer rtl={rtl} section={selected.key} title={selected.t} description={selected.d} initial={initial} close={()=>setSelected(null)} submit={async values=>{await hrApi({action:"save_system_settings",settingKey:selected.key,values});await reload();setSelected(null);notify(rtl?"تم حفظ الإعدادات بنجاح":"Settings saved successfully");}}/>}</>;
}

function TalentReportLinks({rtl}:{rtl:boolean}){const reports=[{type:"performance",en:"Performance",ar:"الأداء"},{type:"recruitment",en:"Recruitment",ar:"التوظيف"},{type:"onboarding",en:"Onboarding",ar:"التهيئة"},{type:"offboarding",en:"Offboarding",ar:"إنهاء الخدمة"},{type:"assets",en:"Assets",ar:"الأصول"},{type:"learning",en:"Learning",ar:"التعلم"}];return <section className="panel reports-panel"><div className="panel-head reports-heading"><div><h2>{rtl?"تقارير نظام الموارد البشرية المكتمل":"Complete HRMS reports"}</h2><p>{rtl?"تطبق صلاحيات الوحدة ونطاق الأقسام تلقائيًا.":"Module permissions and department scope are enforced automatically."}</p></div></div><div className="report-grid">{reports.map(report=><article className="report-card" key={report.type}><span className="report-icon"><FileText/></span><div className="report-copy"><h2>{rtl?report.ar:report.en}</h2><p>{rtl?"ملف بيانات نصي بترميز موحّد":"CSV · UTF-8"}</p></div><a className="primary report-export" href={`/api/reports?type=${report.type}&format=csv`}><Download/>{rtl?"تصدير":"Export"}</a></article>)}</div></section>}

function PageHeader({title,action}:{eyebrow?:string;title:string;text?:string;action?:React.ReactNode}){return <section className="page-heading compact"><div><h1>{title}</h1></div>{action}</section>}
function Tabs({items,active,setActive}:{items:{id:string;label:string}[];active:string;setActive:(s:string)=>void}){const employeeSection=items.some(item=>item.id==="employees")&&items.some(item=>item.id==="departments");return <div className={`tabs ${employeeSection?"employee-section-tabs":""}`}>{items.map(x=><button className={active===x.id?"active":""} key={x.id} onClick={()=>setActive(x.id)}>{x.label}</button>)}</div>}
function FilterBar({rtl,query,setQuery,period,setPeriod,placeholder,count,trailing}:{rtl:boolean;query:string;setQuery:(value:string)=>void;period?:string;setPeriod?:(value:string)=>void;placeholder?:string;count?:number;trailing?:React.ReactNode}){return <div className="filterbar"><label><Search size={16}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={placeholder??(rtl?"البحث...":"Search...")}/>{query&&<button className="filter-clear" onClick={()=>setQuery("")} aria-label={rtl?"مسح البحث":"Clear search"}><X size={16}/></button>}</label>{setPeriod&&<label className="desktop-filter"><select aria-label={rtl?"تصفية حسب الفترة":"Filter by period"} value={period} onChange={event=>setPeriod(event.target.value)}><option value="all">{rtl?"كل الفترات":"All time"}</option><option value="month">{rtl?"هذا الشهر":"This month"}</option><option value="week">{rtl?"هذا الأسبوع":"This week"}</option></select><ChevronDown size={16}/></label>}{trailing}<span className="spacer"/>{count!==undefined&&<span className="filter-count">{rtl?`${formatNumber(count,rtl)} نتيجة`:`${formatNumber(count,rtl)} result${count===1?"":"s"}`}</span>}</div>}

function RequestTable({rtl,rows=[]}:{rtl:boolean;rows?:Record<string,any>[]}){const [selected,setSelected]=useState<number|null>(null);if(!rows.length)return <Empty title={rtl?"لا توجد طلبات":"No requests"} text={rtl?"لم يتم تقديم أي طلبات حتى الآن.":"No requests have been submitted yet."}/>;return <div className="data-table"><div className="tr th"><span>{rtl?"نوع الطلب":"Request"}</span><span>{rtl?"تاريخ التقديم":"Submitted"}</span><span>{rtl?"الفترة أو القيمة":"Period / value"}</span><span>{rtl?"مرحلة الاعتماد":"Approval stage"}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{rows.map(r=>{const id=Number(r.id);const period=r.amount?new Intl.NumberFormat(localeFor(rtl),{style:"currency",currency:String(r.currency||"SAR"),maximumFractionDigits:2}).format(Number(r.amount)):r.from_date&&r.to_date?`${formatDate(r.from_date,rtl,{day:"numeric",month:"short"})} — ${formatDate(r.to_date,rtl,{day:"numeric",month:"short"})}`:"—";return <div className={`tr ${selected===id?"selected":""}`} key={id}><span><b>{localizedRequestType(r.type,rtl)}</b><small>{r.request_code}</small></span><span>{r.created_at?formatDate(String(r.created_at).slice(0,10),rtl,{day:"numeric",month:"short",year:"numeric"}):"—"}</span><span>{period}</span><span>{localizedStage(r.current_stage,rtl)}</span><span><Status tone={String(r.status).includes("approved")?"green":String(r.status).includes("rejected")?"rose":"amber"}>{localizedStatus(r.status,rtl)}</Status></span><span><button className="plain-icon" onClick={()=>setSelected(current=>current===id?null:id)} aria-expanded={selected===id} aria-label={rtl?"عرض تفاصيل الطلب":"View request details"}><MoreHorizontal size={20}/></button></span></div>})}</div>}
function EmployeeCardGrid({rtl,rows,departments,jobTitles,canDelete,onDelete,onOpen}:{rtl:boolean;rows?:Record<string,any>[];departments?:Record<string,any>[];jobTitles?:Record<string,any>[];canDelete:boolean;onDelete:(employee:Record<string,any>)=>void;onOpen:(employee:Record<string,any>,edit:boolean)=>void}){
  const list=rows??[];
  const departmentById=new Map((departments??[]).map(item=>[String(item.id),item]));
  const jobById=new Map((jobTitles??[]).map(item=>[String(item.id),item]));
  if(!list.length)return <Empty icon={Users} title={rtl?"لا يوجد موظفون":"No employees"} text={rtl?"لم تتم إضافة أي موظفين بعد.":"No employees have been added yet."}/>;
  return <div className="employee-card-grid">{list.map(employee=>{
    const department=departmentById.get(String(employee.department_id)),job=jobById.get(String(employee.job_title_id));
    const name=rtl?(employee.name_ar||employee.name_en):(employee.name_en||employee.name_ar);
    const departmentName=(rtl?(department?.name_ar||department?.name_en):(department?.name_en||department?.name_ar))||employee.department_name||"—";
    const jobName=localizedJobTitle(rtl,job,{name_en:employee.job_title_name,name_ar:employee.job_title_name_ar});
    const managerName=(rtl?(employee.manager_name_ar||employee.manager_name):(employee.manager_name||employee.manager_name_ar))||(rtl?"غير محدد":"Not assigned");
    const status=String(employee.employment_status||"active");
    const facts=[
      {label:rtl?"المدير المباشر":"Direct manager",value:managerName},
      {label:rtl?"بداية العمل":"Start date",value:employee.start_date||"—",ltr:true},
      {label:rtl?"إنهاء الخدمة":"End date",value:employee.end_date||"—",ltr:true},
    ];
    return <article className="employee-card" key={employee.id}>
      <div className="employee-card-band"><Status tone={status==="active"?"green":status==="suspended"?"rose":status==="probation"?"blue":"amber"}>{localizedStatus(status,rtl)}</Status></div>
      <div className="employee-card-head" role="button" tabIndex={0} onClick={()=>onOpen(employee,false)} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onOpen(employee,false);}}}>
        <span className="employee-photo">{employee.avatar_url?<img src={employee.avatar_url} alt=""/>:personInitials(employee.name_en||employee.name_ar||employee.work_email)}</span>
        <b className="employee-card-name">{name}</b>
        <span className="employee-card-meta">
          <span className="employee-card-code" dir="ltr">{employee.employee_code}</span>
          <span className="employee-card-role">{jobName}</span>
          <span className="employee-card-dept">{departmentName}</span>
        </span>
      </div>
      <dl className="employee-card-facts">{facts.map(fact=><div key={fact.label}><dt>{fact.label}</dt><dd className={fact.ltr?"num":undefined} dir={fact.ltr?"ltr":undefined} title={String(fact.value)}>{fact.value}</dd></div>)}</dl>
      <footer className="employee-card-actions">
        <button onClick={()=>onOpen(employee,false)} aria-label={rtl?`عرض ملف ${name}`:`View ${name}`} title={rtl?"عرض الملف":"View profile"}><Eye size={17}/></button>
        <button onClick={()=>onOpen(employee,true)} aria-label={rtl?`تعديل بيانات ${name}`:`Edit ${name}`} title={rtl?"تعديل البيانات":"Edit details"}><Pencil size={17}/></button>
        {canDelete&&<button className="employee-delete-action" onClick={()=>onDelete(employee)} aria-label={rtl?`حذف الموظف ${name}`:`Delete ${name}`} title={rtl?"حذف الموظف":"Delete employee"}><Trash2 size={17}/></button>}
      </footer>
    </article>;
  })}</div>;
}

function employeeInlineUpdateForm(employee:Record<string,any>,changes:{name:string;departmentId:string;jobTitleId:string},rtl:boolean){return {
  employeeId:employee.id,nameAr:rtl?changes.name:(employee.name_ar||""),nameEn:rtl?(employee.name_en||""):changes.name,workEmail:employee.work_email||"",
  fingerprintCode:employee.fingerprint_code||"",personalPhone:employee.personal_phone||"",workPhone:employee.work_phone||"",nationality:employee.nationality||"",gender:employee.gender||"male",birthDate:employee.birth_date||"",identificationNumber:employee.identification_number||"",address:employee.address||"",
  departmentId:changes.departmentId,jobTitleId:changes.jobTitleId,managerId:employee.manager_id||"",startDate:employee.start_date||"",endDate:employee.end_date||"",employmentStatus:employee.employment_status||"active",salary:employee.salary??"",salaryCurrency:employee.salary_currency||"SAR",country:employee.country||"Saudi Arabia",workLocation:employee.work_location||"",employmentType:employee.employment_type||"full_time",
  scheduleType:employee.schedule_type||"fixed",workDays:employee.work_days||"0,1,2,3,4",checkInTime:employee.check_in_time||"09:00",checkOutTime:employee.check_out_time||"17:00",graceMinutes:employee.grace_minutes??15,requiredDailyMinutes:employee.required_daily_minutes??480,bankName:employee.bank_name||"",bankAccountNumber:employee.bank_account_number||"",bankIban:employee.bank_iban||"",
};}

function EmployeeRowList({rtl,rows,departments,jobTitles,onSave}:{rtl:boolean;rows?:Record<string,any>[];departments?:Record<string,any>[];jobTitles?:Record<string,any>[];onSave:(form:Record<string,any>)=>Promise<void>}){
  const list=rows??[];
  const [editingId,setEditingId]=useState<number|null>(null),[draft,setDraft]=useState({name:"",departmentId:"",jobTitleId:""}),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const departmentById=new Map((departments??[]).map(item=>[String(item.id),item]));
  const jobById=new Map((jobTitles??[]).map(item=>[String(item.id),item]));
  const beginEdit=(employee:Record<string,any>)=>{setEditingId(Number(employee.id));setDraft({name:String(rtl?(employee.name_ar||employee.name_en):(employee.name_en||employee.name_ar)),departmentId:String(employee.department_id||""),jobTitleId:String(employee.job_title_id||"")});setError("");};
  const cancelEdit=()=>{setEditingId(null);setError("");};
  const save=async(employee:Record<string,any>)=>{if(!draft.name.trim()||!draft.departmentId||!draft.jobTitleId){setError(rtl?"الاسم والوظيفة والقسم حقول مطلوبة":"Name, job title and department are required");return;}try{setSaving(true);setError("");await onSave(employeeInlineUpdateForm(employee,{...draft,name:draft.name.trim()},rtl));setEditingId(null);}catch(reason){setError(reason instanceof Error?reason.message:(rtl?"تعذر حفظ التعديل":"Unable to save changes"));}finally{setSaving(false);}};
  if(!list.length)return <Empty icon={Users} title={rtl?"لا يوجد موظفون":"No employees"} text={rtl?"لم تتم إضافة أي موظفين بعد.":"No employees have been added yet."}/>;
  return <div className="employee-row-scroll"><div className="employee-row-list">
    <div className="employee-list-row employee-list-head"><span>{rtl?"اسم الموظف":"Employee name"}</span><span>{rtl?"الوظيفة":"Job title"}</span><span>{rtl?"القسم":"Department"}</span><span>{rtl?"تعديل":"Edit"}</span></div>
    {list.map((employee,index)=>{
      const department=departmentById.get(String(employee.department_id)),job=jobById.get(String(employee.job_title_id));
      const name=rtl?(employee.name_ar||employee.name_en):(employee.name_en||employee.name_ar);
      const departmentName=(rtl?(department?.name_ar||department?.name_en):(department?.name_en||department?.name_ar))||employee.department_name||"—";
      const jobName=localizedJobTitle(rtl,job,{name_en:employee.job_title_name,name_ar:employee.job_title_name_ar});
      const editing=editingId===Number(employee.id),availableJobs=(jobTitles??[]).filter(item=>!draft.departmentId||String(item.department_id)===draft.departmentId);
      return editing?<div className="employee-list-row employee-list-row-editing" key={employee.id}><span><input className="employee-inline-field" value={draft.name} onChange={event=>setDraft(current=>({...current,name:event.target.value}))} aria-label={rtl?"اسم الموظف":"Employee name"}/>{error&&<small className="employee-inline-error" role="alert">{error}</small>}</span><span><select className="employee-inline-field" value={draft.jobTitleId} onChange={event=>setDraft(current=>({...current,jobTitleId:event.target.value}))} aria-label={rtl?"الوظيفة":"Job title"}><option value="">{rtl?"اختر الوظيفة":"Select job title"}</option>{availableJobs.map(item=><option value={item.id} key={item.id}>{localizedJobTitle(rtl,item)}</option>)}</select></span><span><select className="employee-inline-field" value={draft.departmentId} onChange={event=>setDraft(current=>({...current,departmentId:event.target.value,jobTitleId:""}))} aria-label={rtl?"القسم":"Department"}><option value="">{rtl?"اختر القسم":"Select department"}</option>{(departments??[]).map(item=><option value={item.id} key={item.id}>{rtl?(item.name_ar||item.name_en):(item.name_en||item.name_ar)}</option>)}</select></span><span className="employee-inline-actions"><button className="employee-row-save" disabled={saving} onClick={()=>void save(employee)} aria-label={rtl?"حفظ التعديل":"Save changes"} title={rtl?"حفظ":"Save"}><Check size={17}/></button><button className="employee-row-cancel" disabled={saving} onClick={cancelEdit} aria-label={rtl?"إلغاء التعديل":"Cancel changes"} title={rtl?"إلغاء":"Cancel"}><X size={17}/></button></span></div>:<div className="employee-list-row" key={employee.id}><span className="person"><Avatar initials={personInitials(employee.name_en||employee.name_ar||employee.work_email)} small tone={["blue","violet","rose","amber"][index%4]}/><b>{name}</b></span><span>{jobName}</span><span>{departmentName}</span><span><button className="employee-row-edit" onClick={()=>beginEdit(employee)} aria-label={rtl?`تعديل بيانات ${name}`:`Edit ${name}`} title={rtl?"تعديل البيانات":"Edit details"}><Pencil size={17}/></button></span></div>;
    })}
  </div></div>;
}

function EmployeeTable({rtl,users=false,rows,onSelect}:{rtl:boolean;users?:boolean;rows?:Record<string,any>[];onSelect?:(employee:Record<string,any>)=>void}){
  const list=(rows??[]).map((e,i)=>{const jobRecord={name_en:e.job_title_name,name_ar:e.job_title_name_ar};return {raw:e,name:e.name_en||e.employee_name||e.email,ar:e.name_ar||e.employee_name_ar||e.employee_name||e.email,initials:personInitials(e.name_en||e.employee_name||e.email),id:e.employee_code||e.email,dept:e.department_name||"—",deptAr:e.department_name_ar||e.department_name||"—",role:e.job_title_name?localizedJobTitle(false,jobRecord):(e.role_name||"—"),roleAr:e.job_title_name?localizedJobTitle(true,jobRecord):(e.role_name||"—"),location:e.work_location||e.country||"—",locationAr:e.work_location_ar||localizedCountry(e.country,true)||"—",status:String(e.employment_status||e.status||"active").replaceAll("_"," "),tone:["violet","blue","rose","amber"][i%4]};});
  if(!list.length)return <Empty icon={Users} title={users?(rtl?"لا يوجد مستخدمون":"No users"):(rtl?"لا يوجد موظفون":"No employees")} text={users?(rtl?"لم تتم إضافة أي حسابات مستخدمين بعد.":"No user accounts have been added yet."):(rtl?"لم تتم إضافة أي موظفين بعد.":"No employees have been added yet.")}/>;
  return <div className="data-table employee-table"><div className="tr th"><span>{rtl?"الموظف":"Employee"}</span><span>{rtl?"القسم":"Department"}</span><span>{rtl?"المسمى الوظيفي":"Job title"}</span><span>{users?(rtl?"الدور والصلاحية":"Role"):(rtl?"موقع العمل":"Location")}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{list.map((e:Record<string,any>)=><div className={`tr ${onSelect?"employee-row-clickable":""}`} key={e.id} role={onSelect?"button":undefined} tabIndex={onSelect?0:undefined} onClick={()=>onSelect?.(e.raw)} onKeyDown={event=>{if(onSelect&&(event.key==="Enter"||event.key===" ")){event.preventDefault();onSelect(e.raw);}}}><span className="person"><Avatar initials={e.initials} small tone={e.tone}/><span><b>{rtl?e.ar:e.name}</b><small>{e.id}</small></span></span><span>{rtl?e.deptAr:e.dept}</span><span>{rtl?e.roleAr:e.role}</span><span>{users?e.role:(rtl?e.locationAr:e.location)}</span><span><Status tone={String(e.status).toLowerCase()==="active"?"green":String(e.status).toLowerCase()==="on leave"?"violet":"amber"}>{localizedStatus(e.status,rtl)}</Status></span><span><button className="plain-icon" aria-label={rtl?"فتح ملف الموظف":"Open employee profile"} onClick={event=>{event.stopPropagation();onSelect?.(e.raw);}}><ChevronRight size={20}/></button></span></div>)}</div>;
}

function JobTitleTable({rtl,rows,departments,onEdit}:{rtl:boolean;rows?:Record<string,any>[];departments?:Record<string,any>[];onEdit:(job:Record<string,any>)=>void}){const list=rows??[];const departmentById=new Map((departments??[]).map(department=>[Number(department.id),department]));return list.length?<div className="data-table job-title-table"><div className="tr th"><span>{rtl?"المسمى الوظيفي":"English name"}</span><span>{rtl?"الاسم المسجل":"Arabic name"}</span><span>{rtl?"القسم":"Department"}</span><span>{rtl?"عدد الموظفين":"Employees"}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{list.map(job=>{const department=departmentById.get(Number(job.department_id));return <div className="tr" key={job.id}><span><b>{rtl?localizedJobTitle(true,job):job.name_en}</b></span><span>{rtl?(job.name_ar||localizedJobTitle(true,job)):job.name_ar}</span><span>{rtl?(department?.name_ar||job.department_name):(department?.name_en||job.department_name)||"—"}</span><span>{formatNumber(Number(job.employee_count)||0,rtl)}</span><span><Status tone={job.status==="active"?"green":"gray"}>{localizedStatus(job.status||"active",rtl)}</Status></span><span><button className="plain-icon" onClick={()=>onEdit(job)} aria-label={rtl?`تعديل ${job.name_ar}`:`Edit ${job.name_en}`}><MoreHorizontal size={20}/></button></span></div>})}</div>:<Empty icon={BriefcaseBusiness} title={rtl?"لا توجد مسميات وظيفية":"No job titles"} text={rtl?"لم تُضف أي مسميات وظيفية حتى الآن.":"No job titles have been added yet."}/>}
function DepartmentGrid({rtl,rows,jobs,employees,notify,reload,onEdit}:{rtl:boolean;rows?:Record<string,any>[];jobs?:Record<string,any>[];employees?:Record<string,any>[];notify:(s:string)=>void;reload:()=>Promise<void>;onEdit:(department:Record<string,any>)=>void}){
  const list=rows??[];const [selected,setSelected]=useState<Record<string,any>|null>(null);
  return <>{list.length?<div className="department-grid">{list.map((department,index)=>{const tone=["blue","violet","green","rose","amber"][index%5];const titleCount=(jobs??[]).filter(job=>Number(job.department_id)===Number(department.id)).length;return <article className="department-card" key={department.id}><span className={`department-icon ${tone}`}><Building2/></span><button className="department-edit" onClick={()=>onEdit(department)} aria-label={rtl?`تعديل ${department.name_ar}`:`Edit ${department.name_en}`}><MoreHorizontal size={20}/></button><h3>{rtl?department.name_ar:department.name_en}</h3>{!rtl&&<p>{department.name_ar}</p>}<div className="department-manager"><small>{organizationManagerLabel(department,rtl,true)}</small><b>{rtl?(department.manager_name_ar||department.manager_name||"غير محدد"):(department.manager_name||"Not assigned")}</b></div><div className="department-summary"><BriefcaseBusiness size={16}/><span><small>{rtl?"المسميات الوظيفية":"Job titles"}</small><b>{formatNumber(titleCount,rtl)}</b></span></div><footer><Users size={16}/>{formatNumber(Number(department.employee_count)||0,rtl)} {rtl?"موظفاً":"employees"}<button className="department-open-button directional" onClick={()=>setSelected(department)}>{rtl?"فتح القسم":"Open department"}<ChevronRight size={16}/></button></footer></article>})}</div>:<Empty icon={Building2} title={rtl?"لا توجد أقسام":"No departments"} text={rtl?"لم يتم تحميل الأقسام بعد.":"Departments have not loaded yet."}/>} {selected&&<DepartmentHierarchyDrawer rtl={rtl} department={selected} employees={employees??[]} jobs={jobs??[]} close={()=>setSelected(null)} save={async(managerEmployeeId,assignments)=>{await hrApi({action:"save_department_hierarchy",departmentId:selected.id,managerEmployeeId,assignments});await reload();setSelected(null);notify(rtl?`تم حفظ ${organizationManagerLabel(selected,true)} والمستويات التنظيمية`:`${organizationManagerLabel(selected,false)} and organization levels saved`);}}/>}</>
}

function DepartmentHierarchyDrawer({rtl,department,employees,jobs,close,save}:{rtl:boolean;department:Record<string,any>;employees:Record<string,any>[];jobs:Record<string,any>[];close:()=>void;save:(managerEmployeeId:number,assignments:{employeeId:number;managerId:number|null}[])=>Promise<void>}){
  const team=employees.filter(employee=>Number(employee.department_id)===Number(department.id));
  const initialManager=Number(department.manager_employee_id)||Number(team.find(employee=>Number(employee.organizational_level)===0)?.id)||Number(team[0]?.id)||0;
  const [managerId,setManagerId]=useState(initialManager);
  const managerLabel=organizationManagerLabel(department,rtl);
  const [reports,setReports]=useState<Record<number,number|null>>(()=>Object.fromEntries(team.map(employee=>[Number(employee.id),Number(employee.manager_id)||null])));
  const [saving,setSaving]=useState(false); const [error,setError]=useState("");
  const jobById=new Map(jobs.map(job=>[Number(job.id),job]));
  const managerOptions=employees.filter(employee=>employee.employment_status!=="deleted");
  const reportOptions=(employeeId:number)=>managerOptions.filter(option=>Number(option.id)===managerId||(Number(option.department_id)===Number(department.id)&&Number(option.id)!==employeeId));
  const levels=useMemo(()=>{const result:Record<number,number>={};const walk=(id:number,path:Set<number>):number=>{if(id===managerId)return 0;if(result[id]!==undefined)return result[id];if(path.has(id))return 99;const next=new Set(path);next.add(id);const parent=reports[id]||managerId;return result[id]=parent===id?99:walk(parent,next)+1;};team.forEach(employee=>{result[Number(employee.id)]=walk(Number(employee.id),new Set());});return result;},[managerId,reports,team]);
  const ordered=[...team].sort((a,b)=>(levels[Number(a.id)]??99)-(levels[Number(b.id)]??99)||String(rtl?a.name_ar:a.name_en).localeCompare(String(rtl?b.name_ar:b.name_en),rtl?"ar":"en"));
  const changeManager=(id:number)=>{const previous=managerId;setManagerId(id);setReports(current=>{const next={...current,[id]:null};if(previous&&previous!==id)next[previous]=id;return next;});};
  const submit=async()=>{try{setSaving(true);setError("");await save(managerId,team.map(employee=>({employeeId:Number(employee.id),managerId:Number(employee.id)===managerId?null:(reports[Number(employee.id)]||managerId)})));}catch(reason){setError(reason instanceof Error?reason.message:(rtl?"تعذر حفظ الهيكل":"Unable to save structure"));setSaving(false);}};
  return <div className="modal-layer">
    <button className="modal-scrim" onClick={close} aria-label={rtl?"إغلاق":"Close"}/>
    <aside className="drawer department-drawer">
      <div className="drawer-head"><div><span className="eyebrow">{rtl?"إدارة القسم":"DEPARTMENT STRUCTURE"}</span><h2>{rtl?department.name_ar:department.name_en}</h2><p>{rtl?`حدد ${managerLabel} والمدير المباشر لكل موظف؛ وسيُحسب الرقم التنظيمي تلقائياً.`:`Choose the ${managerLabel.toLocaleLowerCase()} and each reporting line; organization numbers are calculated automatically.`}</p></div><button className="icon-btn" onClick={close}><X size={20}/></button></div>
      <div className="form-body department-structure-body">{error&&<div className="error-banner">{error}</div>}{team.length?<>
        <label className="field manager-field"><span>{managerLabel} · {formatNumber(0,rtl)}</span><select value={managerId} onChange={event=>changeManager(Number(event.target.value))}>{managerOptions.map(employee=><option value={employee.id} key={employee.id}>{rtl?employee.name_ar:employee.name_en}</option>)}</select></label>
        <div className="hierarchy-key"><span><b>0</b>{managerLabel}</span><i/><span><b>1+</b>{rtl?"الفريق":"Team"}</span></div>
        <div className="hierarchy-list">{ordered.map((employee,index)=>{const level=levels[Number(employee.id)]??1;const job=jobById.get(Number(employee.job_title_id));const isManager=Number(employee.id)===managerId;return <div className="hierarchy-row" key={employee.id} style={{"--org-level":Math.min(level,5)} as React.CSSProperties}><span className={`level-badge ${isManager?"manager":""}`}>{formatNumber(level,rtl)}</span><Avatar initials={personInitials(employee.name_en)} small tone={["blue","violet","green","amber"][index%4]}/><div className="hierarchy-person"><b>{rtl?employee.name_ar:employee.name_en}</b><small>{localizedJobTitle(rtl,job,{name_en:employee.job_title_name,name_ar:employee.job_title_name_ar})}</small></div>{isManager?<Status tone="blue">{managerLabel}</Status>:<label><small>{rtl?"المدير المباشر":"Reports to"}</small><select value={reports[Number(employee.id)]||managerId} onChange={event=>setReports(current=>({...current,[Number(employee.id)]:Number(event.target.value)}))}>{reportOptions(Number(employee.id)).map(option=><option value={option.id} key={option.id}>{rtl?option.name_ar:option.name_en}</option>)}</select></label>}</div>})}</div>
      </>:<Empty icon={Users} title={rtl?"لا يوجد موظفون في هذا القسم":"No employees in this department"} text={rtl?"أضف موظفاً للقسم أولاً لتحديد المدير والأرقام التنظيمية.":"Add an employee before configuring its manager and organization numbers."}/>}</div>
      <div className="drawer-footer"><span/><button className="outline" onClick={close}>{rtl?"إلغاء":"Cancel"}</button><button className="primary" disabled={!team.length||saving} onClick={()=>void submit()}><Check size={16}/>{saving?(rtl?"جارٍ الحفظ...":"Saving..."):(rtl?"حفظ الهيكل":"Save structure")}</button></div>
    </aside>
  </div>
}
function HolidayCalendar({rtl,rows}:{rtl:boolean;rows?:Record<string,any>[]}){
  const list=(rows??[]).filter(h=>String(h.holiday_date||"").startsWith("2026-")).sort((a,b)=>String(a.holiday_date).localeCompare(String(b.holiday_date)));
  return <div className="panel official-holidays"><div className="official-holidays-head"><div><span className="eyebrow">{rtl?"التقويم السنوي":"ANNUAL CALENDAR"}</span><h2>{rtl?"قائمة الإجازات الرسمية 2026":"Official holidays 2026"}</h2><p>{rtl?`${formatNumber(list.length,rtl)} إجازة مسجلة لمصر والمملكة العربية السعودية`:`${list.length} holidays registered for Egypt and Saudi Arabia`}</p></div><span><CalendarDays size={20}/>{formatNumber(2026,rtl)}</span></div>
    {list.length?<div className="official-holiday-scroll"><div className="official-holiday-table"><div className="official-holiday-row head"><span>{rtl?"التاريخ":"Date"}</span><span>{rtl?"اسم الإجازة":"Holiday name"}</span><span>{rtl?"أنواع الحضور":"Attendance types"}</span><span>{rtl?"النوع":"Type"}</span><span>{rtl?"الإجراءات":"Actions"}</span></div>{list.map((holiday,index)=>{const attendance=String(holiday.attendance_types||"").split("|").filter(Boolean);return <div className="official-holiday-row" key={`${holiday.holiday_date}-${holiday.name_ar}-${holiday.id??index}`}><span className="official-date"><b>{formatDate(String(holiday.holiday_date),rtl,{day:"2-digit",month:"2-digit",year:"numeric"})}</b><small>{formatDate(String(holiday.holiday_date),rtl,{weekday:"long"})}</small></span><span className="official-name"><b>{rtl?holiday.name_ar:holiday.name_en}</b><small>{localizedCountry(holiday.country,rtl)}</small></span><span className="attendance-chips">{attendance.length?attendance.map((type:string)=><i key={type}>{type}</i>):<i>{rtl?"غير محدد":"Not specified"}</i>}</span><span><Status tone={holiday.recurrence_type==="annual"?"blue":"gray"}>{holiday.recurrence_type==="annual"?(rtl?"سنوي":"Annual"):(rtl?"لمرة واحدة":"One time")}</Status></span><span><button className="plain-icon" aria-label={rtl?"إجراءات الإجازة":"Holiday actions"}><MoreHorizontal size={20}/></button></span></div>})}</div></div>:<Empty icon={CalendarDays} title={rtl?"لا توجد إجازات في 2026":"No holidays in 2026"} text={rtl?"أضف أول إجازة رسمية لهذا العام.":"Add the first official holiday for this year."}/>}</div>
}

function AttendanceTable({rtl,rows=[]}:{rtl:boolean;rows?:Record<string,any>[]}){const [selected,setSelected]=useState<number|null>(null);if(!rows.length)return <Empty icon={Clock3} title={rtl?"لا توجد سجلات حضور":"No attendance records"} text={rtl?"لم يتم تسجيل أي حضور أو انصراف بعد.":"No attendance or check-out records have been added yet."}/>;return <div className="data-table attendance-table"><div className="tr th"><span>{rtl?"الموظف":"Employee"}</span><span>{rtl?"التاريخ":"Date"}</span><span>{rtl?"الدوام المقرر":"Scheduled"}</span><span>{rtl?"الدوام الفعلي":"Actual"}</span><span>{rtl?"المدة المسجلة":"Worked"}</span><span>{rtl?"الحالة":"Status"}</span><span></span></div>{rows.map((row,i)=>{const id=Number(row.id);const open=selected===id;const scheduled=row.scheduled_in||row.scheduled_out?`${row.scheduled_in||"—"} — ${row.scheduled_out||"—"}`:"—";const actual=row.actual_in||row.actual_out?`${row.actual_in||"—"} — ${row.actual_out||"—"}`:"—";return <div className={`tr ${open?"selected":""}`} key={id}><span className="person"><Avatar initials={personInitials(row.employee_name)} small tone={["blue","violet","rose","amber"][i%4]}/><span><b>{rtl?(row.employee_name_ar||row.employee_name):row.employee_name}</b><small>{row.department_name||"—"}</small></span></span><span>{formatDate(String(row.work_date),rtl)}</span><span>{scheduled}</span><span>{actual}</span><span>{rtl?`${formatNumber(Number(row.worked_minutes)||0,rtl)} دقيقة`:`${Number(row.worked_minutes)||0} min`}</span><span><Status tone={String(row.status)==="present"?"green":String(row.status)==="leave"?"violet":String(row.status)==="late"?"amber":"gray"}>{localizedStatus(row.status,rtl)}</Status></span><span><button className="plain-icon" onClick={()=>setSelected(current=>current===id?null:id)} aria-expanded={open} aria-label={rtl?"عرض تفاصيل السجل":"View record details"}><MoreHorizontal size={20}/></button></span></div>})}</div>}
function PermissionEditor({rtl,notify,data,reload}:{rtl:boolean;notify:(s:string)=>void;data:HRData|null;reload:()=>Promise<void>}){
  const roles=data?.roles??[];
  const [selectedRole,setSelectedRole]=useState<number|null>(null);
  const [pageDraft,setPageDraft]=useState<Record<string,boolean>>({});
  const [saving,setSaving]=useState(false);
  const [creatingRole,setCreatingRole]=useState(false),[roleForm,setRoleForm]=useState({nameAr:"",nameEn:"",cloneRoleId:""});
  const role=roles.find(item=>Number(item.id)===selectedRole)??roles[0];
  const fallbackActions=["view","create","edit","delete","approve","export","manage_settings"];
  const actionsFor=(module:string)=>{const stored=Array.from(new Set((data?.permissions??[]).filter(permission=>permission.module===module).map(permission=>String(permission.action))));return stored.length?stored:fallbackActions;};
  type PermissionPage={id:Page;label:string;description:string;gate:[string,string];grants:{module:string;actions?:string[]}[]};
  const pages:PermissionPage[]=[
    {id:"dashboard",label:rtl?"لوحة التحكم":"Dashboard",description:rtl?"المؤشرات والتنبيهات التشغيلية":"Operational metrics and alerts",gate:["dashboard","view"],grants:[{module:"dashboard"}]},
    {id:"portal",label:rtl?"بوابة الموظف":"Employee portal",description:rtl?"الخدمة الذاتية والطلبات وقسائم الراتب":"Self-service, requests, and payslips",gate:["employee_portal","view"],grants:[{module:"employee_portal"},{module:"employee_requests"},{module:"payroll",actions:["view_own_payslip"]}]},
    {id:"approvals",label:rtl?"اعتماد الطلبات":"Request approvals",description:rtl?"مراجعة الطلبات واعتمادها أو رفضها":"Review and decide requests",gate:["request_approvals","view"],grants:[{module:"request_approvals"}]},
    {id:"employees",label:rtl?"الموظفون":"Employees",description:rtl?"ملفات الموظفين والأقسام والمسميات والرواتب":"Employee records, departments, titles, and salaries",gate:["employees","view"],grants:[{module:"employees"},{module:"departments"},{module:"job_titles"},{module:"employee_salaries"}]},
    {id:"leave",label:rtl?"إدارة الإجازات":"Leave management",description:rtl?"الأنواع والأرصدة والسياسات والعمليات":"Types, balances, policies, and actions",gate:["leave_management","view"],grants:[{module:"leave_management"}]},
    {id:"attendance",label:rtl?"الحضور والانصراف":"Attendance",description:rtl?"السجلات والتعديلات والاستثناءات":"Records, adjustments, and exceptions",gate:["attendance","view"],grants:[{module:"attendance"},{module:"attendance_adjustments"}]},
    {id:"performance",label:rtl?"الأداء":"Performance",description:rtl?"دورات التقييم والأهداف والمراجعات":"Review cycles, goals, and evaluations",gate:["performance","view"],grants:[{module:"performance"}]},
    {id:"recruitment",label:rtl?"التوظيف":"Recruitment",description:rtl?"الوظائف والمرشحون والمقابلات":"Jobs, candidates, and interviews",gate:["recruitment","view"],grants:[{module:"recruitment"}]},
    {id:"lifecycle",label:rtl?"التهيئة وإنهاء الخدمة":"Onboarding & offboarding",description:rtl?"عمليات مباشرة الموظف وإخلاء الطرف":"Joining and clearance workflows",gate:["onboarding","view"],grants:[{module:"onboarding"},{module:"offboarding"}]},
    {id:"assets",label:rtl?"الأصول":"Assets",description:rtl?"إضافة العهد وإسنادها وإرجاعها":"Create, assign, and return assets",gate:["assets","view"],grants:[{module:"assets"}]},
    {id:"learning",label:rtl?"التعلم":"Learning",description:rtl?"الدورات والتسجيل والمتابعة":"Courses, enrollment, and tracking",gate:["learning","view"],grants:[{module:"learning"}]},
    {id:"org",label:rtl?"الهيكل التنظيمي":"Organization chart",description:rtl?"الأقسام والمديرون والتبعية":"Departments, managers, and reporting lines",gate:["organization_chart","view"],grants:[{module:"organization_chart"}]},
    {id:"users",label:rtl?"المستخدمون والصلاحيات":"Users & permissions",description:rtl?"الحسابات وقوالب الأدوار الوظيفية":"Accounts and access-role templates",gate:["users","view"],grants:[{module:"users"},{module:"permissions"}]},
    {id:"reports",label:rtl?"التقارير والتصدير":"Reports & exports",description:rtl?"فتح التقارير وتنزيل الملفات":"Open reports and download files",gate:["reports","view"],grants:[{module:"reports"}]},
    {id:"payroll",label:rtl?"الرواتب":"Payroll",description:rtl?"الدورات والهياكل والاعتماد والقفل":"Runs, structures, approval, and locking",gate:["payroll","view"],grants:[{module:"payroll"}]},
    {id:"settings",label:rtl?"الإعدادات":"Settings",description:rtl?"إعدادات النظام والسياسات العامة":"System configuration and policies",gate:["system_settings","view"],grants:[{module:"system_settings"}]},
  ];
  const isSuperAdminRole=String(role?.name)==="Super Admin";
  const canEdit=data?.currentUser?.role_name==="Super Admin"||(data?.permissions??[]).some(permission=>Number(permission.role_id)===Number(data?.currentUser?.role_id)&&permission.module==="permissions"&&permission.action==="manage_settings"&&Number(permission.allowed)===1);
  const savedAllowed=(module:string,action:string)=>(data?.permissions??[]).some(permission=>Number(permission.role_id)===Number(role?.id)&&permission.module===module&&permission.action===action&&Number(permission.allowed)===1);
  const savedPageEnabled=(page:PermissionPage)=>isSuperAdminRole||savedAllowed(page.gate[0],page.gate[1]);
  const pageEnabled=(page:PermissionPage)=>pageDraft[page.id]??savedPageEnabled(page);
  const togglePage=(page:PermissionPage)=>setPageDraft(current=>({...current,[page.id]:!pageEnabled(page)}));
  const pickRole=(id:number)=>{setSelectedRole(id);setPageDraft({});};
  const desiredPermissions=new Map<string,boolean>();
  for(const page of pages)for(const grant of page.grants)for(const action of grant.actions??actionsFor(grant.module)){const key=`${grant.module}:${action}`;if(!desiredPermissions.has(key))desiredPermissions.set(key,false);if(pageEnabled(page))desiredPermissions.set(key,true);}
  const pending=Array.from(desiredPermissions.entries()).filter(([key,value])=>{const [module,action]=key.split(":");return value!==savedAllowed(module,action);});
  const save=async()=>{
    try{
      setSaving(true);
      await hrApi({action:"save_permissions",roleId:Number(role?.id),permissions:pending.map(([key,value])=>{const [module,permission]=key.split(":");return {module,permission,allowed:value};})});
      setPageDraft({});await reload();
      notify(rtl?"تم حفظ الصلاحيات بنجاح":"Permissions saved successfully");
    }catch(reason){notify(reason instanceof Error?reason.message:(rtl?"تعذر حفظ الصلاحيات":"Unable to save permissions"));}
    finally{setSaving(false);}
  };
  const createRole=async()=>{if(!roleForm.nameAr.trim()||!roleForm.nameEn.trim())return;try{setSaving(true);const created=await hrApi({action:"create_role",nameAr:roleForm.nameAr.trim(),nameEn:roleForm.nameEn.trim(),cloneRoleId:Number(roleForm.cloneRoleId)||Number(roles.find(item=>item.name==="Employee")?.id)});setRoleForm({nameAr:"",nameEn:"",cloneRoleId:""});setCreatingRole(false);await reload();setSelectedRole(Number(created.id));notify(rtl?"تم إنشاء قالب الدور الوظيفي":"Access-role template created");}catch(reason){notify(reason instanceof Error?reason.message:(rtl?"تعذر إنشاء الدور":"Unable to create role"));}finally{setSaving(false);}};
  if(!roles.length)return <Empty icon={ShieldCheck} title={rtl?"لا توجد أدوار":"No roles"} text={rtl?"لم تتم إضافة أدوار أو صلاحيات بعد.":"No roles or permissions have been added yet."}/>;
  const locked=!canEdit||isSuperAdminRole||saving;
  const enabledCount=pages.filter(page=>pageEnabled(page)).length;
  return <div className="permission-layout"><aside className="panel role-list"><div className="panel-head"><h2>{rtl?"قوالب الأدوار الوظيفية":"Access-role templates"}</h2><button className="text-button" onClick={()=>setCreatingRole(value=>!value)}><Plus size={15}/>{rtl?"دور جديد":"New role"}</button></div>{creatingRole&&<div className="role-create-form"><label><span>{rtl?"الاسم بالعربية":"Arabic name"}</span><input value={roleForm.nameAr} onChange={event=>setRoleForm(current=>({...current,nameAr:event.target.value}))}/></label><label><span>{rtl?"الاسم بالإنجليزية":"English name"}</span><input dir="ltr" value={roleForm.nameEn} onChange={event=>setRoleForm(current=>({...current,nameEn:event.target.value}))}/></label><label><span>{rtl?"نسخ الصفحات من":"Copy pages from"}</span><select value={roleForm.cloneRoleId} onChange={event=>setRoleForm(current=>({...current,cloneRoleId:event.target.value}))}><option value="">{rtl?"موظف (افتراضي)":"Employee (default)"}</option>{roles.map(item=><option key={item.id} value={item.id}>{roleLabel(item,rtl)}</option>)}</select></label><button className="primary" disabled={saving||!roleForm.nameAr.trim()||!roleForm.nameEn.trim()} onClick={()=>void createRole()}><Check size={15}/>{rtl?"إنشاء القالب":"Create template"}</button></div>}{roles.map((item,i)=><button className={`${Number(item.id)===Number(role?.id)?"active":""} directional`} key={item.id} onClick={()=>pickRole(Number(item.id))}><span className={`role-symbol ${["navy","violet","blue","green","gray"][i%5]}`}><ShieldCheck size={16}/></span><span><b>{roleLabel(item,rtl)}</b><small>{formatNumber(Number(item.user_count)||0,rtl)} {rtl?"مستخدم":"users"}</small></span><ChevronRight size={16}/></button>)}</aside><div className="panel permissions page-permissions"><div className="panel-head"><div><h2>{roleLabel(role,rtl)}</h2><p>{isSuperAdminRole?(rtl?"يمتلك مدير النظام كل الصفحات تلقائيًا ولا يمكن تعديلها.":"Super Admin always has every page and cannot be edited."):canEdit?(rtl?"فعّل الصفحة ليتمكن صاحب الدور من رؤيتها واستخدام جميع الإجراءات المتاحة داخلها.":"Enable a page to make it visible and allow every action available inside it."):(rtl?"عرض فقط — تحتاج صلاحية إدارة الأدوار للتعديل.":"Read-only — managing roles requires the matching grant.")}</p></div><span className="permission-page-count">{formatNumber(enabledCount,rtl)} / {formatNumber(pages.length,rtl)} {rtl?"صفحة مفعلة":"pages enabled"}</span>{!locked&&pending.length>0&&<button className="primary" disabled={saving} onClick={()=>void save()}><Check size={16}/>{saving?(rtl?"جارٍ الحفظ...":"Saving..."):(rtl?"حفظ الصفحات":"Save pages")}</button>}</div><div className="permission-page-grid">{pages.map(page=>{const enabled=pageEnabled(page);return <label className={`permission-page-card ${enabled?"enabled":""}`} key={page.id}><input type="checkbox" checked={enabled} disabled={locked} onChange={()=>togglePage(page)}/><span className="permission-page-check"><Check size={16}/></span><span className="permission-page-copy"><b>{page.label}</b><small>{page.description}</small></span><em>{enabled?(rtl?"مسموح":"Allowed"):(rtl?"غير مسموح":"Hidden")}</em></label>})}</div></div></div>
}

export function RequestDrawer({rtl,close,submit}:{rtl:boolean;close:()=>void;submit:(payload:Record<string,unknown>)=>Promise<void>}){
  const [form,setForm]=useState(()=>{const today=new Date().toISOString().slice(0,10);return {type:"Annual leave",fromDate:today,toDate:today,requestDate:today,amount:"",reason:"",notes:""};});const [attachment,setAttachment]=useState("");const [saving,setSaving]=useState(false);const [error,setError]=useState("");
  const hasDuration=useMemo(()=>form.type.toLowerCase().includes("leave"),[form.type]);const types=["Annual leave","Sick leave","Late arrival","Early departure","Work from home","Expense reimbursement","Experience certificate"];
  const update=(key:string,value:string)=>setForm(current=>({...current,[key]:value}));
  const send=async()=>{const reason=form.reason.trim();if(!reason){setError(rtl?"اكتب سبب الطلب قبل الإرسال":"Add a reason before submitting");return;}if(form.type==="Expense reimbursement"&&!Number(form.amount)){setError(rtl?"أدخل قيمة المصروف":"Enter the expense amount");return;}try{setSaving(true);setError("");await submit({type:form.type,fromDate:form.type==="Expense reimbursement"?null:form.fromDate,toDate:form.type==="Expense reimbursement"?null:form.toDate,requestDate:form.type==="Expense reimbursement"?form.requestDate:null,amount:form.type==="Expense reimbursement"?Number(form.amount):null,currency:form.type==="Expense reimbursement"?"SAR":null,reason,notes:form.notes,details:{attachmentName:attachment||null}})}catch(reasonValue){setError(reasonValue instanceof Error?reasonValue.message:(rtl?"تعذر إرسال الطلب":"Unable to submit request"));setSaving(false)}};
  return <div className="modal-layer"><button className="modal-scrim" onClick={close} aria-label={rtl?"إغلاق النافذة":"Close"}/><aside className="drawer"><div className="drawer-head"><div><span className="eyebrow">{rtl?"الخدمة الذاتية للموظف":"EMPLOYEE SERVICE"}</span><h2>{rtl?"تقديم طلب جديد":"Create a new request"}</h2><p>{rtl?"سيصل الطلب إلى مديرك المباشر للمراجعة أولاً.":"Your direct manager will review the request first."}</p></div><button className="icon-btn" onClick={close} aria-label={rtl?"إغلاق":"Close"}><X size={20}/></button></div><div className="form-progress"><span className="active"><b>{formatNumber(1,rtl)}</b>{rtl?"بيانات الطلب":"Details"}</span><i/><span><b>{formatNumber(2,rtl)}</b>{rtl?"المراجعة والإرسال":"Review"}</span></div><div className="form-body">{error&&<div className="form-error" role="alert">{error}</div>}<label className="field"><span>{rtl?"نوع الطلب":"Request type"}</span><select value={form.type} onChange={event=>update("type",event.target.value)}>{types.map(value=><option value={value} key={value}>{localizedRequestType(value,rtl)}</option>)}</select></label>{form.type==="Expense reimbursement"?<><div className="form-row"><label className="field"><span>{rtl?"تاريخ المصروف":"Expense date"}</span><input type="date" value={form.requestDate} onChange={event=>update("requestDate",event.target.value)}/></label><label className="field"><span>{rtl?"المبلغ بالريال":"Amount (SAR)"}</span><input inputMode="decimal" value={form.amount} onChange={event=>update("amount",event.target.value)} placeholder={rtl?"٠٫٠٠":"0.00"}/></label></div><label className="field"><span>{rtl?"تفاصيل المصروف":"Description"}</span><textarea value={form.reason} onChange={event=>update("reason",event.target.value)} placeholder={rtl?"وضّح تفاصيل المصروف وسبب المطالبة...":"Describe the expense and business purpose..."}/></label></>:<><div className="form-row"><label className="field"><span>{rtl?"تاريخ البداية":"From date"}</span><input type="date" value={form.fromDate} onChange={event=>update("fromDate",event.target.value)}/></label><label className="field"><span>{rtl?"تاريخ النهاية":"To date"}</span><input type="date" value={form.toDate} onChange={event=>update("toDate",event.target.value)}/></label></div>{hasDuration&&<div className="duration-note"><CalendarDays size={20}/><span><b>{rtl?"سيُحتسب عدد أيام العمل عند الإرسال":"Working days are calculated on submission"}</b><small>{rtl?"رصيدك المتاح: ١٨ يوماً":"Available balance: 18 days"}</small></span></div>}<label className="field"><span>{rtl?"سبب الطلب":"Reason"}</span><textarea value={form.reason} onChange={event=>update("reason",event.target.value)} placeholder={rtl?"اكتب سبباً واضحاً يساعد مديرك على المراجعة...":"Add a clear reason to help your manager review the request..."}/></label></>}<label className="upload"><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={event=>setAttachment(event.target.files?.[0]?.name||"")}/><FileText size={20}/><span><b>{attachment|| (rtl?"إرفاق مستند":"Add attachment")}</b><small>{rtl?"مستند أو صورة · بحد أقصى ١٠ م.ب":"PDF, JPG or PNG · Up to 10 MB"}</small></span><Plus size={16}/></label></div><div className="drawer-footer"><button className="ghost" onClick={close}>{rtl?"إغلاق والمتابعة لاحقاً":"Close and continue later"}</button><span/><button className="outline" onClick={close}>{rtl?"إلغاء":"Cancel"}</button><button className="primary directional" disabled={saving} onClick={()=>void send()}>{saving?(rtl?"جارٍ الإرسال...":"Submitting..."):(rtl?"إرسال الطلب":"Submit request")}<ChevronRight size={16}/></button></div></aside></div>
}
function Notifications({rtl,onClose,openPage}:{rtl:boolean;onClose:()=>void;openPage:(page:Page)=>void}){const [items,setItems]=useState<Record<string,unknown>[]>([]),[unread,setUnread]=useState(0),[loading,setLoading]=useState(true);const labels:Record<string,[string,string]>={request_needs_manager_approval:["Request needs your approval","طلب يحتاج اعتمادك"],request_needs_hr_approval:["Request needs HR approval","طلب يحتاج اعتماد الموارد البشرية"],request_approved:["Request approved","تم اعتماد الطلب"],request_rejected:["Request rejected","تم رفض الطلب"],correction_needs_manager_approval:["Attendance correction needs approval","تصحيح حضور يحتاج اعتمادك"],correction_needs_hr_approval:["Attendance correction needs HR approval","تصحيح حضور يحتاج اعتماد الموارد البشرية"],correction_approved:["Attendance correction approved","تم اعتماد تصحيح الحضور"],correction_rejected:["Attendance correction rejected","تم رفض تصحيح الحضور"],document_expiring_soon:["Document expiring soon","مستند قارب الانتهاء"],contract_expiring_soon:["Employment contract expiring soon","عقد العمل قارب على الانتهاء"],interview_assigned:["Interview assigned","تم إسناد مقابلة"],interview_rescheduled:["Interview rescheduled","تمت إعادة جدولة مقابلة"],interview_cancelled:["Interview cancelled","تم إلغاء مقابلة"],interview_starting_soon:["Interview starting soon","مقابلة ستبدأ قريباً"],evaluation_pending:["Interview evaluation pending","تقييم مقابلة بانتظارك"],all_evaluations_completed:["All interview evaluations completed","اكتملت جميع تقييمات المقابلة"],hiring_decision_required:["Hiring decision required","مطلوب قرار توظيف"],offer_approval_pending:["Offer awaiting approval","عرض وظيفي بانتظار الاعتماد"]};const load=useCallback(async()=>{try{const response=await fetch("/api/notifications",{cache:"no-store"}),body=await response.json();if(response.ok){setItems(body.notifications??[]);setUnread(Number(body.unread)||0);}}finally{setLoading(false);}},[]);useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer);},[load]);const mark=async(item:Record<string,unknown>)=>{if(!item.read_at)await fetch("/api/notifications",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id})});const target=String(item.target_path||"dashboard").split("?")[0] as Page;openPage(target);onClose();};const markAll=async()=>{await fetch("/api/notifications",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({all:true})});await load();};return <div className="notification-pop" role="dialog" aria-label={rtl?"الإشعارات":"Notifications"}><div className="panel-head"><div><h2>{rtl?"الإشعارات":"Notifications"}</h2><p>{rtl?`${formatNumber(unread,rtl)} غير مقروء`:`${unread} unread`}</p></div><button onClick={onClose} aria-label={rtl?"إغلاق الإشعارات":"Close notifications"}><X size={16}/></button></div>{loading?<div className="notification-loading"><Activity/></div>:items.length?<div className="notification-list">{items.map(item=><button className={`notification-item ${item.read_at?"":"unread"}`} key={String(item.id)} onClick={()=>void mark(item)}><span className="notification-icon blue"><Bell/></span><span><b>{labels[String(item.title_key)]?.[rtl?1:0]||localizedDisplayValue(item.title_key,rtl)}</b><small>{dateForNotification(item.created_at,rtl)}{item.message_key?` · ${localizedStatus(item.message_key,rtl)}`:""}</small></span>{!item.read_at&&<i/>}</button>)}</div>:<Empty icon={Bell} title={rtl?"لا توجد إشعارات":"No notifications"} text={rtl?"ستظهر الأحداث المهمة هنا.":"Important events will appear here."}/>}<button className="view-notifications" disabled={!unread} onClick={()=>void markAll()}>{rtl?"تحديد الكل كمقروء":"Mark all as read"}</button></div>}
function dateForNotification(value:unknown,rtl:boolean){return value?new Intl.DateTimeFormat(localeFor(rtl),{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(String(value))):"";}
