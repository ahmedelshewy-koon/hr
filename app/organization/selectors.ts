import type { Row } from '../ui-types';
import type { OrganizationCatalog } from './assignment-policy.ts';

/**
 * Shared organizational selectors. Settings drawers and (in a later stage) the Employee Profile pick from the
 * same master data with the same scoping rules as `validateAssignment`, so a choice offered here is one the
 * server accepts. Selectors only narrow choices; the server remains the authority.
 */
export type Option = { value: string; label: string; disabled?: boolean };
export type UnitKind = 'department' | 'section' | 'team';

export const isActive = (row?: Row | null) => row?.status === 'active';
/** Soft-deleted legacy rows are not shown in Settings at all. */
export const isRemoved = (row?: Row | null) => row?.status === 'deleted';
export const unitKind = (unit: Row): UnitKind => (unit.organization_kind || 'department') as UnitKind;

export function nameOf(row: Row | null | undefined, rtl: boolean, fallback = '—'): string {
  if (!row) return fallback;
  const primary = rtl ? row.name_ar : row.name_en;
  const secondary = rtl ? row.name_en : row.name_ar;
  return String(primary || secondary || row.name || row.email || fallback);
}

const inactiveSuffix = (rtl: boolean) => (rtl ? ' (غير نشط)' : ' (inactive)');

/** Active rows plus the row currently selected, so an existing reference to an inactive record stays visible. */
export function optionsFor(rows: Row[], rtl: boolean, current?: unknown, label: (row: Row) => string = row => nameOf(row, rtl)): Option[] {
  return rows
    .filter(row => !isRemoved(row) && (isActive(row) || (current != null && current !== '' && Number(row.id) === Number(current))))
    .map(row => ({ value: String(row.id), label: label(row) + (isActive(row) ? '' : inactiveSuffix(rtl)), disabled: !isActive(row) }));
}

export const linkedBranchIds = (catalog: OrganizationCatalog, companyId: unknown) =>
  catalog.companyBranches.filter(link => Number(link.company_id) === Number(companyId)).map(link => Number(link.branch_id));
export const linkedCompanyIds = (catalog: OrganizationCatalog, branchId: unknown) =>
  catalog.companyBranches.filter(link => Number(link.branch_id) === Number(branchId)).map(link => Number(link.company_id));
export const scopedBranchIds = (catalog: OrganizationCatalog, unitId: unknown) =>
  catalog.branchScopes.filter(scope => Number(scope.department_id) === Number(unitId)).map(scope => Number(scope.branch_id));

export function branchesOfCompany(catalog: OrganizationCatalog, companyId: unknown): Row[] {
  const linked = new Set(linkedBranchIds(catalog, companyId));
  return catalog.branches.filter(branch => linked.has(Number(branch.id)) && !isRemoved(branch));
}

export function unitsOfCompany(catalog: OrganizationCatalog, companyId: unknown, kind?: UnitKind): Row[] {
  return catalog.departments.filter(unit => !isRemoved(unit) && Number(unit.company_id) === Number(companyId) && (!kind || unitKind(unit) === kind));
}

/** Parent choices mirror the server rules: roots have none, Sections sit under Departments, Teams under either. */
export function parentUnitChoices(catalog: OrganizationCatalog, kind: UnitKind, companyId: unknown, selfId?: unknown): Row[] {
  if (kind === 'department' || !companyId) return [];
  const allowed: UnitKind[] = kind === 'section' ? ['department'] : ['department', 'section'];
  return unitsOfCompany(catalog, companyId).filter(unit => allowed.includes(unitKind(unit)) && Number(unit.id) !== Number(selfId));
}

/** Sections are optional: a Department without sections simply yields an empty list. */
export function sectionsOf(catalog: OrganizationCatalog, companyId: unknown, departmentId: unknown): Row[] {
  if (!departmentId) return [];
  return unitsOfCompany(catalog, companyId, 'section').filter(unit => Number(unit.parent_id) === Number(departmentId));
}

/** Teams hang under the chosen Section, or directly under the Department when no Section is chosen. */
export function teamsOf(catalog: OrganizationCatalog, companyId: unknown, departmentId: unknown, sectionId?: unknown): Row[] {
  const parent = sectionId || departmentId;
  if (!parent) return [];
  return unitsOfCompany(catalog, companyId, 'team').filter(unit => Number(unit.parent_id) === Number(parent));
}

/** Generic titles (no department) plus titles owned by the selected department; archived titles are excluded. */
export function titlesForDepartment(catalog: OrganizationCatalog, departmentId: unknown): Row[] {
  return catalog.jobTitles.filter(title => !isRemoved(title) && (!title.department_id || Number(title.department_id) === Number(departmentId)));
}

export function locationsForBranch(catalog: OrganizationCatalog, branchId?: unknown): Row[] {
  return catalog.workLocations.filter(location => !isRemoved(location) && (!location.branch_id || !branchId || Number(location.branch_id) === Number(branchId)));
}

/** sort_order, then English name, then id — the same order the server returns. Never hard-coded by grade name. */
export function sortGrades(grades: Row[]): Row[] {
  return [...grades].sort((a, b) =>
    (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
    || String(a.name_en ?? '').localeCompare(String(b.name_en ?? ''), 'en', { sensitivity: 'base' })
    || Number(a.id) - Number(b.id));
}

/** The name in the other language, shown as the quieter second line of a row. */
export const otherNameOf = (row: Row | null | undefined, rtl: boolean) => String((rtl ? row?.name_en : row?.name_ar) ?? '');
