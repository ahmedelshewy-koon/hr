import { commitTeamTransfer, previewTeamTransfer, type TransferInput } from '../../../organization/team-transfer';
import { withDatabase } from '../../route-helpers';
import { enforceWriteOrigin, requireActor } from '../../api-security';
import { requireModule, body } from '../../../talent/talent-service';
import { seesWholeCompany } from '../../../employees/hr-data-scope';

/**
 * Team organizational transfer. Same authorization boundary as the employee profile save (HR roles + employees/edit).
 * mode 'preview' validates the final group state and returns before/after per employee without writing;
 * mode 'commit' re-validates under row locks, requires the reviewed snapshot for every member and writes atomically.
 */
export async function POST(request:Request){return withDatabase('Unable to transfer team',async db=>{
  enforceWriteOrigin(request);const actor=await requireActor(request,db);
  if(!seesWholeCompany(actor))throw new Response('Employee editing is restricted to HR',{status:403});
  await requireModule(db,actor,'employees','edit');
  const input=await body(request) as unknown as TransferInput&{mode?:string};
  if(input.mode==='commit'){
    const result=await db.transaction(tx=>commitTeamTransfer(tx,input,{id:actor.id,ip:request.headers.get('cf-connecting-ip')}));
    return Response.json({ok:true,...result});
  }
  const rollback=Symbol('preview');let preview:unknown=null;
  await db.transaction(async tx=>{preview=await previewTeamTransfer(tx,input);throw rollback;}).catch(error=>{if(error!==rollback)throw error;});
  return Response.json(preview,{headers:{'cache-control':'no-store'}});
});}
