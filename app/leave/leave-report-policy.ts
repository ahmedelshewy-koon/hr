export const LEAVE_REPORT_CATEGORY="medical_certificate";
export const leaveRequiresReport=(leaveType?:{code?:unknown;attachment_required?:unknown}|null)=>Boolean(leaveType)&&(String(leaveType!.code)==="SICK"||Boolean(Number(leaveType!.attachment_required)));
