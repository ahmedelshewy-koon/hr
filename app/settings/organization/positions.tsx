"use client";
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Row } from '../../ui-types';
import { isActive, isRemoved, nameOf, optionsFor, otherNameOf, sectionsOf, titlesForDepartment, unitKind, unitsOfCompany } from '../../organization/selectors.ts';
import { deriveCompanyCeo, lockState, usageOf } from '../../organization/settings-model.ts';
import { AddButton, BilingualFields, CheckField, formatCount, InfoNotice, MasterDataDrawer, MasterDataTable, MasterDataToolbar, OpenButton, SelectField, SettingsSubnav, StatusBadge, TextField, UsageCell, UsageNotice, useMasterFilter } from '../settings-ui';
import { useDrawerForm } from '../use-drawer-form';
import { CeoSummary } from './companies-branches';
import { useOrganization } from './context';
import { ImpactReviewPanel, useImpactReview } from './impact-review';

type Tab = 'positions' | 'titles';

export function PositionsSection() {
  const [tab, setTab] = useState<Tab>('positions');
  const { rtl, catalog } = useOrganization();
  const live = (rows: Row[]) => rows.filter(row => !isRemoved(row)).length;
  return <>
    <SettingsSubnav level="secondary" rtl={rtl} label={rtl ? 'الوظائف والمسميات الوظيفية' : 'Positions and job titles'} active={tab} onChange={id => setTab(id as Tab)}
      items={[{ id: 'positions', label: rtl ? 'الوظائف' : 'Positions', count: live(catalog.positions) }, { id: 'titles', label: rtl ? 'المسميات الوظيفية' : 'Job titles', count: live(catalog.jobTitles) }]} />
    {tab === 'positions' ? <PositionsTab /> : <JobTitlesTab />}
  </>;
}

/** Super Admin only: deletes the record immediately even when in use; the server clears every reference to it. */
function ForceDeleteButton({ entity, row }: { entity: 'positions' | 'jobTitles'; row: Row }) {
  const { rtl, access, forceDeleteEntity } = useOrganization();
  const [busy, setBusy] = useState(false);
  if (!access.canForceDelete) return null;
  const run = async () => {
    setBusy(true);
    try { await forceDeleteEntity(entity, row.id); } catch (reason) { window.alert(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); }
  };
  return <button type="button" className="danger" disabled={busy} aria-label={`${rtl ? 'حذف بالقوة' : 'Force delete'} ${nameOf(row, rtl)}`} title={rtl ? 'للمسؤول فقط: حذف فوري رغم الاستخدام وفك ارتباط كل ما يستخدمه' : 'Admin only: delete now even if in use, detaching everything that uses it'} onClick={() => void run()}>
    <Trash2 size={14} aria-hidden="true" />{rtl ? 'حذف بالقوة' : 'Force delete'}</button>;
}

export function PositionsTab() {
  const { rtl, access, catalog, usage, occupants, saveEntity, previewEntity, deleteEntity } = useOrganization();
  const drawer = useDrawerForm();
  const review = useImpactReview();
  const fmt = (value: number) => formatCount(value, rtl);
  const rows = catalog.positions.filter(row => !isRemoved(row));
  const list = useMasterFilter(rows, row => `${row.name_ar} ${row.name_en} ${row.code}`);
  const form = drawer.form;
  const editing = Boolean(form?.id);
  const locks = lockState(usageOf(usage, 'positions', form?.id), fmt);
  const originallyActive = form?.id ? catalog.positions.find(row => Number(row.id) === Number(form.id))?.status === 'active' : false;
  const unit = (id: unknown) => catalog.departments.find(row => Number(row.id) === Number(id));
  const title = (id: unknown) => catalog.jobTitles.find(row => Number(row.id) === Number(id));
  const companyId = form?.company_id;
  const companyBranchless = Boolean(companyId) && !catalog.companyBranches.some(link => Number(link.company_id) === Number(companyId));
  const otherCeo = form?.is_ceo ? deriveCompanyCeo(companyId, catalog.positions.filter(row => Number(row.id) !== Number(form.id)), occupants) : null;
  const titleOptions = titlesForDepartment(catalog, form?.department_id);
  const path = (row: Row) => [row.department_id, row.section_id].filter(Boolean).map(id => nameOf(unit(id), rtl)).join(' › ') || '—';
  const people = (row: Row) => occupants[String(row.id)] ?? [];

  const open = (row?: Row) => { review.reset(); drawer.open(row ? { ...row, is_ceo: Number(row.is_ceo) === 1 || row.is_ceo === true } : { status: 'active', is_ceo: false }); };
  /** Cascading resets: a changed parent invalidates the choices beneath it. */
  const setCompany = (value: string) => drawer.change({ company_id: value, department_id: '', section_id: '', team_id: '', job_title_id: title(form?.job_title_id)?.department_id ? '' : form?.job_title_id });
  const setDepartment = (value: string) => drawer.change({ department_id: value, section_id: '', team_id: '', job_title_id: title(form?.job_title_id)?.department_id && Number(title(form?.job_title_id)?.department_id) !== Number(value) ? '' : form?.job_title_id });
  const setTitle = (value: string) => { const picked = title(value); drawer.change({ job_title_id: value, ...(picked && !form?.name_ar && !form?.name_en ? { name_ar: picked.name_ar, name_en: picked.name_en } : {}) }); };
  const record = form ? {
    id: form.id, name_ar: form.name_ar, name_en: form.name_en, code: form.code, company_id: form.company_id, department_id: form.department_id, section_id: form.section_id,
    team_id: form.team_id, job_title_id: form.job_title_id, grade_id: form.grade_id, is_ceo: form.is_ceo ? 1 : 0, status: form.status,
  } : null;
  const preview = record?.status === 'inactive' ? review.current(record) : null;
  const save = () => drawer.submit(() => record!.id && record!.status === 'inactive' ? review.run(record!, () => previewEntity('positions', record!), token => saveEntity('positions', { ...record!, confirmImpact: token })) : saveEntity('positions', record!));
  const unused = editing && usageOf(usage, 'positions', form?.id).total === 0;
  const remove = () => { if (window.confirm(rtl ? 'حذف هذه الوظيفة نهائيًا؟ لا يمكن التراجع.' : 'Delete this position permanently? This cannot be undone.')) void drawer.submit(() => deleteEntity('positions', form?.id)); };

  return <>
    <MasterDataToolbar rtl={rtl} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} count={list.shown.length}>
      {access.canManage && <AddButton label={rtl ? 'إضافة وظيفة' : 'Add position'} onClick={() => open()} />}
    </MasterDataToolbar>
    <MasterDataTable caption={rtl ? 'الوظائف' : 'Positions'} rows={list.shown} rowKey={row => row.id} actionsLabel={rtl ? 'الإجراءات' : 'Actions'}
      emptyTitle={rtl ? 'لا توجد وظائف' : 'No positions'} emptyText={rtl ? 'الوظيفة سجل مستقل عن الموظف؛ يشغلها الموظفون من ملفاتهم.' : 'A position is separate from the employee; employees occupy it from their profile.'}
      columns={[
        { key: 'name', header: rtl ? 'الوظيفة' : 'Position', render: row => <span className="settings-name"><b>{nameOf(row, rtl)} {(Number(row.is_ceo) === 1 || row.is_ceo === true) && <span className="settings-chip accent">{rtl ? 'رئيس تنفيذي' : 'CEO'}</span>}</b><small>{otherNameOf(row, rtl)}</small><small dir="ltr">{row.code}</small></span> },
        { key: 'title', header: rtl ? 'المسمى' : 'Job title', render: row => nameOf(title(row.job_title_id), rtl, '—') },
        { key: 'company', header: rtl ? 'الشركة' : 'Company', render: row => nameOf(catalog.companies.find(company => Number(company.id) === Number(row.company_id)), rtl, '—') },
        { key: 'path', header: rtl ? 'الإدارة › القسم' : 'Department › Section', render: row => path(row) },
        { key: 'occupants', header: rtl ? 'الشاغلون' : 'Occupants', render: row => people(row).length ? <span className="settings-name"><b>{people(row).slice(0, 2).map(person => nameOf(person, rtl)).join(rtl ? '، ' : ', ')}</b>{people(row).length > 2 && <small>+{fmt(people(row).length - 2)}</small>}</span> : <span className="settings-chip">{rtl ? 'شاغرة' : 'Vacant'}</span> },
        { key: 'status', header: rtl ? 'الحالة' : 'Status', render: row => <StatusBadge rtl={rtl} active={isActive(row)} /> },
      ]}
      actions={row => <div className="settings-row-actions"><OpenButton rtl={rtl} canManage={access.canManage} name={nameOf(row, rtl)} onClick={() => open(row)} /><ForceDeleteButton entity="positions" row={row} /></div>} />
    {form && <MasterDataDrawer rtl={rtl} readOnly={!access.canManage} busy={drawer.busy} error={drawer.error} onClose={() => { review.reset(); drawer.close(); }} onSubmit={save}
      submitLabel={preview?.ok ? (rtl ? 'تأكيد وحفظ' : 'Confirm and save') : undefined} submitDisabled={Boolean(preview && !preview.ok)} review={<ImpactReviewPanel rtl={rtl} preview={preview} />} onDelete={unused ? remove : undefined}
      eyebrow={rtl ? 'وظيفة' : 'POSITION'} title={editing ? nameOf(form, rtl) : (rtl ? 'وظيفة جديدة' : 'New position')}>
      <BilingualFields rtl={rtl} nameAr={form.name_ar} nameEn={form.name_en} onChange={(key, value) => drawer.change({ [key]: value })} />
      <TextField label={rtl ? 'الرمز' : 'Code'} value={form.code} dir="ltr" maxLength={40} required onChange={value => drawer.change({ code: value })} />
      <SelectField label={rtl ? 'الشركة' : 'Company'} value={form.company_id} required placeholder={rtl ? 'اختر الشركة' : 'Select company'} options={optionsFor(catalog.companies, rtl, form.company_id)} onChange={setCompany} />
      {companyBranchless && <InfoNotice tone="warn">{rtl ? 'اربط الشركة بفرع واحد على الأقل قبل حفظ الوظائف.' : 'Link the company to at least one branch before saving positions.'}</InfoNotice>}
      <SelectField label={rtl ? 'الإدارة' : 'Department'} value={form.department_id} disabled={!companyId} placeholder={rtl ? 'اختر الإدارة' : 'Select department'} onChange={setDepartment}
        options={optionsFor(unitsOfCompany(catalog, companyId, 'department'), rtl, form.department_id)} hint={rtl ? 'تُعدّ الإدارة والقسم في الوظيفة مرجعًا معتمدًا لملف الموظف.' : 'Department and section defined here are authoritative for the employee profile.'} />
      <div className="form-row">
        <SelectField label={rtl ? 'القسم الفرعي (اختياري)' : 'Section (optional)'} value={form.section_id} disabled={!form.department_id} placeholder={rtl ? 'بدون' : 'None'}
          options={optionsFor(sectionsOf(catalog, companyId, form.department_id), rtl, form.section_id)} onChange={value => drawer.change({ section_id: value, team_id: '' })} />
      </div>
      <SelectField label={rtl ? 'المسمى الوظيفي' : 'Job title'} value={form.job_title_id} placeholder={rtl ? 'بدون' : 'None'} onChange={setTitle}
        options={optionsFor(titleOptions, rtl, form.job_title_id, row => `${nameOf(row, rtl)}${row.department_id ? '' : (rtl ? ' — عام' : ' — generic')}`)}
        hint={rtl ? 'المسميات العامة (بلا إدارة) والمسميات التابعة للإدارة المختارة.' : 'Generic titles (no department) and titles of the selected department.'} />
      <CheckField label={rtl ? 'وظيفة الرئيس التنفيذي للشركة' : 'Company CEO position'} checked={Boolean(form.is_ceo)} onChange={value => drawer.change({ is_ceo: value })}
        hint={rtl ? 'تُشتق صفة الرئيس التنفيذي من شاغل هذه الوظيفة؛ لا يوجد نوع موظف خاص. وظيفة نشطة واحدة لكل شركة.' : 'The CEO is derived from whoever occupies this position — there is no special employee type. One active CEO position per company.'} />
      {otherCeo && otherCeo.positions.length > 0 && <InfoNotice tone="warn">{rtl ? 'للشركة وظيفة رئيس تنفيذي نشطة أخرى؛ سيرفض الخادم حفظ ثانية.' : 'This company already has another active CEO position; the server will refuse a second one.'}</InfoNotice>}
      <SelectField label={rtl ? 'الحالة' : 'Status'} value={form.status} onChange={value => drawer.change({ status: value })}
        options={[{ value: 'active', label: rtl ? 'نشط' : 'Active' }, { value: 'inactive', label: rtl ? 'غير نشط' : 'Inactive', disabled: originallyActive && Boolean(locks.deactivate) }]} />
      {editing && <div className="settings-field"><span className="settings-section-title">{rtl ? 'الشاغلون الحاليون' : 'Current occupants'}</span>
        {people(form).length ? <span className="settings-chips">{people(form).map(person => <span className="settings-chip" key={person.id}>{nameOf(person, rtl)}</span>)}</span> : <span className="settings-muted">{rtl ? 'الوظيفة شاغرة.' : 'Vacant.'}</span>}
        {(Number(form.is_ceo) === 1 || form.is_ceo === true) && <div style={{ marginBlockStart: 8 }}><CeoSummary rtl={rtl} ceo={deriveCompanyCeo(companyId, [form], occupants)} /></div>}</div>}
      {editing && <UsageNotice usage={usageOf(usage, 'positions', form.id)} rtl={rtl} />}
    </MasterDataDrawer>}
  </>;
}

export function JobTitlesTab() {
  const { rtl, access, catalog, usage, saveJobTitle, previewJobTitle } = useOrganization();
  const drawer = useDrawerForm();
  const review = useImpactReview();
  const fmt = (value: number) => formatCount(value, rtl);
  const rows = catalog.jobTitles.filter(row => !isRemoved(row));
  const list = useMasterFilter(rows, row => `${row.name_ar} ${row.name_en}`, { generic: row => !row.department_id });
  const form = drawer.form;
  const editing = Boolean(form?.id);
  const writable = editing ? access.canEditJobTitles : access.canCreateJobTitles;
  const locks = lockState(usageOf(usage, 'jobTitles', form?.id), fmt);
  const original = form?.id ? catalog.jobTitles.find(row => Number(row.id) === Number(form.id)) : undefined;
  const originallyActive = original?.status === 'active';
  const department = (id: unknown) => catalog.departments.find(unit => Number(unit.id) === Number(id));
  const companyName = (id: unknown) => nameOf(catalog.companies.find(company => Number(company.id) === Number(id)), rtl);
  // New bindings go to active departments of the new structure; a retained legacy binding stays visible.
  const departmentOptions = catalog.departments.filter(row => !isRemoved(row) && unitKind(row) === 'department' && ((isActive(row) && row.company_id) || Number(row.id) === Number(original?.department_id)))
    .map(row => ({ value: String(row.id), label: `${nameOf(row, rtl)} — ${row.company_id ? companyName(row.company_id) : (rtl ? 'وحدة قديمة (تحتاج مراجعة)' : 'legacy unit (needs review)')}` }));
  const payload = form ? { jobTitleId: form.id ?? null, nameEn: form.name_en, nameAr: form.name_ar, departmentId: form.department_id || null, status: form.status === 'active' ? 'active' : 'archived' } : null;
  const preview = payload?.status === 'archived' ? review.current(payload) : null;
  const open = (row?: Row) => { review.reset(); drawer.open(row ? { ...row, status: row.status === 'active' ? 'active' : 'inactive' } : { status: 'active' }); };
  const save = () => drawer.submit(() => payload!.status === 'active' ? saveJobTitle(payload!) : review.run(payload!, () => previewJobTitle(payload!), token => saveJobTitle({ ...payload!, confirmImpact: token })));
  const statusOptions = [{ value: 'all', label: rtl ? 'كل الحالات' : 'All statuses' }, { value: 'active', label: rtl ? 'نشط' : 'Active' }, { value: 'inactive', label: rtl ? 'غير نشط' : 'Inactive' }, { value: 'generic', label: rtl ? 'مسميات عامة' : 'Generic titles' }];
  const binding = (row: Row) => { const unit = department(row.department_id); return unit && !unit.company_id; };
  return <>
    {access.canManage && !access.canCreateJobTitles && <InfoNotice>{rtl ? 'تعديل المسميات الوظيفية يتطلب أيضًا صلاحية المسميات الوظيفية.' : 'Editing job titles also requires the job-title permission.'}</InfoNotice>}
    <MasterDataToolbar rtl={rtl} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} statusOptions={statusOptions} count={list.shown.length}>
      {access.canCreateJobTitles && <AddButton label={rtl ? 'إضافة مسمى' : 'Add job title'} onClick={() => open()} />}
    </MasterDataToolbar>
    <MasterDataTable caption={rtl ? 'المسميات الوظيفية' : 'Job titles'} rows={list.shown} rowKey={row => row.id} actionsLabel={rtl ? 'الإجراءات' : 'Actions'}
      emptyTitle={rtl ? 'لا توجد مسميات' : 'No job titles'}
      columns={[
        { key: 'name', header: rtl ? 'المسمى' : 'Title', render: row => <span className="settings-name"><b>{nameOf(row, rtl)}</b><small>{otherNameOf(row, rtl)}</small></span> },
        { key: 'department', header: rtl ? 'الإدارة' : 'Department', render: row => row.department_id ? <span className="settings-name"><b>{nameOf(department(row.department_id), rtl, '—')}</b>{binding(row) && <small><span className="settings-chip warn">{rtl ? 'ارتباط قديم — يحتاج مراجعة' : 'Legacy binding — needs review'}</span></small>}</span> : <span className="settings-chip accent">{rtl ? 'عام — كل الإدارات' : 'Generic — all departments'}</span> },
        { key: 'status', header: rtl ? 'الحالة' : 'Status', render: row => <StatusBadge rtl={rtl} active={isActive(row)} /> },
        { key: 'usage', header: rtl ? 'الاستخدام' : 'Usage', render: row => <UsageCell usage={usageOf(usage, 'jobTitles', row.id)} rtl={rtl} /> },
      ]}
      actions={row => <div className="settings-row-actions"><OpenButton rtl={rtl} canManage={access.canEditJobTitles} name={nameOf(row, rtl)} onClick={() => open(row)} /><ForceDeleteButton entity="jobTitles" row={row} /></div>} />
    {form && <MasterDataDrawer rtl={rtl} readOnly={!writable} busy={drawer.busy} error={drawer.error} onClose={() => { review.reset(); drawer.close(); }} onSubmit={save}
      submitLabel={preview?.ok ? (rtl ? 'تأكيد وحفظ' : 'Confirm and save') : undefined} submitDisabled={Boolean(preview && !preview.ok)}
      review={<ImpactReviewPanel rtl={rtl} preview={preview} />}
      eyebrow={rtl ? 'مسمى وظيفي' : 'JOB TITLE'} title={editing ? nameOf(form, rtl) : (rtl ? 'مسمى جديد' : 'New job title')}>
      <BilingualFields rtl={rtl} nameAr={form.name_ar} nameEn={form.name_en} onChange={(key, value) => drawer.change({ [key]: value })} />
      <SelectField label={rtl ? 'الإدارة' : 'Department'} value={form.department_id} placeholder={rtl ? 'عام — متاح لكل الإدارات' : 'Generic — available to every department'} options={departmentOptions} onChange={value => drawer.change({ department_id: value })}
        hint={rtl ? 'اترك الحقل فارغًا لمسمى عام يصلح لأي إدارة. تغيير إدارة المسمى لا ينقل الموظفين أو الوظائف.' : 'Leave empty for a generic title usable in any department. Changing its department does not move employees or positions.'} />
      {editing && original && binding(original) && <InfoNotice tone="warn">{rtl ? 'هذا المسمى مرتبط بوحدة قديمة بلا شركة. اربطه بإدارة من الهيكل الجديد أو اجعله عامًا.' : 'This title is bound to a legacy unit without a company. Bind it to a department of the new structure or make it generic.'}</InfoNotice>}
      <SelectField label={rtl ? 'الحالة' : 'Status'} value={form.status} onChange={value => drawer.change({ status: value })}
        options={[{ value: 'active', label: rtl ? 'نشط' : 'Active' }, { value: 'inactive', label: rtl ? 'غير نشط (مؤرشف)' : 'Inactive (archived)', disabled: originallyActive && Boolean(locks.deactivate) }]} />
      {editing && <UsageNotice usage={usageOf(usage, 'jobTitles', form.id)} rtl={rtl} />}
    </MasterDataDrawer>}
  </>;
}
