import type { Row } from '../ui-types';
import type { OrganizationCatalog } from './assignment-policy.ts';
import { CURRENT_EMPLOYMENT } from './assignment-policy.ts';
import { issueOf, orgError, type OrganizationIssue } from './org-errors.ts';

/**
 * Pure impact analysis for high-impact Settings changes. The same functions produce the preview the user reviews
 * and the checks the server enforces on save, so a preview can never disagree with the save.
 * Nothing here changes employee assignments: impact is reported, never repaired automatically.
 */
export type ImpactContext = { catalog: OrganizationCatalog; employees: Row[] };
export type ImpactPlan = {
  blocking: OrganizationIssue[];
  warnings: OrganizationIssue[];
  /** When set, the save must echo this token back as `confirmImpact` (proves the reviewed impact is still current). */
  confirmationToken: string | null;
  impact: Record<string, unknown>;
};
export const emptyPlan = (): ImpactPlan => ({ blocking: [], warnings: [], confirmationToken: null, impact: {} });

const current = (e: Row) => CURRENT_EMPLOYMENT.includes(String(e.employment_status));
const live = (e: Row) => e.employment_status !== 'deleted';
const person = (e: Row) => ({ id: Number(e.id), employee_code: e.employee_code ?? null, name_en: e.name_en ?? null, name_ar: e.name_ar ?? null, employment_status: e.employment_status ?? null, company_id: e.company_id ?? null, branch_id: e.branch_id ?? null, department_id: e.department_id ?? null });
const nameOf = (row?: Row | null) => (row ? String(row.name_en || row.name_ar || row.name || `#${row.id}`) : null);
const byId = (rows: Row[], id: unknown) => rows.find(r => Number(r.id) === Number(id));
const token = (parts: unknown[]) => parts.map(p => (Array.isArray(p) ? [...p].map(Number).sort((a, b) => a - b).join('.') : String(p ?? ''))).join(':');
const add = (list: OrganizationIssue[], error: ReturnType<typeof orgError>) => list.push(issueOf(error));

/* ------------------------------------------------------------------ job titles */

/** Rebinding (or archiving) a job title: who uses it, which employees' current department would become or stop being inconsistent. */
export function jobTitleImpact(ctx: ImpactContext, titleId: number | null, next: { department_id: number | null; status: string }): ImpactPlan {
  const plan = emptyPlan();
  const title = titleId ? byId(ctx.catalog.jobTitles, titleId) : undefined;
  const beforeDept = title?.department_id ? Number(title.department_id) : null;
  const afterDept = next.department_id ? Number(next.department_id) : null;
  if (afterDept !== beforeDept && afterDept) {
    const unit = byId(ctx.catalog.departments, afterDept);
    if (!unit || unit.status === 'deleted') add(plan.blocking, orgError('INVALID_SELECTION', 'department_id', 'الإدارة غير موجودة', 'Department not found', { blocking: { type: 'unit', id: afterDept } }));
    else if (!unit.company_id) add(plan.blocking, orgError('LEGACY_UNIT', 'department_id', 'لا يمكن ربط المسمى بوحدة قديمة بلا شركة', 'A job title cannot be newly bound to a legacy unit without a company', { blocking: { type: 'unit', id: unit.id, name: nameOf(unit), legacy: true } }));
    else if (unit.status !== 'active') add(plan.blocking, orgError('INACTIVE_SELECTION', 'department_id', 'اختر إدارة نشطة', 'Select an active department', { blocking: { type: 'unit', id: unit.id, name: nameOf(unit) } }));
    else if ((unit.organization_kind || 'department') !== 'department') add(plan.blocking, orgError('INVALID_UNIT_KIND', 'department_id', 'يُربط المسمى بإدارة وليس بقسم أو فريق', 'Bind a job title to a department, not a section or team', { blocking: { type: 'unit', id: unit.id, name: nameOf(unit) } }));
  }
  const users = titleId ? ctx.employees.filter(e => Number(e.job_title_id) === titleId && live(e)) : [];
  const now = users.filter(current);
  const mismatch = (e: Row, dept: number | null) => dept !== null && Number(e.department_id) !== dept;
  const created = now.filter(e => !mismatch(e, beforeDept) && mismatch(e, afterDept));
  const resolved = now.filter(e => mismatch(e, beforeDept) && !mismatch(e, afterDept));
  const remaining = now.filter(e => mismatch(e, beforeDept) && mismatch(e, afterDept));
  const legacyUnit = (id: unknown) => { const u = byId(ctx.catalog.departments, id); return Boolean(u && !u.company_id); };
  const legacy = now.filter(e => legacyUnit(e.department_id));
  const positions = titleId ? ctx.catalog.positions.filter(p => Number(p.job_title_id) === titleId && p.status !== 'deleted') : [];
  const conflicting = afterDept !== beforeDept && afterDept ? positions.filter(p => Number(p.department_id) !== afterDept) : [];
  for (const p of conflicting) {
    const issue = orgError('POSITION_CONTRADICTION', 'department_id', `الوظيفة «${nameOf(p)}» تستخدم هذا المسمى في إدارة أخرى`, `Position "${nameOf(p)}" uses this title in another department`, { blocking: { type: 'position', id: p.id, name: nameOf(p), department_id: p.department_id ?? null, status: p.status } });
    add(p.status === 'active' ? plan.blocking : plan.warnings, issue);
  }
  if (next.status !== 'active' && title?.status === 'active') {
    const activePositions = positions.filter(p => p.status === 'active');
    if (now.length || activePositions.length) add(plan.blocking, orgError('ACTIVE_DEPENDENTS', 'status', `لا يمكن أرشفة المسمى: مستخدم من ${now.length} موظف حالي و${activePositions.length} وظيفة نشطة`, `Cannot archive: used by ${now.length} current employee(s) and ${activePositions.length} active position(s)`, { details: { employees: now.map(person), positions: activePositions.map(p => ({ id: p.id, name: nameOf(p) })) } }));
  }
  if (created.length) add(plan.warnings, orgError('JOB_TITLE_DEPARTMENT_MISMATCH', 'department_id', `${created.length} موظف حالي سيصبح مسماه غير متوافق مع إدارته (لن تُعدَّل بياناتهم)`, `${created.length} current employee(s) would have a title that no longer matches their department (their records are not changed)`, { details: { employees: created.map(person) } }));
  plan.impact = {
    employees: { total: users.length, current: now.length, historical: users.length - now.length },
    mismatch: { created: created.map(person), resolved: resolved.map(person), remaining: remaining.map(person) },
    legacy: legacy.map(person),
    positions: { total: positions.length, conflicting: conflicting.map(p => ({ id: p.id, name: nameOf(p), status: p.status, department_id: p.department_id ?? null })) },
    binding: { before: beforeDept, after: afterDept, before_legacy: beforeDept ? legacyUnit(beforeDept) : false },
  };
  if (created.length) plan.confirmationToken = token(['jobTitle', titleId, afterDept, created.map(e => e.id)]);
  return plan;
}

/* ------------------------------------------------------------------ units: scope, adoption, reactivation */

const unitRefs = (e: Row, unitId: number) => [e.department_id, e.section_id, e.team_id].some(v => Number(v) === unitId);

/** Branch scope change: employees assigned to the unit in a branch that would leave its scope become invalid. */
export function unitScopeImpact(ctx: ImpactContext, unitId: number, next: { company_id: number | null; branch_scope: string; branchIds: number[] }): ImpactPlan {
  const plan = emptyPlan();
  if (next.branch_scope !== 'selected') return plan;
  const allowed = new Set(next.branchIds.map(Number));
  const assigned = ctx.employees.filter(e => live(e) && unitRefs(e, unitId));
  const outside = assigned.filter(e => !e.branch_id || !allowed.has(Number(e.branch_id)));
  const blocked = outside.filter(current), historical = outside.filter(e => !current(e));
  if (blocked.length) add(plan.blocking, orgError('UNIT_OUTSIDE_BRANCH_SCOPE', 'branchIds', `${blocked.length} موظف حالي في هذه الوحدة يعمل في فرع سيخرج من النطاق`, `${blocked.length} current employee(s) of this unit work in a branch that would leave its scope`, { details: { employees: blocked.map(person) } }));
  if (historical.length) add(plan.warnings, orgError('UNIT_OUTSIDE_BRANCH_SCOPE', 'branchIds', `${historical.length} سجل تاريخي سيبقى خارج النطاق`, `${historical.length} historical record(s) will stay outside the scope`, { details: { employees: historical.map(person) } }));
  plan.impact = { scope: { employees_in_unit: assigned.filter(current).length, invalid: blocked.map(person), historical: historical.map(person) } };
  return plan;
}

/** Adopting a legacy (company-less) unit into a company: every current employee using it must already be in that company. */
export function legacyAdoptionImpact(ctx: ImpactContext, unit: Row, companyId: number): ImpactPlan {
  const plan = emptyPlan();
  const unitId = Number(unit.id);
  const users = ctx.employees.filter(e => live(e) && unitRefs(e, unitId));
  const wrong = users.filter(e => current(e) && Number(e.company_id || 0) !== companyId);
  const historical = users.filter(e => !current(e));
  if (wrong.length) add(plan.blocking, orgError('UNIT_OUTSIDE_COMPANY', 'company_id', `${wrong.length} موظف حالي في هذه الوحدة لا يتبع الشركة المختارة — انقلهم أو عدّل شركتهم أولًا`, `${wrong.length} current employee(s) of this unit are not in the chosen company — move them or set their company first`, { details: { employees: wrong.map(person) } }));
  const titles = ctx.catalog.jobTitles.filter(t => Number(t.department_id) === unitId && t.status !== 'deleted');
  const children = ctx.catalog.departments.filter(d => Number(d.parent_id) === unitId && d.status !== 'deleted');
  add(plan.warnings, orgError('LEGACY_UNIT', 'company_id', 'ستنضم الوحدة القديمة إلى الهيكل الجديد تحت الشركة المختارة', 'The legacy unit will join the new structure under the chosen company', { details: { titles: titles.map(t => ({ id: t.id, name: nameOf(t) })), children: children.map(c => ({ id: c.id, name: nameOf(c), legacy: !c.company_id })) } }));
  if (historical.length) add(plan.warnings, orgError('REFERENCED_ENTITY_CONFLICT', 'company_id', `${historical.length} سجل تاريخي يستخدم الوحدة`, `${historical.length} historical record(s) use this unit`, { details: { employees: historical.map(person) } }));
  plan.impact = { adoption: { unit_id: unitId, company_id: companyId, employees: users.filter(current).map(person), historical: historical.map(person), titles: titles.map(t => ({ id: t.id, name: nameOf(t) })) } };
  plan.confirmationToken = token(['adopt', unitId, companyId, users.map(e => e.id)]);
  return plan;
}

/** Inactive units awaiting business scope review are never activated implicitly. */
export function reactivationImpact(unit: Row, next: { branch_scope: string; branchIds: number[] }): ImpactPlan {
  const plan = emptyPlan();
  add(plan.warnings, orgError('SCOPE_REVIEW_REQUIRED', 'status', 'مراجعة نطاق الفروع مطلوبة قبل التفعيل؛ تأكد من النطاق المختار', 'Scope review required before activation; confirm the chosen branch scope', { blocking: { type: 'unit', id: unit.id, name: nameOf(unit) }, details: { branch_scope: next.branch_scope, branchIds: next.branchIds } }));
  plan.impact = { reactivation: { unit_id: unit.id, branch_scope: next.branch_scope, branchIds: next.branchIds } };
  plan.confirmationToken = token(['reactivate', unit.id, next.branch_scope, next.branchIds]);
  return plan;
}

/* ------------------------------------------------------------------ company ↔ branch links */

/** Removing one company↔branch association: only what uses that exact pair is affected. */
export function linkRemovalImpact(ctx: ImpactContext, companyId: number, branchId: number): ImpactPlan {
  const plan = emptyPlan();
  const company = byId(ctx.catalog.companies, companyId), branch = byId(ctx.catalog.branches, branchId);
  const pair = { type: 'company_branch', company_id: companyId, branch_id: branchId, name: `${nameOf(company)} ↔ ${nameOf(branch)}` };
  const staff = ctx.employees.filter(e => live(e) && Number(e.company_id) === companyId && Number(e.branch_id) === branchId);
  const rules = ctx.catalog.hrRules.filter(r => Number(r.company_id) === companyId && Number(r.branch_id) === branchId);
  const unitIds = new Set(ctx.catalog.departments.filter(d => Number(d.company_id) === companyId).map(d => Number(d.id)));
  const scopes = ctx.catalog.branchScopes.filter(s => Number(s.branch_id) === branchId && unitIds.has(Number(s.department_id)));
  const locations = ctx.catalog.workLocations.filter(w => Number(w.branch_id) === branchId);
  const locationUsers = ctx.employees.filter(e => current(e) && Number(e.company_id) === companyId && locations.some(w => Number(w.id) === Number(e.work_location_id)));
  const unitName = (id: unknown) => nameOf(byId(ctx.catalog.departments, id));
  const activeStaff = staff.filter(current), pastStaff = staff.filter(e => !current(e));
  if (activeStaff.length) add(plan.blocking, orgError('REFERENCED_ENTITY_CONFLICT', 'branchIds', `${activeStaff.length} موظف حالي مُعيَّن على هذه الشركة وهذا الفرع`, `${activeStaff.length} current employee(s) are assigned to this company and branch`, { blocking: pair, details: { employees: activeStaff.map(person) } }));
  if (pastStaff.length) add(plan.blocking, orgError('REFERENCED_ENTITY_CONFLICT', 'branchIds', `${pastStaff.length} سجل موظف تاريخي يستخدم هذا الارتباط`, `${pastStaff.length} historical employee record(s) use this association`, { blocking: pair, details: { employees: pastStaff.map(person) } }));
  const activeRules = rules.filter(r => r.status === 'active');
  if (activeRules.length) add(plan.blocking, orgError('REFERENCED_ENTITY_CONFLICT', 'branchIds', `${activeRules.length} قاعدة موارد بشرية نشطة لهذا الارتباط`, `${activeRules.length} active HR rule(s) use this association`, { blocking: pair, details: { hrRules: activeRules.map(r => ({ id: r.id, hr_user_id: r.hr_user_id })) } }));
  if (rules.length > activeRules.length) add(plan.warnings, orgError('REFERENCED_ENTITY_CONFLICT', 'branchIds', 'قواعد موارد بشرية غير نشطة تشير إلى هذا الارتباط', 'Inactive HR rules reference this association', { details: { hrRules: rules.filter(r => r.status !== 'active').map(r => ({ id: r.id })) } }));
  if (scopes.length) add(plan.blocking, orgError('REFERENCED_ENTITY_CONFLICT', 'branchIds', `${scopes.length} وحدة تنظيمية تشمل هذا الفرع في نطاقها`, `${scopes.length} organizational unit scope(s) include this branch`, { blocking: pair, details: { units: scopes.map(s => ({ id: s.department_id, name: unitName(s.department_id) })) } }));
  if (locationUsers.length) add(plan.blocking, orgError('REFERENCED_ENTITY_CONFLICT', 'branchIds', `${locationUsers.length} موظف حالي في الشركة يعمل في مقر تابع لهذا الفرع`, `${locationUsers.length} current employee(s) of the company use a work location of this branch`, { blocking: pair, details: { employees: locationUsers.map(person) } }));
  plan.impact = { link: { ...pair, employees: activeStaff.map(person), historical: pastStaff.map(person), hrRules: rules.map(r => ({ id: r.id, status: r.status })), unitScopes: scopes.map(s => ({ id: s.department_id, name: unitName(s.department_id) })), workLocations: locations.map(w => ({ id: w.id, name: nameOf(w) })) } };
  return plan;
}

/* ------------------------------------------------------------------ positions */

export function positionOccupantsImpact(ctx: ImpactContext, positionId: number): { current: Row[]; historical: Row[] } {
  const users = ctx.employees.filter(e => live(e) && Number(e.position_id) === positionId);
  return { current: users.filter(current).map(person), historical: users.filter(e => !current(e)).map(person) };
}

/* ------------------------------------------------------------------ unit managers */

/** Any existing, non-deleted employee can be assigned as a unit manager. */
export function unitManagerIssue(employee: Row | null | undefined): OrganizationIssue | null {
  if (!employee) return issueOf(orgError('INVALID_UNIT_MANAGER', 'manager_employee_id', 'الموظف المختار غير موجود', 'The selected employee does not exist'));
  if (employee.employment_status === 'deleted') return issueOf(orgError('INVALID_UNIT_MANAGER', 'manager_employee_id', 'الموظف المختار محذوف', 'The selected employee is deleted', { blocking: { type: 'employee', id: employee.id } }));
  return null;
}
