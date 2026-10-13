import { withDatabase } from '../../route-helpers';
import { enforceRateLimit, enforceWriteOrigin, requireActor } from '../../api-security';
import { body } from '../../../talent/talent-service';
import { IntegrationError, sendRequest } from '../../../integrations/catalog';

/** Sends one request from the server (credentials stay server-side). Super Admin only. */
export async function POST(request: Request) { return withDatabase('Unable to send the request', async db => {
  enforceWriteOrigin(request);
  const actor = await requireActor(request, db);
  if (actor.roleName !== 'Super Admin') throw new Response('Forbidden', { status: 403 });
  await enforceRateLimit(db, request, 'integration-send', 60, 60, actor.id);
  const input = await body(request);
  try {
    return Response.json(await sendRequest(db, input), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof IntegrationError) throw new Response(JSON.stringify({ ...error.issue, error: error.issue.message_en }), { status: error.issue.status ?? 400, headers: { 'content-type': 'application/json' } });
    throw error;
  }
}); }
