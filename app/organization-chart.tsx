"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Briefcase, Building2, ChevronDown, ChevronUp, CircleCheck, Crosshair, ExternalLink, IdCard, Info, Layers, ListTree, MapPin, Minus, Network, Pencil, Plus, Printer, RotateCcw, Search, Users, X, type LucideIcon } from 'lucide-react';
import type { Row } from './ui-types';
import type { OrganizationCatalog } from './organization/assignment-policy';
import { ancestorPath, chartFilterOptions, chartPool, computeChartDiagnostics, deriveOrganizationView, deriveReportingView, directReportCount, needsReview, NOT_ASSIGNED, reviewItems, searchEmployees, type ChartFilters, type ChartInput, type ChartIssue, type ChartNode, type ContextReason, type ReportingView, type Severity, type UnitNode } from './organization/chart-model';
import { nameOf } from './organization/selectors';
import './organization-settings.css';
import './organization-chart.css';

/*
 * Stage 4 Organizational Chart — read-only visualization and navigation. Every node is derived from persisted
 * employee assignments + organizational masters (see organization/chart-model.ts). There is deliberately no
 * drag & drop, inline editing or chart-specific write: changes happen in the Employee Profile or Settings.
 */

const STACK_MIN = 5, PRINT_WIDTH = 1060, PRINT_HEIGHT = 690,CANVAS_PADDING = 36, NARROW = 760;
/** Beyond this many nodes the default view opens two levels and "Expand all" is disabled. */
const LARGE_VIEW = 300, EXPAND_ALL_LIMIT = 1500, REVIEW_PAGE = 100;

type Lang = { rtl: boolean };
const t = (rtl: boolean, en: string, ar: string) => (rtl ? ar : en);
const num = (value: unknown) => Number(value) || 0;
const find = (rows: Row[], id: unknown) => (id ? rows.find(row => num(row.id) === num(id)) : undefined);

const STATUS: Record<string, [string, string]> = {
  active: ['Active', 'نشط'], probation: ['Probation', 'تحت التجربة'], notice_period: ['Notice period', 'فترة إشعار'], suspended: ['Suspended', 'موقوف'],
  terminated: ['Terminated', 'منتهي الخدمة'], resigned: ['Resigned', 'مستقيل'], inactive: ['Inactive', 'غير نشط'], on_leave: ['On leave', 'في إجازة'],
};
const statusLabel = (rtl: boolean, status: unknown) => { const pair = STATUS[String(status)]; return pair ? (rtl ? pair[1] : pair[0]) : String(status || '—'); };

const FIELD: Record<string, [string, string]> = {
  company_id: ['Company', 'الشركة'], branch_id: ['Branch', 'الفرع'], department_id: ['Department', 'الإدارة'], section_id: ['Section', 'القسم الفرعي'],
  team_id: ['Team', 'الفريق'], position_id: ['Position', 'الوظيفة'], job_title_id: ['Job title', 'المسمى الوظيفي'], manager_id: ['Direct manager', 'المدير المباشر'],
  grade_id: ['Job grade / level', 'الدرجة الوظيفية'], work_location_id: ['Work location', 'مقر العمل'],
};
const fieldLabel = (rtl: boolean, field: string | null) => (field && FIELD[field] ? (rtl ? FIELD[field][1] : FIELD[field][0]) : '—');

const BADGE: Record<string, [string, string]> = {
  NO_COMPANY: ['No company', 'بلا شركة'], NO_BRANCH: ['No branch', 'بلا فرع'], NO_DEPARTMENT: ['No department', 'بلا إدارة'], NO_POSITION: ['No position', 'بلا وظيفة'],
  LEGACY_UNIT: ['Legacy', 'قديم'], JOB_TITLE_DEPARTMENT_MISMATCH: ['Title conflict', 'تعارض المسمى'], INACTIVE_RETAINED_VALUE: ['Inactive retained', 'قيمة غير نشطة'],
  INACTIVE_SELECTION: ['Inactive retained', 'قيمة غير نشطة'], REPORTING_CYCLE: ['Reporting cycle', 'حلقة تبعية'], MANAGER_NOT_FOUND: ['Manager missing', 'المدير غير موجود'],
  MANAGER_DELETED: ['Manager missing', 'المدير غير موجود'], MANAGER_INACTIVE: ['Manager inactive', 'المدير غير نشط'], CROSS_COMPANY_REPORTING: ['Cross-company reporting', 'تبعية بين شركات'],
  MANAGER_COMPANY_INCOMPLETE: ['Manager company', 'شركة المدير'], POSITION_CONTRADICTION: ['Position conflict', 'تعارض الوظيفة'], CEO_HAS_MANAGER: ['CEO has a manager', 'للرئيس التنفيذي مدير'],
  WORK_LOCATION_BRANCH: ['Location conflict', 'تعارض مقر العمل'],
};
const badgeLabel = (rtl: boolean, code: string) => { const pair = BADGE[code] ?? ['Invalid combination', 'تركيبة غير صالحة']; return rtl ? pair[1] : pair[0]; };
const SEVERITY: Record<Severity, [string, string]> = { error: ['Error', 'خطأ'], warning: ['Warning', 'تحذير'], info: ['Info', 'معلومة'] };

/** Bilingual catalog label; a missing record shows its id only as a secondary diagnostic. */
function recordLabel(rtl: boolean, rows: Row[], id: unknown): { text: string; legacy: boolean; inactive: boolean; missing: boolean } {
  if (!id) return { text: t(rtl, 'Not assigned', 'غير محدد'), legacy: false, inactive: false, missing: false };
  const row = find(rows, id);
  if (!row) return { text: `${t(rtl, 'Unavailable record', 'سجل غير متاح')} #${id}`, legacy: false, inactive: false, missing: true };
  return { text: nameOf(row, rtl), legacy: 'company_id' in row && 'organization_kind' in row && !row.company_id, inactive: Boolean(row.status && row.status !== 'active'), missing: false };
}
const unitText = (rtl: boolean, catalog: OrganizationCatalog, id: unknown) => {
  const label = recordLabel(rtl, catalog.departments, id);
  return id ? `${label.legacy ? t(rtl, 'Legacy: ', 'قديم: ') : ''}${label.text}${label.inactive ? t(rtl, ' (inactive)', ' (غير نشط)') : ''}` : '';
};
/** Position when one exists (primary professional label), else Job Title. Never treats one as the other. */
function roleLabels(rtl: boolean, catalog: OrganizationCatalog, employee: Row) {
  const position = find(catalog.positions, employee.position_id), title = find(catalog.jobTitles, employee.job_title_id);
  const titleText = title ? nameOf(title, rtl) : String((rtl ? employee.job_title_name_ar : employee.job_title_name) || employee.job_title_name || '');
  const positionText = position ? nameOf(position, rtl) : '';
  return { primary: positionText || titleText, secondary: positionText && titleText && titleText !== positionText ? titleText : '', ceo: Boolean(position && num(position.is_ceo) === 1) };
}
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('') || '·';

function Avatar({ employee, name }: { employee: Row; name: string }) {
  return employee.avatar_url ? <img className="chart-avatar" src={employee.avatar_url} alt="" /> : <span className="chart-avatar" aria-hidden="true">{initials(name)}</span>;
}

/** Card badges: errors first, then the warnings that say most about where the employee sits. */
const BADGE_PRIORITY = ['NO_COMPANY', 'LEGACY_UNIT', 'NO_BRANCH', 'JOB_TITLE_DEPARTMENT_MISMATCH', 'INACTIVE_RETAINED_VALUE', 'NO_DEPARTMENT', 'MANAGER_INACTIVE'];
const badgeRank = (issue: ChartIssue) => (issue.severity === 'error' ? -1 : BADGE_PRIORITY.includes(issue.code) ? BADGE_PRIORITY.indexOf(issue.code) : BADGE_PRIORITY.length);

function Badges({ rtl, issues, max = 2 }: Lang & { issues?: ChartIssue[]; max?: number }) {
  const shown = (issues ?? []).filter(issue => issue.severity !== 'info').sort((a, b) => badgeRank(a) - badgeRank(b));
  if (!shown.length) return null;
  return <span className="chart-badges">{shown.slice(0, max).map(issue => <span key={issue.code + issue.field} className={`chart-badge ${issue.severity}`}>{badgeLabel(rtl, issue.code)}</span>)}{shown.length > max && <span className="chart-badge more" title={shown.slice(max).map(issue => badgeLabel(rtl, issue.code)).join(', ')}>+{shown.length - max}</span>}</span>;
}

function contextText(rtl: boolean, catalog: OrganizationCatalog, reasons: ContextReason[]): string {
  return reasons.map(reason => {
    if (reason.type === 'company') return reason.companyId ? `${t(rtl, 'Outside selected company', 'خارج الشركة المحددة')}: ${recordLabel(rtl, catalog.companies, reason.companyId).text}` : t(rtl, 'Company not assigned', 'الشركة غير محددة');
    if (reason.type === 'branch') return reason.branchId ? `${t(rtl, 'Other branch', 'فرع آخر')}: ${recordLabel(rtl, catalog.branches, reason.branchId).text}` : t(rtl, 'Branch not assigned', 'الفرع غير محدد');
    if (reason.type === 'department') return t(rtl, 'Outside selected department', 'خارج الإدارة المحددة');
    return `${t(rtl, 'Status', 'الحالة')}: ${statusLabel(rtl, reason.status)}`;
  }).join(' · ');
}

// ---------------------------------------------------------------- expansion state

/** Open/closed per key: a base mode plus the keys the user flipped. Survives data reloads (keys are ids). */
type Expansion<K> = { base: 'default' | 'all' | 'none'; flipped: Set<K> };
const isOpenIn = <K,>(state: Expansion<K>, key: K, openByDefault: boolean) => {
  const base = state.base === 'all' ? true : state.base === 'none' ? false : openByDefault;
  return state.flipped.has(key) ? !base : base;
};
const withOpen = <K,>(state: Expansion<K>, entries: [K, boolean, boolean][]): Expansion<K> => {
  const flipped = new Set(state.flipped);
  for (const [key, open, openByDefault] of entries) {
    const base = state.base === 'all' ? true : state.base === 'none' ? false : openByDefault;
    if (open === base) flipped.delete(key); else flipped.add(key);
  }
  return { base: state.base, flipped };
};

// ---------------------------------------------------------------- reporting tree

type TreeContext = {
  rtl: boolean; catalog: OrganizationCatalog; diagnostics: Map<number, ChartIssue[]>; showCompany: boolean; defaultDepth: number;
  expansion: Expansion<number>; selected: number | null; focused: number | null;
  toggle: (node: ChartNode, depth: number) => void; open: (id: number) => void;
};
const nodeOpen = (node: ChartNode, depth: number, ctx: TreeContext) => isOpenIn(ctx.expansion, node.id, depth < ctx.defaultDepth);

function ReportingCard({ node, depth, ctx }: { node: ChartNode; depth: number; ctx: TreeContext }) {
  const { rtl, catalog } = ctx, e = node.employee, name = nameOf(e, rtl), role = roleLabels(rtl, catalog, e), issues = ctx.diagnostics.get(node.id);
  const context = node.kind === 'context', count = node.children.length, open = nodeOpen(node, depth, ctx);
  const unit = unitText(rtl, catalog, e.department_id), branch = e.branch_id ? recordLabel(rtl, catalog.branches, e.branch_id).text : '';
  const company = e.company_id ? recordLabel(rtl, catalog.companies, e.company_id).text : '';
  const place = [unit, context || ctx.showCompany ? company : '', branch].filter(Boolean).join(' · ');
  const action = open ? t(rtl, 'Collapse', 'طي') : t(rtl, 'Expand', 'توسيع');
  return <>
    {node.managerState === 'restricted' && depth === 0 && <div className="chart-context-break">{t(rtl, 'Reporting manager outside your access scope', 'المدير المباشر خارج نطاق صلاحياتك')}</div>}
    <div className={`reporting-card ${context ? 'context' : ''} ${needsReview(issues) && !context ? 'review' : ''} ${ctx.selected === node.id ? 'selected' : ''} ${ctx.focused === node.id ? 'focused' : ''}`} data-node-id={node.id}>
      {context && <span className="chart-context-label">{t(rtl, 'Reporting context', 'سياق التبعية')}</span>}
      <button type="button" className="reporting-person" onClick={() => ctx.open(node.id)} aria-label={`${name}${context ? ` — ${t(rtl, 'Reporting context', 'سياق التبعية')}` : ''}`}>
        <Avatar employee={e} name={name} />
        <b>{name}{role.ceo && <small className="reporting-ceo">CEO</small>}</b>
        {role.primary && <span className="reporting-title">{role.primary}</span>}
        {role.secondary && <span className="reporting-unit">{role.secondary}</span>}
        {place && <span className="reporting-unit reporting-place"><MapPin aria-hidden="true" /><span>{place}</span></span>}
        {context && <span className="chart-context-reason">{contextText(rtl, catalog, node.reasons)}</span>}
        {!context && <Badges rtl={rtl} issues={issues} />}
      </button>
    </div>
    {count > 0 && <button type="button" className="reporting-toggle" aria-expanded={open} aria-label={`${action} — ${count} ${t(rtl, 'direct reports in view', 'مرؤوسون مباشرون في العرض')}`} title={`${count} ${t(rtl, 'direct reports in view', 'مرؤوسون مباشرون في العرض')}`} onClick={() => ctx.toggle(node, depth)}>{open ? <ChevronUp /> : <ChevronDown />}<span>{count}</span></button>}
  </>;
}

function ReportingBranch({ node, depth, ctx }: { node: ChartNode; depth: number; ctx: TreeContext }) {
  const kids = nodeOpen(node, depth, ctx) ? node.children : [];
  const leaf = (child: ChartNode) => !child.children.length || !nodeOpen(child, depth + 1, ctx);
  const singles = kids.filter(leaf), stacked = new Set(singles.length >= STACK_MIN ? singles : []);
  return <>
    <ReportingCard node={node} depth={depth} ctx={ctx} />
    {kids.length > 0 && <ul className="reporting-children">
      {kids.filter(child => !stacked.has(child)).map(child => <li key={child.id}><ReportingBranch node={child} depth={depth + 1} ctx={ctx} /></li>)}
      {stacked.size > 0 && <li className="reporting-stack"><ul className="reporting-stack-list">{kids.filter(child => stacked.has(child)).map(child => <li key={child.id}><ReportingBranch node={child} depth={depth + 1} ctx={ctx} /></li>)}</ul></li>}
    </ul>}
  </>;
}

/** Narrow screens: the same forest as an indented, keyboard-friendly list. Only expanded rows are rendered. */
function ReportingList({ roots, ctx }: { roots: ChartNode[]; ctx: TreeContext }) {
  const rows: { node: ChartNode; depth: number }[] = [], stack = [...roots].reverse().map(node => ({ node, depth: 0 }));
  while (stack.length) { const item = stack.pop()!; rows.push(item); if (nodeOpen(item.node, item.depth, ctx)) for (let i = item.node.children.length - 1; i >= 0; i--) stack.push({ node: item.node.children[i], depth: item.depth + 1 }); }
  const { rtl, catalog } = ctx;
  return <ul className="chart-list">{rows.map(({ node, depth }) => {
    const e = node.employee, name = nameOf(e, rtl), role = roleLabels(rtl, catalog, e), open = nodeOpen(node, depth, ctx), context = node.kind === 'context', issues = ctx.diagnostics.get(node.id);
    return <li key={node.id} className={`chart-list-row ${context ? 'context' : ''} ${ctx.selected === node.id ? 'selected' : ''} ${ctx.focused === node.id ? 'focused' : ''}`} style={{ paddingInlineStart: `${Math.min(depth, 12) * 18 + 6}px` }} data-node-id={node.id}>
      {node.children.length ? <button type="button" className="chart-list-toggle" aria-expanded={open} aria-label={`${open ? t(rtl, 'Collapse', 'طي') : t(rtl, 'Expand', 'توسيع')} ${name}`} onClick={() => ctx.toggle(node, depth)}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}<small>{node.children.length}</small></button> : <span className="chart-list-toggle placeholder" />}
      <button type="button" className="chart-list-person" onClick={() => ctx.open(node.id)}>
        <Avatar employee={e} name={name} />
        <span><b>{name}</b><small>{[role.primary, unitText(rtl, catalog, e.department_id)].filter(Boolean).join(' · ')}</small>
          {node.managerState === 'restricted' && depth === 0 && <small className="chart-context-reason">{t(rtl, 'Reporting manager outside your access scope', 'المدير المباشر خارج نطاق صلاحياتك')}</small>}
          {context ? <small className="chart-context-reason">{t(rtl, 'Reporting context', 'سياق التبعية')} — {contextText(rtl, catalog, node.reasons)}</small> : <Badges rtl={rtl} issues={issues} />}</span>
      </button>
    </li>;
  })}</ul>;
}

// ---------------------------------------------------------------- organization units

function unitTitle(rtl: boolean, catalog: OrganizationCatalog, node: UnitNode): string {
  switch (node.type) {
    case 'company': return node.id ? recordLabel(rtl, catalog.companies, node.id).text : t(rtl, 'Unassigned company', 'شركة غير محددة');
    case 'branch': return recordLabel(rtl, catalog.branches, node.id).text;
    case 'no-branch': return t(rtl, 'Branch not assigned', 'الفرع غير محدد');
    case 'leadership': return t(rtl, 'Company leadership', 'قيادة الشركة');
    case 'no-department': return t(rtl, 'Department not assigned', 'الإدارة غير محددة');
    case 'review': return t(rtl, 'Legacy / Needs review', 'قديم / يحتاج مراجعة');
    case 'review-unit': {
      if (!node.row) return `${t(rtl, 'Unavailable record', 'سجل غير متاح')} #${node.id}`;
      const name = nameOf(node.row, rtl);
      if (!node.row.company_id) return `${t(rtl, 'Legacy', 'قديم')}: ${name}`;
      return `${name} — ${recordLabel(rtl, catalog.companies, node.row.company_id).text}`;
    }
    default: return node.row ? nameOf(node.row, rtl) : '—';
  }
}
const UNIT_KIND: Record<string, [string, string]> = { department: ['Department', 'إدارة'], section: ['Section', 'قسم فرعي'], team: ['Team', 'فريق'], branch: ['Branch', 'فرع'], company: ['Company', 'شركة'] };

type UnitContext = { rtl: boolean; catalog: OrganizationCatalog; diagnostics: Map<number, ChartIssue[]>; pool: Row[]; expansion: Expansion<string>; defaultDepth: number; selected: number | null; focused: number | null; toggle: (key: string, depth: number) => void; open: (id: number) => void };

function UnitBranch({ node, depth, ctx }: { node: UnitNode; depth: number; ctx: UnitContext }) {
  const { rtl, catalog } = ctx, open = isOpenIn(ctx.expansion, node.key, depth < ctx.defaultDepth), kind = UNIT_KIND[node.type];
  const flagged = node.type === 'review' || node.type === 'review-unit' || node.type === 'no-department' || node.type === 'no-branch';
  return <li className={`unit-node unit-${node.type}`}>
    <div className={`unit-row ${flagged ? 'flagged' : ''}`}>
      <button type="button" className="unit-toggle" aria-expanded={open} onClick={() => ctx.toggle(node.key, depth)}>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        <b>{unitTitle(rtl, catalog, node)}</b>
        {kind && <small className="unit-kind">{rtl ? kind[1] : kind[0]}</small>}
        {node.inactive && <small className="chart-badge warning">{t(rtl, 'Inactive — retained', 'غير نشطة — محفوظة')}</small>}
        {node.type === 'review-unit' && <small className="chart-badge warning">{t(rtl, 'Needs review', 'يحتاج مراجعة')}</small>}
        <span className="unit-count" title={t(rtl, 'Employees in view', 'الموظفون في العرض')}>{node.count}</span>
      </button>
    </div>
    {open && (node.employees.length > 0 || node.children.length > 0) && <div className="unit-body">
      {node.employees.length > 0 && <div className="unit-people">{node.employees.map(employee => {
        const id = num(employee.id), name = nameOf(employee, rtl), role = roleLabels(rtl, catalog, employee), manager = find(ctx.pool, employee.manager_id);
        return <button type="button" key={id} data-node-id={id} className={`unit-person ${needsReview(ctx.diagnostics.get(id)) ? 'review' : ''} ${ctx.selected === id ? 'selected' : ''} ${ctx.focused === id ? 'focused' : ''}`} onClick={() => ctx.open(id)}>
          <Avatar employee={employee} name={name} />
          <span><b>{name}{role.ceo && <small className="reporting-ceo">CEO</small>}</b><small>{role.primary || '—'}</small>
            {manager && <small className="unit-manager">{t(rtl, 'Reports to', 'يتبع')}: {nameOf(manager, rtl)}</small>}
            <Badges rtl={rtl} issues={ctx.diagnostics.get(id)} /></span>
        </button>;
      })}</div>}
      {node.children.length > 0 && <ul className="unit-children">{node.children.map(child => <UnitBranch key={child.key} node={child} depth={depth + 1} ctx={ctx} />)}</ul>}
    </div>}
  </li>;
}

// ---------------------------------------------------------------- quick view

const FACT_ICONS: Record<string, LucideIcon> = { company_id: Building2, branch_id: MapPin, department_id: Network, section_id: Layers, team_id: Users, position_id: Briefcase, job_title_id: IdCard };

export function QuickView({ rtl, catalog, employee, pool, fullAccess, issues, canEdit, close, openProfile, editProfile, showManager, reveal }: Lang & {
  catalog: OrganizationCatalog; employee: Row; pool: Row[]; fullAccess: boolean; issues: ChartIssue[]; canEdit: boolean;
  close: () => void; openProfile: () => void; editProfile: () => void; showManager: (id: number) => void; reveal: () => void;
}) {
  const panel = useRef<HTMLElement>(null), name = nameOf(employee, rtl);
  useEffect(() => { panel.current?.focus(); }, [employee.id]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [close]);
  const managerId = num(employee.manager_id), manager = managerId ? find(pool, managerId) : undefined;
  const managerText = !managerId ? t(rtl, 'No direct manager (reporting root)', 'لا يوجد مدير مباشر (جذر التبعية)')
    : manager ? '' : !fullAccess || employee.manager_scope === 'restricted' ? t(rtl, 'Outside your access scope', 'خارج نطاق صلاحياتك') : employee.manager_scope === 'deleted' ? t(rtl, 'Deleted record', 'سجل محذوف') : t(rtl, 'Missing record', 'سجل غير موجود');
  const fact = (field: string, rows: Row[], id: unknown, unit = false) => {
    const label = recordLabel(rtl, rows, id), Icon = FACT_ICONS[field] ?? Info;
    return <div key={field}><dt><Icon size={15} aria-hidden="true" />{fieldLabel(rtl, field)}</dt><dd className={!id ? 'muted' : ''}>{unit && id ? unitText(rtl, catalog, id) : label.text}{label.inactive && !unit && <small className="chart-badge warning">{t(rtl, 'Inactive', 'غير نشط')}</small>}{label.missing && <small className="chart-badge error">{t(rtl, 'Unavailable', 'غير متاح')}</small>}</dd></div>;
  };
  const jobTitle = employee.job_title_id ? recordLabel(rtl, catalog.jobTitles, employee.job_title_id).text : '';
  const statusTone = employee.employment_status === 'active' ? 'good' : employee.employment_status === 'terminated' || employee.employment_status === 'deleted' ? 'bad' : 'warn';
  return <aside ref={panel} tabIndex={-1} className="chart-quickview" role="dialog" aria-modal="false" aria-label={`${t(rtl, 'Quick view', 'عرض سريع')}: ${name}`}>
    <header>
      <div className="chart-qv-top"><small>{t(rtl, 'Quick view', 'عرض سريع')}</small><button type="button" className="icon-button" onClick={close} aria-label={t(rtl, 'Close', 'إغلاق')}><X size={18} /></button></div>
      <div className="chart-qv-identity">
        <Avatar employee={employee} name={name} />
        <div><h2>{name}</h2>{jobTitle && <p>{jobTitle}</p>}<div className="chart-qv-chips">{employee.employee_code && <span className="chart-qv-chip" dir="ltr">{String(employee.employee_code)}</span>}<span className={`chart-qv-chip status ${statusTone}`}>{statusLabel(rtl, employee.employment_status)}</span></div></div>
      </div>
    </header>
    <div className="chart-quickview-body">
      <section><h3>{t(rtl, 'Organization', 'التنظيم')}</h3><dl className="chart-facts">
        {fact('company_id', catalog.companies, employee.company_id)}{fact('branch_id', catalog.branches, employee.branch_id)}
        {fact('department_id', catalog.departments, employee.department_id, true)}{fact('section_id', catalog.departments, employee.section_id, true)}{fact('team_id', catalog.departments, employee.team_id, true)}
        {fact('position_id', catalog.positions, employee.position_id)}
        {fact('job_title_id', catalog.jobTitles, employee.job_title_id)}
      </dl></section>
      <section><h3>{t(rtl, 'Reporting', 'التبعية')}</h3><dl className="chart-facts chart-qv-tiles">
        <div><dt>{fieldLabel(rtl, 'manager_id')}</dt><dd>{manager ? <button type="button" className="chart-qv-person" onClick={() => showManager(num(manager.id))}><Avatar employee={manager} name={nameOf(manager, rtl)} /><span className="chart-link">{nameOf(manager, rtl)}</span></button> : <span className="muted">{managerText}</span>}</dd></div>
        <div><dt>{t(rtl, 'Direct reports', 'المرؤوسون المباشرون')}</dt><dd>{directReportCount(pool, num(employee.id))}</dd></div>
      </dl></section>
      <section><h3>{t(rtl, 'Needs review', 'يحتاج مراجعة')}</h3>{issues.length ? <ul className="chart-issue-list">{issues.map(issue => <li key={issue.code + issue.field} className={issue.severity}><span className={`chart-badge ${issue.severity}`}>{rtl ? SEVERITY[issue.severity][1] : SEVERITY[issue.severity][0]}</span><span>{rtl ? issue.message_ar : issue.message_en}<small>{fieldLabel(rtl, issue.field)}</small></span></li>)}</ul> : <p className="chart-qv-ok"><CircleCheck size={16} aria-hidden="true" />{t(rtl, 'No organizational warnings.', 'لا توجد ملاحظات تنظيمية.')}</p>}</section>
    </div>
    <footer>
      <button type="button" className="primary" onClick={openProfile}><ExternalLink size={16} />{t(rtl, 'Open Employee Profile', 'فتح ملف الموظف')}</button>
      <div className="chart-qv-secondary">
        {canEdit && <button type="button" className="outline" onClick={editProfile}><Pencil size={16} />{t(rtl, 'Edit Employee Profile', 'تعديل ملف الموظف')}</button>}
        <button type="button" className="outline" onClick={reveal}><Crosshair size={16} />{t(rtl, 'Show in chart', 'إظهار في الهيكل')}</button>
      </div>
    </footer>
  </aside>;
}

// ---------------------------------------------------------------- needs review

export function NeedsReviewPanel({ rtl, catalog, diagnostics, pool, matchIds, openProfile, reveal }: Lang & { catalog: OrganizationCatalog; diagnostics: Map<number, ChartIssue[]>; pool: Row[]; matchIds: Set<number>; openProfile: (id: number) => void; reveal: (id: number) => void }) {
  const [severity, setSeverity] = useState<'review' | Severity | 'all'>('review'), [limit, setLimit] = useState(REVIEW_PAGE);
  const severities: Severity[] = severity === 'review' ? ['error', 'warning'] : severity === 'all' ? ['error', 'warning', 'info'] : [severity];
  const items = useMemo(() => reviewItems(diagnostics, pool, matchIds, severities), [diagnostics, pool, matchIds, severity]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => { const all = reviewItems(diagnostics, pool, matchIds, ['error', 'warning', 'info']); return { error: all.filter(i => i.issue.severity === 'error').length, warning: all.filter(i => i.issue.severity === 'warning').length, info: all.filter(i => i.issue.severity === 'info').length }; }, [diagnostics, pool, matchIds]);
  return <section className="chart-review" aria-label={t(rtl, 'Needs review', 'يحتاج مراجعة')}>
    <header><div><h2><AlertTriangle size={18} />{t(rtl, 'Needs review', 'يحتاج مراجعة')}</h2><p>{t(rtl, 'Derived from stored assignments and the shared organizational rules. Fix data in the Employee Profile or Settings — never from the chart.', 'مستخرجة من التعيينات المحفوظة وقواعد الهيكل المشتركة. تُصحح البيانات من ملف الموظف أو الإعدادات وليس من الهيكل.')}</p></div>
      <label>{t(rtl, 'Severity', 'الخطورة')}<select value={severity} onChange={event => { setSeverity(event.target.value as typeof severity); setLimit(REVIEW_PAGE); }}>
        <option value="review">{t(rtl, 'Errors and warnings', 'الأخطاء والتحذيرات')} ({totals.error + totals.warning})</option>
        <option value="error">{rtl ? SEVERITY.error[1] : SEVERITY.error[0]} ({totals.error})</option><option value="warning">{rtl ? SEVERITY.warning[1] : SEVERITY.warning[0]} ({totals.warning})</option>
        <option value="info">{rtl ? SEVERITY.info[1] : SEVERITY.info[0]} ({totals.info})</option><option value="all">{t(rtl, 'All', 'الكل')} ({totals.error + totals.warning + totals.info})</option>
      </select></label></header>
    {items.length ? <div className="chart-review-table" role="table">
      <div className="chart-review-row head" role="row"><span role="columnheader">{t(rtl, 'Employee', 'الموظف')}</span><span role="columnheader">{t(rtl, 'Problem', 'المشكلة')}</span><span role="columnheader">{t(rtl, 'Field', 'الحقل')}</span><span role="columnheader">{t(rtl, 'Severity', 'الخطورة')}</span><span role="columnheader">{t(rtl, 'Action', 'الإجراء')}</span></div>
      {items.slice(0, limit).map(({ employee, issue }) => { const id = num(employee.id); return <div key={`${id}-${issue.code}-${issue.field}`} className="chart-review-row" role="row" data-review-employee={id}>
        <span role="cell"><button type="button" className="chart-link" onClick={() => reveal(id)}>{nameOf(employee, rtl)}</button><small>{employee.employee_code}</small></span>
        <span role="cell">{rtl ? issue.message_ar : issue.message_en}{issue.code === 'LEGACY_UNIT' && issue.field !== 'job_title_id' && employee[issue.field ?? ''] ? <small>{unitText(rtl, catalog, employee[issue.field ?? ''])}</small> : null}</span>
        <span role="cell">{fieldLabel(rtl, issue.field)}</span>
        <span role="cell"><span className={`chart-badge ${issue.severity}`}>{rtl ? SEVERITY[issue.severity][1] : SEVERITY[issue.severity][0]}</span></span>
        <span role="cell"><button type="button" className="outline small" onClick={() => openProfile(id)}>{t(rtl, 'Open Employee Profile', 'فتح ملف الموظف')}</button></span>
      </div>; })}
      {items.length > limit && <button type="button" className="outline" onClick={() => setLimit(value => value + REVIEW_PAGE)}>{t(rtl, 'Show more', 'عرض المزيد')} ({items.length - limit})</button>}
    </div> : <p className="muted">{t(rtl, 'Nothing needs review for the current filters.', 'لا توجد عناصر تحتاج مراجعة ضمن عوامل التصفية الحالية.')}</p>}
  </section>;
}

// ---------------------------------------------------------------- page

export type OrganizationChartProps = {
  rtl: boolean; employees: Row[]; catalog: OrganizationCatalog; fullAccess: boolean; canEdit: boolean;
  openProfile: (employee: Row) => void; editProfile: (employee: Row) => void;
};

export function OrganizationChart({ rtl, employees, catalog, fullAccess, canEdit, openProfile, editProfile }: OrganizationChartProps) {
  const [view, setView] = useState<'reporting' | 'organization'>('reporting'), [orgMode, setOrgMode] = useState<'department' | 'branch'>('department');
  const [filters, setFilters] = useState<ChartFilters>({ status: 'current' }), [query, setQuery] = useState(''), [showEmpty, setShowEmpty] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false), [quickId, setQuickId] = useState<number | null>(null), [focused, setFocused] = useState<number | null>(null);
  const [treeState, setTreeState] = useState<Expansion<number>>({ base: 'default', flipped: new Set() }), [unitState, setUnitState] = useState<Expansion<string>>({ base: 'default', flipped: new Set() });
  const [layout, setLayout] = useState<'auto' | 'tree' | 'list'>('auto'), [narrow, setNarrow] = useState(false), [scale, setScale] = useState(1);
  const canvas = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);

  useEffect(() => { const media = window.matchMedia(`(max-width: ${NARROW}px)`), update = () => setNarrow(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);

  const input: ChartInput = useMemo(() => ({ employees, catalog, fullAccess }), [employees, catalog, fullAccess]);
  const pool = useMemo(() => chartPool(employees), [employees]);
  const diagnostics = useMemo(() => computeChartDiagnostics(input), [input]);
  const options = useMemo(() => chartFilterOptions(input, filters), [input, filters]);
  const reporting: ReportingView = useMemo(() => deriveReportingView(input, filters), [input, filters]);
  const organization = useMemo(() => view === 'organization' ? deriveOrganizationView(input, filters, orgMode, { showEmpty }) : null, [input, filters, orgMode, showEmpty, view]);
  const reviewCount = useMemo(() => [...reporting.matchIds].filter(id => needsReview(diagnostics.get(id))).length, [reporting, diagnostics]);
  const results = useMemo(() => searchEmployees(input, reporting.matchIds, query), [input, reporting, query]);
  const listLayout = view === 'reporting' && (layout === 'list' || (layout === 'auto' && narrow));
  const nodeCount = view === 'reporting' ? reporting.nodes.size : reporting.matchCount;
  const defaultDepth = nodeCount > LARGE_VIEW ? 2 : Number.POSITIVE_INFINITY;
  const unitDefaultDepth = (organization?.matchCount ?? 0) > LARGE_VIEW ? 2 : 4;

  const setFilter = (key: keyof ChartFilters, value: string) => setFilters(current => {
    const next = { ...current, [key]: value || undefined };
    if (key === 'company') { next.branch = undefined; next.department = undefined; }
    return next;
  });

  /** Open every ancestor of an employee in the active view, then focus the node (search / review / quick view). */
  const reveal = (id: number, openQuick = true) => {
    if (view === 'reporting') {
      const path = ancestorPath(reporting.parentOf, id), depthOf = (index: number) => path.length - 1 - index;
      setTreeState(state => withOpen(state, path.map((ancestor, index) => [ancestor, true, depthOf(index) < defaultDepth] as [number, boolean, boolean])));
    } else if (organization) {
      const keys = organization.placement.get(id) ?? [];
      setUnitState(state => withOpen(state, keys.map((key, depth) => [key, true, depth < unitDefaultDepth] as [string, boolean, boolean])));
    }
    setFocused(id); if (openQuick) setQuickId(id);
  };
  useEffect(() => {
    if (focused === null) return;
    const frame = window.requestAnimationFrame(() => { const node = document.querySelector<HTMLElement>(`[data-node-id="${focused}"]`); node?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); });
    return () => window.cancelAnimationFrame(frame);
  }, [focused, treeState, unitState, view, orgMode]);

  const ctx: TreeContext = { rtl, catalog, diagnostics, showCompany: !filters.company, defaultDepth, expansion: treeState, selected: quickId, focused,
    toggle: (node, depth) => setTreeState(state => withOpen(state, [[node.id, !isOpenIn(state, node.id, depth < defaultDepth), depth < defaultDepth]])), open: id => { setFocused(null); setQuickId(id); } };
  const unitCtx: UnitContext = { rtl, catalog, diagnostics, pool, expansion: unitState, defaultDepth: unitDefaultDepth, selected: quickId, focused,
    toggle: (key, depth) => setUnitState(state => withOpen(state, [[key, !isOpenIn(state, key, depth < unitDefaultDepth), depth < unitDefaultDepth]])), open: id => { setFocused(null); setQuickId(id); } };
  const expandAll = () => (view === 'reporting' ? setTreeState({ base: 'all', flipped: new Set() }) : setUnitState({ base: 'all', flipped: new Set() }));
  const collapseAll = () => (view === 'reporting' ? setTreeState({ base: 'none', flipped: new Set() }) : setUnitState({ base: 'none', flipped: new Set() }));

  // Zoom, fit and print apply to the tree layout only; the list layout reflows naturally.
  const naturalWidth = () => { const el = content.current; if (!el) return 0; const previous = el.style.zoom; el.style.zoom = '1'; const width = Math.max(0, ...[...el.querySelectorAll<HTMLElement>('.reporting-roots>li')].map(li => li.offsetWidth)); el.style.zoom = previous; return width; };
  const center = () => { canvas.current?.scrollTo({ left: (rtl ? -1 : 1) * Math.max(0, (canvas.current.scrollWidth - canvas.current.clientWidth) / 2), top: 0, behavior: 'smooth' }); };
  const fit = () => { const natural = naturalWidth(); if (canvas.current && natural) setScale(Math.max(.35, Math.min(1, (canvas.current.clientWidth - CANVAS_PADDING) / natural))); center(); };
  const print = () => {
    const root = document.documentElement, el = content.current, screenZoom = el?.style.zoom || String(scale);
    const pageStyle = document.createElement('style'); pageStyle.textContent = '@page { size: A4 landscape; margin: 8mm; }'; document.head.appendChild(pageStyle);
    const companies = [...(el?.querySelectorAll<HTMLElement>('.reporting-company') ?? [])], companyZooms = companies.map(company => company.style.zoom);
    root.classList.add('reporting-printing');
    if (el && companies.length) {
      // Each company prints on its own page, so each is scaled to fit one page on its own.
      el.style.zoom = '1';
      const heading = el.closest('.org-chart')?.querySelector<HTMLElement>('.chart-heading')?.offsetHeight ?? 0;
      companies.forEach((company, index) => {
        const width = Math.max(0, ...[...company.querySelectorAll<HTMLElement>('.reporting-roots>li')].map(li => li.offsetWidth)), height = company.offsetHeight;
        const room = PRINT_HEIGHT - (index === 0 ? heading : 0);
        company.style.zoom = String(Math.max(.3, Math.min(1, width ? PRINT_WIDTH / width : 1, height ? room / height : 1)));
      });
    } else if (el) { const natural = naturalWidth(); el.style.zoom = String(natural ? Math.min(1, PRINT_WIDTH / natural) : 1); }
    window.addEventListener('afterprint', () => { root.classList.remove('reporting-printing'); pageStyle.remove(); companies.forEach((company, index) => { company.style.zoom = companyZooms[index]; }); if (el) el.style.zoom = screenZoom; }, { once: true });
    window.setTimeout(() => window.print(), 120);
  };

  const quick = quickId !== null ? pool.find(row => num(row.id) === quickId) : undefined;
  useEffect(() => { if (quickId !== null && !quick) setQuickId(null); }, [quickId, quick]);
  const select = (key: keyof ChartFilters, title: string, rows: Row[], none?: string) => <label>{title}<select value={filters[key] ?? ''} onChange={event => setFilter(key, event.target.value)}>
    <option value="">{t(rtl, 'All', 'الكل')}</option>{none && <option value={NOT_ASSIGNED}>{none}</option>}
    {rows.map(row => <option key={row.id} value={row.id}>{key === 'department' ? unitText(rtl, catalog, row.id) : nameOf(row, rtl)}{key !== 'department' && row.status !== 'active' ? t(rtl, ' (inactive)', ' (غير نشط)') : ''}</option>)}
  </select></label>;
  const tooLarge = nodeCount > EXPAND_ALL_LIMIT;

  return <section className="organization-workspace org-chart" dir={rtl ? 'rtl' : 'ltr'}>
    <header className="chart-heading">
      <div><h1>{t(rtl, 'Organizational chart', 'الهيكل التنظيمي')}</h1><p>{view === 'reporting' ? t(rtl, 'Who reports to whom — built only from each employee’s stored direct manager.', 'من يتبع من — مبني فقط من المدير المباشر المحفوظ لكل موظف.') : t(rtl, 'Where everyone sits — built from stored Company, Branch and unit assignments.', 'أين يقع كل موظف — مبني من الشركة والفرع والوحدة المحفوظة.')}</p></div>
      <div className="chart-stats" aria-live="polite">
        <span><b>{reporting.matchCount}</b>{t(rtl, 'Employees in view', 'موظفون في العرض')}</span>
        {view === 'reporting' && reporting.contextCount > 0 && <span className="context"><b>{reporting.contextCount}</b>{t(rtl, 'Reporting context (not counted)', 'سياق التبعية (غير محتسب)')}</span>}
        <button type="button" className={`chart-stat-review ${reviewOpen ? 'active' : ''}`} aria-pressed={reviewOpen} onClick={() => setReviewOpen(open => !open)}><b>{reviewCount}</b>{t(rtl, 'Needs review', 'يحتاج مراجعة')}</button>
      </div>
    </header>

    <div className="chart-toolbar">
      <div className="chart-segment" role="group" aria-label={t(rtl, 'View', 'العرض')}>
        <button type="button" aria-pressed={view === 'reporting'} className={view === 'reporting' ? 'active' : ''} onClick={() => setView('reporting')}><Network size={16} />{t(rtl, 'Reporting', 'التبعية')}</button>
        <button type="button" aria-pressed={view === 'organization'} className={view === 'organization' ? 'active' : ''} onClick={() => setView('organization')}><ListTree size={16} />{t(rtl, 'Organization', 'الوحدات التنظيمية')}</button>
      </div>
      {view === 'organization' && <div className="chart-segment" role="group" aria-label={t(rtl, 'Group by', 'التجميع حسب')}>
        <button type="button" aria-pressed={orgMode === 'department'} className={orgMode === 'department' ? 'active' : ''} onClick={() => setOrgMode('department')}>{t(rtl, 'By Department', 'حسب الإدارة')}</button>
        <button type="button" aria-pressed={orgMode === 'branch'} className={orgMode === 'branch' ? 'active' : ''} onClick={() => setOrgMode('branch')}>{t(rtl, 'By Branch', 'حسب الفرع')}</button>
      </div>}
      <div className="chart-search">
        <label><Search size={16} /><span className="sr-only">{t(rtl, 'Search employees', 'البحث عن موظف')}</span>
          <input type="search" value={query} placeholder={t(rtl, 'Search name, code, job title or position', 'ابحث بالاسم أو الرقم أو المسمى أو الوظيفة')} role="combobox" aria-expanded={Boolean(query && results.length)} aria-controls="chart-search-results" aria-autocomplete="list"
            onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && results[0]) { reveal(num(results[0].id)); setQuery(''); } if (event.key === 'Escape') setQuery(''); }} /></label>
        {query.trim() && <ul id="chart-search-results" role="listbox" className="chart-search-results">
          {results.map(row => { const role = roleLabels(rtl, catalog, row); return <li key={row.id} role="option" aria-selected="false"><button type="button" onClick={() => { reveal(num(row.id)); setQuery(''); }}><b>{nameOf(row, rtl)}</b><small>{[row.employee_code, role.primary].filter(Boolean).join(' · ')}</small></button></li>; })}
          {!results.length && <li className="muted">{t(rtl, 'No employee in the current view matches', 'لا يوجد موظف مطابق في العرض الحالي')}</li>}
        </ul>}
      </div>
    </div>

    <div className="org-assignment-fields chart-filters">
      {select('company', t(rtl, 'Company', 'الشركة'), options.companies, t(rtl, 'Company not assigned', 'شركة غير محددة'))}
      {select('branch', t(rtl, 'Branch', 'الفرع'), options.branches, t(rtl, 'Branch not assigned', 'فرع غير محدد'))}
      {select('department', t(rtl, 'Department', 'الإدارة'), options.departments)}
      <label>{t(rtl, 'Status', 'الحالة')}<select value={filters.status ?? 'current'} onChange={event => setFilter('status', event.target.value)}>
        <option value="current">{t(rtl, 'Current employees', 'الموظفون الحاليون')}</option><option value="all">{t(rtl, 'All statuses', 'كل الحالات')}</option>
        {options.statuses.map(status => <option key={status} value={status}>{statusLabel(rtl, status)}</option>)}
      </select></label>
    </div>

    <div className="org-control-row chart-actions">
      <button type="button" className="outline" onClick={expandAll} disabled={tooLarge} title={tooLarge ? t(rtl, 'Too many employees to expand at once — use filters or search', 'عدد كبير جدًا للتوسيع دفعة واحدة — استخدم التصفية أو البحث') : undefined}>{t(rtl, 'Expand all', 'توسيع الكل')}</button>
      <button type="button" className="outline" onClick={collapseAll}>{t(rtl, 'Collapse all', 'طي الكل')}</button>
      {view === 'reporting' && <div className="chart-segment small" role="group" aria-label={t(rtl, 'Layout', 'طريقة العرض')}>
        <button type="button" aria-pressed={!listLayout} className={!listLayout ? 'active' : ''} onClick={() => setLayout('tree')}>{t(rtl, 'Tree', 'شجرة')}</button>
        <button type="button" aria-pressed={listLayout} className={listLayout ? 'active' : ''} onClick={() => setLayout('list')}>{t(rtl, 'List', 'قائمة')}</button>
      </div>}
      {view === 'reporting' && !listLayout && <>
        <button type="button" className="outline" aria-label={t(rtl, 'Zoom out', 'تصغير')} onClick={() => setScale(v => Math.max(.35, v - .1))}><Minus /></button><span>{Math.round(scale * 100)}%</span>
        <button type="button" className="outline" aria-label={t(rtl, 'Zoom in', 'تكبير')} onClick={() => setScale(v => Math.min(2, v + .1))}><Plus /></button>
        <button type="button" className="outline" onClick={fit}><RotateCcw />{t(rtl, 'Fit', 'ملاءمة')}</button>
        <button type="button" className="outline" onClick={center}><Crosshair />{t(rtl, 'Center', 'توسيط')}</button>
        <button type="button" className="outline" onClick={print}><Printer />{t(rtl, 'Print', 'طباعة')}</button>
      </>}
      {view === 'organization' && fullAccess && <label className="chart-check"><input type="checkbox" checked={showEmpty} onChange={event => setShowEmpty(event.target.checked)} />{t(rtl, 'Show empty units', 'إظهار الوحدات الفارغة')}</label>}
      <span className="chart-readonly"><Info size={14} />{t(rtl, 'Read-only: edit assignments in the Employee Profile or Settings', 'للعرض فقط: عدّل التعيينات من ملف الموظف أو الإعدادات')}</span>
    </div>

    {reviewOpen && <NeedsReviewPanel rtl={rtl} catalog={catalog} diagnostics={diagnostics} pool={pool} matchIds={reporting.matchIds} openProfile={id => { const row = pool.find(r => num(r.id) === id); if (row) openProfile(row); }} reveal={id => reveal(id)} />}

    {view === 'reporting' ? <div className={`reporting-canvas ${listLayout ? 'list' : ''}`} ref={canvas}><div className="reporting-content" ref={content} style={listLayout ? undefined : { zoom: scale }}>
      {reporting.groups.map(group => <section key={group.key} className="reporting-company">
        <h2>{group.companyId ? recordLabel(rtl, catalog.companies, group.companyId).text : t(rtl, 'Unassigned company', 'شركة غير محددة')}<small>{group.matchCount} {t(rtl, 'employees', 'موظف')}</small></h2>
        {listLayout ? <ReportingList roots={group.roots} ctx={ctx} /> : <ul className="reporting-roots">{group.roots.map(root => <li key={root.id}><ReportingBranch node={root} depth={0} ctx={ctx} /></li>)}</ul>}
      </section>)}
      {!reporting.groups.length && <p className="chart-empty">{t(rtl, 'No employees match the current filters.', 'لا يوجد موظفون مطابقون لعوامل التصفية الحالية.')}</p>}
    </div></div>
      : <div className="unit-canvas">{organization && organization.roots.length ? <ul className="unit-tree">{organization.roots.map(root => <UnitBranch key={root.key} node={root} depth={0} ctx={unitCtx} />)}</ul> : <p className="chart-empty">{t(rtl, 'No employees match the current filters.', 'لا يوجد موظفون مطابقون لعوامل التصفية الحالية.')}</p>}</div>}

    {quick && <QuickView rtl={rtl} catalog={catalog} employee={quick} pool={pool} fullAccess={fullAccess} issues={diagnostics.get(num(quick.id)) ?? []} canEdit={canEdit}
      close={() => setQuickId(null)} openProfile={() => openProfile(quick)} editProfile={() => editProfile(quick)} showManager={id => setQuickId(id)} reveal={() => reveal(num(quick.id), false)} />}
  </section>;
}
