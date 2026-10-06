import { withDatabase } from '../../route-helpers';
import { enforceWriteOrigin, requireActor } from '../../api-security';
import { body } from '../../../talent/talent-service';
import { processLeaveRequest } from '../../../leave/leave-service';
import { processAttendanceCorrection } from '../../../attendance/attendance-service';
import { decideWorkflow, isWorkflowStage } from '../../../approvals/workflow-service';

export async function POST(request:Request){return withDatabase('Unable to process approval',async db=>{
  enforceWriteOrigin(request);const actor=await requireActor(request,db),input=await body(request);
  const sourceType=String(input.sourceType),sourceId=Number(input.sourceId),expectedStage=String(input.expectedStage||''),decision=String(input.decision),reason=String(input.reason||'').trim().slice(0,2000);
  if(!['employee_request','attendance_correction'].includes(sourceType)||!Number.isSafeInteger(sourceId)||sourceId<1||!['approve','reject'].includes(decision)||!/^workflow:\d+$/.test(expectedStage))throw new Response('Invalid approval decision',{status:400});
  const decisionValue=decision as 'approve'|'reject';
  // Assignment is the authority, never a general permission to browse employee records.
  const assignment=await db.prepare("SELECT id FROM approval_workflow_runs WHERE source_type=? AND source_id=? AND current_user_id=? AND state='pending'").bind(sourceType,sourceId,actor.id).first();
  if(!assignment)throw new Response('This request is not awaiting your approval',{status:403});
  if(sourceType==='attendance_correction')return Response.json(await processAttendanceCorrection({db,request,actor,correctionId:sourceId,decision:decisionValue,reason,expectedStage}));
  const row=await db.prepare('SELECT leave_type_id FROM requests WHERE id=?').bind(sourceId).first();
  if(row?.leave_type_id)return Response.json(await processLeaveRequest({db,request,actor,requestId:sourceId,decision:decisionValue,reason,expectedStage}));
  return db.transaction(async tx=>{
    const before=await tx.prepare('SELECT * FROM requests WHERE id=? FOR UPDATE').bind(sourceId).first();
    if(!before||!isWorkflowStage(before.current_stage)||before.status!=='pending_hr'||before.current_stage!==expectedStage)throw new Response('Request stage changed. Refresh.',{status:409});
    const next=await decideWorkflow(tx,'employee_request',sourceId,actor.id,expectedStage,decisionValue,reason);
    await tx.prepare('UPDATE requests SET status=?,current_stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(next.status,next.currentStage,sourceId).run();
    await tx.prepare('INSERT INTO approvals (request_id,stage,actor_user_id,action,reason,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)').bind(sourceId,expectedStage,actor.id,decision,reason||null).run();
    return Response.json({ok:true,...next});
  });
});}
