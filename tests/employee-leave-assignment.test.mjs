import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("employee leave types are persisted and legacy assignments are backfilled",()=>{
  const schema=read("db/schema.ts"),migration=read("drizzle-postgres/0017_lame_norrin_radd.sql");
  assert.match(schema,/employeeLeaveTypes = pgTable\("employee_leave_types"/);
  assert.match(schema,/idx_employee_leave_types_employee_type/);
  assert.match(migration,/INSERT INTO "employee_leave_types"/);
  assert.match(migration,/ON CONFLICT \("employee_id","leave_type_id"\) DO NOTHING/);
});

test("balances and leave submission enforce profile assignments",()=>{
  const service=read("app/leave/leave-service.ts");
  assert.match(service,/JOIN employee_leave_types elt ON elt\.employee_id=e\.id/);
  assert.match(service,/This leave type is not assigned to your employee profile/);
});

test("employee profile controls and portal filter use the same assignments",()=>{
  const api=read("app/api/hr/route.ts"),profile=read("app/employee-drawer.tsx"),portal=read("app/employee-portal-workspace.tsx"),request=read("app/employee-request-drawer.tsx");
  assert.match(api,/syncEmployeeLeaveTypes/);
  assert.match(api,/employeeLeaveTypes:employeeLeaveTypeRows\.results/);
  assert.match(profile,/Employee leave types/);
  assert.match(profile,/leaveTypeIds/);
  assert.match(portal,/assignedTypeIds\.has\(Number\(row\.id\)\)/);
  assert.match(request,/assignedTypeIds\.has\(Number\(row\.id\)\)/);
});

test("the balance list applies the profile's assignment rule to every role and skips deleted employees",()=>{
  const api=read("app/api/hr/route.ts");
  const list=api.split("\n").find(line=>line.includes("FROM leave_balances lb JOIN employees e ON e.id=lb.employee_id"));
  assert.ok(list,"balance list query is present");
  assert.match(list,/WHERE e\.employment_status!='deleted' AND \$\{employeeScope\} AND EXISTS \(SELECT 1 FROM employee_leave_types elt WHERE elt\.employee_id=lb\.employee_id AND elt\.leave_type_id=lb\.leave_type_id\)/);
  assert.doesNotMatch(list,/role_name==="Employee"\?"AND EXISTS/,"the assignment gate must not depend on the viewer's role");
  const profile=read("app/api/employees/[id]/route.ts");
  assert.match(profile,/FROM leave_balances lb JOIN employee_leave_types elt ON elt\.employee_id=lb\.employee_id AND elt\.leave_type_id=lb\.leave_type_id/);
});
