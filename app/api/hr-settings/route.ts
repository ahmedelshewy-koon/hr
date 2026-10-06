import { withDatabase } from '../route-helpers';
import { enforceWriteOrigin, hasPermission, requireActor } from '../api-security';
import { requireModule, body } from '../../talent/talent-service';
import { seesWholeCompany } from '../../employees/hr-data-scope';
import { deleteHrSetting, HrSettingsError, readHrSettings, saveHrSetting } from '../../hr-settings/catalog';

/** Structured validation errors keep code/field/message_ar/message_en; apiFailure passes JSON bodies through. */
const asResponse = (error: unknown) => error instanceof HrSettingsError
  ? new Response(JSON.stringify({ ...error.issue, error: error.issue.message_en }), { status: error.issue.status ?? 400, headers: { 'content-type': 'application/json' } })
  : error;

/** HR Settings are company-wide policy: Super Admin, or an HR Manager with whole-company scope, with Settings access. */
export async function GET(request: Request) { return withDatabase('Unable to load HR settings', async db => {
  const actor = await requireActor(request, db);
  if (!seesWholeCompany(actor)) throw new Response('Forbidden', { status: 403 });
  await requireModule(db, actor, 'system_settings', 'view');
  const settings = await readHrSettings(db);
  return Response.json({ ...settings, canManage: await hasPermission(db, actor, 'system_settings', 'manage_settings') }, { headers: { 'cache-control': 'no-store' } });
}); }

/** action: 'save' (default; create when record.id is empty) | 'delete'. */
export async function POST(request: Request) { return withDatabase('Unable to save HR settings', async db => {
  enforceWriteOrigin(request);
  const actor = await requireActor(request, db);
  if (!seesWholeCompany(actor)) throw new Response('Forbidden', { status: 403 });
  await requireModule(db, actor, 'system_settings', 'manage_settings');
  const input = await body(request);
  const record = input.record;
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Response('Invalid record', { status: 400 });
  const action = String(input.action || 'save');
  try {
    if (action === 'delete') return Response.json({ ok: true, ...await db.transaction(tx => deleteHrSetting(tx, input.entity, (record as Record<string, unknown>).id, actor.id)) });
    if (action !== 'save') throw new Response('Unknown action', { status: 400 });
    const saved = await db.transaction(tx => saveHrSetting(tx, input.entity, record as Record<string, unknown>, actor.id));
    return Response.json({ ok: true, record: saved });
  } catch (error) {
    // A concurrent insert can still hit the unique code index; report it like the validated duplicate.
    if ((error as { code?: string })?.code === '23505') throw asResponse(new HrSettingsError({ code: 'DUPLICATE_CODE', field: 'code', message_ar: 'الرمز مستخدم لسجل آخر', message_en: 'This code is already used by another record', status: 409 }));
    throw asResponse(error);
  }
}); }
