import type { Row } from '../ui-types';
/**
 * @deprecated Superseded by `chart-model.ts` (Stage 4). No application code imports this module; it is kept only
 * because organization-assignments.test.mjs and the runtime-*.mjs scripts import `buildReportingForest`.
 */
export type ReportingNode={employee:Row;children:ReportingNode[]};
export function filterChartEmployees(rows:Row[],filters:{company?:string;branch?:string;department?:string;includeInactive?:boolean}):Row[]{
  return rows.filter(e=>(!filters.company||Number(e.company_id)===Number(filters.company))&&(!filters.branch||Number(e.branch_id)===Number(filters.branch))&&(!filters.department||Number(e.department_id)===Number(filters.department))&&(filters.includeInactive||['active','probation','notice_period'].includes(e.employment_status)));
}
/** Operates only on permission-filtered rows. Missing/filtered managers create roots. */
export function buildReportingForest(rows:Row[]):ReportingNode[]{
  const nodes=new Map<number,ReportingNode>();
  for(const row of rows)if(!nodes.has(Number(row.id)))nodes.set(Number(row.id),{employee:row,children:[]});
  const parents=new Map<number,number>();
  for(const [id,node] of nodes){const parent=Number(node.employee.manager_id);if(parent!==id&&nodes.has(parent)&&Number(nodes.get(parent)!.employee.company_id||0)===Number(node.employee.company_id||0))parents.set(id,parent);}
  const done=new Set<number>();
  for(const id of nodes.keys()){
    const path=new Set<number>();let current:number|undefined=id;
    while(current!==undefined&&!done.has(current)){
      if(path.has(current)){parents.delete(current);break;}
      path.add(current);current=parents.get(current);
    }
    for(const seen of path)done.add(seen);
  }
  const roots:ReportingNode[]=[];
  for(const [id,node] of nodes){const parent=parents.get(id);if(parent!==undefined)nodes.get(parent)!.children.push(node);else roots.push(node);}
  return roots;
}
export function visibleReportingRows(roots:ReportingNode[],collapsed:Set<number>):{node:ReportingNode;depth:number}[]{
  const result:{node:ReportingNode;depth:number}[]=[],stack=roots.map(node=>({node,depth:0})).reverse();
  while(stack.length){const item=stack.pop()!;result.push(item);if(!collapsed.has(Number(item.node.employee.id)))for(let i=item.node.children.length-1;i>=0;i--)stack.push({node:item.node.children[i],depth:item.depth+1});}
  return result;
}
/** Nodes to draw while searching: every match plus the managers above it, so the tree keeps its shape. */
export function reportingMatchSet(roots:ReportingNode[],keep:(employee:Row)=>boolean):Set<ReportingNode>{
  const order:ReportingNode[]=[],stack=[...roots],shown=new Set<ReportingNode>();
  while(stack.length){const node=stack.pop()!;order.push(node);for(const child of node.children)stack.push(child);}
  for(let i=order.length-1;i>=0;i--){const node=order[i];if(keep(node.employee)||node.children.some(child=>shown.has(child)))shown.add(node);}
  return shown;
}
