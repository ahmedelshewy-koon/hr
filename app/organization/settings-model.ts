import type { Row } from '../ui-types';
import type { OrganizationCatalog } from './assignment-policy.ts';
import { resolveHrRule } from './assignment-policy.ts';
import type { OrganizationUsage } from './reference-policy.ts';
import { isActive, isRemoved, nameOf } from './selectors.ts';

export type Bilingual = { ar: string; en: string; enOne?: string };
export const pick = (text: Bilingual, rtl: boolean) => (rtl ? text.ar : text.en);

/* ------------------------------------------------------------------ permissions */

export type OrganizationAccess = {
  canView: boolean;
  canManage: boolean;
  /** Job titles are written through the catalog's own permission, so the drawer needs both grants. */
  canCreateJobTitles: boolean;
  canEditJobTitles: boolean;
  /** Super Admin only: delete a unit even when it is in use (references are cleared). The server re-checks the role. */
  canForceDelete: boolean;
};
const SETTINGS_ROLES = ['Super Admin', 'HR Manager'];

/**
 * Same boundary as the server: settings need the role AND the system_settings grant; department or job-title
 * grants alone never open Organizational Structure Settings. Super Admin keeps the existing bypass.
 */
export function organizationSettingsAccess(user: Row | null | undefined, permissions: Row[] | null | undefined): OrganizationAccess {
  const role = String(user?.role_name ?? '');
  const superAdmin = role === 'Super Admin';
  const granted = (module: string, action: string) =>
    (permissions ?? []).some(p => Number(p.role_id) === Number(user?.role_id) && p.module === module && p.action === action && Number(p.allowed) === 1);
  const canView = SETTINGS_ROLES.includes(role) && (superAdmin || granted('system_settings', 'view'));
  const canManage = canView && (superAdmin || granted('system_settings', 'manage_settings'));
  return {
    canView,
    canManage,
    canCreateJobTitles: canManage && (superAdmin || granted('job_titles', 'create')),
    canEditJobTitles: canManage && (superAdmin || granted('job_titles', 'edit')),
    canForceDelete: canManage && superAdmin,
  };
}

/* ------------------------------------------------------------------ usage and locks */

export type UsageIndex = Record<string, Record<string, OrganizationUsage>>;
export const EMPTY_USAGE: OrganizationUsage = { total: 0, active: 0, historical: 0, references: {} };
export const usageOf = (usage: UsageIndex | undefined, entity: string, id: unknown): OrganizationUsage =>
  (id != null && usage?.[entity]?.[String(id)]) || EMPTY_USAGE;

const GROUPS: [string, Bilingual][] = [
  ['employees', { ar: 'الموظفون', en: 'employees', enOne: 'employee' }],
  ['positions', { ar: 'الوظائف', en: 'positions', enOne: 'position' }],
  ['departments', { ar: 'الوحدات التنظيمية', en: 'organizational units', enOne: 'organizational unit' }],
  ['job_titles', { ar: 'المسميات الوظيفية', en: 'job titles', enOne: 'job title' }],
  ['work_locations', { ar: 'مقار العمل', en: 'work locations', enOne: 'work location' }],
  ['hr_responsibility_rules', { ar: 'قواعد الموارد البشرية', en: 'HR rules', enOne: 'HR rule' }],
  ['organization_branch_scopes', { ar: 'نطاقات الفروع', en: 'branch scopes', enOne: 'branch scope' }],
  ['company_branches', { ar: 'ارتباطات الشركات والفروع', en: 'company–branch links', enOne: 'company–branch link' }],
];

export type UsageLine = { group: string; label: Bilingual; total: number; active: number };
/** Reference edges grouped by the table that holds them (several employee columns collapse into "employees"). */
export function usageBreakdown(usage: OrganizationUsage): UsageLine[] {
  const merged = new Map<string, { total: number; active: number }>();
  for (const [ref, counts] of Object.entries(usage.references ?? {})) {
    const group = ref.split(':')[0];
    const line = merged.get(group) ?? { total: 0, active: 0 };
    line.total += counts.total; line.active += counts.active;
    merged.set(group, line);
  }
  return GROUPS.filter(([group]) => merged.has(group)).map(([group, label]) => ({ group, label, ...merged.get(group)! }));
}

export type LockState = { deactivate: Bilingual | null; structural: Bilingual | null };
type Format = (value: number) => string;

/**
 * Mirrors the server contract: deactivation is blocked only by ACTIVE dependents, while structural edits are
 * blocked by any reference, active or historical, other than company/branch link rows.
 * This is a presentation of server-supplied counts; the server rechecks every write.
 */
export function lockState(usage: OrganizationUsage, fmt: Format = String): LockState {
  const lines = usageBreakdown(usage);
  const active = lines.filter(line => line.active > 0);
  const structural = lines.filter(line => line.group !== 'company_branches' && line.total > 0);
  const join = (parts: string[], rtl: boolean) => parts.join(rtl ? '، ' : ', ');
  const noun = (line: UsageLine, count: number) => (count === 1 && line.label.enOne) || line.label.en;
  return {
    deactivate: active.length ? {
      en: `Locked: used by ${join(active.map(line => `${fmt(line.active)} active ${noun(line, line.active)}`), false)}`,
      ar: `مقفل: مستخدم حاليًا — ${join(active.map(line => `${line.label.ar}: ${fmt(line.active)}`), true)}`,
    } : null,
    structural: structural.length ? {
      en: `Structural fields are locked: referenced by ${join(structural.map(line => `${fmt(line.total)} ${noun(line, line.total)}`), false)}${usage.historical ? ` (${fmt(usage.historical)} historical)` : ''}`,
      ar: `الحقول الهيكلية مقفلة لوجود ارتباطات — ${join(structural.map(line => `${line.label.ar}: ${fmt(line.total)}`), true)}`,
    } : null,
  };
}

/* ------------------------------------------------------------------ legacy review */

/** Legacy units have no company. They are never mapped by name; an administrator must review them. */
export const unitNeedsReview = (unit: Row) => !isRemoved(unit) && !unit.company_id;
export const legacyUnitIsCompany = (unit: Row) => unit.unit_type === 'company';
export const companyIncomplete = (company: Row) => !company.name_ar || !company.name_en || !company.code;

/* ------------------------------------------------------------------ derived CEO */

export type CompanyCeo = {
  state: 'none' | 'vacant' | 'occupied' | 'conflict';
  positions: Row[];
  occupants: Row[];
  /** The occupant to display; never stored on the company or the employee. */
  ceo: Row | null;
};
const isCeoPosition = (position: Row) => position.is_ceo === true || Number(position.is_ceo) === 1;

/** The CEO is whoever occupies the company's active CEO position. There is no CEO employee type. */
export function deriveCompanyCeo(companyId: unknown, positions: Row[], occupants: Record<string, Row[]> | undefined): CompanyCeo {
  const ceoPositions = positions.filter(position => Number(position.company_id) === Number(companyId) && isCeoPosition(position) && isActive(position));
  const people = ceoPositions.flatMap(position => occupants?.[String(position.id)] ?? []);
  const state = !ceoPositions.length ? 'none' : !people.length ? 'vacant' : people.length === 1 ? 'occupied' : 'conflict';
  return { state, positions: ceoPositions, occupants: people, ceo: people[0] ?? null };
}

/* ------------------------------------------------------------------ HR responsibility */

export type HrSource = 'employee_override' | 'company_branch' | 'branch_fallback';
/** Rank 1 is evaluated first. Employee-level overrides live in the profile and are never created from Settings. */
export const HR_PRECEDENCE: { rank: number; source: HrSource; label: Bilingual; hint: Bilingual }[] = [
  { rank: 1, source: 'employee_override', label: { ar: 'استثناء على مستوى الموظف', en: 'Employee-level override' }, hint: { ar: 'يُحدَّد من ملف الموظف ويتقدم على كل القواعد', en: 'Set in the employee profile; wins over every rule' } },
  { rank: 2, source: 'company_branch', label: { ar: 'الشركة + الفرع', en: 'Company + branch' }, hint: { ar: 'قاعدة خاصة بشركة داخل فرع محدد', en: 'A rule for one company within a branch' } },
  { rank: 3, source: 'branch_fallback', label: { ar: 'الفرع (احتياطي)', en: 'Branch fallback' }, hint: { ar: 'قاعدة لكل الشركات في الفرع عند عدم وجود قاعدة أدق', en: 'Applies to any company in the branch without a more specific rule' } },
];
export const hrRuleSource = (rule: Row): Exclude<HrSource, 'employee_override'> => (rule.company_id ? 'company_branch' : 'branch_fallback');
export const hrRuleRank = (rule: Row) => (hrRuleSource(rule) === 'company_branch' ? 2 : 3);

export function sortHrRules(rules: Row[], catalog: OrganizationCatalog, rtl: boolean): Row[] {
  const name = (rows: Row[], id: unknown) => nameOf(rows.find(row => Number(row.id) === Number(id)), rtl, '');
  return [...rules].sort((a, b) =>
    hrRuleRank(a) - hrRuleRank(b)
    || name(catalog.branches, a.branch_id).localeCompare(name(catalog.branches, b.branch_id), rtl ? 'ar' : 'en')
    || name(catalog.companies, a.company_id).localeCompare(name(catalog.companies, b.company_id), rtl ? 'ar' : 'en')
    || Number(a.id) - Number(b.id));
}

/** An HR responsible can serve requests only while the server marks them eligible and active. */
export const hrEligible = (hr?: Row | null) => Boolean(hr && (hr.eligible === true || Number(hr.eligible) === 1));
export const hrResponsibleUsable = (hr?: Row | null) => Boolean(hr && hr.status === 'active' && hrEligible(hr));

export type HrResolution = {
  source: 'company_branch' | 'branch_fallback' | 'none';
  rank: number | null;
  rule: Row | null;
  hr: Row | null;
  /** True when a rule matched but its HR responsible cannot currently receive requests. */
  unavailable: boolean;
};
/** Company + Branch preview. Reuses the shared rule policy, so it cannot drift from what routing does. */
export function resolveHrScope(catalog: OrganizationCatalog, hrResponsibles: Row[], companyId: unknown, branchId: unknown): HrResolution {
  const rule = companyId && branchId ? resolveHrRule(catalog, { company_id: companyId, branch_id: branchId }) ?? null : null;
  if (!rule) return { source: 'none', rank: null, rule: null, hr: null, unavailable: false };
  const hr = hrResponsibles.find(row => Number(row.user_id) === Number(rule.hr_user_id)) ?? null;
  return { source: hrRuleSource(rule), rank: hrRuleRank(rule), rule, hr, unavailable: !hrResponsibleUsable(hr) };
}

export type HrScopeCount = { company_id: number | null; branch_id: number; employees: number; overrides: number };
/**
 * Employees currently resolved by each active rule, from server-supplied per-scope counts. Employees with an
 * explicit override are reported separately because the override wins over any rule.
 */
export function attributeRuleEmployees(catalog: OrganizationCatalog, scopes: HrScopeCount[] | undefined) {
  const perRule: Record<string, number> = {};
  let unrouted = 0, overrides = 0;
  for (const scope of scopes ?? []) {
    overrides += Number(scope.overrides);
    const routed = Number(scope.employees) - Number(scope.overrides);
    const rule = resolveHrRule(catalog, scope);
    if (rule) perRule[String(rule.id)] = (perRule[String(rule.id)] ?? 0) + routed;
    else unrouted += routed;
  }
  return { perRule, unrouted, overrides };
}

/* ------------------------------------------------------------------ messages */

const hasArabic = (text: string) => /[؀-ۿ]/.test(text);
/** Server messages are "arabic / english"; returns the half for the interface language, or null when not bilingual. */
export function bilingualMessage(message: string, rtl: boolean): string | null {
  const [first, ...rest] = String(message).split(' / ');
  if (!rest.length || !hasArabic(first)) return null;
  return (rtl ? first : rest.join(' / ')).trim();
}

export function branchScopeLabel(unit: Row, catalog: OrganizationCatalog, rtl: boolean): string {
  if (unit.branch_scope !== 'selected') return rtl ? 'كل فروع الشركة' : 'All company branches';
  const names = catalog.branchScopes
    .filter(scope => Number(scope.department_id) === Number(unit.id))
    .map(scope => nameOf(catalog.branches.find(branch => Number(branch.id) === Number(scope.branch_id)), rtl));
  return names.length ? names.join(rtl ? '، ' : ', ') : (rtl ? 'فروع محددة (لم تُحدَّد)' : 'Selected branches (none chosen)');
}
