import { apiFailure } from "../api-security";
import { hasWorkflowAssignments } from '../../approvals/workflow-service';
import { ensureAuthSchema, requirePortalSession } from "../../portal-auth";
import { aggregateApprovals } from "../../approvals/approval-aggregation";
import { createDatabase } from "../../../db/postgres";

export async function GET(request:Request){
  const db=createDatabase();
  try{
    await ensureAuthSchema(db);const session=await requirePortalSession(request,db);
    const user=await db.prepare("SELECT u.id,u.employee_id,r.name AS role_name,e.department_id FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=? AND u.status='active'").bind(session.userId).first<{id:number;employee_id:number|null;role_name:string;department_id:number|null}>();
    if(!user)throw new Response("Account disabled",{status:403});
    const permission=await db.prepare("SELECT allowed FROM permissions WHERE role_id=(SELECT role_id FROM users WHERE id=?) AND module='request_approvals' AND action='view'").bind(user.id).first<{allowed:number}>();
    if(user.role_name!=="Super Admin"&&!permission?.allowed&&!await hasWorkflowAssignments(db,user.id))throw new Response("Permission denied",{status:403});
    return Response.json(await aggregateApprovals(db,user));
  }catch(error){return apiFailure(error,"Unable to load approvals");}
  finally{await db.close();}
}
