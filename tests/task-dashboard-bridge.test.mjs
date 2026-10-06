import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, Response } from 'miniflare';

// Run the real route in workerd: Node fetch accepts options this runtime rejects.
async function bridge(outboundService, route = 'my-tasks') {
  const bundle = await build({
    stdin: { contents: `import {GET} from './app/api/task/${route}/route.ts'; export default {fetch:GET};`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'neutral',
    external: ['cloudflare:workers'], define: { 'process.env.NODE_ENV': '"development"', 'process.env.TASK_APP_URL': '""' },
    plugins: [{ name: 'isolate-database-auth', setup(build) {
      build.onResolve({ filter: /(?:db\/postgres|api-security)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export function createDatabase(){return {close:async()=>{}}} export async function requireActor(){return {id:7}}', loader: 'js' }));
    } }],
  });
  return new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-05-22', bindings: { TASK_APP_URL: 'http://task.test' }, outboundService });
}

test('HR dashboard can fetch assigned tasks in the Workers runtime', async () => {
  const worker = await bridge(async request => {
    assert.equal(request.url, 'http://task.test/api/hr/tasks');
    assert.equal(request.headers.get('authorization'), 'Bearer fixture-session');
    return Response.json({ tasks: [{ id: 'task-1', title: 'Assigned task' }] });
  });
  try {
    const response = await worker.dispatchFetch('http://hr.test/api/task/my-tasks', { headers: { cookie: 'koon_portal_session=fixture-session' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { tasks: [{ id: 'task-1', title: 'Assigned task' }], taskAppUrl: 'http://task.test' });
  } finally { await worker.dispose(); }
});

test('HR dashboard refuses upstream redirects without forwarding the session', async () => {
  const calls = [];
  const worker = await bridge(async request => {
    calls.push(request.url);
    return new Response(null, { status: 302, headers: { location: 'http://other.test/' } });
  });
  try {
    const response = await worker.dispatchFetch('http://hr.test/api/task/my-tasks', { headers: { cookie: 'koon_portal_session=fixture-session' } });
    assert.equal(response.status, 503);
    assert.deepEqual(calls, ['http://task.test/api/hr/tasks']);
  } finally { await worker.dispose(); }
});


test('HR dashboard fetches team tasks for managers through the same bridge', async () => {
  const worker = await bridge(async request => {
    assert.equal(request.url, 'http://task.test/api/hr/team-tasks');
    assert.equal(request.headers.get('authorization'), 'Bearer fixture-session');
    return Response.json({ tasks: [{ id: 'task-2', title: 'Report task', assignees: ['Report'] }] });
  }, 'team-tasks');
  try {
    const response = await worker.dispatchFetch('http://hr.test/api/task/team-tasks', { headers: { cookie: 'koon_portal_session=fixture-session' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { tasks: [{ id: 'task-2', title: 'Report task', assignees: ['Report'] }], taskAppUrl: 'http://task.test' });
  } finally { await worker.dispose(); }
});
