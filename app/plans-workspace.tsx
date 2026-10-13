"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Row } from './ui-types';
import { localizeApiMessage } from './api-messages';
import { AddButton, BilingualFields, CheckField, InfoNotice, MasterDataDrawer, MasterDataTable, MasterDataToolbar, SelectField, StatusBadge, TextAreaField, TextField, useMasterFilter } from './settings/settings-ui';
import { useDrawerForm } from './settings/use-drawer-form';
import { field, nameOf, number, otherNameOf, RowActions, statusOptions } from './settings/hr/shared';
import { durationLabel, priceLabel } from './plans/format';

type PlansData = { plans: Row[]; canManage: boolean };
const CURRENCIES = ['SAR', 'EGP', 'AED', 'USD', 'EUR'];

/** Plans: create the system's subscription plans (price, duration, details); the flagged ones appear on the landing page. */
export function PlansWorkspace({ rtl, notify }: { rtl: boolean; notify: (message: string) => void }) {
  const [data, setData] = useState<PlansData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const response = await fetch('/api/plans', { cache: 'no-store' });
      if (response.status === 401) window.dispatchEvent(new Event('portal-session-expired'));
      if (request !== latest.current) return;
      if (response.status === 403) { setStatus('forbidden'); return; }
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json()); setStatus('ready');
    } catch { if (request === latest.current) setStatus('error'); }
  }, []);
  useEffect(() => {
    const requests = latest;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => { window.clearTimeout(timer); ++requests.current; };
  }, [reload]);
  const post = useCallback(async (payload: Row) => {
    const response = await fetch('/api/plans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({})) as Row;
    if (response.status === 401) window.dispatchEvent(new Event('portal-session-expired'));
    if (!response.ok) throw new Error(String((rtl ? body.message_ar : body.message_en) || localizeApiMessage(String(body.error || `Request failed (${response.status})`), rtl)));
  }, [rtl]);
  const save = async (record: Row) => { await post({ action: 'save', record }); await reload(); notify(rtl ? 'تم حفظ الباقة' : 'Plan saved'); };
  const remove = async (row: Row) => {
    if (!window.confirm(rtl ? `حذف الباقة «${nameOf(row, rtl)}» نهائيًا؟ ستختفي من الصفحة الرئيسية.` : `Delete the plan "${nameOf(row, rtl)}" permanently? It will disappear from the landing page.`)) return;
    try { await post({ action: 'delete', record: { id: row.id } }); await reload(); notify(rtl ? 'تم الحذف' : 'Deleted'); }
    catch (reason) { notify(reason instanceof Error ? reason.message : String(reason)); }
  };

  const drawer = useDrawerForm();
  const list = useMasterFilter(data?.plans ?? [], row => `${row.code} ${row.name_ar} ${row.name_en}`);
  const form = drawer.form;
  const open = (row?: Row) => drawer.open(row
    ? { ...row, price: field(row.price), max_employees: field(row.max_employees), description_ar: field(row.description_ar), description_en: field(row.description_en), features_ar: field(row.features_ar), features_en: field(row.features_en), is_featured: Boolean(row.is_featured), show_on_landing: Boolean(row.show_on_landing) }
    : { status: 'active', code: '', price: '', currency: 'SAR', duration_months: '1', max_employees: '', sort_order: String((data?.plans.length ?? 0) + 1), is_featured: false, show_on_landing: true, description_ar: '', description_en: '', features_ar: '', features_en: '' });
  const submit = () => drawer.submit(() => save({
    id: form!.id, version: form!.version, code: form!.code, name_ar: form!.name_ar, name_en: form!.name_en, description_ar: form!.description_ar, description_en: form!.description_en,
    features_ar: form!.features_ar, features_en: form!.features_en, price: form!.price, currency: form!.currency, duration_months: form!.duration_months, max_employees: form!.max_employees,
    sort_order: form!.sort_order, is_featured: form!.is_featured, show_on_landing: form!.show_on_landing, status: form!.status,
  }));

  return <section className="panel settings-panel" dir={rtl ? 'rtl' : 'ltr'} aria-labelledby="plans-title">
    <header className="settings-panel-head">
      <div>
        <h2 id="plans-title">{rtl ? 'الباقات' : 'Plans'}</h2>
        <p>{rtl ? 'أضف باقات النظام بأسعارها ومددها وتفاصيلها. الباقات النشطة المفعّل لها «إظهار في الصفحة الرئيسية» تظهر تلقائيًا في قسم الباقات بالصفحة الرئيسية.' : 'Add the system plans with price, duration and details. Active plans marked “Show on landing page” appear automatically in the Plans section of the landing page.'}</p>
      </div>
    </header>
    {status === 'loading' && <p className="settings-muted" role="status">{rtl ? 'جارٍ تحميل الباقات...' : 'Loading plans...'}</p>}
    {status === 'error' && <InfoNotice tone="warn">{rtl ? 'تعذر تحميل الباقات. تحقق من الاتصال وحاول مرة أخرى.' : 'Unable to load the plans. Check your connection and try again.'} <button type="button" className="outline" onClick={() => void reload()}>{rtl ? 'إعادة المحاولة' : 'Retry'}</button></InfoNotice>}
    {status === 'forbidden' && <InfoNotice tone="warn">{rtl ? 'إدارة الباقات متاحة لمدير النظام فقط.' : 'Only the Super Admin can manage plans.'}</InfoNotice>}
    {data && <>
      <MasterDataToolbar rtl={rtl} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} count={list.shown.length}>
        {data.canManage && <AddButton label={rtl ? 'إضافة باقة' : 'Add plan'} onClick={() => open()} />}
      </MasterDataToolbar>
      <MasterDataTable caption={rtl ? 'الباقات' : 'Plans'} rows={list.shown} rowKey={row => row.id} actionsLabel={rtl ? 'الإجراءات' : 'Actions'}
        emptyTitle={rtl ? 'لا توجد باقات' : 'No plans'} emptyText={rtl ? 'أضف أول باقة لتظهر في الصفحة الرئيسية.' : 'Add the first plan to show it on the landing page.'}
        columns={[
          { key: 'code', header: rtl ? 'الرمز' : 'Code', render: row => <b dir="ltr">{String(row.code)}</b> },
          { key: 'name', header: rtl ? 'الباقة' : 'Plan', render: row => <span className="settings-name"><b>{nameOf(row, rtl)}</b><small>{otherNameOf(row, rtl)}</small></span> },
          { key: 'price', header: rtl ? 'السعر' : 'Price', render: row => priceLabel(row, rtl) },
          { key: 'duration', header: rtl ? 'المدة' : 'Duration', render: row => durationLabel(row.duration_months, rtl) },
          { key: 'employees', header: rtl ? 'الموظفون' : 'Employees', render: row => row.max_employees ? number(row.max_employees, rtl, 0) : (rtl ? 'غير محدود' : 'Unlimited') },
          { key: 'landing', header: rtl ? 'الصفحة الرئيسية' : 'Landing page', render: row => <StatusBadge rtl={rtl} tone={row.show_on_landing ? 'green' : 'gray'} label={row.show_on_landing ? (rtl ? 'ظاهرة' : 'Shown') : (rtl ? 'مخفية' : 'Hidden')} /> },
          { key: 'status', header: rtl ? 'الحالة' : 'Status', render: row => <StatusBadge rtl={rtl} active={row.status === 'active'} /> },
        ]}
        actions={row => <RowActions rtl={rtl} canManage={data.canManage} name={nameOf(row, rtl)} onOpen={() => open(row)} onDelete={() => void remove(row)} />} />
      {form && <MasterDataDrawer rtl={rtl} readOnly={!data.canManage} busy={drawer.busy} error={drawer.error} onClose={drawer.close} onSubmit={submit}
        eyebrow={rtl ? 'باقة' : 'PLAN'} title={form.id ? nameOf(form, rtl) : (rtl ? 'باقة جديدة' : 'New plan')}>
        <div className="form-row">
          <TextField label={rtl ? 'الرمز' : 'Code'} required dir="ltr" maxLength={20} value={form.code} onChange={value => drawer.change({ code: value.toUpperCase() })} hint={rtl ? 'مثال: STARTER' : 'Example: STARTER'} />
          <TextField label={rtl ? 'الترتيب في الصفحة الرئيسية' : 'Order on landing page'} type="number" min={0} max={9999} dir="ltr" value={form.sort_order} onChange={value => drawer.change({ sort_order: value })} />
        </div>
        <BilingualFields rtl={rtl} nameAr={form.name_ar} nameEn={form.name_en} onChange={(key, value) => drawer.change({ [key]: value })} />
        <div className="form-row">
          <TextField label={rtl ? 'السعر' : 'Price'} type="number" min={0} step="any" dir="ltr" value={form.price} onChange={value => drawer.change({ price: value })} hint={rtl ? 'اتركه فارغًا لعرض «تواصل معنا للسعر»' : 'Leave empty to show “Contact us for pricing”'} />
          <SelectField label={rtl ? 'العملة' : 'Currency'} value={form.currency} options={CURRENCIES.map(code => ({ value: code, label: code }))} onChange={value => drawer.change({ currency: value })} />
        </div>
        <div className="form-row">
          <TextField label={rtl ? 'المدة (بالأشهر)' : 'Duration (months)'} required type="number" min={1} max={120} dir="ltr" value={form.duration_months} onChange={value => drawer.change({ duration_months: value })} hint={rtl ? '1 = شهري، 3 = ربع سنوي، 12 = سنوي' : '1 = monthly, 3 = quarterly, 12 = yearly'} />
          <TextField label={rtl ? 'الحد الأقصى للموظفين' : 'Max employees'} type="number" min={1} dir="ltr" value={form.max_employees} onChange={value => drawer.change({ max_employees: value })} hint={rtl ? 'اتركه فارغًا لغير محدود' : 'Leave empty for unlimited'} />
        </div>
        <TextAreaField label={rtl ? 'الشرح بالعربية' : 'Description (Arabic)'} value={form.description_ar} onChange={value => drawer.change({ description_ar: value })} />
        <TextAreaField label={rtl ? 'الشرح بالإنجليزية' : 'Description (English)'} value={form.description_en} onChange={value => drawer.change({ description_en: value })} />
        <TextAreaField label={rtl ? 'المزايا بالعربية' : 'Features (Arabic)'} maxLength={3000} value={form.features_ar} onChange={value => drawer.change({ features_ar: value })} hint={rtl ? 'ميزة واحدة في كل سطر' : 'One feature per line'} />
        <TextAreaField label={rtl ? 'المزايا بالإنجليزية' : 'Features (English)'} maxLength={3000} value={form.features_en} onChange={value => drawer.change({ features_en: value })} hint={rtl ? 'ميزة واحدة في كل سطر' : 'One feature per line'} />
        <CheckField label={rtl ? 'إظهار في الصفحة الرئيسية' : 'Show on landing page'} checked={Boolean(form.show_on_landing)} onChange={value => drawer.change({ show_on_landing: value })} />
        <CheckField label={rtl ? 'باقة مميزة (الأكثر طلبًا)' : 'Featured plan (most popular)'} checked={Boolean(form.is_featured)} onChange={value => drawer.change({ is_featured: value })} />
        <SelectField label={rtl ? 'الحالة' : 'Status'} value={form.status} options={statusOptions(rtl)} onChange={value => drawer.change({ status: value })} />
      </MasterDataDrawer>}
    </>}
  </section>;
}
