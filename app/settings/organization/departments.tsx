"use client";
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Row } from '../../ui-types';
import { branchesOfCompany, isActive, isRemoved, nameOf, optionsFor, otherNameOf, parentUnitChoices, scopedBranchIds, unitKind, type UnitKind } from '../../organization/selectors.ts';
import { branchScopeLabel, legacyUnitIsCompany, lockState, unitNeedsReview, usageBreakdown, usageOf } from '../../organization/settings-model.ts';
import { AddButton, BilingualFields, CheckGroup, formatCount, InfoNotice, MasterDataDrawer, MasterDataTable, MasterDataToolbar, OpenButton, ReviewBadge, SelectField, SettingsSubnav, StatusBadge, UsageCell, UsageNotice, useMasterFilter } from '../settings-ui';
import { useDrawerForm } from '../use-drawer-form';
import { useOrganization } from './context';
import { ImpactReviewPanel, useImpactReview } from './impact-review';

const KINDS: { id: UnitKind; ar: string; en: string; oneAr: string; oneEn: string; addAr: string; addEn: string }[] = [
  { id: 'department', ar: 'الإدارات', en: 'Departments', oneAr: 'إدارة', oneEn: 'Department', addAr: 'إضافة إدارة', addEn: 'Add department' },
  { id: 'section', ar: 'الأقسام الفرعية', en: 'Sections', oneAr: 'قسم فرعي', oneEn: 'Section', addAr: 'إضافة قسم فرعي', addEn: 'Add section' },
];

export const unitManagerOptions = (employees: Row[], rtl: boolean) => employees.filter(employee => employee.employment_status !== 'deleted').map(employee => ({ value: String(employee.id), label: `${nameOf(employee, rtl)} — ${employee.employee_code ?? ''}` }));

export function DepartmentsSection() {
  const [kind, setKind] = useState<UnitKind>('department');
  const { rtl, catalog } = useOrganization();
  const count = (id: UnitKind) => catalog.departments.filter(unit => !isRemoved(unit) && unitKind(unit) === id).length;
  return <>
    <SettingsSubnav level="secondary" rtl={rtl} label={rtl ? 'الإدارات والأقسام الفرعية' : 'Departments and sections'} active={kind} onChange={id => setKind(id as UnitKind)}
      items={KINDS.map(item => ({ id: item.id, label: rtl ? item.ar : item.en, count: count(item.id) }))} />
    <UnitsTab key={kind} kind={kind} />
  </>;
}

export function UnitsTab({ kind }: { kind: UnitKind }) {
  const { rtl, access, catalog, usage, employees, hrEmployees, saveEntity, previewEntity, deleteEntity, forceDeleteEntity } = useOrganization();
  const allEmployees = hrEmployees ?? employees;
  const drawer = useDrawerForm();
  const review = useImpactReview();
  const [companyFilter, setCompanyFilter] = useState('');
  const [rowMessage, setRowMessage] = useState<{ tone: 'warn' | 'error'; text: string } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const meta = KINDS.find(item => item.id === kind)!;
  const fmt = (value: number) => formatCount(value, rtl);
  const all = catalog.departments.filter(unit => !isRemoved(unit) && unitKind(unit) === kind);
  const reviewCount = all.filter(unitNeedsReview).length;
  const rows = all.filter(unit => !companyFilter || Number(unit.company_id) === Number(companyFilter));
  const list = useMasterFilter(rows, unit => `${unit.name_ar} ${unit.name_en}`, { review: unitNeedsReview });
  const companyName = (id: unknown) => nameOf(catalog.companies.find(company => Number(company.id) === Number(id)), rtl, '—');
  const managerName = (id: unknown) => { const person = allEmployees.find(employee => Number(employee.id) === Number(id)); return person ? nameOf(person, rtl) : '—'; };

  const form = drawer.form;
  const editing = Boolean(form?.id);
  const legacy = Boolean(form?.id) && unitNeedsReview(catalog.departments.find(unit => Number(unit.id) === Number(form?.id)) ?? {});
  const locks = lockState(usageOf(usage, 'departments', form?.id), fmt);
  const structuralLocked = Boolean(locks.structural) && !legacy;
  const originallyActive = form?.id ? catalog.departments.find(unit => Number(unit.id) === Number(form.id))?.status === 'active' : false;
  const companyId = form?.company_id;
  const scopedBranches = branchesOfCompany(catalog, companyId);
  const currentScope = form?.id ? scopedBranchIds(catalog, form.id).map(String) : [];
  const branchOptions = scopedBranches.filter(branch => isActive(branch) || currentScope.includes(String(branch.id))).map(branch => ({ value: String(branch.id), label: nameOf(branch, rtl) + (isActive(branch) ? '' : (rtl ? ' (غير نشط)' : ' (inactive)')) }));
  const managerOptions = unitManagerOptions(allEmployees, rtl);
  const parents = parentUnitChoices(catalog, kind, companyId, form?.id);

  const open = (unit?: Row) => { review.reset(); drawer.open(unit
    ? { ...unit, organization_kind: kind, parent_id: unitNeedsReview(unit) && kind === 'department' ? '' : unit.parent_id, branch_scope: unit.branch_scope || 'all', branchIds: scopedBranchIds(catalog, unit.id).map(String) }
    : { status: 'active', organization_kind: kind, branch_scope: 'all', branchIds: [] }); };
  const save = () => drawer.submit(async () => {
    if (kind !== 'department' && !form?.parent_id) throw new Error(kind === 'section' ? (rtl ? 'اختر الإدارة التي يتبعها القسم الفرعي' : 'Choose the department this section belongs to') : (rtl ? 'اختر الإدارة أو القسم الفرعي الذي يتبعه الفريق' : 'Choose the department or section this team belongs to'));
    const record = unitRecord!;
    await (record.id ? review.run(record, () => previewEntity('departments', record), token => saveEntity('departments', { ...record, confirmImpact: token })) : saveEntity('departments', record));
  });
  const unitRecord = form ? {
    id: form.id, name_ar: form.name_ar, name_en: form.name_en, company_id: form.company_id, organization_kind: kind,
    parent_id: kind === 'department' ? null : form.parent_id, manager_employee_id: form.manager_employee_id, branch_scope: form.branch_scope, status: form.status,
    branchIds: form.branch_scope === 'selected' ? (form.branchIds ?? []).map(Number) : [],
  } : null;
  const preview = review.current(unitRecord);
  const unused = editing && !legacy && usageOf(usage, 'departments', form?.id).total === 0;
  const remove = () => { if (window.confirm(rtl ? 'حذف هذه الوحدة نهائيًا؟ لا يمكن التراجع.' : 'Delete this unit permanently? This cannot be undone.')) void drawer.submit(() => deleteEntity('departments', form?.id)); };
  /** Same rule as the server: only never-referenced, non-legacy units are deleted; everything else is deactivated. */
  const deleteBlocker = (unit: Row): string | null => {
    if (unitNeedsReview(unit)) return rtl ? `لا يمكن حذف «${nameOf(unit, rtl)}»: الوحدات القديمة لا تُحذف. افتحها لربطها بشركة أو ألغِ تفعيلها.` : `“${nameOf(unit, rtl)}” cannot be deleted: legacy units are never deleted. Open it to adopt it into a company or deactivate it.`;
    const lines = usageBreakdown(usageOf(usage, 'departments', unit.id)).filter(line => line.total > 0);
    if (!lines.length) return null;
    const used = lines.map(line => rtl ? `${line.label.ar}: ${fmt(line.total)}` : `${fmt(line.total)} ${(line.total === 1 && line.label.enOne) || line.label.en}`).join(rtl ? '، ' : ', ');
    return rtl ? `لا يمكن حذف «${nameOf(unit, rtl)}» لأنها مستخدمة (${used}). انقل ما يستخدمها أو ألغِ تفعيلها بدلًا من الحذف.` : `“${nameOf(unit, rtl)}” cannot be deleted because it is in use (${used}). Move what uses it, or deactivate it instead.`;
  };
  const deleteRow = async (unit: Row) => {
    setRowMessage(null);
    const blocker = deleteBlocker(unit);
    if (blocker) { setRowMessage({ tone: 'warn', text: blocker }); return; }
    if (!window.confirm(rtl ? `حذف «${nameOf(unit, rtl)}» نهائيًا؟ لا يمكن التراجع.` : `Delete “${nameOf(unit, rtl)}” permanently? This cannot be undone.`)) return;
    setDeleting(Number(unit.id));
    try { await deleteEntity('departments', unit.id); } catch (reason) { setRowMessage({ tone: 'error', text: reason instanceof Error ? reason.message : String(reason) }); } finally { setDeleting(null); }
  };
  /** Super Admin only: removes the unit and its sub-units immediately, even when in use (no confirmation by request). */
  const forceDeleteRow = async (unit: Row) => {
    setRowMessage(null);
    setDeleting(Number(unit.id));
    try { await forceDeleteEntity('departments', unit.id); } catch (reason) { setRowMessage({ tone: 'error', text: reason instanceof Error ? reason.message : String(reason) }); } finally { setDeleting(null); }
  };
  const statusOptions = [{ value: 'all', label: rtl ? 'كل الحالات' : 'All statuses' }, { value: 'active', label: rtl ? 'نشط' : 'Active' }, { value: 'inactive', label: rtl ? 'غير نشط' : 'Inactive' },
    ...(kind === 'department' && reviewCount ? [{ value: 'review', label: `${rtl ? 'يحتاج مراجعة' : 'Needs review'} (${fmt(reviewCount)})` }] : [])];

  const columns = [
    { key: 'name', header: rtl ? 'الاسم' : 'Name', render: (unit: Row) => <span className="settings-name"><b>{nameOf(unit, rtl)} {unitNeedsReview(unit) && <ReviewBadge rtl={rtl} />}</b><small>{otherNameOf(unit, rtl)}{legacyUnitIsCompany(unit) ? ` · ${rtl ? 'وحدة قديمة بنوع شركة' : 'legacy company-type unit'}` : ''}</small></span> },
    { key: 'company', header: rtl ? 'الشركة' : 'Company', render: (unit: Row) => unit.company_id ? companyName(unit.company_id) : <span className="settings-sub">{rtl ? 'غير مربوطة' : 'Unmapped'}</span> },
    ...(kind === 'department' ? [] : [{ key: 'parent', header: rtl ? 'تتبع' : 'Parent', render: (unit: Row) => nameOf(catalog.departments.find(parent => Number(parent.id) === Number(unit.parent_id)), rtl, '—') }]),
    { key: 'scope', header: rtl ? 'نطاق الفروع' : 'Branch scope', render: (unit: Row) => unitNeedsReview(unit) ? <span className="settings-sub">—</span> : branchScopeLabel(unit, catalog, rtl) },
    { key: 'manager', header: rtl ? 'المسؤول' : 'Manager', render: (unit: Row) => managerName(unit.manager_employee_id) },
    { key: 'status', header: rtl ? 'الحالة' : 'Status', render: (unit: Row) => <span className="settings-name"><StatusBadge rtl={rtl} active={isActive(unit)} />{!isActive(unit) && unit.company_id && <small><span className="settings-chip warn">{rtl ? 'مراجعة النطاق مطلوبة' : 'Scope review required'}</span></small>}</span> },
    { key: 'usage', header: rtl ? 'الاستخدام' : 'Usage', render: (unit: Row) => <UsageCell usage={usageOf(usage, 'departments', unit.id)} rtl={rtl} /> },
  ];

  return <>
    {kind === 'department' && reviewCount > 0 && <InfoNotice tone="warn">{rtl
      ? `${fmt(reviewCount)} وحدة قديمة بلا شركة وتحتاج مراجعة. لا يجري ربطها تلقائيًا بالاسم؛ افتحها لربطها بشركة بعد مراجعة الأثر أو لإلغاء تفعيلها عندما لا يستخدمها أحد.`
      : `${fmt(reviewCount)} legacy units have no company and need review. They are never mapped by name; open one to adopt it into a company after an impact review, or to deactivate it once nothing uses it.`}</InfoNotice>}
    <MasterDataToolbar rtl={rtl} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} statusOptions={statusOptions} count={list.shown.length}>
      <select aria-label={rtl ? 'تصفية الشركة' : 'Filter by company'} value={companyFilter} onChange={event => setCompanyFilter(event.target.value)}>
        <option value="">{rtl ? 'كل الشركات' : 'All companies'}</option>{catalog.companies.filter(company => !isRemoved(company)).map(company => <option key={company.id} value={company.id}>{nameOf(company, rtl)}</option>)}
      </select>
      {access.canManage && <AddButton label={rtl ? meta.addAr : meta.addEn} onClick={() => open()} />}
    </MasterDataToolbar>
    {rowMessage && <p className={rowMessage.tone === 'error' ? 'settings-error' : 'settings-note warn'} role="alert"><span>{rowMessage.text}</span></p>}
    <MasterDataTable caption={rtl ? meta.ar : meta.en} rows={list.shown} rowKey={unit => unit.id} columns={columns} actionsLabel={rtl ? 'الإجراءات' : 'Actions'}
      emptyTitle={rtl ? 'لا توجد سجلات' : 'No records'} emptyText={kind === 'department' ? (rtl ? 'أضف إدارة لكل شركة. الأقسام الفرعية اختيارية.' : 'Add a department per company. Sections are optional.') : (rtl ? 'هذا المستوى اختياري؛ أضفه فقط عند الحاجة.' : 'This level is optional; add it only when needed.')}
      actions={unit => <div className="settings-row-actions">
        <OpenButton rtl={rtl} canManage={access.canManage} name={nameOf(unit, rtl)} onClick={() => open(unit)} />
        {access.canManage && <button type="button" className={`outline danger${deleteBlocker(unit) ? ' is-blocked' : ''}`} disabled={deleting === Number(unit.id)} aria-label={`${rtl ? 'حذف' : 'Delete'} ${nameOf(unit, rtl)}`} title={deleteBlocker(unit) ?? undefined} onClick={() => void deleteRow(unit)}>
          <Trash2 size={14} aria-hidden="true" />{rtl ? 'حذف' : 'Delete'}</button>}
        {access.canForceDelete && deleteBlocker(unit) && <button type="button" className="danger" disabled={deleting === Number(unit.id)} aria-label={`${rtl ? 'حذف بالقوة' : 'Force delete'} ${nameOf(unit, rtl)}`} title={rtl ? 'للمسؤول فقط: حذف الوحدة رغم استخدامها وفك ارتباط كل ما يستخدمها' : 'Admin only: delete the unit even though it is in use, detaching everything that uses it'} onClick={() => void forceDeleteRow(unit)}>
          <Trash2 size={14} aria-hidden="true" />{rtl ? 'حذف بالقوة' : 'Force delete'}</button>}
      </div>} />
    {form && <MasterDataDrawer rtl={rtl} readOnly={!access.canManage} busy={drawer.busy} error={drawer.error} onClose={() => { review.reset(); drawer.close(); }} onSubmit={save}
      submitLabel={preview?.ok ? (rtl ? 'تأكيد وحفظ' : 'Confirm and save') : undefined} submitDisabled={Boolean(preview && !preview.ok)} review={<ImpactReviewPanel rtl={rtl} preview={preview} />} onDelete={unused ? remove : undefined}
      eyebrow={(rtl ? meta.oneAr : meta.oneEn).toUpperCase()} title={editing ? nameOf(form, rtl) : (rtl ? meta.addAr : meta.addEn)}>
      {legacy && <InfoNotice tone="warn">{rtl ? 'وحدة قديمة بلا شركة. يمكنك ربطها بشركة بعد مراجعة الأثر (يجب أن يكون كل موظفيها الحاليين في تلك الشركة)، أو إلغاء تفعيلها بعد نقل مستخدميها. لا تُربط تلقائيًا بالاسم.' : 'Legacy unit without a company. You can adopt it into a company after reviewing the impact (all its current employees must already be in that company), or deactivate it once nothing uses it. It is never mapped automatically by name.'}</InfoNotice>}
      {!legacy && editing && form.status !== 'active' && form.company_id && <InfoNotice tone="warn">{rtl ? 'مراجعة النطاق مطلوبة: لا تُفعَّل الوحدة تلقائيًا. عند التفعيل ستُعرض عليك مراجعة نطاق الفروع للتأكيد.' : 'Scope review required: this unit is never activated automatically. Activating it asks you to confirm its branch scope first.'}</InfoNotice>}
      <BilingualFields rtl={rtl} nameAr={form.name_ar} nameEn={form.name_en} onChange={(key, value) => drawer.change({ [key]: value })} />
      <SelectField label={rtl ? 'الشركة' : 'Company'} value={form.company_id} required placeholder={rtl ? 'اختر الشركة' : 'Select company'} disabled={structuralLocked}
        options={optionsFor(catalog.companies, rtl, form.company_id)} onChange={value => drawer.change({ company_id: value, parent_id: '', branchIds: [] })} />
      {kind !== 'department' && <SelectField label={kind === 'section' ? (rtl ? 'الإدارة' : 'Department') : (rtl ? 'تتبع (إدارة أو قسم فرعي)' : 'Parent (department or section)')} value={form.parent_id} required placeholder={rtl ? 'اختر' : 'Select'} disabled={structuralLocked || legacy || !companyId}
        options={optionsFor(parents, rtl, form.parent_id, unit => `${nameOf(unit, rtl)}${kind === 'team' && unitKind(unit) === 'section' ? (rtl ? ' — قسم فرعي' : ' — section') : ''}`)} onChange={value => drawer.change({ parent_id: value })}
        hint={!companyId ? (rtl ? 'اختر الشركة أولًا.' : 'Choose the company first.') : undefined} />}
      <SelectField label={rtl ? 'مسؤول الوحدة' : 'Unit manager'} value={form.manager_employee_id} placeholder={rtl ? 'بدون' : 'None'}
        options={managerOptions} onChange={value => drawer.change({ manager_employee_id: value })} />
      <SelectField label={rtl ? 'نطاق الفروع' : 'Branch scope'} value={form.branch_scope} onChange={value => drawer.change({ branch_scope: value, branchIds: value === 'all' ? [] : form.branchIds })}
        options={[{ value: 'all', label: rtl ? 'كل فروع الشركة' : 'All company branches' }, { value: 'selected', label: rtl ? 'فروع محددة' : 'Selected branches' }]}
        hint={rtl ? 'وحدة واحدة مشتركة بين الفروع؛ لا تكرر الإدارة لكل فرع. يُرفض إخراج فرع يعمل فيه موظفون حاليون لهذه الوحدة.' : 'One shared unit can span branches — do not duplicate it per branch. Removing a branch where current employees of this unit work is refused.'} />
      {form.branch_scope === 'selected' && <CheckGroup legend={rtl ? 'الفروع المتاحة للوحدة' : 'Branches for this unit'} options={branchOptions} selected={form.branchIds ?? []} onChange={values => drawer.change({ branchIds: values })}
        empty={companyId ? (rtl ? 'الشركة غير مرتبطة بفروع.' : 'This company has no branches yet.') : (rtl ? 'اختر الشركة أولًا.' : 'Choose the company first.')} />}
      <SelectField label={rtl ? 'الحالة' : 'Status'} value={form.status} onChange={value => drawer.change({ status: value })}
        options={[{ value: 'active', label: rtl ? 'نشط' : 'Active' }, { value: 'inactive', label: rtl ? 'غير نشط' : 'Inactive', disabled: originallyActive && Boolean(locks.deactivate) }]} />
      {editing && <UsageNotice usage={usageOf(usage, 'departments', form.id)} rtl={rtl} />}
    </MasterDataDrawer>}
  </>;
}
