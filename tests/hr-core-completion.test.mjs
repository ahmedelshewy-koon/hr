import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { categoryApplies, documentState, normalizeFilename, safeDocumentObjectKey, validateDocumentFile } from "../app/documents/document-policy.ts";
import { completedBusinessDate } from "../app/attendance/scheduled-scan-policy.ts";

const source=path=>readFile(new URL(path,import.meta.url),"utf8");

test("document state is derived and never goes stale",()=>{
  assert.equal(documentState({status:"archived",expiryDate:"2026-12-01"},"2026-08-21"),"archived");
  assert.equal(documentState({expiryDate:null},"2026-08-21"),"no_expiry");
  assert.equal(documentState({expiryDate:"2026-08-20"},"2026-08-21"),"expired");
  assert.equal(documentState({expiryDate:"2026-09-10"},"2026-08-21"),"expiring_soon");
  assert.equal(documentState({expiryDate:"2026-12-01"},"2026-08-21"),"valid");
});

test("document validation uses signatures, MIME allow-list, extension, and size",()=>{
  const pdf=new Uint8Array([37,80,68,70,45,49,46,55]);
  assert.equal(validateDocumentFile({bytes:pdf,filename:"contract.pdf",declaredMime:"application/pdf"}),"application/pdf");
  assert.throws(()=>validateDocumentFile({bytes:pdf,filename:"contract.html",declaredMime:"application/pdf"}),/extension/);
  assert.throws(()=>validateDocumentFile({bytes:new Uint8Array(),filename:"empty.pdf",declaredMime:"application/pdf"}),/Empty/);
  assert.throws(()=>validateDocumentFile({bytes:pdf,filename:"contract.pdf",declaredMime:"text/html"}),/declared type/);
});

test("R2 keys are generated, scoped, and do not reuse original filenames",()=>{
  const first=safeDocumentObjectKey(42,"national_id","application/pdf"),second=safeDocumentObjectKey(42,"national_id","application/pdf");
  assert.match(first,/^employee-documents\/42\/national_id\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.pdf$/);assert.notEqual(first,second);
  assert.equal(normalizeFilename("..\\folder\\  My\u0000 ID.pdf  "),"My ID.pdf");
});

test("required document rules apply only to matching employee context",()=>{
  assert.equal(categoryApplies({country:"Egypt",employment_type:"full_time"},{country:"Egypt",employment_type:"full_time"}),true);
  assert.equal(categoryApplies({country:"Saudi Arabia",employment_type:null},{country:"Egypt",employment_type:"full_time"}),false);
});

test("scheduled scan resolves the last completed business date in configured timezone",()=>{
  assert.equal(completedBusinessDate("Africa/Cairo",new Date("2026-08-21T23:30:00Z")),"2026-08-21");
});

test("documents API authorizes scope, keeps R2 private, versions replacements, and archives softly",async()=>{
  const list=await source("../app/api/documents/route.ts"),item=await source("../app/api/documents/[id]/route.ts");
  assert.match(list,/canAccessEmployee/);assert.match(list,/employee_can_upload/);assert.match(list,/validateDocumentFile/);assert.match(list,/safeDocumentObjectKey/);
  assert.match(item,/document_versions/);assert.match(item,/status='archived'/);assert.match(item,/Document access denied/);assert.match(item,/cache-control":"private, no-store/);
  assert.doesNotMatch(list,/publicUrl|presigned|object_key.*Response\.json/);
});

test("notifications are user-scoped, readable, deduplicated, and navigable",async()=>{
  const route=await source("../app/api/notifications/route.ts"),service=await source("../app/notifications/notification-service.ts");
  assert.match(route,/WHERE user_id=\?/);assert.match(route,/id=\? AND user_id=\?/);assert.match(route,/read_at=CURRENT_TIMESTAMP/);
  assert.match(service,/ON CONFLICT\(user_id,dedupe_key\)/);assert.match(service,/target_path/);
});

test("focused dashboard and reports use authoritative domain tables without protected exports",async()=>{
  const dashboard=await source("../app/api/dashboard/route.ts"),reports=await source("../app/api/reports/route.ts"),ui=await source("../app/hr-app.tsx");
  assert.match(dashboard,/daily_attendance/);assert.match(dashboard,/attendance_exceptions/);assert.match(dashboard,/document_categories/);assert.match(dashboard,/requests/);
  assert.match(reports,/LIMIT 10000/);assert.match(reports,/MANAGED_DEPARTMENTS_CTE/);assert.doesNotMatch(reports,/password_hash|bank_iban|bank_account_number|object_key/);
  // The only component that fetched /api/dashboard (OperationalDashboard) was unreachable
  // dead code and has been removed; the endpoint itself stays covered by the assertions
  // above and by tests/runtime-complete-hrms.mjs. See REFACTOR_REPORT.md — the focused
  // dashboard currently has no browser consumer and needs a product decision.
  assert.match(ui,/<ReportsWorkspace /);
});

test("write APIs enforce origin checks and rate limits",async()=>{
  const auth=await source("../app/api/auth/route.ts"),hr=await source("../app/api/hr/route.ts"),security=await source("../app/api/api-security.ts");
  assert.match(auth,/enforceWriteOrigin\(request\)/);assert.match(auth,/enforceRateLimit/);assert.match(hr,/enforceWriteOrigin\(request\)/);assert.match(hr,/enforceRateLimit/);
  assert.match(security,/origin\s*!==\s*expected/);assert.match(security,/security_rate_limits/);
});

test("profile histories expose bounded page based load-more and document alerts",async()=>{
  const route=await source("../app/api/employees/[id]/route.ts"),profile=await source("../app/employee-profile-360.tsx");
  assert.match(route,/OFFSET \?/);assert.match(route,/pagination:\{page,limit,hasMore/);assert.match(route,/document_categories/);
  assert.match(profile,/Load more/);assert.match(profile,/DocumentsTab/);assert.match(profile,/\/api\/documents/);
});

test("migration uses non-destructive referential integrity and code generation uses sequences",async()=>{
  const migration=await source("../drizzle-postgres/0013_hr_core_completion.sql"),hr=await source("../app/api/hr/route.ts");
  assert.match(migration,/add_fk_if_clean/);assert.match(migration,/ON DELETE RESTRICT/);assert.doesNotMatch(migration,/ON DELETE CASCADE.*documents/i);
  assert.match(hr,/pg_get_serial_sequence\('employees','id'\)/);assert.match(hr,/pg_get_serial_sequence\('requests','id'\)/);assert.doesNotMatch(hr,/COALESCE\(MAX\(id\),0\)\+1 AS next FROM (employees|requests)/);
});
