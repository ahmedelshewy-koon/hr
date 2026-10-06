import type { PostgresDatabase } from "../../db/postgres";
import { importDeviceSnapshot, type DeviceSnapshot } from "./zkteco-service.ts";

type Row = Record<string, unknown>;
export type AttendanceAgent = { id: number; name: string };

const TOKEN_PREFIX = "hrag_";
const MAX_USERS = 20000;
const MAX_PUNCHES = 500000;
/** A running job whose agent has not reported back for this long is treated as abandoned. */
const STALE_JOB_MINUTES = 10;

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** The plain token is shown once; only its hash is stored. */
export async function newAgentToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = TOKEN_PREFIX + btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return { token, hash: await sha256(token), hint: token.slice(-4) };
}

export async function authenticateAgent(db: PostgresDatabase, request: Request): Promise<AttendanceAgent> {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1] || "";
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 100) throw new Response("Invalid connector token", { status: 401 });
  const agent = await db.prepare("SELECT id,name FROM attendance_agents WHERE token_hash=? AND enabled=1").bind(await sha256(token)).first<Row>();
  if (!agent) throw new Response("Invalid connector token", { status: 401 });
  return { id: Number(agent.id), name: String(agent.name) };
}

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

export function validIpv4(value: string) {
  const parts = value.split(".");
  return parts.length === 4 && parts.every(part => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

export function validTimezone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return Boolean(value); } catch { return false; }
}

export function parseDeviceInput(payload: Row) {
  const name = text(payload.name, 120), model = text(payload.model, 80) || "ZKTeco", ipAddress = text(payload.ipAddress, 15), timezone = text(payload.timezone, 64) || "Africa/Cairo";
  const port = Number(payload.port ?? 4370), agentId = payload.agentId === null || payload.agentId === "" || payload.agentId === undefined ? null : Number(payload.agentId);
  if (!name) throw new Response("Device name is required", { status: 400 });
  if (!validIpv4(ipAddress)) throw new Response("Enter a valid device IP address, for example 192.168.1.201", { status: 400 });
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Response("Device port must be between 1 and 65535", { status: 400 });
  if (!validTimezone(timezone)) throw new Response("Invalid time zone", { status: 400 });
  if (agentId !== null && !(Number.isInteger(agentId) && agentId > 0)) throw new Response("Invalid office connector", { status: 400 });
  return { name, model, ipAddress, port, timezone, agentId, enabled: payload.enabled === false || payload.enabled === 0 ? 0 : 1 };
}

const integer = (value: unknown, fallback = 0) => Number.isInteger(Number(value)) ? Number(value) : fallback;
function isoInstant(value: unknown) {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) throw new Response("Invalid device timestamp", { status: 400 });
  return date.toISOString();
}
function deviceUserId(value: unknown) {
  const id = String(value ?? "").trim();
  if (!id || id === "undefined" || id.length > 32) throw new Response("Invalid device user ID", { status: 400 });
  return id;
}

/** The agent is outside our trust boundary: re-validate everything it uploads. */
export function parseSnapshot(value: unknown): DeviceSnapshot {
  const raw = value && typeof value === "object" ? value as Row : {};
  if (!Array.isArray(raw.users) || !Array.isArray(raw.punches)) throw new Response("Incomplete device snapshot", { status: 400 });
  if (raw.users.length > MAX_USERS || raw.punches.length > MAX_PUNCHES) throw new Response("Device snapshot is too large", { status: 413 });
  return {
    deviceTime: isoInstant(raw.deviceTime),
    users: (raw.users as Row[]).map(user => ({ userId: deviceUserId(user?.userId), uid: integer(user?.uid), name: text(user?.name, 120) || "PIN " + String(user?.userId), role: integer(user?.role) })),
    punches: (raw.punches as Row[]).map(punch => ({ userId: deviceUserId(punch?.userId), serial: integer(punch?.serial), punchedAt: isoInstant(punch?.punchedAt), state: integer(punch?.state), verifyType: integer(punch?.verifyType) })),
  };
}

async function agentDevice(db: PostgresDatabase, agent: AttendanceAgent, deviceId: unknown) {
  const device = await db.prepare("SELECT id FROM attendance_devices WHERE id=? AND agent_id=? AND enabled=1").bind(Number(deviceId) || 0, agent.id).first<Row>();
  if (!device) throw new Response("Device is not assigned to this connector", { status: 404 });
  return Number(device.id);
}

const agentError = (value: unknown) => text(value, 300) || "Device connection failed";

/** One request per step keeps each call short; the agent drives the sequence. */
export async function handleAgentRequest(db: PostgresDatabase, agent: AttendanceAgent, request: Request, payload: Row) {
  const address = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  switch (payload.action) {
    case "poll": {
      await db.prepare("UPDATE attendance_agents SET last_seen_at=CURRENT_TIMESTAMP,last_ip=?,agent_version=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(address, text(payload.version, 40) || null, agent.id).run();
      await db.prepare(`UPDATE attendance_device_syncs SET status='failed',completed_at=CURRENT_TIMESTAMP,error='Connector stopped responding; retrying' WHERE status='running' AND started_at<CURRENT_TIMESTAMP-INTERVAL '${STALE_JOB_MINUTES} minutes' AND device_id IN (SELECT id FROM attendance_devices WHERE agent_id=?)`).bind(agent.id).run();
      const devices = (await db.prepare("SELECT d.id,d.name,d.ip_address,d.port,d.timezone,d.user_count,d.log_count,d.last_sync_at,(SELECT s.id FROM attendance_device_syncs s WHERE s.device_id=d.id AND s.status='queued' ORDER BY s.requested_at,s.id LIMIT 1) AS queued_sync_id FROM attendance_devices d WHERE d.agent_id=? AND d.enabled=1 ORDER BY d.id").bind(agent.id).all<Row>()).results;
      return { agent: agent.name, pollSeconds: 15, devices: devices.map(d => ({ id: Number(d.id), name: d.name, ipAddress: d.ip_address, port: Number(d.port), timezone: d.timezone, userCount: Number(d.user_count), logCount: Number(d.log_count), synced: Boolean(d.last_sync_at), queuedSyncId: d.queued_sync_id ? Number(d.queued_sync_id) : null })) };
    }
    case "status": {
      const deviceId = await agentDevice(db, agent, payload.deviceId);
      if (payload.online) await db.prepare("UPDATE attendance_devices SET status='online',last_seen_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=?").bind(deviceId).run();
      else await db.prepare("UPDATE attendance_devices SET status='offline',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(agentError(payload.error), deviceId).run();
      return { ok: true };
    }
    case "start": {
      const deviceId = await agentDevice(db, agent, payload.deviceId);
      const queued = await db.prepare("UPDATE attendance_device_syncs SET status='running',started_at=CURRENT_TIMESTAMP WHERE id=(SELECT id FROM attendance_device_syncs WHERE device_id=? AND status='queued' ORDER BY requested_at,id LIMIT 1) RETURNING id").bind(deviceId).first<Row>();
      if (queued) return { syncId: Number(queued.id) };
      const trigger = payload.trigger === "initial" ? "initial" : "data_changed";
      const job = await db.prepare("INSERT INTO attendance_device_syncs (device_id,status,trigger,started_at) VALUES (?,'running',?,CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING RETURNING id").bind(deviceId, trigger).first<Row>();
      if (!job) throw new Response("A sync is already running for this device", { status: 409 });
      return { syncId: Number(job.id) };
    }
    case "snapshot": {
      const deviceId = await agentDevice(db, agent, payload.deviceId);
      const syncId = Number(payload.syncId) || 0;
      const job = await db.prepare("SELECT id FROM attendance_device_syncs WHERE id=? AND device_id=? AND status='running'").bind(syncId, deviceId).first<Row>();
      if (!job) throw new Response("Sync job is no longer running", { status: 409 });
      // A manual "Sync" rebuilds every day (so missing or stale days are repaired); automatic syncs stay incremental.
      const manual = (await db.prepare("SELECT trigger FROM attendance_device_syncs WHERE id=?").bind(syncId).first<Row>())?.trigger === "manual";
      return importDeviceSnapshot(db, deviceId, syncId, parseSnapshot(payload.snapshot), { incremental: !manual });
    }
    case "fail": {
      const deviceId = await agentDevice(db, agent, payload.deviceId);
      const error = agentError(payload.error);
      await db.prepare("UPDATE attendance_devices SET status='offline',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(error, deviceId).run();
      if (payload.syncId) await db.prepare("UPDATE attendance_device_syncs SET status='failed',completed_at=CURRENT_TIMESTAMP,error=? WHERE id=? AND device_id=? AND status='running'").bind(error, Number(payload.syncId) || 0, deviceId).run();
      return { ok: true };
    }
    default:
      throw new Response("Unknown connector action", { status: 400 });
  }
}
