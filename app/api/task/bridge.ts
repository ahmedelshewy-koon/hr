import { createDatabase } from '../../../db/postgres';
import { requireActor } from '../api-security';
import { env } from 'cloudflare:workers';

// Forwards the HR session to a read-only TASK endpoint; TASK derives identity from it.
export async function proxyTaskBridge(request: Request, path: '/api/hr/tasks' | '/api/hr/team-tasks') {
  const headers = { 'Cache-Control': 'no-store' };
  const db = createDatabase();
  try {
    await requireActor(request, db);
    const cookie = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith('koon_portal_session='));
    const token = cookie?.slice('koon_portal_session='.length);
    if (!token) return Response.json({ error: 'Sign-in required.' }, { status: 401, headers });
    const configuredOrigin = String((env as unknown as Record<string, unknown>).TASK_APP_URL || process.env.TASK_APP_URL || (process.env.NODE_ENV !== 'production' ? 'http://127.0.0.1:3107' : ''));
    if (!configuredOrigin) return Response.json({ error: 'Task integration is not configured.' }, { status: 503, headers });
    const target = new URL(configuredOrigin);
    if (!['http:', 'https:'].includes(target.protocol) || (process.env.NODE_ENV === 'production' && target.protocol !== 'https:')) throw new Error('Invalid task URL');
    const origin = target.origin;
    const response = await fetch(new URL(path, origin), {
      // Workers does not support redirect: 'error'. Manual keeps credentials on
      // the configured origin; the non-2xx check below rejects every redirect.
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.error('HR task bridge: upstream status', response.status);
      return Response.json({ error: 'Tasks are temporarily unavailable.' }, { status: [401, 403].includes(response.status) ? response.status : 503, headers });
    }
    const payload = await response.json();
    if (!Array.isArray(payload.tasks)) throw new Error('Invalid task response');
    return Response.json({ tasks: payload.tasks, taskAppUrl: origin }, { headers });
  } catch (error) {
    if (!(error instanceof Response)) console.error('HR task bridge failed:', error instanceof Error ? error.message : 'Unknown failure');
    return Response.json({ error: 'Tasks are temporarily unavailable.' }, { status: error instanceof Response ? error.status : 503, headers });
  } finally { await db.close(); }
}
