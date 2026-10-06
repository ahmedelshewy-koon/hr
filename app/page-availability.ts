export const PAGE_MODULES: Record<string, string[]> = {
  dashboard: ["dashboard"], portal: ["employee_portal"], approvals: ["request_approvals"],
  employees: ["employees"], leave: ["leave_management"], attendance: ["attendance"],
  recruitment: ["recruitment"], lifecycle: ["onboarding", "offboarding"],
  assets: ["assets"], learning: ["learning"], org: ["organization_chart"], blueprint: ["staffing_blueprint"], decisions: ["administrative_decisions"], users: ["users"],
  reports: ["reports"], payroll: ["payroll"], cost_centers: ["payroll"], hr_settings: ["system_settings"], settings: ["system_settings"],
};

export function filterAvailablePages<T extends string>(granted: T[], roleName: string, availability: Record<string, unknown>, hrDataScope?: string | null): T[] {
  return granted.filter(page => (!(page==="settings"||page==="hr_settings")||["Super Admin","HR Manager"].includes(roleName)) && (page!=="cost_centers"||["Super Admin","HR Manager"].includes(roleName)) && (page!=="hr_settings"||roleName==="Super Admin"||hrDataScope!=="assigned") && ((page === "settings" && roleName === "Super Admin") || availability[page] !== false));
}

export function validatePageToggle(roleName: string, page: unknown, enabled: unknown) {
  if (roleName !== "Super Admin") throw new Response("Only Super Admin can manage page availability", { status: 403 });
  if (typeof page !== "string" || !Object.hasOwn(PAGE_MODULES, page) || typeof enabled !== "boolean") {
    throw new Response("A valid page and boolean enabled value are required", { status: 400 });
  }
  return { page, enabled };
}
