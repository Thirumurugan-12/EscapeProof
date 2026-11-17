import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.ts';
import { handcrafted } from '../server/room.ts';

test('publication requires both checks on exact revision in the same verified job', () => {
  const dir = mkdtempSync(join(tmpdir(), 'escapeproof-test-')); const store = new Store(dir);
  try {
    const id = store.get('demo')!; assert.throws(() => store.publish(id), /not passed/);
    const job = store.createJob(id); store.updateJob(job.id, 'verified');
    store.check(job.id, id, 'clues', 'passed', {}); assert.throws(() => store.publish(id), /Both checks/);
    const other = store.addRevision(handcrafted, 'test', id, 'New immutable draft');
    store.check(job.id, other.id, 'solution', 'passed', {}); assert.throws(() => store.publish(id), /Both checks/);
    store.check(job.id, id, 'solution', 'passed', {}); store.publish(id); assert.equal(store.get('published'), id);
    assert.throws(() => store.publish(other.id), /not passed/);
    assert.throws(() => store.db.prepare('UPDATE revisions SET source=? WHERE id=?').run('changed', id), /immutable/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('sessions are isolated and draft tickets are one-time and expire', () => {
  const dir = mkdtempSync(join(tmpdir(), 'escapeproof-test-')); const store = new Store(dir);
  try {
    const id = store.get('demo')!, one = store.createSession(id), two = store.createSession(id);
    one.state.hasKey = true; store.saveSession(one.id, one.state); assert.equal(store.session(two.id)!.state.hasKey, false);
    const ticket = store.ticket(id); assert.equal(store.consumeTicket(ticket), id); assert.equal(store.consumeTicket(ticket), null);
    const expired = store.ticket(id); store.db.prepare('UPDATE tickets SET expires_at=? WHERE id=?').run(Date.now() - 1, expired); assert.equal(store.consumeTicket(expired), null);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('verification queue limits concurrent drafts and rejects duplicate active jobs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'escapeproof-test-')); const store = new Store(dir);
  try {
    const id = store.get('demo')!; store.createJob(id); assert.throws(() => store.createJob(id), /already/);
    for (let i = 0; i < 2; i++) store.createJob(store.addRevision(handcrafted, 'test', null, 'Queue test').id);
    assert.throws(() => store.createJob(store.addRevision(handcrafted, 'test', null, 'Queue full').id), /full/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('server restart records unfinished jobs as interrupted without replaying them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'escapeproof-restart-test-'));
  let store = new Store(dir);
  try {
    const job = store.createJob(store.get('demo')!); store.updateJob(job.id, 'verifying'); store.close();
    store = new Store(dir);
    const restored = store.job(job.id);
    assert.equal(restored.status, 'infrastructure-error'); assert.equal(restored.repairs, 0);
    assert.ok(restored.events.some(event => /interrupted before server restart/.test(event.message)));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
