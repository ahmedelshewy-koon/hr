import type { PostgresDatabase, TransactionDatabase } from '../../db/postgres';
import type { ApiActor } from '../api/api-security';
import { saveOrganizationEntity } from '../organization/catalog-service.ts';
import { saveJobTitle } from '../organization/job-title-service.ts';
import { defaultTemplates, DEFAULT_TYPES } from './defaults.ts';
import {
  BlueprintError, assertCompanyBlueprintEditable, assertTemplateTransition, bilingual, departmentSubtreeIds, fail, generateTree, planApply, totalHeadcount, validateDepartmentInput, validateGenerateInput, validatePositionInput, validateTemplateInput,
  type ApplyPlan, type BlueprintSize, type BlueprintTree, type BpDepartment, type CompanyBlueprintStatus, type ExistingTitle, type ExistingUnit, type Name, type Seniority, type TemplateStatus, type UnitKind,
} from './policy.ts';

type Db = PostgresDatabase | TransactionDatabase;
type Row = Record<string, unknown>;
const name = (en: unknown, ar: unknown): Name => ({ en: String(en ?? ar ?? ''), ar: String(ar ?? en ?? '') });
const num = (v: unknown) => (v == null ? null : Number(v));

export type BlueprintRow = {
  id: number; kind: 'template' | 'company'; name: Name; companyTypeId: number; size: BlueprintSize; status: string; description: Name | null; isDefault: boolean; companyId: number | null; sourceBlueprintId: number | null;
  expectedEmployees: number | null; branchesCount: number | null; country: string | null; businessModel: string | null; approvedAt: string | null; appliedAt: string | null; updatedAt: string;
  departmentCount: number; positionCount: number; headcount: number;
};
const blueprintRow = (r: Row): BlueprintRow => ({
  id: Number(r.id), kind: r.kind as 'template' | 'company', name: name(r.name_en, r.name_ar), companyTypeId: Number(r.company_type_id), size: r.size as BlueprintSize, status: String(r.status),
  description: r.description_en || r.description_ar ? name(r.description_en, r.description_ar) : null, isDefault: Number(r.is_default) === 1, companyId: num(r.company_id), sourceBlueprintId: num(r.source_blueprint_id),
  expectedEmployees: num(r.expected_employees), branchesCount: num(r.branches_count), country: (r.country as string | null) ?? null, businessModel: (r.business_model as string | null) ?? null,
  approvedAt: (r.approved_at as string | null) ?? null, appliedAt: (r.applied_at as string | null) ?? null, updatedAt: String(r.updated_at),
  departmentCount: Number(r.department_count ?? 0), positionCount: Number(r.position_count ?? 0), headcount: Number(r.headcount ?? 0),
});
const SUMMARY_SQL = `SELECT b.*,(SELECT count(*) FROM blueprint_departments d WHERE d.blueprint_id=b.id)::int AS department_count,(SELECT count(*) FROM blueprint_positions p WHERE p.blueprint_id=b.id)::int AS position_count,
  COALESCE((SELECT sum(p.headcount) FROM blueprint_positions p WHERE p.blueprint_id=b.id),0)::int AS headcount FROM staffing_blueprints b`;

export type CompanyType = { id: number; code: string; name: Name; sortOrder: number; isSystem: boolean; status: string };
const typeRow = (r: Row): CompanyType => ({ id: Number(r.id), code: String(r.code), name: name(r.name_en, r.name_ar), sortOrder: Number(r.sort_order), isSystem: Number(r.is_system) === 1, status: String(r.status) });

/* ---------- Tree persistence ---------- */

export async function loadTree(db: Db, blueprintId: number): Promise<BlueprintTree> {
  const [departments, positions] = await Promise.all([
    db.prepare('SELECT * FROM blueprint_departments WHERE blueprint_id=? ORDER BY sort_order,id').bind(blueprintId).all<Row>(),
    db.prepare('SELECT * FROM blueprint_positions WHERE blueprint_id=? ORDER BY sort_order,id').bind(blueprintId).all<Row>(),
  ]);
  return {
    departments: departments.results.map(r => ({ id: Number(r.id), parentId: num(r.parent_id), kind: r.kind as UnitKind, name: name(r.name_en, r.name_ar), required: Number(r.required) === 1, sortOrder: Number(r.sort_order) })),
    positions: positions.results.map(r => ({ id: Number(r.id), departmentId: Number(r.department_id), parentPositionId: num(r.parent_position_id), title: name(r.title_en, r.title_ar), headcount: Number(r.headcount), seniority: r.seniority as Seniority, required: Number(r.required) === 1, perBranch: Number(r.per_branch) === 1, description: r.description_en || r.description_ar ? name(r.description_en, r.description_ar) : null, sortOrder: Number(r.sort_order) })),
  };
}

/** Inserts `tree` into `blueprintId`, giving every unit and position a fresh id and keeping the reporting lines. */
export async function insertTree(tx: Db, blueprintId: number, tree: BlueprintTree) {
  const unitIds = new Map<number, number>(), positionIds = new Map<number, number>();
  const depth = (d: BpDepartment) => { let n = 0, c: BpDepartment | undefined = d; while (c?.parentId != null && n < 10) { n++; c = tree.departments.find(x => x.id === c!.parentId); } return n; };
  for (const d of [...tree.departments].sort((a, b) => depth(a) - depth(b) || a.sortOrder - b.sortOrder || a.id - b.id)) {
    const row = await tx.prepare('INSERT INTO blueprint_departments (blueprint_id,parent_id,kind,name_en,name_ar,required,sort_order) VALUES (?,?,?,?,?,?,?) RETURNING id').bind(blueprintId, d.parentId == null ? null : unitIds.get(d.parentId) ?? null, d.kind, d.name.en, d.name.ar, d.required ? 1 : 0, d.sortOrder).first<Row>();
    unitIds.set(d.id, Number(row!.id));
  }
  for (const p of tree.positions) {
    const row = await tx.prepare('INSERT INTO blueprint_positions (blueprint_id,department_id,title_en,title_ar,headcount,seniority,required,per_branch,description_en,description_ar,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id')
      .bind(blueprintId, unitIds.get(p.departmentId), p.title.en, p.title.ar, p.headcount, p.seniority, p.required ? 1 : 0, p.perBranch ? 1 : 0, p.description?.en ?? null, p.description?.ar ?? null, p.sortOrder).first<Row>();
    positionIds.set(p.id, Number(row!.id));
  }
  for (const p of tree.positions) if (p.parentPositionId != null && positionIds.has(p.parentPositionId)) await tx.prepare('UPDATE blueprint_positions SET parent_position_id=? WHERE id=?').bind(positionIds.get(p.parentPositionId), positionIds.get(p.id)).run();
}

async function audit(tx: Db, actor: ApiActor, action: string, blueprintId: number, detail: unknown) {
  await tx.prepare("INSERT INTO audit_logs(user_id,action,module,record_type,record_id,new_value,created_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(actor.id, `blueprint_${action}`, 'staffing_blueprint', 'staffing_blueprint', String(blueprintId), JSON.stringify(detail)).run();
}

/* ---------- Defaults ---------- */

/** First use: copy the built-in recommendations into the database as ordinary templates. Runs once (when there are no company types yet). */
export async function ensureDefaults(db: PostgresDatabase): Promise<boolean> {
  const count = Number((await db.prepare('SELECT count(*)::int AS n FROM blueprint_company_types').first<Row>())?.n ?? 0);
  if (count > 0) return false;
  return db.transaction(async tx => {
    await tx.prepare('SELECT pg_advisory_xact_lock(?)').bind(881).run();
    if (Number((await tx.prepare('SELECT count(*)::int AS n FROM blueprint_company_types').first<Row>())?.n ?? 0) > 0) return false;
    const typeIds = new Map<string, number>();
    for (const [order, spec] of DEFAULT_TYPES.entries()) {
      const row = await tx.prepare('INSERT INTO blueprint_company_types (code,name_en,name_ar,sort_order,is_system) VALUES (?,?,?,?,1) RETURNING id').bind(spec.code, spec.en, spec.ar, order).first<Row>();
      typeIds.set(spec.code, Number(row!.id));
    }
    for (const template of defaultTemplates()) {
      const row = await tx.prepare("INSERT INTO staffing_blueprints (kind,name_en,name_ar,company_type_id,size,status,is_default) VALUES ('template',?,?,?,?,'active',1) RETURNING id").bind(template.name.en, template.name.ar, typeIds.get(template.type.code), template.size).first<Row>();
      await insertTree(tx, Number(row!.id), template.tree);
    }
    return true;
  });
}

/* ---------- Reads ---------- */

export async function readOverview(db: Db, filter: { companyIds?: number[] | null } = {}) {
  const [types, templates, companyBlueprints, companies] = await Promise.all([
    db.prepare('SELECT * FROM blueprint_company_types ORDER BY sort_order,id').all<Row>(),
    db.prepare(`${SUMMARY_SQL} WHERE b.kind='template' ORDER BY b.company_type_id,CASE b.size WHEN 'micro' THEN 0 WHEN 'small' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,b.id`).all<Row>(),
    db.prepare(`${SUMMARY_SQL} WHERE b.kind='company' ORDER BY b.updated_at DESC,b.id DESC`).all<Row>(),
    db.prepare("SELECT id,name,name_en,name_ar,status FROM companies ORDER BY name").all<Row>(),
  ]);
  const only = filter.companyIds ?? null;
  return {
    types: types.results.map(typeRow), templates: templates.results.map(blueprintRow),
    blueprints: companyBlueprints.results.map(blueprintRow).filter(b => only === null || (b.companyId !== null && only.includes(b.companyId))),
    companies: companies.results.map(r => ({ id: Number(r.id), name: name(r.name_en || r.name, r.name_ar || r.name), status: String(r.status) })),
  };
}

export async function readBlueprint(db: Db, id: number) {
  const row = await db.prepare(`${SUMMARY_SQL} WHERE b.id=?`).bind(id).first<Row>();
  if (!row) throw new BlueprintError({ code: 'NOT_FOUND', field: null, message_ar: 'المخطط غير موجود', message_en: 'Blueprint not found', status: 404 });
  return { blueprint: blueprintRow(row), tree: await loadTree(db, id) };
}

async function loadBlueprint(tx: Db, id: number, lock = true) {
  const row = await tx.prepare(`SELECT * FROM staffing_blueprints WHERE id=?${lock ? ' FOR UPDATE' : ''}`).bind(id).first<Row>();
  if (!row) throw new BlueprintError({ code: 'NOT_FOUND', field: null, message_ar: 'المخطط غير موجود', message_en: 'Blueprint not found', status: 404 });
  return row;
}

/** A template is edited through the library (Super Admin); a company blueprint is only editable while it is a draft. */
async function editableBlueprint(tx: Db, id: number, canManageLibrary: boolean) {
  const row = await loadBlueprint(tx, id);
  if (row.kind === 'template') { if (!canManageLibrary) throw new Response('Only a Super Admin can edit the template library', { status: 403 }); }
  else assertCompanyBlueprintEditable(row.status as CompanyBlueprintStatus);
  return row;
}

/* ---------- Company types & templates (library) ---------- */

const slug = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
export async function saveCompanyType(tx: Db, actor: ApiActor, raw: Record<string, unknown>) {
  const n = bilingual(raw.nameEn, raw.nameAr, 'name', 120);
  const id = Number(raw.id) || null;
  const status = raw.status === 'archived' ? 'archived' : 'active';
  if (id) {
    if (!await tx.prepare('SELECT id FROM blueprint_company_types WHERE id=?').bind(id).first()) fail('NOT_FOUND', null, 'النوع غير موجود', 'Company type not found', 404);
    await tx.prepare('UPDATE blueprint_company_types SET name_en=?,name_ar=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(n.en, n.ar, status, id).run();
    return id;
  }
  let code = slug(n.en) || `type_${Date.now()}`;
  for (let i = 2; await tx.prepare('SELECT 1 AS x FROM blueprint_company_types WHERE code=?').bind(code).first(); i++) code = `${slug(n.en) || 'type'}_${i}`;
  const order = Number((await tx.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM blueprint_company_types').first<Row>())?.n ?? 1);
  const row = await tx.prepare('INSERT INTO blueprint_company_types (code,name_en,name_ar,sort_order,is_system) VALUES (?,?,?,?,0) RETURNING id').bind(code, n.en, n.ar, order).first<Row>();
  await audit(tx, actor, 'type_created', Number(row!.id), { code });
  return Number(row!.id);
}

export async function createTemplate(tx: Db, actor: ApiActor, raw: Record<string, unknown>) {
  const input = validateTemplateInput(raw);
  if (!await tx.prepare("SELECT id FROM blueprint_company_types WHERE id=? AND status='active'").bind(input.companyTypeId).first()) fail('TYPE_INVALID', 'companyTypeId', 'نوع الشركة غير متاح', 'The company type is not available', 409);
  const row = await tx.prepare("INSERT INTO staffing_blueprints (kind,name_en,name_ar,company_type_id,size,status,description_en,description_ar,created_by,updated_by) VALUES ('template',?,?,?,?,'draft',?,?,?,?) RETURNING id")
    .bind(input.name.en, input.name.ar, input.companyTypeId, input.size, input.description?.en ?? null, input.description?.ar ?? null, actor.id, actor.id).first<Row>();
  await audit(tx, actor, 'template_created', Number(row!.id), { name: input.name.en });
  return Number(row!.id);
}

export async function updateTemplate(tx: Db, actor: ApiActor, id: number, raw: Record<string, unknown>) {
  const before = await loadBlueprint(tx, id);
  if (before.kind !== 'template') fail('NOT_TEMPLATE', null, 'هذا ليس قالبًا', 'This is not a template', 409);
  const input = validateTemplateInput({ companyTypeId: before.company_type_id, size: before.size, nameEn: raw.nameEn ?? before.name_en, nameAr: raw.nameAr ?? before.name_ar, descriptionEn: raw.descriptionEn ?? before.description_en, descriptionAr: raw.descriptionAr ?? before.description_ar, ...(raw.companyTypeId ? { companyTypeId: raw.companyTypeId } : {}), ...(raw.size ? { size: raw.size } : {}) });
  await tx.prepare('UPDATE staffing_blueprints SET name_en=?,name_ar=?,company_type_id=?,size=?,description_en=?,description_ar=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(input.name.en, input.name.ar, input.companyTypeId, input.size, input.description?.en ?? null, input.description?.ar ?? null, actor.id, id).run();
  await audit(tx, actor, 'template_updated', id, { name: input.name.en });
}

export async function setTemplateStatus(tx: Db, actor: ApiActor, id: number, action: 'activate' | 'archive' | 'draft') {
  const row = await loadBlueprint(tx, id);
  if (row.kind !== 'template') fail('NOT_TEMPLATE', null, 'هذا ليس قالبًا', 'This is not a template', 409);
  assertTemplateTransition(row.status as TemplateStatus, action);
  if (action === 'activate' && Number((await tx.prepare('SELECT count(*)::int AS n FROM blueprint_positions WHERE blueprint_id=?').bind(id).first<Row>())?.n ?? 0) === 0) fail('TEMPLATE_EMPTY', null, 'أضف وظيفة واحدة على الأقل قبل التفعيل', 'Add at least one position before activating', 409);
  const status = action === 'activate' ? 'active' : action === 'archive' ? 'archived' : 'draft';
  await tx.prepare('UPDATE staffing_blueprints SET status=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(status, actor.id, id).run();
  await audit(tx, actor, `template_${status}`, id, {});
}

/** Copies any blueprint (template or company) into a new draft template, or a company blueprint into a new draft company blueprint. */
export async function duplicateBlueprint(tx: Db, actor: ApiActor, id: number) {
  const row = await loadBlueprint(tx, id, false);
  const copyName = name(`${row.name_en} (copy)`, `${row.name_ar} (نسخة)`);
  const created = await tx.prepare(`INSERT INTO staffing_blueprints (kind,name_en,name_ar,company_type_id,size,status,description_en,description_ar,company_id,source_blueprint_id,expected_employees,branches_count,country,business_model,created_by,updated_by)
    VALUES (?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?) RETURNING id`).bind(row.kind, copyName.en, copyName.ar, row.company_type_id, row.size, row.description_en, row.description_ar, row.kind === 'company' ? row.company_id : null, id, row.expected_employees, row.branches_count, row.country, row.business_model, actor.id, actor.id).first<Row>();
  await insertTree(tx, Number(created!.id), await loadTree(tx, id));
  await audit(tx, actor, 'duplicated', Number(created!.id), { from: id });
  return Number(created!.id);
}

/* ---------- Company blueprints ---------- */

export async function generateCompanyBlueprint(tx: Db, actor: ApiActor, raw: Record<string, unknown>) {
  const input = validateGenerateInput(raw);
  const type = await tx.prepare("SELECT * FROM blueprint_company_types WHERE id=? AND status='active'").bind(input.companyTypeId).first<Row>();
  if (!type) fail('TYPE_INVALID', 'companyTypeId', 'نوع الشركة غير متاح', 'The company type is not available', 409);
  let companyName: Name | null = null;
  if (input.companyId !== null) {
    const company = await tx.prepare("SELECT id,name,name_en,name_ar FROM companies WHERE id=? AND status='active'").bind(input.companyId).first<Row>();
    if (!company) fail('COMPANY_INVALID', 'companyId', 'الشركة غير متاحة', 'The company is not active', 409, );
    companyName = name(company!.name_en || company!.name, company!.name_ar || company!.name);
  }
  const template = input.templateId
    ? await tx.prepare("SELECT * FROM staffing_blueprints WHERE id=? AND kind='template' AND status='active' AND company_type_id=? AND size=?").bind(input.templateId, input.companyTypeId, input.size).first<Row>()
    : await tx.prepare("SELECT * FROM staffing_blueprints WHERE kind='template' AND status='active' AND company_type_id=? AND size=? ORDER BY is_default ASC,updated_at DESC,id DESC LIMIT 1").bind(input.companyTypeId, input.size).first<Row>();
  if (!template) fail('NO_TEMPLATE', null, 'لا يوجد قالب نشط لهذا النوع والحجم', 'There is no active template for this company type and size', 409);
  const generated = generateTree(await loadTree(tx, Number(template!.id)), { expectedEmployees: input.expectedEmployees, branches: input.branches });
  const n = input.name ?? { en: `${type!.name_en} — ${companyName?.en ?? 'New company'}`, ar: `${type!.name_ar} — ${companyName?.ar ?? 'شركة جديدة'}` };
  const row = await tx.prepare(`INSERT INTO staffing_blueprints (kind,name_en,name_ar,company_type_id,size,status,company_id,source_blueprint_id,expected_employees,branches_count,country,business_model,created_by,updated_by)
    VALUES ('company',?,?,?,?,'draft',?,?,?,?,?,?,?,?) RETURNING id`).bind(n.en, n.ar, input.companyTypeId, input.size, input.companyId, template!.id, input.expectedEmployees, input.branches, input.country, input.businessModel, actor.id, actor.id).first<Row>();
  await insertTree(tx, Number(row!.id), generated);
  await audit(tx, actor, 'generated', Number(row!.id), { template: Number(template!.id), size: input.size, headcount: totalHeadcount(generated) });
  return Number(row!.id);
}

export async function updateCompanyBlueprint(tx: Db, actor: ApiActor, id: number, raw: Record<string, unknown>) {
  const row = await editableBlueprint(tx, id, false);
  if (row.kind !== 'company') fail('NOT_COMPANY_BLUEPRINT', null, 'هذا ليس مخطط شركة', 'This is not a company blueprint', 409);
  const n = bilingual(raw.nameEn ?? row.name_en, raw.nameAr ?? row.name_ar, 'name');
  let companyId = row.company_id == null ? null : Number(row.company_id);
  if (raw.companyId !== undefined) {
    companyId = raw.companyId === null || raw.companyId === '' ? null : Number(raw.companyId) || null;
    if (companyId !== null && !await tx.prepare("SELECT id FROM companies WHERE id=? AND status='active'").bind(companyId).first()) fail('COMPANY_INVALID', 'companyId', 'الشركة غير متاحة', 'The company is not active', 409);
  }
  await tx.prepare('UPDATE staffing_blueprints SET name_en=?,name_ar=?,company_id=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(n.en, n.ar, companyId, actor.id, id).run();
}

export async function setCompanyBlueprintStatus(tx: Db, actor: ApiActor, id: number, action: 'approve' | 'reopen' | 'archive') {
  const row = await loadBlueprint(tx, id);
  if (row.kind !== 'company') fail('NOT_COMPANY_BLUEPRINT', null, 'هذا ليس مخطط شركة', 'This is not a company blueprint', 409);
  const status = row.status as CompanyBlueprintStatus;
  if (action === 'approve') {
    if (status !== 'draft') fail('NOT_DRAFT', null, 'يمكن اعتماد المسودات فقط', 'Only a draft can be approved', 409);
    if (!Number((await tx.prepare('SELECT count(*)::int AS n FROM blueprint_positions WHERE blueprint_id=?').bind(id).first<Row>())?.n ?? 0)) fail('BLUEPRINT_EMPTY', null, 'أضف وظيفة واحدة على الأقل', 'Add at least one position first', 409);
    await tx.prepare("UPDATE staffing_blueprints SET status='approved',approved_at=CURRENT_TIMESTAMP,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(actor.id, id).run();
  } else if (action === 'reopen') {
    if (status !== 'approved') fail('NOT_APPROVED', null, 'المخطط ليس معتمدًا', 'The blueprint is not approved', 409);
    await tx.prepare("UPDATE staffing_blueprints SET status='draft',approved_at=NULL,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(actor.id, id).run();
  } else {
    if (status === 'archived') fail('ALREADY_ARCHIVED', null, 'المخطط مؤرشف بالفعل', 'Already archived', 409);
    await tx.prepare("UPDATE staffing_blueprints SET status='archived',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(actor.id, id).run();
  }
  await audit(tx, actor, action, id, {});
}

/* ---------- Tree edits (templates and company drafts) ---------- */

export async function saveDepartment(tx: Db, actor: ApiActor, blueprintId: number, departmentId: number | null, raw: Record<string, unknown>, canManageLibrary: boolean) {
  await editableBlueprint(tx, blueprintId, canManageLibrary);
  const tree = await loadTree(tx, blueprintId);
  if (departmentId !== null && !tree.departments.some(d => d.id === departmentId)) fail('NOT_FOUND', null, 'الوحدة غير موجودة', 'Unit not found', 404);
  const input = validateDepartmentInput(raw, tree, departmentId);
  if (departmentId === null) {
    const order = Number((await tx.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM blueprint_departments WHERE blueprint_id=?').bind(blueprintId).first<Row>())?.n ?? 1);
    const row = await tx.prepare('INSERT INTO blueprint_departments (blueprint_id,parent_id,kind,name_en,name_ar,required,sort_order) VALUES (?,?,?,?,?,?,?) RETURNING id').bind(blueprintId, input.parentId, input.kind, input.name.en, input.name.ar, input.required ? 1 : 0, order).first<Row>();
    await tx.prepare('UPDATE staffing_blueprints SET updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(actor.id, blueprintId).run();
    return Number(row!.id);
  }
  // Changing a unit's kind must keep its children valid (a department cannot become a team while it holds sections).
  const children = tree.departments.filter(d => d.parentId === departmentId);
  if (children.some(c => (input.kind === 'team') || (input.kind === 'section' && c.kind !== 'team'))) fail('KIND_CONFLICT', 'kind', 'لا يمكن تغيير النوع لوجود وحدات فرعية', 'The unit type cannot change while it has sub-units that would become invalid', 409);
  await tx.prepare('UPDATE blueprint_departments SET parent_id=?,kind=?,name_en=?,name_ar=?,required=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(input.parentId, input.kind, input.name.en, input.name.ar, input.required ? 1 : 0, departmentId).run();
  await tx.prepare('UPDATE staffing_blueprints SET updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(actor.id, blueprintId).run();
  return departmentId;
}

export async function removeDepartmentFromBlueprint(tx: Db, actor: ApiActor, blueprintId: number, departmentId: number, canManageLibrary: boolean) {
  await editableBlueprint(tx, blueprintId, canManageLibrary);
  const tree = await loadTree(tx, blueprintId);
  if (!tree.departments.some(d => d.id === departmentId)) fail('NOT_FOUND', null, 'الوحدة غير موجودة', 'Unit not found', 404);
  // Foreign keys cascade to sub-units and their positions, and release positions elsewhere that reported into them.
  await tx.prepare('DELETE FROM blueprint_departments WHERE id=?').bind(departmentId).run();
  await tx.prepare('UPDATE staffing_blueprints SET updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(actor.id, blueprintId).run();
  return departmentSubtreeIds(tree, departmentId).size;
}

export async function savePosition(tx: Db, actor: ApiActor, blueprintId: number, positionId: number | null, raw: Record<string, unknown>, canManageLibrary: boolean) {
  await editableBlueprint(tx, blueprintId, canManageLibrary);
  const tree = await loadTree(tx, blueprintId);
  if (positionId !== null && !tree.positions.some(p => p.id === positionId)) fail('NOT_FOUND', null, 'الوظيفة غير موجودة', 'Position not found', 404);
  const input = validatePositionInput(raw, tree, positionId);
  const d = input.description;
  if (positionId === null) {
    const order = Number((await tx.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM blueprint_positions WHERE blueprint_id=? AND department_id=?').bind(blueprintId, input.departmentId).first<Row>())?.n ?? 1);
    const row = await tx.prepare('INSERT INTO blueprint_positions (blueprint_id,department_id,parent_position_id,title_en,title_ar,headcount,seniority,required,per_branch,description_en,description_ar,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id')
      .bind(blueprintId, input.departmentId, input.parentPositionId, input.title.en, input.title.ar, input.headcount, input.seniority, input.required ? 1 : 0, input.perBranch ? 1 : 0, d?.en ?? null, d?.ar ?? null, order).first<Row>();
    await tx.prepare('UPDATE staffing_blueprints SET updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(actor.id, blueprintId).run();
    return Number(row!.id);
  }
  await tx.prepare('UPDATE blueprint_positions SET department_id=?,parent_position_id=?,title_en=?,title_ar=?,headcount=?,seniority=?,required=?,per_branch=?,description_en=?,description_ar=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(input.departmentId, input.parentPositionId, input.title.en, input.title.ar, input.headcount, input.seniority, input.required ? 1 : 0, input.perBranch ? 1 : 0, d?.en ?? null, d?.ar ?? null, positionId).run();
  await tx.prepare('UPDATE staffing_blueprints SET updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(actor.id, blueprintId).run();
  return positionId;
}

export async function removePositionFromBlueprint(tx: Db, actor: ApiActor, blueprintId: number, positionId: number, canManageLibrary: boolean) {
  await editableBlueprint(tx, blueprintId, canManageLibrary);
  const gone = await tx.prepare('DELETE FROM blueprint_positions WHERE id=? AND blueprint_id=? RETURNING id').bind(positionId, blueprintId).first();
  if (!gone) fail('NOT_FOUND', null, 'الوظيفة غير موجودة', 'Position not found', 404);
  await tx.prepare('UPDATE staffing_blueprints SET updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(actor.id, blueprintId).run();
}

/* ---------- Apply to the real organization ---------- */

async function readExisting(tx: Db, companyId: number): Promise<{ units: ExistingUnit[]; titles: ExistingTitle[] }> {
  const units = (await tx.prepare("SELECT id,parent_id,organization_kind,name_en,name_ar FROM departments WHERE company_id=? AND status!='deleted'").bind(companyId).all<Row>()).results;
  const titles = (await tx.prepare("SELECT j.id,j.department_id,j.name_en,j.name_ar FROM job_titles j JOIN departments d ON d.id=j.department_id WHERE d.company_id=? AND d.status!='deleted' AND j.status='active'").bind(companyId).all<Row>()).results;
  return {
    units: units.map(r => ({ id: Number(r.id), parentId: num(r.parent_id), kind: ((r.organization_kind as string) || 'department') as UnitKind, nameEn: String(r.name_en), nameAr: String(r.name_ar) })),
    titles: titles.map(r => ({ id: Number(r.id), departmentId: num(r.department_id), nameEn: String(r.name_en), nameAr: String(r.name_ar) })),
  };
}

/** Read-only preview of what Apply would do against the company's current structure. */
export async function previewApplyBlueprint(db: Db, blueprintId: number): Promise<{ plan: ApplyPlan; companyId: number; status: string }> {
  const { blueprint, tree } = await readBlueprint(db, blueprintId);
  if (blueprint.kind !== 'company') fail('NOT_COMPANY_BLUEPRINT', null, 'هذا ليس مخطط شركة', 'Only a company blueprint can be applied', 409);
  if (blueprint.companyId === null) fail('COMPANY_REQUIRED', 'companyId', 'اربط المخطط بشركة أولًا', 'Choose the company this blueprint is for first', 409);
  const existing = await readExisting(db, blueprint.companyId!);
  return { plan: planApply(tree, existing.units, existing.titles), companyId: blueprint.companyId!, status: blueprint.status };
}

/**
 * Creates the missing departments, sections, teams and job titles in the company's real organization, through the same
 * validated services the Organization settings use. Existing units and titles are reused and never modified. Employees are
 * never created or moved. A company that already has units needs `confirmExisting`.
 */
export async function applyBlueprint(tx: Db, actor: ApiActor, blueprintId: number, confirmExisting: boolean) {
  await tx.prepare('SELECT pg_advisory_xact_lock(?)').bind(882).run();
  const row = await loadBlueprint(tx, blueprintId);
  if (row.kind !== 'company') fail('NOT_COMPANY_BLUEPRINT', null, 'هذا ليس مخطط شركة', 'Only a company blueprint can be applied', 409);
  if (row.status === 'applied') fail('ALREADY_APPLIED', null, 'تم تطبيق المخطط بالفعل', 'This blueprint was already applied', 409);
  if (row.status !== 'approved') fail('NOT_APPROVED', null, 'اعتمد المخطط قبل تطبيقه', 'Approve the blueprint before applying it', 409);
  if (row.company_id == null) fail('COMPANY_REQUIRED', 'companyId', 'اربط المخطط بشركة أولًا', 'Choose the company this blueprint is for first', 409);
  const companyId = Number(row.company_id);
  if (!await tx.prepare("SELECT id FROM companies WHERE id=? AND status='active'").bind(companyId).first()) fail('COMPANY_INVALID', 'companyId', 'الشركة غير نشطة', 'The company is not active', 409);
  const tree = await loadTree(tx, blueprintId);
  const existing = await readExisting(tx, companyId);
  const plan = planApply(tree, existing.units, existing.titles);
  if (plan.hasExistingStructure && !confirmExisting) throw new BlueprintError({ code: 'EXISTING_STRUCTURE', field: null, status: 409, message_ar: 'الشركة لديها هيكل تنظيمي قائم؛ راجع المعاينة وأكّد التطبيق', message_en: 'The company already has an organizational structure. Review the preview and confirm to apply' });

  const unitIds = new Map<number, number>();
  const created = { units: 0, titles: 0 };
  for (const item of plan.units) {
    if (item.action === 'reuse' && item.existingId !== null) { unitIds.set(item.departmentId, item.existingId); continue; }
    const saved = await saveOrganizationEntity(tx as TransactionDatabase, 'departments', {
      name_en: item.name.en, name_ar: item.name.ar, company_id: companyId, organization_kind: item.kind, parent_id: item.parentDepartmentId === null ? null : unitIds.get(item.parentDepartmentId) ?? null, branch_scope: 'all', status: 'active',
    }, actor.id);
    unitIds.set(item.departmentId, saved.id); created.units++;
  }
  const titleIds = new Map<string, number>();
  for (const item of plan.positions) {
    const topId = unitIds.get(item.topDepartmentId);
    if (!topId) continue;
    const key = `${topId}:${item.title.en.toLowerCase()}|${item.title.ar}`;
    if (item.action === 'reuse' && item.existingId !== null) { titleIds.set(key, item.existingId); continue; }
    if (titleIds.has(key)) continue;
    const saved = await saveJobTitle(tx as TransactionDatabase, { nameEn: item.title.en, nameAr: item.title.ar, departmentId: topId, status: 'active' }, { id: actor.id });
    titleIds.set(key, saved.id); created.titles++;
  }
  await tx.prepare("UPDATE staffing_blueprints SET status='applied',applied_at=CURRENT_TIMESTAMP,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(actor.id, blueprintId).run();
  await audit(tx, actor, 'applied', blueprintId, { companyId, created, reused: { units: plan.counts.unitsReused, titles: plan.counts.titlesReused }, confirmedExisting: plan.hasExistingStructure });
  return { created, reused: { units: plan.counts.unitsReused, titles: plan.counts.titlesReused }, companyId };
}

