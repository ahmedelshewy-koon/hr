import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { loadLocalEnvironment, runtimeDatabase } from "../scripts/zkteco-runtime.mjs";

loadLocalEnvironment();
const db = runtimeDatabase();
const base = process.env.BIOMETRIC_TEST_BASE || "http://localhost:3000";
function cookie(user) {
  const payload = Buffer.from(JSON.stringify({ userId: user.id, email: user.email.toLowerCase(), sessionVersion: Number(user.session_version), exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
  return "koon_portal_session=" + payload + "." + createHmac("sha256", process.env.KOON_AUTH_SECRET).update(payload).digest("base64url");
}
try {
  const actors = (await db.prepare("SELECT DISTINCT ON (r.name) u.id,u.email,u.session_version,r.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.status='active' AND r.name IN ('Super Admin','HR Manager','Department Manager','Employee') ORDER BY r.name,u.id").all()).results;
  const admin = actors.find(a => a.name === "Super Admin");
  assert.ok(admin);
  const get = (suffix, actor) => fetch(base + "/api/hr?view=biometric" + suffix, { headers: actor ? { cookie: cookie(actor) } : {} });
  assert.equal((await get("")).status, 401);
  for (const actor of actors.filter(a => ["Department Manager", "Employee"].includes(a.name))) {
    assert.equal((await get("", actor)).status, 403, actor.name + " cannot see full device records");
    const denied = await fetch(base + "/api/hr", { method: "POST", headers: { cookie: cookie(actor), origin: base, "content-type": "application/json" }, body: JSON.stringify({ action: "queue_attendance_device_sync", deviceId: 1 }) });
    assert.equal(denied.status, 403);
  }
  const response = await get("&tab=punches&date=&page=1", admin);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.devices[0].model, "ZKTeco MB2000");
  assert.ok(data.users.length > 0);
  assert.ok(data.total > 0);
  assert.equal(data.records.length, Math.min(data.total, 50));
  assert.equal(Object.keys(data.records[0]).includes("raw_data"), false);
  const second = await (await get("&tab=punches&page=2", admin)).json();
  assert.ok(!second.records.some(record => data.records.some(first => first.id === record.id)));
  const escaped = await (await get("&q=%25", admin)).json();
  assert.equal(escaped.total, 0, "wildcards are literal search input");
  const daily = await (await get("&tab=daily&date=2026-09-16", admin)).json();
  assert.ok(daily.total > 0);
  assert.ok(daily.records.every(row => row.work_date === "2026-09-16"));
  console.log(JSON.stringify({ authorization: "passed", searchAndPagination: "passed", users: data.users.length, punches: data.total, attendanceDaysForSep16: daily.total }));
} finally { await db.close(); }
