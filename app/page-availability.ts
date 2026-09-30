export const PAGE_MODULES: Record<string, string[]> = {
  dashboard: ["dashboard"], portal: ["employee_portal"], approvals: ["request_approvals"],
  employees: ["employees"], leave: ["leave_management"], attendance: ["attendance"],
  recruitment: ["recruitment"], lifecycle: ["onboarding", "offboarding"],
  assets: ["assets"], learning: ["learning"], org: ["organization_chart"], users: ["users"],
  reports: ["reports"], payroll: ["payroll"], settings: ["system_settings"],
};

export function filterAvailablePages<T extends string>(granted: T[], roleName: string, availability: Record<string, unknown>): T[] {
  return granted.filter(page => (page!=="settings"||["Super Admin","HR Manager"].includes(roleName)) && ((page === "settings" && roleName === "Super Admin") || availability[page] !== false));
}

export function validatePageToggle(roleName: string, page: unknown, enabled: unknown) {
  if (roleName !== "Super Admin") throw new Response("Only Super Admin can manage page availability", { status: 403 });
  if (typeof page !== "string" || !Object.hasOwn(PAGE_MODULES, page) || typeof enabled !== "boolean") {
    throw new Response("A valid page and boolean enabled value are required", { status: 400 });
  }
  return { page, enabled };
}
