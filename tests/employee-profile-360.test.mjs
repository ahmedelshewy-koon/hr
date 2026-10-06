import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canViewEmployeeProfile, profileFieldPolicy } from "../app/employees/profile-access.ts";

test("HR and Super Admin can open an employee profile",()=>{
  assert.equal(canViewEmployeeProfile({roleName:"HR Manager",isSelf:false,isInManagedScope:false}),true);
  assert.equal(canViewEmployeeProfile({roleName:"Super Admin",isSelf:false,isInManagedScope:false}),true);
});

test("manager access requires recursive managed scope",()=>{
  assert.equal(canViewEmployeeProfile({roleName:"Department Manager",isSelf:false,isInManagedScope:true}),true);
  assert.equal(canViewEmployeeProfile({roleName:"Department Manager",isSelf:false,isInManagedScope:false}),false);
});

test("employee can view self but not another employee",()=>{
  assert.equal(canViewEmployeeProfile({roleName:"Employee",isSelf:true,isInManagedScope:false}),true);
  assert.equal(canViewEmployeeProfile({roleName:"Employee",isSelf:false,isInManagedScope:false}),false);
});

test("manager field policy excludes private and account administration fields",()=>{
  assert.deepEqual(profileFieldPolicy({roleName:"Department Manager",canEditEmployee:false,canViewUsers:false,canEditUsers:false}),{canEdit:false,canViewPrivate:false,canViewAccount:false,canManageAccount:false});
  assert.deepEqual(profileFieldPolicy({roleName:"HR Manager",canEditEmployee:true,canViewUsers:true,canEditUsers:true}),{canEdit:true,canViewPrivate:true,canViewAccount:true,canManageAccount:true});
});

test("focused profile API is employee-scoped and contains no payroll or protected field projections",async()=>{
  const route=await readFile(new URL("../app/api/employees/[id]/route.ts",import.meta.url),"utf8");
  assert.match(route,/WHERE e\.id=\?/);assert.match(route,/MANAGED_DEPARTMENTS_CTE/);assert.match(route,/Employee is outside your access scope/);
  assert.doesNotMatch(route,/e\.salary|salary_structures|payroll_|loans_advances|bank_account|bank_iban|identification_number|password_hash|session_version|auth_user_id/);
  assert.match(route,/must_change_password/);assert.match(route,/u\.last_login_at/);
});

test("summaries read authoritative attendance, leave, requests and real alert sources",async()=>{
  const route=await readFile(new URL("../app/api/employees/[id]/route.ts",import.meta.url),"utf8");
  assert.match(route,/FROM daily_attendance WHERE employee_id=\?/);assert.match(route,/FROM leave_balances lb/);assert.match(route,/FROM requests WHERE employee_id=\?/);
  assert.match(route,/FROM attendance_exceptions WHERE employee_id=\?/);assert.match(route,/FROM attendance_corrections WHERE employee_id=\?/);
  assert.doesNotMatch(route,/INSERT INTO|UPDATE daily_attendance|UPDATE leave_balances/);
});

test("audit JSON is never returned by the employee profile route",async()=>{
  const route=await readFile(new URL("../app/api/employees/[id]/route.ts",import.meta.url),"utf8");
  assert.doesNotMatch(route,/previous_value|new_value/);
});

test("employee list opens the canonical profile workspace and edit reuses the existing form in the profile page layout",async()=>{
  const drawer=await readFile(new URL("../app/employee-drawer.tsx",import.meta.url),"utf8");
  assert.match(drawer,/if\(page\)return <section className="employee-profile360 profile360-inline profile360-edit"/);
  const app=await readFile(new URL("../app/hr-app.tsx",import.meta.url),"utf8");
  assert.match(app,/EmployeeProfile360/);assert.match(app,/if\(selected\?\.edit\)\{const back=\(\)=>setSelected\(selected\.fromProfile\?\{row:selected\.row,edit:false\}:null\);return <section className="employees-page-shell employee-profile-page"><EmployeeDetailsDrawer page /);assert.match(app,/<EmployeeProfile360 inline rtl=\{rtl\}/);assert.match(app,/setSelected\(\{row,edit:true\}\)/);
  // the profile is part of the page content (sidebar stays beside it), not a full-screen overlay
  assert.match(app,/employees-page-shell employee-profile-page/);
  const profile=await readFile(new URL("../app/employee-profile-360.tsx",import.meta.url),"utf8");
  assert.match(profile,/function ProfileShell\(\{inline/);assert.match(profile,/if\(inline\)return <>\{children\}<\/>/);
  const css=await readFile(new URL("../app/employee-profile-360.css",import.meta.url),"utf8");
  assert.match(css,/\.employee-profile360\.profile360-inline\{/);assert.match(css,/\.app:not\(\.sidebar-collapsed\) \.profile360-layer\{inset-inline-start:/);
  // the page grows with the profile (no clipped bottom) and the tabs wrap instead of scrolling sideways
  assert.match(css,/\.employees-page-shell\.employee-profile-page\{height:auto;min-height:0;overflow:visible/);assert.match(css,/\.profile360-tabs\{flex-wrap:wrap;overflow:visible/);
});

test("request history provides explicit localized filters; attendance is a month-filtered tab (2026-10-05 request)",async()=>{
  const profile=await readFile(new URL("../app/employee-profile-360.tsx",import.meta.url),"utf8");
  assert.match(profile,/id:"attendance"/);assert.match(profile,/<AttendanceTab rtl=\{rtl\} employeeId=\{employeeId\}\/>/);assert.match(profile,/function RequestsTab/);
  const tabs=await readFile(new URL("../app/employee-profile-tabs.tsx",import.meta.url),"utf8");assert.match(tabs,/tab=attendance&month=\$\{monthOf\(value\)\}/);assert.match(profile,/"تطبيق":"Apply"/);assert.match(profile,/"إعادة ضبط":"Reset"/);
});

test("employee profile does not display team or grade facts",async()=>{
  const profile=await readFile(new URL("../app/employee-profile-360.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(profile,/\['team','الفريق','Team'\]|\['grade','الدرجة','Grade'\]/);
});
