import { env } from "cloudflare:workers";
import { createDatabase } from "../../../db/postgres";
import { apiFailure, canAccessEmployee, enforceRateLimit, enforceWriteOrigin, requireActor } from "../api-security";
import { categoryApplies, documentState, normalizeFilename, safeDocumentObjectKey, validateDocumentFile } from "../../documents/document-policy";

type Row=Record<string,unknown>;
type R2BucketLike={put(key:string,value:ArrayBuffer|Uint8Array,options?:{httpMetadata?:{contentType?:string};customMetadata?:Record<string,string>}):Promise<unknown>;delete(key:string):Promise<void>};
const bucket=()=>((env as unknown as {FILES?:R2BucketLike}).FILES);
const audit=(db:ReturnType<typeof createDatabase>,request:Request,userId:number,action:string,id:string,next?:unknown)=>db.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,new_value,ip_address,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(userId,action,"documents","document",id,next===undefined?null:JSON.stringify(next),request.headers.get("cf-connecting-ip")).run();

export async function GET(request:Request){const db=createDatabase();try{
  const actor=await requireActor(request,db),url=new URL(request.url),employeeId=Number(url.searchParams.get("employeeId")||actor.employeeId);if(!employeeId)throw new Response("Employee is required",{status:400});
  if(!(await canAccessEmployee(db,actor,employeeId)))throw new Response("Employee is outside your access scope",{status:403});
  const employee=await db.prepare("SELECT id,country,employment_type FROM employees WHERE id=? AND employment_status!='deleted'").bind(employeeId).first<Row>();if(!employee)throw new Response("Employee not found",{status:404});
  const privileged=["Super Admin","HR Manager"].includes(actor.roleName),self=Number(actor.employeeId)===employeeId,manager=actor.roleName==="Department Manager";
  const categories=(await db.prepare("SELECT * FROM document_categories WHERE status='active' ORDER BY id").all()).results as Row[];
  const applicable=categories.filter(category=>categoryApplies(category as never,employee as never));
  const visibleCodes=applicable.filter(category=>privileged||(self&&Number(category.employee_can_view))||(manager&&Number(category.manager_can_view))).map(category=>String(category.code));
  const includeArchived=privileged&&url.searchParams.get("includeArchived")==="1";
  const rows=visibleCodes.length?(await db.prepare(`SELECT id,employee_id,name,category,document_number,content_type,size_bytes,issue_date,expiry_date,status,version,uploaded_by_user_id,created_at,updated_at,archived_at FROM documents WHERE employee_id=? AND category IN (${visibleCodes.map(()=>"?").join(",")}) ${includeArchived?"":"AND status!='archived'"} ORDER BY created_at DESC LIMIT 200`).bind(employeeId,...visibleCodes).all()).results:[];
  const documents=rows.map(row=>({...row,state:documentState({expiryDate:String(row.expiry_date||"")||null,status:String(row.status)})}));
  const versions=privileged?(await db.prepare("SELECT v.id,v.document_id,v.version,v.name,v.content_type,v.size_bytes,v.uploaded_by_user_id,v.created_at FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE d.employee_id=? ORDER BY v.created_at DESC,v.id DESC LIMIT 200").bind(employeeId).all()).results:[];
  const activeCategories=new Set(rows.filter(row=>row.status!=="archived").map(row=>String(row.category)));
  const missing=applicable.filter(category=>Number(category.required_document)&&!activeCategories.has(String(category.code))).map(category=>({code:category.code,name_en:category.name_en,name_ar:category.name_ar}));
  return Response.json({documents,versions,categories:applicable.map(category=>({...category,canUpload:privileged||(self&&Boolean(category.employee_can_upload)),canView:visibleCodes.includes(String(category.code))})),missing,permissions:{canManage:privileged,canUpload:privileged||self}},{headers:{"cache-control":"no-store"}});
}catch(error){return apiFailure(error,"Unable to load documents");}finally{await db.close();}}

export async function POST(request:Request){const db=createDatabase();let objectKey:string|undefined;try{
  enforceWriteOrigin(request);const actor=await requireActor(request,db);await enforceRateLimit(db,request,"document-upload",20,3600,actor.id);
  const storage=bucket();if(!storage)throw new Response("Document storage is not configured",{status:503});
  const form=await request.formData(),employeeId=Number(form.get("employeeId")||actor.employeeId),categoryCode=String(form.get("category")||""),file=form.get("file");if(!employeeId||!(file instanceof File))throw new Response("Employee and file are required",{status:400});
  if(!(await canAccessEmployee(db,actor,employeeId)))throw new Response("Employee is outside your access scope",{status:403});
  const category=await db.prepare("SELECT * FROM document_categories WHERE code=? AND status='active'").bind(categoryCode).first<Row>(),employee=await db.prepare("SELECT country,employment_type FROM employees WHERE id=? AND employment_status!='deleted'").bind(employeeId).first<Row>();if(!category||!employee||!categoryApplies(category as never,employee as never))throw new Response("Document category is not applicable",{status:400});
  const privileged=["Super Admin","HR Manager"].includes(actor.roleName),self=Number(actor.employeeId)===employeeId;if(!privileged&&!(self&&Number(category.employee_can_upload)))throw new Response("Uploading this document category is not allowed",{status:403});
  const expiryDate=String(form.get("expiryDate")||"")||null;if(Number(category.requires_expiry)&&!expiryDate)throw new Response("Expiry date is required for this category",{status:400});
  const bytes=new Uint8Array(await file.arrayBuffer()),name=normalizeFilename(file.name),allowed=String(category.allowed_mime_types).split(",").map(value=>value.trim());let mime:string;try{mime=validateDocumentFile({bytes,filename:name,declaredMime:file.type,allowedMimes:allowed,maxBytes:Number(category.max_size_bytes)});}catch(cause){throw new Response(cause instanceof Error?cause.message:"Invalid file",{status:400});}
  objectKey=safeDocumentObjectKey(employeeId,categoryCode,mime);await storage.put(objectKey,bytes,{httpMetadata:{contentType:mime},customMetadata:{employeeId:String(employeeId),category:categoryCode}});
  const row=await db.prepare("INSERT INTO documents (employee_id,name,category,document_number,object_key,content_type,size_bytes,issue_date,expiry_date,status,version,uploaded_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',1,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").bind(employeeId,name,categoryCode,String(form.get("documentNumber")||"")||null,objectKey,mime,bytes.length,String(form.get("issueDate")||"")||null,expiryDate,actor.id).first<{id:number}>();
  await audit(db,request,actor.id,"document_uploaded",String(row!.id),{employeeId,category:categoryCode,name,sizeBytes:bytes.length,contentType:mime});return Response.json({ok:true,id:row!.id},{status:201});
}catch(error){if(objectKey)await bucket()?.delete(objectKey).catch(()=>{});return apiFailure(error,"Unable to upload document");}finally{await db.close();}}
