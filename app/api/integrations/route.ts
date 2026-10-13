import { withDatabase } from '../route-helpers';
import { enforceWriteOrigin, requireActor } from '../api-security';
import { body } from '../../talent/talent-service';
import { deleteIntegration, deleteRequest, IntegrationError, readIntegrations, saveIntegration, saveRequest } from '../../integrations/catalog';

const asResponse = (error: unknown) => error instanceof IntegrationError
  ? new Response(JSON.stringify({ ...error.issue, error: error.issue.message_en }), { status: error.issue.status ?? 400, headers: { 'content-type': 'application/json' } })
  : error;

/** Integrations hold credentials for external systems: Super Admin only. */
export async function GET(request: Request) { return withDatabase('Unable to load the integrations', async db => {
  const actor = await requireActor(request, db);
  if (actor.roleName !== 'Super Admin') throw new Response('Forbidden', { status: 403 });
  return Response.json(await readIntegrations(db), { headers: { 'cache-control': 'no-store' } });
}); }

/** action: save_integration | delete_integration | save_request | delete_request. */
export async function POST(request: Request) { return withDatabase('Unable to save the integration', async db => {
  enforceWriteOrigin(request);
  const actor = await requireActor(request, db);
  if (actor.roleName !== 'Super Admin') throw new Response('Forbidden', { status: 403 });
  const input = await body(request);
  const record = input.record;
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Response('Invalid record', { status: 400 });
  const row = record as Record<string, unknown>;
  try {
    switch (String(input.action)) {
      case 'save_integration': return Response.json({ ok: true, record: await db.transaction(tx => saveIntegration(tx, row, actor.id)) });
      case 'delete_integration': return Response.json({ ok: true, ...await db.transaction(tx => deleteIntegration(tx, row.id, actor.id)) });
      case 'save_request': return Response.json({ ok: true, record: await db.transaction(tx => saveRequest(tx, row, actor.id)) });
      case 'delete_request': return Response.json({ ok: true, ...await db.transaction(tx => deleteRequest(tx, row.id, actor.id)) });
      default: throw new Response('Unknown action', { status: 400 });
    }
  } catch (error) {
    throw asResponse(error);
  }
}); }
