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
