import assert from "node:assert/strict";
import test from "node:test";
import { readBiometricWorkspace } from "../app/attendance/biometric-query.ts";
import { databaseAdapter, loadLocalEnvironment, runtimeDatabase } from "../scripts/zkteco-runtime.mjs";

test("biometric daily attendance is newest check-in first before filtering and pagination", {
  skip: process.env.RUN_BIOMETRIC_DB_TESTS !== "1",
}, async () => {
  loadLocalEnvironment();
  const db = runtimeDatabase();
  try {
    await db.client.begin(async sql => {
      // Session-local shadow tables: production rows and sequences are never changed.
      for (const table of ["employees", "departments", "attendance_devices", "attendance_device_users", "attendance_device_punches", "attendance_device_syncs", "daily_attendance"]) {
        await sql.unsafe(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS) ON COMMIT DROP`);
      }
      await sql.unsafe("INSERT INTO attendance_devices (id,name,model,ip_address) VALUES (1,'Sort fixture','Test','192.0.2.1')");
      await sql.unsafe("INSERT INTO employees (id,employee_code,name_en,name_ar,work_email,start_date,country,fingerprint_code) SELECT 1000+g,'SORT-'||g,'Employee '||lpad(g::text,2,'0'),'اختبار','sort-'||g||'@test.invalid','2026-01-01','Egypt',CASE WHEN g IN (61,62) THEN 'PAIR-'||g ELSE g::text END FROM generate_series(1,65) g");
      await sql.unsafe("INSERT INTO attendance_device_users (id,device_id,device_user_id,employee_id,display_name) SELECT id,1,id::text,id,name_en FROM employees");
      await sql.unsafe("INSERT INTO daily_attendance (id,employee_id,work_date,actual_in,actual_out,status) SELECT 1000+g,1000+g,CASE WHEN g=65 THEN '2026-09-16' ELSE '2026-09-17' END,CASE WHEN g=65 THEN '23:00' WHEN g=64 THEN '' WHEN g=63 THEN NULL WHEN g IN (61,62) THEN '09:30' ELSE to_char(TIME '08:00'+g*INTERVAL '1 minute','HH24:MI') END,CASE WHEN g=1 THEN '23:59' ELSE NULL END,'needs_review' FROM generate_series(1,65) g");
      const tx = databaseAdapter(sql);
      const read = suffix => readBiometricWorkspace(tx, new URL("http://localhost/api/hr?view=biometric&tab=daily" + suffix));
      const first = await read("");
      assert.equal(first.total, 65);
      assert.deepEqual(first.records.slice(0, 4).map(row => row.id), [1062, 1061, 1060, 1059]);
      assert.equal(first.records.length, 50);
      assert.equal(first.records.at(-1).id, 1013);
      const second = await read("&page=2");
      assert.equal(second.records[0].id, 1012);
      assert.deepEqual(second.records.slice(-3).map(row => row.id), [1064, 1063, 1065]);
      assert.equal(new Set([...first.records, ...second.records].map(row => row.id)).size, 65);
      const filtered = await read("&date=2026-09-17&q=PAIR");
      assert.equal(filtered.total, 2);
      assert.deepEqual(filtered.records.map(row => row.id), [1062, 1061]);
      const yesterday = await read("&date=2026-09-16");
      assert.deepEqual(yesterday.records.map(row => row.id), [1065]);
    });
  } finally { await db.close(); }
});
