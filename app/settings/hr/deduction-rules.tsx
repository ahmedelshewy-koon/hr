"use client";
import type { Row } from '../../ui-types';
import { AddButton, BilingualFields, MasterDataDrawer, MasterDataTable, MasterDataToolbar, SelectField, StatusBadge, TextField, useMasterFilter } from '../settings-ui';
import { useDrawerForm } from '../use-drawer-form';
import { field, nameOf, number, otherNameOf, RowActions, statusOptions, type SectionProps } from './shared';

const RULE_TYPES = [{ value: 'absence', ar: 'غياب', en: 'Absence', tone: 'red' }, { value: 'late_arrival', ar: 'تأخير', en: 'Late Arrival', tone: 'orange' }, { value: 'overtime', ar: 'عمل إضافي', en: 'Overtime', tone: 'green' }];
const DEDUCTION_TYPES = [{ value: 'fixed_amount', ar: 'مبلغ ثابت', en: 'Fixed amount' }, { value: 'daily_wage_percent', ar: 'نسبة مئوية', en: '% of daily wage' }, { value: 'days_of_wage', ar: 'أيام من الأجر', en: 'Days of wage' }];
const NOTICE_OPTIONS = [{ value: '', ar: 'كل حالات الغياب', en: 'All absences' }, { value: 'with_notice', ar: 'بإشعار', en: 'With notice' }, { value: 'without_notice', ar: 'بدون إشعار', en: 'Without notice' }];
const label = (list: { value: string; ar: string; en: string }[], value: unknown, rtl: boolean) => { const item = list.find(entry => entry.value === value); return item ? (rtl ? item.ar : item.en) : '—'; };

/** Nonzero deductions cannot overlap; notice conditions distinguish absence rules. */
export function DeductionRulesSection({ rtl, data, save, remove }: SectionProps) {
  const drawer = useDrawerForm();
  const list = useMasterFilter(data.deductionRules, row => `${row.name_ar} ${row.name_en} ${label(RULE_TYPES, row.rule_type, rtl)}`);
  const form = drawer.form;
  const overtime = form?.rule_type === 'overtime';
  const range = (row: Row) => row.min_minutes === null || row.min_minutes === undefined ? '—' : row.max_minutes === null || row.max_minutes === undefined
    ? (rtl ? `${number(row.min_minutes, rtl)}+ دقيقة` : `${number(row.min_minutes, rtl)}+ min`)
    : (rtl ? `${number(row.min_minutes, rtl)} – ${number(row.max_minutes, rtl)} دقيقة` : `${number(row.min_minutes, rtl)}–${number(row.max_minutes, rtl)} min`);
  const value = (row: Row) => row.deduction_type === 'daily_wage_percent' ? `${number(row.value, rtl)}%` : row.deduction_type === 'days_of_wage' ? `${number(row.value, rtl)} ${rtl ? 'يوم' : 'day(s)'}` : row.value === null ? '—' : number(row.value, rtl);
  const open = (row?: Row) => drawer.open(row ? { ...row, absence_notice: field(row.absence_notice), min_minutes: field(row.min_minutes), max_minutes: field(row.max_minutes), value: field(row.rule_type === 'overtime' ? row.value ?? 1 : row.value), overtime_multiplier: field(row.overtime_multiplier) } : { status: 'active', rule_type: 'late_arrival', deduction_type: 'daily_wage_percent', absence_notice: '', min_minutes: '0', max_minutes: '', value: '', overtime_multiplier: '' });
  const submit = () => drawer.submit(() => save('deductionRules', { id: form!.id, name_en: form!.name_en, name_ar: form!.name_ar, rule_type: form!.rule_type, min_minutes: form!.min_minutes, max_minutes: form!.max_minutes,
    absence_notice: form!.rule_type === 'absence' ? form!.absence_notice : null, deduction_type: overtime ? 'hourly' : form!.deduction_type, value: form!.value, overtime_multiplier: overtime ? form!.overtime_multiplier : null, status: form!.status, version: form!.version }));
  return <>
    <MasterDataToolbar rtl={rtl} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} count={list.shown.length}>
      {data.canManage && <AddButton label={rtl ? 'إضافة قاعدة' : 'Add rule'} onClick={() => open()} />}
    </MasterDataToolbar>
    <MasterDataTable caption={rtl ? 'قواعد الخصم والعمل الإضافي' : 'Deduction and overtime rules'} rows={list.shown} rowKey={row => row.id} actionsLabel={rtl ? 'الإجراءات' : 'Actions'}
      emptyTitle={rtl ? 'لا توجد قواعد' : 'No rules yet'} emptyText={rtl ? 'مثال: تأخير من 16 إلى 30 دقيقة يخصم 25٪ من أجر اليوم.' : 'Example: late arrival of 16–30 minutes deducts 25% of the daily wage.'}
      columns={[
        { key: 'name', header: rtl ? 'القاعدة' : 'Rule', render: row => <span className="settings-name"><b>{nameOf(row, rtl)}</b><small>{otherNameOf(row, rtl)}</small>{row.rule_type === 'absence' && Boolean(row.absence_notice) && <small>{label(NOTICE_OPTIONS, row.absence_notice, rtl)}</small>}</span> },
        { key: 'type', header: rtl ? 'النوع' : 'Type', render: row => <StatusBadge rtl={rtl} tone={RULE_TYPES.find(item => item.value === row.rule_type)?.tone ?? 'gray'} label={label(RULE_TYPES, row.rule_type, rtl)} /> },
        { key: 'range', header: rtl ? 'نطاق الدقائق' : 'Minute range', render: row => <span dir={rtl ? 'rtl' : 'ltr'}>{range(row)}</span> },
        { key: 'deduction', header: rtl ? 'نوع الخصم' : 'Deduction type', render: row => row.rule_type === 'overtime' ? (rtl ? 'بالساعة' : 'Hourly') : label(DEDUCTION_TYPES, row.deduction_type, rtl) },
        { key: 'value', header: rtl ? 'القيمة' : 'Value', render: row => row.rule_type === 'overtime' ? number(row.value ?? 1, rtl) : value(row) },
        { key: 'multiplier', header: rtl ? 'معامل الإضافي' : 'Overtime multiplier', render: row => row.rule_type === 'overtime' ? `×${number(row.overtime_multiplier, rtl)}` : <span className="settings-sub">—</span> },
        { key: 'status', header: rtl ? 'الحالة' : 'Status', render: row => <StatusBadge rtl={rtl} active={row.status === 'active'} /> },
      ]}
      actions={row => <RowActions rtl={rtl} canManage={data.canManage} name={nameOf(row, rtl)} onOpen={() => open(row)}
        onDelete={() => void remove('deductionRules', row, rtl ? `حذف القاعدة «${nameOf(row, rtl)}» نهائيًا؟` : `Delete the rule "${nameOf(row, rtl)}" permanently?`)} />} />
    {form && <MasterDataDrawer rtl={rtl} readOnly={!data.canManage} busy={drawer.busy} error={drawer.error} onClose={drawer.close} onSubmit={submit}
      eyebrow={rtl ? 'قاعدة خصم أو عمل إضافي' : 'DEDUCTION / OVERTIME RULE'} title={form.id ? nameOf(form, rtl) : (rtl ? 'قاعدة جديدة' : 'New rule')}>
      <BilingualFields rtl={rtl} nameAr={form.name_ar} nameEn={form.name_en} onChange={(key, next) => drawer.change({ [key]: next })} />
      <SelectField label={rtl ? 'النوع' : 'Type'} required value={form.rule_type} options={RULE_TYPES.map(item => ({ value: item.value, label: rtl ? item.ar : item.en }))} onChange={next => drawer.change({ rule_type: next, deduction_type: next === 'overtime' ? 'hourly' : form.deduction_type === 'hourly' ? 'daily_wage_percent' : form.deduction_type || 'daily_wage_percent', value: next === 'overtime' ? '1' : form.value, min_minutes: next === 'late_arrival' ? form.min_minutes || '0' : '', max_minutes: '', absence_notice: '' })} />
      {form.rule_type === 'absence' && <SelectField label={rtl ? 'الإشعار' : 'Notice'} value={form.absence_notice} options={NOTICE_OPTIONS.map(item => ({ value: item.value, label: rtl ? item.ar : item.en }))} onChange={next => drawer.change({ absence_notice: next })} />}
      {(form.rule_type === 'late_arrival' || Boolean(form.min_minutes)) &&
      <div className="form-row">
        <TextField label={rtl ? 'من (دقيقة)' : 'From (minutes)'} type="number" min={0} inputMode="numeric" required value={form.min_minutes} onChange={next => drawer.change({ min_minutes: next })} />
        <TextField label={rtl ? 'إلى (دقيقة)' : 'To (minutes)'} type="number" min={0} inputMode="numeric" value={form.max_minutes} onChange={next => drawer.change({ max_minutes: next })} hint={rtl ? 'اتركه فارغًا لنطاق مفتوح.' : 'Leave empty for an open-ended range.'} />
      </div>}
      {overtime
        ? <div className="form-row">
          <TextField label={rtl ? 'القيمة (بالساعة)' : 'Value (hours)'} type="number" min={0.01} max={24} step="any" required value={form.value} onChange={next => drawer.change({ value: next })} />
          <TextField label={rtl ? 'معامل الإضافي' : 'Overtime multiplier'} type="number" min={1} max={10} step="any" required value={form.overtime_multiplier} onChange={next => drawer.change({ overtime_multiplier: next })} hint={rtl ? 'مثال: 1.5 يعني أجر الساعة × 1.5.' : 'Example: 1.5 means the hourly wage × 1.5.'} />
        </div>
        : <div className="form-row">
          <SelectField label={rtl ? 'نوع الخصم' : 'Deduction type'} required value={form.deduction_type} options={DEDUCTION_TYPES.map(item => ({ value: item.value, label: rtl ? item.ar : item.en }))} onChange={next => drawer.change({ deduction_type: next })} />
          <TextField label={rtl ? 'القيمة' : 'Value'} type="number" min={0} required value={form.value} onChange={next => drawer.change({ value: next })} />
        </div>}
      <SelectField label={rtl ? 'الحالة' : 'Status'} value={form.status} options={statusOptions(rtl)} onChange={next => drawer.change({ status: next })} />
    </MasterDataDrawer>}
  </>;
}
