import { getChatGPTUser } from "../../chatgpt-auth";
import { clearPortalSessionCookie, createPortalSession, portalLoginEmail, portalSessionCookie, readPortalSession, verifyPortalPassword } from "../../portal-auth";

async function requirePlatformAccess(request: Request) {
  const user = await getChatGPTUser();
  const hostname = new URL(request.url).hostname;
  if (!user && hostname !== "localhost" && hostname !== "127.0.0.1") throw new Response("Authentication required", { status:401 });
}

function isSecure(request: Request) { return new URL(request.url).protocol === "https:"; }

export async function GET(request: Request) {
  try {
    await requirePlatformAccess(request);
    const session = await readPortalSession(request);
    return Response.json({ authenticated:Boolean(session), email:session?.email ?? null });
  } catch(error) { return error instanceof Response ? error : Response.json({ error:"Unable to check login" }, { status:500 }); }
}

export async function POST(request: Request) {
  try {
    await requirePlatformAccess(request);
    const body = await request.json() as { email?:unknown; password?:unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const valid = email === portalLoginEmail() && password.length <= 200 && await verifyPortalPassword(password);
    if (!valid) return Response.json({ error:"البريد الإلكتروني أو كلمة المرور غير صحيحة" }, { status:401 });
    const token = await createPortalSession(email);
    return Response.json({ authenticated:true, email }, { headers:{ "set-cookie":portalSessionCookie(token,isSecure(request)), "cache-control":"no-store" } });
  } catch(error) { return error instanceof Response ? error : Response.json({ error:"تعذر تسجيل الدخول" }, { status:500 }); }
}

export async function DELETE(request: Request) {
  return Response.json({ authenticated:false }, { headers:{ "set-cookie":clearPortalSessionCookie(isSecure(request)), "cache-control":"no-store" } });
}
