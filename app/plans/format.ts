import type { Row } from '../ui-types';

/** Shared by the Plans page and the landing page so a plan reads the same in both. */
export function durationLabel(value: unknown, rtl: boolean) {
  const months = Number(value);
  if (!Number.isInteger(months) || months < 1) return '—';
  if (rtl) {
    if (months === 1) return 'شهري';
    if (months === 3) return 'ربع سنوي';
    if (months === 6) return 'نصف سنوي';
    if (months === 12) return 'سنوي';
    return months === 2 ? 'شهران' : months <= 10 ? `${months} أشهر` : `${months} شهرًا`;
  }
  return months === 1 ? 'Monthly' : months === 3 ? 'Quarterly' : months === 6 ? 'Every 6 months' : months === 12 ? 'Yearly' : `${months} months`;
}

export function priceLabel(plan: Row, rtl: boolean) {
  if (plan.price === null || plan.price === undefined || plan.price === '') return rtl ? 'تواصل معنا' : 'Contact us';
  const amount = new Intl.NumberFormat(rtl ? 'ar-SA-u-nu-arab' : 'en-GB', { maximumFractionDigits: 2 }).format(Number(plan.price));
  return `${amount} ${String(plan.currency ?? '')}`.trim();
}

/** One feature per line; blank lines dropped. */
export const featureLines = (value: unknown) => String(value ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
