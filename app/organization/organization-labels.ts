type OrganizationUnit = {
  name_ar?: unknown;
  name_en?: unknown;
  unit_type?: unknown;
};

const normalizeUnitName = (value: unknown) => String(value ?? "")
  .trim()
  .toLocaleLowerCase()
  .replace(/[أإآ]/g, "ا")
  .replace(/ة/g, "ه")
  .replace(/[\s_-]+/g, " ");

const companyUnitNames = new Set([
  "كون",
  "كون برمجة",
  "كون للبرمجة",
  "koon",
  "koon software",
  "اسس كارد",
  "asas card",
  "asus cards",
  "وكاله كون",
  "koon agency",
].map(normalizeUnitName));

export const isCompanyOrganizationUnit = (unit?: OrganizationUnit | null) => {
  if (!unit) return false;
  const storedType = String(unit.unit_type ?? "").toLocaleLowerCase();
  if (storedType === "company") return true;
  if (storedType === "department") return false;
  return [unit.name_ar, unit.name_en].some(name => companyUnitNames.has(normalizeUnitName(name)));
};

export const organizationManagerLabel = (
  unit: OrganizationUnit | null | undefined,
  rtl: boolean,
  uppercase = false,
) => {
  if (isCompanyOrganizationUnit(unit)) {
    return rtl ? "المدير العام" : uppercase ? "GENERAL MANAGER" : "General Manager";
  }
  return rtl ? "مدير القسم" : uppercase ? "DEPARTMENT MANAGER" : "Department Manager";
};
