import { withDatabase } from "../route-helpers";
import { enforceWriteOrigin, requireActor } from "../api-security";
import { createClient, publicClient, readClients, writeClients } from "../../external-api/access";

const headers = { "cache-control": "no-store" };

async function requireSuperAdmin(request: Request, db: Parameters<typeof requireActor>[1]) {
  const actor = await requireActor(request, db);
  if (actor.roleName !== "Super Admin") throw new Response("Forbidden", { status: 403 });
  return actor;
}

async function audit(db: Parameters<typeof requireActor>[1], request: Request, actorId: number, action: string, client: { id: string; name: string }) {
  await db
    .prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,new_value,ip_address,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
    .bind(actorId, action, "system_settings", "external_api_clients", client.id, JSON.stringify({ name: client.name }), request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null)
    .run();
}

/** API keys for /api/external/* (Super Admin only). The list never includes the keys themselves. */
export async function GET(request: Request) {
  return withDatabase("Unable to load the API keys", async db => {
    await requireSuperAdmin(request, db);
    return Response.json({ clients: (await readClients(db)).map(publicClient) }, { headers });
  });
}

/** { name }: creates a key. The response carries the plain key, the only time it is ever shown. */
export async function POST(request: Request) {
  return withDatabase("Unable to create the API key", async db => {
    enforceWriteOrigin(request);
    const actor = await requireSuperAdmin(request, db);
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const created = await db.transaction(async tx => {
      const clients = await readClients(tx, true);
      const { key, client } = await createClient(clients, body.name, actor.id);
      await writeClients(tx, [...clients, client], actor.id);
      return { key, client };
    });
    await audit(db, request, actor.id, "external_api_key_created", created.client);
    return Response.json({ ok: true, key: created.key, client: publicClient(created.client) }, { status: 201, headers });
  });
}

/** ?id=: revokes a key; systems using it are refused from then on. */
export async function DELETE(request: Request) {
  return withDatabase("Unable to revoke the API key", async db => {
    enforceWriteOrigin(request);
    const actor = await requireSuperAdmin(request, db);
    const id = new URL(request.url).searchParams.get("id") || "";
    const removed = await db.transaction(async tx => {
      const clients = await readClients(tx, true);
      const client = clients.find(item => item.id === id);
      if (!client) throw new Response("API key not found", { status: 404 });
      await writeClients(tx, clients.filter(item => item.id !== id), actor.id);
      return client;
    });
    await audit(db, request, actor.id, "external_api_key_revoked", removed);
    return Response.json({ ok: true }, { headers });
  });
}
