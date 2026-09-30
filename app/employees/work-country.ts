import { COUNTRIES } from "./countries.ts";

export type WorkCountry = (typeof COUNTRIES)[number]["value"];
const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase()
  .replace(/[أإآٱ]/g, "ا").replace(/[\u064B-\u065F]/g, "");
const lookup = new Map<string, WorkCountry>();
for (const country of COUNTRIES) {
  for (const name of [country.code, country.value, country.ar, country.aliases]) lookup.set(normalize(name), country.value);
}
for (const [alias, country] of Object.entries({ KSA: "Saudi Arabia", Saudi: "Saudi Arabia", "المملكة العربية السعودية": "Saudi Arabia", "Riyadh, KSA": "Saudi Arabia", UAE: "United Arab Emirates", "الإمارات": "United Arab Emirates", "الامارات العربية المتحدة": "United Arab Emirates" })) {
  lookup.set(normalize(alias), country as WorkCountry);
}

export function resolveCountry(value: unknown): WorkCountry | null {
  if (normalize(value) === "السعودية") return "Saudi Arabia";
  return lookup.get(normalize(value)) ?? null;
}

export function workCountries(employees: { work_location?: unknown; country?: unknown }[]): WorkCountry[] {
  return [...new Set(employees.map(workCountry).filter((value): value is WorkCountry => value !== null))].sort();
}

/** An empty selection means all; removed branches must not leave a stale filter. */
export function activeWorkCountries(selected: string[], available: readonly string[]): string[] {
  return selected.filter(value => available.includes(value));
}

/** The employee's country is the canonical work location; retained free text is a legacy fallback. */
export function workCountry(employee: { work_location?: unknown; country?: unknown }): WorkCountry | null {
  return resolveCountry(employee.country) ?? resolveCountry(employee.work_location);
}

/** Headcount by work country, largest first; countries without employees are omitted. `code` is the ISO code used for the bundled flag. */
export function workCountryCounts(employees: { work_location?: unknown; country?: unknown }[]): { country: WorkCountry; code: string; count: number }[] {
  const counts = new Map<WorkCountry, number>();
  for (const employee of employees) {
    const country = workCountry(employee);
    if (country) counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([country, count]) => ({ country, count, code: COUNTRIES.find(item => item.value === country)?.code ?? "" }));
}

export function countryName(country: string, rtl: boolean): string {
  const entry = COUNTRIES.find(item => item.value === country);
  return entry ? (rtl ? entry.ar : entry.value) : country;
}
