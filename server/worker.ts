import { resolve } from 'node:path';
import { Store } from './store.ts';
import { author, aiReady } from './ai.ts';
import { runKane } from './kane.ts';
import { validateRoom, type Room } from './room.ts';

export const MAX_REPAIRS = 2;
export function shouldRepair(outcome: string, repairs: number, ready: boolean) { return outcome === 'product-failure' && repairs < MAX_REPAIRS && ready; }
export function objective(kind: 'clues' | 'solution', room: Room): string {
  const boundary = 'Use only visible UI controls. Do not inspect page source, JavaScript state, network responses, hidden APIs or storage. Do not use hints. ';
  if (kind === 'clues') return boundary + 'Click Begin expedition if shown. Click Inspect notebook. Verify a visible, nonempty clue is present in the notebook final entry, beyond its introductory text. Verify this clue supplies four ordered quantities from which a player can derive a four-digit combination. A missing or blank clue must fail this assertion. Do not guess the combination or try to escape. Do not consider the introduction alone a clue.';
  return boundary + `Click Begin expedition if shown. Click Inspect notebook and read it. Close the notebook. Click Inspect drawer. Enter ${room.drawer.code} in the Combination input and click Unlock drawer. Verify the drawer opens. Click Collect key. Close the drawer if needed. Click Inspect door, then Use key and escape. Verify the heading You escaped is visible.`;
}
export class VerificationWorker {
  private running = false;
  private queue: string[] = [];
  private stopping = false;
  private controller = new AbortController();
  private drained: Promise<void> = Promise.resolve();
  constructor(private store: Store, private directory: string, private origin: string, private notify: (jobId: string) => void, private integrations = { runKane, author, aiReady }) {}
  enqueue(id: string) {
    if (this.stopping) throw new Error('Verification worker is shutting down.');
    this.queue.push(id);
    if (!this.running) this.drained = this.drain();
  }
  async close() {
    this.stopping = true;
    this.controller.abort();
    for (const id of this.queue.splice(0)) {
      this.store.updateJob(id, 'infrastructure-error');
      this.emit(id, 'infrastructure-error', 'Queued verification interrupted by server shutdown.');
    }
    await this.drained;
  }
  private emit(id: string, kind: string, message: string, data: Record<string, unknown> = {}) { this.store.event(id, kind, message, data); this.notify(id); }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        try { await this.process(id); } catch (error) { this.store.updateJob(id, 'infrastructure-error'); this.emit(id, 'infrastructure-error', error instanceof Error ? error.message : 'Worker error.'); }
      }
    } finally { this.running = false; }
  }
  private async process(id: string) {
    while (true) {
      const job = this.store.job(id), revision = this.store.revision(job.currentRevisionId);
      this.store.updateJob(id, 'validating'); this.emit(id, 'validating', 'Checking room structure and puzzle dependencies.');
      try { validateRoom(revision.room); } catch (error) { this.store.updateJob(id, 'failed'); this.emit(id, 'failed', String(error)); return; }
      let failed: { kind: string; result: Awaited<ReturnType<typeof runKane>> } | null = null;
      this.store.updateJob(id, 'verifying');
      for (const kind of ['clues', 'solution'] as const) {
        this.emit(id, 'verifying', kind === 'clues' ? 'Kane is checking discoverable clues without the secret answer.' : 'Kane is executing the intended escape path in a fresh session.', { check: kind, revision: revision.id });
        const ticket = this.store.ticket(revision.id);
        const directory = resolve(this.directory, 'evidence', id, `attempt-${job.repairs}-${kind}`);
        const result = await this.integrations.runKane({ url: `${this.origin}/?verify=${ticket}`, objective: objective(kind, revision.room), directory, name: `escapeproof-${id.slice(0, 8)}-${job.repairs}-${kind}`, signal: this.controller.signal, onEvent: event => {
          if (typeof event.remark === 'string') this.emit(id, 'step', event.remark, { check: kind, status: event.status });
        } });
        const publicResult = { outcome: result.outcome, exitCode: result.exitCode, summary: result.summary, testUrl: result.testUrl, artifacts: result.artifacts.map(name => `/api/operator/evidence/${id}/attempt-${job.repairs}-${kind}/${name}`) };
        this.store.check(id, revision.id, kind, result.outcome === 'passed' ? 'passed' : 'failed', publicResult);
        this.emit(id, result.outcome, result.summary, { check: kind, ...publicResult });
        if (result.outcome !== 'passed') { failed = { kind, result }; break; }
      }
      if (!failed) { this.store.updateJob(id, 'verified'); this.emit(id, 'verified', 'Both checks passed on this exact revision. Ready for operator publication.', { revision: revision.id }); return; }
      if (failed.result.outcome === 'infrastructure-error') { this.store.updateJob(id, 'infrastructure-error'); this.emit(id, 'infrastructure-error', 'Verification could not complete. No puzzle changes were made.'); return; }
      if (!shouldRepair(failed.result.outcome, job.repairs, this.integrations.aiReady())) {
        this.store.updateJob(id, 'failed'); this.emit(id, 'failed', !this.integrations.aiReady() ? 'Product failure recorded. Configure AI credentials to enable automatic repair.' : 'Two repair attempts exhausted. Room remains unpublished.'); return;
      }
      this.store.updateJob(id, 'repairing'); this.emit(id, 'repairing', `Sending genuine ${failed.kind} failure evidence to the repair agent.`, { attempt: job.repairs + 1 });
      const repaired = await this.integrations.author('', { room: revision.room, evidence: { check: failed.kind, summary: failed.result.summary, events: failed.result.events.slice(-80), requirements: 'Restore discoverable coherent clues while preserving all locks and the intended solution.' } }, { signal: this.controller.signal });
      const changes = Object.keys(repaired.room).filter(key => JSON.stringify(revision.room[key as keyof Room]) !== JSON.stringify(repaired.room[key as keyof Room]));
      const next = this.store.addRevision(repaired.room, 'ai-repair', revision.id, repaired.explanation);
      this.store.updateJob(id, 'verifying', next.id, job.repairs + 1);
      this.emit(id, 'repair', repaired.explanation, { from: revision.id, to: next.id, changedFields: changes, beforeClue: revision.room.notebook.clue, afterClue: next.room.notebook.clue });
    }
  }
}
