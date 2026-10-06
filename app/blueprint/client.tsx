"use client";
import type { ReactNode } from 'react';
import { SENIORITY_LABELS, SIZE_LABELS, type BlueprintAccess, type BlueprintSize, type BlueprintTree, type Name, type Seniority } from './policy';
import type { BlueprintRow, CompanyType } from './service';

export type Notify = (message: string) => void;
export type Overview = { access: BlueprintAccess; types: CompanyType[]; templates: BlueprintRow[]; blueprints: BlueprintRow[]; companies: { id: number; name: Name; status: string }[] };
export type BlueprintDetail = { blueprint: BlueprintRow; tree: BlueprintTree; access: BlueprintAccess };

export const pick = (name: Name | null | undefined, rtl: boolean) => (name ? (rtl ? name.ar || name.en : name.en || name.ar) : '');
export const makeFmt = (rtl: boolean) => { const f = new Intl.NumberFormat(rtl ? 'ar-EG-u-nu-arab' : 'en-GB', { maximumFractionDigits: 0 }); return (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : f.format(v)); };
export const sizeLabel = (size: BlueprintSize, rtl: boolean) => SIZE_LABELS[size][rtl ? 'ar' : 'en'];
export const seniorityLabel = (level: Seniority, rtl: boolean) => SENIORITY_LABELS[level][rtl ? 'ar' : 'en'];

/** Calls the API; structured errors come back in the user's language. */
export async function blueprintApi(path: string, init?: { body?: Record<string, unknown> }, rtl = false) {
  const response = await fetch(path, init ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body), cache: 'no-store' } : { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error((rtl && body.message_ar) || body.error || (rtl ? 'تعذر تنفيذ الطلب' : 'Request failed')) as Error & { code?: string };
    error.code = body.code; throw error;
  }
  return body;
}

const STATUS: Record<string, { en: string; ar: string }> = {
  draft: { en: 'Draft', ar: 'مسودة' }, active: { en: 'Active', ar: 'نشط' }, archived: { en: 'Archived', ar: 'مؤرشف' }, approved: { en: 'Approved', ar: 'معتمد' }, applied: { en: 'Applied', ar: 'مطبّق' },
};
export function StatusPill({ status, rtl }: { status: string; rtl: boolean }) {
  return <span className={`bp-pill bp-pill-${status}`}>{STATUS[status]?.[rtl ? 'ar' : 'en'] ?? status}</span>;
}
export function Field({ label, children, wide, hint }: { label: string; children: ReactNode; wide?: boolean; hint?: string }) {
  return <label className={`bp-field${wide ? ' wide' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export const typeName = (types: CompanyType[], id: number, rtl: boolean) => pick(types.find(t => t.id === id)?.name, rtl) || '—';
