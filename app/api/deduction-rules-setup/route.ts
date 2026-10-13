import { withDatabase } from "../route-helpers";
import { enforceWriteOrigin, requireActor } from "../api-security";
import { readHrSettings, saveHrSetting, deleteHrSetting } from "../../hr-settings/catalog";
import { payrollAccess } from "../../payroll/service";
import { hasPayrollPage, requirePayrollPage } from "../../payroll/permissions";

type Row=Record<string,unknown>;
export async function GET(request:Request) {
  return withDatabase("Unable to load deduction rules",async db=>{
    const actor=await requireActor(request,db);
    await payrollAccess(db,actor);
    await requirePayrollPage(db,actor,"deductionRulesSetup");
    const data=await readHrSettings(db);
    return Response.json({deductionRules:data.deductionRules,canManage:await hasPayrollPage(db,actor,"deductionRulesSetup","edit")},{headers:{"cache-control":"private, no-store"}});
  });
}

export async function POST(request:Request) {
  return withDatabase("Unable to update deduction rules",async db=>{
    enforceWriteOrigin(request);
    const actor=await requireActor(request,db);
    await payrollAccess(db,actor);
    await requirePayrollPage(db,actor,"deductionRulesSetup","edit");
    const input=await request.json().catch(()=>null) as Row|null;
    if(!input||!input.record||typeof input.record!=="object"||Array.isArray(input.record)) throw new Response("Invalid deduction rule",{status:400});
    if(input.action==="save") return Response.json({record:await db.transaction(tx=>saveHrSetting(tx,"deductionRules",input.record as Row,actor.id))});
    if(input.action==="delete") return Response.json(await db.transaction(tx=>deleteHrSetting(tx,"deductionRules",(input.record as Row).id,actor.id)));
    throw new Response("Unknown deduction rule action",{status:400});
  });
}
