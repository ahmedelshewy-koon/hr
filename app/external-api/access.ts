import { env } from "cloudflare:workers";

/**
 * Read-only API for other systems (employees and departments), authenticated by an API key
 * instead of a session. Keys live only on the server: EXTERNAL_API_KEYS holds one
 * `client-name:sha256-hex` pair per client, comma-separated, so no database change is needed.
 * scripts/create-external-api-key.mjs creates a key and prints the pair.
 */
export const KEY_PREFIX = "hrx_";

export type ExternalClient = { name: string };

export function externalApiFailure(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

/** Parses EXTERNAL_API_KEYS; malformed entries are ignored. */
export function parseKeyHashes(value: unknown): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of String(value ?? "").split(",")) {
    const [name, hash] = entry.trim().split(":");
    if (name && /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(name) && /^[0-9a-f]{64}$/i.test(hash ?? "")) result.set(hash.toLowerCase(), name);
  }
  return result;
}

export async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** The key comes in `x-api-key` or `Authorization: Bearer <key>`. */
export function presentedKey(request: Request) {
  return (request.headers.get("x-api-key") || request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

export async function authenticateClient(request: Request, configured: unknown = runtimeKeys()): Promise<ExternalClient> {
  const key = presentedKey(request);
  if (!key.startsWith(KEY_PREFIX) || key.length > 100) throw externalApiFailure(401, "Invalid API key");
  const name = parseKeyHashes(configured).get(await sha256Hex(key));
  if (!name) throw externalApiFailure(401, "Invalid API key");
  return { name };
}

function runtimeKeys() {
  const workerValue = (env as unknown as Record<string, unknown>).EXTERNAL_API_KEYS;
  return workerValue || (typeof process !== "undefined" ? process.env.EXTERNAL_API_KEYS : "");
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
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw) || Number.isNaN(time)) throw externalApiFailure(400, "updated_since must be an ISO date, for example 2026-10-01T00:00:00Z");
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
