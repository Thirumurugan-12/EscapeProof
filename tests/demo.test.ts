import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoHandler } from '../server/demo.ts';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const origin = 'https://escapeproof.example';
function client() {
  let cookie = '';
  return async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
    // A new handler models a different serverless instance on every request.
    const result = await createDemoHandler(secret)(new Request(`${origin}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json', origin }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    }));
    const updated = result.headers.get('set-cookie'); if (updated) cookie = updated.split(';')[0];
    return { response: result, data: await result.json(), cookie };
  };
}
test('stateless demo preserves the complete server-authoritative escape across instances and resets', async () => {
  const request = client();
  let result = await request('/play');
  assert.equal(result.data.notebook, null);
  assert.ok(!JSON.stringify(result.data).includes('3142'));
  assert.match(result.response.headers.get('set-cookie')!, /HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await request('/play/action', { type: 'escape' })).response.status, 409);
  await request('/play/start', {});
  assert.equal((await request('/play/action', { type: 'collect' })).data.state.hasKey, false);
  await request('/play/action', { type: 'inspect', target: 'notebook' });
  assert.equal((await request('/play')).data.state.inspected[0], 'notebook');
  assert.equal((await request('/play/action', { type: 'unlock', code: '0000' })).data.state.drawerOpen, false);
  assert.equal((await request('/play/action', { type: 'unlock', code: '3142' })).data.state.drawerOpen, true);
  await request('/play/action', { type: 'collect' });
  assert.equal((await request('/play/action', { type: 'escape' })).data.state.escaped, true);
  assert.equal((await request('/play/start', {})).data.state.hasKey, false);
});
test('demo rejects forged state, cross-site actions and invalid actions; workshop is unavailable', async () => {
  const request = client();
  const first = await request('/play/start', {});
  const forged = first.cookie.slice(0, -8) + 'AAAAAAAA';
  const result = await request('/play/action', { type: 'escape' }, { cookie: forged });
  assert.equal(result.response.status, 409);
  assert.equal((await request('/play/start', {}, { origin: 'https://other.example' })).response.status, 403);
  assert.equal((await request('/play/action', { type: 'unlock', code: '3142', hasKey: true })).response.status, 400);
  assert.equal((await request('/operator/workshop')).response.status, 404);
});
