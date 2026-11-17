import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { handcrafted, initialState, validateRoom, type Room } from './room.ts';
import type { JobEvent, JobSummary, PlayerState, RevisionSummary, Status } from '../shared/types.ts';

export interface Revision { id: string; parentId: string | null; room: Room; source: string; createdAt: string; explanation: string; hash: string }
export class Store {
  db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(resolve(directory, 'escapeproof.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES revisions(id), room TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, explanation TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS immutable_revision BEFORE UPDATE ON revisions BEGIN SELECT RAISE(ABORT, 'Revisions are immutable'); END;
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES revisions(id), current_revision_id TEXT NOT NULL REFERENCES revisions(id), status TEXT NOT NULL, repairs INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id), at TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checks (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), revision_id TEXT NOT NULL REFERENCES revisions(id), kind TEXT NOT NULL, status TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES revisions(id), state TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES revisions(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ticket_bindings (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    `);
    if (!this.db.prepare('SELECT id FROM revisions LIMIT 1').get()) {
      const revision = this.addRevision(handcrafted, 'handcrafted', null, 'Original handcrafted fallback room. No live AI or Kane claim.');
      this.set('demo', revision.id);
    }
    const interrupted = this.db.prepare("SELECT id FROM jobs WHERE status IN ('queued','validating','verifying','repairing')").all() as { id: string }[];
    this.db.prepare("UPDATE jobs SET status='infrastructure-error', updated_at=? WHERE status IN ('queued','validating','verifying','repairing')").run(new Date().toISOString());
    for (const job of interrupted) this.event(job.id, 'infrastructure-error', 'Verification was interrupted before server restart. It was not automatically replayed.');
    this.cleanup();
  }
  cleanup() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    this.db.prepare('DELETE FROM tickets WHERE expires_at < ?').run(Date.now());
    this.db.prepare('DELETE FROM ticket_bindings WHERE expires_at < ?').run(Date.now());
  }
  set(key: string, value: string) { this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
  get(key: string): string | null { return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)?.value ?? null; }
  addRevision(input: unknown, source: string, parentId: string | null, explanation: string): Revision {
    const room = validateRoom(input), id = randomUUID(), createdAt = new Date().toISOString();
    const json = JSON.stringify(room), hash = createHash('sha256').update(json).digest('hex');
    this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?,?,?,?)').run(id, parentId, json, source, createdAt, explanation, hash);
    return { id, parentId, room, source, createdAt, explanation, hash };
  }
  revision(id: string): Revision {
    const row = this.db.prepare('SELECT * FROM revisions WHERE id=?').get(id) as Record<string, string> | undefined;
    if (!row) throw new Error('Room revision not found.');
    return { id: row.id, parentId: row.parent_id, room: JSON.parse(row.room), source: row.source, createdAt: row.created_at, explanation: row.explanation, hash: row.hash };
  }
  revisions(): RevisionSummary[] {
    return (this.db.prepare('SELECT id FROM revisions ORDER BY created_at DESC').all() as { id: string }[]).map(({ id }) => {
      const r = this.revision(id);
      return { id, parentId: r.parentId, title: r.room.title, source: r.source, createdAt: r.createdAt, status: this.status(id), published: this.get('published') === id, explanation: r.explanation };
    });
  }
  status(id: string): Status {
    const job = this.db.prepare('SELECT status, updated_at FROM jobs WHERE current_revision_id=? ORDER BY created_at DESC LIMIT 1').get(id) as { status: Status; updated_at: string } | undefined;
    if (job && ['queued', 'validating', 'verifying', 'repairing'].includes(job.status)) return job.status;
    const check = this.db.prepare('SELECT status, result, created_at FROM checks WHERE revision_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(id) as { status: string; result: string; created_at: string } | undefined;
    if (check?.status === 'failed' && (!job || check.created_at > job.updated_at)) {
      return JSON.parse(check.result).outcome === 'infrastructure-error' ? 'infrastructure-error' : 'failed';
    }
    return job?.status ?? 'generated';
  }
  createJob(revisionId: string): JobSummary {
    this.revision(revisionId);
    const active = this.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','validating','verifying','repairing')").get() as { n: number };
    if (active.n >= 3) throw new Error('Verification queue is full. Wait for a running job to finish.');
    if (this.db.prepare("SELECT id FROM jobs WHERE current_revision_id=? AND status IN ('queued','validating','verifying','repairing')").get(revisionId)) throw new Error('This revision already has a verification job.');
    const id = randomUUID(), now = new Date().toISOString();
    this.db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)').run(id, revisionId, revisionId, 'queued', 0, now, now);
    this.event(id, 'queued', 'Verification queued.');
    return this.job(id);
  }
  updateJob(id: string, status: Status, currentRevisionId?: string, repairs?: number) {
    const job = this.job(id);
    this.db.prepare('UPDATE jobs SET status=?, current_revision_id=?, repairs=?, updated_at=? WHERE id=?').run(status, currentRevisionId ?? job.currentRevisionId, repairs ?? job.repairs, new Date().toISOString(), id);
  }
  event(jobId: string, kind: string, message: string, data: Record<string, unknown> = {}): JobEvent {
    const at = new Date().toISOString();
    const result = this.db.prepare('INSERT INTO events(job_id,at,kind,message,data) VALUES(?,?,?,?,?)').run(jobId, at, kind, message, JSON.stringify(data));
    return { id: Number(result.lastInsertRowid), jobId, at, kind, message, data };
  }
  events(jobId: string): JobEvent[] {
    return (this.db.prepare('SELECT * FROM events WHERE job_id=? ORDER BY id').all(jobId) as Record<string, string | number>[]).map(e => ({ id: Number(e.id), jobId: String(e.job_id), at: String(e.at), kind: String(e.kind), message: String(e.message), data: JSON.parse(String(e.data)) }));
  }
  job(id: string): JobSummary {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as Record<string, string | number> | undefined;
    if (!row) throw new Error('Job not found.');
    return { id: String(row.id), revisionId: String(row.revision_id), currentRevisionId: String(row.current_revision_id), status: row.status as Status, repairs: Number(row.repairs), createdAt: String(row.created_at), updatedAt: String(row.updated_at), events: this.events(id) };
  }
  jobs(): JobSummary[] { return (this.db.prepare('SELECT id FROM jobs ORDER BY created_at DESC LIMIT 20').all() as { id: string }[]).map(j => this.job(j.id)); }
  check(jobId: string, revisionId: string, kind: string, status: string, result: unknown) {
    this.db.prepare('INSERT INTO checks VALUES(?,?,?,?,?,?,?)').run(randomUUID(), jobId, revisionId, kind, status, JSON.stringify(result), new Date().toISOString());
  }
  publish(id: string) {
    this.revision(id);
    const job = this.db.prepare("SELECT id FROM jobs WHERE current_revision_id=? AND status='verified' ORDER BY updated_at DESC LIMIT 1").get(id) as { id: string } | undefined;
    if (!job) throw new Error('This exact revision has not passed verification.');
    const checks = this.db.prepare("SELECT DISTINCT kind FROM checks WHERE job_id=? AND revision_id=? AND status='passed'").all(job.id, id) as { kind: string }[];
    if (!['clues', 'solution'].every(kind => checks.some(c => c.kind === kind))) throw new Error('Both checks must pass on this revision in the same job.');
    this.set('published', id);
  }
  createSession(revisionId: string, started = false) {
    this.cleanup();
    this.revision(revisionId);
    const id = randomUUID(), state = initialState();
    state.started = started;
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(id, revisionId, JSON.stringify(state), Date.now() + 86400000);
    return { id, revisionId, state };
  }
  session(id: string): { id: string; revisionId: string; state: PlayerState } | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id=? AND expires_at>?').get(id, Date.now()) as Record<string, string> | undefined;
    return row ? { id, revisionId: row.revision_id, state: JSON.parse(row.state) } : null;
  }
  saveSession(id: string, state: PlayerState) { this.db.prepare('UPDATE sessions SET state=? WHERE id=?').run(JSON.stringify(state), id); }
  ticket(revisionId: string): string {
    this.cleanup();
    this.revision(revisionId);
    const id = randomUUID() + randomUUID();
    this.db.prepare('INSERT INTO tickets VALUES (?,?,?)').run(id, revisionId, Date.now() + 600000);
    return id;
  }
  consumeTicket(id: string): string | null {
    const row = this.db.prepare('DELETE FROM tickets WHERE id=? AND expires_at>? RETURNING revision_id').get(id, Date.now()) as { revision_id: string } | undefined;
    return row?.revision_id ?? null;
  }
  redeemTicket(id: string, currentSessionId?: string) {
    const bound = this.db.prepare('SELECT session_id FROM ticket_bindings WHERE id=? AND expires_at>?').get(id, Date.now()) as { session_id: string } | undefined;
    if (bound) return bound.session_id === currentSessionId ? this.session(bound.session_id) : null;
    const revisionId = this.consumeTicket(id);
    if (!revisionId) return null;
    const session = this.createSession(revisionId);
    this.db.prepare('INSERT INTO ticket_bindings VALUES (?,?,?)').run(id, session.id, Date.now() + 600000);
    return session;
  }
  close() { this.db.close(); }
}
