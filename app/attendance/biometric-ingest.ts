import type { PostgresDatabase } from "../../db/postgres";
import { localParts, uniqueFingerprintMatch } from "./biometric-policy.ts";
import { rebuildDeviceUserAttendance } from "./zkteco-service.ts";

type Row = Record<string, unknown>;
export type IngestSource = { id: number; name: string; deviceId: number };

const KEY_PREFIX = "hrk_";
export const MAX_INGEST_RECORDS = 200000;
const CHUNK = 5000;

/** Errors carry `message` because the sending program reads that field. */
export function ingestFailure(status: number, message: string) {
  return new Response(JSON.stringify({ message }), { status, headers: { "content-type": "application/json" } });
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** The plain key is shown once; only its hash is stored. */
export async function newIngestKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = KEY_PREFIX + btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return { key, hash: await sha256(key), hint: key.slice(-4) };
}

/** Accepts the raw key in `Authorization` (no Bearer needed) or `x-api-key`. */
export async function authenticateIngest(db: PostgresDatabase, request: Request): Promise<IngestSource> {
  const key = (request.headers.get("x-api-key") || request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!key.startsWith(KEY_PREFIX) || key.length > 100) throw ingestFailure(401, "Invalid API key");
  const source = await db.prepare("SELECT s.id,s.name,s.enabled,d.id AS device_id FROM attendance_ingest_sources s LEFT JOIN attendance_devices d ON d.source_id=s.id WHERE s.key_hash=?").bind(await sha256(key)).first<Row>();
  if (!source) throw ingestFailure(401, "Invalid API key");
  if (!Number(source.enabled)) throw ingestFailure(403, "This API key is disabled");
  if (!source.device_id) throw ingestFailure(500, "This source has no device configured");
  return { id: Number(source.id), name: String(source.name), deviceId: Number(source.device_id) };
}

function zoneOffsetMs(instantMs: number, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instantMs)).map(part => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - Math.floor(instantMs / 1000) * 1000;
}

/** The device sends local wall-clock time without a zone; this resolves it to the real instant (DST-safe). */
export function localToInstant(date: string, time: string, timezone: string) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi, s = 0] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let instant = wall - zoneOffsetMs(wall, timezone);
  const corrected = wall - zoneOffsetMs(instant, timezone);
  if (corrected !== instant) instant = corrected;
  return new Date(instant).toISOString();
}

export type ParsedRecords = { punches: { code: string; at: string }[]; rejected: { index: number; reason: string }[] };

export function parseIngestRecords(records: unknown[], timezone: string): ParsedRecords {
  const seen = new Set<string>();
  const punches: ParsedRecords["punches"] = [];
  const rejected: ParsedRecords["rejected"] = [];
  records.forEach((item, index) => {
    const record = (item && typeof item === "object" ? item : {}) as Row;
    const code = String(record.employee_code ?? "").trim();
    const date = String(record.date ?? "").trim(), time = String(record.time ?? "").trim();
    const reject = (reason: string) => { rejected.push({ index, reason }); };
    if (!code || code.length > 32) return reject("employee_code is required (max 32 characters)");
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
    if (!dateMatch || !timeMatch) return reject("date must be YYYY-MM-DD and time HH:MM[:SS]");
    const year = Number(dateMatch[1]);
    if (year < 2000 || year > 2100 || Number(dateMatch[2]) < 1 || Number(dateMatch[2]) > 12 || Number(dateMatch[3]) < 1 || Number(dateMatch[3]) > 31 || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59 || Number(timeMatch[3] || 0) > 59) return reject("date or time is out of range");
    const at = localToInstant(date, time.length <= 5 ? time + ":00" : time, timezone);
    // The sender repeats the device's full history, so the same punch can appear twice in one request too.
    const key = code + "|" + at;
    if (seen.has(key)) return;
    seen.add(key);
    punches.push({ code, at });
  });
  return { punches, rejected };
}

const shiftDate = (date: string, days: number) => new Date(new Date(date + "T12:00:00Z").getTime() + days * 86400000).toISOString().slice(0, 10);

/**
 * Stores pushed punches on the source's virtual device and rebuilds attendance only for the employees and days that received
 * something new. record_type is not sent, so punch_type/verify_type are fixed at 0 and the dedupe key is (device, user, time).
 */
export async function ingestRecords(db: PostgresDatabase, source: IngestSource, records: unknown[], ip: string | null) {
  const device = await db.prepare("SELECT timezone FROM attendance_devices WHERE id=?").bind(source.deviceId).first<Row>();
  const timezone = String(device?.timezone || "Africa/Cairo");
  const { punches, rejected } = parseIngestRecords(records, timezone);
  const result = await db.transaction(async tx => {
    await tx.prepare("SELECT pg_advisory_xact_lock(904370,?)").bind(source.deviceId).run();
    let inserted: { code: string; at: string }[] = [];
    const relink = new Set<string>();
    if (punches.length) {
      const codes = [...new Set(punches.map(p => p.code))];
      // Same country rule as the device sync: a country-scoped device only matches employees of that country.
      const employees = (await tx.prepare("SELECT id,fingerprint_code FROM employees WHERE employment_status!='deleted' AND (COALESCE((SELECT country FROM attendance_devices WHERE id=?),'')='' OR country=(SELECT country FROM attendance_devices WHERE id=?))").bind(source.deviceId, source.deviceId).all<{ id: number; fingerprint_code: string | null }>()).results;
      const existing = new Map((await tx.prepare("SELECT device_user_id,employee_id FROM attendance_device_users WHERE device_id=? AND device_user_id=ANY(?::text[])").bind(source.deviceId, codes).all<Row>()).results.map(row => [String(row.device_user_id), row.employee_id ? Number(row.employee_id) : null]));
      const matches = codes.map(code => ({ code, employeeId: uniqueFingerprintMatch(employees, code) }));
      for (let start = 0; start < matches.length; start += CHUNK) {
        const chunk = matches.slice(start, start + CHUNK);
        await tx.prepare("INSERT INTO attendance_device_users (device_id,device_user_id,employee_id,display_name,enabled,last_seen_at) SELECT ?,u.code,u.employee_id,'ID '||u.code,1,CURRENT_TIMESTAMP FROM unnest(?::text[],?::integer[]) AS u(code,employee_id) ON CONFLICT(device_id,device_user_id) DO UPDATE SET employee_id=COALESCE(attendance_device_users.employee_id,excluded.employee_id),enabled=1,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP")
          .bind(source.deviceId, chunk.map(m => m.code), chunk.map(m => m.employeeId)).run();
      }
      // A code that was unmatched earlier but whose employee now has that fingerprint code is linked and backfilled.
      for (const match of matches) if (match.employeeId && existing.has(match.code) && existing.get(match.code) === null) relink.add(match.code);
      for (let start = 0; start < punches.length; start += CHUNK) {
        const chunk = punches.slice(start, start + CHUNK);
        const rows = (await tx.prepare("INSERT INTO attendance_device_punches (device_id,device_user_id,punched_at,punch_type,verify_type) SELECT ?,p.code,p.at,0,0 FROM unnest(?::text[],?::timestamptz[]) AS p(code,at) ON CONFLICT(device_id,device_user_id,punched_at,punch_type,verify_type) DO NOTHING RETURNING device_user_id,punched_at").bind(source.deviceId, chunk.map(p => p.code), chunk.map(p => p.at)).all<Row>()).results;
        inserted = inserted.concat(rows.map(row => ({ code: String(row.device_user_id), at: new Date(row.punched_at as string | Date).toISOString() })));
      }
    }
    // Per user: the earliest local day that received a new punch (one day earlier covers overnight shifts).
    const touched = new Map<string, string>();
    for (const punch of inserted) {
      const day = shiftDate(localParts(punch.at, timezone).date, -1);
      if (!touched.has(punch.code) || day < touched.get(punch.code)!) touched.set(punch.code, day);
    }
    for (const code of relink) touched.delete(code);
    let daysRebuilt = 0;
    for (const [code, fromDate] of touched) daysRebuilt += (await rebuildDeviceUserAttendance(tx, source.deviceId, code, fromDate)).dates;
    for (const code of relink) daysRebuilt += (await rebuildDeviceUserAttendance(tx, source.deviceId, code)).dates;
    const counts = await tx.prepare("SELECT (SELECT count(*)::integer FROM attendance_device_users WHERE device_id=? AND enabled=1) AS users,(SELECT count(*)::integer FROM attendance_device_users WHERE device_id=? AND enabled=1 AND employee_id IS NULL) AS unmatched,(SELECT count(*)::integer FROM attendance_device_punches WHERE device_id=?) AS punches").bind(source.deviceId, source.deviceId, source.deviceId).first<{ users: number; unmatched: number; punches: number }>();
    await tx.prepare("UPDATE attendance_devices SET status='online',last_seen_at=CURRENT_TIMESTAMP,last_sync_at=CURRENT_TIMESTAMP,last_error=NULL,user_count=?,log_count=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(counts!.users, counts!.punches, source.deviceId).run();
    await tx.prepare("UPDATE attendance_ingest_sources SET last_seen_at=CURRENT_TIMESTAMP,last_ip=?,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(ip, source.id).run();
    return { inserted: inserted.length, unmatchedUsers: counts!.unmatched, attendanceDaysRebuilt: daysRebuilt };
  });
  return {
    ok: true,
    received: records.length,
    accepted: punches.length,
    inserted: result.inserted,
    duplicates: punches.length - result.inserted,
    rejected: rejected.length,
    rejected_samples: rejected.slice(0, 10),
    unmatched_users: result.unmatchedUsers,
    attendance_days_rebuilt: result.attendanceDaysRebuilt,
  };
}
