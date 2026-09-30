/**
 * Machine-readable organizational validation errors shared by the pure policies (browser and server), the
 * organization services and the API boundary. `message` keeps the historical "arabic / english" form so every
 * existing consumer keeps working; structured consumers read `code`, `field` and the per-language messages.
 */
export type OrganizationErrorCode =
  | 'INVALID_SELECTION' | 'INVALID_DATE' | 'INVALID_COMPANY' | 'INVALID_BRANCH' | 'BRANCH_NOT_LINKED'
  | 'UNIT_OUTSIDE_COMPANY' | 'UNIT_OUTSIDE_BRANCH_SCOPE' | 'INVALID_UNIT_KIND' | 'INVALID_PARENT' | 'HIERARCHY_CYCLE'
  | 'DEPARTMENT_REQUIRED' | 'INVALID_UNIT_MANAGER' | 'MANAGER_NOT_FOUND' | 'MANAGER_INACTIVE' | 'SELF_MANAGEMENT'
  | 'REPORTING_CYCLE' | 'MANAGER_COMPANY_MISMATCH' | 'MANAGER_OUT_OF_SCOPE' | 'DIRECT_REPORTS_OUTSIDE_COMPANY'
  | 'PARTIAL_TEAM_TRANSFER' | 'JOB_TITLE_DEPARTMENT_MISMATCH' | 'POSITION_CONTRADICTION' | 'CEO_HAS_MANAGER'
  | 'CEO_OCCUPIED' | 'INACTIVE_SELECTION' | 'INACTIVE_RETAINED_VALUE' | 'LEGACY_UNIT' | 'WORK_LOCATION_BRANCH'
  | 'HR_OVERRIDE_INVALID' | 'SETUP_UNAVAILABLE' | 'REFERENCED_ENTITY_CONFLICT' | 'ACTIVE_DEPENDENTS'
  | 'IMPACT_NOT_CONFIRMED' | 'SCOPE_REVIEW_REQUIRED' | 'STALE_REVIEW' | 'REQUIRED_FIELD' | 'NOT_FOUND' | 'ACTION_RETIRED'
  | 'HR_ROUTING_CHANGE' | 'HR_RULE_DUPLICATE' | 'HR_RULE_TYPE_INVALID' | 'HR_RESPONSIBLE_INVALID' | 'HR_ACCOUNT_NOT_LINKED' | 'HR_EMPLOYEE_INACTIVE';

export type BlockingEntity = { type: string; id?: number | string | null; name?: string | null; [key: string]: unknown };
export type OrganizationIssue = {
  code: OrganizationErrorCode;
  field?: string | null;
  message_ar: string;
  message_en: string;
  blocking_entity?: BlockingEntity | null;
  details?: unknown;
};

export class OrganizationError extends Error {
  readonly code: OrganizationErrorCode;
  readonly field: string | null;
  readonly message_ar: string;
  readonly message_en: string;
  readonly blocking_entity: BlockingEntity | null;
  readonly details: unknown;
  readonly status: number;
  constructor(issue: OrganizationIssue, status = 400) {
    super(`${issue.message_ar} / ${issue.message_en}`);
    this.name = 'OrganizationError';
    this.code = issue.code;
    this.field = issue.field ?? null;
    this.message_ar = issue.message_ar;
    this.message_en = issue.message_en;
    this.blocking_entity = issue.blocking_entity ?? null;
    this.details = issue.details ?? null;
    this.status = status;
  }
  toJSON(): OrganizationIssue & { error: string } {
    return { error: this.message, code: this.code, field: this.field, message_ar: this.message_ar, message_en: this.message_en, blocking_entity: this.blocking_entity, details: this.details };
  }
}

export function orgError(code: OrganizationErrorCode, field: string | null, ar: string, en: string, extra: { blocking?: BlockingEntity | null; details?: unknown; status?: number } = {}) {
  return new OrganizationError({ code, field, message_ar: ar, message_en: en, blocking_entity: extra.blocking ?? null, details: extra.details }, extra.status ?? 400);
}
export const issueOf = (error: OrganizationError): OrganizationIssue => ({ code: error.code, field: error.field, message_ar: error.message_ar, message_en: error.message_en, blocking_entity: error.blocking_entity, details: error.details });
export const isOrganizationError = (error: unknown): error is OrganizationError =>
  error instanceof OrganizationError || Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'OrganizationError' && 'code' in (error as object));

/** API boundary: an OrganizationError becomes a JSON Response; other errors pass through unchanged. */
export function organizationResponse(error: unknown, fallbackStatus = 400): unknown {
  if (isOrganizationError(error)) return Response.json(error.toJSON(), { status: error.status || fallbackStatus });
  return error;
}
/** Service helper: run pure policy code and convert its errors into HTTP responses with the given status. */
export function asResponse(error: unknown, status = 400): Response {
  if (error instanceof Response) return error;
  if (isOrganizationError(error)) return Response.json(error.toJSON(), { status: error.status === 400 ? status : error.status });
  return new Response(error instanceof Error ? error.message : String(error), { status });
}

/** Retired pre-Stage-2 organization actions: the supported path is Organizational Settings and the Employee Profile. */
export const retiredOrganizationAction = (status = 410) => asResponse(orgError('ACTION_RETIRED', null, 'استخدم إعدادات الهيكل وملف الموظف', 'Use organization settings and Employee Profile', { status }), status);

/** Language-specific text for any thrown value, preferring the structured halves. */
export function organizationMessage(error: unknown, rtl: boolean): string {
  const value = error as { message_ar?: string; message_en?: string; message?: string } | null;
  if (value && (value.message_ar || value.message_en)) return String((rtl ? value.message_ar : value.message_en) || value.message || '');
  const text = String(value?.message ?? error ?? '');
  const [first, ...rest] = text.split(' / ');
  if (rest.length && /[؀-ۿ]/.test(first)) return (rtl ? first : rest.join(' / ')).trim();
  return text;
}
