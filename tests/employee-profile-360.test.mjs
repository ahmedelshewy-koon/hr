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
  assert.match(route,/WHERE e\.id=\?/);assert.match(route,/WITH RECURSIVE managed/);assert.match(route,/Employee is outside your access scope/);
  assert.doesNotMatch(route,/e\.salary|salary_structures|payroll_|loans_advances|bank_account|bank_iban|identification_number|password_hash|session_version|auth_user_id/);
  assert.match(route,/must_change_password/);assert.match(route,/u\.last_login_at/);
});

test("summaries read authoritative attendance, leave, requests and real alert sources",async()=>{
  const route=await readFile(new URL("../app/api/employees/[id]/route.ts",import.meta.url),"utf8");
  assert.match(route,/FROM daily_attendance WHERE employee_id=\?/);assert.match(route,/FROM leave_balances lb/);assert.match(route,/FROM requests WHERE employee_id=\?/);
  assert.match(route,/FROM attendance_exceptions WHERE employee_id=\?/);assert.match(route,/FROM attendance_corrections WHERE employee_id=\?/);
  assert.doesNotMatch(route,/INSERT INTO|UPDATE daily_attendance|UPDATE leave_balances/);
});

test("activity is employee-scoped and audit JSON is never returned",async()=>{
  const route=await readFile(new URL("../app/api/employees/[id]/route.ts",import.meta.url),"utf8");
  assert.match(route,/record_type='employee' AND record_id=\?/);assert.doesNotMatch(route,/previous_value|new_value/);
});

test("employee list opens the canonical profile workspace and edit reuses the existing drawer",async()=>{
  const app=await readFile(new URL("../app/hr-app.tsx",import.meta.url),"utf8");
  assert.match(app,/EmployeeProfile360/);assert.match(app,/selected\.edit\?<EmployeeDetailsDrawer/);assert.match(app,/onEdit=\{\(\)=>setSelected/);
});

test("attendance and request histories provide explicit localized filters",async()=>{
  const profile=await readFile(new URL("../app/employee-profile-360.tsx",import.meta.url),"utf8");
  assert.match(profile,/function AttendanceTab/);assert.match(profile,/function RequestsTab/);assert.match(profile,/"تطبيق":"Apply"/);assert.match(profile,/"إعادة ضبط":"Reset"/);
});
