import { orgError } from './org-errors.ts';

export type ReportingEmployee = {id:number;manager_id?:number|null;employment_status?:string};

export function validateReportingManager(rows:ReportingEmployee[],employeeId:number,managerId:number|null){
  if(managerId===null)return;
  if(managerId===employeeId)throw orgError('SELF_MANAGEMENT','manager_id','لا يمكن أن يكون الموظف مديرًا لنفسه','An employee cannot manage themselves',{blocking:{type:'employee',id:employeeId}});
  const byId=new Map(rows.map(row=>[Number(row.id),row]));
  const manager=byId.get(managerId);
  if(!manager)throw orgError('MANAGER_NOT_FOUND','manager_id','المدير المباشر غير موجود','Direct manager not found',{blocking:{type:'employee',id:managerId}});
  if(manager.employment_status&&!['active','probation','notice_period'].includes(manager.employment_status))throw orgError('MANAGER_INACTIVE','manager_id','المدير المباشر غير نشط','Direct manager is not active',{blocking:{type:'employee',id:managerId,employment_status:manager.employment_status}});
  const visited=new Set<number>([employeeId]);
  const path:number[]=[employeeId];
  let current:number|null=managerId;
  while(current){
    path.push(current);
    if(visited.has(current))throw orgError('REPORTING_CYCLE','manager_id','خط التبعية يحتوي على حلقة','The reporting structure contains a cycle',{blocking:{type:'employee',id:managerId},details:{path}});
    visited.add(current);
    current=Number(byId.get(current)?.manager_id)||null;
  }
}

/** Stable preorder; orphaned and legacy cyclic rows remain visible. */
export function reportingOrder<T extends ReportingEmployee>(rows:T[]):T[]{
  const ids=new Set(rows.map(row=>Number(row.id))),visited=new Set<number>(),result:T[]=[];
  const visit=(row:T)=>{const id=Number(row.id);if(visited.has(id))return;visited.add(id);result.push(row);rows.filter(child=>Number(child.manager_id)===id).forEach(visit);};
  rows.filter(row=>!ids.has(Number(row.manager_id))).forEach(visit);
  rows.forEach(visit);
  return result;
}
