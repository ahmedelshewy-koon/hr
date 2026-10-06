import { withDatabase } from '../route-helpers';
import { enforceWriteOrigin, hasPermission, requireActor } from '../api-security';
import { requireModule, body } from '../../talent/talent-service';
import { acknowledgeDecision, createDecision, decisionRecipients, listDecisions, pendingDecisions, readAudience, withdrawDecision } from '../../decisions/decision-service';

const noStore = { 'cache-control': 'no-store' };

/**
 * GET ?view=pending (any signed-in account: its own unacknowledged decisions) | manage (default) | audience | recipients&id=
 * Managing requires the administrative_decisions module; sending also requires its `create` action.
 */
export async function GET(request: Request) { return withDatabase('Unable to load administrative decisions', async db => {
  const actor = await requireActor(request, db);
  const url = new URL(request.url), view = url.searchParams.get('view') || 'manage';
  if (view === 'pending') return Response.json({ decisions: await pendingDecisions(db, actor.employeeId) }, { headers: noStore });
  await requireModule(db, actor, 'administrative_decisions', 'view');
  if (view === 'audience') { await requireModule(db, actor, 'administrative_decisions', 'create'); return Response.json(await readAudience(db, actor), { headers: noStore }); }
  if (view === 'recipients') return Response.json(await decisionRecipients(db, actor, Number(url.searchParams.get('id'))), { headers: noStore });
  return Response.json({ decisions: await listDecisions(db, actor), canCreate: await hasPermission(db, actor, 'administrative_decisions', 'create') }, { headers: noStore });
}); }

/** action: 'acknowledge' (the recipient) | 'create' | 'withdraw'. */
export async function POST(request: Request) { return withDatabase('Unable to save administrative decision', async db => {
  enforceWriteOrigin(request);
  const actor = await requireActor(request, db), input = await body(request), action = String(input.action || '');
  if (action === 'acknowledge') return Response.json({ ok: true, ...await db.transaction(tx => acknowledgeDecision(tx, { id: actor.id, employeeId: actor.employeeId }, Number(input.decisionId))) });
  await requireModule(db, actor, 'administrative_decisions', 'create');
  if (action === 'create') return Response.json({ ok: true, decision: await db.transaction(tx => createDecision(tx, actor, input)) }, { status: 201 });
  if (action === 'withdraw') { await db.transaction(tx => withdrawDecision(tx, actor, Number(input.decisionId))); return Response.json({ ok: true }); }
  throw new Response('Unknown action', { status: 400 });
}); }
