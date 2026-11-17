import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../server/app.ts';
import type { Action } from '../shared/types.ts';

test('API protects operators, rejects CSRF, keeps secrets private and supports the full player flow', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'escapeproof-api-')); process.env.OPERATOR_TOKEN = 'test-only-not-a-deployment-token';
  const { app } = await buildApp({ directory: dir });
  try {
    assert.equal((await app.inject({ url: '/api/operator/workshop' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/operator/login', payload: { token: process.env.OPERATOR_TOKEN }, headers: { origin: 'https://attacker.invalid' } })).statusCode, 403);
    const login = await app.inject({ method: 'POST', url: '/api/operator/login', payload: { token: process.env.OPERATOR_TOKEN } }); assert.equal(login.statusCode, 200);
    const operatorCookie = login.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const workshop = await app.inject({ url: '/api/operator/workshop', headers: { cookie: operatorCookie } }); assert.equal(workshop.statusCode, 200); assert.ok(!workshop.body.includes('3142'));
    const revision = workshop.json().revisions[0].id;
    assert.equal((await app.inject({ method: 'POST', url: `/api/operator/revisions/${revision}/publish`, headers: { cookie: operatorCookie }, payload: {} })).statusCode, 400);
    const first = await app.inject({ url: '/api/play' }); assert.equal(first.statusCode, 200); assert.ok(!first.body.includes('3142')); assert.equal(first.json().notebook, null);
    assert.equal(first.json().state.started, false);
    const begin = await app.inject({ method: 'POST', url: '/api/play/start', headers: { cookie: first.cookies.map(c => `${c.name}=${c.value}`).join('; ') }, payload: {} });
    assert.equal(begin.json().state.started, true);
    const playerCookie = begin.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const refreshed = await app.inject({ url: '/api/play', headers: { cookie: playerCookie } });
    assert.equal(refreshed.json().state.started, true); assert.equal(refreshed.json().state.startedAt, begin.json().state.startedAt);
    async function action(payload: Action) { const response = await app.inject({ method: 'POST', url: '/api/play/action', headers: { cookie: playerCookie }, payload }); assert.equal(response.statusCode, 200); return response.json(); }
    assert.equal((await action({ type: 'escape' })).state.escaped, false);
    assert.ok((await action({ type: 'inspect', target: 'notebook' })).notebook.includes('THREE'));
    assert.equal((await action({ type: 'unlock', code: '0000' })).state.drawerOpen, false);
    assert.equal((await action({ type: 'unlock', code: '3142' })).state.drawerOpen, true);
    assert.equal((await action({ type: 'collect' })).state.hasKey, true);
    assert.equal((await action({ type: 'escape' })).state.escaped, true);
    const stranger = await app.inject({ url: '/api/play' }); assert.equal(stranger.json().state.escaped, false);
    const fault = await app.inject({ method: 'POST', url: `/api/operator/revisions/${revision}/fault`, headers: { cookie: operatorCookie }, payload: {} }); assert.equal(fault.statusCode, 200);
    const preview = await app.inject({ method: 'POST', url: `/api/operator/revisions/${fault.json().id}/preview`, headers: { cookie: operatorCookie }, payload: {} });
    const ticket = new URL(preview.json().url, 'http://local').searchParams.get('verify');
    const fresh = await app.inject({ method: 'POST', url: '/api/play/start', payload: { ticket } }); assert.equal(fresh.statusCode, 200); assert.equal(fresh.json().state.moves, 0);
    const freshCookie = fresh.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const revisit = await app.inject({ method: 'POST', url: '/api/play/start', headers: { cookie: freshCookie }, payload: { ticket } });
    assert.equal(revisit.statusCode, 200); assert.equal(revisit.json().state.startedAt, fresh.json().state.startedAt);
    assert.equal((await app.inject({ method: 'POST', url: '/api/play/start', payload: { ticket } })).statusCode, 410);
    assert.equal((await app.inject({ method: 'POST', url: '/api/play/start', headers: { cookie: playerCookie }, payload: { ticket } })).statusCode, 410);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); delete process.env.OPERATOR_TOKEN; }
});
