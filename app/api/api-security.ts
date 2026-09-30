import { organizationDuplicateError } from '../organization/duplicate-error';
import { organizationResponse } from '../organization/org-errors';
import { ensureAuthSchema, requirePortalSession } from "../portal-auth";
import { MANAGED_DEPARTMENTS_CTE, isCompanyWideRole } from "../organization/department-scope";
import type { PostgresDatabase } from "../../db/postgres";

export type ApiActor = {
  id: number;
  roleId: number;
  roleName: string;
  employeeId: number | null;
  email: string;
};

const SAFE_FETCH_SITES = ["same-origin", "same-site", "none"];
const READ_ONLY_METHODS = ["GET", "HEAD", "OPTIONS"];

/**
 * Rejects cross-site mutations. Reads are exempt because they carry no side
 * effects and are additionally gated by the session cookie.
 */
export function enforceWriteOrigin(request: Request) {
  if (READ_ONLY_METHODS.includes(request.method.toUpperCase())) return;
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin !== expected || (site && !SAFE_FETCH_SITES.includes(site))) {
    throw new Response("Cross-site write request rejected", { status: 403 });
  }
}

function requestAddress(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function enforceRateLimit(
  db: PostgresDatabase,
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
  subject?: string | number | null,
) {
  const key = await digest(`${scope}:${subject ?? requestAddress(request)}`);
  const row = await db
    .prepare(
      `INSERT INTO security_rate_limits (bucket_key,window_started_at,count,updated_at) VALUES (?,CURRENT_TIMESTAMP,1,CURRENT_TIMESTAMP)
    ON CONFLICT(bucket_key) DO UPDATE SET
      count=CASE WHEN security_rate_limits.window_started_at<CURRENT_TIMESTAMP-(?*INTERVAL '1 second') THEN 1 ELSE security_rate_limits.count+1 END,
      window_started_at=CASE WHEN security_rate_limits.window_started_at<CURRENT_TIMESTAMP-(?*INTERVAL '1 second') THEN CURRENT_TIMESTAMP ELSE security_rate_limits.window_started_at END,
      updated_at=CURRENT_TIMESTAMP RETURNING count,window_started_at`,
    )
    .bind(key, windowSeconds, windowSeconds)
    .first<{ count: number; window_started_at: string }>();
  if (Number(row?.count) > limit) {
    throw new Response("Too many requests. Please try again later.", {
      status: 429,
      headers: { "retry-after": String(windowSeconds) },
    });
  }
}

export async function requireActor(request: Request, db: PostgresDatabase): Promise<ApiActor> {
  await ensureAuthSchema(db);
  const session = await requirePortalSession(request, db);
  const actor = await db
    .prepare(
      "SELECT u.id,u.email,u.employee_id,u.role_id,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.status='active'",
    )
    .bind(session.userId)
    .first<{ id: number; email: string; employee_id: number | null; role_id: number; role_name: string }>();
  if (!actor) throw new Response("Account disabled", { status: 403 });
  return {
    id: Number(actor.id),
    email: String(actor.email),
    employeeId: actor.employee_id == null ? null : Number(actor.employee_id),
    roleId: Number(actor.role_id),
    roleName: String(actor.role_name),
  };
}

export async function hasPermission(
  db: PostgresDatabase,
  actor: ApiActor,
  module: string,
  action: string,
) {
  if (actor.roleName === "Super Admin") return true;
  const row = await db
    .prepare("SELECT allowed FROM permissions WHERE role_id=? AND module=? AND action=?")
    .bind(actor.roleId, module, action)
    .first<{ allowed: number }>();
  return Boolean(row?.allowed);
}

export async function requirePermission(
  db: PostgresDatabase,
  actor: ApiActor,
  module: string,
  action: string,
) {
  if (!(await hasPermission(db, actor, module, action))) {
    throw new Response("Permission denied", { status: 403 });
  }
}

/** Answers `module`/`action` permission questions without a round trip each. */
export type PermissionSet = { allows(module: string, action: string): boolean };

/**
 * Loads a role's whole permission grid in one query.
 *
 * `hasPermission` costs a round trip per question, which is fine for a route that
 * asks once but not for the bootstrap endpoint that asks twenty-odd times on every
 * poll. The result is equivalent: `allowed` is a 0/1 column, so selecting the
 * `allowed=1` rows yields exactly the pairs `hasPermission` would approve.
 */
export async function loadPermissions(
  db: PostgresDatabase,
  actor: Pick<ApiActor, "roleId" | "roleName">,
): Promise<PermissionSet> {
  if (actor.roleName === "Super Admin") return { allows: () => true };
  const rows = (
    await db
      .prepare("SELECT module,action FROM permissions WHERE role_id=? AND allowed=1")
      .bind(actor.roleId)
      .all<{ module: string; action: string }>()
  ).results;
  const granted = new Set(rows.map(row => `${row.module}:${row.action}`));
  return { allows: (module, action) => granted.has(`${module}:${action}`) };
}

export async function canAccessEmployee(
  db: PostgresDatabase,
  actor: ApiActor,
  employeeId: number,
) {
  if (isCompanyWideRole(actor.roleName)) return true;
  if (Number(actor.employeeId) === employeeId) return true;
  if (actor.roleName !== "Department Manager" || !actor.employeeId) return false;
  const row = await db
    .prepare(
      `${MANAGED_DEPARTMENTS_CTE} SELECT 1 AS allowed FROM employees WHERE id=? AND department_id IN (SELECT id FROM managed) AND employment_status!='deleted'`,
    )
    .bind(actor.employeeId, employeeId)
    .first();
  return Boolean(row);
}

/**
 * Turns a thrown value into a JSON error response.
 *
 * Validation failures are thrown as plain-text `Response` objects and keep their
 * own status and message. Anything else is an unexpected fault: it is logged
 * server-side and answered with `message`, never with the raw error text, which
 * on this stack is usually a PostgreSQL error exposing table and column names.
 */
export async function apiFailure(error: unknown, message = "Request failed") {
  error=organizationDuplicateError(error)||organizationResponse(error);
  if (error instanceof Response) {
    const body = await error.text().catch(() => "");
    // Structured organizational errors keep their machine-readable fields (code, field, blocking_entity, ...).
    if ((error.headers.get("content-type") || "").includes("application/json")) {
      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      if (parsed && typeof parsed === "object") return Response.json({ ...parsed, error: parsed.error || error.statusText || "Request failed" }, { status: error.status });
    }
    // Keep headers the thrower set on purpose (e.g. `retry-after` on a 429), but not
    // the thrown body's own `content-type: text/plain`: Response.json only adds
    // `application/json` when no content type is present, and this reply is JSON.
    const headers = new Headers(error.headers);
    headers.delete("content-type");
    headers.delete("content-length");
    return Response.json(
      { error: body || error.statusText || "Request failed" },
      { status: error.status, headers },
    );
  }
  console.error(error);
  return Response.json({ error: message }, { status: 500 });
}
