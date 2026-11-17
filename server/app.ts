import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Store } from './store.ts';
import { act, publicView } from './room.ts';
import { author, aiReady, museModel } from './ai.ts';
import { kaneBinary } from './kane.ts';
import { VerificationWorker } from './worker.ts';

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inspect'), target: z.enum(['notebook', 'drawer', 'key', 'door']) }).strict(),
  z.object({ type: z.literal('unlock'), code: z.string().regex(/^\d{4}$/) }).strict(),
  z.object({ type: z.literal('collect') }).strict(), z.object({ type: z.literal('escape') }).strict(), z.object({ type: z.literal('hint') }).strict()
]);
export async function buildApp(options: { directory?: string; logger?: boolean; origin?: string } = {}) {
  const directory = resolve(options.directory || process.env.DATA_DIR || './data');
  const store = new Store(directory);
  const secretFile = resolve(directory, 'cookie-secret');
  if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(48).toString('hex'), { mode: 0o600 });
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 32000, trustProxy: false });
  await app.register(cookie, { secret: readFileSync(secretFile, 'utf8') });
  await app.register(rateLimit, { max: 180, timeWindow: '1 minute' });
  const sessions = new Map<string, number>();
  const listeners = new Set<() => void>();
  const streams = new Set<import('node:http').ServerResponse>();
  const origin = options.origin || process.env.APP_ORIGIN || 'http://127.0.0.1:5173';
  const worker = new VerificationWorker(store, directory, origin, () => { for (const notify of listeners) notify(); });
  const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: process.env.COOKIE_SECURE === 'true', path: '/', signed: true };
  function operator(request: { cookies: Record<string, string | undefined>; unsignCookie: (value: string) => { valid: boolean; value: string | null } }) {
    const value = request.cookies.ep_operator;
    if (!value) return false;
    const unsigned = request.unsignCookie(value);
    return unsigned.valid && Boolean(unsigned.value && (sessions.get(unsigned.value) || 0) > Date.now());
  }
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('X-Frame-Options', 'DENY');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const incoming = request.headers.origin;
      if (request.headers['sec-fetch-site'] === 'cross-site' || (incoming && incoming !== origin && incoming !== `${request.protocol}://${request.host}`)) return reply.code(403).send({ error: 'Cross-origin mutation rejected.' });
    }
    const route = request.routeOptions.url || request.url.split('?')[0];
    if (route.startsWith('/api/operator/') && route !== '/api/operator/login' && !operator(request)) return reply.code(401).send({ error: 'Operator access required.' });
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const code = error instanceof z.ZodError ? 400 : (error as { statusCode?: number }).statusCode || 400;
    reply.code(code).send({ error: error instanceof z.ZodError ? error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : error instanceof Error ? error.message : 'Request failed.' });
  });
  app.get('/api/health', async () => ({ ok: true, name: 'EscapeProof', operatorConfigured: Boolean(process.env.OPERATOR_TOKEN), aiConfigured: aiReady() }));
  app.post('/api/operator/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { token } = z.object({ token: z.string().max(300) }).parse(request.body);
    const expected = process.env.OPERATOR_TOKEN;
    if (!expected) return reply.code(503).send({ error: 'Set OPERATOR_TOKEN in .env to enable the workshop.' });
    const provided = Buffer.from(token), required = Buffer.from(expected);
    if (provided.length !== required.length || !timingSafeEqual(provided, required)) return reply.code(401).send({ error: 'Invalid operator token.' });
    for (const [id, expiry] of sessions) if (expiry < Date.now()) sessions.delete(id);
    const id = randomBytes(32).toString('hex'); sessions.set(id, Date.now() + 8 * 3600000);
    reply.setCookie('ep_operator', id, { ...cookieOptions, maxAge: 8 * 3600 });
    return { ok: true };
  });
  app.post('/api/operator/logout', async (request, reply) => {
    const signed = request.cookies.ep_operator && request.unsignCookie(request.cookies.ep_operator);
    if (signed && signed.value) sessions.delete(signed.value);
    reply.clearCookie('ep_operator', { path: '/' }); return { ok: true };
  });
  function snapshot() { return { revisions: store.revisions(), jobs: store.jobs(), publishedRevision: store.get('published'), capabilities: { ai: aiReady(), operator: true, kane: kaneBinary(), model: museModel() } }; }
  app.get('/api/operator/workshop', async () => snapshot());
  app.get('/api/operator/events', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    streams.add(reply.raw);
    const send = () => { if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(snapshot())}\n\n`); };
    listeners.add(send); send();
    const heartbeat = setInterval(() => reply.raw.write(': keepalive\n\n'), 20000);
    reply.raw.on('close', () => { listeners.delete(send); streams.delete(reply.raw); clearInterval(heartbeat); });
  });
  let generating = false;
  app.post('/api/operator/generate', async (request, reply) => {
    const { theme } = z.object({ theme: z.string().min(3).max(500) }).parse(request.body);
    if (generating) return reply.code(409).send({ error: 'Another room is being generated. Please wait.' });
    generating = true;
    try { const result = await author(theme); const revision = store.addRevision(result.room, 'ai-generated', null, result.explanation); return { id: revision.id }; }
    finally { generating = false; for (const notify of listeners) notify(); }
  });
  app.post('/api/operator/revisions/:id/fault', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const base = store.revision(id), room = structuredClone(base.room); room.notebook.clue = '';
    const draft = store.addRevision(room, 'fault-injection', id, 'Developer fault injection: removed the required visible notebook clue. This is a new, unverified draft.');
    for (const notify of listeners) notify(); return { id: draft.id };
  });
  app.post('/api/operator/revisions/:id/preview', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { url: `/?verify=${store.ticket(id)}` };
  });
  app.post('/api/operator/revisions/:id/verify', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const job = store.createJob(id); worker.enqueue(job.id); reply.code(202); return { id: job.id };
  });
  app.post('/api/operator/revisions/:id/publish', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    store.publish(id); for (const notify of listeners) notify(); return { ok: true };
  });
  app.get('/api/operator/evidence/:job/:attempt/:file', async (request, reply) => {
    const params = z.object({ job: z.string().uuid(), attempt: z.string().regex(/^attempt-[0-2]-(clues|solution)$/), file: z.string().regex(/^(events\.ndjson|stderr\.txt|[\w.-]+\.evidence)$/) }).parse(request.params);
    store.job(params.job);
    const path = resolve(directory, 'evidence', params.job, params.attempt, params.file);
    if (!existsSync(path)) return reply.code(404).send({ error: 'Evidence not found.' });
    reply.header('Content-Type', 'application/octet-stream').header('Content-Disposition', `attachment; filename="${params.file}"`);
    return reply.send(readFileSync(path));
  });
  function sessionFor(request: { cookies: Record<string, string | undefined>; unsignCookie: (value: string) => { valid: boolean; value: string | null } }) {
    const signed = request.cookies.ep_player && request.unsignCookie(request.cookies.ep_player);
    return signed && signed.valid && signed.value ? store.session(signed.value) : null;
  }
  function view(session: NonNullable<ReturnType<typeof sessionFor>>, message = '') {
    const revision = store.revision(session.revisionId);
    return publicView(revision.room, session.state, { id: revision.id, source: revision.source, published: store.get('published') === revision.id, verified: store.status(revision.id) === 'verified' }, message);
  }
  app.get('/api/play', async (request, reply) => {
    let session = sessionFor(request);
    if (!session) { session = store.createSession(store.get('published') || store.get('demo')!); reply.setCookie('ep_player', session.id, { ...cookieOptions, maxAge: 86400 }); }
    return view(session);
  });
  app.post('/api/play/start', async (request, reply) => {
    const { ticket } = z.object({ ticket: z.string().max(100).optional() }).strict().parse(request.body ?? {});
    const current = sessionFor(request);
    const session = ticket ? store.redeemTicket(ticket, current?.id) : store.createSession(current?.revisionId || store.get('published') || store.get('demo')!, true);
    if (!session) return reply.code(410).send({ error: 'This draft preview link has expired or was already used by another session. Request a new one in the workshop.' });
    reply.setCookie('ep_player', session.id, { ...cookieOptions, maxAge: 86400 }); return view(session);
  });
  app.post('/api/play/action', async (request, reply) => {
    const action = actionSchema.parse(request.body), session = sessionFor(request);
    if (!session) return reply.code(401).send({ error: 'Your expedition expired. Reload to begin again.' });
    const result = act(store.revision(session.revisionId).room, session.state, action);
    store.saveSession(session.id, result.state); return view({ ...session, state: result.state }, result.message);
  });
  const dist = resolve('dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    await app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found.' }) : reply.sendFile('index.html'));
  }
  app.addHook('preClose', async () => { for (const stream of streams) stream.end(); await worker.close(); });
  app.addHook('onClose', async () => { store.close(); });
  return { app, store };
}
