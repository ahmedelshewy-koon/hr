"use client";
import { useState } from 'react';
import type { Row } from '../../ui-types';
import { COUNTRIES } from '../../employees/countries';
import { isActive, isRemoved, linkedBranchIds, linkedCompanyIds, nameOf, otherNameOf } from '../../organization/selectors.ts';
import { companyIncomplete, deriveCompanyCeo, lockState, usageOf, type CompanyCeo } from '../../organization/settings-model.ts';
import { AddButton, BilingualFields, CheckGroup, formatCount, InfoNotice, MasterDataDrawer, MasterDataTable, MasterDataToolbar, OpenButton, SelectField, SettingsSubnav, StatusBadge, TextField, UsageCell, UsageNotice, useMasterFilter } from '../settings-ui';
import { useDrawerForm } from '../use-drawer-form';
import { useOrganization } from './context';
import { ImpactReviewPanel, useImpactReview } from './impact-review';

/** Derived CEO: whoever occupies the company's active CEO position. Nothing is stored on the company. */
/** Only company↔branch link rows reference it, so it has never been used and can be deleted. */
const unusedExceptLinks = (usage: { references?: Record<string, { total: number }> }) => Object.entries(usage.references ?? {}).every(([ref, count]) => ref.startsWith('company_branches:') || count.total === 0);

export function CeoSummary({ ceo, rtl }: { ceo: CompanyCeo; rtl: boolean }) {
  if (ceo.state === 'none') return <span className="settings-sub">{rtl ? 'لا توجد وظيفة رئيس تنفيذي' : 'No CEO position'}</span>;
  if (ceo.state === 'vacant') return <span className="settings-chip warn">{rtl ? 'وظيفة الرئيس التنفيذي شاغرة' : 'CEO position vacant'}</span>;
  return <span className="settings-name"><b>{nameOf(ceo.ceo, rtl)}</b><small>{nameOf(ceo.positions[0], rtl)}{ceo.state === 'conflict' ? ` · ${rtl ? 'أكثر من شاغل' : 'multiple occupants'}` : ''}</small></span>;
}

export function CompaniesAndBranches() {
  const [tab, setTab] = useState<'companies' | 'branches'>('companies');
  const { rtl, catalog } = useOrganization();
  return <>
    <SettingsSubnav level="secondary" rtl={rtl} label={rtl ? 'الشركات والفروع' : 'Companies and branches'} active={tab} onChange={id => setTab(id as 'companies' | 'branches')}
      items={[{ id: 'companies', label: rtl ? 'الشركات' : 'Companies', count: catalog.companies.filter(row => !isRemoved(row)).length }, { id: 'branches', label: rtl ? 'الفروع' : 'Branches', count: catalog.branches.filter(row => !isRemoved(row)).length }]} />
    {tab === 'companies' ? <CompaniesTab /> : <BranchesTab />}
  </>;
}

export function CompaniesTab() {
  const { rtl, access, catalog, usage, occupants, saveEntity, previewEntity, deleteEntity } = useOrganization();
  const review = useImpactReview();
  const drawer = useDrawerForm();
  const rows = catalog.companies.filter(row => !isRemoved(row));
  const list = useMasterFilter(rows, row => `${row.name} ${row.name_ar} ${row.name_en} ${row.code}`);
  const branchName = (id: number) => nameOf(catalog.branches.find(branch => Number(branch.id) === id), rtl);
  const fmt = (value: number) => formatCount(value, rtl);
  const form = drawer.form;
  const editing = Boolean(form?.id);
  const locks = lockState(usageOf(usage, 'companies', form?.id), fmt);
  const originallyActive = form?.id ? catalog.companies.find(row => Number(row.id) === Number(form.id))?.status === 'active' : false;
  const linked = form?.id ? linkedBranchIds(catalog, form.id).map(String) : [];
  const branchOptions = catalog.branches.filter(branch => !isRemoved(branch) && (isActive(branch) || linked.includes(String(branch.id))))
    .map(branch => ({ value: String(branch.id), label: nameOf(branch, rtl) + (isActive(branch) ? '' : (rtl ? ' (غير نشط)' : ' (inactive)')), locked: false }));
  const open = (row?: Row) => { review.reset(); drawer.open(row ? { ...row, branchIds: linkedBranchIds(catalog, row.id).map(String) } : { status: 'active', branchIds: [] }); };
  const companyRecord = form ? { id: form.id, name_ar: form.name_ar, name_en: form.name_en, code: form.code, status: form.status, branchIds: (form.branchIds ?? []).map(Number) } : null;
  const companyPreview = review.current(companyRecord);
  const save = () => drawer.submit(async () => {
    if (!String(form?.name_ar ?? '').trim() && !String(form?.name_en ?? '').trim()) throw new Error(rtl ? 'أدخل اسم الشركة بالعربية أو بالإنجليزية' : 'Enter the company name in Arabic or English');
    const record = companyRecord!;
    await (record.id ? review.run(record, () => previewEntity('companies', record), token => saveEntity('companies', { ...record, confirmImpact: token })) : saveEntity('companies', record));
  });
  return <>
    <MasterDataToolbar rtl={rtl} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} count={list.shown.length}>
      {access.canManage && <AddButton label={rtl ? 'إضافة شركة' : 'Add company'} onClick={() => open()} />}
    </MasterDataToolbar>
    <MasterDataTable caption={rtl ? 'الشركات' : 'Companies'} rows={list.shown} rowKey={row => row.id} actionsLabel={rtl ? 'الإجراءات' : 'Actions'}
      emptyTitle={rtl ? 'لا توجد شركات' : 'No companies'} emptyText={rtl ? 'أضف شركة لتظهر في ملفات الموظفين.' : 'Add a company to make it available in employee profiles.'}
      columns={[
        { key: 'name', header: rtl ? 'الشركة' : 'Company', render: row => <span className="settings-name"><b>{nameOf(row, rtl)}</b><small>{row.name_ar && row.name_en ? otherNameOf(row, rtl) : (rtl ? 'يلزم استكمال الأسماء والرمز' : 'Names and code need completing')}</small></span> },
        { key: 'code', header: rtl ? 'الرمز' : 'Code', render: row => row.code ? <span dir="ltr">{row.code}</span> : <span className="settings-chip warn">{rtl ? 'بلا رمز' : 'No code'}</span> },
        { key: 'branches', header: rtl ? 'الفروع' : 'Branches', render: row => { const ids = linkedBranchIds(catalog, row.id); return ids.length ? <span className="settings-chips">{ids.map(id => <span className="settings-chip" key={id}>{branchName(id)}</span>)}</span> : <span className="settings-sub">—</span>; } },
        { key: 'ceo', header: rtl ? 'الرئيس التنفيذي' : 'CEO', render: row => <CeoSummary rtl={rtl} ceo={deriveCompanyCeo(row.id, catalog.positions, occupants)} /> },
        { key: 'status', header: rtl ? 'الحالة' : 'Status', render: row => <StatusBadge rtl={rtl} active={isActive(row)} /> },
        { key: 'usage', header: rtl ? 'الاستخدام' : 'Usage', render: row => <UsageCell usage={usageOf(usage, 'companies', row.id)} rtl={rtl} /> },
      ]}
      actions={row => <OpenButton rtl={rtl} canManage={access.canManage} name={nameOf(row, rtl)} onClick={() => open(row)} />} />
    {form && <MasterDataDrawer rtl={rtl} readOnly={!access.canManage} busy={drawer.busy} error={drawer.error} onClose={() => { review.reset(); drawer.close(); }} onSubmit={save}
      submitLabel={companyPreview?.ok ? (rtl ? 'تأكيد وحفظ' : 'Confirm and save') : undefined} submitDisabled={Boolean(companyPreview && !companyPreview.ok)} review={<ImpactReviewPanel rtl={rtl} preview={companyPreview} />}
      onDelete={form.id && unusedExceptLinks(usageOf(usage, 'companies', form.id)) ? () => { if (window.confirm(rtl ? 'حذف هذا السجل نهائيًا؟ لا يمكن التراجع.' : 'Delete this record permanently? This cannot be undone.')) void drawer.submit(() => deleteEntity('companies', form.id)); } : undefined}
      eyebrow={rtl ? 'شركة' : 'COMPANY'} title={editing ? nameOf(form, rtl) : (rtl ? 'شركة جديدة' : 'New company')}>
      {editing && companyIncomplete(form) && <InfoNotice tone="warn">{rtl ? 'بيانات هذه الشركة غير مكتملة. أضف الاسمين والرمز.' : 'This company is incomplete. Add both names and a code.'}{form.name && ` ${rtl ? 'الاسم القديم' : 'Legacy name'}: ${form.name}`}</InfoNotice>}
      <BilingualFields rtl={rtl} nameAr={form.name_ar} nameEn={form.name_en} required={false} onChange={(key, value) => drawer.change({ [key]: value })} />
      <TextField label={rtl ? 'الرمز' : 'Code'} value={form.code} dir="ltr" maxLength={40} onChange={value => drawer.change({ code: value })} hint={rtl ? 'رمز فريد للشركة.' : 'A unique short code.'} />
      <SelectField label={rtl ? 'الحالة' : 'Status'} value={form.status} onChange={value => drawer.change({ status: value })}
        options={[{ value: 'active', label: rtl ? 'نشط' : 'Active' }, { value: 'inactive', label: rtl ? 'غير نشط' : 'Inactive', disabled: originallyActive && Boolean(locks.deactivate) }]} />
      <CheckGroup legend={rtl ? 'الفروع التي تعمل فيها الشركة' : 'Branches this company operates in'} options={branchOptions} selected={form.branchIds ?? []} onChange={values => drawer.change({ branchIds: values })}
        empty={rtl ? 'أضف فروعًا أولًا من تبويب «الفروع».' : 'Add branches first from the Branches tab.'}
        hint={locks.structural ? (rtl ? 'لا يمكن إزالة الفروع المرتبطة أثناء استخدام الشركة.' : 'Linked branches cannot be removed while the company is in use.') : (rtl ? 'يمكن للشركة أن تعمل في عدة فروع، وللفرع أن يخدم عدة شركات.' : 'A company can operate in several branches, and a branch can serve several companies.')} />
      {editing && <div className="settings-field"><span className="settings-section-title">{rtl ? 'الرئيس التنفيذي (مشتق)' : 'CEO (derived)'}</span><CeoSummary rtl={rtl} ceo={deriveCompanyCeo(form.id, catalog.positions, occupants)} />
        <small>{rtl ? 'يُشتق من شاغل وظيفة الرئيس التنفيذي النشطة. تُحدَّد من تبويب «الوظائف».' : 'Derived from whoever occupies the active CEO position. Set it under Positions.'}</small></div>}
      {editing && <UsageNotice usage={usageOf(usage, 'companies', form.id)} rtl={rtl} />}
    </MasterDataDrawer>}
  </>;
}

export function BranchesTab() {
  const { rtl, access, catalog, usage, saveEntity, previewEntity, deleteEntity } = useOrganization();
  const review = useImpactReview();
  const drawer = useDrawerForm();
  const rows = catalog.branches.filter(row => !isRemoved(row));
  const list = useMasterFilter(rows, row => `${row.name_ar} ${row.name_en} ${row.code} ${row.country} ${row.city}`);
  const fmt = (value: number) => formatCount(value, rtl);
  const form = drawer.form;
  const editing = Boolean(form?.id);
  const locks = lockState(usageOf(usage, 'branches', form?.id), fmt);
  const originallyActive = form?.id ? catalog.branches.find(row => Number(row.id) === Number(form.id))?.status === 'active' : false;
  const linked = form?.id ? linkedCompanyIds(catalog, form.id).map(String) : [];
  const companyOptions = catalog.companies.filter(company => !isRemoved(company) && (isActive(company) || linked.includes(String(company.id))))
    .map(company => ({ value: String(company.id), label: nameOf(company, rtl) + (isActive(company) ? '' : (rtl ? ' (غير نشط)' : ' (inactive)')), locked: false }));
  const countryLabel = (value: unknown) => { const hit = COUNTRIES.find(country => country.value === value); return hit ? (rtl ? hit.ar : hit.value) : String(value ?? ''); };
  const open = (row?: Row) => { review.reset(); drawer.open(row ? { ...row, companyIds: linkedCompanyIds(catalog, row.id).map(String) } : { status: 'active', companyIds: [] }); };
  const branchRecord = form ? { id: form.id, name_ar: form.name_ar, name_en: form.name_en, code: form.code, country: form.country, city: form.city, status: form.status, companyIds: (form.companyIds ?? []).map(Number) } : null;
  const branchPreview = review.current(branchRecord);
  const save = () => drawer.submit(() => branchRecord!.id ? review.run(branchRecord!, () => previewEntity('branches', branchRecord!), token => saveEntity('branches', { ...branchRecord!, confirmImpact: token })) : saveEntity('branches', branchRecord!));
  return <>
    <MasterDataToolbar rtl={rtl} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} count={list.shown.length}>
      {access.canManage && <AddButton label={rtl ? 'إضافة فرع' : 'Add branch'} onClick={() => open()} />}
    </MasterDataToolbar>
    <MasterDataTable caption={rtl ? 'الفروع' : 'Branches'} rows={list.shown} rowKey={row => row.id} actionsLabel={rtl ? 'الإجراءات' : 'Actions'}
      emptyTitle={rtl ? 'لا توجد فروع' : 'No branches'} emptyText={rtl ? 'أضف فرعًا ثم اربطه بالشركات.' : 'Add a branch, then link it to companies.'}
      columns={[
        { key: 'name', header: rtl ? 'الفرع' : 'Branch', render: row => <span className="settings-name"><b>{nameOf(row, rtl)}</b><small>{otherNameOf(row, rtl)}</small></span> },
        { key: 'code', header: rtl ? 'الرمز' : 'Code', render: row => <span dir="ltr">{row.code}</span> },
        { key: 'place', header: rtl ? 'الدولة / المدينة' : 'Country / city', render: row => [countryLabel(row.country), row.city].filter(Boolean).join(' · ') || '—' },
        { key: 'companies', header: rtl ? 'الشركات' : 'Companies', render: row => { const ids = linkedCompanyIds(catalog, row.id); return ids.length ? <span className="settings-chips">{ids.map(id => <span className="settings-chip" key={id}>{nameOf(catalog.companies.find(company => Number(company.id) === id), rtl)}</span>)}</span> : <span className="settings-sub">—</span>; } },
        { key: 'status', header: rtl ? 'الحالة' : 'Status', render: row => <StatusBadge rtl={rtl} active={isActive(row)} /> },
        { key: 'usage', header: rtl ? 'الاستخدام' : 'Usage', render: row => <UsageCell usage={usageOf(usage, 'branches', row.id)} rtl={rtl} /> },
      ]}
      actions={row => <OpenButton rtl={rtl} canManage={access.canManage} name={nameOf(row, rtl)} onClick={() => open(row)} />} />
    {form && <MasterDataDrawer rtl={rtl} readOnly={!access.canManage} busy={drawer.busy} error={drawer.error} onClose={() => { review.reset(); drawer.close(); }} onSubmit={save}
      submitLabel={branchPreview?.ok ? (rtl ? 'تأكيد وحفظ' : 'Confirm and save') : undefined} submitDisabled={Boolean(branchPreview && !branchPreview.ok)} review={<ImpactReviewPanel rtl={rtl} preview={branchPreview} />}
      onDelete={form.id && unusedExceptLinks(usageOf(usage, 'branches', form.id)) ? () => { if (window.confirm(rtl ? 'حذف هذا السجل نهائيًا؟ لا يمكن التراجع.' : 'Delete this record permanently? This cannot be undone.')) void drawer.submit(() => deleteEntity('branches', form.id)); } : undefined}
      eyebrow={rtl ? 'فرع' : 'BRANCH'} title={editing ? nameOf(form, rtl) : (rtl ? 'فرع جديد' : 'New branch')}>
      <BilingualFields rtl={rtl} nameAr={form.name_ar} nameEn={form.name_en} onChange={(key, value) => drawer.change({ [key]: value })} />
      <TextField label={rtl ? 'الرمز' : 'Code'} value={form.code} dir="ltr" maxLength={40} required onChange={value => drawer.change({ code: value })} />
      <div className="form-row">
        <SelectField label={rtl ? 'الدولة' : 'Country'} value={form.country} placeholder={rtl ? 'اختر الدولة' : 'Select country'} onChange={value => drawer.change({ country: value })}
          options={COUNTRIES.map(country => ({ value: country.value, label: rtl ? country.ar : country.value }))} />
        <TextField label={rtl ? 'المدينة' : 'City'} value={form.city} onChange={value => drawer.change({ city: value })} />
      </div>
      <SelectField label={rtl ? 'الحالة' : 'Status'} value={form.status} onChange={value => drawer.change({ status: value })}
        options={[{ value: 'active', label: rtl ? 'نشط' : 'Active' }, { value: 'inactive', label: rtl ? 'غير نشط' : 'Inactive', disabled: originallyActive && Boolean(locks.deactivate) }]} />
      <CheckGroup legend={rtl ? 'الشركات التي يخدمها الفرع' : 'Companies this branch serves'} options={companyOptions} selected={form.companyIds ?? []} onChange={values => drawer.change({ companyIds: values })}
        empty={rtl ? 'أضف شركات أولًا.' : 'Add companies first.'}
        hint={locks.structural ? (rtl ? 'لا يمكن إزالة الشركات المرتبطة أثناء استخدام الفرع.' : 'Linked companies cannot be removed while the branch is in use.') : undefined} />
      {editing && form.companyIds?.length === 0 && <InfoNotice tone="warn">{rtl ? 'الفرع غير مرتبط بأي شركة، فلن يظهر في أي ملف موظف.' : 'This branch is not linked to any company, so it will not appear in employee profiles.'}</InfoNotice>}
      {editing && <UsageNotice usage={usageOf(usage, 'branches', form.id)} rtl={rtl} />}
    </MasterDataDrawer>}
  </>;
}
