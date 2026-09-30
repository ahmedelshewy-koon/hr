import { env } from "cloudflare:workers";
import { withDatabase } from "../../route-helpers";
import { enforceRateLimit, enforceWriteOrigin, requireActor } from "../../api-security";
import { audit, number } from "../../../talent/talent-service";
import { MATERIAL_KINDS, MAX_MATERIALS_PER_COURSE, MAX_MATERIAL_BYTES, parseMaterialTitle, parseMaterialUrl } from "../../../talent/learning-rules";
import { normalizeFilename, validateDocumentFile } from "../../../documents/document-policy";
import { requireMaterialManager } from "./material-access";

type R2BucketLike={put(key:string,value:ArrayBuffer|Uint8Array,options?:{httpMetadata?:{contentType?:string};customMetadata?:Record<string,string>}):Promise<unknown>;delete(key:string):Promise<void>};
const bucket=()=>((env as unknown as {FILES?:R2BucketLike}).FILES);
const extension:Record<string,string>={"application/pdf":"pdf","image/png":"png","image/jpeg":"jpg"};

// One material per request (multipart): a link (`url`) or an uploaded file (`file`). Files reuse the document
// policy, so only PDF, PNG and JPEG are accepted and the content is sniffed rather than trusted from its name.
export async function POST(request:Request){
  return withDatabase("Unable to add material", async db => {
    enforceWriteOrigin(request);
    const actor=await requireActor(request,db);
    await enforceRateLimit(db,request,"learning-material",60,3600,actor.id);
    const form=await request.formData(),courseId=number(form.get("courseId")),kind=String(form.get("kind")||"");
    if(!courseId)throw new Response("Course not found",{status:404});
    const course=await requireMaterialManager(db,actor,courseId);
    if(!["draft","active"].includes(String(course.status)))throw new Response("Materials can only be added to an open program",{status:409});
    if(!MATERIAL_KINDS.includes(kind))throw new Response("Unsupported material type",{status:400});
    const title=parseMaterialTitle(form.get("title"));
    const count=await db.prepare("SELECT COUNT(*)::int AS total FROM training_materials WHERE course_id=?").bind(courseId).first<{total:number}>();
    if(Number(count?.total)>=MAX_MATERIALS_PER_COURSE)throw new Response(`A program can have at most ${MAX_MATERIALS_PER_COURSE} materials`,{status:409});
    let id:number;
    if(kind==="link"){
      const url=parseMaterialUrl(form.get("url"));
      id=(await db.prepare("INSERT INTO training_materials(course_id,title,kind,url,created_by_user_id,created_at,updated_at) VALUES (?,?,'link',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").bind(courseId,title,url,actor.id).first<{id:number}>())!.id;
    }else{
      const file=form.get("file");
      if(!(file instanceof File))throw new Response("Material file is required",{status:400});
      const storage=bucket();
      if(!storage)throw new Response("Document storage is not configured",{status:503});
      const bytes=new Uint8Array(await file.arrayBuffer()),fileName=normalizeFilename(file.name);
      let mime:string;
      try{mime=validateDocumentFile({bytes,filename:fileName,declaredMime:file.type,maxBytes:MAX_MATERIAL_BYTES});}
      catch(cause){throw new Response(cause instanceof Error?cause.message:"Invalid file",{status:400});}
      const objectKey=`training-materials/${courseId}/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${extension[mime]}`;
      await storage.put(objectKey,bytes,{httpMetadata:{contentType:mime},customMetadata:{courseId:String(courseId)}});
      try{
        id=(await db.prepare("INSERT INTO training_materials(course_id,title,kind,object_key,file_name,content_type,size_bytes,created_by_user_id,created_at,updated_at) VALUES (?,?,'file',?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").bind(courseId,title,objectKey,fileName,mime,bytes.length,actor.id).first<{id:number}>())!.id;
      }catch(error){await storage.delete(objectKey).catch(()=>{});throw error;}
    }
    await audit(db,actor,"add_material","learning","course_material",id,{courseId,kind,title});
    return Response.json({ok:true,id},{status:201});
  });
}
