import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { act, handcrafted, initialState, publicView } from './room.ts';
import type { PlayerState } from '../shared/types.ts';

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inspect'), target: z.enum(['notebook', 'drawer', 'key', 'door']) }).strict(),
  z.object({ type: z.literal('unlock'), code: z.string().regex(/^\d{4}$/) }).strict(),
  z.object({ type: z.literal('collect') }).strict(), z.object({ type: z.literal('escape') }).strict(), z.object({ type: z.literal('hint') }).strict()
]);
const cookieName = '__Host-escapeproof-demo';
const lifetime = 60 * 60 * 24;
const revision = 'handcrafted-demo-v1';

// Authenticated encryption keeps state portable across stateless function instances.
// Only player progress enters the cookie; answers and the room remain server-side.
export function createDemoHandler(secret: string) {
  if (secret.length < 32) throw new Error('DEMO_SESSION_SECRET must contain at least 32 characters.');
  const key = createHash('sha256').update(secret).digest();
  function seal(state: PlayerState) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(revision));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ state, expires: Date.now() + lifetime * 1000 })), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
  function open(cookie: string): PlayerState | null {
    try {
      if (cookie.length > 3000) return null;
      const value = Buffer.from(cookie, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAAD(Buffer.from(revision)); decipher.setAuthTag(value.subarray(12, 28));
      const payload = JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString());
      return payload.expires > Date.now() ? payload.state : null;
    } catch { return null; }
  }
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const headers = new Headers({ 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, mode: 'playable-demo', workshop: 'local' });
    if (!['/api/play', '/api/play/start', '/api/play/action'].includes(url.pathname)) return json({ error: 'The generation and Kane verification workshop runs locally. See the project repository for setup.' }, 404);
    const expectedMethod = url.pathname === '/api/play' ? 'GET' : 'POST';
    if (request.method !== expectedMethod) { headers.set('Allow', expectedMethod); return json({ error: 'Method not allowed.' }, 405); }
    if (request.method === 'POST') {
      if (request.headers.get('sec-fetch-site') === 'cross-site' || (request.headers.get('origin') && request.headers.get('origin') !== url.origin)) return json({ error: 'Cross-site actions are not allowed.' }, 403);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Expected JSON.' }, 415);
    }
    const cookie = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    let state = cookie ? open(cookie) : null, message = '';
    if (url.pathname === '/api/play/action') {
      if (!state?.started) return json({ error: 'Begin a new expedition to play.' }, 409);
      try {
        const body = await request.text();
        if (body.length > 2000) return json({ error: 'Request too large.' }, 413);
        const result = act(handcrafted, state, actionSchema.parse(JSON.parse(body)));
        state = result.state; message = result.message;
      } catch { return json({ error: 'Invalid game action.' }, 400); }
    } else if (url.pathname === '/api/play/start') {
      state = initialState(); state.started = true;
    } else { state ||= initialState(); }
    headers.set('Set-Cookie', `${cookieName}=${seal(state!)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${lifetime}`);
    return json(publicView(handcrafted, state!, { id: revision, source: 'handcrafted', published: true, verified: false }, message));
  };
}
