import { env } from "cloudflare:workers";
import type { PostgresDatabase } from "../../../../../db/postgres";
import { withDatabase } from "../../../route-helpers";
import { enforceRateLimit, enforceWriteOrigin, requireActor } from "../../../api-security";
import { audit, number, requireModule } from "../../../../talent/talent-service";
import { canViewCourseMaterials, requireMaterialManager } from "../material-access";

type Row=Record<string,unknown>;
type R2ObjectLike={body:ReadableStream};
type R2BucketLike={get(key:string):Promise<R2ObjectLike|null>;delete(key:string):Promise<void>};
const bucket=()=>((env as unknown as {FILES?:R2BucketLike}).FILES);
const disposition=(name:string,inline:boolean)=>`${inline?"inline":"attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`;

const findMaterial=(db:PostgresDatabase,id:number)=>db.prepare("SELECT m.*,c.created_by_user_id FROM training_materials m JOIN training_courses c ON c.id=m.course_id WHERE m.id=?").bind(id).first<Row>();

// Streams an uploaded file. Links are shown straight from the program list, so they have nothing to download here.
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  return withDatabase("Unable to retrieve material", async db => {
    const actor=await requireActor(request,db),id=number((await context.params).id);
    await requireModule(db,actor,"learning","view");
    const row=await findMaterial(db,id);
    if(!row)throw new Response("Material not found",{status:404});
    if(!(await canViewCourseMaterials(db,actor,{id:row.course_id,created_by_user_id:row.created_by_user_id})))throw new Response("Material access denied",{status:403});
    if(row.kind!=="file")throw new Response("Unsupported material type",{status:400});
    await enforceRateLimit(db,request,"learning-material-download",300,3600,actor.id);
    const storage=bucket();
    if(!storage)throw new Response("Document storage is not configured",{status:503});
    const object=await storage.get(String(row.object_key));
    if(!object)throw new Response("Stored file not found",{status:404});
    const inline=new URL(request.url).searchParams.get("download")!=="1";
    return new Response(object.body,{headers:{"content-type":String(row.content_type),"content-length":String(row.size_bytes),"content-disposition":disposition(String(row.file_name||row.title),inline),"cache-control":"private, no-store","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; sandbox"}});
  });
}

export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){
  return withDatabase("Unable to remove material", async db => {
    enforceWriteOrigin(request);
    const actor=await requireActor(request,db),id=number((await context.params).id);
    await enforceRateLimit(db,request,"learning-material",60,3600,actor.id);
    const row=await findMaterial(db,id);
    if(!row)throw new Response("Material not found",{status:404});
    await requireMaterialManager(db,actor,Number(row.course_id));
    if(!(await db.prepare("DELETE FROM training_materials WHERE id=? RETURNING id").bind(id).first()))throw new Response("Material not found",{status:404});
    // The row is the source of truth: a leftover stored file is harmless, a row pointing at a missing file is not.
    if(row.kind==="file")await bucket()?.delete(String(row.object_key)).catch(()=>{});
    await audit(db,actor,"remove_material","learning","course_material",id,{courseId:Number(row.course_id),kind:row.kind,title:row.title});
    return Response.json({ok:true});
  });
}
