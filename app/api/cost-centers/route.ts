import { withDatabase } from '../route-helpers';
import { enforceWriteOrigin, hasPermission, requireActor } from '../api-security';
import { requireModule, body } from '../../talent/talent-service';
import { seesWholeCompany } from '../../employees/hr-data-scope';
import { CostCenterError, deleteCostCenter, readCostCenters, saveCostCenter } from '../../cost-centers/catalog';

const asResponse = (error: unknown) => error instanceof CostCenterError
  ? new Response(JSON.stringify({ ...error.issue, error: error.issue.message_en }), { status: error.issue.status ?? 400, headers: { 'content-type': 'application/json' } })
  : error;

/** Cost centers are company-wide payroll master data: payroll view to read, payroll edit to change, whole-company HR scope for both. */
export async function GET(request: Request) { return withDatabase('Unable to load cost centers', async db => {
  const actor = await requireActor(request, db);
  if (!seesWholeCompany(actor)) throw new Response('Forbidden', { status: 403 });
  await requireModule(db, actor, 'payroll', 'view');
  return Response.json({ ...await readCostCenters(db), canManage: await hasPermission(db, actor, 'payroll', 'edit_draft') }, { headers: { 'cache-control': 'no-store' } });
}); }

/** action: 'save' (default; create when record.id is empty) | 'delete'. */
export async function POST(request: Request) { return withDatabase('Unable to save the cost center', async db => {
  enforceWriteOrigin(request);
  const actor = await requireActor(request, db);
  if (!seesWholeCompany(actor)) throw new Response('Forbidden', { status: 403 });
  await requireModule(db, actor, 'payroll', 'edit_draft');
  const input = await body(request);
  const record = input.record;
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Response('Invalid record', { status: 400 });
  const action = String(input.action || 'save');
  try {
    if (action === 'delete') return Response.json({ ok: true, ...await db.transaction(tx => deleteCostCenter(tx, (record as Record<string, unknown>).id, actor.id)) });
    if (action !== 'save') throw new Response('Unknown action', { status: 400 });
    return Response.json({ ok: true, record: await db.transaction(tx => saveCostCenter(tx, record as Record<string, unknown>, actor.id)) });
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') throw asResponse(new CostCenterError({ code: 'DUPLICATE_CODE', field: 'code', message_ar: 'رمز مركز التكلفة مستخدم لمركز آخر', message_en: 'This code is already used by another cost center', status: 409 }));
    throw asResponse(error);
  }
}); }
