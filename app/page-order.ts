import { PAGE_MODULES } from './page-availability.ts';

export function normalizePageOrder(value: unknown): string[] {
  const saved = Array.isArray(value) ? value.filter((page): page is string => typeof page === 'string' && Object.hasOwn(PAGE_MODULES, page)) : [];
  return [...new Set([...saved, ...Object.keys(PAGE_MODULES)])];
}

export function orderPages<T extends string>(pages: T[], order: unknown): T[] {
  const positions = normalizePageOrder(order);
  return [...pages].sort((a, b) => positions.indexOf(a) - positions.indexOf(b));
}

export function movePage(pages: string[], source: string, target: string): string[] {
  const from = pages.indexOf(source), to = pages.indexOf(target);
  if (from < 0 || to < 0 || from === to) return pages;
  const next = [...pages];
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}

export function validatePageOrder(roleName: string, value: unknown): string[] {
  if (roleName !== 'Super Admin') throw new Response('Only Super Admin can manage page availability', { status: 403 });
  if (!Array.isArray(value) || value.length !== Object.keys(PAGE_MODULES).length || new Set(value).size !== value.length || value.some(page => typeof page !== 'string' || !Object.hasOwn(PAGE_MODULES, page))) {
    throw new Response('A complete page order without duplicates is required', { status: 400 });
  }
  return [...value];
}
