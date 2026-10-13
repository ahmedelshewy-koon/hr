import { withDatabase } from '../route-helpers';
import { enforceWriteOrigin, requireActor } from '../api-security';
import { body } from '../../talent/talent-service';
import { deletePlan, PlanError, readPlans, savePlan } from '../../plans/catalog';

const asResponse = (error: unknown) => error instanceof PlanError
  ? new Response(JSON.stringify({ ...error.issue, error: error.issue.message_en }), { status: error.issue.status ?? 400, headers: { 'content-type': 'application/json' } })
  : error;

/** Subscription plans are product master data: Super Admin only, for reading and writing. */
export async function GET(request: Request) { return withDatabase('Unable to load the plans', async db => {
  const actor = await requireActor(request, db);
  if (actor.roleName !== 'Super Admin') throw new Response('Forbidden', { status: 403 });
  return Response.json({ plans: await readPlans(db), canManage: true }, { headers: { 'cache-control': 'no-store' } });
}); }

/** action: 'save' (default; create when record.id is empty) | 'delete'. */
export async function POST(request: Request) { return withDatabase('Unable to save the plan', async db => {
  enforceWriteOrigin(request);
  const actor = await requireActor(request, db);
  if (actor.roleName !== 'Super Admin') throw new Response('Forbidden', { status: 403 });
  const input = await body(request);
  const record = input.record;
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Response('Invalid record', { status: 400 });
  const action = String(input.action || 'save');
  try {
    if (action === 'delete') return Response.json({ ok: true, ...await db.transaction(tx => deletePlan(tx, (record as Record<string, unknown>).id, actor.id)) });
    if (action !== 'save') throw new Response('Unknown action', { status: 400 });
    return Response.json({ ok: true, record: await db.transaction(tx => savePlan(tx, record as Record<string, unknown>, actor.id)) });
  } catch (error) {
    throw asResponse(error);
  }
}); }
