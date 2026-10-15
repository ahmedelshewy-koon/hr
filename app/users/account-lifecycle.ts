import type { TransactionDatabase } from "../../db/postgres";

/**
 * Historical approvals, payroll records and audit events retain the user id. Deletion therefore
 * revokes the login and hides the row while keeping those references. The old email is released
 * so a new employee can receive a new account without inheriting the old user's audit history.
 */
export const DELETED_USER_STATUS = "deleted";
export const deletedUserEmail = (userId:number)=>`deleted-user-${userId}@deleted.invalid`;

export async function assertCanDeleteAccounts(tx:TransactionDatabase,actor:{id:number;role_name:string},targets:{id:number;status:string;role_name:string}[]):Promise<void>{
  if(targets.some(target=>Number(target.id)===Number(actor.id)))throw new Response("You cannot delete your own account",{status:400});
  if(actor.role_name!=="Super Admin"&&targets.some(target=>!["Employee","Department Manager"].includes(target.role_name)))throw new Response("HR can delete employee and department-manager accounts only",{status:403});
  const activeAdmins=targets.filter(target=>target.role_name==="Super Admin"&&target.status==="active").length;
  if(activeAdmins){
    const total=await tx.prepare("SELECT COUNT(*)::int AS count FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Super Admin' AND u.status='active'").first<{count:number}>();
    if(Number(total?.count)<=activeAdmins)throw new Response("The last active system administrator cannot be deleted",{status:409});
  }
}

export async function deleteUserAccount(tx:TransactionDatabase,userId:number):Promise<boolean>{
  const account=await tx.prepare("SELECT id,status,employee_id FROM users WHERE id=? FOR UPDATE").bind(userId).first<{id:number;status:string;employee_id:number|null}>();
  if(!account||account.status===DELETED_USER_STATUS)return false;
  const linked=await tx.prepare("SELECT 1 AS linked FROM employees WHERE hr_user_id=? AND employment_status<>'deleted' AND id<>? LIMIT 1").bind(userId,account.employee_id||0).first();
  if(linked)throw new Response("Reassign this user's HR responsibility before deletion",{status:409});
  const rulesReady=await tx.prepare("SELECT to_regclass('public.hr_responsibility_rules') IS NOT NULL AS ready").first<{ready:boolean}>();
  if(rulesReady?.ready){
    const rule=await tx.prepare("SELECT 1 AS linked FROM hr_responsibility_rules WHERE hr_user_id=? AND status='active' LIMIT 1").bind(userId).first();
    if(rule)throw new Response("Reassign this user's HR responsibility before deletion",{status:409});
  }
  await tx.prepare("UPDATE users SET email=?,status='deleted',password_hash=NULL,auth_user_id=NULL,session_version=session_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(deletedUserEmail(userId),userId).run();
  const tables=await tx.prepare("SELECT to_regclass('public.portal_session_activity') IS NOT NULL AS sessions, to_regclass('public.hr_managers') IS NOT NULL AS managers, to_regclass('public.hr_responsibles') IS NOT NULL AS hr_responsibles").first<{sessions:boolean;managers:boolean;hr_responsibles:boolean}>();
  if(tables?.sessions)await tx.prepare("DELETE FROM portal_session_activity WHERE user_id=?").bind(userId).run();
  if(tables?.managers)await tx.prepare("UPDATE hr_managers SET is_active=0 WHERE user_id=?").bind(userId).run();
  if(tables?.hr_responsibles)await tx.prepare("UPDATE hr_responsibles SET status='inactive',updated_at=CURRENT_TIMESTAMP WHERE user_id=?").bind(userId).run();
  return true;
}

/** Delete every live login linked to this employee in the same employee deletion transaction. */
export async function deleteEmployeeAccounts(tx:TransactionDatabase,employeeId:number):Promise<number[]>{
  const accounts=(await tx.prepare("SELECT id FROM users WHERE employee_id=? AND status<>'deleted' ORDER BY id FOR UPDATE").bind(employeeId).all<{id:number}>()).results;
  const deleted:number[]=[];
  for(const account of accounts)if(await deleteUserAccount(tx,Number(account.id)))deleted.push(Number(account.id));
  return deleted;
}

export async function releaseDeletedEmail(tx:TransactionDatabase,email:string):Promise<void>{
  const holders=(await tx.prepare("SELECT id FROM users WHERE status='deleted' AND lower(email)=lower(?) FOR UPDATE").bind(email).all<{id:number}>()).results;
  for(const holder of holders)await tx.prepare("UPDATE users SET email=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(deletedUserEmail(Number(holder.id)),holder.id).run();
}

/** A new user id is issued so an earlier deleted user's history is never attributed to the new login. */
export async function provisionEmployeeAccount(tx:TransactionDatabase,input:{email:string;employeeId:number;roleId:number;passwordHash:string}):Promise<number>{
  const existing=await tx.prepare("SELECT id FROM users WHERE status<>'deleted' AND (employee_id=? OR lower(email)=lower(?)) LIMIT 1").bind(input.employeeId,input.email).first();
  if(existing)throw new Response("An account already exists for this employee or email",{status:409});
  await releaseDeletedEmail(tx,input.email);
  const created=await tx.prepare("INSERT INTO users(email,employee_id,role_id,status,password_hash,must_change_password,session_version,failed_login_attempts,created_at,updated_at) VALUES(?,?,?,'active',?,1,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id")
    .bind(input.email,input.employeeId,input.roleId,input.passwordHash).first<{id:number}>();
  if(!created)throw new Response("Unable to create user account",{status:500});
  return Number(created.id);
}
