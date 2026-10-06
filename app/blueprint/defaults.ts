/**
 * Starting recommendations for the supported company types. These are only seed data: on first use they are copied into the
 * database as ordinary, editable templates (one per type and size). Nothing here is read at run time by the screens.
 *
 * A seat is [title, [micro, small, medium, large], options]. A count of 0 means "not recommended at this size", which is how
 * smaller companies get fewer departments and layers. Teams (options.t) only appear from medium upwards; micro and small
 * companies keep flat departments with combined responsibilities.
 */
import { BLUEPRINT_SIZES, generateTree, totalHeadcount, type BlueprintSize, type BlueprintTree, type BpDepartment, type BpPosition } from './policy.ts';
import { TITLES, UNITS } from './default-titles.ts';

type Counts = readonly [number, number, number, number];
type SeatOptions = { t?: string; opt?: boolean; bb?: boolean };
export type Seat = readonly [string, Counts, SeatOptions?];
export type DeptSpec = { u: string; req?: boolean; seats: readonly Seat[] };
export type TypeSpec = { code: string; en: string; ar: string; departments: readonly DeptSpec[] };

/* Reusable departments (counts are for a typical office-based company; each type tunes what it needs). */
const hr = (): DeptSpec => ({ u: 'hr', seats: [['hr_mgr', [0, 0, 1, 1]], ['hr_spec', [0, 1, 2, 4]], ['recruiter', [0, 0, 1, 3], { t: 'recruitment' }], ['payroll_spec', [0, 0, 1, 2], { t: 'payroll' }], ['training_spec', [0, 0, 0, 1], { opt: true }]] });
const finance = (a: Counts = [0, 1, 2, 6]): DeptSpec => ({ u: 'finance', seats: [['fin_mgr', [0, 1, 1, 1]], ['chief_accountant', [0, 0, 0, 1]], ['accountant', a, { t: 'accounting' }], ['ap_ar', [0, 0, 1, 3], { t: 'accounting' }], ['fin_analyst', [0, 0, 0, 2], { opt: true }]] });
const admin = (): DeptSpec => ({ u: 'admin', seats: [['office_mgr', [0, 0, 1, 1]], ['admin_assistant', [0, 1, 1, 3]], ['receptionist', [0, 0, 1, 2]]] });
const legal = (): DeptSpec => ({ u: 'legal', req: false, seats: [['legal_counsel', [0, 0, 0, 2]], ['compliance_officer', [0, 0, 0, 1]]] });
const itDept = (): DeptSpec => ({ u: 'it', seats: [['it_mgr', [0, 0, 1, 1]], ['sysadmin', [0, 0, 1, 2], { t: 'infra' }], ['network_eng', [0, 0, 0, 2], { t: 'infra', opt: true }], ['it_support', [0, 1, 2, 5], { t: 'helpdesk' }], ['security_analyst', [0, 0, 0, 2], { t: 'infra', opt: true }]] });
const mgmt = (c: Counts = [1, 1, 1, 1], coo: Counts = [0, 0, 1, 1], cfo: Counts = [0, 0, 0, 1]): DeptSpec => ({ u: 'management', seats: [['ceo', c], ['coo', coo], ['cfo', cfo]] });
const salesDept = (): DeptSpec => ({ u: 'sales', seats: [['sales_mgr', [0, 1, 1, 2]], ['sales_exec', [1, 2, 4, 12], { t: 'inside' }], ['account_mgr', [0, 0, 2, 5], { t: 'field' }], ['bd_mgr', [0, 0, 1, 2], { opt: true }]] });
const marketing = (): DeptSpec => ({ u: 'marketing', seats: [['mkt_mgr', [0, 1, 1, 1]], ['digital_mkt', [0, 1, 2, 4], { t: 'digital' }], ['content', [0, 0, 1, 3], { t: 'content' }], ['graphic', [0, 0, 1, 2], { t: 'content', opt: true }]] });
const support = (m: Counts = [0, 1, 2, 8]): DeptSpec => ({ u: 'customer', seats: [['cs_mgr', [0, 0, 1, 1]], ['support_agent', m, { t: 'support' }]] });

export const DEFAULT_TYPES: readonly TypeSpec[] = [
  { code: 'software', en: 'Software Company', ar: 'شركة برمجيات', departments: [
    mgmt(),
    { u: 'engineering', seats: [['cto', [0, 0, 1, 1]], ['eng_mgr', [0, 1, 1, 2]], ['tech_lead', [1, 1, 2, 4]], ['sr_backend', [0, 1, 2, 6], { t: 'backend' }], ['backend', [2, 1, 3, 10], { t: 'backend' }], ['sr_frontend', [0, 0, 1, 4], { t: 'frontend' }], ['frontend', [1, 1, 2, 8], { t: 'frontend' }],
      ['mobile_dev', [0, 1, 2, 6], { t: 'mobile' }], ['qa_lead', [0, 0, 1, 2], { t: 'qa' }], ['qa', [0, 1, 2, 8], { t: 'qa' }], ['devops', [0, 1, 1, 3], { t: 'devops' }], ['sre', [0, 0, 0, 3], { t: 'devops' }], ['security_eng', [0, 0, 0, 3], { t: 'security' }], ['data_eng', [0, 0, 1, 4], { t: 'data', opt: true }], ['ml_eng', [0, 0, 0, 3], { t: 'data', opt: true }]] },
    { u: 'product', seats: [['pm', [0, 1, 1, 2]], ['po', [0, 0, 1, 3]], ['design_lead', [0, 0, 0, 1], { t: 'design' }], ['uiux', [0, 1, 2, 5], { t: 'design' }], ['ba', [0, 0, 1, 3]]] },
    itDept(), hr(), finance(), salesDept(), marketing(), support([0, 1, 2, 8]), admin(), legal(),
  ] },
  { code: 'it_services', en: 'IT Services Company', ar: 'شركة خدمات تقنية', departments: [
    mgmt(),
    { u: 'delivery', seats: [['delivery_mgr', [0, 1, 1, 2]], ['project_mgr', [1, 1, 3, 8]], ['solution_architect', [0, 1, 2, 5]], ['ba', [0, 1, 2, 6]]] },
    { u: 'engineering', seats: [['eng_mgr', [0, 1, 1, 2]], ['tech_lead', [1, 1, 3, 8]], ['backend', [1, 2, 6, 20], { t: 'backend' }], ['frontend', [0, 1, 3, 10], { t: 'frontend' }], ['qa', [0, 1, 2, 8], { t: 'qa' }], ['devops', [0, 1, 1, 4], { t: 'devops' }]] },
    { u: 'sales', seats: [['sales_mgr', [0, 1, 1, 2]], ['sales_exec', [1, 1, 3, 8], { t: 'inside' }], ['presales', [0, 0, 2, 5], { t: 'field' }], ['account_mgr', [0, 1, 2, 6], { t: 'field' }]] },
    itDept(), hr(), finance(), marketing(), support([0, 1, 2, 8]), admin(), legal(),
  ] },
  { code: 'retail', en: 'Retail Company', ar: 'شركة تجزئة', departments: [
    mgmt([1, 1, 1, 1], [0, 0, 1, 1]),
    { u: 'stores', seats: [['store_mgr', [1, 1, 1, 1], { bb: true }], ['asst_store_mgr', [0, 1, 1, 1], { bb: true }], ['sales_assoc', [2, 4, 8, 12], { bb: true }], ['cashier', [1, 2, 3, 5], { bb: true }], ['merchandiser', [0, 0, 1, 2], { bb: true, opt: true }]] },
    { u: 'procurement', seats: [['category_mgr', [0, 0, 1, 3]], ['buyer', [0, 1, 2, 5]]] },
    { u: 'warehouse', seats: [['wh_mgr', [0, 0, 1, 1]], ['inventory_clerk', [1, 1, 3, 8]], ['wh_worker', [0, 1, 3, 10]]] },
    marketing(), hr(), finance([0, 1, 2, 5]), itDept(), support([0, 1, 2, 6]), admin(),
  ] },
  { code: 'ecommerce', en: 'E-commerce Company', ar: 'شركة تجارة إلكترونية', departments: [
    mgmt(),
    { u: 'ecommerce', seats: [['ecom_mgr', [1, 1, 1, 2]], ['category_mgr', [0, 1, 2, 5]], ['catalog_spec', [0, 1, 3, 8]]] },
    { u: 'engineering', seats: [['eng_mgr', [0, 0, 1, 1]], ['tech_lead', [1, 1, 1, 2]], ['backend', [0, 1, 2, 6], { t: 'backend' }], ['frontend', [0, 1, 2, 5], { t: 'frontend' }], ['mobile_dev', [0, 0, 1, 3], { t: 'mobile' }], ['qa', [0, 0, 1, 3], { t: 'qa' }], ['devops', [0, 0, 1, 2], { t: 'devops' }]] },
    { u: 'marketing', seats: [['mkt_mgr', [0, 1, 1, 1]], ['performance_mkt', [1, 1, 2, 6], { t: 'digital' }], ['digital_mkt', [0, 1, 2, 4], { t: 'digital' }], ['seo', [0, 0, 1, 3], { t: 'digital' }], ['content', [0, 1, 1, 4], { t: 'content' }], ['graphic', [0, 0, 1, 3], { t: 'content' }]] },
    { u: 'fulfillment', seats: [['fulfillment_mgr', [0, 1, 1, 2]], ['picker', [0, 2, 10, 50]], ['inventory_clerk', [1, 1, 2, 6]]] },
    { u: 'warehouse', req: false, seats: [['wh_mgr', [0, 0, 1, 2]], ['wh_worker', [0, 0, 6, 30]]] },
    support([1, 2, 8, 40]), hr(), finance(), itDept(), admin(),
  ] },
  { code: 'marketing_agency', en: 'Marketing Agency', ar: 'وكالة تسويق', departments: [
    mgmt([1, 1, 1, 1], [0, 0, 1, 1]),
    { u: 'creative', seats: [['creative_dir', [0, 1, 1, 2]], ['strategist', [0, 1, 2, 4]], ['copywriter', [1, 2, 4, 10], { t: 'content' }], ['graphic', [1, 2, 5, 14], { t: 'design' }], ['motion', [0, 0, 2, 6], { t: 'design' }], ['uiux', [0, 0, 1, 3], { t: 'design', opt: true }]] },
    { u: 'accounts', seats: [['client_dir', [0, 0, 1, 1]], ['account_mgr', [1, 2, 4, 10]]] },
    { u: 'media', seats: [['media_buyer', [0, 1, 2, 6]], ['digital_mkt', [0, 1, 3, 8], { t: 'digital' }], ['social', [0, 1, 2, 6], { t: 'digital' }], ['seo', [0, 0, 1, 3], { t: 'digital' }]] },
    { u: 'projects', seats: [['project_mgr', [0, 1, 2, 5]]] },
    { u: 'sales', seats: [['bd_mgr', [0, 1, 1, 2]], ['sales_exec', [0, 0, 2, 5]]] },
    hr(), finance([0, 1, 2, 4]), admin(),
  ] },
  { code: 'construction', en: 'Construction Company', ar: 'شركة مقاولات', departments: [
    mgmt([1, 1, 1, 1], [0, 0, 1, 1], [0, 0, 1, 1]),
    { u: 'projects', seats: [['project_director', [0, 0, 1, 2]], ['project_mgr', [1, 2, 4, 12]], ['planner', [0, 1, 2, 6]], ['qs', [0, 1, 3, 10]]] },
    { u: 'technical', seats: [['civil_engineer', [1, 2, 5, 15], { t: 'civil' }], ['mep_engineer', [0, 1, 3, 10], { t: 'mep' }], ['cad', [0, 1, 2, 8]]] },
    { u: 'site', seats: [['site_engineer', [1, 3, 8, 30]], ['site_supervisor', [0, 1, 4, 15]], ['foreman', [0, 2, 6, 25]], ['skilled_worker', [3, 10, 40, 150]]] },
    { u: 'hse', seats: [['hse_officer', [0, 1, 2, 8]]] },
    { u: 'procurement', seats: [['procurement_mgr', [0, 0, 1, 1]], ['purchaser', [0, 1, 2, 6]]] },
    { u: 'warehouse', seats: [['wh_mgr', [0, 0, 1, 2]], ['inventory_clerk', [0, 1, 2, 6]]] },
    hr(), finance([1, 1, 3, 8]), admin(), legal(),
  ] },
  { code: 'manufacturing', en: 'Manufacturing Company', ar: 'شركة تصنيع', departments: [
    mgmt([1, 1, 1, 1], [0, 0, 1, 1], [0, 0, 1, 1]),
    { u: 'production', seats: [['plant_mgr', [0, 1, 1, 1]], ['production_mgr', [0, 0, 1, 2]], ['production_sup', [1, 2, 6, 20], { t: 'line' }], ['operator', [3, 10, 40, 200], { t: 'line' }], ['process_eng', [0, 0, 2, 8]]] },
    { u: 'quality', seats: [['quality_mgr', [0, 1, 1, 1]], ['qc_inspector', [1, 2, 6, 25]]] },
    { u: 'maintenance', seats: [['maint_mgr', [0, 0, 1, 1]], ['technician', [1, 2, 5, 20]]] },
    { u: 'supply', seats: [['supply_mgr', [0, 0, 1, 1]], ['purchaser', [0, 1, 2, 6]], ['wh_mgr', [0, 1, 1, 2]], ['wh_worker', [1, 2, 8, 40]]] },
    { u: 'hse', seats: [['hse_officer', [0, 1, 2, 6]]] },
    salesDept(), hr(), finance([0, 1, 2, 6]), admin(), legal(),
  ] },
  { code: 'hospitality', en: 'Restaurant / Hospitality', ar: 'مطاعم وضيافة', departments: [
    { u: 'management', seats: [['gm', [1, 1, 1, 1]], ['coo', [0, 0, 0, 1]]] },
    { u: 'kitchen', seats: [['head_chef', [1, 1, 1, 2]], ['sous_chef', [0, 1, 2, 4]], ['cook', [1, 3, 8, 25], { t: 'hotline' }], ['kitchen_helper', [1, 3, 8, 25], { t: 'cold' }]] },
    { u: 'service', seats: [['restaurant_mgr', [0, 1, 1, 2]], ['host', [0, 1, 2, 5]], ['waiter', [2, 5, 15, 50]], ['cashier', [1, 1, 3, 8]]] },
    { u: 'rooms', req: false, seats: [['front_office_mgr', [0, 0, 1, 2], { opt: true }], ['receptionist', [0, 0, 3, 10], { opt: true }]] },
    { u: 'operations', req: false, seats: [['housekeeping_mgr', [0, 0, 1, 2], { opt: true }], ['housekeeper', [0, 0, 10, 60], { t: 'housekeeping', opt: true }]] },
    { u: 'procurement', seats: [['purchaser', [0, 1, 1, 3]]] },
    { u: 'marketing', req: false, seats: [['social', [0, 1, 1, 2], { opt: true }]] },
    hr(), finance([0, 1, 2, 5]), admin(),
  ] },
  { code: 'logistics', en: 'Logistics Company', ar: 'شركة خدمات لوجستية', departments: [
    mgmt([1, 1, 1, 1], [0, 0, 1, 1]),
    { u: 'operations', seats: [['ops_mgr', [1, 1, 2, 3]], ['ops_coord', [1, 2, 6, 25]], ['freight_coord', [0, 1, 3, 12]], ['customs_spec', [0, 1, 2, 8]]] },
    { u: 'fleet', seats: [['fleet_mgr', [0, 1, 1, 2]], ['dispatcher', [0, 1, 3, 12], { t: 'dispatch' }], ['driver', [3, 10, 40, 200], { t: 'drivers' }], ['technician', [0, 1, 2, 8]]] },
    { u: 'warehouse', seats: [['wh_mgr', [0, 1, 1, 3]], ['inventory_clerk', [0, 1, 3, 12]], ['wh_worker', [2, 6, 25, 120]]] },
    support([0, 1, 3, 12]), salesDept(), { u: 'hse', req: false, seats: [['hse_officer', [0, 0, 1, 4]]] }, hr(), finance([0, 1, 2, 6]), admin(),
  ] },
  { code: 'healthcare', en: 'Healthcare Company', ar: 'شركة رعاية صحية', departments: [
    { u: 'management', seats: [['medical_director', [1, 1, 1, 1]], ['ceo', [0, 1, 1, 1]], ['coo', [0, 0, 0, 1]]] },
    { u: 'clinical', seats: [['physician', [1, 3, 12, 60], { t: 'doctors' }]] },
    { u: 'nursing', seats: [['nursing_mgr', [0, 1, 1, 2]], ['nurse', [1, 3, 15, 80], { t: 'nurses' }]] },
    { u: 'pharmacy', seats: [['pharmacist', [0, 1, 2, 8]]] },
    { u: 'diagnostics', seats: [['lab_tech', [0, 1, 3, 12]], ['radiographer', [0, 0, 2, 8], { opt: true }]] },
    { u: 'admin', seats: [['office_mgr', [0, 0, 1, 1]], ['receptionist', [1, 2, 4, 12]], ['records_clerk', [0, 1, 2, 8]], ['billing_spec', [0, 1, 2, 6]]] },
    hr(), finance([0, 1, 2, 6]), itDept(), { u: 'procurement', seats: [['purchaser', [0, 0, 1, 3]]] },
  ] },
  { code: 'professional_services', en: 'Professional Services Company', ar: 'شركة خدمات مهنية', departments: [
    { u: 'management', seats: [['managing_partner', [1, 1, 1, 2]], ['coo', [0, 0, 1, 1]]] },
    { u: 'consulting', seats: [['sr_consultant', [0, 1, 3, 10]], ['consultant', [1, 3, 10, 40]], ['analyst', [1, 2, 8, 40]], ['project_mgr', [0, 1, 2, 6]]] },
    { u: 'sales', seats: [['bd_mgr', [0, 1, 1, 2]], ['sales_exec', [0, 0, 2, 6]]] },
    { u: 'marketing', seats: [['mkt_mgr', [0, 0, 1, 1]], ['content', [0, 1, 1, 3]]] },
    hr(), finance([0, 1, 2, 5]), itDept(), admin(), legal(),
  ] },
  { code: 'general_trading', en: 'General Trading Company', ar: 'شركة تجارة عامة', departments: [
    mgmt([1, 1, 1, 1], [0, 0, 1, 1]),
    { u: 'trading', seats: [['trade_mgr', [1, 1, 1, 2]], ['sales_exec', [1, 3, 8, 25], { t: 'inside' }], ['account_mgr', [0, 1, 3, 8], { t: 'field' }]] },
    { u: 'procurement', seats: [['procurement_mgr', [0, 0, 1, 1]], ['purchaser', [1, 2, 4, 10]]] },
    { u: 'operations', seats: [['ops_mgr', [0, 1, 1, 2]], ['logistics_coord', [0, 1, 3, 8]], ['customs_spec', [0, 1, 2, 5]]] },
    { u: 'warehouse', seats: [['wh_mgr', [0, 1, 1, 2]], ['inventory_clerk', [0, 1, 3, 8]], ['wh_worker', [1, 3, 10, 40]]] },
    hr(), finance([1, 1, 3, 8]), admin(),
  ] },
];

const nameOf = (key: string) => { const unit = UNITS[key]; if (!unit) throw new Error(`Unknown unit ${key}`); return { en: unit[0], ar: unit[1] }; };

/**
 * One type at one size as a blueprint tree (temporary ids 1..n). Reporting lines follow a simple rule that the user can change:
 * the first position of a department is its head and reports to the top executive; a team's first position leads the team and
 * reports to the head; everyone else reports to their team lead, or to the head when there is no team.
 */
export function expandDefault(spec: TypeSpec, size: BlueprintSize): BlueprintTree {
  const index = BLUEPRINT_SIZES.indexOf(size);
  const departments: BpDepartment[] = [], positions: BpPosition[] = [];
  let deptId = 0, posId = 0, topExecutive: number | null = null;
  const pending: { position: BpPosition; head: number | null; lead: number | null }[] = [];
  spec.departments.forEach((dept, deptOrder) => {
    const seats = dept.seats.filter(seat => seat[1][index] > 0);
    if (!seats.length) return;
    const unit: BpDepartment = { id: ++deptId, parentId: null, kind: 'department', name: nameOf(dept.u), required: dept.req !== false, sortOrder: deptOrder };
    departments.push(unit);
    const teams = new Map<string, BpDepartment>();
    const teamLead = new Map<string, number>();
    let head: number | null = null;
    seats.forEach((seat, seatOrder) => {
      const [key, counts, options = {}] = seat;
      const title = TITLES[key];
      if (!title) throw new Error(`Unknown title ${key}`);
      let home = unit;
      if (options.t && index >= 2) {
        if (!teams.has(options.t)) { const team: BpDepartment = { id: ++deptId, parentId: unit.id, kind: 'team', name: nameOf(options.t), required: true, sortOrder: teams.size }; teams.set(options.t, team); departments.push(team); }
        home = teams.get(options.t)!;
      }
      const position: BpPosition = { id: ++posId, departmentId: home.id, parentPositionId: null, title: { en: title[0], ar: title[1] }, headcount: counts[index], seniority: title[2], required: !options.opt, perBranch: Boolean(options.bb), description: { en: title[3], ar: title[4] }, sortOrder: seatOrder };
      positions.push(position);
      const isHead = head === null;
      if (isHead) head = position.id;
      if (spec.departments[0] === dept && isHead) topExecutive = position.id;
      let lead: number | null = null;
      if (home !== unit) { const existing = teamLead.get(String(home.id)); if (existing === undefined) teamLead.set(String(home.id), position.id); else lead = existing; }
      pending.push({ position, head: isHead ? null : head, lead });
    });
  });
  // Reporting lines: members → team lead; team leads and department staff → department head; heads → top executive.
  for (const item of pending) {
    const { position } = item;
    if (item.lead !== null) { position.parentPositionId = item.lead; continue; }
    if (item.head !== null) { position.parentPositionId = item.head; continue; }
    // This position is a department head (or the first seat of a team that has none): find its manager.
    const dept = departments.find(d => d.id === position.departmentId)!;
    if (dept.parentId !== null) { const upper = pending.find(p => p.head === null && p.position.departmentId === dept.parentId); position.parentPositionId = upper?.position.id ?? topExecutive; }
    else position.parentPositionId = position.id === topExecutive ? null : topExecutive;
  }
  return { departments, positions };
}

export type DefaultTemplate = { type: TypeSpec; size: BlueprintSize; name: { en: string; ar: string }; tree: BlueprintTree };
/** Each size recommends at least this many people, so a "Large" template really is a large company (micro stays as written, 10 or fewer). */
export const SIZE_FLOORS: Record<BlueprintSize, number> = { micro: 0, small: 12, medium: 60, large: 260 };
const sized = (tree: BlueprintTree, size: BlueprintSize) => (totalHeadcount(tree) < SIZE_FLOORS[size] ? generateTree(tree, { expectedEmployees: SIZE_FLOORS[size] }) : tree);

export function defaultTemplates(): DefaultTemplate[] {
  return DEFAULT_TYPES.flatMap(type => BLUEPRINT_SIZES.map(size => ({ type, size, name: { en: `${type.en} — ${size[0].toUpperCase()}${size.slice(1)}`, ar: `${type.ar} — ${{ micro: 'متناهية الصغر', small: 'صغيرة', medium: 'متوسطة', large: 'كبيرة' }[size]}` }, tree: sized(expandDefault(type, size), size) })));
}
