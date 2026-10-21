import { withDatabase } from "../route-helpers";
import { enforceRateLimit } from "../api-security";
import { authenticateIngest, ingestFailure, ingestRecords, MAX_INGEST_RECORDS } from "../../attendance/biometric-ingest";
import { corsPreflightResponse, withIngestCors } from "../../attendance/biometric-cors";

// A whole device history is a few MB of JSON; this leaves headroom without accepting unbounded bodies.
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const headers = { "cache-control": "no-store" };

/** Failures always carry `message`, which is the field the sending program reads. */
async function withMessage(response: Response) {
  if (response.ok) return response;
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return Response.json({ ...body, message: body.message ?? body.error ?? "Request failed" }, { status: response.status, headers });
}

/** Called by an external program (for example the ZK integration), authenticated by its API key rather than a session. */
export async function POST(request: Request) {
  return withIngestCors(await withMessage(await withDatabase("Biometric ingest failed", async db => {
    await enforceRateLimit(db, request, "biometric-ingest-ip", 3000, 3600);
    const source = await authenticateIngest(db, request);
    await enforceRateLimit(db, request, "biometric-ingest", 1500, 3600, source.id);
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) throw ingestFailure(413, "Request is too large");
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) throw ingestFailure(413, "Request is too large");
    let payload: { records?: unknown };
    try { payload = JSON.parse(body); } catch { throw ingestFailure(400, "Invalid JSON"); }
    if (!payload || !Array.isArray(payload.records)) throw ingestFailure(400, "records must be an array");
    if (payload.records.length > MAX_INGEST_RECORDS) throw ingestFailure(413, `Send at most ${MAX_INGEST_RECORDS} records per request`);
    try {
      return Response.json(await ingestRecords(db, source, payload.records, request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null), { headers });
    } catch (error) {
      await db.prepare("UPDATE attendance_ingest_sources SET last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(String(error instanceof Error ? error.message : "Import failed").slice(0, 300), source.id).run().catch(() => undefined);
      throw error;
    }
  })));
}

export function OPTIONS() {
  return corsPreflightResponse();
}
