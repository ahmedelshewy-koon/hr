import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { requireEmployeeHr, assertEmployeeHr, assertEmployeeManager, EMPLOYEE_MANAGER_SQL } from "../app/employees/hr-assignment.ts";

function fixture() {
  const employees = new Map([[1,{company:1,country:"Egypt",hr:10}],[2,{company:1,country:"Egypt",hr:20}],[3,{company:2,country:"Saudi Arabia",hr:null}]]);
  const users = new Map([[10,{status:"active",role:"HR Manager",responsible:"active"}],[20,{status:"active",role:"Super Admin",responsible:"active"}]]);
  const db = {prepare(sql) {
    if(sql.includes("to_regclass"))return {async first(){return {ready:false};}};
    assert.match(sql,/u.id=e.hr_user_id/);
    assert.match(sql,/u.status='active'/);
    assert.match(sql,/h.status='active'/);
    assert.match(sql,/u.employee_id<>e.id/);
    assert.match(sql,/he.employment_status IN/);
    assert.match(sql,/r.name IN \('HR Manager','Super Admin'\)/);
    return {bind(employeeId) {return {async first() {
      const id=employees.get(employeeId)?.hr,u=users.get(id);
      if(u?.employeeId===employeeId || (u?.employeeId && !["active","probation","notice_period"].includes(u.employmentStatus)))return null;
      return u?.status==="active"&&u.responsible==="active"&&["HR Manager","Super Admin"].includes(u.role)?{id}:null;
    }}}};
  }};
  return {db,employees,users};
}

test("employees in the same company and country route to their own assigned HR",async()=>{
  const {db}=fixture();
  assert.equal(await requireEmployeeHr(db,1),10);
  assert.equal(await requireEmployeeHr(db,2),20);
  await assertEmployeeHr(db,1,10);
  await assert.rejects(assertEmployeeHr(db,1,20),error=>error instanceof Response&&error.status===403);
  await assertEmployeeHr(db,2,20);
});

test("missing HR blocks submission with an Arabic conflict response",async()=>{
  const {db}=fixture();
  try {await requireEmployeeHr(db,3);assert.fail("must reject");}
  catch(error) {assert.equal(error.status,409);assert.match(await error.text(),/مسؤول موارد بشرية نشط/);}
});

test("reassignment takes effect for existing requests and disabled users cannot act",async()=>{
  const {db,employees,users}=fixture();
  employees.get(1).hr=20;
  await assert.rejects(assertEmployeeHr(db,1,10),error=>error.status===403);
  await assertEmployeeHr(db,1,20);
  users.get(20).status="inactive";
  await assert.rejects(requireEmployeeHr(db,1),error=>error.status===409);
  users.get(20).status="active";
  users.get(20).responsible="inactive";
  await assert.rejects(requireEmployeeHr(db,1),error=>error.status===409);
  users.get(20).responsible="active";
  users.get(20).role="Employee";
  await assert.rejects(requireEmployeeHr(db,1),error=>error.status===409);
});

test("request services validate routing before writes and HR notifications use assignment",async()=>{
  const leave=await readFile(new URL("../app/leave/leave-service.ts",import.meta.url),"utf8");
  const attendance=await readFile(new URL("../app/attendance/attendance-service.ts",import.meta.url),"utf8");
  const notifications=await readFile(new URL("../app/notifications/notification-service.ts",import.meta.url),"utf8");
  assert.ok(leave.indexOf("requireEmployeeHr(tx, employee.id)")<leave.indexOf("INSERT INTO requests"));
  assert.match(leave,/const managerApproval=true,hrApproval=true/);
  assert.ok(attendance.indexOf("requireEmployeeHr(tx,employeeId)")<attendance.indexOf("INSERT INTO attendance_corrections"));
  assert.match(notifications,/DELETE FROM notifications n/);
  assert.match(notifications,/FROM requests q JOIN employees e ON e.id=q.employee_id JOIN users u ON u.id=\$\{hrSql\}/);
  assert.match(notifications,/c.status='pending_hr' AND u.id=\$\{hrSql\}/);
});

test("HR cannot approve themselves or act after their employment becomes inactive",async()=>{
  const {db,users}=fixture();
  users.get(10).employeeId=1;users.get(10).employmentStatus="active";
  await assert.rejects(requireEmployeeHr(db,1),error=>error.status===409);
  users.get(10).employeeId=9;users.get(10).employmentStatus="terminated";
  await assert.rejects(requireEmployeeHr(db,1),error=>error.status===409);
});

test("direct manager authorization rejects another manager and self approval",async()=>{
  const db={prepare(sql){assert.ok(sql.includes(EMPLOYEE_MANAGER_SQL));return {bind(){return {async first(){return {manager_id:7};}};}};}};
  await assertEmployeeManager(db,1,7);
  await assert.rejects(assertEmployeeManager(db,1,8),error=>error.status===403);
  await assert.rejects(assertEmployeeManager(db,7,7),error=>error.status===403);
  await assert.rejects(assertEmployeeManager(db,1,null),error=>error.status===403);
  assert.match(EMPLOYEE_MANAGER_SQL,/NULLIF\(e.manager_id,e.id\)/);
  assert.match(EMPLOYEE_MANAGER_SQL,/NULLIF\(pd.manager_employee_id,e.id\)/);
});
