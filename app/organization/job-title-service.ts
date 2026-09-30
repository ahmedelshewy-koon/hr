import type { TransactionDatabase } from '../../db/postgres';
import type { Row } from '../ui-types';
import { organizationReady } from './assignment-service.ts';
import { readImpactContext, enforcePlan } from './catalog-service.ts';
import { jobTitleImpact, emptyPlan, type ImpactPlan } from './impact-policy.ts';
import { asResponse, orgError } from './org-errors.ts';

/**
 * Job titles: one catalog shared by Settings and the legacy HR endpoint. Active titles can be edited directly;
 * changing their department does not rewrite employee or position assignments. Archiving a used title stays blocked.
 */
export type JobTitleInput = { jobTitleId?: unknown; nameEn?: unknown; nameAr?: unknown; departmentId?: unknown; status?: unknown; confirmImpact?: unknown };
const clean = (value: unknown) => String(value ?? '').trim();
const fail = (code: Parameters<typeof orgError>[0], field: string | null, ar: string, en: string, status = 400) => asResponse(orgError(code, field, ar, en, { status }), status);

async function normalize(db: TransactionDatabase, input: JobTitleInput) {
  const id = Number(input.jobTitleId) || null;
  const nameEn = clean(input.nameEn), nameAr = clean(input.nameAr);
  if (!nameEn) throw fail('REQUIRED_FIELD', 'name_en', 'الاسم بالإنجليزية مطلوب', 'English name is required');
  if (!nameAr) throw fail('REQUIRED_FIELD', 'name_ar', 'الاسم بالعربية مطلوب', 'Arabic name is required');
  if (nameEn.length > 200 || nameAr.length > 200) throw fail('INVALID_SELECTION', null, 'القيمة طويلة جدًا', 'Value is too long');
  const departmentId = Number(input.departmentId) || null;
  const status = clean(input.status) === 'archived' || clean(input.status) === 'inactive' ? 'archived' : 'active';
  if (departmentId && !await db.prepare("SELECT id FROM departments WHERE id=? AND status!='deleted'").bind(departmentId).first()) throw fail('NOT_FOUND', 'department_id', 'الإدارة غير موجودة', 'Department not found', 404);
  return { id, nameEn, nameAr, departmentId, status };
}

async function plan(db: TransactionDatabase, id: number | null, before: Row | null, next: { departmentId: number | null; status: string }): Promise<ImpactPlan> {
  if (!await organizationReady(db)) {
    // Pre-readiness fallback: no organizational catalog yet, keep the historical conservative rule.
    const result = emptyPlan();
    const structural = before && Number(before.department_id || 0) !== Number(next.departmentId || 0);
    if (before && next.status !== 'active' && before.status === 'active') {
      const employee = await db.prepare(`SELECT id FROM employees WHERE job_title_id=? ${structural ? '' : "AND employment_status IN ('active','probation','notice_period')"} LIMIT 1`).bind(id).first();
      if (employee) result.blocking.push({ code: 'REFERENCED_ENTITY_CONFLICT', field: 'department_id', message_ar: 'المسمى مستخدم؛ راجع التعيينات أولًا', message_en: 'Job title is referenced; review assignments first' });
    }
    return result;
  }
  const ctx = await readImpactContext(db);
  const impact = jobTitleImpact(ctx, id, { department_id: next.departmentId, status: next.status });
  if (next.status === 'active') return { ...impact, blocking: impact.blocking.filter(issue => issue.code !== 'POSITION_CONTRADICTION'), warnings: [], confirmationToken: null };
  return impact;
}

export async function previewJobTitle(db: TransactionDatabase, input: JobTitleInput) {
  await db.prepare('SELECT pg_advisory_xact_lock(78231)').run();
  const next = await normalize(db, input);
  const before = next.id ? await db.prepare("SELECT * FROM job_titles WHERE id=? AND status!='deleted'").bind(next.id).first<Row>() : null;
  if (next.id && !before) throw fail('NOT_FOUND', 'id', 'المسمى الوظيفي غير موجود', 'Job title not found', 404);
  const result = await plan(db, next.id, before, next);
  return { ok: !result.blocking.length, blocking: result.blocking, warnings: result.warnings, confirmationToken: result.confirmationToken, impact: result.impact, before, after: { name_en: next.nameEn, name_ar: next.nameAr, department_id: next.departmentId, status: next.status } };
}

/** Create or update inside the caller's transaction; audit is written in the same transaction. */
export async function saveJobTitle(db: TransactionDatabase, input: JobTitleInput, actor: { id: number | null; ip?: string | null }) {
  await db.prepare('SELECT pg_advisory_xact_lock(78231)').run();
  const next = await normalize(db, input);
  const before = next.id ? await db.prepare("SELECT * FROM job_titles WHERE id=? AND status!='deleted' FOR UPDATE").bind(next.id).first<Row>() : null;
  if (next.id && !before) throw fail('NOT_FOUND', 'id', 'المسمى الوظيفي غير موجود', 'Job title not found', 404);
  enforcePlan(await plan(db, next.id, before, next), input.confirmImpact);
  let id = next.id;
  if (id) await db.prepare('UPDATE job_titles SET name_en=?,name_ar=?,department_id=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(next.nameEn, next.nameAr, next.departmentId, next.status, id).run();
  else id = Number((await db.prepare('INSERT INTO job_titles (name_en,name_ar,department_id,status,created_at,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id').bind(next.nameEn, next.nameAr, next.departmentId, next.status).first<{ id: number }>())!.id);
  const after = await db.prepare('SELECT * FROM job_titles WHERE id=?').bind(id).first<Row>();
  const extra = before && Number(before.department_id || 0) !== Number(next.departmentId || 0) ? { bindingChange: { before: before.department_id ?? null, after: next.departmentId } } : {};
  await db.prepare(`INSERT INTO audit_logs(user_id,action,module,record_type,record_id,previous_value,new_value,ip_address) VALUES (?,'${before ? 'update' : 'create'}','job_titles','job_title',?,?,?,?)`).bind(actor.id, String(id), before ? JSON.stringify(before) : null, JSON.stringify({ ...(after ?? {}), ...extra, ...(before && before.status !== next.status ? { statusChange: { before: before.status, after: next.status } } : {}) }), actor.ip ?? null).run();
  return { id: Number(id), created: !before };
}
