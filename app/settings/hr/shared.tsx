"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Row } from '../../ui-types';
import { localizeApiMessage } from '../../api-messages';
import { OpenButton } from '../settings-ui';

export type HrSettingsData = { documentTypes: Row[]; deductionRules: Row[]; medicalPlans: Row[]; attendanceTypes: Row[]; canManage: boolean };
export type HrSettingsEntity = 'documentTypes' | 'deductionRules' | 'medicalPlans' | 'attendanceTypes';
export type SectionProps = {
  rtl: boolean; data: HrSettingsData;
  save: (entity: HrSettingsEntity, record: Row) => Promise<void>;
  remove: (entity: HrSettingsEntity, row: Row, question: string) => Promise<void>;
};

/** Loads all four catalogs in one request; the latest request wins so a slow reply never overwrites a newer one. */
export function useHrSettings(rtl: boolean, notify: (message: string) => void) {
  const [data, setData] = useState<HrSettingsData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const response = await fetch('/api/hr-settings', { cache: 'no-store' });
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
    const response = await fetch('/api/hr-settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({})) as Row;
    if (response.status === 401) window.dispatchEvent(new Event('portal-session-expired'));
    if (!response.ok) throw new Error(String((rtl ? body.message_ar : body.message_en) || localizeApiMessage(String(body.error || `Request failed (${response.status})`), rtl)));
  }, [rtl]);
  const save = useCallback(async (entity: HrSettingsEntity, record: Row) => {
    await post({ action: 'save', entity, record });
    await reload(); notify(rtl ? 'تم حفظ الإعدادات' : 'Settings saved');
  }, [post, reload, notify, rtl]);
  const remove = useCallback(async (entity: HrSettingsEntity, row: Row, question: string) => {
    if (!window.confirm(question)) return;
    try { await post({ action: 'delete', entity, record: { id: row.id } }); await reload(); notify(rtl ? 'تم الحذف' : 'Deleted'); }
    catch (reason) { notify(reason instanceof Error ? reason.message : String(reason)); }
  }, [post, reload, notify, rtl]);
  return { data, status, reload, save, remove };
}

/** Edit (or View for read-only users) plus Delete; `blocked` explains why a delete is not possible. */
export function RowActions({ rtl, canManage, name, onOpen, onDelete, blocked }: { rtl: boolean; canManage: boolean; name: string; onOpen: () => void; onDelete: () => void; blocked?: string }) {
  return <span className="settings-row-actions">
    <OpenButton rtl={rtl} canManage={canManage} name={name} onClick={onOpen} />
    {canManage && <button type="button" className={`outline danger${blocked ? ' is-blocked' : ''}`} disabled={Boolean(blocked)} title={blocked} onClick={onDelete} aria-label={`${rtl ? 'حذف' : 'Delete'} ${name}`}>
      <Trash2 size={14} aria-hidden="true" />{rtl ? 'حذف' : 'Delete'}</button>}
  </span>;
}

export const statusOptions = (rtl: boolean) => [{ value: 'active', label: rtl ? 'نشط' : 'Active' }, { value: 'inactive', label: rtl ? 'غير نشط' : 'Inactive' }];
export const nameOf = (row: Row, rtl: boolean) => String((rtl ? row.name_ar || row.name_en : row.name_en || row.name_ar) ?? '');
export const otherNameOf = (row: Row, rtl: boolean) => String((rtl ? row.name_en : row.name_ar) ?? '');
export const number = (value: unknown, rtl: boolean, digits = 2) => new Intl.NumberFormat(rtl ? 'ar-SA-u-nu-arab' : 'en-GB', { maximumFractionDigits: digits }).format(Number(value) || 0);
/** Inputs hold strings; numbers come back from the API as numbers or null. */
export const field = (value: unknown) => (value === null || value === undefined ? '' : String(value));
