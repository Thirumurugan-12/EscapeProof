// Explicit test doubles exercise orchestration; these are NOT live Kane evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.ts';
import { VerificationWorker } from '../server/worker.ts';
import { handcrafted } from '../server/room.ts';
import type { KaneResult } from '../server/kane.ts';

const result = (outcome: KaneResult['outcome']): KaneResult => ({ outcome, exitCode: outcome === 'passed' ? 0 : 1, summary: 'TEST DOUBLE — not real verification', events: [{ type: 'test-double' }], artifacts: [], testUrl: null });

for (const scenario of ['repair-success', 'repair-limit', 'infrastructure'] as const) {
  test(`worker orchestration with explicit test doubles: ${scenario}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'escapeproof-worker-test-')), store = new Store(dir);
    try {
      const faulty = structuredClone(handcrafted); faulty.notebook.clue = '';
      const revision = store.addRevision(faulty, 'test-fixture', null, 'Test-only missing clue');
      const job = store.createJob(revision.id); let checks = 0, repairs = 0; const urls: string[] = [];
      let finish!: () => void;
      const finished = new Promise<void>(resolve => { finish = resolve; });
      const worker = new VerificationWorker(store, dir, 'http://test.invalid', id => {
        if (['verified', 'failed', 'infrastructure-error'].includes(store.job(id).status)) finish();
      }, {
        aiReady: () => true,
        runKane: async options => {
          checks++; urls.push(options.url);
          return result(scenario === 'infrastructure' ? 'infrastructure-error' : scenario === 'repair-limit' || checks === 1 ? 'product-failure' : 'passed');
        },
        author: async (_theme, input) => {
          repairs++; assert.ok(input); assert.ok(JSON.stringify(input.evidence).includes('TEST DOUBLE'));
          return { room: structuredClone(handcrafted), explanation: 'Test-only repair response.' };
        }
      });
      worker.enqueue(job.id);
      await Promise.race([finished, new Promise((_, reject) => { const timeout = setTimeout(() => reject(new Error('Worker did not finish')), 3000); timeout.unref(); })]);
      const final = store.job(job.id);
      if (scenario === 'repair-success') {
        assert.equal(final.status, 'verified'); assert.equal(repairs, 1); assert.equal(checks, 3); assert.notEqual(final.currentRevisionId, revision.id);
        assert.equal(store.status(revision.id), 'failed', 'The original failed revision keeps its failure status after the job advances to a repair.');
        store.publish(final.currentRevisionId); assert.throws(() => store.publish(revision.id), /not passed/);
      } else if (scenario === 'repair-limit') { assert.equal(final.status, 'failed'); assert.equal(repairs, 2); assert.equal(checks, 3); assert.throws(() => store.publish(final.currentRevisionId)); }
      else { assert.equal(final.status, 'infrastructure-error'); assert.equal(repairs, 0); assert.equal(checks, 1); assert.equal(final.currentRevisionId, revision.id); }
      assert.equal(new Set(urls).size, urls.length, 'Every check must have a fresh single-use ticket.');
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
}

test('shutdown cancels the active verification and terminates queued jobs without repairs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'escapeproof-shutdown-test-')), store = new Store(dir);
  try {
    const active = store.createJob(store.get('demo')!);
    const queued = store.createJob(store.addRevision(handcrafted, 'test-fixture', null, 'Queued fixture').id);
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const worker = new VerificationWorker(store, dir, 'http://test.invalid', () => {}, {
      aiReady: () => true,
      author: async () => { throw new Error('Shutdown must never author a repair.'); },
      runKane: async options => {
        entered();
        await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => resolve(), { once: true }));
        return result('infrastructure-error');
      }
    });
    worker.enqueue(active.id); worker.enqueue(queued.id);
    await started; await worker.close();
    assert.equal(store.job(active.id).status, 'infrastructure-error');
    assert.equal(store.job(queued.id).status, 'infrastructure-error');
    assert.equal(store.job(active.id).repairs, 0);
    assert.throws(() => worker.enqueue(active.id), /shutting down/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
