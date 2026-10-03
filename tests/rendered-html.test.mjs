import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the HR application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>[^<]*HR/i);
  assert.match(html, /class="auth-loading"/);
  assert.match(html, /جارٍ التحقق من تسجيل الدخول/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

test("keeps starter preview assets out of the production app", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<HRApp/);
  assert.match(layout, /HR/);
  assert.match(packageJson, /"postgres"/);
  assert.doesNotMatch(page, /codex-preview|SkeletonPreview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  const previewFiles = await readdir(new URL("../app/_sites-preview", import.meta.url)).catch(error => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  assert.deepEqual(previewFiles, []);
});

test("renders workforce departments, job titles, and organization chart from API data", async () => {
  const [app, api] = await Promise.all([
    readFile(new URL("../app/hr-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/hr/route.ts", import.meta.url), "utf8"),
  ]);
  // Tables render the search-filtered projections, which are themselves derived from the API payload.
  assert.match(app, /<JobTitleTable[^>]*rows=\{shownJobTitles\}/);
  assert.match(app, /const shownJobTitles=\(data\?\.jobTitles\s*\?\?\s*\[\]\)/);
  assert.match(app, /<DepartmentGrid[^>]*rows=\{shownDepartments\}/);
  assert.match(app, /const shownDepartments=\(data\?\.departments\s*\?\?\s*\[\]\)/);
  assert.match(app, /Managing Director\|العضو المنتدب/);
  assert.match(app, /org-department-grid/);
  assert.match(app, /pageStyle\.textContent="@page \{ size: A4 landscape; margin: 8mm; \}"/);
  assert.match(app, /className="org-print-page-header"><img src="\/hr-logo\.png" alt="HR"\/><div><h1>\{title\}<\/h1><p>\{subtitle\}<\/p><\/div>/);
  assert.match(app, /title=\{rtl\?"الهيكل العام لشركة أسس"/);
  assert.match(app, /\{key:"asas-saudi",departments:asasSaudiDepartment\?/);
  assert.match(app, /\{key:"asas-egypt",departments:asasEgyptDepartment\?/);
  assert.match(app, /\{key:"koon-software",departments:koonSoftwareDepartments\}/);
  assert.match(app, /\{key:"koon-agency",departments:koonAgencyDepartments\}/);
  assert.match(app, /nodes-\$\{Math\.min\(level\.length,8\)\}/);
  assert.match(app, /<h1 className="dashboard-title">\{rtl\?"لوحة التحكم":"Dashboard"\}<\/h1>/);
  assert.match(app, /function PageHeader\(\{title,action\}/);
  assert.match(app, /rtl\?"عدد الموظفين":"Employees"/);
  assert.match(app, /rtl\?"عدد الأقسام":"Departments"/);
  assert.match(app, /rtl\?"عدد المسميات الوظيفية":"Job titles"/);
  assert.doesNotMatch(app, /rtl\?"نسبة الأقسام ذات مدير معتمد"/);
  assert.match(app, /DepartmentHierarchyDrawer/);
  assert.match(app, /save_department_hierarchy/);
  assert.match(app, /create_department_structure/);
  assert.match(app, /org-add-department/);
  assert.match(app, /\{employees\.map\(employee=><option value=\{employee\.id\} key=\{employee\.id\}>/);
  assert.match(app, /save_department_structure/);
  assert.match(app, /delete_department/);
  assert.match(app, /rtl\?"حذف القسم":"Delete department"/);
  assert.doesNotMatch(api, /manager_id=CASE WHEN id=\?::integer THEN NULL ELSE \?::integer END/);
  assert.match(api, /saveEmployeeProfile/);
  const profileService = await readFile(new URL('../app/employees/profile-update.ts', import.meta.url), 'utf8');
  assert.match(profileService, /validateEmployeeWrite/);
  assert.match(profileService, /persistAssignment/);
  assert.match(profileService, /INSERT INTO audit_logs/);
  assert.match(app, /org-team-level-input/);
  assert.match(app, /organizational_level/);
  assert.doesNotMatch(app, /Layla Alotaibi|Youssef Nassar|Commercial Director/);
});

test("provides personal account login, password change, and logout controls", async () => {
  const [app, profileMenu, authRoute, portalAuth] = await Promise.all([
    readFile(new URL("../app/hr-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/profile-menu.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/portal-auth.ts", import.meta.url), "utf8"),
  ]);
  assert.match(app, /function LoginPage/);
  assert.match(profileMenu, /profile-pop-logout/);
  assert.match(profileMenu, /onClick=\{onLogout\}/);
  assert.match(app, /onLogout=/);
  assert.match(app, /method:"DELETE"/);
  assert.match(authRoute, /verifyPassword/);
  assert.match(authRoute, /failed_login_attempts/);
  assert.match(authRoute, /export async function PATCH/);
  assert.match(app, /PasswordChange/);
  assert.match(app, /Department Manager/);
  assert.match(portalAuth, /HttpOnly; SameSite=Lax/);
  assert.match(portalAuth, /PBKDF2/);
  assert.match(portalAuth, /sessionVersion/);
});

test("creates employee login accounts only from access management with the requested default password", async () => {
  const [app, authRoute, hrRoute, employeeService] = await Promise.all([
    readFile(new URL("../app/hr-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/hr/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/employees/employee-service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(hrRoute, /action==="create_user"/);
  assert.match(hrRoute, /DEFAULT_USER_PASSWORD = "123456"/);
  assert.match(hrRoute, /must_change_password/);
  assert.match(app, /ريست إلى 123456/);
  assert.match(authRoute, /newPassword\.length<4/);
  assert.doesNotMatch(employeeService, /INSERT INTO users/);
});

test("enforces four-role server-side data scope", async () => {
  const [api, departmentScope] = await Promise.all([
    readFile(new URL("../app/api/hr/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/organization/department-scope.ts", import.meta.url), "utf8"),
  ]);
  assert.match(api, /SYSTEM_ROLES = \["Super Admin","HR Manager","Department Manager","Employee"\]/);
  // The recursive department CTE is shared rather than inlined, so assert both that
  // this route scopes through it and that the shared definition is still recursive.
  assert.match(api, /MANAGED_DEPARTMENTS_CTE/);
  assert.match(departmentScope, /WITH RECURSIVE managed/);
  assert.match(api, /canAccessEmployee/);
  assert.match(api, /You cannot approve your own request/);
  assert.match(api, /assertEmployeeManager/);
  assert.doesNotMatch(api, /const roleNames = \["Super Admin","Admin","HR Manager","HR","Direct Manager","Employee"\]/);
});
