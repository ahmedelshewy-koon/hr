"use client";
import type { Row } from '../../ui-types';
import { AddButton, BilingualFields, CheckField, MasterDataDrawer, MasterDataTable, MasterDataToolbar, SelectField, StatusBadge, TextAreaField, TextField, useMasterFilter } from '../settings-ui';
import { useDrawerForm } from '../use-drawer-form';
import { field, nameOf, number, otherNameOf, RowActions, statusOptions, type SectionProps } from './shared';

const COVERAGE = [{ value: 'basic', ar: 'أساسي', en: 'Basic' }, { value: 'standard', ar: 'قياسي', en: 'Standard' }, { value: 'premium', ar: 'مميز', en: 'Premium' }, { value: 'vip', ar: 'كبار الشخصيات', en: 'VIP' }];
const CURRENCIES = [{ value: 'SAR', ar: 'ريال سعودي', en: 'SAR' }, { value: 'EGP', ar: 'جنيه مصري', en: 'EGP' }];
const coverageLabel = (value: unknown, rtl: boolean) => { const item = COVERAGE.find(entry => entry.value === value); return item ? (rtl ? item.ar : item.en) : '—'; };

/** Employee and company contributions are percentages of the premium and must add up to 100. */
export function MedicalPlansSection({ rtl, data, save, remove }: SectionProps) {
  const drawer = useDrawerForm();
  const list = useMasterFilter(data.medicalPlans, row => `${row.name_ar} ${row.name_en} ${row.provider} ${coverageLabel(row.coverage_type, rtl)}`);
  const form = drawer.form;
  const money = (row: Row) => `${number(row.max_coverage, rtl, 0)} ${row.currency}`;
  const open = (row?: Row) => drawer.open(row
    ? { ...row, max_coverage: field(row.max_coverage), employee_contribution: field(row.employee_contribution), company_contribution: field(row.company_contribution), family_coverage: Number(row.family_coverage) === 1 }
    : { status: 'active', coverage_type: 'standard', currency: 'SAR', employee_contribution: '0', company_contribution: '100', family_coverage: false });
  // Keeping the pair at 100% as the user types removes the most common validation error.
  const contribution = (key: 'employee_contribution' | 'company_contribution', value: string) => {
    const other = key === 'employee_contribution' ? 'company_contribution' : 'employee_contribution';
    const parsed = Number(value);
    drawer.change(value !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? { [key]: value, [other]: String(Math.round((100 - parsed) * 100) / 100) } : { [key]: value });
  };
  const submit = () => drawer.submit(() => save('medicalPlans', { id: form!.id, name_en: form!.name_en, name_ar: form!.name_ar, provider: form!.provider, coverage_type: form!.coverage_type, max_coverage: form!.max_coverage, currency: form!.currency,
    employee_contribution: form!.employee_contribution, company_contribution: form!.company_contribution, family_coverage: form!.family_coverage, description: form!.description, status: form!.status, version: form!.version }));
  return <>
    <MasterDataToolbar rtl={rtl} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} count={list.shown.length}>
      {data.canManage && <AddButton label={rtl ? 'إضافة خطة' : 'Add plan'} onClick={() => open()} />}
    </MasterDataToolbar>
    <MasterDataTable caption={rtl ? 'خطط التأمين الطبي' : 'Medical insurance plans'} rows={list.shown} rowKey={row => row.id} actionsLabel={rtl ? 'الإجراءات' : 'Actions'}
      emptyTitle={rtl ? 'لا توجد خطط تأمين' : 'No insurance plans'} emptyText={rtl ? 'أضف خطط التأمين الطبي المتاحة للموظفين.' : 'Add the medical insurance plans offered to employees.'}
      columns={[
        { key: 'name', header: rtl ? 'الخطة' : 'Plan', render: row => <span className="settings-name"><b>{nameOf(row, rtl)}</b><small>{otherNameOf(row, rtl)}</small></span> },
        { key: 'provider', header: rtl ? 'شركة التأمين' : 'Provider', render: row => String(row.provider) },
        { key: 'coverage', header: rtl ? 'نوع التغطية' : 'Coverage', render: row => <StatusBadge rtl={rtl} tone="blue" label={coverageLabel(row.coverage_type, rtl)} /> },
        { key: 'max', header: rtl ? 'الحد الأقصى' : 'Maximum coverage', render: row => <span dir="ltr">{money(row)}</span> },
        { key: 'split', header: rtl ? 'الموظف / الشركة' : 'Employee / Company', render: row => <span dir="ltr">{number(row.employee_contribution, rtl)}% / {number(row.company_contribution, rtl)}%</span> },
        { key: 'family', header: rtl ? 'تغطية العائلة' : 'Family', render: row => <StatusBadge rtl={rtl} tone={Number(row.family_coverage) ? 'green' : 'gray'} label={Number(row.family_coverage) ? (rtl ? 'مشمولة' : 'Included') : (rtl ? 'غير مشمولة' : 'Not included')} /> },
        { key: 'status', header: rtl ? 'الحالة' : 'Status', render: row => <StatusBadge rtl={rtl} active={row.status === 'active'} /> },
      ]}
      actions={row => <RowActions rtl={rtl} canManage={data.canManage} name={nameOf(row, rtl)} onOpen={() => open(row)}
        onDelete={() => void remove('medicalPlans', row, rtl ? `حذف الخطة «${nameOf(row, rtl)}» نهائيًا؟` : `Delete the plan "${nameOf(row, rtl)}" permanently?`)} />} />
    {form && <MasterDataDrawer rtl={rtl} readOnly={!data.canManage} busy={drawer.busy} error={drawer.error} onClose={drawer.close} onSubmit={submit}
      eyebrow={rtl ? 'خطة تأمين طبي' : 'MEDICAL INSURANCE PLAN'} title={form.id ? nameOf(form, rtl) : (rtl ? 'خطة جديدة' : 'New plan')}>
      <BilingualFields rtl={rtl} nameAr={form.name_ar} nameEn={form.name_en} onChange={(key, value) => drawer.change({ [key]: value })} />
      <div className="form-row">
        <TextField label={rtl ? 'شركة التأمين' : 'Insurance provider'} required value={form.provider} onChange={value => drawer.change({ provider: value })} />
        <SelectField label={rtl ? 'نوع التغطية' : 'Coverage type'} required value={form.coverage_type} options={COVERAGE.map(item => ({ value: item.value, label: rtl ? item.ar : item.en }))} onChange={value => drawer.change({ coverage_type: value })} />
      </div>
      <div className="form-row">
        <TextField label={rtl ? 'الحد الأقصى للتغطية' : 'Maximum coverage'} type="number" min={1} required value={form.max_coverage} onChange={value => drawer.change({ max_coverage: value })} />
        <SelectField label={rtl ? 'العملة' : 'Currency'} required value={form.currency} options={CURRENCIES.map(item => ({ value: item.value, label: rtl ? item.ar : item.en }))} onChange={value => drawer.change({ currency: value })} />
      </div>
      <div className="form-row">
        <TextField label={rtl ? 'مساهمة الموظف (٪)' : 'Employee contribution (%)'} type="number" min={0} required value={form.employee_contribution} onChange={value => contribution('employee_contribution', value)} />
        <TextField label={rtl ? 'مساهمة الشركة (٪)' : 'Company contribution (%)'} type="number" min={0} required value={form.company_contribution} onChange={value => contribution('company_contribution', value)} hint={rtl ? 'مجموع المساهمتين 100٪.' : 'The two contributions add up to 100%.'} />
      </div>
      <CheckField label={rtl ? 'تشمل تغطية العائلة' : 'Includes family coverage'} checked={Boolean(form.family_coverage)} onChange={value => drawer.change({ family_coverage: value })} />
      <SelectField label={rtl ? 'الحالة' : 'Status'} value={form.status} options={statusOptions(rtl)} onChange={value => drawer.change({ status: value })} />
      <TextAreaField label={rtl ? 'الوصف' : 'Description'} value={form.description} onChange={value => drawer.change({ description: value })} />
    </MasterDataDrawer>}
  </>;
}
