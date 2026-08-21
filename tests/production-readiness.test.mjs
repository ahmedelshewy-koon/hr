import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("marks the Arabic login surface with Arabic language and RTL direction", async () => {
  const source = await readFile(new URL("../app/hr-app.tsx", import.meta.url), "utf8");
  assert.match(source, /<main className="login-page" dir="rtl" lang="ar">/);
});

test("types nullable PostgreSQL parameters used by employee and user updates", async () => {
  const source = await readFile(new URL("../app/api/hr/route.ts", import.meta.url), "utf8");
  assert.match(source, /CASE WHEN \?::integer IS NULL THEN 1/);
  assert.match(source, /CASE WHEN \?::text IS NULL THEN must_change_password/);
});

test("uses a PostgreSQL-supported advisory lock signature for leave rollover", async () => {
  const source = await readFile(new URL("../app/leave/leave-rollover.ts", import.meta.url), "utf8");
  assert.match(source, /pg_advisory_xact_lock\(hashtextextended\(\?::text,0\)\)/);
  assert.doesNotMatch(source, /pg_advisory_xact_lock\(\?,\?,\?\)/);
});

test("returns conflict semantics for finalized attendance corrections", async () => {
  const source = await readFile(new URL("../app/attendance/attendance-service.ts", import.meta.url), "utf8");
  assert.match(source, /cause instanceof Error\?cause\.message:[^}]+\{status:409\}/);
});

test("derives dashboard absence candidates from scheduled work and exclusions", async () => {
  const source = await readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8");
  assert.match(source, /EXTRACT\(DOW FROM CURRENT_DATE\)/);
  assert.match(source, /NOT EXISTS \(SELECT 1 FROM holidays/);
  assert.match(source, /NOT EXISTS \(SELECT 1 FROM requests/);
  assert.match(source, /absentCandidates:Number\(absences\?\.count\)/);
});
