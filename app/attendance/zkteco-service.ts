import { validateEmployeeWrite } from '../organization/assignment-service.ts';
import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";
import { recalculateAttendance } from "./attendance-service.ts";
import { aggregateBiometricPunches, localParts, uniqueFingerprintMatch, type BiometricPunch } from "./biometric-policy.ts";

type DB = PostgresDatabase | TransactionDatabase;
type Row = Record<string, unknown>;
export type DeviceSnapshot = {
  deviceTime: string;
  users: { userId: string; uid: number; name: string; role: number }[];
  punches: { userId: string; serial: number; punchedAt: string; state: number; verifyType: number }[];
};

function object(value: unknown): Row {
  try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}

export async function rebuildDeviceUserAttendance(db: DB, deviceId: number, deviceUserId: string) {
  const user = await db.prepare("SELECT du.employee_id,d.name AS device_name,d.ip_address,d.timezone,e.check_in_time,e.check_out_time FROM attendance_device_users du JOIN attendance_devices d ON d.id=du.device_id JOIN employees e ON e.id=du.employee_id AND e.employment_status!='deleted' WHERE du.device_id=? AND du.device_user_id=?")
    .bind(deviceId, deviceUserId).first<Row>();
  const employeeId = Number(user?.employee_id);
  if (!user || !employeeId) return { dates: 0, logs: 0 };
  // Same employee lock as portal attendance; the device lock also serializes mapping.
  await db.prepare("SELECT pg_advisory_xact_lock(?)").bind(employeeId).run();
  await db.prepare("UPDATE attendance_device_punches SET employee_id=? WHERE device_id=? AND device_user_id=? AND employee_id IS NULL").bind(employeeId, deviceId, deviceUserId).run();
  const pending = (await db.prepare("SELECT id,punched_at FROM attendance_device_punches WHERE device_id=? AND device_user_id=? AND employee_id=? AND attendance_log_id IS NULL ORDER BY punched_at,id").bind(deviceId, deviceUserId, employeeId).all<Row>()).results;
  for (const punch of pending) {
    const inserted = await db.prepare("INSERT INTO attendance_logs (employee_id,event_at,event_type,source,device,location,created_at) VALUES (?,?,'biometric_punch','biometric',?,?,CURRENT_TIMESTAMP) RETURNING id").bind(employeeId, punch.punched_at, user.device_name, user.ip_address).first<{ id: number }>();
    await db.prepare("UPDATE attendance_device_punches SET attendance_log_id=? WHERE id=?").bind(inserted!.id, punch.id).run();
  }
  const timezone = String(user.timezone);
  const punches = (await db.prepare("SELECT punched_at,punch_type FROM attendance_device_punches WHERE employee_id=? ORDER BY punched_at,id").bind(employeeId).all<BiometricPunch & Row>()).results;
  const days = aggregateBiometricPunches(punches, timezone, String(user.check_in_time || "09:00"), String(user.check_out_time || "17:00"));
  for (const day of days) {
    await db.prepare("SELECT pg_advisory_xact_lock(?,?)").bind(employeeId, Number(day.workDate.replaceAll("-", ""))).run();
    const corrections = (await db.prepare("SELECT requested_values,correction_type FROM attendance_corrections WHERE employee_id=? AND attendance_date=? AND status='resolved' AND current_stage='completed' ORDER BY resolved_at,created_at,id").bind(employeeId, day.workDate).all<Row>()).results;
    const corrected = corrections.reduce<Row>((result, row) => ({ ...result, ...object(row.requested_values) }), {});
    const protectedExceptions = (await db.prepare("SELECT id,status,resolved_at,correction_id FROM attendance_exceptions WHERE employee_id=? AND attendance_date=? AND status IN ('dismissed','correction_requested','pending_manager','pending_hr')").bind(employeeId, day.workDate).all<Row>()).results;
    const portal = (await db.prepare("SELECT event_type,to_char(event_at AT TIME ZONE ?,'HH24:MI') AS event_time FROM attendance_logs WHERE employee_id=? AND source!='biometric' AND (event_at AT TIME ZONE ?)::date=?::date AND event_type IN ('check_in','check_out') ORDER BY event_at").bind(timezone, employeeId, timezone, day.workDate).all<Row>()).results;
    const inTimes = [day.actualIn, ...portal.filter(p => p.event_type === "check_in").map(p => String(p.event_time))].sort();
    const outTimes = [day.actualOut, ...portal.filter(p => p.event_type === "check_out").map(p => String(p.event_time))].filter(Boolean).sort();
    await recalculateAttendance(db, employeeId, day.workDate, {
      actual_in: corrected.actual_in !== undefined ? corrected.actual_in : inTimes[0],
      actual_out: corrected.actual_out !== undefined ? corrected.actual_out : day.actualOut && String(user.check_out_time) <= String(user.check_in_time) ? day.actualOut : outTimes.at(-1) || null,
      attendance_type: corrected.attendance_type ?? "office",
      day_complete: day.workDate < localParts(new Date(), timezone).date,
    });
    for (const exception of protectedExceptions) await db.prepare("UPDATE attendance_exceptions SET status=?,resolved_at=?,correction_id=? WHERE id=?").bind(exception.status, exception.resolved_at, exception.correction_id, exception.id).run();
    for (const correction of corrections) {
      const exceptionType = correction.correction_type === "late_justification" ? "late_arrival" : correction.correction_type === "early_departure_justification" ? "early_departure" : null;
      if (exceptionType) await db.prepare("UPDATE attendance_exceptions SET status='resolved',resolved_at=COALESCE(resolved_at,CURRENT_TIMESTAMP) WHERE employee_id=? AND attendance_date=? AND exception_type=? AND status='open'").bind(employeeId, day.workDate, exceptionType).run();
    }
    await db.prepare("UPDATE daily_attendance SET note=COALESCE(note,?) WHERE employee_id=? AND work_date=?").bind("Biometric: " + user.device_name, employeeId, day.workDate).run();
  }
  return { dates: days.length, logs: pending.length };
}

export async function importDeviceSnapshot(db: PostgresDatabase, deviceId: number, syncId: number, snapshot: DeviceSnapshot) {
  return db.transaction(async tx => {
    await tx.prepare("SELECT pg_advisory_xact_lock(904370,?)").bind(deviceId).run();
    const employees = (await tx.prepare("SELECT * FROM employees WHERE employment_status!='deleted'").all<{ id: number; fingerprint_code: string | null }>()).results;
    await tx.prepare("UPDATE attendance_device_users SET enabled=0 WHERE device_id=?").bind(deviceId).run();
    for (const user of snapshot.users) {
      await tx.prepare("INSERT INTO attendance_device_users (device_id,device_user_id,device_uid,employee_id,display_name,privilege,enabled,last_seen_at) VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(device_id,device_user_id) DO UPDATE SET device_uid=excluded.device_uid,employee_id=COALESCE(attendance_device_users.employee_id,excluded.employee_id),display_name=excluded.display_name,privilege=excluded.privilege,enabled=1,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP")
        .bind(deviceId, user.userId, user.uid, uniqueFingerprintMatch(employees, user.userId), user.name, user.role).run();
    }
    let imported = 0;
    for (const punch of snapshot.punches) {
      const inserted = await tx.prepare("INSERT INTO attendance_device_punches (device_id,device_user_id,punch_serial,punched_at,punch_type,verify_type) VALUES (?,?,?,?,?,?) ON CONFLICT(device_id,device_user_id,punched_at,punch_type,verify_type) DO NOTHING RETURNING id")
        .bind(deviceId, punch.userId, punch.serial, punch.punchedAt, punch.state, punch.verifyType).first<Row>();
      if (inserted) imported++;
    }
    const mappings = (await tx.prepare("SELECT device_user_id FROM attendance_device_users WHERE device_id=? AND employee_id IS NOT NULL ORDER BY employee_id").bind(deviceId).all<Row>()).results;
    let dates = 0;
    for (const mapping of mappings) dates += (await rebuildDeviceUserAttendance(tx, deviceId, String(mapping.device_user_id))).dates;
    const unmatched = await tx.prepare("SELECT count(*)::integer AS count FROM attendance_device_users WHERE device_id=? AND employee_id IS NULL AND enabled=1").bind(deviceId).first<{ count: number }>();
    await tx.prepare("UPDATE attendance_devices SET status='online',device_time=?,user_count=?,log_count=?,last_seen_at=CURRENT_TIMESTAMP,last_sync_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(snapshot.deviceTime, snapshot.users.length, snapshot.punches.length, deviceId).run();
    await tx.prepare("UPDATE attendance_device_syncs SET status='success',completed_at=CURRENT_TIMESTAMP,users_found=?,punches_found=?,punches_imported=?,unmatched_users=?,error=NULL WHERE id=?").bind(snapshot.users.length, snapshot.punches.length, imported, unmatched!.count, syncId).run();
    return { imported, unmatched: unmatched!.count, dates };
  });
}

export async function mapAttendanceDeviceUser(input: { db: PostgresDatabase; deviceUserId: number; employeeId: number }) {
  const { db, deviceUserId, employeeId } = input;
  return db.transaction(async tx => {
    await tx.prepare('SELECT pg_advisory_xact_lock(78231)').run();
    const lookup = await tx.prepare("SELECT device_id FROM attendance_device_users WHERE id=?").bind(deviceUserId).first<Row>();
    if (!lookup) throw new Response("Biometric user not found", { status: 404 });
    await tx.prepare("SELECT pg_advisory_xact_lock(904370,?)").bind(lookup.device_id).run();
    const deviceUser = await tx.prepare("SELECT * FROM attendance_device_users WHERE id=? FOR UPDATE").bind(deviceUserId).first<Row>();
    const currentEmployeeId = Number(deviceUser!.employee_id) || null;
    if (currentEmployeeId && currentEmployeeId !== employeeId) throw new Response("This biometric user is already linked; historical attendance must be reviewed before reassignment.", { status: 409 });
    const employee = await tx.prepare("SELECT id,fingerprint_code FROM employees WHERE id=? AND employment_status!='deleted' FOR UPDATE").bind(employeeId).first<Row>();
    if (!employee) throw new Response("Employee not found", { status: 404 });
    const fingerprint = String(deviceUser!.device_user_id);
    const conflict = await tx.prepare("SELECT id FROM attendance_device_users WHERE device_id=? AND employee_id=? AND id<>? UNION ALL SELECT id FROM employees WHERE fingerprint_code=? AND id<>? AND employment_status!='deleted' LIMIT 1").bind(deviceUser!.device_id, employeeId, deviceUserId, fingerprint, employeeId).first<Row>();
    if (conflict) throw new Response("The employee or fingerprint number is already linked", { status: 409 });
    if (employee.fingerprint_code && String(employee.fingerprint_code) !== fingerprint) throw new Response("The employee already has a different fingerprint code", { status: 409 });
    await tx.prepare("UPDATE attendance_device_users SET employee_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(employeeId, deviceUserId).run();
    await validateEmployeeWrite(tx,employeeId,{},employee);
    await tx.prepare("UPDATE employees SET fingerprint_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(fingerprint, employeeId).run();
    const rebuilt = await rebuildDeviceUserAttendance(tx, Number(deviceUser!.device_id), fingerprint);
    return { ok: true, ...rebuilt, deviceId: Number(deviceUser!.device_id), deviceUserId: fingerprint, employeeId };
  });
}
