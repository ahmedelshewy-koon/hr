"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Row } from './ui-types';
import { localizeApiMessage } from './api-messages';
import { AddButton, InfoNotice, MasterDataDrawer, MasterDataTable, MasterDataToolbar, SelectField, StatusBadge, TextAreaField, TextField, useMasterFilter } from './settings/settings-ui';
import { useDrawerForm } from './settings/use-drawer-form';
import { BilingualFields } from './settings/settings-ui';
import { field, nameOf, number, otherNameOf, RowActions, statusOptions } from './settings/hr/shared';

type CostCenterData = { costCenters: Row[]; companies: Row[]; members?: Row[]; canManage: boolean };

/** Payroll → Cost centers: create the cost centers (with the debit account payroll posts to) that employees are then assigned to. */
export function CostCentersWorkspace({ rtl, notify }: { rtl: boolean; notify: (message: string) => void }) {
  const [data, setData] = useState<CostCenterData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const response = await fetch('/api/cost-centers', { cache: 'no-store' });
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
    const response = await fetch('/api/cost-centers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({})) as Row;
    if (response.status === 401) window.dispatchEvent(new Event('portal-session-expired'));
    if (!response.ok) throw new Error(String((rtl ? body.message_ar : body.message_en) || localizeApiMessage(String(body.error || `Request failed (${response.status})`), rtl)));
  }, [rtl]);
  const save = async (record: Row) => { await post({ action: 'save', record }); await reload(); window.dispatchEvent(new Event('hr-data-changed')); notify(rtl ? 'تم حفظ مركز التكلفة' : 'Cost center saved'); };
  const remove = async (row: Row) => {
    if (!window.confirm(rtl ? `حذف مركز التكلفة «${nameOf(row, rtl)}» نهائيًا؟` : `Delete the cost center "${nameOf(row, rtl)}" permanently?`)) return;
    try { await post({ action: 'delete', record: { id: row.id } }); await reload(); window.dispatchEvent(new Event('hr-data-changed')); notify(rtl ? 'تم الحذف' : 'Deleted'); }
    catch (reason) { notify(reason instanceof Error ? reason.message : String(reason)); }
  };

  const drawer = useDrawerForm();
  const [viewing, setViewing] = useState<Row | null>(null);
  const membersOf = (row: Row) => (data?.members ?? []).filter(member => Number(member.cost_center_id) === Number(row.id));
  const list = useMasterFilter(data?.costCenters ?? [], row => `${row.code} ${row.name_ar} ${row.name_en} ${row.debit_account}`);
  const form = drawer.form;
  const companyName = (id: unknown) => { const company = data?.companies.find(row => Number(row.id) === Number(id)); return company ? nameOf(company, rtl) : ''; };
  const open = (row?: Row) => drawer.open(row
    ? { ...row, company_id: field(row.company_id), description: field(row.description) }
    : { status: 'active', code: '', debit_account: '', company_id: '', description: '' });
  const submit = () => drawer.submit(() => save({ id: form!.id, code: form!.code, name_en: form!.name_en, name_ar: form!.name_ar, debit_account: form!.debit_account, company_id: form!.company_id, description: form!.description, status: form!.status, version: form!.version }));

  return <section className="panel settings-panel" dir={rtl ? 'rtl' : 'ltr'} aria-labelledby="cost-centers-title">
    <header className="settings-panel-head">
      <div>
        <h2 id="cost-centers-title">{rtl ? 'مراكز التكلفة' : 'Cost centers'}</h2>
        <p>{rtl ? 'أنشئ مراكز التكلفة وحدد لكل مركز حساب المدين للرواتب، ثم اختر المركز في بيانات الراتب لكل موظف.' : 'Create cost centers and set each one’s payroll debit account, then pick the cost center in each employee’s salary details.'}</p>
      </div>
      {data && !data.canManage && <StatusBadge rtl={rtl} tone="gray" label={rtl ? 'عرض فقط' : 'View only'} />}
    </header>
    {status === 'loading' && <p className="settings-muted" role="status">{rtl ? 'جارٍ تحميل مراكز التكلفة...' : 'Loading cost centers...'}</p>}
    {status === 'error' && <InfoNotice tone="warn">{rtl ? 'تعذر تحميل مراكز التكلفة. تحقق من الاتصال وحاول مرة أخرى.' : 'Unable to load the cost centers. Check your connection and try again.'} <button type="button" className="outline" onClick={() => void reload()}>{rtl ? 'إعادة المحاولة' : 'Retry'}</button></InfoNotice>}
    {status === 'forbidden' && <InfoNotice tone="warn">{rtl ? 'ليست لديك صلاحية عرض مراكز التكلفة.' : 'You do not have permission to view cost centers.'}</InfoNotice>}
    {data && <>
      <MasterDataToolbar rtl={rtl} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} count={list.shown.length}>
        {data.canManage && <AddButton label={rtl ? 'إضافة مركز تكلفة' : 'Add cost center'} onClick={() => open()} />}
      </MasterDataToolbar>
      <MasterDataTable caption={rtl ? 'مراكز التكلفة' : 'Cost centers'} rows={list.shown} rowKey={row => row.id} actionsLabel={rtl ? 'الإجراءات' : 'Actions'}
        emptyTitle={rtl ? 'لا توجد مراكز تكلفة' : 'No cost centers'} emptyText={rtl ? 'أضف مراكز التكلفة (مثل: البرمجة والتطوير) مع حساب المدين لكل منها.' : 'Add cost centers (for example Software Development) with the debit account of each.'}
        columns={[
          { key: 'code', header: rtl ? 'الرمز' : 'Code', render: row => <b dir="ltr">{String(row.code)}</b> },
          { key: 'name', header: rtl ? 'الاسم' : 'Name', render: row => <button type="button" className="cost-center-open settings-name" onClick={() => setViewing(row)} aria-label={rtl ? `عرض موظفي ${nameOf(row, rtl)}` : `Show the employees of ${nameOf(row, rtl)}`}><b>{nameOf(row, rtl)}</b><small>{otherNameOf(row, rtl)}</small></button> },
          { key: 'account', header: rtl ? 'حساب المدين للرواتب' : 'Payroll debit account', render: row => <span dir="ltr">{row.debit_account ? String(row.debit_account) : '—'}</span> },
          { key: 'company', header: rtl ? 'الشركة' : 'Company', render: row => companyName(row.company_id) || <span className="settings-sub">{rtl ? 'كل الشركات' : 'All companies'}</span> },
          { key: 'employees', header: rtl ? 'الموظفون' : 'Employees', render: row => <button type="button" className="cost-center-open" onClick={() => setViewing(row)} aria-label={rtl ? `عرض موظفي ${nameOf(row, rtl)}` : `Show the employees of ${nameOf(row, rtl)}`}>{number(row.employees, rtl, 0)}</button> },
          { key: 'status', header: rtl ? 'الحالة' : 'Status', render: row => <StatusBadge rtl={rtl} active={row.status === 'active'} /> },
        ]}
        actions={row => <RowActions rtl={rtl} canManage={data.canManage} name={nameOf(row, rtl)} onOpen={() => open(row)} onDelete={() => void remove(row)}
          blocked={Number(row.employees) ? (rtl ? 'مستخدم لدى موظفين؛ عطّله بدلًا من حذفه' : 'Used by employees; deactivate it instead') : undefined} />} />
      {viewing && <CostCenterMembers rtl={rtl} costCenter={viewing} members={membersOf(viewing)} onClose={() => setViewing(null)} />}
      {form && <MasterDataDrawer rtl={rtl} readOnly={!data.canManage} busy={drawer.busy} error={drawer.error} onClose={drawer.close} onSubmit={submit}
        eyebrow={rtl ? 'مركز تكلفة' : 'COST CENTER'} title={form.id ? nameOf(form, rtl) : (rtl ? 'مركز تكلفة جديد' : 'New cost center')}>
        <div className="form-row">
          <TextField label={rtl ? 'الرمز' : 'Code'} required dir="ltr" maxLength={20} value={form.code} onChange={value => drawer.change({ code: value.toUpperCase() })} hint={rtl ? 'مثال: 06' : 'Example: 06'} />
          <TextField label={rtl ? 'حساب المدين للرواتب' : 'Payroll debit account'} dir="ltr" maxLength={30} inputMode="numeric" value={form.debit_account ?? ''} onChange={value => drawer.change({ debit_account: value })} hint={rtl ? 'مثال: 601100' : 'Example: 601100'} />
        </div>
        <BilingualFields rtl={rtl} nameAr={form.name_ar} nameEn={form.name_en} onChange={(key, value) => drawer.change({ [key]: value })} />
        <SelectField label={rtl ? 'الشركة' : 'Company'} value={form.company_id} options={[{ value: '', label: rtl ? 'كل الشركات' : 'All companies' }, ...data.companies.map(row => ({ value: String(row.id), label: nameOf(row, rtl) }))]} onChange={value => drawer.change({ company_id: value })} />
        <SelectField label={rtl ? 'الحالة' : 'Status'} value={form.status} options={statusOptions(rtl)} onChange={value => drawer.change({ status: value })} />
        <TextAreaField label={rtl ? 'الوصف' : 'Description'} value={form.description} onChange={value => drawer.change({ description: value })} />
      </MasterDataDrawer>}
    </>}
  </section>;
}

/** Read-only list of the current employees assigned to one cost center. */
function CostCenterMembers({ rtl, costCenter, members, onClose }: { rtl: boolean; costCenter: Row; members: Row[]; onClose: () => void }) {
  const pick = (row: Row, key: string) => String((rtl ? row[`${key}_ar`] || row[`${key}_en`] : row[`${key}_en`] || row[`${key}_ar`]) ?? '') || '—';
  return <MasterDataDrawer rtl={rtl} readOnly onClose={onClose} eyebrow={rtl ? `مركز التكلفة ${String(costCenter.code)}` : `COST CENTER ${String(costCenter.code)}`} title={nameOf(costCenter, rtl)}
    subtitle={rtl ? `${number(members.length, rtl, 0)} موظف` : `${members.length} employee${members.length === 1 ? '' : 's'}`}>
    <MasterDataTable caption={rtl ? 'موظفو مركز التكلفة' : 'Cost center employees'} rows={members} rowKey={row => row.id}
      emptyTitle={rtl ? 'لا يوجد موظفون في هذا المركز' : 'No employees in this cost center'} emptyText={rtl ? 'اختر مركز التكلفة من بيانات الراتب في ملف الموظف.' : 'Pick the cost center in the salary details of the employee profile.'}
      columns={[
        { key: 'code', header: rtl ? 'الرقم الوظيفي' : 'Code', render: row => <b dir="ltr">{String(row.employee_code)}</b> },
        { key: 'name', header: rtl ? 'الموظف' : 'Employee', render: row => <span className="settings-name"><b>{nameOf(row, rtl)}</b><small>{pick(row, 'job_title')}</small></span> },
        { key: 'company', header: rtl ? 'الشركة' : 'Company', render: row => pick(row, 'company') },
        { key: 'department', header: rtl ? 'القسم' : 'Department', render: row => pick(row, 'department') },
      ]} />
  </MasterDataDrawer>;
}
