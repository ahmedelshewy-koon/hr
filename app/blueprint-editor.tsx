"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Building2, CheckCircle2, ChevronDown, ChevronUp, Copy, GitBranch, Network, Pencil, Plus, Rocket, RotateCcw, Save, Trash2, UsersRound, X, ZoomIn, ZoomOut, Archive, Users } from 'lucide-react';
import { SENIORITY_LEVELS, buildHierarchy, departmentSubtreeIds, type BpDepartment, type HierarchyNode, type UnitKind } from './blueprint/policy';
import type { ApplyPlan } from './blueprint/policy';
import { Field, StatusPill, blueprintApi, makeFmt, pick, seniorityLabel, sizeLabel, typeName, type BlueprintDetail, type Notify, type Overview } from './blueprint/client';
import './blueprint.css';

type Panel = { kind: 'position'; id: number | null; departmentId: number | null } | { kind: 'unit'; id: number | null; parentId: number | null } | { kind: 'meta' } | null;

export function BlueprintEditor({ id, overview, rtl, notify, close, open, reload }: { id: number; overview: Overview; rtl: boolean; notify: Notify; close: () => void; open: (id: number) => void; reload: () => Promise<void> }) {
  const t = (ar: string, en: string) => (rtl ? ar : en);
  const fmt = makeFmt(rtl);
  const [detail, setDetail] = useState<BlueprintDetail | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'tree' | 'table'>('tree');
  const [zoom, setZoom] = useState(1);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<Panel>(null);
  const [applying, setApplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null), fitted = useRef(false);

  const load = useCallback(async () => {
    try { setDetail(await blueprintApi(`/api/blueprint?id=${id}`, undefined, rtl) as BlueprintDetail); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [id, rtl]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  /** Shrinks the chart until it fits the canvas width (never below 40%; the first automatic fit stops at 60% so text stays readable), then centres it on the company box. */
  const fit = useCallback((floor = 0.4) => {
    setZoom(1);
    window.requestAnimationFrame(() => { const el = scroller.current, inner = el?.querySelector<HTMLElement>('.bp-tree'); if (el && inner) setZoom(Math.max(floor, Math.min(1, +((el.clientWidth - 24) / inner.scrollWidth).toFixed(2)))); });
  }, []);
  useEffect(() => { if (detail && !fitted.current) { fitted.current = true; const timer = window.setTimeout(() => fit(0.6), 0); return () => window.clearTimeout(timer); } }, [detail, fit]);
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2); }, [view, zoom, collapsed, detail?.blueprint.id]);

  const blueprint = detail?.blueprint, tree = detail?.tree, access = detail?.access ?? overview.access;
  const isTemplate = blueprint?.kind === 'template';
  const editable = Boolean(blueprint && (isTemplate ? access.canManageLibrary : access.canEdit && blueprint.status === 'draft'));
  const company = blueprint?.companyId ? overview.companies.find(c => c.id === blueprint.companyId) : undefined;
  const hierarchy = useMemo(() => (tree && blueprint ? buildHierarchy(tree, company?.name ?? blueprint.name) : null), [tree, blueprint, company]);

  const act = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    try { const result = await blueprintApi('/api/blueprint', { body }, rtl); await load(); await reload(); notify(success); return result; }
    catch (cause) { notify(cause instanceof Error ? cause.message : String(cause)); return null; } finally { setBusy(false); }
  };
  const toggle = (key: string) => setCollapsed(current => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next; });

  if (error && !detail) return <div className="bp"><button className="outline" onClick={close}><ArrowLeft size={16} className="bp-flip" />{t('رجوع', 'Back')}</button><p className="error-banner" role="alert">{error}</p></div>;
  if (!detail || !blueprint || !tree || !hierarchy) return <div className="bp"><p role="status">{t('جارٍ التحميل…', 'Loading…')}</p></div>;

  const totalPeople = tree.positions.reduce((s, p) => s + p.headcount, 0);
  const unitById = new Map(tree.departments.map(d => [d.id, d]));
  const unitPath = (departmentId: number) => { const out: string[] = []; for (let c = unitById.get(departmentId), n = 0; c && n < 8; c = c.parentId ? unitById.get(c.parentId) : undefined, n++) out.unshift(pick(c.name, rtl)); return out.join(' › '); };
  const childKindFor = (parent: BpDepartment): UnitKind | null => (parent.kind === 'department' ? 'section' : parent.kind === 'section' ? 'team' : null);

  const renderPosition = (node: HierarchyNode): React.ReactNode => {
    const p = node.position!;
    return <li key={node.key} className="bp-pos-item">
      <div className={`bp-pos ${p.required ? '' : 'bp-optional'}`}>
        <button className="bp-pos-main" onClick={() => setPanel({ kind: 'position', id: p.id, departmentId: p.departmentId })}>
          <b>{pick(p.title, rtl)}</b><span className="bp-count" aria-label={t('العدد المقترح', 'Recommended headcount')}>×{fmt(p.headcount)}</span>
        </button>
        <small>{seniorityLabel(p.seniority, rtl)} · {p.required ? t('مطلوبة', 'Required') : t('اختيارية', 'Optional')}{p.perBranch ? ` · ${t('لكل فرع', 'per branch')}` : ''}</small>
        {node.reportsTo && <small className="bp-reports">{t('يتبع', 'Reports to')}: {pick(node.reportsTo, rtl)}</small>}
      </div>
      {node.children.length > 0 && <ul className="bp-pos-list">{node.children.map(renderPosition)}</ul>}
    </li>;
  };

  const renderBox = (node: HierarchyNode): React.ReactNode => {
    const isRoot = node.level === 'company', unit = node.department;
    const positions = node.children.filter(c => c.level === 'position'), subs = node.children.filter(c => c.level !== 'position');
    const closed = collapsed.has(node.key);
    const Icon = isRoot ? Building2 : node.level === 'department' ? Network : GitBranch;
    return <li key={node.key} className="bp-node">
      <div className={`bp-box bp-${node.level}${unit && !unit.required ? ' bp-optional' : ''}`} dir={rtl ? 'rtl' : 'ltr'}>
        <div className="bp-head">
          <span className="bp-icon" aria-hidden="true"><Icon size={16} /></span>
          <b>{pick(node.label, rtl)}</b>
          {subs.length > 0 && <button className="bp-toggle" aria-expanded={!closed} aria-label={`${closed ? t('توسيع', 'Expand') : t('طي', 'Collapse')} ${pick(node.label, rtl)}`} onClick={() => toggle(node.key)}>{closed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}<span>{fmt(subs.length)}</span></button>}
        </div>
        <div className="bp-sum"><span><Users size={13} aria-hidden="true" />{fmt(node.headcount)} {t('موظف مقترح', 'suggested')}</span><span>{fmt(node.positionCount)} {t('وظيفة', 'positions')}</span>{unit && !unit.required && <span className="bp-tag">{t('اختيارية', 'Optional')}</span>}</div>
        {editable && <div className="bp-tools">
          {isRoot ? <button className="outline" onClick={() => setPanel({ kind: 'unit', id: null, parentId: null })}><Plus size={14} />{t('إدارة', 'Department')}</button>
            : <><button className="outline" onClick={() => setPanel({ kind: 'position', id: null, departmentId: unit!.id })}><Plus size={14} />{t('وظيفة', 'Position')}</button>
              {childKindFor(unit!) && <button className="outline" onClick={() => setPanel({ kind: 'unit', id: null, parentId: unit!.id })}><Plus size={14} />{childKindFor(unit!) === 'section' ? t('قسم فرعي', 'Section') : t('فريق', 'Team')}</button>}
              <button className="icon-btn" onClick={() => setPanel({ kind: 'unit', id: unit!.id, parentId: unit!.parentId })} aria-label={t('تعديل', 'Edit')}><Pencil size={14} /></button>
              <button className="icon-btn" onClick={() => void removeUnit(unit!)} aria-label={t('حذف', 'Remove')}><Trash2 size={14} /></button></>}
        </div>}
        {positions.length > 0 && <ul className="bp-pos-list">{positions.map(renderPosition)}</ul>}
      </div>
      {subs.length > 0 && !closed && <ul className="bp-children">{subs.map(renderBox)}</ul>}
    </li>;
  };

  const removeUnit = async (unit: BpDepartment) => {
    const count = departmentSubtreeIds(tree, unit.id).size - 1, people = tree.positions.filter(p => departmentSubtreeIds(tree, unit.id).has(p.departmentId)).length;
    if (!window.confirm(t(`حذف «${pick(unit.name, rtl)}» مع ${people} وظيفة${count ? ` و${count} وحدة فرعية` : ''}؟`, `Remove “${pick(unit.name, rtl)}” with ${people} position(s)${count ? ` and ${count} sub-unit(s)` : ''}?`))) return;
    await act({ action: 'removeDepartment', blueprintId: id, departmentId: unit.id }, t('تم حذف الوحدة', 'Unit removed'));
  };

  return <div className="bp">
    <header className="bp-bar">
      <button className="outline" onClick={close}><ArrowLeft size={16} className="bp-flip" />{t('رجوع', 'Back')}</button>
      <div className="bp-title"><h2>{pick(blueprint.name, rtl)}</h2>
        <p><StatusPill status={blueprint.status} rtl={rtl} /> {typeName(overview.types, blueprint.companyTypeId, rtl)} · {sizeLabel(blueprint.size, rtl)}{company ? ` · ${pick(company.name, rtl)}` : ''}{isTemplate ? ` · ${t('قالب', 'Template')}` : ''}</p></div>
      <div className="bp-actions">
        <button className="outline" onClick={() => setPanel({ kind: 'meta' })}><Pencil size={15} />{t('البيانات', 'Details')}</button>
        {(isTemplate ? access.canManageLibrary : access.canGenerate) && <button className="outline" disabled={busy} onClick={async () => { const r = await act({ action: 'duplicate', blueprintId: id }, t('تم إنشاء نسخة كمسودة', 'Copy created as a draft')); if (r?.id) open(Number(r.id)); }}><Copy size={15} />{t('نسخ', 'Duplicate')}</button>}
        {isTemplate && access.canManageLibrary && (blueprint.status === 'active'
          ? <button className="outline" disabled={busy} onClick={() => void act({ action: 'templateStatus', blueprintId: id, to: 'archive' }, t('تمت الأرشفة', 'Archived'))}><Archive size={15} />{t('أرشفة', 'Archive')}</button>
          : <button className="primary" disabled={busy} onClick={() => void act({ action: 'templateStatus', blueprintId: id, to: 'activate' }, t('تم التفعيل', 'Activated'))}><CheckCircle2 size={15} />{t('تفعيل', 'Activate')}</button>)}
        {!isTemplate && blueprint.status === 'draft' && access.canEdit && <button className="primary" disabled={busy} onClick={() => void act({ action: 'blueprintStatus', blueprintId: id, to: 'approve' }, t('تم اعتماد المخطط', 'Blueprint approved'))}><CheckCircle2 size={15} />{t('اعتماد', 'Approve')}</button>}
        {!isTemplate && blueprint.status === 'approved' && access.canEdit && <button className="outline" disabled={busy} onClick={() => void act({ action: 'blueprintStatus', blueprintId: id, to: 'reopen' }, t('أُعيد إلى مسودة', 'Reopened as a draft'))}><RotateCcw size={15} />{t('إعادة للتعديل', 'Reopen')}</button>}
        {!isTemplate && blueprint.status === 'approved' && access.canApply && <button className="primary" disabled={!blueprint.companyId} title={!blueprint.companyId ? t('اربط المخطط بشركة أولًا', 'Choose the company first') : undefined} onClick={() => setApplying(true)}><Rocket size={15} />{t('تطبيق الهيكل على الشركة', 'Apply Structure to Company')}</button>}
        {!isTemplate && blueprint.status !== 'archived' && blueprint.status !== 'applied' && access.canArchive && <button className="outline" disabled={busy} onClick={() => { if (window.confirm(t('أرشفة هذا المخطط؟', 'Archive this blueprint?'))) void act({ action: 'blueprintStatus', blueprintId: id, to: 'archive' }, t('تمت الأرشفة', 'Archived')); }}><Archive size={15} />{t('أرشفة', 'Archive')}</button>}
      </div>
    </header>
    {!editable && <p className="bp-callout bp-note">{isTemplate ? t('هذا القالب للقراءة فقط؛ يديره مدير النظام.', 'This template is read-only; the Super Admin manages the library.') : blueprint.status === 'applied' ? t('تم تطبيق هذا المخطط على الشركة ولا يمكن تعديله.', 'This blueprint was applied to the company and cannot be edited.') : blueprint.status === 'approved' ? t('المخطط معتمد. أعده إلى مسودة لتعديله.', 'This blueprint is approved. Reopen it to edit.') : t('عرض فقط.', 'View only.')}</p>}
    <p className="bp-recommend">{t('هذه توصيات للتخصيص وليست متطلبات إلزامية.', 'These are recommendations to customise, not mandatory requirements.')}</p>
    <div className="bp-kpis"><span><b>{fmt(tree.departments.filter(d => d.parentId === null).length)}</b>{t('إدارات', 'departments')}</span><span><b>{fmt(tree.positions.length)}</b>{t('وظائف', 'positions')}</span><span><b>{fmt(totalPeople)}</b>{t('إجمالي العدد المقترح', 'suggested headcount')}</span>
      {blueprint.expectedEmployees && <span><b>{fmt(blueprint.expectedEmployees)}</b>{t('العدد المتوقع', 'expected employees')}</span>}{blueprint.branchesCount && <span><b>{fmt(blueprint.branchesCount)}</b>{t('فروع', 'branches')}</span>}</div>
    <div className="bp-toolbar">
      <div className="bp-switch" role="group" aria-label={t('طريقة العرض', 'View')}><button className={view === 'tree' ? 'active' : ''} onClick={() => setView('tree')}>{t('الهيكل', 'Hierarchy')}</button><button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>{t('جدول', 'Table')}</button></div>
      {view === 'tree' && <div className="bp-zoom"><button className="icon-btn" onClick={() => setZoom(z => Math.max(0.5, +(z - 0.1).toFixed(1)))} aria-label={t('تصغير', 'Zoom out')}><ZoomOut size={16} /></button><span>{Math.round(zoom * 100)}%</span><button className="icon-btn" onClick={() => setZoom(z => Math.min(1.5, +(z + 0.1).toFixed(1)))} aria-label={t('تكبير', 'Zoom in')}><ZoomIn size={16} /></button>
        <button className="outline" onClick={() => fit()}>{t('ملاءمة العرض', 'Fit to screen')}</button><button className="outline" onClick={() => setCollapsed(new Set())}>{t('توسيع الكل', 'Expand all')}</button><button className="outline" onClick={() => setCollapsed(new Set(hierarchy.children.map(c => c.key)))}>{t('طي الكل', 'Collapse all')}</button></div>}
    </div>
    {view === 'tree'
      ? <div className="bp-scroll" ref={scroller}><div className="bp-zoomed" style={{ zoom }}><ul className="bp-tree">{renderBox(hierarchy)}</ul></div></div>
      : <div className="panel bp-table-panel"><div className="bp-scroll-x"><table className="bp-table">
        <thead><tr><th>{t('الإدارة / الوحدة', 'Department / unit')}</th><th>{t('الوظيفة', 'Position')}</th><th className="num">{t('العدد', 'Headcount')}</th><th>{t('المستوى', 'Seniority')}</th><th>{t('يتبع', 'Reports to')}</th><th>{t('الحالة', 'Type')}</th></tr></thead>
        <tbody>{tree.positions.map(p => <tr key={p.id} tabIndex={0} onClick={() => setPanel({ kind: 'position', id: p.id, departmentId: p.departmentId })} onKeyDown={e => { if (e.key === 'Enter') setPanel({ kind: 'position', id: p.id, departmentId: p.departmentId }); }}>
          <td>{unitPath(p.departmentId)}</td><td><b>{pick(p.title, rtl)}</b></td><td className="num">{fmt(p.headcount)}</td><td>{seniorityLabel(p.seniority, rtl)}</td><td>{p.parentPositionId ? pick(tree.positions.find(x => x.id === p.parentPositionId)?.title, rtl) : '—'}</td><td>{p.required ? t('مطلوبة', 'Required') : t('اختيارية', 'Optional')}</td></tr>)}</tbody></table></div></div>}
    {panel?.kind === 'position' && <PositionPanel key={`${panel.id}:${panel.departmentId}`} panel={panel} tree={tree} rtl={rtl} editable={editable} close={() => setPanel(null)} unitPath={unitPath}
      save={async record => { const r = await act({ action: 'savePosition', blueprintId: id, positionId: panel.id, record }, t('تم حفظ الوظيفة', 'Position saved')); if (r) setPanel(null); return Boolean(r); }}
      remove={async () => { if (!panel.id || !window.confirm(t('حذف هذه الوظيفة؟ الوظائف التابعة لها تصبح بلا مدير مباشر.', 'Remove this position? Positions that report to it become top-level.'))) return; const r = await act({ action: 'removePosition', blueprintId: id, positionId: panel.id }, t('تم حذف الوظيفة', 'Position removed')); if (r) setPanel(null); }} />}
    {panel?.kind === 'unit' && <UnitPanel key={`${panel.id}:${panel.parentId}`} panel={panel} tree={tree} rtl={rtl} close={() => setPanel(null)} save={async record => { const r = await act({ action: 'saveDepartment', blueprintId: id, departmentId: panel.id, record }, t('تم حفظ الوحدة', 'Unit saved')); if (r) setPanel(null); return Boolean(r); }} />}
    {panel?.kind === 'meta' && <MetaPanel blueprint={blueprint} overview={overview} rtl={rtl} editable={isTemplate ? access.canManageLibrary : access.canEdit && blueprint.status === 'draft'} close={() => setPanel(null)}
      save={async record => { const r = await act({ action: isTemplate ? 'updateTemplate' : 'updateBlueprint', blueprintId: id, record }, t('تم الحفظ', 'Saved')); if (r) setPanel(null); return Boolean(r); }} />}
    {applying && <ApplyDialog id={id} rtl={rtl} close={() => setApplying(false)} done={async summary => { setApplying(false); await load(); await reload(); notify(t(`تم التطبيق: ${summary.created.units} وحدة و${summary.created.titles} مسمى وظيفي جديد`, `Applied: ${summary.created.units} unit(s) and ${summary.created.titles} job title(s) created`)); }} />}
  </div>;
}

type Summary = { created: { units: number; titles: number }; reused: { units: number; titles: number } };

function PositionPanel({ panel, tree, rtl, editable, close, save, remove, unitPath }: { panel: Extract<Panel, { kind: 'position' }>; tree: NonNullable<BlueprintDetail['tree']>; rtl: boolean; editable: boolean; close: () => void; save: (record: Record<string, unknown>) => Promise<boolean>; remove: () => Promise<void>; unitPath: (id: number) => string }) {
  const t = (ar: string, en: string) => (rtl ? ar : en);
  const existing = panel.id ? tree.positions.find(p => p.id === panel.id) : undefined;
  const [form, setForm] = useState({
    titleEn: existing?.title.en ?? '', titleAr: existing?.title.ar ?? '', departmentId: String(existing?.departmentId ?? panel.departmentId ?? ''), parentPositionId: String(existing?.parentPositionId ?? ''),
    headcount: String(existing?.headcount ?? 1), seniority: existing?.seniority ?? 'mid', required: existing?.required ?? true, perBranch: existing?.perBranch ?? false, descriptionEn: existing?.description?.en ?? '', descriptionAr: existing?.description?.ar ?? '',
  });
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  // A position cannot report to itself or to anything beneath it.
  const below = new Set<number>(); if (existing) { const stack = [existing.id]; while (stack.length) { const c = stack.pop()!; if (below.has(c)) continue; below.add(c); for (const p of tree.positions) if (p.parentPositionId === c) stack.push(p.id); } }
  const managers = tree.positions.filter(p => !below.has(p.id));
  const submit = async () => { setSaving(true); setError(''); try { const ok = await save({ ...form, headcount: form.headcount, departmentId: Number(form.departmentId) || null, parentPositionId: form.parentPositionId || null }); if (!ok) setSaving(false); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setSaving(false); } };
  return <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <aside className="drawer bp-drawer" role="dialog" aria-modal="true" aria-label={t('تفاصيل الوظيفة', 'Position details')}>
      <header className="bp-drawer-head"><div><span className="eyebrow">{t('وظيفة', 'Position')}</span><h2>{existing ? (rtl ? existing.title.ar : existing.title.en) : t('وظيفة جديدة', 'New position')}</h2>{existing && <p>{unitPath(existing.departmentId)}</p>}</div><button className="icon-button" onClick={close} aria-label={t('إغلاق', 'Close')}><X size={20} /></button></header>
      <form className="bp-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <fieldset disabled={!editable || saving}>
          <Field label={t('المسمى (إنجليزي)', 'Title (English)')}><input value={form.titleEn} maxLength={200} onChange={e => setForm({ ...form, titleEn: e.target.value })} required={!form.titleAr} /></Field>
          <Field label={t('المسمى (عربي)', 'Title (Arabic)')}><input value={form.titleAr} maxLength={200} dir="rtl" onChange={e => setForm({ ...form, titleAr: e.target.value })} required={!form.titleEn} /></Field>
          <Field label={t('الإدارة / الوحدة', 'Department / unit')}><select value={form.departmentId} required onChange={e => setForm({ ...form, departmentId: e.target.value })}><option value="">{t('اختر', 'Select')}</option>{tree.departments.map(d => <option key={d.id} value={d.id}>{unitPath(d.id)}</option>)}</select></Field>
          <Field label={t('يتبع (المدير المباشر)', 'Reports to')}><select value={form.parentPositionId} onChange={e => setForm({ ...form, parentPositionId: e.target.value })}><option value="">{t('لا أحد (أعلى المستوى)', 'Nobody (top of the unit)')}</option>{managers.map(p => <option key={p.id} value={p.id}>{rtl ? p.title.ar : p.title.en} — {unitPath(p.departmentId)}</option>)}</select></Field>
          <Field label={t('العدد المقترح', 'Recommended headcount')}><input type="number" min={0} max={10000} step={1} value={form.headcount} required onChange={e => setForm({ ...form, headcount: e.target.value })} /></Field>
          <Field label={t('المستوى الوظيفي', 'Seniority')}><select value={form.seniority} onChange={e => setForm({ ...form, seniority: e.target.value as typeof form.seniority })}>{SENIORITY_LEVELS.map(l => <option key={l} value={l}>{seniorityLabel(l, rtl)}</option>)}</select></Field>
          <label className="bp-check"><input type="checkbox" checked={form.required} onChange={e => setForm({ ...form, required: e.target.checked })} />{t('وظيفة مطلوبة (وإلا فهي اختيارية)', 'Required position (otherwise optional)')}</label>
          <label className="bp-check"><input type="checkbox" checked={form.perBranch} onChange={e => setForm({ ...form, perBranch: e.target.checked })} />{t('يتكرر العدد لكل فرع', 'Headcount repeats for each branch')}</label>
          <Field label={t('وصف مختصر (إنجليزي)', 'Short description (English)')} wide><textarea rows={2} maxLength={600} value={form.descriptionEn} onChange={e => setForm({ ...form, descriptionEn: e.target.value })} /></Field>
          <Field label={t('وصف مختصر (عربي)', 'Short description (Arabic)')} wide><textarea rows={2} dir="rtl" maxLength={600} value={form.descriptionAr} onChange={e => setForm({ ...form, descriptionAr: e.target.value })} /></Field>
        </fieldset>
        {editable ? <div className="bp-form-actions"><button className="primary" disabled={saving}><Save size={16} />{saving ? t('جارٍ الحفظ…', 'Saving…') : t('حفظ', 'Save')}</button>{existing && <button type="button" className="outline bp-danger" disabled={saving} onClick={() => void remove()}><Trash2 size={16} />{t('حذف', 'Remove')}</button>}</div>
          : <p className="bp-muted">{t('للقراءة فقط.', 'Read only.')}</p>}
      </form></aside></div>;
}

function UnitPanel({ panel, tree, rtl, close, save }: { panel: Extract<Panel, { kind: 'unit' }>; tree: NonNullable<BlueprintDetail['tree']>; rtl: boolean; close: () => void; save: (record: Record<string, unknown>) => Promise<boolean> }) {
  const t = (ar: string, en: string) => (rtl ? ar : en);
  const existing = panel.id ? tree.departments.find(d => d.id === panel.id) : undefined;
  const parent = tree.departments.find(d => d.id === (panel.parentId ?? existing?.parentId ?? -1));
  const defaultKind: UnitKind = existing?.kind ?? (parent ? (parent.kind === 'department' ? 'section' : 'team') : 'department');
  const [form, setForm] = useState({ nameEn: existing?.name.en ?? '', nameAr: existing?.name.ar ?? '', kind: defaultKind, parentId: String(panel.parentId ?? existing?.parentId ?? ''), required: existing?.required ?? true });
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const submit = async () => { setSaving(true); setError(''); try { const ok = await save({ ...form, parentId: form.kind === 'department' ? null : form.parentId || null }); if (!ok) setSaving(false); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setSaving(false); } };
  const blockedParents = existing ? departmentSubtreeIds(tree, existing.id) : new Set<number>();
  const parentOptions = tree.departments.filter(d => !blockedParents.has(d.id) && (form.kind === 'section' ? d.kind === 'department' : form.kind === 'team' ? d.kind !== 'team' : false));
  return <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <aside className="drawer bp-drawer narrow" role="dialog" aria-modal="true">
      <header className="bp-drawer-head"><div><span className="eyebrow">{t('وحدة تنظيمية', 'Organizational unit')}</span><h2>{existing ? (rtl ? existing.name.ar : existing.name.en) : t('وحدة جديدة', 'New unit')}</h2></div><button className="icon-button" onClick={close} aria-label={t('إغلاق', 'Close')}><X size={20} /></button></header>
      <form className="bp-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <fieldset disabled={saving}>
          <Field label={t('الاسم (إنجليزي)', 'Name (English)')}><input value={form.nameEn} maxLength={200} onChange={e => setForm({ ...form, nameEn: e.target.value })} required={!form.nameAr} /></Field>
          <Field label={t('الاسم (عربي)', 'Name (Arabic)')}><input value={form.nameAr} dir="rtl" maxLength={200} onChange={e => setForm({ ...form, nameAr: e.target.value })} required={!form.nameEn} /></Field>
          <Field label={t('النوع', 'Type')}><select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as UnitKind, parentId: '' })}><option value="department">{t('إدارة', 'Department')}</option><option value="section">{t('قسم فرعي', 'Section')}</option><option value="team">{t('فريق', 'Team')}</option></select></Field>
          {form.kind !== 'department' && <Field label={t('تتبع', 'Belongs to')}><select value={form.parentId} required onChange={e => setForm({ ...form, parentId: e.target.value })}><option value="">{t('اختر', 'Select')}</option>{parentOptions.map(d => <option key={d.id} value={d.id}>{rtl ? d.name.ar : d.name.en}</option>)}</select></Field>}
          <label className="bp-check"><input type="checkbox" checked={form.required} onChange={e => setForm({ ...form, required: e.target.checked })} />{t('وحدة مطلوبة (وإلا فهي اختيارية)', 'Required unit (otherwise optional)')}</label>
        </fieldset>
        <div className="bp-form-actions"><button className="primary" disabled={saving}><Save size={16} />{t('حفظ', 'Save')}</button></div>
      </form></aside></div>;
}

function MetaPanel({ blueprint, overview, rtl, editable, close, save }: { blueprint: BlueprintDetail['blueprint']; overview: Overview; rtl: boolean; editable: boolean; close: () => void; save: (record: Record<string, unknown>) => Promise<boolean> }) {
  const t = (ar: string, en: string) => (rtl ? ar : en);
  const [form, setForm] = useState({ nameEn: blueprint.name.en, nameAr: blueprint.name.ar, companyId: String(blueprint.companyId ?? ''), descriptionEn: blueprint.description?.en ?? '', descriptionAr: blueprint.description?.ar ?? '' });
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const submit = async () => { setSaving(true); setError(''); try { const ok = await save(blueprint.kind === 'company' ? { nameEn: form.nameEn, nameAr: form.nameAr, companyId: form.companyId || null } : { nameEn: form.nameEn, nameAr: form.nameAr, descriptionEn: form.descriptionEn, descriptionAr: form.descriptionAr }); if (!ok) setSaving(false); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setSaving(false); } };
  return <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <aside className="drawer bp-drawer narrow" role="dialog" aria-modal="true">
      <header className="bp-drawer-head"><div><span className="eyebrow">{t('بيانات المخطط', 'Blueprint details')}</span><h2>{pick(blueprint.name, rtl)}</h2></div><button className="icon-button" onClick={close} aria-label={t('إغلاق', 'Close')}><X size={20} /></button></header>
      <form className="bp-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <fieldset disabled={!editable || saving}>
          <Field label={t('الاسم (إنجليزي)', 'Name (English)')}><input value={form.nameEn} onChange={e => setForm({ ...form, nameEn: e.target.value })} /></Field>
          <Field label={t('الاسم (عربي)', 'Name (Arabic)')}><input value={form.nameAr} dir="rtl" onChange={e => setForm({ ...form, nameAr: e.target.value })} /></Field>
          {blueprint.kind === 'company' && <Field label={t('الشركة', 'Company')} hint={t('تُنشأ الوحدات والمسميات في هذه الشركة عند التطبيق.', 'Units and job titles are created in this company when you apply.')}><select value={form.companyId} onChange={e => setForm({ ...form, companyId: e.target.value })}><option value="">{t('أختار لاحقًا', 'Choose later')}</option>{overview.companies.filter(c => c.status === 'active').map(c => <option key={c.id} value={c.id}>{pick(c.name, rtl)}</option>)}</select></Field>}
          {blueprint.kind === 'template' && <><Field label={t('الوصف (إنجليزي)', 'Description (English)')} wide><textarea rows={2} value={form.descriptionEn} onChange={e => setForm({ ...form, descriptionEn: e.target.value })} /></Field><Field label={t('الوصف (عربي)', 'Description (Arabic)')} wide><textarea rows={2} dir="rtl" value={form.descriptionAr} onChange={e => setForm({ ...form, descriptionAr: e.target.value })} /></Field></>}
        </fieldset>
        {blueprint.kind === 'company' && <dl className="bp-meta"><dt>{t('العدد المتوقع', 'Expected employees')}</dt><dd>{blueprint.expectedEmployees ?? '—'}</dd><dt>{t('الفروع', 'Branches')}</dt><dd>{blueprint.branchesCount ?? '—'}</dd><dt>{t('الدولة', 'Country')}</dt><dd>{blueprint.country ?? '—'}</dd><dt>{t('نموذج العمل', 'Business model')}</dt><dd>{blueprint.businessModel ?? '—'}</dd></dl>}
        {editable && <div className="bp-form-actions"><button className="primary" disabled={saving}><Save size={16} />{t('حفظ', 'Save')}</button></div>}
      </form></aside></div>;
}

function ApplyDialog({ id, rtl, close, done }: { id: number; rtl: boolean; close: () => void; done: (summary: Summary) => Promise<void> }) {
  const t = (ar: string, en: string) => (rtl ? ar : en);
  const fmt = makeFmt(rtl);
  const [preview, setPreview] = useState<{ plan: ApplyPlan } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
  useEffect(() => { let off = false; blueprintApi(`/api/blueprint?preview=${id}`, undefined, rtl).then(body => { if (!off) setPreview(body); }).catch(cause => { if (!off) setError(cause instanceof Error ? cause.message : String(cause)); }); return () => { off = true; }; }, [id, rtl]);
  const plan = preview?.plan;
  const apply = async () => { setBusy(true); setError(''); try { const result = await blueprintApi('/api/blueprint', { body: { action: 'apply', blueprintId: id, confirmExisting: confirmed } }, rtl); await done(result as Summary); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } };
  return <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <aside className="drawer bp-drawer wide" role="dialog" aria-modal="true" aria-label={t('معاينة التطبيق', 'Apply preview')}>
      <header className="bp-drawer-head"><div><span className="eyebrow">{t('قبل التطبيق', 'Before applying')}</span><h2>{t('تطبيق الهيكل على الشركة', 'Apply Structure to Company')}</h2></div><button className="icon-button" onClick={close} aria-label={t('إغلاق', 'Close')}><X size={20} /></button></header>
      <div className="bp-form">
        {error && <p className="error-banner" role="alert">{error}</p>}
        {!plan && !error && <p role="status">{t('جارٍ إعداد المعاينة…', 'Preparing the preview…')}</p>}
        {plan && <>
          <div className="bp-kpis"><span><b>{fmt(plan.counts.unitsToCreate)}</b>{t('وحدات ستُنشأ', 'units to create')}</span><span><b>{fmt(plan.counts.titlesToCreate)}</b>{t('مسميات وظيفية ستُنشأ', 'job titles to create')}</span><span><b>{fmt(plan.counts.unitsReused + plan.counts.titlesReused)}</b>{t('موجودة وسيُعاد استخدامها', 'already exist (reused)')}</span><span><b>{fmt(plan.counts.seats)}</b>{t('مقاعد مقترحة (لا يُنشأ موظفون)', 'suggested seats (no employees created)')}</span></div>
          {plan.hasExistingStructure && <div className="bp-warning" role="alert"><b>{t('الشركة لديها هيكل تنظيمي قائم.', 'This company already has an organizational structure.')}</b><p>{t('لن يُعدَّل أو يُحذف أي شيء موجود؛ ستُضاف العناصر الناقصة فقط، ويُعاد استخدام المتطابق.', 'Nothing existing is changed or deleted; only missing items are added and matching ones are reused.')}</p>
            <label className="bp-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{t('راجعت المعاينة وأؤكد التطبيق على الهيكل القائم', 'I reviewed the preview and confirm applying it to the existing structure')}</label></div>}
          <section><h3>{t('الإدارات والفرق', 'Departments and teams')}</h3><ul className="bp-plan">{plan.units.map(u => <li key={u.departmentId} className={u.action === 'reuse' ? 'reuse' : 'create'}><span className="bp-tag">{u.action === 'reuse' ? t('موجودة', 'Exists') : t('جديدة', 'New')}</span>{pick(u.name, rtl)}<small>{u.kind === 'department' ? t('إدارة', 'Department') : u.kind === 'section' ? t('قسم فرعي', 'Section') : t('فريق', 'Team')}</small></li>)}</ul></section>
          <section><h3>{t('المسميات الوظيفية', 'Job titles')}</h3><ul className="bp-plan">{plan.positions.map(p => <li key={p.positionId} className={p.action === 'reuse' ? 'reuse' : 'create'}><span className="bp-tag">{p.action === 'reuse' ? t('موجود', 'Exists') : t('جديد', 'New')}</span>{pick(p.title, rtl)}<small>×{fmt(p.headcount)}</small></li>)}</ul></section>
          <p className="bp-muted"><UsersRound size={14} aria-hidden="true" /> {t('لا يُنشأ أي موظف ولا تُنقل أي تعيينات.', 'No employees are created and no assignments are changed.')}</p>
          <div className="bp-form-actions"><button className="primary" disabled={busy || (plan.hasExistingStructure && !confirmed)} onClick={() => void apply()}><Rocket size={16} />{busy ? t('جارٍ التطبيق…', 'Applying…') : t('تطبيق الهيكل', 'Apply structure')}</button><button className="outline" onClick={close}>{t('إلغاء', 'Cancel')}</button></div></>}
      </div></aside></div>;
}

