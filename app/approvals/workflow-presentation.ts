export function workflowStatusLabel(row:Record<string,unknown>,rtl:boolean):string|null {
  if(!row.approval_workflow)return null;
  if(row.workflow_unavailable&&row.status==='pending_hr')return rtl?'الموافق غير متاح — تواصل مع مسؤول النظام':'Approver unavailable — contact your administrator';
  if(row.status==='pending_hr')return rtl?'بانتظار الاعتماد':'Waiting for approval';
  if(['hr_rejected','rejected_hr'].includes(String(row.status)))return rtl?'مرفوض':'Rejected';
  return null;
}
export function workflowStageLabel(stage:unknown,rtl:boolean):string|null {
  return /^workflow:\d+$/.test(String(stage))?(rtl?`المرحلة ${Number(String(stage).split(':')[1])+1}`:`Stage ${Number(String(stage).split(':')[1])+1}`):null;
}
export function workflowActionLabel(stage:unknown,action:unknown,rtl:boolean):string|null {
  if(!String(stage).startsWith('workflow:'))return null;
  return String(action).includes('reject')?(rtl?'رفض':'Rejected'):(rtl?'اعتمد':'Approved');
}
