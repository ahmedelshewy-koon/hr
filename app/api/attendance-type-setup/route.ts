import { withDatabase } from "../route-helpers";
import { enforceWriteOrigin, requireActor } from "../api-security";
import { readHrSettings, saveHrSetting, deleteHrSetting } from "../../hr-settings/catalog";
import { payrollAccess } from "../../payroll/service";
import { hasPayrollPage, requirePayrollPage } from "../../payroll/permissions";

type Row=Record<string,unknown>;
export async function GET(request:Request) {
  return withDatabase("Unable to load attendance types",async db=>{
    const actor=await requireActor(request,db);
    await payrollAccess(db,actor);await requirePayrollPage(db,actor,"attendanceTypeSetup");
    const data=await readHrSettings(db);
    return Response.json({attendanceTypes:data.attendanceTypes,canManage:await hasPayrollPage(db,actor,"attendanceTypeSetup","edit")},{headers:{"cache-control":"private, no-store"}});
  });
}
export async function POST(request:Request) {
  return withDatabase("Unable to update attendance types",async db=>{
    enforceWriteOrigin(request);const actor=await requireActor(request,db);
    await payrollAccess(db,actor);await requirePayrollPage(db,actor,"attendanceTypeSetup","edit");
    const input=await request.json().catch(()=>null) as Row|null;
    if(!input||!input.record||typeof input.record!=="object"||Array.isArray(input.record))throw new Response("Invalid attendance type",{status:400});
    if(input.action==="save")return Response.json({record:await db.transaction(tx=>saveHrSetting(tx,"attendanceTypes",input.record as Row,actor.id))});
    if(input.action==="delete")return Response.json(await db.transaction(tx=>deleteHrSetting(tx,"attendanceTypes",(input.record as Row).id,actor.id)));
    throw new Response("Unknown attendance type action",{status:400});
  });
}
