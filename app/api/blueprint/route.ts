import { withDatabase } from '../route-helpers';
import { enforceWriteOrigin, loadPermissions, requireActor, type ApiActor } from '../api-security';
import { body } from '../../talent/talent-service';
import type { PostgresDatabase } from '../../../db/postgres';
import { BlueprintError, blueprintAccess } from '../../blueprint/policy';
import {
  applyBlueprint, createTemplate, duplicateBlueprint, ensureDefaults, generateCompanyBlueprint, previewApplyBlueprint, readBlueprint, readOverview, removeDepartmentFromBlueprint, removePositionFromBlueprint,
  saveCompanyType, saveDepartment, savePosition, setCompanyBlueprintStatus, setTemplateStatus, updateCompanyBlueprint, updateTemplate,
} from '../../blueprint/service';

const MODULE = 'staffing_blueprint';
const asResponse = (error: unknown) => error instanceof BlueprintError
  ? new Response(JSON.stringify({ ...error.issue, error: error.issue.message_en }), { status: error.issue.status ?? 400, headers: { 'content-type': 'application/json' } })
  : error;

async function context(db: PostgresDatabase, actor: ApiActor) {
  const permissions = await loadPermissions(db, actor);
  const grants = { view: permissions.allows(MODULE, 'view'), create: permissions.allows(MODULE, 'create'), edit: permissions.allows(MODULE, 'edit'), approve: permissions.allows(MODULE, 'approve'), delete: permissions.allows(MODULE, 'delete'), manage_settings: permissions.allows(MODULE, 'manage_settings') };
  const access = blueprintAccess(actor, grants);
  if (!access.canView) throw new Response('Permission denied', { status: 403 });
  return access;
}
const id = (value: unknown) => { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; };
/** Read-only viewers (managers with an explicit grant) only see blueprints of their own company. */
async function visibleCompanyIds(db: PostgresDatabase, actor: ApiActor, wholeCompany: boolean) {
  if (wholeCompany) return null;
  if (!actor.employeeId) return [];
  const row = await db.prepare('SELECT company_id FROM employees WHERE id=?').bind(actor.employeeId).first<{ company_id: number | null }>();
  return row?.company_id ? [Number(row.company_id)] : [];
}

export async function GET(request: Request) { return withDatabase('Unable to load staffing blueprints', async db => {
  const actor = await requireActor(request, db);
  const access = await context(db, actor);
  const params = new URL(request.url).searchParams;
  const only = await visibleCompanyIds(db, actor, access.wholeCompany);
  try {
    const one = id(params.get('id'));
    if (one) {
      const data = await readBlueprint(db, one);
      if (data.blueprint.kind === 'company' && only !== null && (data.blueprint.companyId === null || !only.includes(data.blueprint.companyId))) throw new Response('Blueprint is outside your scope', { status: 403 });
      return Response.json({ ...data, access }, { headers: { 'cache-control': 'no-store' } });
    }
    const preview = id(params.get('preview'));
    if (preview) {
      if (!access.canApply) throw new Response('Permission denied', { status: 403 });
      return Response.json(await previewApplyBlueprint(db, preview), { headers: { 'cache-control': 'no-store' } });
    }
    if (access.wholeCompany) await ensureDefaults(db);
    return Response.json({ access, ...await readOverview(db, { companyIds: only }) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { throw asResponse(error); }
}); }

/**
 * action: saveType | createTemplate | updateTemplate | templateStatus | duplicate | generate | updateBlueprint | blueprintStatus |
 *         saveDepartment | removeDepartment | savePosition | removePosition | apply
 */
export async function POST(request: Request) { return withDatabase('Unable to save the blueprint', async db => {
  enforceWriteOrigin(request);
  const actor = await requireActor(request, db);
  const access = await context(db, actor);
  const input = await body(request);
  const record = (input.record && typeof input.record === 'object' && !Array.isArray(input.record) ? input.record : {}) as Record<string, unknown>;
  const blueprintId = id(input.blueprintId);
  const need = (allowed: boolean) => { if (!allowed) throw new Response('Permission denied', { status: 403 }); };
  const needId = (value: number | null) => value ?? (() => { throw new Response('An id is required', { status: 400 }); })();
  /**
   * Tree edits: templates belong to the library (Super Admin); company blueprints need the edit grant. The kind is read BEFORE the
   * transaction opens: the connection is single, so querying on `db` from inside `db.transaction` would wait on itself forever.
   */
  const action = String(input.action);
  const kind = blueprintId && ['saveDepartment', 'removeDepartment', 'savePosition', 'removePosition', 'duplicate'].includes(action)
    ? (await db.prepare('SELECT kind FROM staffing_blueprints WHERE id=?').bind(blueprintId).first<{ kind: string }>())?.kind ?? 'company' : 'company';
  const needEdit = () => need(kind === 'template' ? access.canManageLibrary : access.canEdit);
  try {
    return await db.transaction(async tx => {
      switch (action) {
        case 'saveType': need(access.canManageLibrary); return Response.json({ ok: true, id: await saveCompanyType(tx, actor, record) });
        case 'createTemplate': need(access.canManageLibrary); return Response.json({ ok: true, id: await createTemplate(tx, actor, record) });
        case 'updateTemplate': need(access.canManageLibrary); await updateTemplate(tx, actor, needId(blueprintId), record); return Response.json({ ok: true });
        case 'templateStatus': need(access.canManageLibrary); await setTemplateStatus(tx, actor, needId(blueprintId), input.to === 'activate' ? 'activate' : input.to === 'draft' ? 'draft' : 'archive'); return Response.json({ ok: true });
        case 'duplicate': need(kind === 'template' ? access.canManageLibrary : access.canGenerate); return Response.json({ ok: true, id: await duplicateBlueprint(tx, actor, needId(blueprintId)) });
        case 'generate': need(access.canGenerate); return Response.json({ ok: true, id: await generateCompanyBlueprint(tx, actor, record) });
        case 'updateBlueprint': need(access.canEdit); await updateCompanyBlueprint(tx, actor, needId(blueprintId), record); return Response.json({ ok: true });
        case 'blueprintStatus': {
          const to = input.to === 'reopen' ? 'reopen' : input.to === 'archive' ? 'archive' : 'approve';
          need(to === 'archive' ? access.canArchive : access.canEdit);
          await setCompanyBlueprintStatus(tx, actor, needId(blueprintId), to);
          return Response.json({ ok: true });
        }
        case 'saveDepartment': needEdit(); return Response.json({ ok: true, id: await saveDepartment(tx, actor, needId(blueprintId), id(input.departmentId), record, access.canManageLibrary) });
        case 'removeDepartment': needEdit(); return Response.json({ ok: true, removed: await removeDepartmentFromBlueprint(tx, actor, needId(blueprintId), needId(id(input.departmentId)), access.canManageLibrary) });
        case 'savePosition': needEdit(); return Response.json({ ok: true, id: await savePosition(tx, actor, needId(blueprintId), id(input.positionId), record, access.canManageLibrary) });
        case 'removePosition': needEdit(); await removePositionFromBlueprint(tx, actor, needId(blueprintId), needId(id(input.positionId)), access.canManageLibrary); return Response.json({ ok: true });
        case 'apply': need(access.canApply); return Response.json({ ok: true, ...await applyBlueprint(tx, actor, needId(blueprintId), input.confirmExisting === true) });
        default: throw new Response('Unknown action', { status: 400 });
      }
    });
  } catch (error) { throw asResponse(error); }
}); }
