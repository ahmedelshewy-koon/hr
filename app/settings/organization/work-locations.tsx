"use client";
import type { Row } from '../../ui-types';
import { isActive, isRemoved, nameOf, optionsFor, otherNameOf } from '../../organization/selectors.ts';
import { lockState, usageOf } from '../../organization/settings-model.ts';
import { AddButton, BilingualFields, formatCount, InfoNotice, MasterDataDrawer, MasterDataTable, MasterDataToolbar, OpenButton, SelectField, StatusBadge, TextField, UsageCell, UsageNotice, useMasterFilter } from '../settings-ui';
import { useDrawerForm } from '../use-drawer-form';
import { useOrganization } from './context';
import { ImpactReviewPanel, useImpactReview } from './impact-review';

/** Work Location is a place people work (Riyadh HQ, Remote, Client Site); it is separate from Branch. */
export function WorkLocationsSection() {
  const { rtl, access, catalog, usage, legacyWorkLocations, saveEntity, previewEntity, deleteEntity } = useOrganization();
  const review = useImpactReview();
  const drawer = useDrawerForm();
  const fmt = (value: number) => formatCount(value, rtl);
  const rows = catalog.workLocations.filter(row => !isRemoved(row));
  const list = useMasterFilter(rows, row => `${row.name_ar} ${row.name_en} ${row.code}`);
  const form = drawer.form;
  const editing = Boolean(form?.id);
  const locks = lockState(usageOf(usage, 'workLocations', form?.id), fmt);
  const originallyActive = form?.id ? catalog.workLocations.find(row => Number(row.id) === Number(form.id))?.status === 'active' : false;
  const branchName = (row: Row) => nameOf(catalog.branches.find(branch => Number(branch.id) === Number(row.branch_id)), rtl, rtl ? 'أي فرع' : 'Any branch');
  const legacyTotal = legacyWorkLocations.reduce((sum, item) => sum + item.employees, 0);
  const open = (row?: Row) => { review.reset(); drawer.open(row ?? { status: 'active' }); };
  const record = form ? { id: form.id, name_ar: form.name_ar, name_en: form.name_en, code: form.code, branch_id: form.branch_id, status: form.status } : null;
  const preview = review.current(record);
  const save = () => drawer.submit(() => record!.id ? review.run(record!, () => previewEntity('workLocations', record!), token => saveEntity('workLocations', { ...record!, confirmImpact: token })) : saveEntity('workLocations', record!));
  return <>
    {legacyTotal > 0 && <InfoNotice>{rtl
      ? `${fmt(legacyTotal)} موظفًا لديهم مقر عمل نصي قديم (${legacyWorkLocations.slice(0, 4).map(item => `${item.text}: ${fmt(item.employees)}`).join('، ')}${legacyWorkLocations.length > 4 ? '…' : ''}). يبقى النص كما هو ولا يُربط تلقائيًا؛ عيّن مقر العمل من ملف الموظف.`
      : `${fmt(legacyTotal)} employees still carry a legacy free-text work location (${legacyWorkLocations.slice(0, 4).map(item => `${item.text}: ${fmt(item.employees)}`).join(', ')}${legacyWorkLocations.length > 4 ? '…' : ''}). The text is preserved and never auto-mapped; assign a work location from the employee profile.`}</InfoNotice>}
    <MasterDataToolbar rtl={rtl} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} count={list.shown.length}>
      {access.canManage && <AddButton label={rtl ? 'إضافة مقر عمل' : 'Add work location'} onClick={() => open()} />}
    </MasterDataToolbar>
    <MasterDataTable caption={rtl ? 'مقار العمل' : 'Work locations'} rows={list.shown} rowKey={row => row.id} actionsLabel={rtl ? 'الإجراءات' : 'Actions'}
      emptyTitle={rtl ? 'لا توجد مقار عمل' : 'No work locations'} emptyText={rtl ? 'أمثلة: مقر الرياض، مكتب القاهرة، عن بُعد، موقع العميل.' : 'Examples: Riyadh HQ, Cairo Office, Remote, Client Site.'}
      columns={[
        { key: 'name', header: rtl ? 'مقر العمل' : 'Work location', render: row => <span className="settings-name"><b>{nameOf(row, rtl)}</b><small>{otherNameOf(row, rtl)}</small></span> },
        { key: 'code', header: rtl ? 'الرمز' : 'Code', render: row => <span dir="ltr">{row.code}</span> },
        { key: 'branch', header: rtl ? 'الفرع' : 'Branch', render: row => row.branch_id ? branchName(row) : <span className="settings-sub">{branchName(row)}</span> },
        { key: 'status', header: rtl ? 'الحالة' : 'Status', render: row => <StatusBadge rtl={rtl} active={isActive(row)} /> },
        { key: 'usage', header: rtl ? 'الاستخدام' : 'Usage', render: row => <UsageCell usage={usageOf(usage, 'workLocations', row.id)} rtl={rtl} /> },
      ]}
      actions={row => <OpenButton rtl={rtl} canManage={access.canManage} name={nameOf(row, rtl)} onClick={() => open(row)} />} />
    {form && <MasterDataDrawer rtl={rtl} readOnly={!access.canManage} busy={drawer.busy} error={drawer.error} onClose={() => { review.reset(); drawer.close(); }} onSubmit={save}
      submitLabel={preview?.ok ? (rtl ? 'تأكيد وحفظ' : 'Confirm and save') : undefined} submitDisabled={Boolean(preview && !preview.ok)} review={<ImpactReviewPanel rtl={rtl} preview={preview} />}
      onDelete={form.id && usageOf(usage, 'workLocations', form.id).total === 0 ? () => { if (window.confirm(rtl ? 'حذف مقر العمل نهائيًا؟' : 'Delete this work location permanently?')) void drawer.submit(() => deleteEntity('workLocations', form.id)); } : undefined}
      eyebrow={rtl ? 'مقر عمل' : 'WORK LOCATION'} title={editing ? nameOf(form, rtl) : (rtl ? 'مقر عمل جديد' : 'New work location')}>
      <BilingualFields rtl={rtl} nameAr={form.name_ar} nameEn={form.name_en} onChange={(key, value) => drawer.change({ [key]: value })} />
      <TextField label={rtl ? 'الرمز' : 'Code'} value={form.code} dir="ltr" maxLength={40} required onChange={value => drawer.change({ code: value })} />
      <SelectField label={rtl ? 'الفرع (اختياري)' : 'Branch (optional)'} value={form.branch_id} disabled={Boolean(locks.structural)} placeholder={rtl ? 'بدون فرع محدد' : 'No specific branch'}
        options={optionsFor(catalog.branches, rtl, form.branch_id)} onChange={value => drawer.change({ branch_id: value })}
        hint={rtl ? 'مقر العمل منفصل عن الفرع؛ اربطه بفرع فقط إذا كان يخصه.' : 'A work location is separate from a branch; link one only if it belongs to it.'} />
      <SelectField label={rtl ? 'الحالة' : 'Status'} value={form.status} onChange={value => drawer.change({ status: value })}
        options={[{ value: 'active', label: rtl ? 'نشط' : 'Active' }, { value: 'inactive', label: rtl ? 'غير نشط' : 'Inactive', disabled: originallyActive && Boolean(locks.deactivate) }]} />
      {editing && <UsageNotice usage={usageOf(usage, 'workLocations', form.id)} rtl={rtl} />}
    </MasterDataDrawer>}
  </>;
}
