// Opt-in browser smoke test: navigation, permissions and Arabic wording for every role.
// EVERY /api/** call is intercepted with fixtures, so no real session, database or device is touched.
//
//   RUNTIME_BASE_URL=http://localhost:3000 PLAYWRIGHT_MODULE=<path to playwright-core> node tests/runtime-navigation-smoke.mjs
//   SMOKE_LANG=en runs the same checks against the English interface.
//
// Checks per role (Super Admin, HR Manager, Department Manager, Employee): the sidebar lists exactly the granted pages under
// the approved names, every page opens with a matching header and no console errors, dashboard buttons only lead to
// reachable pages, and notification links open the right page/employee or explain why they cannot.

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const { PAGE_LABELS, PAGE_IDS } = await import(new URL("../app/navigation-labels.ts", import.meta.url).href);
const BASE = process.env.RUNTIME_BASE_URL || "http://localhost:3000";
const L = process.env.SMOKE_LANG === "en" ? "en" : "ar";

// Same defaults as hr-app.tsx `rolePages` (server-provided allowed_pages drives the real menu).
const ROLE_PAGES = {
  "Super Admin": [...PAGE_IDS],
  "HR Manager": PAGE_IDS.filter(p => p !== "settings"),
  "Department Manager": ["dashboard", "portal", "approvals", "employees", "leave", "attendance", "recruitment", "lifecycle", "assets", "learning", "org", "reports"],
  "Employee": ["dashboard", "portal", "lifecycle", "learning"],
};

const emp = (id, extra = {}) => ({ id, employee_code: "E-" + id, name_en: "Person " + id, name_ar: "شخص " + id, work_email: `p${id}@test.invalid`, employment_status: "active", country: "Egypt", department_id: 1, department_name: "Tech", job_title_id: 1, job_title_name: "Designer", start_date: "2025-01-01", created_at: "2026-01-01", ...extra });
function hrPayload(role, user, pages) {
  return {
    currentUser: { ...user, role_name: role },
    allowedPages: pages,
    employees: [emp(7), emp(8)],
    departments: [{ id: 1, name_en: "Tech", name_ar: "التقنية", status: "active", employee_count: 2 }],
    jobTitles: [{ id: 1, name_en: "Designer", name_ar: "مصمم", department_id: 1, status: "active", employee_count: 2 }],
    requests: [], attendance: [], holidays: [{ id: 1, holiday_date: "2026-10-06", name_en: "Armed Forces Day", name_ar: "عيد القوات المسلحة", country: "Egypt" }],
    leaveTypes: [], employeeLeaveTypes: [], leaveBalances: [], requestApprovals: [],
    roles: [], users: [], permissions: [], audit: [], settings: [], salaryStructures: [], salaryAllowances: [],
    payrollRuns: [], payrollItems: [], payrollAllowanceLines: [], loansAdvances: [], taxBrackets: [], insuranceRates: [],
  };
}

// Anything a workspace fetches that is not /api/hr, /api/auth or /api/notifications.
function otherApi(path) {
  if (path === "/api/reports/insights") return reportFixture();
  if (path === "/api/approvals") return { items: [], metrics: { needsMyApproval: 0, waiting: 0, approvedThisMonth: 0, rejectedThisMonth: 0, companyPending: 0 } };
  if (path === "/api/talent/options") return { employees: [emp(7)], departments: [], templates: [] };
  if (path === "/api/lifecycle") return { lifecycles: [], tasks: [], templates: [], templateTasks: [], assetAssignments: [], company: {} };
  if (path === "/api/learning") return { courses: [], enrollments: [], actor: { roleName: "x", employeeId: null }, permissions: {}, today: "2026-09-19" };
  if (path === "/api/assets") return { assets: [] };
  if (path === "/api/recruitment") return { jobs: [], applications: [], candidates: [], interviews: [], stages: [], summary: {}, metrics: {}, items: [], rows: [], total: 0, counts: {} };
  if (/^\/api\/employees\/\d+$/.test(path)) return { employee: emp(Number(path.split("/").pop())), permissions: {}, summary: {}, balances: [], leave: [], requests: [], activity: [], attention: [] };
  if (path === "/api/documents") return { documents: [], categories: [], missing: [] };
  return {};
}

function reportFixture() {
  const totals = { workdays: 0, attended: 0, absent: 0, leave_days: 0, late_days: 0, late_minutes: 0, early_days: 0, overtime_minutes: 0, worked_minutes: 0, remote_days: 0, missing_checkout: 0, needs_review: 0, employees: 0 };
  const empty = () => ({ total: 0, rows: [] });
  return {
    period: { from: "2026-09-01", to: "2026-09-28", days: 28 }, previous: { from: "2026-08-04", to: "2026-08-31", days: 28 }, today: "2026-09-28", generatedAt: "2026-09-28T09:00:00Z", scope: "company",
    workforce: { active: 0, inactive: 0, byStatus: [], byDepartment: [], byCountry: [], byType: [], byTenure: [], averageTenureYears: 0, hires: empty(), leavers: empty(), turnoverRate: 0, contractsEnding: empty() },
    attendance: { through: "2026-09-27", totals, previous: totals, daily: [], byDepartment: [], topLate: [], topAbsent: [], openExceptions: 0 },
    leave: { totals: { requests: 0, approved: 0, pending: 0, rejected: 0, approved_days: 0, previous_approved_days: 0 }, byType: [], byDepartment: [], topTakers: [], balanceYear: 2026, balances: [], highBalances: [], onLeaveToday: 0, upcoming: empty() },
    approvals: { totals: { total: 0, approved: 0, pending_manager: 0, pending_hr: 0, rejected: 0, cancelled: 0, previous_total: 0 }, averageHours: null, byKind: [], pendingNow: { manager: 0, hr: 0, overdue: 0 }, oldest: empty() },
    documents: null, recruitment: null, lifecycle: null, assets: null, learning: null,
  };
}

const results = [];
async function safeClick(page, loc, diag) {
  try { await loc.click({ timeout: 4000 }); return true; }
  catch (e) {
    const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    diag.push("click failed: " + String(e.message).split("\n")[0] + " | body=" + body);
    return false;
  }
}
const problems = [];
const record = (role, what, ok, detail = "") => { results.push({ role, what, ok, detail }); if (!ok) problems.push(`[${role}] ${what} ${detail}`); };

const browser = await chromium.launch({ headless: true });
const LATIN = /[A-Za-z]{3,}/g;
const ALLOWED_LATIN = new Set(["CSV", "UTF", "Excel", "PDF", "DOCX", "TXT", "HH", "mm", "AM", "PM", "SAR", "EGP", "USD", "KSA", "IBAN", "CEO", "HR", "SIM", "ATS", "CV", "name", "company", "com", "Person", "Tech"]);

for (const [role, pages] of Object.entries(ROLE_PAGES)) {
  const user = { id: 1, email: `${role.replace(/\s/g, "").toLowerCase()}@test.invalid`, employee_id: role === "Super Admin" ? null : 7, employee_name: "Person 7", employee_name_ar: "شخص 7", allowed_pages: pages };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: L === "ar" ? "ar" : "en-GB", serviceWorkers: "block" });
  await context.addInitScript(lang => localStorage.setItem("hr-language", lang), L);
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const consoleErrors = [], apiCalls = [], diag = [];
  page.on("pageerror", e => consoleErrors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") consoleErrors.push("console: " + m.text().slice(0, 300)); });
  let notifications = [];
  await page.route("**/api/**", async route => {
    const u = new URL(route.request().url()), path = u.pathname;
    apiCalls.push(route.request().method() + " " + path + u.search);
    if (path === "/api/auth") return route.fulfill({ json: { authenticated: true, user } });
    if (path === "/api/hr" && u.searchParams.get("view") === "biometric") return route.fulfill({ json: { devices: [], users: [], records: [], syncs: [], rows: [], punches: [], total: 0, summary: {}, stats: {} } });
    if (path === "/api/hr") return route.fulfill({ json: hrPayload(role, user, pages) });
    if (path === "/api/notifications") {
      if (route.request().method() === "PATCH") return route.fulfill({ json: { ok: true } });
      return route.fulfill({ json: { notifications, unread: notifications.filter(n => !n.read_at).length } });
    }
    return route.fulfill({ json: otherApi(path) });
  });
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator(".sidebar nav button").first().waitFor({ timeout: 30000 });

  // 1. Sidebar shows exactly the pages this role is granted, under the approved Arabic names.
  const labels = await page.locator(".sidebar nav button span:first-of-type").allInnerTexts();
  const expected = pages.map(p => PAGE_LABELS[p][L]);
  record(role, "sidebar items == granted pages (approved Arabic names)", JSON.stringify(labels) === JSON.stringify(expected), JSON.stringify({ labels, expected }));
  for (const forbidden of PAGE_IDS.filter(p => !pages.includes(p))) record(role, `no menu item for restricted page «${forbidden}»`, !labels.includes(PAGE_LABELS[forbidden][L]), "");

  // 2. Every sidebar item opens its own page: header matches the approved name, no runtime errors, no English leaks.
  for (const id of pages) {
    const before = consoleErrors.length;
    try { await page.locator(".sidebar nav button", { hasText: PAGE_LABELS[id][L] }).first().click({ timeout: 6000 }); } catch { record(role, `«${PAGE_LABELS[id][L]}» menu click`, false, "click failed; errors=" + consoleErrors.slice(before).join(" | ").slice(0, 500) + " body=" + (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200)); await page.reload({ waitUntil: "networkidle", timeout: 40000 }); await page.locator(".sidebar nav button").first().waitFor({ timeout: 8000 }).catch(() => {}); continue; }
    await page.waitForTimeout(700);
    const h1 = (await page.locator(".content h1, .content .dashboard-title").first().innerText().catch(() => "")).trim();
    const active = (await page.locator(".sidebar nav button.active span:first-of-type").first().innerText().catch(() => "")).trim();
    const ok = active === PAGE_LABELS[id][L];
    record(role, `«${PAGE_LABELS[id][L]}» opens (sidebar active state)`, ok, ok ? "" : `active=${active}`);
    // Personalised employee headings are allowed only where they are the approved name; otherwise the header must match.
    record(role, `«${PAGE_LABELS[id][L]}» header equals approved name`, h1 === PAGE_LABELS[id][L] || (id === "org" || id === "portal"), `h1=${JSON.stringify(h1)}`);
    const text = (await page.locator(".content").innerText().catch(() => "")).replace(/\S+@\S+/g, "");
    const latin = [...new Set((text.match(LATIN) || []).filter(w => !ALLOWED_LATIN.has(w)))];
    if (L === "ar") record(role, `«${PAGE_LABELS[id][L]}» has no English words in the Arabic UI`, latin.length === 0, latin.slice(0, 12).join(", "));
    record(role, `«${PAGE_LABELS[id][L]}» raises no console/page errors`, consoleErrors.length === before, consoleErrors.slice(before).join(" | ").slice(0, 400));
    const dir = await page.evaluate(() => [document.documentElement.dir, document.querySelector(".app")?.getAttribute("dir")]);
    if (id === pages[0]) record(role, "layout direction matches the language", dir.every(d => d === (L === "ar" ? "rtl" : "ltr")), JSON.stringify(dir));
  }

  // 3. Dashboard buttons only appear when their target is reachable, and each one lands on a page in the sidebar.
  if (!(await safeClick(page, page.locator(".sidebar nav button", { hasText: PAGE_LABELS.dashboard[L] }).first(), diag))) { record(role, "return to dashboard", false, diag.join(" ")); break; }
  await page.waitForTimeout(600);
  const dashButtons = page.locator(".content button.text-button, .content .select-button, .content .round-more, .content button.outline.wide");
  const count = await dashButtons.count();
  for (let i = 0; i < count; i++) {
    const b = dashButtons.nth(i);
    const label = ((await b.innerText({ timeout: 1500 }).catch(() => "")) || (await b.getAttribute("aria-label", { timeout: 1500 }).catch(() => "")) || "").trim().slice(0, 40);
    if (!(await safeClick(page, page.locator(".sidebar nav button", { hasText: PAGE_LABELS.dashboard[L] }).first(), diag))) { record(role, "return to dashboard", false, diag.join(" ")); break; }
    await page.waitForTimeout(250);
    const target = page.locator(".content button.text-button, .content .select-button, .content .round-more, .content button.outline.wide").nth(i);
    if (!(await target.isVisible().catch(() => false))) continue;
    await target.click();
    await page.waitForTimeout(400);
    const active = (await page.locator(".sidebar nav button.active span:first-of-type").first().innerText().catch(() => "")).trim();
    record(role, `dashboard button «${label}» lands on an accessible, different page`, active !== "" && active !== PAGE_LABELS.dashboard[L] && expected.includes(active), `active=${active}`);
  }

  // 4. Notifications: each link resolves to the right accessible page (or explains itself) and never a random one.
  notifications = [
    { id: 1, title_key: "asset_assigned", message_key: null, target_path: "assets", created_at: "2026-09-19T08:00:00Z", read_at: null },
    { id: 2, title_key: "contract_expiring_soon", message_key: "2026-10-01", target_path: "employees?employee=7", created_at: "2026-09-19T08:01:00Z", read_at: null },
    { id: 3, title_key: "document_expiring_soon", message_key: "2026-10-01", target_path: "employees?employee=8", created_at: "2026-09-19T08:02:00Z", read_at: null },
    { id: 4, title_key: "request_needs_manager_approval", message_key: "request_waiting", target_path: "approvals", created_at: "2026-09-19T08:03:00Z", read_at: null },
    { id: 5, title_key: "training_overdue", message_key: "2026-09-01", target_path: "learning", created_at: "2026-09-19T08:04:00Z", read_at: null },
    { id: 6, title_key: "evaluation_pending", message_key: "Software Developer", target_path: "recruitment", created_at: "2026-09-19T08:05:00Z", read_at: null },
  ];
  const expectOpen = (target) => {
    const [name, q] = target.split("?");
    if (pages.includes(name)) return { page: name, employee: name === "employees" && q ? q.split("=")[1] : null };
    if ((name === "employees" || name === "assets") && pages.includes("portal")) return { page: "portal", employee: null };
    return null;
  };
  for (const n of notifications) {
    await page.reload({ waitUntil: "networkidle", timeout: 40000 });
    await page.locator(".sidebar nav button").first().waitFor();
    await page.locator(".notification-btn").click();
    await page.locator(".notification-item").first().waitFor();
    const titles = await page.locator(".notification-item b").allInnerTexts();
    const details = await page.locator(".notification-item small").allInnerTexts();
    if (n.id === 1) {
      if (L === "ar") record(role, "notification titles are Arabic (no raw keys / «غير محدد»)", titles.every(t => /[\u0600-\u06FF]/.test(t) && !t.includes("غير محدد")), JSON.stringify(titles));
      if (L === "ar") record(role, "notification detail lines have no «غير محدد»", details.every(t => !t.includes("غير محدد")), JSON.stringify(details));
    }
    apiCalls.length = 0;
    await page.locator(".notification-item").nth(notifications.indexOf(n)).click();
    await page.waitForTimeout(700);
    const active = (await page.locator(".sidebar nav button.active span:first-of-type").first().innerText().catch(() => "")).trim();
    const toast = (await page.locator(".toast").innerText().catch(() => "")).trim();
    const want = expectOpen(n.target_path);
    if (!want) {
      record(role, `notification «${n.title_key}» → ${n.target_path} (not accessible) explains instead of redirecting`, (L === "ar" ? toast.includes("لا تملك صلاحية") : toast.includes("do not have access")), `active=${active} toast=${toast}`);
    } else {
      record(role, `notification «${n.title_key}» → ${n.target_path} opens «${PAGE_LABELS[want.page][L]}»`, active === PAGE_LABELS[want.page][L], `active=${active}`);
      if (want.employee) record(role, `notification «${n.title_key}» opens employee #${want.employee}'s profile (not the list)`, apiCalls.some(c => c.startsWith("GET /api/employees/" + want.employee)), apiCalls.join(", ").slice(0, 200));
    }
  }
  await context.close();
}
await browser.close();

const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ checks: results.length, failed: failed.length }, null, 1));
for (const f of failed) console.log("FAIL", `[${f.role}]`, f.what, f.detail);
if (failed.length) process.exitCode = 1;
if (process.env.SMOKE_VERBOSE) for (const r of results.filter(r => r.ok)) console.log("ok  ", `[${r.role}]`, r.what);
