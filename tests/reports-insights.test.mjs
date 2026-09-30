import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { csvCell, csvColumnLabel, csvValue } from "../app/reports/report-columns.ts";
import { daysLabel, durationLabel, hasBaseline, percent, trend } from "../app/reports/report-format.ts";
import { buildHighlights } from "../app/reports/report-highlights.ts";
import { statusLabel } from "../app/reports/report-labels.ts";
import { parseReportPeriod, periodPreset, presetOf, previousPeriod } from "../app/reports/report-period.ts";

const read = file => readFile(new URL(file, import.meta.url), "utf8");
const parse = (query, today = "2026-09-25") => parseReportPeriod(new URL("https://hr.example/api/reports/insights?" + query), today);
const badRequest = query => assert.throws(() => parse(query), error => error instanceof Response && error.status === 400);

const totals = (overrides = {}) => ({ workdays: 200, attended: 198, absent: 2, leave_days: 0, late_days: 4, late_minutes: 60, early_days: 0, overtime_minutes: 0, worked_minutes: 0, remote_days: 0, missing_checkout: 0, needs_review: 0, employees: 10, ...overrides });
const quiet = (overrides = {}) => ({
  period: { from: "2026-09-01", to: "2026-09-25", days: 25 }, previous: { from: "2026-08-07", to: "2026-08-31", days: 25 }, today: "2026-09-25", generatedAt: "", scope: "company",
  workforce: { active: 10, inactive: 0, byStatus: [], byDepartment: [], byCountry: [], byType: [], byTenure: [], averageTenureYears: 1, hires: { total: 0, rows: [] }, leavers: { total: 0, rows: [] }, turnoverRate: 0, contractsEnding: { total: 0, rows: [] } },
  attendance: { through: "2026-09-25", totals: totals(), previous: totals(), daily: [], byDepartment: [], topLate: [], topAbsent: [], openExceptions: 0 },
  leave: { totals: { requests: 0, approved: 0, pending: 0, rejected: 0, approved_days: 0, previous_approved_days: 0 }, byType: [], byDepartment: [], topTakers: [], balanceYear: 2026, balances: [], highBalances: [], onLeaveToday: 0, upcoming: { total: 0, rows: [] } },
  approvals: { totals: { total: 0, approved: 0, pending_manager: 0, pending_hr: 0, rejected: 0, cancelled: 0, previous_total: 0 }, averageHours: null, byKind: [], pendingNow: { manager: 0, hr: 0, overdue: 0 }, oldest: { total: 0, rows: [] } },
  documents: null, recruitment: null, lifecycle: null, assets: null, learning: null,
  ...overrides,
});
const ids = items => items.map(item => item.id);

test("the report period defaults to this month and rejects malformed input instead of guessing", () => {
  assert.deepEqual(parse(""), { from: "2026-09-01", to: "2026-09-25", days: 25 });
  assert.deepEqual(parse("from=2026-01-01&to=2026-12-31"), { from: "2026-01-01", to: "2026-12-31", days: 365 });
  badRequest("from=2026-09-01");
  badRequest("to=2026-09-01");
  badRequest("from=2026-02-31&to=2026-03-05");
  badRequest("from=2026-09-19&to=2026-09-01");
  badRequest("from=2025-01-01&to=2026-09-19");
});

test("the previous period is the window of equal length right before the current one", () => {
  assert.deepEqual(previousPeriod({ from: "2026-09-01", to: "2026-09-25", days: 25 }), { from: "2026-08-07", to: "2026-08-31", days: 25 });
  assert.deepEqual(previousPeriod({ from: "2026-03-01", to: "2026-03-01", days: 1 }), { from: "2026-02-28", to: "2026-02-28", days: 1 });
});

test("quick periods resolve against Cairo today, including across a year boundary", () => {
  assert.deepEqual(periodPreset("this_month", "2026-09-25"), { from: "2026-09-01", to: "2026-09-25" });
  assert.deepEqual(periodPreset("last_month", "2026-01-15"), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(periodPreset("last_30", "2026-09-25"), { from: "2026-08-27", to: "2026-09-25" });
  assert.deepEqual(periodPreset("this_quarter", "2026-09-25"), { from: "2026-07-01", to: "2026-09-25" });
  assert.deepEqual(periodPreset("this_year", "2026-09-25"), { from: "2026-01-01", to: "2026-09-25" });
  assert.equal(presetOf("2026-09-01", "2026-09-25", "2026-09-25"), "this_month");
  assert.equal(presetOf("2026-09-02", "2026-09-25", "2026-09-25"), null);
});

test("figures are compared only when the earlier window holds real data", () => {
  assert.equal(percent(1, 3), 33.3);
  assert.equal(percent(1, 0), 0);
  assert.deepEqual(trend(120, 100), { direction: "up", change: 20 });
  assert.deepEqual(trend(80, 100), { direction: "down", change: 20 });
  assert.equal(trend(5, 0), null);
  assert.equal(hasBaseline(171, 1), false);
  assert.equal(hasBaseline(171, 60), true);
  assert.equal(hasBaseline(10, 5), true);
  assert.equal(durationLabel(5929, true), "98 س 49 د");
  assert.equal(durationLabel(90, false), "1h 30m");
  assert.equal(daysLabel(3, true, String), "3 أيام");
  assert.equal(daysLabel(2, true, String), "يومان");
  assert.equal(daysLabel(1, false, String), "1 day");
});

test("a quiet period says so instead of inventing problems", () => {
  const items = buildHighlights(quiet(), false);
  assert.deepEqual(ids(items), ["attendance-good", "all-clear"]);
  assert.ok(items.every(item => item.tone === "good"));
});

test("highlights are ordered from the most urgent and read in both languages", () => {
  const data = quiet({
    attendance: { ...quiet().attendance, totals: totals({ absent: 30 }), previous: totals({ absent: 6 }) },
    approvals: { ...quiet().approvals, pendingNow: { manager: 3, hr: 1, overdue: 2 }, oldest: { total: 4, rows: [{ employee_id: 1, employee_code: "E1", name_en: "A", name_ar: "أ", department_en: null, department_ar: null, request_code: "R1", kind: "leave", status: "pending_hr", stage: "hr", age_days: 9 }] } },
    workforce: { ...quiet().workforce, contractsEnding: { total: 2, rows: [] } },
  });
  const arabic = buildHighlights(data, true), english = buildHighlights(data, false);
  assert.deepEqual(arabic.map(item => item.tone), [...arabic.map(item => item.tone)].sort((a, b) => ["bad", "warn", "info", "good"].indexOf(a) - ["bad", "warn", "info", "good"].indexOf(b)));
  assert.equal(arabic[0].tone, "bad");
  assert.deepEqual(new Set(ids(arabic)), new Set(ids(english)));
  const overdue = english.find(item => item.id === "approvals-overdue");
  assert.match(overdue.text, /2 requests have waited more than 3 days/);
  assert.match(overdue.text, /oldest 9 days/);
  assert.match(arabic.find(item => item.id === "absence").text, /نسبة الغياب 15%/);
  assert.equal(english.find(item => item.id === "absence").tone, "bad");
  assert.ok(!ids(english).includes("all-clear"));
});

test("lateness is called out as rising only when the earlier window can be trusted", () => {
  const rising = (before) => quiet({ attendance: { ...quiet().attendance, totals: totals({ late_days: 60, attended: 198 }), previous: totals({ late_days: 30, ...before }) } });
  assert.ok(ids(buildHighlights(rising({ workdays: 200 }), false)).includes("late-trend"));
  assert.ok(!ids(buildHighlights(rising({ workdays: 2, attended: 2, late_days: 30 }), false)).includes("late-trend"));
});

test("document warnings only appear when the caller may see the documents report", () => {
  assert.ok(!ids(buildHighlights(quiet(), false)).some(id => id.startsWith("docs-")));
  const withDocs = quiet({ documents: { totals: { active: 10, valid: 5, expiring: 2, expired: 3, no_expiry: 0 }, byCategory: [], attention: { total: 0, rows: [] }, missing: { total: 4, byCategory: [], employees: [] } } });
  assert.deepEqual(ids(buildHighlights(withDocs, false)).filter(id => id.startsWith("docs-")), ["docs-expired", "docs-expiring", "docs-missing"]);
});

test("CSV exports use readable headings and values, and never hand Excel a formula", () => {
  assert.equal(csvColumnLabel("employee_code", true), "كود الموظف");
  assert.equal(csvColumnLabel("employee_code", false), "Employee code");
  assert.equal(csvColumnLabel("some_new_column", false), "some new column");
  assert.equal(csvValue("final_status", "hr_approved", true), "معتمد");
  assert.equal(csvValue("final_status", "pending_hr", false), "Pending hr");
  assert.equal(csvValue("mandatory", 1, true), "نعم");
  assert.equal(csvValue("employee", "pending_hr", true), "pending_hr");
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(csvCell("=HYPERLINK(\"http://evil\")"), "\"'=HYPERLINK(\"\"http://evil\"\")\"");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("-cmd|' /C calc'!A0"), "'-cmd|' /C calc'!A0");
  assert.equal(csvCell("+966 50 123 4567"), "+966 50 123 4567");
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell(null), "");
});

test("status wording never leaks raw snake_case keys into the Arabic interface", () => {
  assert.equal(statusLabel("pending_manager", true), "بانتظار المدير");
  assert.equal(statusLabel("Saudi Arabia", true), "السعودية");
  assert.equal(statusLabel("Access Card", true), "بطاقة دخول");
  assert.equal(statusLabel("brand_new_status", true), "Brand new status");
  assert.equal(statusLabel("", true), "—");
});

test("the insights endpoint is permission-gated and scoped the same way as the raw exports", async () => {
  const route = await read("../app/api/reports/insights/route.ts"), service = await read("../app/reports/report-overview-service.ts"), exportRoute = await read("../app/api/reports/route.ts");
  assert.match(route, /requirePermission\(db, actor, "reports", "view"\)/);
  assert.match(route, /parseReportPeriod/);
  assert.match(service, /MANAGED_DEPARTMENTS_CTE/);
  assert.match(service, /companyWide \? documents\(\) : null/);
  for (const area of ["recruitment", "assets", "learning"]) assert.match(service, new RegExp(`can\\.allows\\("${area}", "export"\\)`));
  assert.match(service, /can\.allows\(type, "export"\)/);
  assert.doesNotMatch(service, /password_hash|bank_iban|bank_account_number|object_key|salary/);
  assert.match(exportRoute, /searchParams\.get\("lang"\)/);
  assert.match(exportRoute, /csvColumnLabel/);
});

test("the reports page is the insights workspace, with exports as one of its tabs", async () => {
  const app = await read("../app/hr-app.tsx"), workspace = await read("../app/reports-workspace.tsx");
  assert.match(app, /<ReportsWorkspace rtl=\{rtl\} notify=\{notify\}\/>/);
  assert.doesNotMatch(app, /function ReportsPage|function TalentReportLinks/);
  assert.match(workspace, /\/api\/reports\/insights/);
  assert.match(workspace, /type === "missing_employee_data" \? "xlsx" : "csv"/);
});
