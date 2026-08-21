import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/api/operations/production-readiness/route.ts", import.meta.url), "utf8");

test("production readiness endpoint is Super-Admin-only and permission protected", () => {
  assert.match(source, /actor\.roleName !== "Super Admin"/);
  assert.match(source, /requirePermission\(db, actor, "system_settings", "manage_settings"\)/);
  assert.match(source, /enforceRateLimit/);
});

test("production readiness endpoint returns sanitized diagnostics only", () => {
  assert.match(source, /current_database\(\)/);
  assert.match(source, /server_version/);
  assert.match(source, /0014_complete_hrms/);
  assert.match(source, /requiredTables/);
  assert.match(source, /unvalidatedForeignKeys/);
  assert.doesNotMatch(source, /DATABASE_URL|password|connectionString|hostname|current_user/i);
});
