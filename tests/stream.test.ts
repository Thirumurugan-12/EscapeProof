import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../server/app.ts';

test('authenticated event streams deliver revision changes and close on shutdown', { timeout: 10000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'escapeproof-stream-test-'));
  const previous = process.env.OPERATOR_TOKEN; process.env.OPERATOR_TOKEN = 'test-only-stream-token';
  const { app, store } = await buildApp({ directory });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const login = await fetch(origin + '/api/operator/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: process.env.OPERATOR_TOKEN }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const events = await fetch(origin + '/api/operator/events', { headers: { cookie } });
    assert.equal(events.status, 200); reader = events.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value); assert.ok(initial.startsWith('data: '));
    const id = store.get('demo')!;
    const draft = await fetch(`${origin}/api/operator/revisions/${id}/fault`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
    const { id: draftId } = await draft.json() as { id: string };
    const update = new TextDecoder().decode((await reader.read()).value); assert.ok(update.includes(draftId));
    await app.close();
    assert.equal((await reader.read()).done, true);
  } finally {
    await reader?.cancel(); await app.close(); rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.OPERATOR_TOKEN; else process.env.OPERATOR_TOKEN = previous;
  }
});
