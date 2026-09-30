import type { Row } from '../ui-types';
import { assignmentDiagnostics, CURRENT_EMPLOYMENT, type OrganizationCatalog } from './assignment-policy.ts';
import type { OrganizationIssue } from './org-errors.ts';

/**
 * Stage 4 organizational chart: a DERIVED, read-only view of persisted employee assignments and organizational
 * masters. Nothing here is stored. Every function is pure so it can be tested without React:
 *
 *   applyChartFilters      → which (already permission-filtered) employees match the filters
 *   computeContextNodes    → non-matching managers kept only to preserve a matching employee's reporting line
 *   deriveReportingForest  → manager_id forest (cycle-safe) over matches + context
 *   deriveReportingView    → forest grouped by company, with counts from matching identities only
 *   deriveOrganizationView → Company → (Branch) → Department → Section → Team placement from stored assignments
 *   computeChartDiagnostics→ Needs Review items; organizational validity comes from the shared assignment policy
 *
 * `employees.manager_id` is the only reporting relationship used. Department managers, positions and legacy
 * department parent chains are never substituted for it, and no value is ever inferred.
 */

export type Severity = 'error' | 'warning' | 'info';
export type ChartIssue = { code: string; field: string | null; severity: Severity; message_ar: string; message_en: string };
/** How a stored manager_id resolves for the current viewer. `restricted` never reveals who the manager is. */
export type ManagerState = 'none' | 'visible' | 'restricted' | 'missing' | 'deleted' | 'self';
export type ChartInput = { employees: Row[]; catalog: OrganizationCatalog; fullAccess: boolean };
export type ChartFilters = { company?: string; branch?: string; department?: string; status?: string };
export const NOT_ASSIGNED = 'none';
export type ContextReason =
  | { type: 'company'; companyId: number | null }
  | { type: 'branch'; branchId: number | null }
  | { type: 'department' }
  | { type: 'status'; status: string };
export type ChartNode = {
  id: number; employee: Row; kind: 'match' | 'context'; reasons: ContextReason[];
  managerState: ManagerState; cycleBreak: boolean; children: ChartNode[]; size: number;
};

const num = (value: unknown) => Number(value) || 0;
const byId = (rows: Row[]) => new Map(rows.map(row => [num(row.id), row]));
export const isCurrent = (row: Row) => CURRENT_EMPLOYMENT.includes(String(row.employment_status));
const isDeleted = (row: Row) => row.employment_status === 'deleted';
const sortKey = (row: Row) => String(row.name_en || row.name_ar || row.name || '').toLocaleLowerCase();
const compareEmployees = (a: Row, b: Row) => sortKey(a).localeCompare(sortKey(b)) || num(a.id) - num(b.id);

/** Soft-deleted employees never appear in the chart, even if an API returns them. */
export const chartPool = (employees: Row[]) => employees.filter(row => !isDeleted(row));

export function managerState(row: Row, visible: Map<number, Row>, fullAccess: boolean): ManagerState {
  const managerId = num(row.manager_id);
  if (!managerId) return 'none';
  if (managerId === num(row.id)) return 'self';
  if (visible.has(managerId) && !isDeleted(visible.get(managerId)!)) return 'visible';
  if (visible.has(managerId)) return 'deleted';
  // The server annotates hidden managers; a limited viewer is never told more than "outside your access".
  const hinted = row.manager_scope as ManagerState | undefined;
  if (!fullAccess) return 'restricted';
  return hinted === 'deleted' || hinted === 'restricted' || hinted === 'missing' ? hinted : 'missing';
}

// ---------------------------------------------------------------- units

const unitOf = (catalog: OrganizationCatalog, id: unknown) => (id ? catalog.departments.find(unit => num(unit.id) === num(id)) : undefined);
export const isLegacyUnit = (unit?: Row) => Boolean(unit && !unit.company_id);

/** A department plus its company-scoped Sections/Teams. Legacy parent chains are deliberately not followed. */
export function unitDescendants(catalog: OrganizationCatalog, unitId: number): Set<number> {
  const root = unitOf(catalog, unitId), result = new Set<number>([unitId]);
  if (!root || isLegacyUnit(root)) return result;
  let frontier = [unitId];
  while (frontier.length) {
    const next: number[] = [];
    for (const unit of catalog.departments) {
      const id = num(unit.id);
      if (!result.has(id) && frontier.includes(num(unit.parent_id)) && num(unit.company_id) === num(root.company_id)) { result.add(id); next.push(id); }
    }
    frontier = next;
  }
  return result;
}

// ---------------------------------------------------------------- filters

const statusMatches = (row: Row, status = 'current') => status === 'all' ? true : status === 'current' ? isCurrent(row) : row.employment_status === status;
const idMatches = (value: unknown, filter?: string) => !filter || (filter === NOT_ASSIGNED ? !num(value) : num(value) === num(filter));

/** Why an employee does NOT match; empty means it matches. Used for both matching and context labelling. */
export function mismatchReasons(row: Row, filters: ChartFilters, departmentSet: Set<number> | null): ContextReason[] {
  const reasons: ContextReason[] = [];
  if (!idMatches(row.company_id, filters.company)) reasons.push({ type: 'company', companyId: num(row.company_id) || null });
  if (!idMatches(row.branch_id, filters.branch)) reasons.push({ type: 'branch', branchId: num(row.branch_id) || null });
  if (departmentSet && ![row.department_id, row.section_id, row.team_id].some(id => departmentSet.has(num(id)))) reasons.push({ type: 'department' });
  if (!statusMatches(row, filters.status)) reasons.push({ type: 'status', status: String(row.employment_status || '') });
  return reasons;
}

export function applyChartFilters(input: ChartInput, filters: ChartFilters): { pool: Row[]; matchIds: Set<number>; departmentSet: Set<number> | null } {
  const pool = chartPool(input.employees);
  const departmentSet = filters.department ? unitDescendants(input.catalog, num(filters.department)) : null;
  const matchIds = new Set(pool.filter(row => !mismatchReasons(row, filters, departmentSet).length).map(row => num(row.id)));
  return { pool, matchIds, departmentSet };
}

/**
 * Non-matching managers kept only where a matching employee's reporting line needs them: the direct manager of a
 * match, and every manager between a match and a matching ancestor further up. Chains that lead to no other match
 * stop at the direct manager, so a context manager's unrelated reports and superiors are never pulled in.
 */
export function computeContextNodes(pool: Row[], matchIds: Set<number>): Set<number> {
  const rows = byId(pool), context = new Set<number>();
  for (const id of matchIds) {
    const chain: number[] = [], seen = new Set<number>([id]);
    let current = num(rows.get(id)?.manager_id);
    while (current && rows.has(current) && !seen.has(current) && !matchIds.has(current)) { chain.push(current); seen.add(current); current = num(rows.get(current)!.manager_id); }
    const reachesMatch = Boolean(current && matchIds.has(current) && !seen.has(current));
    for (const managerId of reachesMatch ? chain : chain.slice(0, 1)) context.add(managerId);
  }
  return context;
}

// ---------------------------------------------------------------- reporting

/** Employees whose manager_id chain loops back to themselves (self-management included). Iterative. */
export function reportingCycleIds(pool: Row[]): Set<number> {
  const rows = byId(pool), state = new Map<number, 1 | 2>(), cyclic = new Set<number>();
  for (const start of rows.keys()) {
    if (state.has(start)) continue;
    const path: number[] = [], index = new Map<number, number>();
    let current: number | undefined = start;
    while (current !== undefined && rows.has(current) && !state.has(current)) {
      state.set(current, 1); index.set(current, path.length); path.push(current);
      const next = num(rows.get(current)!.manager_id);
      if (next && index.has(next)) { for (const id of path.slice(index.get(next))) cyclic.add(id); break; }
      current = next || undefined;
    }
    for (const id of path) state.set(id, 2);
  }
  return cyclic;
}

/**
 * Builds the manager_id forest over `rows`. A missing, filtered or restricted manager makes the employee a root;
 * cross-company lines are kept exactly as stored. In a cycle the smallest id becomes a root (`cycleBreak`), so
 * every employee is rendered exactly once and traversal always terminates.
 */
export function deriveReportingForest(rows: Row[], options: { contextIds?: Set<number>; reasons?: Map<number, ContextReason[]>; managerStates?: Map<number, ManagerState> } = {}): { roots: ChartNode[]; nodes: Map<number, ChartNode>; parentOf: Map<number, number> } {
  const nodes = new Map<number, ChartNode>();
  for (const row of rows) {
    const id = num(row.id);
    if (!id || nodes.has(id)) continue;
    nodes.set(id, { id, employee: row, kind: options.contextIds?.has(id) ? 'context' : 'match', reasons: options.reasons?.get(id) ?? [], managerState: options.managerStates?.get(id) ?? 'none', cycleBreak: false, children: [], size: 1 });
  }
  const parentOf = new Map<number, number>();
  for (const [id, node] of nodes) { const parent = num(node.employee.manager_id); if (parent && parent !== id && nodes.has(parent)) parentOf.set(id, parent); }
  // Break cycles deterministically: walk each chain; on revisiting the current path, cut at its smallest id.
  const done = new Set<number>();
  for (const start of nodes.keys()) {
    const path: number[] = [], onPath = new Set<number>();
    let current: number | undefined = start;
    while (current !== undefined && !done.has(current)) {
      if (onPath.has(current)) {
        const loop = path.slice(path.indexOf(current)), cut = Math.min(...loop);
        parentOf.delete(cut); nodes.get(cut)!.cycleBreak = true; break;
      }
      onPath.add(current); path.push(current); current = parentOf.get(current);
    }
    for (const id of path) done.add(id);
  }
  const roots: ChartNode[] = [];
  for (const [id, node] of nodes) { const parent = parentOf.get(id); if (parent !== undefined) nodes.get(parent)!.children.push(node); else roots.push(node); }
  // Sizes bottom-up without recursion (count of nodes in each subtree), then a stable order: larger teams first.
  const order: ChartNode[] = [], stack = [...roots];
  while (stack.length) { const node = stack.pop()!; order.push(node); stack.push(...node.children); }
  for (let i = order.length - 1; i >= 0; i--) order[i].size = 1 + order[i].children.reduce((sum, child) => sum + child.size, 0);
  const sortNodes = (list: ChartNode[]) => list.sort((a, b) => (b.children.length ? 1 : 0) - (a.children.length ? 1 : 0) || compareEmployees(a.employee, b.employee));
  for (const node of order) sortNodes(node.children);
  roots.sort((a, b) => b.size - a.size || compareEmployees(a.employee, b.employee));
  return { roots, nodes, parentOf };
}

export type ReportingGroup = { key: string; companyId: number | null; roots: ChartNode[]; matchCount: number };
export type ReportingView = {
  groups: ReportingGroup[]; nodes: Map<number, ChartNode>; parentOf: Map<number, number>;
  matchIds: Set<number>; contextIds: Set<number>; matchCount: number; contextCount: number;
};

export function deriveReportingView(input: ChartInput, filters: ChartFilters): ReportingView {
  const { pool, matchIds, departmentSet } = applyChartFilters(input, filters);
  const contextIds = computeContextNodes(pool, matchIds);
  const visible = byId(pool), reasons = new Map<number, ContextReason[]>(), managerStates = new Map<number, ManagerState>();
  for (const id of contextIds) reasons.set(id, mismatchReasons(visible.get(id)!, filters, departmentSet));
  for (const row of pool) managerStates.set(num(row.id), managerState(row, visible, input.fullAccess));
  const rows = pool.filter(row => matchIds.has(num(row.id)) || contextIds.has(num(row.id)));
  const forest = deriveReportingForest(rows, { contextIds, reasons, managerStates });
  const groups = new Map<string, ReportingGroup>();
  const countMatches = (node: ChartNode) => { let total = 0; const stack = [node]; while (stack.length) { const next = stack.pop()!; if (next.kind === 'match') total++; stack.push(...next.children); } return total; };
  for (const root of forest.roots) {
    // A company filter shows one group: a context root from another company must not look like a company of its own.
    const companyId = filters.company && filters.company !== NOT_ASSIGNED ? num(filters.company) : filters.company === NOT_ASSIGNED ? null : num(root.employee.company_id) || null;
    const key = companyId === null ? 'company:none' : `company:${companyId}`;
    const group = groups.get(key) ?? { key, companyId, roots: [], matchCount: 0 };
    group.roots.push(root); group.matchCount += countMatches(root); groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.companyId === null ? 1 : 0) - (b.companyId === null ? 1 : 0) || (a.companyId ?? 0) - (b.companyId ?? 0));
  return { groups: ordered, nodes: forest.nodes, parentOf: forest.parentOf, matchIds, contextIds, matchCount: matchIds.size, contextCount: contextIds.size };
}

/** Direct reports a viewer may see (non-deleted, current unless `status` asks otherwise). Never counts context. */
export function directReportCount(pool: Row[], employeeId: number, status = 'current'): number {
  return pool.filter(row => num(row.manager_id) === employeeId && num(row.id) !== employeeId && !isDeleted(row) && statusMatches(row, status)).length;
}

/** Ancestors of an employee inside the rendered forest, nearest first; used to reveal a search result. */
export function ancestorPath(parentOf: Map<number, number>, id: number): number[] {
  const path: number[] = [], seen = new Set<number>([id]);
  let current = parentOf.get(id);
  while (current !== undefined && !seen.has(current)) { path.push(current); seen.add(current); current = parentOf.get(current); }
  return path;
}

// ---------------------------------------------------------------- organization units view

export type UnitNodeType = 'company' | 'branch' | 'no-branch' | 'leadership' | 'department' | 'section' | 'team' | 'no-department' | 'review' | 'review-unit';
export type UnitNode = {
  key: string; type: UnitNodeType; id: number | null; row?: Row; inactive: boolean; legacy: boolean; foreignCompanyId?: number | null;
  employees: Row[]; children: UnitNode[]; count: number;
};
export type OrganizationView = { roots: UnitNode[]; placement: Map<number, string[]>; matchCount: number };

const newNode = (key: string, type: UnitNodeType, id: number | null, row?: Row, extra: Partial<UnitNode> = {}): UnitNode =>
  ({ key, type, id, row, inactive: Boolean(row && row.status && row.status !== 'active'), legacy: false, employees: [], children: [], count: 0, ...extra });

/** A company-level role (e.g. CEO) holds a Position of the company that defines no Department/Section/Team. */
export function isCompanyLevel(catalog: OrganizationCatalog, row: Row): boolean {
  const position = catalog.positions.find(p => num(p.id) === num(row.position_id));
  return Boolean(position && num(position.company_id) === num(row.company_id) && !position.department_id && !position.section_id && !position.team_id);
}

/** The deepest stored unit (Team, else Section, else Department). */
const placementUnitId = (row: Row) => num(row.team_id) || num(row.section_id) || num(row.department_id);

function buildUnitBucket(catalog: OrganizationCatalog, companyId: number | null, employees: Row[], prefix: string, options: { showEmpty: boolean; branchId?: number | null; allowedUnits?: Set<number> | null }): UnitNode[] {
  const companyUnits = companyId === null ? [] : catalog.departments.filter(unit => num(unit.company_id) === companyId && unit.status !== 'deleted');
  const unitIds = new Set(companyUnits.map(unit => num(unit.id)));
  const nodes = new Map<number, UnitNode>();
  const unitNode = (unit: Row) => {
    const id = num(unit.id);
    if (!nodes.has(id)) nodes.set(id, newNode(`${prefix}/unit:${id}`, (unit.organization_kind || 'department') as UnitNodeType, id, unit));
    return nodes.get(id)!;
  };
  const leadership = newNode(`${prefix}/leadership`, 'leadership', null), noDepartment = newNode(`${prefix}/no-department`, 'no-department', null);
  const review = newNode(`${prefix}/review`, 'review', null), reviewUnits = new Map<number, UnitNode>();
  for (const row of employees) {
    const unitId = placementUnitId(row);
    if (!unitId) { (companyId !== null && isCompanyLevel(catalog, row) ? leadership : noDepartment).employees.push(row); continue; }
    if (unitIds.has(unitId)) { unitNode(unitOf(catalog, unitId)!).employees.push(row); continue; }
    // Legacy, other-company or unavailable units are listed as retained records, never merged by name.
    const unit = unitOf(catalog, unitId);
    if (!reviewUnits.has(unitId)) reviewUnits.set(unitId, newNode(`${prefix}/review:${unitId}`, 'review-unit', unitId, unit, { legacy: isLegacyUnit(unit) || !unit, foreignCompanyId: unit?.company_id ? num(unit.company_id) : null }));
    reviewUnits.get(unitId)!.employees.push(row);
  }
  if (options.showEmpty) for (const unit of companyUnits) if (unit.status === 'active' && (!options.allowedUnits || options.allowedUnits.has(num(unit.id)))) {
    if (options.branchId && unit.branch_scope === 'selected' && !catalog.branchScopes.some(scope => num(scope.department_id) === num(unit.id) && num(scope.branch_id) === options.branchId)) continue;
    unitNode(unit);
  }
  // Attach populated units to their company-scoped parents so every ancestor on the path is shown.
  for (const node of [...nodes.values()]) {
    let parentId = num(node.row?.parent_id);
    const seen = new Set<number>([node.id!]);
    while (parentId && unitIds.has(parentId) && !seen.has(parentId)) { seen.add(parentId); const parent = unitNode(unitOf(catalog, parentId)!); parentId = num(parent.row?.parent_id); }
  }
  const top: UnitNode[] = [];
  for (const node of nodes.values()) {
    const parentId = num(node.row?.parent_id);
    if (parentId && nodes.has(parentId) && parentId !== node.id) nodes.get(parentId)!.children.push(node); else top.push(node);
  }
  review.children = [...reviewUnits.values()];
  const result = [...(leadership.employees.length ? [leadership] : []), ...top, ...(noDepartment.employees.length ? [noDepartment] : []), ...(review.children.length ? [review] : [])];
  return result;
}

function finalize(nodes: UnitNode[], placement: Map<number, string[]>, path: string[] = []) {
  // Iterative post-order: counts are unique employees placed in the subtree (each employee is placed once).
  const stack: { node: UnitNode; path: string[]; visited: boolean }[] = nodes.map(node => ({ node, path, visited: false })).reverse();
  while (stack.length) {
    const item = stack.pop()!;
    if (!item.visited) {
      item.node.employees.sort(compareEmployees);
      for (const row of item.node.employees) placement.set(num(row.id), [...item.path, item.node.key]);
      stack.push({ ...item, visited: true });
      for (const child of [...item.node.children].reverse()) stack.push({ node: child, path: [...item.path, item.node.key], visited: false });
    } else {
      item.node.children.sort((a, b) => unitOrder(a) - unitOrder(b) || String(a.row?.name_en || a.row?.name_ar || '').localeCompare(String(b.row?.name_en || b.row?.name_ar || '')) || (a.id ?? 0) - (b.id ?? 0));
      item.node.count = item.node.employees.length + item.node.children.reduce((sum, child) => sum + child.count, 0);
    }
  }
}
const unitOrder = (node: UnitNode) => ({ leadership: 0, branch: 1, department: 2, section: 3, team: 4, 'no-department': 5, 'no-branch': 6, review: 7, 'review-unit': 8, company: 0 } as Record<string, number>)[node.type] ?? 9;

export function deriveOrganizationView(input: ChartInput, filters: ChartFilters, mode: 'department' | 'branch', options: { showEmpty?: boolean } = {}): OrganizationView {
  const { pool, matchIds, departmentSet } = applyChartFilters(input, filters);
  const showEmpty = Boolean(options.showEmpty && input.fullAccess);
  const matches = pool.filter(row => matchIds.has(num(row.id)));
  const companies = new Map<number | null, Row[]>();
  for (const row of matches) { const id = num(row.company_id) || null; companies.set(id, [...(companies.get(id) ?? []), row]); }
  if (showEmpty && !filters.branch && filters.company !== NOT_ASSIGNED) for (const company of input.catalog.companies) if (company.status === 'active' && idMatches(company.id, filters.company) && !companies.has(num(company.id))) companies.set(num(company.id), []);
  const roots: UnitNode[] = [];
  for (const [companyId, rows] of companies) {
    const company = companyId === null ? undefined : input.catalog.companies.find(c => num(c.id) === companyId);
    const root = newNode(`company:${companyId ?? 'none'}`, 'company', companyId, company);
    const bucketOptions = { showEmpty: showEmpty && companyId !== null, allowedUnits: departmentSet };
    if (mode === 'department') root.children = buildUnitBucket(input.catalog, companyId, rows, root.key, bucketOptions);
    else {
      const branches = new Map<number | null, Row[]>();
      for (const row of rows) { const id = num(row.branch_id) || null; branches.set(id, [...(branches.get(id) ?? []), row]); }
      if (showEmpty && companyId !== null) for (const link of input.catalog.companyBranches) if (num(link.company_id) === companyId && idMatches(link.branch_id, filters.branch) && !branches.has(num(link.branch_id))) branches.set(num(link.branch_id), []);
      for (const [branchId, branchRows] of branches) {
        const branch = branchId === null ? undefined : input.catalog.branches.find(b => num(b.id) === branchId);
        const node = newNode(`${root.key}/branch:${branchId ?? 'none'}`, branchId === null ? 'no-branch' : 'branch', branchId, branch);
        node.children = buildUnitBucket(input.catalog, companyId, branchRows, node.key, { ...bucketOptions, branchId });
        root.children.push(node);
      }
    }
    roots.push(root);
  }
  roots.sort((a, b) => (a.id === null ? 1 : 0) - (b.id === null ? 1 : 0) || (a.id ?? 0) - (b.id ?? 0));
  const placement = new Map<number, string[]>();
  finalize(roots, placement);
  return { roots, placement, matchCount: matches.length };
}

// ---------------------------------------------------------------- diagnostics

const ERROR_CODES = new Set(['INVALID_SELECTION', 'INVALID_COMPANY', 'INVALID_BRANCH', 'BRANCH_NOT_LINKED', 'UNIT_OUTSIDE_COMPANY', 'UNIT_OUTSIDE_BRANCH_SCOPE', 'INVALID_UNIT_KIND', 'INVALID_PARENT', 'DEPARTMENT_REQUIRED', 'POSITION_CONTRADICTION', 'CEO_HAS_MANAGER', 'REPORTING_CYCLE', 'MANAGER_NOT_FOUND', 'MANAGER_DELETED', 'SELF_MANAGEMENT']);
/** Combinations that are only "incomplete" while the employee's own Company/Branch is still unset. */
const INCOMPLETE_WHEN_UNSET = new Set(['UNIT_OUTSIDE_COMPANY', 'UNIT_OUTSIDE_BRANCH_SCOPE', 'BRANCH_NOT_LINKED']);
const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

const chartIssue = (code: string, field: string | null, severity: Severity, ar: string, en: string): ChartIssue => ({ code, field, severity, message_ar: ar, message_en: en });

function severityOf(issue: OrganizationIssue, row: Row): Severity {
  if (INCOMPLETE_WHEN_UNSET.has(issue.code) && (!row.company_id || (issue.code === 'UNIT_OUTSIDE_BRANCH_SCOPE' && !row.branch_id))) return 'warning';
  return ERROR_CODES.has(issue.code) ? 'error' : 'warning';
}

/**
 * Needs Review items per employee. Organizational validity comes from the shared `assignmentDiagnostics`
 * (the same policy the Employee Profile uses); the chart only adds completeness and reporting-line findings.
 */
export function computeChartDiagnostics(input: ChartInput): Map<number, ChartIssue[]> {
  const pool = chartPool(input.employees), visible = byId(pool), cycles = reportingCycleIds(pool), result = new Map<number, ChartIssue[]>();
  for (const row of pool) {
    const id = num(row.id), issues: ChartIssue[] = [];
    for (const issue of assignmentDiagnostics(input.catalog, row, pool)) {
      if (issue.code === 'MANAGER_COMPANY_MISMATCH') {
        const manager = visible.get(num(row.manager_id));
        if (row.company_id && manager?.company_id) issues.push(chartIssue('CROSS_COMPANY_REPORTING', 'manager_id', 'error', 'تبعية بين شركتين: المدير المباشر يتبع شركة أخرى', 'Cross-company reporting: the direct manager belongs to another company'));
        else issues.push(chartIssue('MANAGER_COMPANY_INCOMPLETE', 'manager_id', 'warning', 'شركة الموظف أو مديره المباشر غير محددة', 'Company of the employee or their direct manager is not assigned'));
        continue;
      }
      issues.push({ code: issue.code, field: issue.field ?? null, severity: severityOf(issue, row), message_ar: issue.message_ar, message_en: issue.message_en });
    }
    if (!row.company_id) issues.push(chartIssue('NO_COMPANY', 'company_id', 'warning', 'الشركة غير محددة', 'Company not assigned'));
    if (!row.branch_id) issues.push(chartIssue('NO_BRANCH', 'branch_id', 'warning', 'الفرع غير محدد', 'Branch not assigned'));
    if (!row.department_id && !isCompanyLevel(input.catalog, row)) issues.push(row.company_id
      ? chartIssue('NO_DEPARTMENT', 'department_id', 'warning', 'الإدارة غير محددة', 'Department not assigned')
      : chartIssue('NO_DEPARTMENT', 'department_id', 'info', 'الإدارة غير محددة', 'Department not assigned'));
    if (!row.position_id) issues.push(chartIssue('NO_POSITION', 'position_id', 'info', 'الوظيفة (Position) غير محددة', 'Position not assigned'));
    const state = managerState(row, visible, input.fullAccess);
    if (state === 'self') issues.push(chartIssue('REPORTING_CYCLE', 'manager_id', 'error', 'الموظف مسجل مديرًا لنفسه', 'Employee is recorded as their own manager'));
    else if (cycles.has(id)) issues.push(chartIssue('REPORTING_CYCLE', 'manager_id', 'error', 'تم اكتشاف حلقة في خط التبعية', 'Reporting cycle detected'));
    if (state === 'missing') issues.push(chartIssue('MANAGER_NOT_FOUND', 'manager_id', 'error', 'المدير المباشر المسجل غير موجود', 'Recorded direct manager does not exist'));
    if (state === 'deleted') issues.push(chartIssue('MANAGER_DELETED', 'manager_id', 'error', 'المدير المباشر المسجل محذوف', 'Recorded direct manager was deleted'));
    const unique = issues.filter((issue, index) => issues.findIndex(other => other.code === issue.code && other.field === issue.field) === index);
    unique.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    if (unique.length) result.set(id, unique);
  }
  return result;
}

/** An employee "needs review" when at least one error or warning exists; info alone is optional setup. */
export const needsReview = (issues?: ChartIssue[]) => Boolean(issues?.some(issue => issue.severity !== 'info'));

export type ReviewItem = { employee: Row; issue: ChartIssue };
export function reviewItems(diagnostics: Map<number, ChartIssue[]>, pool: Row[], matchIds: Set<number>, severities: Severity[] = ['error', 'warning']): ReviewItem[] {
  const rows = byId(pool), items: ReviewItem[] = [];
  for (const [id, issues] of diagnostics) {
    if (!matchIds.has(id) || !rows.has(id)) continue;
    for (const issue of issues) if (severities.includes(issue.severity)) items.push({ employee: rows.get(id)!, issue });
  }
  return items.sort((a, b) => SEVERITY_RANK[a.issue.severity] - SEVERITY_RANK[b.issue.severity] || compareEmployees(a.employee, b.employee) || a.issue.code.localeCompare(b.issue.code));
}

// ---------------------------------------------------------------- filter options

/**
 * Filter choices never expose masters beyond the viewer's reach: a limited viewer only sees masters referenced by
 * employees they can already see (the API has scoped the catalog and rows); full viewers also see unused actives.
 */
export function chartFilterOptions(input: ChartInput, filters: ChartFilters) {
  const pool = chartPool(input.employees), used = (key: string) => new Set(pool.map(row => num(row[key])).filter(Boolean));
  const usedCompanies = used('company_id'), usedBranches = used('branch_id'), usedUnits = used('department_id');
  const reachable = (row: Row, set: Set<number>) => set.has(num(row.id)) || (input.fullAccess && row.status === 'active');
  const companies = input.catalog.companies.filter(row => row.status !== 'deleted' && reachable(row, usedCompanies));
  const companyBranchIds = filters.company && filters.company !== NOT_ASSIGNED
    ? new Set([...input.catalog.companyBranches.filter(link => num(link.company_id) === num(filters.company)).map(link => num(link.branch_id)), ...pool.filter(row => num(row.company_id) === num(filters.company)).map(row => num(row.branch_id))])
    : null;
  const branches = input.catalog.branches.filter(row => row.status !== 'deleted' && reachable(row, usedBranches) && (!companyBranchIds || companyBranchIds.has(num(row.id))));
  const departments = input.catalog.departments.filter(row => row.status !== 'deleted'
    && (row.company_id ? (row.organization_kind || 'department') === 'department' && (!filters.company || filters.company === NOT_ASSIGNED || num(row.company_id) === num(filters.company)) : true)
    && (usedUnits.has(num(row.id)) || (input.fullAccess && row.status === 'active' && Boolean(row.company_id))));
  const statuses = [...new Set(pool.map(row => String(row.employment_status || '')).filter(Boolean))].sort();
  return { companies, branches, departments, statuses };
}

/** Search over name (both languages), employee code, Job Title and Position of employees in the current view. */
export function searchEmployees(input: ChartInput, ids: Set<number>, query: string, limit = 8): Row[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const label = (rows: Row[], id: unknown) => { const row = rows.find(r => num(r.id) === num(id)); return row ? `${row.name_en ?? ''} ${row.name_ar ?? ''} ${row.name ?? ''}` : ''; };
  return chartPool(input.employees).filter(row => ids.has(num(row.id)) && [row.name_en, row.name_ar, row.employee_code, row.job_title_name, row.job_title_name_ar, label(input.catalog.jobTitles, row.job_title_id), label(input.catalog.positions, row.position_id)].join(' ').toLocaleLowerCase().includes(needle)).sort(compareEmployees).slice(0, limit);
}
