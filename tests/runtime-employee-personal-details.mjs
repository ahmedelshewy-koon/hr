// Local integration test: all fixtures created here are removed in finally.
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import postgres from "postgres";

const vars = Object.fromEntries(fs.readFileSync(".dev.vars", "utf8").split(/\r?\n/)
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1).trim().replace(/^["']|["']$/g, "")];
  }));
const sql = postgres(vars.DATABASE_URL, { max: 1 });
const base = process.env.EMPLOYEE_TEST_URL || "http://localhost:3000";
const marker = `personal-details-${Date.now()}`;
let employeeId;
try {
  const [admin] = await sql`SELECT u.id,u.email,u.session_version FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Super Admin' AND u.status='active' LIMIT 1`;
  assert.ok(admin);
  const payload = Buffer.from(JSON.stringify({ userId: admin.id, email: admin.email, sessionVersion: admin.session_version, exp: Math.floor(Date.now() / 1000) + 900 })).toString("base64url");
  const cookie = `koon_portal_session=${payload}.${crypto.createHmac("sha256", vars.KOON_AUTH_SECRET).update(payload).digest("base64url")}`;
  const [leave] = await sql`SELECT id FROM leave_types WHERE status='active' AND code<>'OFFICIAL' LIMIT 1`;
  assert.ok(leave);
  const form = { nameAr: marker, nameEn: marker, workEmail: `${marker}@example.invalid`, startDate: "2026-09-25", country: "Egypt", nationality: "Egypt", religion: "muslim", passportNumber: "A0012345", workLocation: "Egypt", leaveTypeIds: [leave.id] };
  const call = async body => {
    const response = await fetch(`${base}/api/hr`, { method: "POST", headers: { cookie, origin: base, "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.ok(response.ok, `HTTP ${response.status}: ${await response.clone().text()}`);
    return response.json();
  };
  employeeId = (await call({ action: "create_employee", ...form })).id;
  assert.ok(employeeId);
  const read = async () => (await sql`SELECT religion,passport_number,nationality,work_location FROM employees WHERE id=${employeeId}`)[0];
  assert.deepEqual(await read(), { religion: "muslim", passport_number: "A0012345", nationality: "Egypt", work_location: "Egypt" });
  await call({ ...form, action: "update_employee", employeeId, religion: "christian", passportNumber: "B0098765", nationality: "Jordan", workLocation: "Riyadh, KSA" });
  assert.deepEqual(await read(), { religion: "christian", passport_number: "B0098765", nationality: "Jordan", work_location: "Riyadh, KSA" });
  const response = await fetch(`${base}/api/hr`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const data = await response.json();
  const employee = data.employees.find(item => item.id === employeeId);
  assert.equal(employee.religion, "christian");
  assert.equal(employee.passport_number, "B0098765");
  const { religion, passportNumber, ...legacyForm } = form;
  void religion; void passportNumber;
  await call({ ...legacyForm, action: "update_employee", employeeId });
  assert.equal((await read()).passport_number, "B0098765");
  await call({ ...form, action: "update_employee", employeeId, religion: "", passportNumber: "" });
  assert.equal((await read()).religion, null);
  assert.equal((await read()).passport_number, null);
  console.log("PASS: create, edit, reload, legacy payload preservation, and clearing optional personal fields.");
} finally {
  if (!employeeId) employeeId = (await sql`SELECT id FROM employees WHERE work_email=${`${marker}@example.invalid`}`)[0]?.id;
  if (employeeId) await sql.begin(async tx => {
    await tx`DELETE FROM audit_logs WHERE record_type='employee' AND record_id=${String(employeeId)}`;
    await tx`DELETE FROM employee_leave_types WHERE employee_id=${employeeId}`;
    await tx`DELETE FROM leave_balances WHERE employee_id=${employeeId}`;
    await tx`DELETE FROM users WHERE employee_id=${employeeId}`;
    await tx`DELETE FROM employees WHERE id=${employeeId}`;
  });
  await sql.end();
}
