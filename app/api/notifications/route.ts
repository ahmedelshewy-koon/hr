import { withDatabase } from "../route-helpers";
import { enforceWriteOrigin, requireActor } from "../api-security";
import { syncOperationalNotifications } from "../../notifications/notification-service";

export async function GET(request:Request){
  return withDatabase("Unable to load notifications", async db => {const actor=await requireActor(request,db);await syncOperationalNotifications(db);const limit=Math.min(50,Math.max(1,Number(new URL(request.url).searchParams.get("limit"))||20));const [rows,count]=await Promise.all([db.prepare("SELECT id,type,title_key,message_key,entity_type,entity_id,target_path,read_at,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT ?").bind(actor.id,limit).all(),db.prepare("SELECT COUNT(*)::integer AS count FROM notifications WHERE user_id=? AND read_at IS NULL").bind(actor.id).first<{count:number}>()]);return Response.json({notifications:rows.results,unread:Number(count?.count)||0},{headers:{"cache-control":"no-store"}});});
}
export async function PATCH(request:Request){
  return withDatabase("Unable to update notifications", async db => {enforceWriteOrigin(request);const actor=await requireActor(request,db),body=await request.json() as {id?:unknown;all?:unknown};if(body.all){await db.prepare("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL").bind(actor.id).run();}else{const id=Number(body.id);if(!id)throw new Response("Notification is required",{status:400});const changed=await db.prepare("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND read_at IS NULL RETURNING id").bind(id,actor.id).first();if(!changed){const exists=await db.prepare("SELECT id FROM notifications WHERE id=? AND user_id=?").bind(id,actor.id).first();if(!exists)throw new Response("Notification not found",{status:404});}}return Response.json({ok:true});});
}
