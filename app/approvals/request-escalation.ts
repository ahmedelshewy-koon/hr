import type {PostgresDatabase} from "../../db/postgres";
import type {ResolvedStep} from "./workflow-policy";

type Row=Record<string,unknown>;
/** Nightly, transactional escalation of employee requests that waited three full days. */
export async function escalateStaleRequests(db:PostgresDatabase){
  const ready=await db.prepare("SELECT to_regclass('public.request_escalations') IS NOT NULL AS ready").first<{ready:boolean}>();
  if(!ready?.ready)return {escalated:0};
  return db.transaction(async tx=>{
    const runs=(await tx.prepare(`SELECT w.* FROM approval_workflow_runs w
      WHERE w.source_type='employee_request' AND w.state='pending' AND w.updated_at<=CURRENT_TIMESTAMP-INTERVAL '3 days'
      AND w.current_step<jsonb_array_length(w.steps_json::jsonb)-1
      ORDER BY w.updated_at,w.id LIMIT 100 FOR UPDATE SKIP LOCKED`).all()).results;
    let escalated=0;
    for(const row of runs){
      const steps=JSON.parse(String(row.steps_json)) as ResolvedStep[],from=Number(row.current_step),to=from+1,next=steps[to];
      if(!next?.userId)continue;
      const inserted=await tx.prepare("INSERT INTO request_escalations(workflow_run_id,request_id,from_step,to_step,from_user_id,to_user_id,reason) VALUES(?,?,?,?,?,?,'No decision after three days') ON CONFLICT(workflow_run_id,from_step) DO NOTHING RETURNING id")
        .bind(row.id,row.source_id,from,to,row.current_user_id,next.userId).first<Row>();
      if(!inserted)continue;
      steps[from]={...steps[from],reason:"Automatically escalated after three days"};
      await tx.prepare("UPDATE approval_workflow_runs SET steps_json=?,current_step=?,current_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND current_step=?")
        .bind(JSON.stringify(steps),to,next.userId,row.id,from).run();
      await tx.prepare("UPDATE requests SET current_stage=?,status='pending_hr',updated_at=CURRENT_TIMESTAMP WHERE id=? AND current_stage=?")
        .bind(`workflow:${to}`,row.source_id,`workflow:${from}`).run();
      escalated++;
    }
    return {escalated,hasMore:runs.length===100};
  });
}
