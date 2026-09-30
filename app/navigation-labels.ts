/**
 * One approved name per page.
 *
 * The sidebar, page headers, the permission matrix, the page-availability switches and
 * the report cards all read from this table so a module never appears under two
 * different names. It is deliberately React-free so the routing helpers below can be
 * unit-tested with `node --test`.
 */
export type PageId =
  | "dashboard" | "portal" | "approvals" | "employees" | "leave" | "attendance"
  | "recruitment" | "lifecycle" | "assets" | "learning" | "org"
  | "users" | "reports" | "payroll" | "settings";

export const PAGE_LABELS: Record<PageId, { en: string; ar: string }> = {
  dashboard: { en: "Dashboard", ar: "لوحة التحكم" },
  portal: { en: "Employee Portal", ar: "بوابة الموظف" },
  approvals: { en: "Approvals", ar: "الاعتمادات" },
  employees: { en: "Employees", ar: "الموظفون" },
  leave: { en: "Leave Management", ar: "إدارة الإجازات" },
  attendance: { en: "Attendance", ar: "الحضور والانصراف" },
  recruitment: { en: "Recruitment", ar: "التوظيف" },
  lifecycle: { en: "Onboarding & Offboarding", ar: "التهيئة وإنهاء الخدمة" },
  assets: { en: "Assets", ar: "العهد والأصول" },
  learning: { en: "Learning & Development", ar: "التعلم والتطوير" },
  org: { en: "Organization Chart", ar: "الهيكل التنظيمي" },
  users: { en: "Users", ar: "المستخدمون" },
  reports: { en: "Reports & Exports", ar: "التقارير والتصدير" },
  payroll: { en: "Payroll", ar: "الرواتب" },
  settings: { en: "Settings", ar: "الإعدادات" },
};

export const PAGE_IDS = Object.keys(PAGE_LABELS) as PageId[];

export const pageLabel = (page: PageId, rtl: boolean) => PAGE_LABELS[page][rtl ? "ar" : "en"];

export type PageDestination = { page: PageId; employeeId?: number };

/**
 * Pages that already surface the same self-service information, used when a
 * notification points at a page the recipient cannot open. Employees receive
 * "asset assigned" and "document expiring" alerts whose stored target is a
 * management page; sending them to their own portal is better than silently
 * dropping them on the first menu item.
 */
const SELF_SERVICE_FALLBACK: Partial<Record<PageId, PageId>> = { employees: "portal", assets: "portal" };

/**
 * Resolves a stored notification `target_path` (`page` or `page?employee=<id>`) to a
 * destination the user is actually allowed to open. Returns `null` when nothing
 * suitable is accessible so the caller can explain instead of navigating somewhere
 * unrelated. Authorization is unchanged: this only ever picks from `allowedPages`.
 */
export function resolveNotificationDestination(targetPath: unknown, allowedPages: readonly string[]): PageDestination | null {
  const [pathPart, query = ""] = String(targetPath || "dashboard").trim().split("?");
  const page = pathPart.replace(/^\/+/, "") as PageId;
  if (!PAGE_IDS.includes(page)) return allowedPages.includes("dashboard") ? { page: "dashboard" } : null;
  if (allowedPages.includes(page)) {
    const employeeId = Number(new URLSearchParams(query).get("employee"));
    return page === "employees" && Number.isInteger(employeeId) && employeeId > 0 ? { page, employeeId } : { page };
  }
  const fallback = SELF_SERVICE_FALLBACK[page];
  return fallback && allowedPages.includes(fallback) ? { page: fallback } : null;
}
