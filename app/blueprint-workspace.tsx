"use client";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Building2, Copy, Layers, Plus, Sparkles, X } from 'lucide-react';
import { BLUEPRINT_SIZES, SIZE_LABELS, type BlueprintSize } from './blueprint/policy';
import { Field, StatusPill, blueprintApi, makeFmt, pick, sizeLabel, typeName, type Notify, type Overview } from './blueprint/client';
import { BlueprintEditor } from './blueprint-editor';
import './blueprint.css';

type Tab = 'blueprints' | 'library';

export function BlueprintWorkspace({ rtl, notify }: { rtl: boolean; notify: Notify }) {
  const t = (ar: string, en: string) => (rtl ? ar : en);
  const fmt = makeFmt(rtl);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('blueprints');
  const [openId, setOpenId] = useState<number | null>(null);
  const [wizard, setWizard] = useState(false);
  const [dialog, setDialog] = useState<'template' | 'type' | null>(null);

  const load = useCallback(async () => {
    try { setOverview(await blueprintApi('/api/blueprint', undefined, rtl) as Overview); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [rtl]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  if (error && !overview) return <div className="bp"><p className="error-banner" role="alert">{error}</p></div>;
  if (!overview) return <div className="bp"><p role="status">{t('جارٍ التحميل…', 'Loading…')}</p></div>;
  if (openId !== null) return <BlueprintEditor key={openId} id={openId} overview={overview} rtl={rtl} notify={notify} close={() => { setOpenId(null); void load(); }} open={setOpenId} reload={load} />;

  const { access } = overview;
  const companyOf = (id: number | null) => pick(overview.companies.find(c => c.id === id)?.name, rtl);
  const duplicate = async (id: number) => {
    try { const r = await blueprintApi('/api/blueprint', { body: { action: 'duplicate', blueprintId: id } }, rtl); await load(); notify(t('تم إنشاء نسخة كمسودة', 'Copy created as a draft')); setOpenId(Number(r.id)); }
    catch (cause) { notify(cause instanceof Error ? cause.message : String(cause)); }
  };
  const archive = async (id: number, kind: 'template' | 'company') => {
    if (!window.confirm(t('أرشفة هذا العنصر؟', 'Archive this item?'))) return;
    try { await blueprintApi('/api/blueprint', { body: kind === 'template' ? { action: 'templateStatus', blueprintId: id, to: 'archive' } : { action: 'blueprintStatus', blueprintId: id, to: 'archive' } }, rtl); await load(); notify(t('تمت الأرشفة', 'Archived')); }
    catch (cause) { notify(cause instanceof Error ? cause.message : String(cause)); }
  };

  return <div className="bp">
    <div className="bp-tabrow"><div className="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'blueprints'} className={tab === 'blueprints' ? 'active' : ''} onClick={() => setTab('blueprints')}><Building2 size={16} />{t('مخططات الشركات', 'Company blueprints')}</button>
      <button role="tab" aria-selected={tab === 'library'} className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}><Layers size={16} />{t('مكتبة القوالب', 'Blueprint library')}</button></div>
      {tab === 'blueprints' && access.canGenerate && <button className="primary" onClick={() => setWizard(true)}><Sparkles size={16} />{t('مخطط جديد', 'New blueprint')}</button>}
      {tab === 'library' && access.canManageLibrary && <span className="bp-actions"><button className="outline" onClick={() => setDialog('type')}><Plus size={16} />{t('نوع شركة', 'Company type')}</button><button className="primary" onClick={() => setDialog('template')}><Plus size={16} />{t('قالب جديد', 'New template')}</button></span>}
    </div>
    <p className="bp-recommend">{t('اقتراحات هيكل الشركة (الإدارات والوظائف والأعداد التقريبية) حسب نوعها وحجمها. هي توصيات قابلة للتخصيص وليست متطلبات.', 'Suggested company structure (departments, positions and approximate headcount) by type and size. These are customisable recommendations, not requirements.')}</p>

    {tab === 'blueprints' && (overview.blueprints.length
      ? <div className="bp-cards">{overview.blueprints.map(b => <article key={b.id} className="panel bp-card">
        <button className="bp-card-main" onClick={() => setOpenId(b.id)}><b>{pick(b.name, rtl)}</b><span>{typeName(overview.types, b.companyTypeId, rtl)} · {sizeLabel(b.size, rtl)}</span><span>{b.companyId ? companyOf(b.companyId) : t('لم تُحدد الشركة بعد', 'No company yet')}</span></button>
        <div className="bp-card-foot"><StatusPill status={b.status} rtl={rtl} /><small>{fmt(b.departmentCount)} {t('وحدة', 'units')} · {fmt(b.positionCount)} {t('وظيفة', 'positions')} · {fmt(b.headcount)} {t('موظف مقترح', 'suggested')}</small>
          <span className="bp-actions">{access.canGenerate && <button className="icon-btn" onClick={() => void duplicate(b.id)} aria-label={t('نسخ', 'Duplicate')}><Copy size={15} /></button>}{access.canArchive && b.status !== 'archived' && b.status !== 'applied' && <button className="icon-btn" onClick={() => void archive(b.id, 'company')} aria-label={t('أرشفة', 'Archive')}><Archive size={15} /></button>}</span></div></article>)}</div>
      : <div className="panel bp-empty"><Sparkles size={26} aria-hidden="true" /><h3>{t('لا توجد مخططات بعد', 'No blueprints yet')}</h3><p>{access.canGenerate ? t('اختر نوع الشركة وحجمها ليقترح النظام الإدارات والوظائف والأعداد.', 'Pick a company type and size and the system will suggest departments, positions and headcount.') : t('لا توجد مخططات متاحة لك.', 'There are no blueprints available to you.')}</p></div>)}

    {tab === 'library' && <div className="bp-library">{overview.types.filter(type => access.canManageLibrary || type.status === 'active').map(type => <section key={type.id} className="panel bp-type">
      <header><h3>{pick(type.name, rtl)}{type.status === 'archived' && <> <StatusPill status="archived" rtl={rtl} /></>}</h3></header>
      <div className="bp-sizes">{BLUEPRINT_SIZES.map(size => {
        const list = overview.templates.filter(x => x.companyTypeId === type.id && x.size === size && (access.canManageLibrary || x.status === 'active'));
        return <div key={size} className="bp-size"><h4>{sizeLabel(size, rtl)}<small>{SIZE_LABELS[size].range}</small></h4>
          {list.length ? list.map(x => <div key={x.id} className="bp-template"><button className="bp-card-main" onClick={() => setOpenId(x.id)}><b>{pick(x.name, rtl)}</b><span>{fmt(x.departmentCount)} {t('وحدة', 'units')} · {fmt(x.positionCount)} {t('وظيفة', 'positions')} · {fmt(x.headcount)}</span></button>
            <div className="bp-card-foot"><StatusPill status={x.status} rtl={rtl} />{access.canManageLibrary && <span className="bp-actions"><button className="icon-btn" onClick={() => void duplicate(x.id)} aria-label={t('نسخ', 'Duplicate')}><Copy size={15} /></button>{x.status !== 'archived' && <button className="icon-btn" onClick={() => void archive(x.id, 'template')} aria-label={t('أرشفة', 'Archive')}><Archive size={15} /></button>}</span>}</div></div>)
            : <p className="bp-muted">{t('لا يوجد قالب', 'No template')}</p>}</div>;
      })}</div></section>)}</div>}

    {wizard && <GenerateWizard overview={overview} rtl={rtl} close={() => setWizard(false)} created={async id => { setWizard(false); await load(); setOpenId(id); }} />}
    {dialog === 'template' && <TemplateDialog overview={overview} rtl={rtl} close={() => setDialog(null)} created={async id => { setDialog(null); await load(); setOpenId(id); }} />}
    {dialog === 'type' && <TypeDialog rtl={rtl} close={() => setDialog(null)} saved={async () => { setDialog(null); await load(); notify(t('تم حفظ نوع الشركة', 'Company type saved')); }} />}
  </div>;
}

function Drawer({ title, eyebrow, rtl, close, children }: { title: string; eyebrow: string; rtl: boolean; close: () => void; children: React.ReactNode }) {
  return <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <aside className="drawer bp-drawer narrow" role="dialog" aria-modal="true" aria-label={title}>
      <header className="bp-drawer-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button className="icon-button" onClick={close} aria-label={rtl ? 'إغلاق' : 'Close'}><X size={20} /></button></header>{children}</aside></div>;
}

function GenerateWizard({ overview, rtl, close, created }: { overview: Overview; rtl: boolean; close: () => void; created: (id: number) => Promise<void> }) {
  const t = (ar: string, en: string) => (rtl ? ar : en);
  const fmt = makeFmt(rtl);
  const activeTypes = overview.types.filter(x => x.status === 'active');
  const [form, setForm] = useState({ companyId: '', companyTypeId: String(activeTypes[0]?.id ?? ''), size: 'small' as BlueprintSize, expectedEmployees: '', branches: '', country: '', businessModel: '', nameEn: '', nameAr: '' });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const template = useMemo(() => overview.templates.find(x => x.companyTypeId === Number(form.companyTypeId) && x.size === form.size && x.status === 'active'), [overview.templates, form.companyTypeId, form.size]);
  const submit = async () => {
    setBusy(true); setError('');
    try { const r = await blueprintApi('/api/blueprint', { body: { action: 'generate', record: { ...form, companyId: form.companyId || null, companyTypeId: Number(form.companyTypeId) || null } } }, rtl); await created(Number(r.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  };
  return <Drawer title={t('إنشاء مخطط هيكل', 'Generate a staffing blueprint')} eyebrow={t('مخطط جديد', 'New blueprint')} rtl={rtl} close={close}>
    <form className="bp-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <Field label={t('الشركة (اختياري الآن)', 'Company (optional for now)')} hint={t('أنشئ الشركة من إعدادات الهيكل التنظيمي ثم اختَرها هنا.', 'Create the company in the organization settings, then pick it here.')}><select value={form.companyId} onChange={e => setForm({ ...form, companyId: e.target.value })}><option value="">{t('أختار لاحقًا', 'Choose later')}</option>{overview.companies.filter(c => c.status === 'active').map(c => <option key={c.id} value={c.id}>{pick(c.name, rtl)}</option>)}</select></Field>
        <Field label={t('نوع الشركة', 'Company type')}><select value={form.companyTypeId} required onChange={e => setForm({ ...form, companyTypeId: e.target.value })}>{activeTypes.map(x => <option key={x.id} value={x.id}>{pick(x.name, rtl)}</option>)}</select></Field>
        <div className="bp-sizepick" role="radiogroup" aria-label={t('حجم الشركة', 'Company size')}>{BLUEPRINT_SIZES.map(size => <button type="button" key={size} role="radio" aria-checked={form.size === size} className={form.size === size ? 'active' : ''} onClick={() => setForm({ ...form, size })}><b>{sizeLabel(size, rtl)}</b><small>{SIZE_LABELS[size].range} {t('موظف', 'employees')}</small></button>)}</div>
        <p className={template ? 'bp-callout' : 'error-banner'}>{template ? t(`القالب: ${pick(template.name, rtl)} — ${fmt(template.departmentCount)} وحدة، ${fmt(template.positionCount)} وظيفة، ${fmt(template.headcount)} موظف مقترح.`, `Template: ${pick(template.name, rtl)} — ${fmt(template.departmentCount)} units, ${fmt(template.positionCount)} positions, ${fmt(template.headcount)} suggested.`) : t('لا يوجد قالب نشط لهذا النوع والحجم.', 'There is no active template for this type and size.')}</p>
        <Field label={t('العدد المتوقع للموظفين (اختياري)', 'Expected employees (optional)')} hint={t('يُعاد ضبط الأعداد تناسبيًا مع بقاء المناصب القيادية كما هي.', 'Headcounts are scaled proportionally; leadership seats stay as they are.')}><input type="number" min={1} max={100000} value={form.expectedEmployees} onChange={e => setForm({ ...form, expectedEmployees: e.target.value })} /></Field>
        <Field label={t('عدد الفروع (اختياري)', 'Number of branches (optional)')}><input type="number" min={1} max={500} value={form.branches} onChange={e => setForm({ ...form, branches: e.target.value })} /></Field>
        <Field label={t('الدولة (اختياري)', 'Country (optional)')}><input maxLength={80} value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} /></Field>
        <Field label={t('نموذج العمل (اختياري)', 'Business model (optional)')}><input maxLength={200} value={form.businessModel} onChange={e => setForm({ ...form, businessModel: e.target.value })} /></Field>
        <Field label={t('اسم المخطط (اختياري)', 'Blueprint name (optional)')}><input maxLength={200} value={form.nameEn} onChange={e => setForm({ ...form, nameEn: e.target.value, nameAr: e.target.value })} /></Field>
      </fieldset>
      <div className="bp-form-actions"><button className="primary" disabled={busy || !template}><Sparkles size={16} />{busy ? t('جارٍ الإنشاء…', 'Generating…') : t('إنشاء المخطط', 'Generate blueprint')}</button></div>
      <p className="bp-muted">{t('لن يُنشأ أي موظف. يمكنك تعديل كل شيء قبل الاعتماد والتطبيق.', 'No employees are created. You can change everything before approving and applying.')}</p>
    </form></Drawer>;
}

function TemplateDialog({ overview, rtl, close, created }: { overview: Overview; rtl: boolean; close: () => void; created: (id: number) => Promise<void> }) {
  const t = (ar: string, en: string) => (rtl ? ar : en);
  const [form, setForm] = useState({ nameEn: '', nameAr: '', companyTypeId: String(overview.types.find(x => x.status === 'active')?.id ?? ''), size: 'small' as BlueprintSize, descriptionEn: '', descriptionAr: '' });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); setError(''); try { const r = await blueprintApi('/api/blueprint', { body: { action: 'createTemplate', record: { ...form, companyTypeId: Number(form.companyTypeId) || null } } }, rtl); await created(Number(r.id)); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } };
  return <Drawer title={t('قالب جديد', 'New template')} eyebrow={t('مكتبة القوالب', 'Blueprint library')} rtl={rtl} close={close}>
    <form className="bp-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <Field label={t('الاسم (إنجليزي)', 'Name (English)')}><input value={form.nameEn} required={!form.nameAr} onChange={e => setForm({ ...form, nameEn: e.target.value })} /></Field>
        <Field label={t('الاسم (عربي)', 'Name (Arabic)')}><input value={form.nameAr} dir="rtl" required={!form.nameEn} onChange={e => setForm({ ...form, nameAr: e.target.value })} /></Field>
        <Field label={t('نوع الشركة', 'Company type')}><select value={form.companyTypeId} onChange={e => setForm({ ...form, companyTypeId: e.target.value })}>{overview.types.filter(x => x.status === 'active').map(x => <option key={x.id} value={x.id}>{pick(x.name, rtl)}</option>)}</select></Field>
        <Field label={t('الحجم', 'Size')}><select value={form.size} onChange={e => setForm({ ...form, size: e.target.value as BlueprintSize })}>{BLUEPRINT_SIZES.map(s => <option key={s} value={s}>{sizeLabel(s, rtl)}</option>)}</select></Field>
        <Field label={t('الوصف (إنجليزي)', 'Description (English)')} wide><textarea rows={2} value={form.descriptionEn} onChange={e => setForm({ ...form, descriptionEn: e.target.value })} /></Field>
        <Field label={t('الوصف (عربي)', 'Description (Arabic)')} wide><textarea rows={2} dir="rtl" value={form.descriptionAr} onChange={e => setForm({ ...form, descriptionAr: e.target.value })} /></Field>
      </fieldset>
      <div className="bp-form-actions"><button className="primary" disabled={busy}>{t('إنشاء كمسودة', 'Create as draft')}</button></div>
    </form></Drawer>;
}

function TypeDialog({ rtl, close, saved }: { rtl: boolean; close: () => void; saved: () => Promise<void> }) {
  const t = (ar: string, en: string) => (rtl ? ar : en);
  const [form, setForm] = useState({ nameEn: '', nameAr: '' });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); setError(''); try { await blueprintApi('/api/blueprint', { body: { action: 'saveType', record: form } }, rtl); await saved(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); } };
  return <Drawer title={t('نوع شركة جديد', 'New company type')} eyebrow={t('مكتبة القوالب', 'Blueprint library')} rtl={rtl} close={close}>
    <form className="bp-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <Field label={t('الاسم (إنجليزي)', 'Name (English)')}><input value={form.nameEn} required={!form.nameAr} onChange={e => setForm({ ...form, nameEn: e.target.value })} /></Field>
        <Field label={t('الاسم (عربي)', 'Name (Arabic)')}><input value={form.nameAr} dir="rtl" required={!form.nameEn} onChange={e => setForm({ ...form, nameAr: e.target.value })} /></Field>
      </fieldset>
      <p className="bp-muted">{t('بعد إنشاء النوع أضف له قوالب بأحجام مختلفة من «قالب جديد».', 'After creating the type, add templates for each size with “New template”.')}</p>
      <div className="bp-form-actions"><button className="primary" disabled={busy}>{t('حفظ', 'Save')}</button></div>
    </form></Drawer>;
}
