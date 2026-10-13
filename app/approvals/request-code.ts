import type {TransactionDatabase} from "../../db/postgres";

/** Existing request IDs remain historical. New Payroll-era requests use ER-date-sequence. */
export async function nextRequestCode(db:TransactionDatabase,id:number,now=new Date()){
  const ready=await db.prepare("SELECT to_regclass('public.hr_managers') IS NOT NULL AS ready").first<{ready:boolean}>();
  if(!ready?.ready)return `REQ-${1000+id}`;
  await db.prepare("SELECT pg_advisory_xact_lock(905209)").run();
  const day=new Intl.DateTimeFormat("sv-SE",{timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit"}).format(now).replaceAll("-","");
  return `ER-${day}-${String(id).padStart(4,"0")}`;
}
