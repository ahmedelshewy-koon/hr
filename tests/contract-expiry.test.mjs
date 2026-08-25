import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CONTRACT_EXPIRY_WARNING_DAYS, defaultContractEndDate, resolvedContractEndDate } from "../app/employees/contract-policy.ts";

test("defaults a work contract to one inclusive year",()=>{
  assert.equal(defaultContractEndDate("2025-12-01"),"2026-11-30");
  assert.equal(defaultContractEndDate("2024-02-29"),"2025-02-28");
  assert.equal(resolvedContractEndDate("2025-12-01","2026-06-30"),"2026-06-30");
  assert.equal(CONTRACT_EXPIRY_WARNING_DAYS,30);
});

test("warns the employee, direct manager, and HR about contract expiry",async()=>{
  const [dashboard,notifications,app]=await Promise.all([
    readFile(new URL("../app/api/dashboard/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../app/notifications/notification-service.ts",import.meta.url),"utf8"),
    readFile(new URL("../app/hr-app.tsx",import.meta.url),"utf8"),
  ]);
  assert.match(dashboard,/kind:"contract_expiring"/);
  assert.match(notifications,/u\.employee_id=e\.id/);
  assert.match(notifications,/u\.employee_id=e\.manager_id/);
  assert.match(notifications,/r\.name IN \('Super Admin','HR Manager'\)/);
  assert.match(notifications,/contract_expiring_soon/);
  assert.match(app,/عقد العمل قارب على الانتهاء/);
});
