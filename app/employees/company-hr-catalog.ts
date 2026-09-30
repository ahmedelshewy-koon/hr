import { organizationReady } from '../organization/assignment-service.ts';
import { saveOrganizationEntity } from '../organization/catalog-service.ts';
import { HR_ELIGIBLE_SQL, readHrRoster } from '../organization/hr-roster.ts';
import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";

type Db = PostgresDatabase | TransactionDatabase;
type Row = Record<string, unknown>;

function optionalId(value: unknown): number | null {
  if(value === null || value === undefined || value === "") return null;
  const id = Number(value);
  if(!Number.isSafeInteger(id) || id <= 0) throw new Response("اختيار غير صالح", {status:400});
  return id;
}

export async function validateCompanyHr(db: Db, payload: Row, before?: Row) {
  const companyId = optionalId(payload.companyId === undefined ? before?.company_id : payload.companyId);
  const hrUserId = optionalId(payload.hrUserId === undefined ? before?.hr_user_id : payload.hrUserId);
  if(companyId && companyId !== Number(before?.company_id)) {
    const company = await db.prepare("SELECT id FROM companies WHERE id=? AND status='active'").bind(companyId).first();
    if(!company) throw new Response("اختر شركة مفعّلة من الإعدادات", {status:400});
  }
  if(hrUserId && hrUserId !== Number(before?.hr_user_id)) {
    const hr = await db.prepare(`SELECT u.id FROM hr_responsibles h JOIN users u ON u.id=h.user_id JOIN roles r ON r.id=u.role_id LEFT JOIN employees he ON he.id=u.employee_id WHERE h.user_id=? AND h.status='active' AND ${HR_ELIGIBLE_SQL}`).bind(hrUserId).first();
    if(!hr) throw new Response("اختر مسؤول موارد بشرية مفعّلًا من الإعدادات", {status:400});
    if(before?.id && Number((await db.prepare("SELECT employee_id FROM users WHERE id=?").bind(hrUserId).first<Row>())?.employee_id) === Number(before.id)) throw new Response("لا يمكن تعيين الموظف مسؤول موارد بشرية لنفسه", {status:400});
  }
  return {companyId,hrUserId};
}

export async function readCompanyHrCatalog(db: Db, includeCandidates: boolean) {
  const companies = (await db.prepare("SELECT id,name,status FROM companies ORDER BY name,id").all()).results;
    const hrResponsibles = await readHrRoster(db);
  const hrCandidates = includeCandidates ? (await db.prepare("SELECT u.id AS user_id,u.email,e.id AS employee_id,COALESCE(e.name_en,e.name_ar) AS name_en,COALESCE(e.name_ar,e.name_en,u.email) AS name_ar FROM users u JOIN roles r ON r.id=u.role_id JOIN employees e ON e.id=u.employee_id WHERE u.status='active' AND r.name IN ('HR Manager','Super Admin') AND e.employment_status IN ('active','probation','notice_period') ORDER BY name_en").all()).results : [];
  return {companies,hrResponsibles,hrCandidates};
}

export async function saveCompanyHrCatalog(db: Db, action: string, payload: Row, actorId?: number) {
  await db.prepare('SELECT pg_advisory_xact_lock(78231)').run();
  const status = payload.active === false ? "inactive" : "active";
  if(action === "save_company") {
    const id = optionalId(payload.companyId);
    if(await organizationReady(db))return saveOrganizationEntity(db,'companies',{id,name_en:payload.name,status},actorId);
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if(!name || name.length > 200) throw new Response("اسم الشركة مطلوب وبحد أقصى ٢٠٠ حرف", {status:400});
    const duplicate = await db.prepare("SELECT id FROM companies WHERE lower(btrim(name))=lower(?) AND id<>?").bind(name,id||0).first();
    if(duplicate) throw new Response("اسم الشركة موجود بالفعل", {status:409});
    if(id) {
      if(status!=='active'){
        if(await db.prepare("SELECT id FROM employees WHERE company_id=? AND employment_status IN ('active','probation','notice_period') LIMIT 1").bind(id).first())throw new Response('Company is referenced by employees',{status:409});

      }
      const updated = await db.prepare("UPDATE companies SET name=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING id").bind(name,status,id).first();
      if(!updated) throw new Response("الشركة غير موجودة", {status:404});
      return updated;
    }
    return await db.prepare("INSERT INTO companies(name,status) VALUES (?,?) RETURNING id").bind(name,status).first();
  }
  const userId = optionalId(payload.hrUserId);
  if(!userId) throw new Response("اختر مسؤول الموارد البشرية", {status:400});
  if(status!=='active'){
    if(await db.prepare('SELECT id FROM employees WHERE hr_user_id=? LIMIT 1').bind(userId).first())throw new Response('HR responsible is assigned to employees',{status:409});
    if(await organizationReady(db)&&await db.prepare("SELECT id FROM hr_responsibility_rules WHERE hr_user_id=? AND status='active' LIMIT 1").bind(userId).first())throw new Response('HR responsible is used by routing rules',{status:409});
  }
  if(status === "active") {
    // Same identity rule as the picker in readCompanyHrCatalog: the account must belong to a real, current employee.
    const candidate = await db.prepare("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id JOIN employees e ON e.id=u.employee_id WHERE u.id=? AND u.status='active' AND r.name IN ('HR Manager','Super Admin') AND e.employment_status IN ('active','probation','notice_period')").bind(userId).first();
    if(!candidate) throw new Response("يجب اختيار حساب نشط بصلاحية الموارد البشرية ومرتبط بموظف حالي", {status:400});
  }
  await db.prepare("INSERT INTO hr_responsibles(user_id,status) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,updated_at=CURRENT_TIMESTAMP").bind(userId,status).run();
  return {userId};
}
