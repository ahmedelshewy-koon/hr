import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runtimeDatabase, loadLocalEnvironment } from "./zkteco-runtime.mjs";
import { importDeviceSnapshot } from "../app/attendance/zkteco-service.ts";

const execute = promisify(execFile);
const readScript = fileURLToPath(new URL("./zkteco-read.mjs", import.meta.url));

async function syncDevice(db, device, force) {
  const lease = await db.client.reserve();
  let locked = false;
  let syncId;
  try {
    const [lock] = await lease`SELECT pg_try_advisory_lock(904371,${device.id}) AS locked`;
    locked = Boolean(lock.locked);
    if (!locked) return;
    // A dead agent releases its advisory lock automatically. Recover its job here.
    await db.prepare("UPDATE attendance_device_syncs SET status='failed',completed_at=CURRENT_TIMESTAMP,error='Previous sync was interrupted; retrying' WHERE device_id=? AND status='running'").bind(device.id).run();
    const queued = await db.prepare("SELECT id FROM attendance_device_syncs WHERE device_id=? AND status='queued' ORDER BY requested_at,id LIMIT 1").bind(device.id).first();
    if (!queued && !force) {
      const { stdout } = await execute(process.execPath, [readScript, device.ip_address, String(device.port), device.timezone, "--probe"], { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true, env: { ...process.env, TZ: device.timezone } });
      const marker = stdout.split(/\r?\n/).find(line => line.startsWith("ZK_COUNTS:"));
      if (!marker) throw new Error("Device counter check failed");
      const counts = JSON.parse(marker.slice("ZK_COUNTS:".length));
      if (![counts.users, counts.punches].every(n => Number.isInteger(n) && n >= 0)) throw new Error("Invalid device counters");
      await db.prepare("UPDATE attendance_devices SET status='online',last_seen_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=?").bind(device.id).run();
      if (device.last_sync_at && counts.users === Number(device.user_count) && counts.punches === Number(device.log_count)) return;
    }
    if (queued) {
      syncId = queued.id;
      await db.prepare("UPDATE attendance_device_syncs SET status='running',started_at=CURRENT_TIMESTAMP WHERE id=?").bind(syncId).run();
    } else {
      const job = await db.prepare("INSERT INTO attendance_device_syncs (device_id,status,trigger,started_at) VALUES (?,'running',?,CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING RETURNING id").bind(device.id, force ? "command" : "data_changed").first();
      if (!job) return;
      syncId = job.id;
    }
    // Isolate the device driver so a stalled socket cannot hang the sync agent.
    const { stdout } = await execute(process.execPath, [readScript, device.ip_address, String(device.port), device.timezone], { timeout: 90000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, TZ: device.timezone } });
    const marker = stdout.split(/\r?\n/).find(line => line.startsWith("ZK_SNAPSHOT:"));
    if (!marker) throw new Error("Device download did not return a complete snapshot");
    const snapshot = JSON.parse(marker.slice("ZK_SNAPSHOT:".length));
    const result = await importDeviceSnapshot(db, Number(device.id), Number(syncId), snapshot);
    console.log(new Date().toISOString() + " [ZKTeco] " + result.imported + " new punches; " + result.unmatched + " unlinked users; " + result.dates + " attendance days.");
  } catch (error) {
    // Never copy driver output (which can contain user passwords) into logs or API responses.
    const message = error?.killed ? "Device connection timed out after 90 seconds" : error?.code ? "Device connection failed (" + String(error.code) + ")" : error instanceof Error ? error.message.slice(0, 500) : "Biometric synchronization failed";
    {
      await db.prepare("UPDATE attendance_devices SET status='offline',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(message, device.id).run();
      if (syncId) await db.prepare("UPDATE attendance_device_syncs SET status='failed',completed_at=CURRENT_TIMESTAMP,error=? WHERE id=?").bind(message, syncId).run();
    }
    console.error(new Date().toISOString() + " [ZKTeco] " + message);
    if (force) process.exitCode = 1;
  } finally {
    if (locked) await lease`SELECT pg_advisory_unlock(904371,${device.id})`;
    lease.release();
  }
}

async function run() {
  loadLocalEnvironment();
  const db = runtimeDatabase();
  const watch = process.argv.includes("--watch");
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });
  try {
    do {
      try {
        const devices = (await db.prepare("SELECT * FROM attendance_devices WHERE enabled=1 ORDER BY id").all()).results;
        for (const device of devices) await syncDevice(db, device, !watch);
      } catch (error) {
        console.error(new Date().toISOString() + " [ZKTeco] Database unavailable: " + String(error?.code || "configuration/connection error"));
        if (!watch) { process.exitCode = 1; break; }
      }
      if (!watch || stopping) break;
      await new Promise(resolve => setTimeout(resolve, 15000));
    } while (!stopping);
  } finally { await db.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run().catch(() => { console.error("Unable to start biometric agent; check DATABASE_URL and database migration."); process.exitCode = 1; });
