import type { PostgresDatabase } from "../../db/postgres";

export function carryForwardAmount(input:{enabled:boolean;available:number;maximum:number}){if(!input.enabled)return 0;return Math.max(0,Math.min(Math.max(0,input.available),Math.max(0,input.maximum)));}
function addDays(date:string,days:number){const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}

export async function runLeaveRollover(input:{db:PostgresDatabase;fromYear:number;actorUserId:number}){
  const {db,fromYear,actorUserId}=input,toYear=fromYear+1;if(!Number.isInteger(fromYear)||fromYear<2000||fromYear>2200)throw new Response("Invalid rollover year",{status:400});
  const balances=(await db.prepare(`SELECT lb.*,e.country,e.start_date,lp.id AS policy_id,lp.annual_entitlement,lp.carry_forward,lp.max_carry_forward,lp.expiry_days
    FROM leave_balances lb JOIN employees e ON e.id=lb.employee_id AND e.employment_status IN ('active','probation','notice_period')
    JOIN LATERAL (SELECT p.* FROM leave_policies p WHERE p.leave_type_id=lb.leave_type_id AND p.status='active' AND p.country IN (e.country,'Both','KSA & Egypt') ORDER BY CASE WHEN p.country=e.country THEN 0 ELSE 1 END,p.id DESC LIMIT 1) lp ON true
    WHERE lb.year=? ORDER BY lb.employee_id,lb.leave_type_id`).bind(fromYear).all()).results;
  let applied=0,skipped=0,totalCarried=0;
  for(const row of balances){await db.transaction(async tx=>{
    const lockKey=`${Number(row.employee_id)}:${Number(row.leave_type_id)}:${toYear}`;
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtextextended(?::text,0))").bind(lockKey).run();
    const available=Math.max(0,Number(row.entitlement)-Number(row.used)-Number(row.pending)),carried=carryForwardAmount({enabled:Boolean(Number(row.carry_forward)),available,maximum:Number(row.max_carry_forward)||0}),expiryDays=Math.max(0,Number(row.expiry_days)||0),expiresAt=expiryDays?addDays(`${toYear}-01-01`,expiryDays):null;
    const marker=await tx.prepare("INSERT INTO leave_rollovers (employee_id,leave_type_id,from_year,to_year,source_available,carried_amount,expires_at,run_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(employee_id,leave_type_id,from_year,to_year) DO NOTHING RETURNING id").bind(row.employee_id,row.leave_type_id,fromYear,toYear,available,carried,expiresAt,actorUserId).first<{id:number}>();
    if(!marker){skipped+=1;return;}
    await tx.prepare("INSERT INTO leave_balances (employee_id,leave_type_id,year,entitlement,used,pending) VALUES (?,?,?,?,0,0) ON CONFLICT(employee_id,leave_type_id,year) DO UPDATE SET entitlement=leave_balances.entitlement+excluded.entitlement").bind(row.employee_id,row.leave_type_id,toYear,Number(row.annual_entitlement)+carried).run();
    await tx.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,new_value,created_at) VALUES (?,'leave_year_rollover','leave_management','leave_rollover',?,?,CURRENT_TIMESTAMP)").bind(actorUserId,String(marker.id),JSON.stringify({employeeId:row.employee_id,leaveTypeId:row.leave_type_id,fromYear,toYear,available,carried,expiresAt})).run();applied+=1;totalCarried+=carried;
  });}
  return {ok:true,fromYear,toYear,eligible:balances.length,applied,skipped,totalCarried};
}
