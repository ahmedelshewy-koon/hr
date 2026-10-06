"use client";
import type { Row } from '../../ui-types';
import { AddButton, BilingualFields, CheckField, MasterDataDrawer, MasterDataTable, MasterDataToolbar, SelectField, StatusBadge, TextField, useMasterFilter } from '../settings-ui';
import { useDrawerForm } from '../use-drawer-form';
import { field, nameOf, number, otherNameOf, RowActions, statusOptions, type SectionProps } from './shared';

/** Times are HH:MM; an end time earlier than the start time is an overnight shift. */
export function AttendanceTypesSection({ rtl, data, save, remove }: SectionProps) {
  const drawer = useDrawerForm();
  const list = useMasterFilter(data.attendanceTypes, row => `${row.code} ${row.name_ar} ${row.name_en}`);
  const form = drawer.form;
  const hours = (row: Row) => row.start_time && row.end_time
    ? <span dir="ltr">{String(row.start_time)} – {String(row.end_time)}{String(row.end_time) < String(row.start_time) && <small className="settings-sub"> ({rtl ? 'ليلي' : 'overnight'})</small>}</span>
    : <span className="settings-sub">{rtl ? 'مرن' : 'Flexible'}</span>;
  const open = (row?: Row) => drawer.open(row
    ? { ...row, shift_based: Number(row.shift_based) === 1, start_time: field(row.start_time), end_time: field(row.end_time), late_allowance_minutes: field(row.late_allowance_minutes) }
    : { status: 'active', shift_based: false, start_time: '', end_time: '', late_allowance_minutes: '0' });
  const submit = () => drawer.submit(() => save('attendanceTypes', { id: form!.id, code: form!.code, name_en: form!.name_en, name_ar: form!.name_ar, shift_based: form!.shift_based, start_time: form!.start_time, end_time: form!.end_time,
    late_allowance_minutes: form!.late_allowance_minutes, status: form!.status, version: form!.version }));
  return <>
    <MasterDataToolbar rtl={rtl} query={list.query} onQuery={list.setQuery} status={list.status} onStatus={list.setStatus} count={list.shown.length}>
      {data.canManage && <AddButton label={rtl ? 'إضافة نوع حضور' : 'Add attendance type'} onClick={() => open()} />}
    </MasterDataToolbar>
    <MasterDataTable caption={rtl ? 'أنواع الحضور' : 'Attendance types'} rows={list.shown} rowKey={row => row.id} actionsLabel={rtl ? 'الإجراءات' : 'Actions'}
      emptyTitle={rtl ? 'لا توجد أنواع حضور' : 'No attendance types'} emptyText={rtl ? 'أمثلة: دوام مكتبي، وردية مسائية، عمل عن بُعد.' : 'Examples: office hours, evening shift, remote work.'}
      columns={[
        { key: 'code', header: rtl ? 'الرمز' : 'Code', render: row => <b dir="ltr">{String(row.code)}</b> },
        { key: 'name', header: rtl ? 'الاسم' : 'Name', render: row => <span className="settings-name"><b>{nameOf(row, rtl)}</b><small>{otherNameOf(row, rtl)}</small></span> },
        { key: 'shift', header: rtl ? 'قائم على الورديات' : 'Shift based', render: row => <StatusBadge rtl={rtl} tone={Number(row.shift_based) ? 'blue' : 'gray'} label={Number(row.shift_based) ? (rtl ? 'نعم' : 'Yes') : (rtl ? 'لا' : 'No')} /> },
        { key: 'hours', header: rtl ? 'من / إلى' : 'Start / End', render: hours },
        { key: 'late', header: rtl ? 'سماحية التأخير' : 'Late allowance', render: row => Number(row.late_allowance_minutes) ? `${number(row.late_allowance_minutes, rtl, 0)} ${rtl ? 'دقيقة' : 'min'}` : <span className="settings-sub">—</span> },
        { key: 'status', header: rtl ? 'الحالة' : 'Status', render: row => <StatusBadge rtl={rtl} active={row.status === 'active'} /> },
      ]}
      actions={row => <RowActions rtl={rtl} canManage={data.canManage} name={nameOf(row, rtl)} onOpen={() => open(row)}
        onDelete={() => void remove('attendanceTypes', row, rtl ? `حذف نوع الحضور «${nameOf(row, rtl)}» نهائيًا؟` : `Delete the attendance type "${nameOf(row, rtl)}" permanently?`)} />} />
    {form && <MasterDataDrawer rtl={rtl} readOnly={!data.canManage} busy={drawer.busy} error={drawer.error} onClose={drawer.close} onSubmit={submit}
      eyebrow={rtl ? 'نوع حضور' : 'ATTENDANCE TYPE'} title={form.id ? nameOf(form, rtl) : (rtl ? 'نوع حضور جديد' : 'New attendance type')}>
      <TextField label={rtl ? 'الرمز' : 'Code'} required dir="ltr" maxLength={20} value={form.code} onChange={value => drawer.change({ code: value.toUpperCase() })} hint={rtl ? 'مثال: OFFICE أو NIGHT-SHIFT' : 'Example: OFFICE or NIGHT-SHIFT'} />
      <BilingualFields rtl={rtl} nameAr={form.name_ar} nameEn={form.name_en} onChange={(key, value) => drawer.change({ [key]: value })} />
      <CheckField label={rtl ? 'قائم على الورديات' : 'Shift based'} checked={Boolean(form.shift_based)} onChange={value => drawer.change({ shift_based: value })}
        hint={rtl ? 'الأوقات اختيارية للورديات؛ تُحدد كل وردية في جدولها.' : 'Times are optional for shifts; each shift is set in its roster.'} />
      <div className="form-row">
        <TextField label={rtl ? 'وقت البداية' : 'Start time'} type="time" dir="ltr" value={form.start_time} onChange={value => drawer.change({ start_time: value })} />
        <TextField label={rtl ? 'وقت النهاية' : 'End time'} type="time" dir="ltr" value={form.end_time} onChange={value => drawer.change({ end_time: value })} />
      </div>
      <TextField label={rtl ? 'سماحية التأخير (دقيقة)' : 'Late allowance (minutes)'} type="number" min={0} inputMode="numeric" value={form.late_allowance_minutes} onChange={value => drawer.change({ late_allowance_minutes: value })} />
      <SelectField label={rtl ? 'الحالة' : 'Status'} value={form.status} options={statusOptions(rtl)} onChange={value => drawer.change({ status: value })} />
    </MasterDataDrawer>}
  </>;
}
