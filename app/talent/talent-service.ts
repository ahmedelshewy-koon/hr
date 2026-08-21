import type { ApiActor } from "../api/api-security";
import { canAccessEmployee, requirePermission } from "../api/api-security";
import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";
import { createNotification } from "../notifications/notification-service";

export type Db=PostgresDatabase|TransactionDatabase;
export type Input=Record<string,unknown>;
export const text=(value:unknown,max=4000)=>String(value??"").trim().slice(0,max);
export const number=(value:unknown)=>Number(value)||0;
export const required=(value:unknown,name:string)=>{const result=text(value);if(!result)throw new Response(`${name} is required`,{status:400});return result;};
export const today=()=>new Date().toISOString().slice(0,10);
export async function body(request:Request){try{return await request.json() as Input;}catch{throw new Response("Invalid JSON body",{status:400});}}
export async function audit(db:Db,actor:ApiActor,action:string,module:string,type:string,id:number|string,summary:unknown){await db.prepare("INSERT INTO audit_logs(user_id,action,module,record_type,record_id,new_value,created_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(actor.id,action,module,type,String(id),JSON.stringify(summary)).run();}
export async function employeeUser(db:Db,employeeId:number){return db.prepare("SELECT id FROM users WHERE employee_id=? AND status='active' ORDER BY id LIMIT 1").bind(employeeId).first<{id:number}>();}
export async function notifyEmployee(db:Db,employeeId:number,input:{type:string;title:string;message?:string;entityType:string;entityId:number|string;path:string;key:string}){const user=await employeeUser(db,employeeId);if(user)await createNotification(db as PostgresDatabase,{userId:Number(user.id),type:input.type,titleKey:input.title,messageKey:input.message,entityType:input.entityType,entityId:input.entityId,targetPath:input.path,dedupeKey:input.key});}
export async function requireEmployeeScope(db:PostgresDatabase,actor:ApiActor,employeeId:number){if(!(await canAccessEmployee(db,actor,employeeId)))throw new Response("Employee is outside your access scope",{status:403});}
export async function requireModule(db:PostgresDatabase,actor:ApiActor,module:string,action:string){await requirePermission(db,actor,module,action);}
export async function nextOwner(db:Db,employeeId:number,ownerType:string){if(ownerType==="employee")return employeeUser(db,employeeId);if(ownerType==="manager")return db.prepare("SELECT u.id FROM employees e JOIN users u ON u.employee_id=e.manager_id AND u.status='active' WHERE e.id=? LIMIT 1").bind(employeeId).first<{id:number}>();return db.prepare("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.status='active' AND r.name IN ('Super Admin','HR Manager') ORDER BY CASE r.name WHEN 'HR Manager' THEN 0 ELSE 1 END,u.id LIMIT 1").first<{id:number}>();}
export function transition(current:string,next:string,map:Record<string,string[]>,label="transition"){if(!(map[current]||[]).includes(next))throw new Response(`Invalid ${label}: ${current} → ${next}`,{status:409});}
