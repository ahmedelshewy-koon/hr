import { ensureAuthSchema, requirePortalSession } from "../portal-auth";
import type { PostgresDatabase } from "../../db/postgres";

export type ApiActor={id:number;roleId:number;roleName:string;employeeId:number|null;email:string};

export function enforceWriteOrigin(request:Request){
  if(["GET","HEAD","OPTIONS"].includes(request.method.toUpperCase()))return;
  const expected=new URL(request.url).origin,origin=request.headers.get("origin"),site=request.headers.get("sec-fetch-site");
  if(origin!==expected||site&&!["same-origin","same-site","none"].includes(site))throw new Response("Cross-site write request rejected",{status:403});
}

function requestAddress(request:Request){return request.headers.get("cf-connecting-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";}
async function digest(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");}

export async function enforceRateLimit(db:PostgresDatabase,request:Request,scope:string,limit:number,windowSeconds:number,subject?:string|number|null){
  const key=await digest(`${scope}:${subject??requestAddress(request)}`);
  const row=await db.prepare(`INSERT INTO security_rate_limits (bucket_key,window_started_at,count,updated_at) VALUES (?,CURRENT_TIMESTAMP,1,CURRENT_TIMESTAMP)
    ON CONFLICT(bucket_key) DO UPDATE SET
      count=CASE WHEN security_rate_limits.window_started_at<CURRENT_TIMESTAMP-(?*INTERVAL '1 second') THEN 1 ELSE security_rate_limits.count+1 END,
      window_started_at=CASE WHEN security_rate_limits.window_started_at<CURRENT_TIMESTAMP-(?*INTERVAL '1 second') THEN CURRENT_TIMESTAMP ELSE security_rate_limits.window_started_at END,
      updated_at=CURRENT_TIMESTAMP RETURNING count,window_started_at`).bind(key,windowSeconds,windowSeconds).first<{count:number;window_started_at:string}>();
  if(Number(row?.count)>limit)throw new Response("Too many requests. Please try again later.",{status:429,headers:{"retry-after":String(windowSeconds)}});
}

export async function requireActor(request:Request,db:PostgresDatabase):Promise<ApiActor>{
  await ensureAuthSchema(db);const session=await requirePortalSession(request,db);
  const actor=await db.prepare("SELECT u.id,u.email,u.employee_id,u.role_id,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.status='active'").bind(session.userId).first<{id:number;email:string;employee_id:number|null;role_id:number;role_name:string}>();
  if(!actor)throw new Response("Account disabled",{status:403});
  return {id:Number(actor.id),email:String(actor.email),employeeId:actor.employee_id==null?null:Number(actor.employee_id),roleId:Number(actor.role_id),roleName:String(actor.role_name)};
}

export async function hasPermission(db:PostgresDatabase,actor:ApiActor,module:string,action:string){
  if(actor.roleName==="Super Admin")return true;
  const row=await db.prepare("SELECT allowed FROM permissions WHERE role_id=? AND module=? AND action=?").bind(actor.roleId,module,action).first<{allowed:number}>();
  return Boolean(row?.allowed);
}

export async function requirePermission(db:PostgresDatabase,actor:ApiActor,module:string,action:string){if(!(await hasPermission(db,actor,module,action)))throw new Response("Permission denied",{status:403});}

export async function canAccessEmployee(db:PostgresDatabase,actor:ApiActor,employeeId:number){
  if(["Super Admin","HR Manager"].includes(actor.roleName))return true;
  if(Number(actor.employeeId)===employeeId)return true;
  if(actor.roleName!=="Department Manager"||!actor.employeeId)return false;
  return Boolean(await db.prepare("WITH RECURSIVE managed AS (SELECT id FROM departments WHERE manager_employee_id=? AND status!='deleted' UNION ALL SELECT d.id FROM departments d JOIN managed m ON d.parent_id=m.id WHERE d.status!='deleted') SELECT 1 AS allowed FROM employees WHERE id=? AND department_id IN (SELECT id FROM managed) AND employment_status!='deleted'").bind(actor.employeeId,employeeId).first());
}

export async function apiFailure(error:unknown,message="Request failed"){
  if(error instanceof Response)return Response.json({error:await error.text()},{status:error.status,headers:error.headers});
  console.error(error);return Response.json({error:message},{status:500});
}
