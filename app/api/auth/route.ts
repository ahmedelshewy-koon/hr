import { getChatGPTUser } from "../../chatgpt-auth";
import { allowsLocalPortalLogin } from "../../local-platform-access";
import { clearPortalSessionCookie, createPortalSession, ensureAuthSchema, hashPassword, portalLoginEmail, portalSessionCookie, readPortalSession, verifyBootstrapPassword, verifyPassword } from "../../portal-auth";
import { createDatabase, type PostgresDatabase } from "../../../db/postgres";
import { enforceRateLimit, enforceWriteOrigin } from "../api-security";
import { PAGE_MODULES, filterAvailablePages } from "../../page-availability";
import { readPageAvailability } from "../../page-availability-store";

type LoginUser = { id:number; email:string; password_hash:string|null; password_changed_at?:string|null; status:string; session_version:number; failed_login_attempts:number; locked_until:string|null; must_change_password:number; role_name:string; employee_id:number|null; employee_status:string|null };

async function allowedPagesForUser(d1:PostgresDatabase,userId:number,roleName:string){
  const availability=await readPageAvailability(d1);
  if(roleName==="Super Admin")return filterAvailablePages(Object.keys(PAGE_MODULES),roleName,availability);
  const rows=(await d1.prepare("SELECT p.module FROM users u JOIN permissions p ON p.role_id=u.role_id WHERE u.id=? AND p.action='view' AND p.allowed=1").bind(userId).all()).results as {module:string}[];
  const modules=new Set(rows.map(row=>row.module));
  const granted=Object.entries(PAGE_MODULES).filter(([,required])=>required.some(module=>modules.has(module))).map(([page])=>page);
  return filterAvailablePages(granted,roleName,availability);
}

async function requirePlatformAccess(request: Request) {
  const user = await getChatGPTUser();
  const hostname = new URL(request.url).hostname;
  if (!user && !allowsLocalPortalLogin(hostname, process.env.NODE_ENV)) throw new Response("Authentication required", { status:401 });
}

function isSecure(request: Request) { return new URL(request.url).protocol === "https:"; }
const noStore = { "cache-control":"no-store" };

async function bootstrapAdmin(d1: PostgresDatabase, email:string, password:string) {
  if (email !== portalLoginEmail() || !(await verifyBootstrapPassword(password))) return null;
  // Set the display labels inline. They used to be backfilled by the next request's
  // ensureAuthSchema pass, which no longer runs once the bootstrap is cached per isolate.
  await d1.prepare("INSERT INTO roles (name,name_en,name_ar,description,is_system,created_at,updated_at) VALUES ('Super Admin','Super Admin','مدير النظام','Full system administrator',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING").run();
  const role = await d1.prepare("SELECT id FROM roles WHERE name='Super Admin'").first<{id:number}>();
  let user = await d1.prepare("SELECT id,email,password_hash,status,session_version,failed_login_attempts,locked_until,must_change_password,'Super Admin' AS role_name,employee_id,NULL AS employee_status FROM users WHERE lower(email)=lower(?)").bind(email).first<LoginUser>();
  const passwordHash = await hashPassword(password);
  if (!user) {
    user = await d1.prepare("INSERT INTO users (email,role_id,status,password_hash,session_version,failed_login_attempts,must_change_password,last_login_at,created_at,updated_at) VALUES (?,?,'active',?,1,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id,email,password_hash,status,session_version,failed_login_attempts,locked_until,must_change_password,'Super Admin' AS role_name,employee_id,NULL AS employee_status").bind(email,role!.id,passwordHash).first<LoginUser>();
  } else if (!user.password_hash) {
    await d1.prepare("UPDATE users SET password_hash=?,role_id=?,status='active',session_version=session_version+1,must_change_password=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(passwordHash,role!.id,user.id).run();
    user = await d1.prepare("SELECT u.id,u.email,u.password_hash,u.status,u.session_version,u.failed_login_attempts,u.locked_until,u.must_change_password,r.name AS role_name,u.employee_id,NULL AS employee_status FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?").bind(user.id).first<LoginUser>();
  }
  return user;
}

async function recoverConfiguredAdmin(d1: PostgresDatabase, user: LoginUser | null, email: string, password: string) {
  if (!user || email !== portalLoginEmail() || !(await verifyBootstrapPassword(password))) return user;
  if (user.role_name !== "Super Admin") return user;
  if (user.password_hash && await verifyPassword(password, user.password_hash)) return user;

  const passwordHash = await hashPassword(password);
  await d1.prepare("UPDATE users SET password_hash=?,status='active',must_change_password=0,password_changed_at=CURRENT_TIMESTAMP,session_version=session_version+1,failed_login_attempts=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(passwordHash,user.id).run();
  return d1.prepare("SELECT u.id,u.email,u.password_hash,u.password_changed_at,u.status,u.session_version,u.failed_login_attempts,u.locked_until,u.must_change_password,r.name AS role_name,u.employee_id,e.employment_status AS employee_status FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=?").bind(user.id).first<LoginUser>();
}

export async function GET(request: Request) {
  const d1=createDatabase();
  try {
    await requirePlatformAccess(request);await ensureAuthSchema(d1);
    const session = await readPortalSession(request);
    if (!session) return Response.json({ authenticated:false, user:null }, { headers:noStore });
    const user = await d1.prepare("SELECT u.id,u.email,u.status,u.session_version,u.must_change_password,u.employee_id,r.name AS role_name,r.name_en AS role_name_en,r.name_ar AS role_name_ar,e.name_en AS employee_name,e.name_ar AS employee_name_ar,e.department_id,d.name_en AS department_name,d.name_ar AS department_name_ar FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN departments d ON d.id=e.department_id WHERE u.id=?").bind(session.userId).first<Record<string,unknown>>();
    const valid=Boolean(user&&user.status==="active"&&Number(user.session_version)===session.sessionVersion&&String(user.email).toLowerCase()===session.email);
    if(valid)user!.allowed_pages=await allowedPagesForUser(d1,Number(user!.id),String(user!.role_name));
    return Response.json({ authenticated:valid, user:valid?user:null }, { headers:valid?noStore:{...noStore,"set-cookie":clearPortalSessionCookie(isSecure(request))} });
  } catch(error) { return error instanceof Response ? error : Response.json({ error:"Unable to check login" }, { status:500,headers:noStore }); }
  finally { await d1.close(); }
}

export async function POST(request: Request) {
  const d1=createDatabase();
  try {
    enforceWriteOrigin(request);
    await requirePlatformAccess(request);await ensureAuthSchema(d1);
    const body = await request.json() as { email?:unknown; password?:unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    await enforceRateLimit(d1,request,"login",10,900,email||null);
    if (!email || password.length < 4 || password.length > 200) return Response.json({ error:"البريد الإلكتروني أو كلمة المرور غير صحيحة" }, { status:401,headers:noStore });
    let user = await d1.prepare("SELECT u.id,u.email,u.password_hash,u.password_changed_at,u.status,u.session_version,u.failed_login_attempts,u.locked_until,u.must_change_password,r.name AS role_name,u.employee_id,e.employment_status AS employee_status FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN employees e ON e.id=u.employee_id WHERE lower(u.email)=lower(?)").bind(email).first<LoginUser>();
    if (!user?.password_hash) user=await bootstrapAdmin(d1,email,password);
    user=await recoverConfiguredAdmin(d1,user,email,password);
    if (user?.locked_until && new Date(user.locked_until).getTime()>Date.now()) return Response.json({ error:"تم إيقاف المحاولات مؤقتًا. حاول مرة أخرى بعد ١٥ دقيقة" }, { status:429,headers:noStore });
    const valid=Boolean(user&&user.status==="active"&&(!user.employee_id||["active","probation","notice_period"].includes(String(user.employee_status)))&&user.password_hash&&await verifyPassword(password,user.password_hash));
    if (!valid) {
      if (user) {
        await d1.prepare("UPDATE users SET failed_login_attempts=failed_login_attempts+1,locked_until=CASE WHEN failed_login_attempts+1>=5 THEN CURRENT_TIMESTAMP+INTERVAL '15 minutes' ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.id).run();
        await d1.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,ip_address,created_at) VALUES (?,'login_failed','authentication','user',?,?,CURRENT_TIMESTAMP)").bind(user.id,String(user.id),request.headers.get("cf-connecting-ip")).run();
      }
      return Response.json({ error:"البريد الإلكتروني أو كلمة المرور غير صحيحة" }, { status:401,headers:noStore });
    }
    await d1.prepare("UPDATE users SET failed_login_attempts=0,locked_until=NULL,last_login_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(user!.id).run();
    await d1.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,ip_address,created_at) VALUES (?,'login','authentication','user',?,?,CURRENT_TIMESTAMP)").bind(user!.id,String(user!.id),request.headers.get("cf-connecting-ip")).run();
    const security=await d1.prepare("SELECT value_json FROM system_settings WHERE setting_key='security'").first<{value_json:string}>();let securityValues:Record<string,unknown>={};try{securityValues=JSON.parse(security?.value_json||"{}");}catch{securityValues={};}
    const expiryDays=Math.max(0,Number(securityValues.passwordExpiryDays)||0);if(expiryDays&&(!user!.password_hash||!user!.password_changed_at||new Date(user!.password_changed_at).getTime()<Date.now()-expiryDays*86400000)){user!.must_change_password=1;await d1.prepare("UPDATE users SET must_change_password=1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(user!.id).run();}
    const sessionSeconds=Math.min(86400,Math.max(900,(Number(securityValues.sessionMinutes)||480)*60));
    const token = await createPortalSession(user!,sessionSeconds);
    const roleLabels=await d1.prepare("SELECT name_en,name_ar FROM roles WHERE name=?").bind(user!.role_name).first<{name_en:string|null;name_ar:string|null}>(),allowedPages=await allowedPagesForUser(d1,user!.id,user!.role_name);
    return Response.json({ authenticated:true, user:{id:user!.id,email:user!.email,role_name:user!.role_name,role_name_en:roleLabels?.name_en,role_name_ar:roleLabels?.name_ar,employee_id:user!.employee_id,must_change_password:user!.must_change_password,allowed_pages:allowedPages} }, { headers:{ "set-cookie":portalSessionCookie(token,isSecure(request),sessionSeconds), ...noStore } });
  } catch(error) { return error instanceof Response ? error : Response.json({ error:"تعذر تسجيل الدخول" }, { status:500,headers:noStore }); }
  finally { await d1.close(); }
}

export async function PATCH(request: Request) {
  const d1=createDatabase();
  try {
    enforceWriteOrigin(request);
    await requirePlatformAccess(request);await ensureAuthSchema(d1);
    const session=await readPortalSession(request);if(!session)throw new Response("Portal login required",{status:401});
    await enforceRateLimit(d1,request,"password-change",5,3600,session.userId);
    const body=await request.json() as {currentPassword?:unknown;newPassword?:unknown};
    const currentPassword=typeof body.currentPassword==="string"?body.currentPassword:"";const newPassword=typeof body.newPassword==="string"?body.newPassword:"";
    if(newPassword.length<4||newPassword.length>200)return Response.json({error:"يجب ألا تقل كلمة المرور الجديدة عن ٤ خانات"},{status:400,headers:noStore});
    if(newPassword===currentPassword)return Response.json({error:"يجب أن تختلف كلمة المرور الجديدة عن الحالية"},{status:400,headers:noStore});
    const user=await d1.prepare("SELECT id,email,password_hash,session_version FROM users WHERE id=? AND status='active'").bind(session.userId).first<{id:number;email:string;password_hash:string|null;session_version:number}>();
    if(!user?.password_hash||!(await verifyPassword(currentPassword,user.password_hash)))return Response.json({error:"كلمة المرور الحالية غير صحيحة"},{status:401,headers:noStore});
    const passwordHash=await hashPassword(newPassword);const nextVersion=Number(user.session_version)+1;
    await d1.prepare("UPDATE users SET password_hash=?,must_change_password=0,password_changed_at=CURRENT_TIMESTAMP,session_version=?,failed_login_attempts=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(passwordHash,nextVersion,user.id).run();
    await d1.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,ip_address,created_at) VALUES (?,'password_change','authentication','user',?,?,CURRENT_TIMESTAMP)").bind(user.id,String(user.id),request.headers.get("cf-connecting-ip")).run();
    const token=await createPortalSession({id:user.id,email:user.email,session_version:nextVersion});
    return Response.json({ok:true},{headers:{"set-cookie":portalSessionCookie(token,isSecure(request)),...noStore}});
  } catch(error){return error instanceof Response?error:Response.json({error:"تعذر تغيير كلمة المرور"},{status:500,headers:noStore});}
  finally{await d1.close();}
}

export async function DELETE(request: Request) { try{enforceWriteOrigin(request);return Response.json({ authenticated:false }, { headers:{ "set-cookie":clearPortalSessionCookie(isSecure(request)), ...noStore } });}catch(error){return error instanceof Response?error:Response.json({error:"Unable to sign out"},{status:500});} }
