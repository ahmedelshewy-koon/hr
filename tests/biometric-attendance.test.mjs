import assert from "node:assert/strict";
import test from "node:test";
import { aggregateBiometricPunches, localParts, uniqueFingerprintMatch } from "../app/attendance/biometric-policy.ts";
import { importDeviceSnapshot, mapAttendanceDeviceUser } from "../app/attendance/zkteco-service.ts";
import { readBiometricWorkspace } from "../app/attendance/biometric-query.ts";
import { databaseAdapter, loadLocalEnvironment, runtimeDatabase } from "../scripts/zkteco-runtime.mjs";

const punch = value => ({ punched_at: value });
test("Cairo time keeps midnight punches on the company-local date and respects DST", () => {
  assert.deepEqual(localParts("2026-09-16T22:30:00Z"), { date: "2026-09-17", time: "01:30", seconds: "01:30:00" });
  assert.equal(localParts("2026-01-15T07:00:00Z").time, "09:00");
});
test("nearby door scans still use the first and last timestamps without a one-minute filter", () => {
  const result = aggregateBiometricPunches([punch("2026-09-15T06:00:00Z"), punch("2026-09-15T06:00:10Z"), punch("2026-09-15T06:00:40Z")], "Africa/Cairo");
  assert.deepEqual(result, [{ workDate: "2026-09-15", actualIn: "09:00", actualOut: "09:00", count: 3 }]);
});

test("the final scan is used even if it is only seconds after the previous door scan", () => {
  const result = aggregateBiometricPunches([punch("2026-09-15T14:01:10Z"), punch("2026-09-15T06:00:00Z"), punch("2026-09-15T09:00:00Z"), punch("2026-09-15T09:30:00Z"), punch("2026-09-15T14:00:50Z")], "Africa/Cairo");
  assert.deepEqual(result, [{ workDate: "2026-09-15", actualIn: "09:00", actualOut: "17:01", count: 5 }]);
});

test("one timestamp has no checkout, including duplicate copies of that same event", () => {
  for (const punches of [[punch("2026-09-15T06:00:00Z")], [punch("2026-09-15T06:00:00Z"), punch("2026-09-15T06:00:00Z")]]) {
    assert.deepEqual(aggregateBiometricPunches(punches, "Africa/Cairo"), [{ workDate: "2026-09-15", actualIn: "09:00", actualOut: null, count: 1 }]);
  }
});

test("door movements update one daily first/last pair rather than creating attendance sessions", () => {
  const punches = [punch("2026-09-15T06:00:00Z"), punch("2026-09-15T09:00:00Z"), punch("2026-09-15T09:30:00Z")];
  assert.deepEqual(aggregateBiometricPunches(punches, "Africa/Cairo"), [{ workDate: "2026-09-15", actualIn: "09:00", actualOut: "12:30", count: 3 }]);
  assert.deepEqual(aggregateBiometricPunches([...punches, punch("2026-09-15T14:00:00Z")], "Africa/Cairo"), [{ workDate: "2026-09-15", actualIn: "09:00", actualOut: "17:00", count: 4 }]);
});
test("unordered punches produce first/last attendance and overnight checkout stays on shift date", () => {
  const result = aggregateBiometricPunches([punch("2026-09-16T03:00:00Z"), punch("2026-09-15T19:00:00Z")], "Africa/Cairo", "22:00", "06:00");
  assert.deepEqual(result, [{ workDate: "2026-09-15", actualIn: "22:00", actualOut: "06:00", count: 2 }]);
});
test("automatic linking requires exactly one fingerprint code match, never a name or internal ID", () => {
  const employees = [{ id: 9, fingerprint_code: "11" }, { id: 11, fingerprint_code: null }];
  assert.equal(uniqueFingerprintMatch(employees, "11"), 9);
  assert.equal(uniqueFingerprintMatch(employees, "9"), null);
  assert.equal(uniqueFingerprintMatch([...employees, { id: 12, fingerprint_code: "11" }], "11"), null);
});

test("PostgreSQL import is idempotent, preserves approved corrections, and backfills explicitly linked users", { skip: process.env.RUN_BIOMETRIC_DB_TESTS !== "1" }, async () => {
  loadLocalEnvironment();
  const db = runtimeDatabase();
  const rollback = new Error("ROLLBACK_BIOMETRIC_TEST");
  try {
    await assert.rejects(db.client.begin(async sql => {
      const tx = databaseAdapter(sql);
      const deviceId = -904370, employeeId = -904371, secondEmployeeId = -904372;
      await tx.prepare("INSERT INTO attendance_devices(id,name,model,ip_address,timezone) VALUES (?,'Test','Test','192.0.2.147','Africa/Cairo')").bind(deviceId).run();
      await tx.prepare("INSERT INTO attendance_device_syncs(id,device_id,status) VALUES (-904370,?,'running')").bind(deviceId).run();
      for (const [id, code] of [[employeeId, 'BIO-TEST-A'], [secondEmployeeId, null]]) {
        await tx.prepare("INSERT INTO employees(id,employee_code,name_en,name_ar,work_email,start_date,country,fingerprint_code,work_days) VALUES (?,?,'Biometric test','اختبار',?,'2026-01-01','Egypt',?,'0,1,2,3,4,5,6')").bind(id, "BIO-TEST-" + id, "biometric-" + id + "@test.invalid", code).run();
      }
      const snapshot = {
        deviceTime: "2026-09-15T14:00:00Z",
        users: [{ userId: "BIO-TEST-A", uid: 1, name: "Test A", role: 0 }, { userId: "BIO-TEST-B", uid: 2, name: "Test B", role: 0 }],
        punches: [{ userId: "BIO-TEST-A", serial: 1, punchedAt: "2026-09-15T06:10:00Z", state: 0, verifyType: 1 }, { userId: "BIO-TEST-A", serial: 2, punchedAt: "2026-09-15T14:00:00Z", state: 0, verifyType: 1 }, { userId: "BIO-TEST-B", serial: 3, punchedAt: "2026-09-15T06:00:00Z", state: 0, verifyType: 1 }],
      };
      assert.equal((await importDeviceSnapshot(tx, deviceId, -904370, snapshot)).imported, 3);
      assert.equal((await importDeviceSnapshot(tx, deviceId, -904370, snapshot)).imported, 0);
      assert.equal((await tx.prepare("SELECT count(*)::integer AS n FROM attendance_logs WHERE employee_id=?").bind(employeeId).first()).n, 2);
      const daily = await tx.prepare("SELECT * FROM daily_attendance WHERE employee_id=? AND work_date='2026-09-15'").bind(employeeId).first();
      assert.equal(daily.actual_in, "09:10"); assert.equal(daily.actual_out, "17:00"); assert.equal(daily.worked_minutes, 470);
      await tx.prepare("INSERT INTO attendance_corrections (employee_id,attendance_date,correction_type,requested_values,reason,status,current_stage,requested_by_user_id,resolved_at) VALUES (?,'2026-09-15','manual',?,'test','resolved','completed',1,CURRENT_TIMESTAMP)").bind(employeeId, JSON.stringify({ actual_in: "09:00" })).run();
      await importDeviceSnapshot(tx, deviceId, -904370, snapshot);
      assert.equal((await tx.prepare("SELECT actual_in FROM daily_attendance WHERE employee_id=? AND work_date='2026-09-15'").bind(employeeId).first()).actual_in, "09:00");
      const unmapped = await tx.prepare("SELECT id FROM attendance_device_users WHERE device_id=? AND device_user_id='BIO-TEST-B'").bind(deviceId).first();
      await assert.rejects(mapAttendanceDeviceUser({ db: tx, deviceUserId: unmapped.id, employeeId }), error => error instanceof Response && error.status === 409);
      const linked = await mapAttendanceDeviceUser({ db: tx, deviceUserId: unmapped.id, employeeId: secondEmployeeId });
      assert.equal(linked.logs, 1);
      const single = await tx.prepare("SELECT actual_in,actual_out FROM daily_attendance WHERE employee_id=?").bind(secondEmployeeId).first();
      assert.equal(single.actual_in, "09:00"); assert.equal(single.actual_out, null);
      assert.equal((await tx.prepare("SELECT count(*)::integer AS n FROM attendance_device_punches WHERE device_id=?").bind(deviceId).first()).n, 3);
      const doorMovements = { ...snapshot, punches: [...snapshot.punches,
        { userId: "BIO-TEST-B", serial: 4, punchedAt: "2026-09-15T06:00:20Z", state: 0, verifyType: 1 },
        { userId: "BIO-TEST-B", serial: 5, punchedAt: "2026-09-15T06:01:00Z", state: 0, verifyType: 1 },
        { userId: "BIO-TEST-A", serial: 6, punchedAt: "2026-09-15T09:00:00Z", state: 0, verifyType: 1 },
      ] };
      assert.equal((await importDeviceSnapshot(tx, deviceId, -904370, doorMovements)).imported, 3);
      assert.equal((await importDeviceSnapshot(tx, deviceId, -904370, doorMovements)).imported, 0);
      const rawView = await readBiometricWorkspace(tx, new URL("http://localhost/api/hr?view=biometric&tab=punches&date=2026-09-15&q=BIO-TEST-B"));
      assert.equal(rawView.total, 3, "all three door events remain visible in raw punches");
      const dailyView = await readBiometricWorkspace(tx, new URL("http://localhost/api/hr?view=biometric&tab=daily&date=2026-09-15&q=BIO-TEST-" + secondEmployeeId));
      assert.equal(dailyView.total, 1, "one employee-day, not one row per door movement");
      assert.equal(dailyView.records[0].actual_in, "09:00");
      assert.equal(dailyView.records[0].actual_out, "09:01");
      assert.equal((await tx.prepare("SELECT actual_in FROM daily_attendance WHERE employee_id=? AND work_date='2026-09-15'").bind(employeeId).first()).actual_in, "09:00", "approved corrections stay protected");
      throw rollback;
    }), error => error === rollback);
  } finally { await db.close(); }
});
