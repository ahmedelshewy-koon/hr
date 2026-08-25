import { env } from "cloudflare:workers";
import { createDatabase } from "../../../../../db/postgres";
import {
  apiFailure,
  enforceRateLimit,
  requireActor,
} from "../../../api-security";
import { requireApplicationAccess } from "../../../../recruitment/recruitment-access";

type Row = Record<string, unknown>;
type R2ObjectLike = { body: ReadableStream };
type R2BucketLike = { get(key: string): Promise<R2ObjectLike | null> };

const bucket = () => (env as unknown as { FILES?: R2BucketLike }).FILES;
const disposition = (name: string, download: boolean) =>
  `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const db = createDatabase();
  try {
    const actor = await requireActor(request, db),
      id = Number((await context.params).id);
    await enforceRateLimit(
      db,
      request,
      "candidate-document-download",
      120,
      3600,
      actor.id,
    );
    const row = await db
      .prepare("SELECT d.* FROM candidate_documents d WHERE d.id=?")
      .bind(id)
      .first<Row>();
    if (!row)
      throw new Response("Candidate document not found", { status: 404 });
    if (!row.application_id)
      throw new Response("Candidate document has no application scope", {
        status: 409,
      });
    await requireApplicationAccess(db, actor, Number(row.application_id));
    const object = await bucket()?.get(String(row.object_key));
    if (!object) throw new Response("Stored CV not found", { status: 404 });
    await db
      .prepare(
        "INSERT INTO audit_logs(user_id,action,module,record_type,record_id,ip_address,created_at) VALUES (?,'candidate_cv_viewed','recruitment','candidate_document',?,?,CURRENT_TIMESTAMP)",
      )
      .bind(actor.id, String(id), request.headers.get("cf-connecting-ip"))
      .run();
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(object.body, {
      headers: {
        "content-type": String(row.content_type),
        "content-disposition": disposition(String(row.name), download),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return apiFailure(error, "Unable to retrieve candidate document");
  } finally {
    await db.close();
  }
}
