"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Eye, Pencil, Plus, Search, X } from 'lucide-react';
import type { Row } from '../ui-types';
import type { OrganizationUsage } from '../organization/reference-policy.ts';
import { pick, usageBreakdown } from '../organization/settings-model.ts';
import type { Option } from '../organization/selectors.ts';
import './settings-ui.css';

/** Same locale choices as the rest of the app so Arabic screens show Arabic-Indic digits. */
export const formatCount = (value: number, rtl: boolean) => new Intl.NumberFormat(rtl ? 'ar-SA-u-nu-arab' : 'en-GB').format(value);

/* ------------------------------------------------------------------ navigation */

export type SubnavItem = { id: string; label: string; count?: number; icon?: ReactNode };
/** `primary` groups the area; `secondary` switches between the records of one group. */
export function SettingsSubnav({ items, active, onChange, label, level = 'primary', rtl = false }: { items: SubnavItem[]; active: string; onChange: (id: string) => void; label: string; level?: 'primary' | 'secondary'; rtl?: boolean }) {
  return <nav className={`settings-subnav settings-subnav-${level}`} aria-label={label}>
    {items.map(item => <button type="button" key={item.id} className={active === item.id ? 'active' : ''} aria-current={active === item.id ? 'page' : undefined} onClick={() => onChange(item.id)}>
      {item.icon}<span>{item.label}</span>{item.count !== undefined && <em>{formatCount(item.count, rtl)}</em>}
    </button>)}
  </nav>;
}

/* ------------------------------------------------------------------ badges and notices */

export function StatusBadge({ active, rtl, label, tone }: { active?: boolean; rtl: boolean; label?: string; tone?: string }) {
  const on = Boolean(active);
  return <span className={`status ${tone ?? (on ? 'green' : 'gray')}`}><span />{label ?? (on ? (rtl ? 'نشط' : 'Active') : (rtl ? 'غير نشط' : 'Inactive'))}</span>;
}
export const ReviewBadge = ({ rtl }: { rtl: boolean }) => <StatusBadge rtl={rtl} tone="orange" label={rtl ? 'يحتاج مراجعة' : 'Needs review'} />;

export const InfoNotice = ({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) => <p className={`settings-note ${tone}`} role="note">{children}</p>;

/** Total / active / historical, exactly as the server reports them, plus where the references come from. */
export function UsageNotice({ usage, rtl }: { usage: OrganizationUsage; rtl: boolean }) {
  const lines = usageBreakdown(usage);
  const stats: [string, number][] = [[rtl ? 'الإجمالي' : 'Total', usage.total], [rtl ? 'نشط' : 'Active', usage.active], [rtl ? 'تاريخي' : 'Historical', usage.historical]];
  return <section className="settings-usage" aria-label={rtl ? 'الاستخدام' : 'Usage'}>
    <h4>{rtl ? 'الاستخدام (من الخادم)' : 'Usage (from the server)'}</h4>
    <dl className="settings-usage-stats">{stats.map(([label, value]) => <div key={label}><dd>{formatCount(value, rtl)}</dd><dt>{label}</dt></div>)}</dl>
    {lines.length > 0 && <ul>{lines.map(line => <li key={line.group}><span>{pick(line.label, rtl)}</span><b>{formatCount(line.total, rtl)}</b>{line.active > 0 && <small>{formatCount(line.active, rtl)} {rtl ? 'نشط' : 'active'}</small>}</li>)}</ul>}
    {!lines.length && <p className="settings-muted">{rtl ? 'غير مستخدم حاليًا — يمكن تعديله أو تعطيله بحرية.' : 'Not used anywhere yet — safe to edit or deactivate.'}</p>}
  </section>;
}

/* ------------------------------------------------------------------ form fields */

type FieldBase = { label: string; hint?: string; disabled?: boolean; required?: boolean };

export function TextField({ label, value, onChange, hint, disabled, required, dir, lang, maxLength = 200, type = 'text', min, max, step, inputMode }: FieldBase & { value: unknown; onChange: (value: string) => void; dir?: 'ltr' | 'rtl'; lang?: string; maxLength?: number; type?: string; min?: number; max?: number; step?: number | 'any'; inputMode?: 'numeric' | 'text' }) {
  return <label className="field settings-field"><span>{label}{required && <i aria-hidden="true"> *</i>}</span>
    <input type={type} value={String(value ?? '')} onChange={event => onChange(event.target.value)} disabled={disabled} required={required} dir={dir} lang={lang} maxLength={maxLength} min={min} max={max} step={step} inputMode={inputMode} />
    {hint && <small>{hint}</small>}</label>;
}

export function TextAreaField({ label, value, onChange, hint, disabled, required, maxLength = 1000 }: FieldBase & { value: unknown; onChange: (value: string) => void; maxLength?: number }) {
  return <label className="field settings-field"><span>{label}{required && <i aria-hidden="true"> *</i>}</span>
    <textarea value={String(value ?? '')} onChange={event => onChange(event.target.value)} disabled={disabled} required={required} maxLength={maxLength} dir="auto" />
    {hint && <small>{hint}</small>}</label>;
}

export function SelectField({ label, value, onChange, options, placeholder, hint, disabled, required }: FieldBase & { value: unknown; onChange: (value: string) => void; options: Option[]; placeholder?: string }) {
  const current = String(value ?? '');
  const known = options.some(option => option.value === current);
  return <label className="field settings-field"><span>{label}{required && <i aria-hidden="true"> *</i>}</span>
    <select value={current} onChange={event => onChange(event.target.value)} disabled={disabled} required={required}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {current && !known && <option value={current}>{current}</option>}
      {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled && option.value !== current}>{option.label}</option>)}
    </select>
    {hint && <small>{hint}</small>}</label>;
}

export function CheckField({ label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; hint?: string; disabled?: boolean }) {
  return <label className="settings-check-field"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} /><span><b>{label}</b>{hint && <small>{hint}</small>}</span></label>;
}

/** Arabic name is right-to-left and the English name left-to-right regardless of the interface language. */
export function BilingualFields({ rtl, nameAr, nameEn, onChange, disabled, required = true }: { rtl: boolean; nameAr: unknown; nameEn: unknown; onChange: (key: 'name_ar' | 'name_en', value: string) => void; disabled?: boolean; required?: boolean }) {
  return <div className="form-row">
    <TextField label={rtl ? 'الاسم بالعربية' : 'Arabic name'} value={nameAr} onChange={value => onChange('name_ar', value)} dir="rtl" lang="ar" disabled={disabled} required={required} />
    <TextField label={rtl ? 'الاسم بالإنجليزية' : 'English name'} value={nameEn} onChange={value => onChange('name_en', value)} dir="ltr" lang="en" disabled={disabled} required={required} />
  </div>;
}

export function CheckGroup({ legend, options, selected, onChange, disabled, empty, hint }: { legend: string; options: (Option & { locked?: boolean })[]; selected: string[]; onChange: (values: string[]) => void; disabled?: boolean; empty?: string; hint?: string }) {
  return <fieldset className="settings-checks" disabled={disabled}><legend>{legend}</legend>
    {options.length ? options.map(option => <label key={option.value}>
      <input type="checkbox" checked={selected.includes(option.value)} disabled={option.disabled || (option.locked && selected.includes(option.value))} onChange={event => onChange(event.target.checked ? [...selected, option.value] : selected.filter(value => value !== option.value))} />
      <span>{option.label}</span></label>) : <p className="settings-muted">{empty}</p>}
    {hint && <small>{hint}</small>}
  </fieldset>;
}

/* ------------------------------------------------------------------ table */

export type Column<T> = { key: string; header: string; render: (row: T) => ReactNode; className?: string };

/** Tables collapse into labelled cards below 720px; `data-label` supplies each card row's caption. */
export function MasterDataTable<T extends Row>({ columns, rows, rowKey, emptyTitle, emptyText, caption, actions, actionsLabel }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string | number; emptyTitle: string; emptyText?: string; caption: string; actions?: (row: T) => ReactNode; actionsLabel?: string }) {
  if (!rows.length) return <div className="settings-empty"><h4>{emptyTitle}</h4>{emptyText && <p>{emptyText}</p>}</div>;
  return <div className="settings-table-shell"><div className="settings-table-wrap"><table className="settings-table">
    <caption className="settings-sr">{caption}</caption>
    <thead><tr>{columns.map(column => <th key={column.key} scope="col" className={column.className}>{column.header}</th>)}{actions && <th scope="col" className="settings-actions-col"><span className="settings-sr">{actionsLabel}</span></th>}</tr></thead>
    <tbody>{rows.map(row => <tr key={rowKey(row)}>
      {columns.map(column => <td key={column.key} data-label={column.header} className={column.className}>{column.render(row)}</td>)}
      {actions && <td className="settings-actions-col">{actions(row)}</td>}
    </tr>)}</tbody>
  </table></div></div>;
}

/** Search + status filtering shared by every master-data list. `custom` adds named filters such as "review". */
export function useMasterFilter<T extends Row>(rows: T[], haystack: (row: T) => string, custom?: Record<string, (row: T) => boolean>) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const needle = query.trim().toLocaleLowerCase();
  const byStatus = (row: T) => custom?.[status] ? custom[status](row) : status === 'all' || (status === 'active') === (row.status === 'active');
  const shown = rows.filter(row => byStatus(row) && (!needle || haystack(row).toLocaleLowerCase().includes(needle)));
  return { query, setQuery, status, setStatus, shown };
}

export function MasterDataToolbar({ rtl, query, onQuery, status, onStatus, statusOptions, count, children }: { rtl: boolean; query: string; onQuery: (value: string) => void; status: string; onStatus: (value: string) => void; statusOptions?: Option[]; count: number; children?: ReactNode }) {
  const options = statusOptions ?? [{ value: 'all', label: rtl ? 'كل الحالات' : 'All statuses' }, { value: 'active', label: rtl ? 'نشط' : 'Active' }, { value: 'inactive', label: rtl ? 'غير نشط' : 'Inactive' }];
  return <div className="settings-toolbar">
    <label className="settings-search"><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={event => onQuery(event.target.value)} placeholder={rtl ? 'بحث...' : 'Search...'} aria-label={rtl ? 'بحث' : 'Search'} /></label>
    <select aria-label={rtl ? 'تصفية الحالة' : 'Filter by status'} value={status} onChange={event => onStatus(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    {children}
    <span className="settings-count">{formatCount(count, rtl)} {rtl ? 'نتيجة' : count === 1 ? 'result' : 'results'}</span>
  </div>;
}

/* ------------------------------------------------------------------ drawer */

export function MasterDataDrawer({ rtl, eyebrow, title, subtitle, onClose, onSubmit, submitLabel, busy, error, readOnly, children, review, onDelete, submitDisabled }: { rtl: boolean; eyebrow: string; title: string; subtitle?: string; onClose: () => void; onSubmit?: () => void | Promise<void>; submitLabel?: string; busy?: boolean; error?: string; readOnly?: boolean; children: ReactNode; /** Impact review shown below the fields; stays readable while the form is locked. */ review?: ReactNode; /** Permanent delete, offered only for records nothing references. */ onDelete?: () => void; submitDisabled?: boolean }) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>('input:not([disabled]),select:not([disabled])');
    (first ?? panel.current)?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <div className="modal-layer"><button type="button" className="modal-scrim" onClick={onClose} aria-label={rtl ? 'إغلاق' : 'Close'} />
    <aside className="drawer settings-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panel} dir={rtl ? 'rtl' : 'ltr'}>
      <form onSubmit={event => { event.preventDefault(); if (!readOnly && onSubmit) void onSubmit(); }}>
        <div className="drawer-head"><div><span className="eyebrow">{eyebrow}</span><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="icon-btn" onClick={onClose} aria-label={rtl ? 'إغلاق' : 'Close'}><X size={20} /></button></div>
        <div className="form-body">
          {error && <p className="settings-error" role="alert">{error}</p>}
          <fieldset className="settings-fieldset" disabled={readOnly || busy}>{children}</fieldset>
          {review}
        </div>
        <div className="drawer-footer">{onDelete && !readOnly ? <button type="button" className="outline danger" disabled={busy} onClick={onDelete}>{rtl ? 'حذف نهائي' : 'Delete permanently'}</button> : null}<span className="spacer" />
          <button type="button" className="outline" onClick={onClose}>{readOnly ? (rtl ? 'إغلاق' : 'Close') : (rtl ? 'إلغاء' : 'Cancel')}</button>
          {!readOnly && <button type="submit" className="primary" disabled={busy || submitDisabled}>{busy ? (rtl ? 'جارٍ الحفظ...' : 'Saving...') : (submitLabel ?? (rtl ? 'حفظ' : 'Save'))}</button>}
        </div>
      </form>
    </aside></div>;
}

/* ------------------------------------------------------------------ row and toolbar buttons */

/** "Edit" for managers, "View" for read-only viewers; both open the same drawer. */
export function OpenButton({ rtl, canManage, onClick, name }: { rtl: boolean; canManage: boolean; onClick: () => void; name: string }) {
  const label = canManage ? (rtl ? 'تعديل' : 'Edit') : (rtl ? 'عرض' : 'View');
  return <button type="button" className="outline" onClick={onClick} aria-label={`${label} ${name}`}>{canManage ? <Pencil size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}{label}</button>;
}
export const AddButton = ({ label, onClick }: { label: string; onClick: () => void }) => <button type="button" className="primary" onClick={onClick}><Plus size={16} aria-hidden="true" />{label}</button>;

/** Compact usage for a table cell: active count, with the historical remainder underneath. */
export function UsageCell({ usage, rtl }: { usage: OrganizationUsage; rtl: boolean }) {
  if (!usage.total) return <span className="settings-sub">—</span>;
  return <span className="settings-usage-cell"><b>{formatCount(usage.active, rtl)} {rtl ? 'نشط' : 'active'}</b>{usage.historical > 0 && <small className="settings-sub">{formatCount(usage.historical, rtl)} {rtl ? 'تاريخي' : 'historical'}</small>}</span>;
}
