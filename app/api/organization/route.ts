import { catalogEntities, deleteOrganizationEntity, forceDeleteOrganizationEntity, previewOrganizationEntity, saveOrganizationEntity } from '../../organization/catalog-service';
import { readOrganizationUsageMap } from '../../organization/reference-policy';
import { organizationDuplicateError } from '../../organization/duplicate-error';
import { readOrganizationInsights } from '../../organization/settings-insights';
import { previewJobTitle } from '../../organization/job-title-service';
import { withDatabase } from '../route-helpers';
import { enforceWriteOrigin, requireActor } from '../api-security';
import { requireModule, body } from '../../talent/talent-service';
import { organizationReady, readOrganizationCatalog } from '../../organization/assignment-service';
import { saveHrAssignment } from '../../organization/hr-assignment-service';
import { seesWholeCompany } from '../../employees/hr-data-scope';

export async function GET(request:Request){return withDatabase('Unable to load organization settings',async db=>{
  const actor=await requireActor(request,db);await requireModule(db,actor,'system_settings','view');
  if(!seesWholeCompany(actor))throw new Response('Forbidden',{status:403});
  if(!await organizationReady(db))return Response.json({ready:false});
  const snapshot=await db.transaction(async tx=>{
    await tx.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').run();
    const catalog=await readOrganizationCatalog(tx);
    const usage:Record<string,unknown>={};
    for(const entity of [...Object.keys(catalogEntities),'jobTitles']){
      const counts=await readOrganizationUsageMap(tx,entity);
      usage[entity]=Object.fromEntries((catalog[entity as keyof typeof catalog]||[]).map(row=>[row.id,counts[String(row.id)]??{total:0,active:0,historical:0,references:{}}]));
    }
    return {ready:true,catalog,usage,...await readOrganizationInsights(tx)};
  });
  return Response.json(snapshot,{headers:{'cache-control':'no-store'}});
});}

/**
 * Settings writes. action: 'save' (default) | 'preview' | 'delete' | 'force_delete' (Super Admin; units, positions, job titles) | 'preview_job_title'.
 * Previews run the exact validation and impact plan used by the save, inside a transaction that is rolled back.
 */
export async function POST(request:Request){return withDatabase('Unable to save organization settings',async db=>{
  enforceWriteOrigin(request);const actor=await requireActor(request,db);
  if(!seesWholeCompany(actor))throw new Response('Forbidden',{status:403});
  if(!await organizationReady(db))throw new Response('Migration has not been applied',{status:409});
  const input=await body(request);
  const action=String(input.action||'save');
  if(action==='save_hr_assignment'){
    await requireModule(db,actor,'system_settings','manage_settings');
    const saved=await db.transaction(tx=>saveHrAssignment(tx,input,actor.id)).catch(error=>{throw organizationDuplicateError(error)||error;});
    return Response.json({ok:true,...saved});
  }
  const record=input.record;
  if(!record||typeof record!=='object'||Array.isArray(record))throw new Response('Invalid record',{status:400});
  if(action==='preview'||action==='preview_job_title'){
    await requireModule(db,actor,'system_settings','view');
    const rollback=Symbol('preview');let result:unknown=null;
    // Previews take the same locks as a save but never commit.
    await db.transaction(async tx=>{result=action==='preview'?await previewOrganizationEntity(tx,String(input.entity),record as Record<string,unknown>):await previewJobTitle(tx,record as Record<string,unknown>);throw rollback;}).catch(error=>{if(error!==rollback)throw error;});
    return Response.json(result,{headers:{'cache-control':'no-store'}});
  }
  await requireModule(db,actor,'system_settings','manage_settings');
  if(action==='delete'){
    const deleted=await db.transaction(tx=>deleteOrganizationEntity(tx,String(input.entity),(record as Record<string,unknown>).id,actor.id));
    return Response.json({ok:true,...deleted});
  }
  if(action==='force_delete'){
    if(actor.roleName!=='Super Admin')throw new Response('Only the system administrator can force delete',{status:403});
    const deleted=await db.transaction(tx=>forceDeleteOrganizationEntity(tx,String(input.entity),(record as Record<string,unknown>).id,actor.id));
    return Response.json({ok:true,...deleted});
  }
  if(action!=='save')throw new Response('Unknown action',{status:400});
  const saved=await db.transaction(tx=>saveOrganizationEntity(tx,String(input.entity),record as Record<string,unknown>,actor.id)).catch(error=>{throw organizationDuplicateError(error)||error;});
  return Response.json({ok:true,...saved});
});}
