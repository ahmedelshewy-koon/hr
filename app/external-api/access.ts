import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";

/**
 * Read-only API for other systems (employees and departments), authenticated by an API key
 * instead of a session. Super Admin creates and revokes keys on the Integrations page; only a
 * SHA-256 hash of each key is kept, in system_settings ('external_api_clients'), so no
 * database migration is needed. The plain key is shown once, when it is created.
 */
export const KEY_PREFIX = "hrx_";
export const SETTING_KEY = "external_api_clients";
const MAX_CLIENTS = 50;
// last_used_at is written at most this often per key, so API calls do not rewrite the setting each time.
const USAGE_WRITE_MS = 5 * 60 * 1000;

export type StoredClient = {
  id: string;
  name: string;
  hash: string;
  hint: string;
  created_at: string;
  created_by: number | null;
  last_used_at: string | null;
};
export type ExternalClient = { id: string; name: string };
type Db = PostgresDatabase | TransactionDatabase;

export function externalApiFailure(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

export async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Stored clients; anything malformed in the setting is ignored. */
export function parseClients(valueJson: unknown): StoredClient[] {
  let value: unknown;
  try {
    value = JSON.parse(String(valueJson || "{}"));
  } catch {
    return [];
  }
  const list = (value as { clients?: unknown })?.clients;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item): item is StoredClient =>
      Boolean(item) && typeof item.id === "string" && typeof item.name === "string" && /^[0-9a-f]{64}$/.test(String(item.hash)),
  );
}

export async function readClients(db: Db, lock = false) {
  const row = await db
    .prepare(`SELECT value_json FROM system_settings WHERE setting_key=?${lock ? " FOR UPDATE" : ""}`)
    .bind(SETTING_KEY)
    .first<{ value_json: string }>();
  return parseClients(row?.value_json);
}

export async function writeClients(db: Db, clients: StoredClient[], actorId: number | null) {
  await db
    .prepare(
      `INSERT INTO system_settings (setting_key,value_json,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_by_user_id=excluded.updated_by_user_id,updated_at=CURRENT_TIMESTAMP`,
    )
    .bind(SETTING_KEY, JSON.stringify({ clients }), actorId)
    .run();
}

/** What the screen may see: never the hash. */
export const publicClient = (client: StoredClient) => ({
  id: client.id,
  name: client.name,
  hint: client.hint,
  created_at: client.created_at,
  created_by: client.created_by,
  last_used_at: client.last_used_at,
});

/** A new key for `name`; returns the plain key (shown once) and the client to store. */
export async function createClient(existing: StoredClient[], nameValue: unknown, actorId: number | null) {
  const name = String(nameValue ?? "").trim();
  if (!name) throw externalApiFailure(400, "Name is required");
  if (name.length > 80) throw externalApiFailure(400, "Name is too long");
  if (existing.some(client => client.name.toLowerCase() === name.toLowerCase())) {
    throw externalApiFailure(409, "A key with the same name already exists");
  }
  if (existing.length >= MAX_CLIENTS) throw externalApiFailure(409, `At most ${MAX_CLIENTS} keys`);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = KEY_PREFIX + btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const client: StoredClient = {
    id: crypto.randomUUID(),
    name,
    hash: await sha256Hex(key),
    hint: key.slice(-4),
    created_at: new Date().toISOString(),
    created_by: actorId,
    last_used_at: null,
  };
  return { key, client };
}

/** The key comes in `x-api-key` or `Authorization: Bearer <key>`. */
export function presentedKey(request: Request) {
  return (request.headers.get("x-api-key") || request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

/** Finds the client for the presented key; `clients` is passed in by tests. */
export async function matchClient(request: Request, clients: StoredClient[]): Promise<StoredClient> {
  const key = presentedKey(request);
  if (!key.startsWith(KEY_PREFIX) || key.length > 100) throw externalApiFailure(401, "Invalid API key");
  const hash = await sha256Hex(key);
  const client = clients.find(item => item.hash === hash);
  if (!client) throw externalApiFailure(401, "Invalid API key");
  return client;
}

export async function authenticateClient(db: PostgresDatabase, request: Request): Promise<ExternalClient> {
  const client = await matchClient(request, await readClients(db));
  if (!client.last_used_at || Date.now() - Date.parse(client.last_used_at) > USAGE_WRITE_MS) {
    // Best effort: a failed usage stamp never blocks the request.
    await db
      .transaction(async tx => {
        const clients = await readClients(tx, true);
        const stored = clients.find(item => item.id === client.id);
        if (!stored) return;
        stored.last_used_at = new Date().toISOString();
        await writeClients(tx, clients, null);
      })
      .catch(() => undefined);
  }
  return { id: client.id, name: client.name };
}

export const MAX_PAGE_SIZE = 500;
// The statuses the employee form offers ('deleted' records are never returned).
export const EMPLOYMENT_STATUSES = ["active", "on_leave", "probation", "notice_period", "suspended", "terminated"] as const;

export type PageQuery = { page: number; pageSize: number; offset: number };

export function pageQuery(params: URLSearchParams): PageQuery {
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(params.get("page_size")) || 100)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Optional positive id filter; anything else is a 400. */
export function idParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw externalApiFailure(400, `${name} must be a positive whole number`);
  return value;
}

/** `updated_since` as an ISO date or date-time; returned normalised for SQL. */
export function sinceParam(params: URLSearchParams): string | null {
  const raw = params.get("updated_since");
  if (!raw) return null;
  const time = Date.parse(raw);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw) || Number.isNaN(time)) {
    throw externalApiFailure(400, "updated_since must be an ISO date, for example 2026-10-01T00:00:00Z");
  }
  return new Date(time).toISOString();
}

/** Comma-separated statuses; by default every employee who is not deleted. */
export function statusParam(params: URLSearchParams): string[] | null {
  const raw = params.get("status");
  if (!raw) return null;
  const values = [...new Set(raw.split(",").map(value => value.trim()).filter(Boolean))];
  const unknown = values.filter(value => !(EMPLOYMENT_STATUSES as readonly string[]).includes(value));
  if (unknown.length) throw externalApiFailure(400, `Unknown status: ${unknown.join(", ")}. Use ${EMPLOYMENT_STATUSES.join(", ")}`);
  return values;
}
