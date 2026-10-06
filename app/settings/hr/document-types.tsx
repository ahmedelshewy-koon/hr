"use client";
import type { Row } from '../../ui-types';
import { AddButton, BilingualFields, CheckField, formatCount, InfoNotice, MasterDataDrawer, MasterDataTable, MasterDataToolbar, SelectField, StatusBadge, TextAreaField, useMasterFilter } from '../settings-ui';
import { useDrawerForm } from '../use-drawer-form';
import { nameOf, otherNameOf, RowActions, statusOptions, type SectionProps } from './shared';

/** The document types employees upload against (document_categories); the code is generated once and never changes. */
export function DocumentTypesSection({ rtl, data, save, remove }: SectionProps) {
  const drawer = useDrawerForm();
  const list = useMasterFilter(data.documentTypes, row => `${row.name_ar} ${row.name_en} ${row.code} ${row.description ?? ''}`);
  const form = drawer.form;
  const used = (row: Row) => Number(row.documents) > 0;
  const open = (row?: Row) => drawer.open(row ? { ...row, required_document: Number(row.required_document) === 1 } : { status: 'active', required_document: false });
  const submit = () => drawer.submit(() => save('documentTypes', { id: form!.id, name_en: form!.name_en, name_ar: form!.name_ar, required_document: form!.required_document, status: form!.status, description: form!.description, version: form!.version }));
  return <>
    <MasterDataToolbar rtl={rtl} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} count={list.shown.length}>
      {data.canManage && <AddButton label={rtl ? 'إضافة نوع مستند' : 'Add document type'} onClick={() => open()} />}
    </MasterDataToolbar>
    <MasterDataTable caption={rtl ? 'أنواع المستندات' : 'Document types'} rows={list.shown} rowKey={row => row.id} actionsLabel={rtl ? 'الإجراءات' : 'Actions'}
      emptyTitle={rtl ? 'لا توجد أنواع مستندات' : 'No document types'} emptyText={rtl ? 'أضف الأنواع التي يرفعها الموظفون مثل العقد والهوية.' : 'Add the types employees upload, such as contracts and IDs.'}
      columns={[
        { key: 'name', header: rtl ? 'نوع المستند' : 'Document type', render: row => <span className="settings-name"><b>{nameOf(row, rtl)}</b><small>{otherNameOf(row, rtl)}</small></span> },
        { key: 'required', header: rtl ? 'الإلزام' : 'Requirement', render: row => <StatusBadge rtl={rtl} tone={Number(row.required_document) ? 'orange' : 'gray'} label={Number(row.required_document) ? (rtl ? 'إلزامي' : 'Mandatory') : (rtl ? 'اختياري' : 'Optional')} /> },
        { key: 'description', header: rtl ? 'الوصف' : 'Description', render: row => row.description ? String(row.description) : <span className="settings-sub">—</span> },
        { key: 'documents', header: rtl ? 'المستندات' : 'Documents', render: row => used(row) ? formatCount(Number(row.documents), rtl) : <span className="settings-sub">—</span> },
        { key: 'status', header: rtl ? 'الحالة' : 'Status', render: row => <StatusBadge rtl={rtl} active={row.status === 'active'} /> },
      ]}
      actions={row => <RowActions rtl={rtl} canManage={data.canManage} name={nameOf(row, rtl)} onOpen={() => open(row)}
        blocked={used(row) ? (rtl ? 'مستخدم في مستندات الموظفين؛ عطّله بدلًا من حذفه' : 'Used by employee documents; deactivate it instead') : undefined}
        onDelete={() => void remove('documentTypes', row, rtl ? `حذف نوع المستند «${nameOf(row, rtl)}» نهائيًا؟` : `Delete the document type "${nameOf(row, rtl)}" permanently?`)} />} />
    {form && <MasterDataDrawer rtl={rtl} readOnly={!data.canManage} busy={drawer.busy} error={drawer.error} onClose={drawer.close} onSubmit={submit}
      eyebrow={rtl ? 'نوع مستند' : 'DOCUMENT TYPE'} title={form.id ? nameOf(form, rtl) : (rtl ? 'نوع مستند جديد' : 'New document type')}>
      <BilingualFields rtl={rtl} nameAr={form.name_ar} nameEn={form.name_en} onChange={(key, value) => drawer.change({ [key]: value })} />
      <CheckField label={rtl ? 'مستند إلزامي' : 'Mandatory document'} checked={Boolean(form.required_document)} onChange={value => drawer.change({ required_document: value })}
        hint={rtl ? 'يظهر في تنبيهات المستندات الناقصة للموظفين الذين لم يرفعوه.' : 'Shows in missing-document alerts for employees who have not uploaded it.'} />
      <SelectField label={rtl ? 'الحالة' : 'Status'} value={form.status} options={statusOptions(rtl)} onChange={value => drawer.change({ status: value })} />
      <TextAreaField label={rtl ? 'الوصف' : 'Description'} value={form.description} onChange={value => drawer.change({ description: value })} />
      {form.id && used(form) && <InfoNotice>{rtl ? `مستخدم في ${formatCount(Number(form.documents), rtl)} مستند؛ لا يمكن حذفه ويمكن تعطيله.` : `Used by ${formatCount(Number(form.documents), rtl)} document(s); it can be deactivated but not deleted.`}</InfoNotice>}
    </MasterDataDrawer>}
  </>;
}
