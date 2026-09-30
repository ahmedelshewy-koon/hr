"use client";
import { useCallback, useState } from 'react';
import type { Row } from '../../ui-types';
import type { OrganizationIssue } from '../../organization/org-errors.ts';

/** Server preview of a Settings change (POST /api/organization action=preview|preview_job_title). */
export type ImpactPreview = { ok: boolean; blocking: OrganizationIssue[]; warnings: OrganizationIssue[]; confirmationToken: string | null; impact: Row };

/** Thrown to keep a drawer open while the user reviews the impact; never shown as an error. */
export class ReviewPending extends Error { constructor() { super('Review pending'); this.name = 'ReviewPending'; } }

type People = { id: number; name_en?: string | null; name_ar?: string | null; employee_code?: string | null }[];
const listOf = (value: unknown): People => (Array.isArray(value) ? value as People : []);
/** Employees / units / positions named by an issue, for "exactly what is using the item". */
export function issueEntities(issue: OrganizationIssue): People {
  const d = (issue.details ?? {}) as Row;
  return [...listOf(d.employees), ...listOf(d.reports), ...listOf(d.positions), ...listOf(d.units), ...listOf(d.occupants), ...listOf(d.current)];
}
export function issueText(issue: OrganizationIssue, rtl: boolean, limit = 6): string {
  const names = issueEntities(issue).map(p => String((rtl ? p.name_ar || p.name_en : p.name_en || p.name_ar) ?? `#${p.id}`));
  const text = rtl ? issue.message_ar : issue.message_en;
  return names.length ? `${text}: ${names.slice(0, limit).join(rtl ? '، ' : ', ')}${names.length > limit ? (rtl ? ` و${names.length - limit} آخرين` : ` and ${names.length - limit} more`) : ''}` : text;
}

/**
 * Preview-then-confirm for high-impact saves. The first submit asks the server for the impact; if nothing needs
 * review it saves immediately, otherwise the drawer shows the impact and the next submit (for the same record)
 * saves with the server's confirmation token. Any edit to the record invalidates the review.
 */
export function useImpactReview() {
  const [review, setReview] = useState<{ key: string; preview: ImpactPreview } | null>(null);
  const reset = useCallback(() => setReview(null), []);
  const run = useCallback(async (record: Row, preview: () => Promise<ImpactPreview>, commit: (token?: string) => Promise<void>) => {
    const key = JSON.stringify(record);
    // A failed confirm (for example STALE_REVIEW) drops the review so the next submit previews again.
    if (review && review.key === key && review.preview.ok) { try { await commit(review.preview.confirmationToken ?? undefined); } finally { setReview(null); } return; }
    const result = await preview();
    if (result.ok && !result.warnings.length && !result.confirmationToken) { setReview(null); await commit(undefined); return; }
    setReview({ key, preview: result });
    throw new ReviewPending();
  }, [review]);
  const current = (record: Row | null | undefined) => (review && record && review.key === JSON.stringify(record) ? review.preview : null);
  return { run, reset, current };
}

export function ImpactReviewPanel({ rtl, preview }: { rtl: boolean; preview: ImpactPreview | null }) {
  if (!preview) return null;
  const impact = preview.impact ?? {};
  const employees = impact.employees as Row | undefined;
  const mismatch = impact.mismatch as Row | undefined;
  const positions = impact.positions as Row | undefined;
  return <section className="org-impact" aria-live="polite" aria-label={rtl ? 'أثر التغيير' : 'Impact of this change'}>
    <h3>{rtl ? 'أثر التغيير قبل الحفظ' : 'Impact before saving'}</h3>
    {employees && <p className="settings-muted">{rtl
      ? `يستخدمه ${employees.total} موظف (${employees.current} حالي، ${employees.historical} تاريخي)${positions ? `، و${positions.total} وظيفة` : ''}.`
      : `Used by ${employees.total} employee(s) (${employees.current} current, ${employees.historical} historical)${positions ? ` and ${positions.total} position(s)` : ''}.`}</p>}
    {mismatch && <ul className="org-impact-summary">
      <li>{rtl ? 'عدم توافق جديد' : 'Mismatches created'}: <b>{listOf(mismatch.created).length}</b></li>
      <li>{rtl ? 'عدم توافق يُحل' : 'Mismatches resolved'}: <b>{listOf(mismatch.resolved).length}</b></li>
      <li>{rtl ? 'يبقى غير متوافق' : 'Still mismatched'}: <b>{listOf(mismatch.remaining).length}</b></li>
      {listOf(impact.legacy).length > 0 && <li>{rtl ? 'في وحدات قديمة' : 'In legacy units'}: <b>{listOf(impact.legacy).length}</b></li>}
    </ul>}
    {preview.blocking.length > 0 && <div className="settings-error" role="alert"><div><b>{rtl ? 'لا يمكن الحفظ:' : 'Cannot save:'}</b><ul>{preview.blocking.map((issue, index) => <li key={index}>{issueText(issue, rtl)}</li>)}</ul></div></div>}
    {preview.warnings.length > 0 && <div className="settings-note warn" role="note"><div><b>{rtl ? 'راجع قبل التأكيد:' : 'Review before confirming:'}</b><ul>{preview.warnings.map((issue, index) => <li key={index}>{issueText(issue, rtl)}</li>)}</ul></div></div>}
    {preview.ok && <p className="settings-muted">{rtl ? 'لن تُعدَّل تعيينات الموظفين تلقائيًا. اضغط «تأكيد وحفظ» للمتابعة.' : 'Employee assignments are not changed automatically. Press “Confirm and save” to continue.'}</p>}
  </section>;
}
