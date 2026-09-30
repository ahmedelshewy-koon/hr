import type { Row } from '../ui-types';
import type { OrganizationCatalog } from './assignment-policy.ts';
import { issueOf, orgError, type OrganizationIssue } from './org-errors.ts';

/**
 * The single HR responsibility resolver. Browser (Settings, Employee Profile) and server (profile API, rule impact,
 * Settings insights) call this; request workflows use `effectiveHrSql` in employees/hr-assignment.ts, which is the
 * same precedence written as SQL so queues can filter by it.
 *
 * Precedence, first match wins:
 *   1. employees.hr_user_id — an explicit, persisted employee exception
 *   2. the active Company + Branch rule
 *   3. the active Branch Fallback rule (company_id NULL)
 *   4. none ("Needs HR setup")
 * A match whose HR responsible cannot act (inactive, unlinked, not HR, the employee themself) is reported as
 * unavailable. It never falls through to a lower rule: nobody is assigned silently.
 * Department, job title, manager, country, work location and email are never consulted.
 * The resolved person is derived and must never be written back into employees.hr_user_id.
 */
export type HrSource = 'employee_override' | 'company_branch' | 'branch_fallback' | 'none';
export type HrReason =
  | 'override' | 'rule'
  | 'override_unavailable' | 'rule_hr_unavailable'
  | 'missing_company_branch' | 'missing_branch' | 'missing_company' | 'no_rule';
export type HrRuleType = 'company_branch' | 'branch_fallback';

export type HrResolution = {
  employeeId: number | null;
  /** The account that acts as HR responsible (users.id). */
  hrUserId: number | null;
  /** The employee record behind that account. */
  hrEmployeeId: number | null;
  source: HrSource;
  ruleId: number | null;
  rule: Row | null;
  hr: Row | null;
  /** True when requests can be routed to hrUserId now. */
  available: boolean;
  reason: HrReason;
  /** The persisted override (employees.hr_user_id), reported separately from the result. */
  overrideUserId: number | null;
};

type Bilingual = { ar: string; en: string };
export const HR_SOURCE_LABEL: Record<HrSource, Bilingual> = {
  employee_override: { ar: 'استثناء الموظف', en: 'Employee override' },
  company_branch: { ar: 'قاعدة الشركة + الفرع', en: 'Company + Branch rule' },
  branch_fallback: { ar: 'قاعدة الفرع الاحتياطية', en: 'Branch fallback' },
  none: { ar: 'يحتاج إعداد الموارد البشرية', en: 'Needs HR setup' },
};
export const HR_RULE_TYPE_LABEL: Record<HrRuleType, Bilingual> = {
  company_branch: { ar: 'الشركة + الفرع', en: 'Company + Branch' },
  branch_fallback: { ar: 'احتياطي الفرع', en: 'Branch Fallback' },
};
export const HR_REASON_TEXT: Record<HrReason, Bilingual> = {
  override: { ar: 'محدد صراحةً في ملف الموظف', en: 'Set explicitly in the employee profile' },
  rule: { ar: 'مستنتج من شركة الموظف وفرعه', en: "Derived from the employee's company and branch" },
  override_unavailable: { ar: 'مسؤول الاستثناء غير متاح حاليًا (غير نشط أو غير مؤهل). ستُرفض الطلبات حتى يُحدَّث الاستثناء أو يُمسح.', en: 'The override HR responsible is currently unavailable (inactive or ineligible). Requests are blocked until the override is changed or cleared.' },
  rule_hr_unavailable: { ar: 'مسؤول القاعدة المطابقة غير متاح حاليًا. ستُرفض الطلبات حتى تُحدَّث القاعدة.', en: "The matched rule's HR responsible is currently unavailable. Requests are blocked until the rule is updated." },
  missing_company_branch: { ar: 'لا يمكن تحديد مسؤول الموارد البشرية بعد: الشركة والفرع مطلوبان للقاعدة.', en: 'HR Responsible cannot be resolved yet: Company and Branch are required for the configured HR rule.' },
  missing_branch: { ar: 'لا يمكن تحديد مسؤول الموارد البشرية بعد: الفرع مطلوب للقاعدة.', en: 'HR Responsible cannot be resolved yet: Branch is required for the configured HR rule.' },
  missing_company: { ar: 'لا يمكن تحديد مسؤول الموارد البشرية بعد: الشركة مطلوبة لقاعدة الشركة + الفرع، ولا توجد قاعدة احتياطية للفرع.', en: 'HR Responsible cannot be resolved yet: Company is required for a Company + Branch rule and the branch has no fallback.' },
  no_rule: { ar: 'لا توجد قاعدة نشطة لهذه الشركة والفرع.', en: 'No active rule covers this company and branch.' },
};

const CURRENT_EMPLOYMENT = ['active', 'probation', 'notice_period'];

/** The active rule for a company + branch: Company + Branch first, then the Branch Fallback. */
export function resolveHrRule(catalog: Pick<OrganizationCatalog, 'hrRules'>, assignment: Row): Row | undefined {
  const rules = catalog.hrRules.filter(r => r.status === 'active' && assignment.branch_id != null && assignment.branch_id !== '' && Number(r.branch_id) === Number(assignment.branch_id));
  return rules.find(r => r.company_id != null && Number(r.company_id) === Number(assignment.company_id)) ?? rules.find(r => r.company_id == null);
}

export const hrRuleType = (rule: Row): HrRuleType => (rule.company_id ? 'company_branch' : 'branch_fallback');
const idOf = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number(value) || null);
const current = (employee: Row) => CURRENT_EMPLOYMENT.includes(String(employee.employment_status ?? 'active'));

/** Server-computed eligibility of a roster entry (see HR_ELIGIBLE_USER_SQL). */
export const hrEligible = (hr?: Row | null) => Boolean(hr && (hr.eligible === true || Number(hr.eligible) === 1));
/** Can this roster entry receive requests for the given employee? Never the employee themself. */
export function hrUsableFor(hr: Row | null | undefined, employeeId?: unknown): boolean {
  if (!hr || hr.status !== 'active' || !hrEligible(hr) || !hr.employee_id) return false;
  return !(employeeId && Number(hr.employee_id) === Number(employeeId));
}

/** Employee fields read: id, company_id, branch_id, hr_user_id (camelCase profile drafts are accepted too). */
export function resolveEmployeeHrResponsibility({ employee, catalog, roster }: { employee: Row; catalog: Pick<OrganizationCatalog, 'hrRules'>; roster: Row[] }): HrResolution {
  const employeeId = idOf(employee.id ?? employee.employeeId);
  const companyId = idOf(employee.company_id ?? employee.companyId);
  const branchId = idOf(employee.branch_id ?? employee.branchId);
  const overrideUserId = idOf(employee.hr_user_id ?? employee.hrUserId);
  const person = (userId: number | null) => roster.find(hr => Number(hr.user_id) === Number(userId)) ?? null;
  const result = (source: HrSource, hrUserId: number | null, rule: Row | null, reason: HrReason): HrResolution => {
    const hr = person(hrUserId);
    const available = Boolean(hrUserId) && hrUsableFor(hr, employeeId);
    const finalReason: HrReason = hrUserId && !available ? (source === 'employee_override' ? 'override_unavailable' : 'rule_hr_unavailable') : reason;
    return { employeeId, hrUserId, hrEmployeeId: idOf(hr?.employee_id), source, ruleId: idOf(rule?.id), rule, hr, available, reason: finalReason, overrideUserId };
  };
  if (overrideUserId) return result('employee_override', overrideUserId, null, 'override');
  if (!branchId) return result('none', null, null, companyId ? 'missing_branch' : 'missing_company_branch');
  const rule = resolveHrRule(catalog, { company_id: companyId, branch_id: branchId }) ?? null;
  if (!rule) return result('none', null, null, companyId ? 'no_rule' : 'missing_company');
  return result(hrRuleType(rule), idOf(rule.hr_user_id), rule, 'rule');
}

/** Human-readable source, e.g. "Asus Cards + Cairo rule" or "Riyadh Branch Fallback". */
export function hrSourceText(resolution: HrResolution, catalog: Pick<OrganizationCatalog, 'companies' | 'branches'>, rtl: boolean): string {
  const name = (rows: Row[], id: unknown) => { const row = rows.find(r => Number(r.id) === Number(id)); return row ? String((rtl ? row.name_ar || row.name_en : row.name_en || row.name_ar) || row.name || `#${id}`) : `#${id}`; };
  const rule = resolution.rule;
  if (resolution.source === 'company_branch' && rule) return rtl ? `قاعدة ${name(catalog.companies, rule.company_id)} + ${name(catalog.branches, rule.branch_id)}` : `${name(catalog.companies, rule.company_id)} + ${name(catalog.branches, rule.branch_id)} rule`;
  if (resolution.source === 'branch_fallback' && rule) return rtl ? `احتياطي فرع ${name(catalog.branches, rule.branch_id)}` : `${name(catalog.branches, rule.branch_id)} Branch Fallback`;
  return rtl ? HR_SOURCE_LABEL[resolution.source].ar : HR_SOURCE_LABEL[resolution.source].en;
}

export const hrReasonText = (reason: unknown, rtl: boolean) => { const text = HR_REASON_TEXT[reason as HrReason]; return text ? (rtl ? text.ar : text.en) : ''; };

/** Source line for a saved employee row from the profile API (hr_source plus the employee's company/branch names). */
export function hrProfileSourceText(employee: Row, rtl: boolean): string {
  const company = String((rtl ? employee.company_name_ar : null) || employee.company_name || '');
  const branch = String((rtl ? employee.branch_name_ar || employee.branch_name : employee.branch_name || employee.branch_name_ar) || '');
  if (employee.hr_source === 'company_branch') return rtl ? `قاعدة ${company} + ${branch}` : `${company} + ${branch} rule`;
  if (employee.hr_source === 'branch_fallback') return rtl ? `احتياطي فرع ${branch}` : `${branch} Branch Fallback`;
  const label = HR_SOURCE_LABEL[(employee.hr_source as HrSource)] ?? HR_SOURCE_LABEL.none;
  return rtl ? label.ar : label.en;
}

/* ------------------------------------------------------------------ rule validation */

/** Branches a rule may target: active and linked to at least one company (unlinked junk branches are excluded). */
export function hrRuleBranchChoices(catalog: OrganizationCatalog, type: HrRuleType, companyId?: unknown): Row[] {
  const active = catalog.branches.filter(branch => branch.status === 'active');
  if (type === 'company_branch') return companyId ? active.filter(branch => catalog.companyBranches.some(link => Number(link.company_id) === Number(companyId) && Number(link.branch_id) === Number(branch.id))) : [];
  return active.filter(branch => catalog.companyBranches.some(link => Number(link.branch_id) === Number(branch.id) && catalog.companies.some(c => Number(c.id) === Number(link.company_id) && c.status === 'active')));
}

/** Explains why a roster entry is not selectable, in the order an administrator should fix it. */
export function hrIneligibility(hr: Row | null | undefined): { code: 'HR_RESPONSIBLE_INVALID' | 'HR_ACCOUNT_NOT_LINKED' | 'HR_EMPLOYEE_INACTIVE'; ar: string; en: string } | null {
  if (!hr) return { code: 'HR_RESPONSIBLE_INVALID', ar: 'مسؤول الموارد البشرية غير موجود في قائمة المؤهلين', en: 'The HR responsible is not on the eligible roster' };
  if (!hr.employee_id) return { code: 'HR_ACCOUNT_NOT_LINKED', ar: 'حساب مسؤول الموارد البشرية غير مرتبط بموظف', en: 'The HR account is not linked to an employee' };
  if (hr.employee_status && !CURRENT_EMPLOYMENT.includes(String(hr.employee_status))) return { code: 'HR_EMPLOYEE_INACTIVE', ar: 'موظف مسؤول الموارد البشرية غير نشط', en: 'The HR responsible employee is not active' };
  if (hr.status !== 'active' || !hrEligible(hr)) return { code: 'HR_RESPONSIBLE_INVALID', ar: 'مسؤول الموارد البشرية غير مؤهل (الحساب أو الدور أو القائمة غير نشط)', en: 'The HR responsible is not eligible (account, role or roster entry inactive)' };
  return null;
}

/**
 * Pure rule validation shared by the rule drawer and the save. `rule_type` is required on input so a blank company
 * can never silently become a Branch Fallback; it is not stored (company_id NULL is the fallback).
 */
export function hrRuleIssues(catalog: OrganizationCatalog, roster: Row[], record: Row): OrganizationIssue[] {
  const issues: OrganizationIssue[] = [];
  const fail = (code: Parameters<typeof orgError>[0], field: string, ar: string, en: string, blocking: Row | null = null, details: unknown = undefined) => issues.push(issueOf(orgError(code, field, ar, en, { blocking: blocking as never, details })));
  const type = record.rule_type ?? (record.company_id ? 'company_branch' : null);
  const companyId = idOf(record.company_id), branchId = idOf(record.branch_id), hrUserId = idOf(record.hr_user_id), id = idOf(record.id);
  if (type !== 'company_branch' && type !== 'branch_fallback') { fail('HR_RULE_TYPE_INVALID', 'rule_type', 'اختر نوع القاعدة: الشركة + الفرع أو احتياطي الفرع', 'Choose a rule type: Company + Branch or Branch Fallback'); return issues; }
  if (type === 'company_branch' && !companyId) fail('REQUIRED_FIELD', 'company_id', 'الشركة مطلوبة لقاعدة الشركة + الفرع', 'Company is required for a Company + Branch rule');
  if (type === 'branch_fallback' && companyId) fail('HR_RULE_TYPE_INVALID', 'company_id', 'قاعدة احتياطي الفرع لا تحدد شركة', 'A Branch Fallback rule has no company');
  if (!branchId) fail('REQUIRED_FIELD', 'branch_id', 'الفرع مطلوب', 'Branch is required');
  if (!hrUserId) fail('REQUIRED_FIELD', 'hr_user_id', 'مسؤول الموارد البشرية مطلوب', 'HR Responsible is required');
  if (issues.length) return issues;
  const company = catalog.companies.find(c => Number(c.id) === companyId);
  const branch = catalog.branches.find(b => Number(b.id) === branchId);
  if (companyId && company?.status !== 'active') fail('INVALID_COMPANY', 'company_id', 'اختر شركة نشطة', 'Select an active company', { type: 'company', id: companyId });
  if (branch?.status !== 'active') fail('INVALID_BRANCH', 'branch_id', 'اختر فرعًا نشطًا', 'Select an active branch', { type: 'branch', id: branchId });
  else if (!hrRuleBranchChoices(catalog, type, companyId).some(b => Number(b.id) === branchId))
    fail('BRANCH_NOT_LINKED', 'branch_id', companyId ? 'الفرع غير مرتبط بالشركة' : 'الفرع غير مرتبط بأي شركة نشطة', companyId ? 'Branch does not belong to the company' : 'Branch is not linked to any active company', { type: 'company_branch', company_id: companyId, branch_id: branchId });
  const hr = roster.find(row => Number(row.user_id) === hrUserId);
  const invalid = hrIneligibility(hr);
  if (invalid) fail(invalid.code, 'hr_user_id', invalid.ar, invalid.en, { type: 'user', id: hrUserId });
  if (record.status === 'active') {
    const duplicate = catalog.hrRules.find(rule => rule.status === 'active' && Number(rule.id) !== id && Number(rule.branch_id) === branchId && (idOf(rule.company_id) ?? 0) === (companyId ?? 0));
    if (duplicate) fail('HR_RULE_DUPLICATE', companyId ? 'company_id' : 'branch_id',
      companyId ? 'توجد قاعدة نشطة لنفس الشركة والفرع؛ عدّلها أو ألغِ تفعيلها أولًا' : 'توجد قاعدة احتياطية نشطة لهذا الفرع؛ عدّلها أو ألغِ تفعيلها أولًا',
      companyId ? 'An active rule already exists for this company and branch; edit or deactivate it first' : 'An active Branch Fallback already exists for this branch; edit or deactivate it first',
      { type: 'hr_rule', id: duplicate.id }, { existingRuleId: Number(duplicate.id), hrUserId: Number(duplicate.hr_user_id) });
  }
  return issues;
}

/* ------------------------------------------------------------------ impact */

export type HrPerson = { id: number; employee_code: unknown; name_en: unknown; name_ar: unknown };
export type HrRuleImpact = {
  /** Current employees who resolve through the rule before or after the change (overrides excluded). */
  affected: number;
  /** Employees whose effective HR person changes, grouped by where they end up. */
  toThisRule: HrPerson[];
  toOtherRule: (HrPerson & { ruleId: number; hrUserId: number })[];
  toNone: HrPerson[];
  /** Employees in the rule's scope whose explicit override keeps them unchanged. */
  overridesUnchanged: HrPerson[];
  before: { hrUserId: number | null; status: string | null };
  after: { hrUserId: number | null; status: string };
};
const personOf = (e: Row): HrPerson => ({ id: Number(e.id), employee_code: e.employee_code ?? null, name_en: e.name_en ?? null, name_ar: e.name_ar ?? null });

/**
 * What saving `next` (a new or edited rule) does to current employees' effective HR, computed with the resolver
 * itself so the preview matches routing. Employee records are never changed by a rule save.
 */
export function hrRuleImpact(catalog: OrganizationCatalog, roster: Row[], employees: Row[], next: Row): HrRuleImpact {
  const id = idOf(next.id);
  const saved = id ? catalog.hrRules.find(rule => Number(rule.id) === id) ?? null : null;
  const draft = { ...(saved ?? {}), id: id ?? -1, company_id: idOf(next.company_id), branch_id: idOf(next.branch_id), hr_user_id: idOf(next.hr_user_id), status: String(next.status ?? 'active') };
  const after = { ...catalog, hrRules: [...catalog.hrRules.filter(rule => Number(rule.id) !== id), draft] };
  const inScope = (e: Row, rule: Row | null) => Boolean(rule && Number(e.branch_id) === Number(rule.branch_id) && (!rule.company_id || Number(e.company_id) === Number(rule.company_id)));
  const impact: HrRuleImpact = { affected: 0, toThisRule: [], toOtherRule: [], toNone: [], overridesUnchanged: [], before: { hrUserId: idOf(saved?.hr_user_id), status: saved ? String(saved.status) : null }, after: { hrUserId: draft.hr_user_id, status: draft.status } };
  for (const employee of employees.filter(current)) {
    const was = resolveEmployeeHrResponsibility({ employee, catalog, roster });
    const will = resolveEmployeeHrResponsibility({ employee, catalog: after, roster });
    if (was.source === 'employee_override') { if (inScope(employee, saved) || inScope(employee, draft)) impact.overridesUnchanged.push(personOf(employee)); continue; }
    const throughBefore = Boolean(saved) && was.ruleId === id;
    const throughAfter = will.ruleId === draft.id;
    if (!throughBefore && !throughAfter) continue;
    impact.affected++;
    if (was.hrUserId === will.hrUserId) continue;
    if (throughAfter) impact.toThisRule.push(personOf(employee));
    else if (will.source === 'none') impact.toNone.push(personOf(employee));
    else impact.toOtherRule.push({ ...personOf(employee), ruleId: Number(will.ruleId), hrUserId: Number(will.hrUserId) });
  }
  return impact;
}
export const hrImpactChanges = (impact: HrRuleImpact) => impact.toThisRule.length + impact.toOtherRule.length + impact.toNone.length;
/** Proves the reviewed impact is still current; any change in who moves where yields a different token. */
export const hrImpactToken = (next: Row, impact: HrRuleImpact) => ['hr', idOf(next.id) ?? 'new', idOf(next.company_id) ?? 0, idOf(next.branch_id), idOf(next.hr_user_id), next.status,
  impact.toThisRule.map(p => p.id).sort((a, b) => a - b).join('.'), impact.toOtherRule.map(p => `${p.id}>${p.hrUserId}`).sort().join('.'), impact.toNone.map(p => p.id).sort((a, b) => a - b).join('.')].join(':');

/* ------------------------------------------------------------------ summary */

export type HrSetupSummary = { activeRules: number; resolved: number; overrides: number; needsSetup: number; unavailable: number; perRule: Record<string, number> };
/** Counts over current employees, using the resolver; "Needs HR setup" = no override and no matching rule. */
export function hrSetupSummary(catalog: OrganizationCatalog, roster: Row[], employees: Row[]): HrSetupSummary {
  const summary: HrSetupSummary = { activeRules: catalog.hrRules.filter(rule => rule.status === 'active').length, resolved: 0, overrides: 0, needsSetup: 0, unavailable: 0, perRule: {} };
  for (const employee of employees.filter(current)) {
    const resolution = resolveEmployeeHrResponsibility({ employee, catalog, roster });
    if (resolution.source === 'employee_override') summary.overrides++;
    if (resolution.source === 'none') { summary.needsSetup++; continue; }
    if (resolution.ruleId) summary.perRule[String(resolution.ruleId)] = (summary.perRule[String(resolution.ruleId)] ?? 0) + 1;
    if (resolution.available) summary.resolved++; else summary.unavailable++;
  }
  return summary;
}
