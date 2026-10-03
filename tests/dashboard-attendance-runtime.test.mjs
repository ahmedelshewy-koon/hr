import assert from "node:assert/strict";
import test from "node:test";

// Opt-in browser regression against a running local app. ALL API calls are intercepted;
// no real user session, device, or database is accessed by these browser fixtures.
// RUN_DASHBOARD_UI_TESTS=1; PLAYWRIGHT_MODULE may point to an installed playwright-core.
test("dashboard counts recorded check-ins independently of checkout/review status", {
  skip: process.env.RUN_DASHBOARD_UI_TESTS !== "1", timeout: 90000,
}, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core");
  const browser = await chromium.launch({ headless: true });
  const base = process.env.DASHBOARD_TEST_BASE || "http://localhost:3000";
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, timezoneId: "UTC" });
    await context.addInitScript(() => localStorage.setItem("hr-language", "en"));
    const fixture = {
      currentUser: { id: 1, email: "dashboard@test.invalid", role_name: "Super Admin", employee_id: null, allowed_pages: ["dashboard"] },
      employees: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name_en: "Test " + (i + 1), name_ar: "اختبار", employment_status: "active", country: i < 3 ? "Egypt" : "Saudi Arabia" })),
      departments: [], jobTitles: [], requests: [], attendance: [], holidays: [],
      leaveTypes: [], employeeLeaveTypes: [], leaveBalances: [], requestApprovals: [],
      roles: [], users: [], permissions: [], audit: [], settings: [], salaryStructures: [], salaryAllowances: [],
      payrollRuns: [], payrollItems: [], payrollAllowanceLines: [], loansAdvances: [], taxBrackets: [], insuranceRates: [],
    };
    const row = (employee_id, fields) => ({ id: employee_id, employee_id, work_date: "2026-09-17", attendance_type: "office", late_minutes: 0, actual_in: null, actual_out: null, ...fields });
    fixture.attendance = [
      row(1, { status: "needs_review", actual_in: "09:00" }),
      row(2, { status: "needs_review", actual_in: "09:20", late_minutes: 20 }),
      row(3, { status: "remote", attendance_type: "remote", actual_in: "08:00", actual_out: "17:00" }),
      row(4, { status: "leave" }),
      row(5, { status: "present" }), // A label alone must not fabricate a check-in.
      row(6, { status: "absent", actual_in: "09:00" }), // A stale status must not hide a real check-in.
      { ...row(1, { status: "present", actual_in: "09:00" }), id: 7, work_date: "2026-09-16" },
      row(99, { status: "present", actual_in: "09:00" }), // Outside the visible employee scope.
    ];
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-09-17T09:00:00Z") });
    let holdNext = false, heldResponse, responseHeld;
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/hr") {
        const snapshot = structuredClone(fixture);
        if (holdNext) {
          holdNext = false;
          heldResponse = () => route.fulfill({ json: snapshot });
          responseHeld();
          return;
        }
        await route.fulfill({ json: snapshot });
      } else if (path === "/api/auth") await route.fulfill({ json: { authenticated: true, user: fixture.currentUser } });
      else await route.fulfill({ json: { unread: 0, notifications: [], items: [], counts: {} } });
    });
    const open = async () => {
      await page.goto(base, { waitUntil: "networkidle" });
      await page.locator(".attendance-rate-copy b").waitFor();
    };
    const presentCount = async () => (await page.locator(".attendance-rate-copy b").innerText()).split(" of ")[0];
    const selectCountry = async name => {
      await page.getByRole("button", { name: "Work location country", exact: true }).click();
      await page.getByRole("dialog", { name: "Work location country" }).getByRole("button", { name: name === "all" ? "All work locations" : name, exact: true }).click();
      await page.keyboard.press("Escape");
    };
    await t.test("check-in without checkout is present in both cards and the summary", async () => {
      await open();
      const sidebar = page.locator("#main-sidebar");
      await sidebar.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
      const rail = await sidebar.boundingBox();
      assert.equal(rail.width, 64);
      assert.ok(rail.x >= 0, "collapsed navigation remains on screen");
      assert.equal(await sidebar.locator("nav button span").first().isVisible(), false);
      await sidebar.getByRole("button", { name: "Dashboard", exact: true }).click();
      await sidebar.getByRole("button", { name: "Expand sidebar", exact: true }).click();
      assert.ok((await sidebar.boundingBox()).width > 200);
      assert.equal(await presentCount(), "4");
      assert.equal(await page.locator(".attendance-rate-copy b").innerText(), "4 of 6 employees");
      assert.equal(await page.locator(".attendance-rate-ring strong").innerText(), "67٪");
      assert.equal(await page.locator(".attendance-kpis .on-time b").innerText(), "3");
      assert.equal(await page.locator(".attendance-kpis .late b").innerText(), "1");
      assert.equal(await page.locator(".attendance-kpis .remote b").innerText(), "1");
      assert.equal(await page.locator(".attendance-kpis .away b").innerText(), "1");
      assert.equal(await page.locator(".attendance-distribution-head b").innerText(), "1 not recorded yet");
    });
    await t.test("summary cards open matching employee details and support keyboard dismissal", async () => {
      await open();
      assert.equal(await page.locator(".stat-grid").count(), 0);
      assert.equal(await page.locator(".dashboard-grid").first().locator(".attendance-overview").count(), 1);
      for (const [label, names] of [
        ["Total employees (full time)", ["Test 1", "Test 2", "Test 3", "Test 4", "Test 5", "Test 6"]],
        ["Present today", ["Test 1", "Test 2", "Test 3", "Test 6"]],
        ["On time", ["Test 1", "Test 3", "Test 6"]],
        ["Remote", ["Test 3"]],
        ["Absent / leave", ["Test 4"]],
        ["Not recorded yet", ["Test 5"]],
        ["Late", ["Test 2"]],
      ]) {
        const card = page.getByRole("button", { name: label, exact: true });
        await card.click({ timeout: 3000 });
        const dialog = page.getByRole("dialog", { name: label });
        await dialog.waitFor();
        const bounds = await dialog.boundingBox();
        const viewport = page.viewportSize();
        assert.ok(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) < 2, "dialog is horizontally centered");
        assert.ok(Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2) < 2, "dialog is vertically centered");
        assert.deepEqual(await dialog.locator("tbody .dashboard-detail-name").allTextContents(), names);
        if (label === "Late") assert.match(await dialog.innerText(), /20/);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        assert.equal(await card.evaluate(el => el === document.activeElement), true);
      }
      await selectCountry("Saudi Arabia");
      await page.getByRole("button", { name: "Late", exact: true }).click();
      const empty = page.getByRole("dialog", { name: "Late" });
      assert.match(await empty.innerText(), /No employees to display/);
      await empty.getByRole("button", { name: "Close", exact: true }).click();
      await selectCountry("all");
    });
    await t.test("country selection filters totals and attendance and restores all employees", async () => {
      fixture.requests = [1, 4].map(id => ({ id, employee_id: id, employee_name: `Test ${id}`, status: "pending_hr", type: "leave", request_code: `REQ-${id}` }));
      fixture.holidays = [
        { id: 1, name_en: "Saudi holiday", country: "Saudi Arabia", holiday_date: "2026-09-23" },
        { id: 2, name_en: "Egypt holiday", country: "Egypt", holiday_date: "2026-10-06" },
      ];
      await open();
      await selectCountry("Egypt");
      assert.equal(await presentCount(), "3");
      assert.equal(await page.locator(".attendance-rate-copy b").innerText(), "3 of 3 employees");
      assert.equal(await page.locator(".approval-row").count(), 1);
      assert.equal(await page.locator(".request-main b").innerText(), "Test 1");
      assert.equal(await page.locator(".holiday-next b").innerText(), "Egypt holiday");
      await selectCountry("Saudi Arabia");
      assert.equal(await presentCount(), "1");
      assert.equal(await page.locator(".attendance-rate-copy b").innerText(), "1 of 3 employees");
      assert.equal(await page.locator(".attendance-kpis .away b").innerText(), "1");
      assert.equal(await page.locator(".request-main b").innerText(), "Test 4");
      assert.equal(await page.locator(".holiday-next b").innerText(), "Saudi holiday");
      await selectCountry("all");
      assert.equal(await page.locator(".attendance-rate-copy b").innerText(), "4 of 6 employees");
      assert.equal(await page.locator(".approval-row").count(), 2);
    });
    await t.test("a new device check-in refreshes the open dashboard automatically", async () => {
      fixture.attendance.find(item => item.employee_id === 5).actual_in = "09:05";
      await page.clock.fastForward(16000);
      await page.waitForFunction(() => document.querySelector(".attendance-rate-copy b")?.textContent === "5 of 6 employees", null, { timeout: 5000 });
      assert.equal(await presentCount(), "5");
      fixture.attendance.find(item => item.employee_id === 5).actual_in = null;
    });
    await t.test("an older response cannot overwrite a newer attendance snapshot", async () => {
      await open();
      const held = new Promise(resolve => { responseHeld = resolve; });
      holdNext = true;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await held;
      fixture.attendance.find(item => item.employee_id === 5).actual_in = "09:05";
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await page.waitForFunction(() => document.querySelector(".attendance-rate-copy b")?.textContent === "5 of 6 employees", null, { timeout: 5000 });
      const stale = page.waitForResponse(response => response.url().endsWith("/api/hr"));
      await heldResponse();
      await (await stale).finished();
      await page.clock.runFor(100);
      assert.equal(await presentCount(), "5", "the older response must not roll the count back to 4");
      fixture.attendance.find(item => item.employee_id === 5).actual_in = null;
    });
    await t.test("today uses Cairo's date even when UTC is still the previous day", async () => {
      await page.clock.setSystemTime(new Date("2026-09-16T22:30:00Z"));
      await open();
      assert.equal(await presentCount(), "4");
    });
    await t.test("manager totals exclude their own attendance and out-of-scope employees", async () => {
      fixture.currentUser = { ...fixture.currentUser, role_name: "Department Manager", employee_id: 1 };
      await open();
      assert.equal(await page.locator(".attendance-rate-copy b").innerText(), "3 of 5 employees");
    });
    await t.test("employee totals include only their own check-in", async () => {
      fixture.currentUser = { ...fixture.currentUser, role_name: "Employee", employee_id: 1 };
      await open();
      assert.equal(await page.locator(".attendance-rate-copy b").innerText(), "1 of 1 employees");
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
