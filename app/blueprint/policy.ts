/**
 * Company Staffing Blueprint rules that need no database: sizes, validation, generation by company size, the hierarchy
 * shown on screen, edit helpers, and the dry-run that decides what "Apply Structure to Company" would create or reuse.
 *
 * A blueprint is a recommendation (departments → sections/teams → positions with a suggested headcount). It never
 * contains employees and nothing here treats it as a requirement.
 */
export const BLUEPRINT_SIZES = ['micro', 'small', 'medium', 'large'] as const;
export type BlueprintSize = (typeof BLUEPRINT_SIZES)[number];
export const SIZE_LABELS: Record<BlueprintSize, { en: string; ar: string; range: string }> = {
  micro: { en: 'Micro', ar: 'متناهية الصغر', range: '1–10' }, small: { en: 'Small', ar: 'صغيرة', range: '11–50' },
  medium: { en: 'Medium', ar: 'متوسطة', range: '51–250' }, large: { en: 'Large', ar: 'كبيرة', range: '251+' },
};
export const SENIORITY_LEVELS = ['executive', 'director', 'manager', 'lead', 'senior', 'mid', 'junior', 'entry'] as const;
export type Seniority = (typeof SENIORITY_LEVELS)[number];
export const SENIORITY_LABELS: Record<Seniority, { en: string; ar: string }> = {
  executive: { en: 'Executive', ar: 'تنفيذي' }, director: { en: 'Director', ar: 'مدير إدارة' }, manager: { en: 'Manager', ar: 'مدير' }, lead: { en: 'Lead', ar: 'قائد فريق' },
  senior: { en: 'Senior', ar: 'أول' }, mid: { en: 'Mid-level', ar: 'متوسط' }, junior: { en: 'Junior', ar: 'مبتدئ' }, entry: { en: 'Entry', ar: 'مستوى مبدئي' },
};
export type UnitKind = 'department' | 'section' | 'team';
export const UNIT_KINDS: readonly UnitKind[] = ['department', 'section', 'team'];
export type TemplateStatus = 'draft' | 'active' | 'archived';
export type CompanyBlueprintStatus = 'draft' | 'approved' | 'applied' | 'archived';
export const MAX_HEADCOUNT = 10000;

export type Name = { en: string; ar: string };
export type BpDepartment = { id: number; parentId: number | null; kind: UnitKind; name: Name; required: boolean; sortOrder: number };
export type BpPosition = {
  id: number; departmentId: number; parentPositionId: number | null; title: Name; headcount: number; seniority: Seniority; required: boolean; perBranch: boolean;
  description: Name | null; sortOrder: number;
};
export type BlueprintTree = { departments: BpDepartment[]; positions: BpPosition[] };

export type BlueprintIssue = { code: string; field: string | null; message_ar: string; message_en: string; status?: number };
export class BlueprintError extends Error {
  issue: BlueprintIssue;
  constructor(issue: BlueprintIssue) { super(issue.message_en); this.issue = { status: 400, ...issue }; }
}
export const fail = (code: string, field: string | null, message_ar: string, message_en: string, status = 400): never => { throw new BlueprintError({ code, field, message_ar, message_en, status }); };

/* ---------- Validation ---------- */

const positiveInt = (value: unknown) => { const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value; return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null; };
const optionalId = (value: unknown, field: string) => {
  if (value === null || value === undefined || value === '' || value === 0 || value === '0') return null;
  return positiveInt(value) ?? fail('INVALID_REFERENCE', field, 'قيمة غير صالحة', `Invalid ${field}`);
};
const text = (value: unknown, max: number, field: string) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > max ? fail('TOO_LONG', field, 'النص أطول من المسموح', `${field} is too long (max ${max})`) : trimmed;
};
/** Both languages are stored; when only one is typed the other mirrors it so every record can be shown in either interface. */
export function bilingual(en: unknown, ar: unknown, field: string, max = 200): Name {
  const e = text(en, max, `${field}En`), a = text(ar, max, `${field}Ar`);
  if (!e && !a) fail('NAME_REQUIRED', field, 'الاسم مطلوب', 'A name is required');
  return { en: e || a, ar: a || e };
}
const flag = (value: unknown, fallback: boolean) => (value === undefined || value === null || value === '' ? fallback : value === true || value === 1 || value === '1' || value === 'true');
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string, fallback?: T): T => {
  const v = String(value ?? '').trim() as T;
  if (!v && fallback) return fallback;
  return allowed.includes(v) ? v : fail('INVALID_VALUE', field, 'قيمة غير صالحة', `Invalid ${field}`);
};

export type TemplateInput = { name: Name; companyTypeId: number; size: BlueprintSize; description: Name | null };
export function validateTemplateInput(raw: Record<string, unknown>): TemplateInput {
  const companyTypeId = positiveInt(raw.companyTypeId) ?? fail('TYPE_REQUIRED', 'companyTypeId', 'نوع الشركة مطلوب', 'Company type is required');
  const description = raw.descriptionEn || raw.descriptionAr ? bilingual(raw.descriptionEn, raw.descriptionAr, 'description', 1000) : null;
  return { name: bilingual(raw.nameEn, raw.nameAr, 'name'), companyTypeId, size: oneOf(raw.size, BLUEPRINT_SIZES, 'size'), description };
}

export type GenerateInput = { templateId: number | null; companyTypeId: number; size: BlueprintSize; companyId: number | null; name: Name | null; expectedEmployees: number | null; branches: number | null; country: string | null; businessModel: string | null };
export function validateGenerateInput(raw: Record<string, unknown>): GenerateInput {
  const optionalCount = (value: unknown, field: string, max: number) => {
    if (value === null || value === undefined || value === '') return null;
    const n = positiveInt(value);
    return n !== null && n <= max ? n : fail('INVALID_VALUE', field, 'قيمة غير صالحة', `${field} must be a whole number from 1 to ${max}`);
  };
  const named = raw.nameEn || raw.nameAr;
  return {
    templateId: optionalId(raw.templateId, 'templateId'),
    companyTypeId: positiveInt(raw.companyTypeId) ?? fail('TYPE_REQUIRED', 'companyTypeId', 'نوع الشركة مطلوب', 'Company type is required'),
    size: oneOf(raw.size, BLUEPRINT_SIZES, 'size'), companyId: optionalId(raw.companyId, 'companyId'), name: named ? bilingual(raw.nameEn, raw.nameAr, 'name') : null,
    expectedEmployees: optionalCount(raw.expectedEmployees, 'expectedEmployees', 100000), branches: optionalCount(raw.branches, 'branches', 500),
    country: text(raw.country, 80, 'country') || null, businessModel: text(raw.businessModel, 200, 'businessModel') || null,
  };
}

export type DepartmentInput = { parentId: number | null; kind: UnitKind; name: Name; required: boolean };
/** Same unit rules as the real organization: department (no parent) → section → team (a team may also sit directly under a department). */
export function validateDepartmentInput(raw: Record<string, unknown>, tree: BlueprintTree, selfId: number | null = null): DepartmentInput {
  const kind = oneOf(raw.kind, UNIT_KINDS, 'kind', 'department');
  const parentId = optionalId(raw.parentId, 'parentId');
  const parent = parentId === null ? null : tree.departments.find(d => d.id === parentId) ?? fail('PARENT_INVALID', 'parentId', 'الوحدة الأم غير موجودة', 'The parent unit is not in this blueprint', 409);
  if (kind === 'department' && parent) fail('PARENT_INVALID', 'parentId', 'الإدارة لا تتبع وحدة أخرى', 'A department has no parent unit', 409);
  if (kind === 'section' && parent?.kind !== 'department') fail('PARENT_INVALID', 'parentId', 'القسم الفرعي يتبع إدارة', 'A section belongs to a department', 409);
  if (kind === 'team' && !(parent && (parent.kind === 'department' || parent.kind === 'section'))) fail('PARENT_INVALID', 'parentId', 'الفريق يتبع إدارة أو قسمًا فرعيًا', 'A team belongs to a department or a section', 409);
  if (selfId !== null && parent && departmentSubtreeIds(tree, selfId).has(parent.id)) fail('PARENT_CYCLE', 'parentId', 'هذا الاختيار يُنشئ حلقة', 'That parent would create a loop', 409);
  return { parentId, kind, name: bilingual(raw.nameEn, raw.nameAr, 'name'), required: flag(raw.required, true) };
}

export type PositionInput = { departmentId: number; parentPositionId: number | null; title: Name; headcount: number; seniority: Seniority; required: boolean; perBranch: boolean; description: Name | null };
export function validatePositionInput(raw: Record<string, unknown>, tree: BlueprintTree, selfId: number | null = null): PositionInput {
  const departmentId = positiveInt(raw.departmentId) ?? fail('DEPARTMENT_REQUIRED', 'departmentId', 'الإدارة مطلوبة', 'Department is required');
  if (!tree.departments.some(d => d.id === departmentId)) fail('DEPARTMENT_INVALID', 'departmentId', 'الإدارة غير موجودة في هذا المخطط', 'The department is not in this blueprint', 409);
  const rawCount = typeof raw.headcount === 'string' && raw.headcount.trim() !== '' ? Number(raw.headcount) : raw.headcount;
  if (typeof rawCount !== 'number' || !Number.isInteger(rawCount) || rawCount < 0 || rawCount > MAX_HEADCOUNT) fail('HEADCOUNT_INVALID', 'headcount', `العدد المقترح يجب أن يكون رقمًا صحيحًا بين 0 و ${MAX_HEADCOUNT}`, `Headcount must be a whole number from 0 to ${MAX_HEADCOUNT}`);
  const parentPositionId = optionalId(raw.parentPositionId, 'parentPositionId');
  if (parentPositionId !== null) {
    if (parentPositionId === selfId) fail('PARENT_INVALID', 'parentPositionId', 'لا يمكن أن يتبع المنصب نفسه', 'A position cannot report to itself', 409);
    if (!tree.positions.some(p => p.id === parentPositionId)) fail('PARENT_INVALID', 'parentPositionId', 'المنصب الأعلى غير موجود في هذا المخطط', 'The reporting position is not in this blueprint', 409);
    if (selfId !== null && positionWouldCycle(selfId, parentPositionId, new Map(tree.positions.map(p => [p.id, p.parentPositionId])))) fail('PARENT_CYCLE', 'parentPositionId', 'هذا الاختيار يُنشئ حلقة في التبعية', 'That reporting line would create a loop', 409);
  }
  const d = raw.descriptionEn || raw.descriptionAr ? bilingual(raw.descriptionEn, raw.descriptionAr, 'description', 600) : null;
  return { departmentId, parentPositionId, title: bilingual(raw.titleEn, raw.titleAr, 'title'), headcount: rawCount as number, seniority: oneOf(raw.seniority, SENIORITY_LEVELS, 'seniority', 'mid'), required: flag(raw.required, true), perBranch: flag(raw.perBranch, false), description: d };
}

/* ---------- Tree helpers ---------- */

export function departmentSubtreeIds(tree: BlueprintTree, id: number): Set<number> {
  const out = new Set<number>(); const stack = [id];
  while (stack.length) { const current = stack.pop()!; if (out.has(current)) continue; out.add(current); for (const d of tree.departments) if (d.parentId === current) stack.push(d.id); }
  return out;
}
export function positionWouldCycle(positionId: number, parentId: number, parentOf: ReadonlyMap<number, number | null>) {
  const seen = new Set<number>();
  for (let current: number | null | undefined = parentId; current != null && !seen.has(current); current = parentOf.get(current)) { if (current === positionId) return true; seen.add(current); }
  return false;
}
/** Removing a department removes every unit and position beneath it; positions elsewhere that reported into it become top-level. */
export function removeDepartment(tree: BlueprintTree, id: number): BlueprintTree {
  const gone = departmentSubtreeIds(tree, id);
  const removedPositions = new Set(tree.positions.filter(p => gone.has(p.departmentId)).map(p => p.id));
  return { departments: tree.departments.filter(d => !gone.has(d.id)), positions: tree.positions.filter(p => !removedPositions.has(p.id)).map(p => (p.parentPositionId !== null && removedPositions.has(p.parentPositionId) ? { ...p, parentPositionId: null } : p)) };
}
/** Removing a position releases the positions that reported to it (they become top-level); nobody is deleted with it. */
export function removePosition(tree: BlueprintTree, id: number): BlueprintTree {
  return { departments: tree.departments, positions: tree.positions.filter(p => p.id !== id).map(p => (p.parentPositionId === id ? { ...p, parentPositionId: null } : p)) };
}
export const totalHeadcount = (tree: BlueprintTree) => tree.positions.reduce((sum, p) => sum + p.headcount, 0);

/* ---------- Generation by size ---------- */

export type GenerateOptions = { expectedEmployees?: number | null; branches?: number | null };
/**
 * Adapts a template to a request. Template size already decides which departments and positions exist. On top of that:
 * positions marked per-branch multiply by the number of branches, and an expected employee count rescales the
 * non-leadership positions proportionally (never below 1 for required roles; optional roles that round to 0 are dropped).
 * Executive and director seats are never scaled: a company has one CEO however large it is.
 */
export function generateTree(template: BlueprintTree, options: GenerateOptions = {}): BlueprintTree {
  const branches = options.branches && options.branches > 1 ? options.branches : 1;
  let positions = template.positions.map(p => ({ ...p, headcount: p.perBranch ? p.headcount * branches : p.headcount }));
  const expected = options.expectedEmployees && options.expectedEmployees > 0 ? options.expectedEmployees : null;
  const fixed = (p: BpPosition) => p.seniority === 'executive' || p.seniority === 'director';
  if (expected) {
    const fixedTotal = positions.filter(fixed).reduce((s, p) => s + p.headcount, 0);
    const scalableTotal = positions.filter(p => !fixed(p)).reduce((s, p) => s + p.headcount, 0);
    const room = Math.max(0, expected - fixedTotal);
    const factor = scalableTotal > 0 ? room / scalableTotal : 1;
    positions = positions.map(p => (fixed(p) ? p : { ...p, headcount: Math.max(p.required ? 1 : 0, Math.min(MAX_HEADCOUNT, Math.round(p.headcount * factor))) }));
  }
  const dropped = new Set(positions.filter(p => p.headcount === 0 && !p.required).map(p => p.id));
  positions = positions.filter(p => !dropped.has(p.id)).map(p => (p.parentPositionId !== null && dropped.has(p.parentPositionId) ? { ...p, parentPositionId: null } : p));
  // An optional unit left with nothing in it (and nothing beneath it) is dropped; required units stay even when empty.
  let departments = template.departments.map(d => ({ ...d }));
  for (let changed = true; changed;) {
    changed = false;
    const used = new Set(positions.map(p => p.departmentId));
    const parents = new Set(departments.map(d => d.parentId).filter((v): v is number => v !== null));
    const keep = departments.filter(d => d.required || used.has(d.id) || parents.has(d.id));
    if (keep.length !== departments.length) { departments = keep; changed = true; }
  }
  const alive = new Set(departments.map(d => d.id));
  return { departments, positions: positions.filter(p => alive.has(p.departmentId)) };
}

/* ---------- Hierarchy shown on screen ---------- */

export type HierarchyNode = {
  key: string; level: 'company' | 'department' | 'section' | 'team' | 'position'; label: Name; headcount: number; positionCount: number; required: boolean;
  department?: BpDepartment; position?: BpPosition; reportsTo?: Name | null; children: HierarchyNode[];
};
const byOrder = <T extends { sortOrder: number }>(a: T, b: T) => a.sortOrder - b.sortOrder;

/**
 * Company → departments → sections/teams → positions. Positions that report to another position in the same unit nest
 * beneath it; the others sit directly under their unit (reportsTo still names the manager). Cyclic data cannot hide anything.
 */
export function buildHierarchy(tree: BlueprintTree, company: Name): HierarchyNode {
  const positionsOf = (departmentId: number): HierarchyNode[] => {
    const group = tree.positions.filter(p => p.departmentId === departmentId).sort(byOrder);
    const ids = new Set(group.map(p => p.id));
    const nodes = new Map(group.map(p => [p.id, positionNode(p, tree)]));
    const roots: HierarchyNode[] = [];
    for (const p of group) {
      const parent = p.parentPositionId !== null && p.parentPositionId !== p.id && ids.has(p.parentPositionId) ? nodes.get(p.parentPositionId) : undefined;
      (parent ? parent.children : roots).push(nodes.get(p.id)!);
    }
    const reachable = new Set<number>();
    const walk = (n: HierarchyNode) => { if (n.position && !reachable.has(n.position.id)) { reachable.add(n.position.id); n.children.forEach(walk); } };
    roots.forEach(walk);
    for (const p of group) if (!reachable.has(p.id)) { const n = nodes.get(p.id)!; n.children = []; roots.push(n); walk(n); }
    return roots;
  };
  const unitNode = (d: BpDepartment): HierarchyNode => {
    const subUnits = tree.departments.filter(c => c.parentId === d.id).sort(byOrder).map(unitNode);
    const positions = positionsOf(d.id);
    const own = tree.positions.filter(p => p.departmentId === d.id);
    return { key: `unit:${d.id}`, level: d.kind, label: d.name, department: d, required: d.required, children: [...positions, ...subUnits], headcount: own.reduce((s, p) => s + p.headcount, 0) + subUnits.reduce((s, n) => s + n.headcount, 0), positionCount: own.length + subUnits.reduce((s, n) => s + n.positionCount, 0) };
  };
  const tops = tree.departments.filter(d => d.parentId === null).sort(byOrder).map(unitNode);
  return { key: 'company', level: 'company', label: company, required: true, children: tops, headcount: tops.reduce((s, n) => s + n.headcount, 0), positionCount: tops.reduce((s, n) => s + n.positionCount, 0) };
}
function positionNode(p: BpPosition, tree: BlueprintTree): HierarchyNode {
  const manager = p.parentPositionId !== null ? tree.positions.find(x => x.id === p.parentPositionId) : undefined;
  return { key: `position:${p.id}`, level: 'position', label: p.title, headcount: p.headcount, positionCount: 1, required: p.required, position: p, reportsTo: manager?.title ?? null, children: [] };
}
export const flattenHierarchy = (node: HierarchyNode): HierarchyNode[] => [node, ...node.children.flatMap(flattenHierarchy)];

/* ---------- Apply to the real organization (dry run) ---------- */

export type ExistingUnit = { id: number; parentId: number | null; kind: UnitKind; nameEn: string; nameAr: string };
export type ExistingTitle = { id: number; departmentId: number | null; nameEn: string; nameAr: string };
export type ApplyUnitItem = { departmentId: number; parentDepartmentId: number | null; kind: UnitKind; name: Name; action: 'create' | 'reuse'; existingId: number | null };
export type ApplyPositionItem = { positionId: number; departmentId: number; topDepartmentId: number; title: Name; headcount: number; action: 'create' | 'reuse'; existingId: number | null };
export type ApplyPlan = {
  units: ApplyUnitItem[]; positions: ApplyPositionItem[];
  /** The company already has units: applying needs an explicit confirmation (nothing existing is changed either way). */
  hasExistingStructure: boolean;
  conflicts: { type: 'existing_structure' | 'unit_exists' | 'title_exists'; name: Name; existingId: number | null }[];
  counts: { unitsToCreate: number; unitsReused: number; titlesToCreate: number; titlesReused: number; seats: number };
};

/** Case, spacing, Arabic diacritics and common letter variants are ignored when deciding that two names are the same. */
export function normalizeName(value: unknown): string {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const sameName = (a: { en: string; ar: string }, b: { en: string; ar: string }) => (normalizeName(a.en) !== '' && normalizeName(a.en) === normalizeName(b.en)) || (normalizeName(a.ar) !== '' && normalizeName(a.ar) === normalizeName(b.ar));

/**
 * What applying `tree` to a company that already has `units` and `titles` would do. Matching existing units/titles are reused
 * (never duplicated, never modified); everything else is created. Only departments, sections, teams and job titles are
 * involved: no employee, assignment or existing record is touched.
 */
export function planApply(tree: BlueprintTree, units: readonly ExistingUnit[], titles: readonly ExistingTitle[]): ApplyPlan {
  const resolved = new Map<number, { existingId: number | null }>();
  const items: ApplyUnitItem[] = [];
  const order = [...tree.departments].sort((a, b) => depth(tree, a.id) - depth(tree, b.id) || a.sortOrder - b.sortOrder);
  for (const d of order) {
    const parent = d.parentId === null ? undefined : resolved.get(d.parentId);
    const parentExisting = d.parentId === null ? null : parent?.existingId ?? null;
    const match = d.parentId !== null && parentExisting === null ? undefined : units.find(u => u.kind === d.kind && u.parentId === parentExisting && sameName({ en: u.nameEn, ar: u.nameAr }, d.name));
    resolved.set(d.id, { existingId: match?.id ?? null });
    items.push({ departmentId: d.id, parentDepartmentId: d.parentId, kind: d.kind, name: d.name, action: match ? 'reuse' : 'create', existingId: match?.id ?? null });
  }
  const top = (id: number): number => { let current = tree.departments.find(d => d.id === id); while (current?.parentId != null) current = tree.departments.find(d => d.id === current!.parentId); return current?.id ?? id; };
  const positions: ApplyPositionItem[] = [];
  const seen = new Set<string>();
  for (const p of tree.positions) {
    const topId = top(p.departmentId), existingDept = resolved.get(topId)?.existingId ?? null;
    // One job title per (department, name): several seats or teams with the same title share it.
    const key = `${topId}:${normalizeName(p.title.en) || normalizeName(p.title.ar)}`;
    const match = existingDept === null ? undefined : titles.find(t => t.departmentId === existingDept && sameName({ en: t.nameEn, ar: t.nameAr }, p.title));
    positions.push({ positionId: p.id, departmentId: p.departmentId, topDepartmentId: topId, title: p.title, headcount: p.headcount, action: match || seen.has(key) ? 'reuse' : 'create', existingId: match?.id ?? null });
    seen.add(key);
  }
  const hasExistingStructure = units.length > 0;
  const conflicts: ApplyPlan['conflicts'] = [];
  if (hasExistingStructure) conflicts.push({ type: 'existing_structure', name: { en: `${units.length} existing unit(s)`, ar: `${units.length} وحدة قائمة` }, existingId: null });
  for (const u of items) if (u.action === 'reuse') conflicts.push({ type: 'unit_exists', name: u.name, existingId: u.existingId });
  for (const p of positions) if (p.action === 'reuse' && p.existingId !== null) conflicts.push({ type: 'title_exists', name: p.title, existingId: p.existingId });
  return {
    units: items, positions, hasExistingStructure, conflicts,
    counts: { unitsToCreate: items.filter(i => i.action === 'create').length, unitsReused: items.filter(i => i.action === 'reuse').length, titlesToCreate: positions.filter(p => p.action === 'create').length, titlesReused: positions.filter(p => p.action === 'reuse').length, seats: positions.reduce((s, p) => s + p.headcount, 0) },
  };
}
function depth(tree: BlueprintTree, id: number): number { let n = 0, current = tree.departments.find(d => d.id === id); while (current?.parentId != null && n < 10) { n++; current = tree.departments.find(d => d.id === current!.parentId); } return n; }

/* ---------- Permissions ---------- */

export type BlueprintGrants = { view: boolean; create: boolean; edit: boolean; approve: boolean; delete: boolean; manage_settings: boolean };
export type BlueprintAccess = { canView: boolean; canGenerate: boolean; canEdit: boolean; canApply: boolean; canArchive: boolean; canManageLibrary: boolean; wholeCompany: boolean };
/**
 * Everything needs the view grant. Designing blueprints and applying them also need whole-company scope (a branch-scoped HR
 * account or a manager can only read). The template library is managed by Super Admin only, whatever grants a role carries.
 */
export function blueprintAccess(actor: { roleName: string; hrDataScope?: string | null }, grants: BlueprintGrants): BlueprintAccess {
  const wholeCompany = actor.roleName === 'Super Admin' || (actor.roleName === 'HR Manager' && actor.hrDataScope !== 'assigned');
  const view = grants.view;
  return { canView: view, wholeCompany, canGenerate: view && wholeCompany && grants.create, canEdit: view && wholeCompany && grants.edit, canApply: view && wholeCompany && grants.approve, canArchive: view && wholeCompany && grants.delete, canManageLibrary: view && actor.roleName === 'Super Admin' };
}

export function assertTemplateTransition(status: TemplateStatus, action: 'activate' | 'archive' | 'draft') {
  if (action === 'activate' && status === 'active') fail('ALREADY_ACTIVE', null, 'القالب نشط بالفعل', 'The template is already active', 409);
  if (action === 'archive' && status === 'archived') fail('ALREADY_ARCHIVED', null, 'القالب مؤرشف بالفعل', 'The template is already archived', 409);
  if (action === 'draft' && status === 'draft') fail('ALREADY_DRAFT', null, 'القالب مسودة بالفعل', 'The template is already a draft', 409);
}
/** Approved and applied blueprints are frozen for editing; reopen (approved → draft) is allowed, applied is final. */
export function assertCompanyBlueprintEditable(status: CompanyBlueprintStatus) {
  if (status === 'applied') fail('BLUEPRINT_APPLIED', null, 'تم تطبيق المخطط على الشركة ولا يمكن تعديله', 'This blueprint was already applied to the company and can no longer be edited', 409);
  if (status === 'archived') fail('BLUEPRINT_ARCHIVED', null, 'المخطط مؤرشف', 'This blueprint is archived', 409);
  if (status === 'approved') fail('BLUEPRINT_APPROVED', null, 'المخطط معتمد؛ أعده إلى مسودة لتعديله', 'This blueprint is approved; reopen it as a draft to edit', 409);
}
