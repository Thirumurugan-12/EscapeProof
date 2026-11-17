import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runKane } from '../server/kane.ts';
import type { JobSummary, WorkshopView } from '../shared/types.ts';

// A real local acceptance run. Requires configured Meta/TestMu credentials.
// This script never fabricates a room, result, repair, or verification status.
const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:3001';
if (!process.env.OPERATOR_TOKEN) throw new Error('OPERATOR_TOKEN is required.');
let cookie = '';
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(origin + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(100000) });
  const result = await response.json();
  if (!response.ok) throw new Error(String(result.error || `HTTP ${response.status}`));
  const setCookie = response.headers.getSetCookie();
  if (setCookie.length) cookie = setCookie.map(value => value.split(';')[0]).join('; ');
  return result as T;
}
await request('/operator/login', { token: process.env.OPERATOR_TOKEN });
console.log('Operator authenticated locally.');
const generated = process.env.DEMO_GENERATED_REVISION_ID ? { id: process.env.DEMO_GENERATED_REVISION_ID } : await request<{ id: string }>('/operator/generate', { theme: 'Keep the title The Missing Inventor. An abandoned inventor workshop with a notebook clue about four ordered quantities, a four-digit drawer lock, a brass key, and a locked exit. The clue should be easy for a human to derive and must not print the raw combination.' });
console.log('Generated revision:', generated.id);
const faulty = process.env.DEMO_FAULTY_REVISION_ID ? { id: process.env.DEMO_FAULTY_REVISION_ID } : await request<{ id: string }>(`/operator/revisions/${generated.id}/fault`, {});
console.log('Fault-injected draft:', faulty.id);
const queued = await request<{ id: string }>(`/operator/revisions/${faulty.id}/verify`, {});
console.log('Real verification job:', queued.id);
const deadline = Date.now() + 25 * 60 * 1000;
let lastEvent = 0; let final: JobSummary | undefined;
while (Date.now() < deadline) {
  const snapshot = await request<WorkshopView>('/operator/workshop');
  const job = snapshot.jobs.find(job => job.id === queued.id);
  if (!job) throw new Error('Verification job disappeared.');
  for (const event of job.events.filter(event => event.id > lastEvent)) {
    console.log(`[${event.kind}] ${event.message}`);
    lastEvent = Math.max(lastEvent, event.id);
  }
  if (['verified', 'failed', 'infrastructure-error'].includes(job.status)) { final = job; break; }
  await new Promise(resolve => setTimeout(resolve, 2000));
}
if (!final) throw new Error('Observation deadline reached. Check the existing job; do not restart it automatically.');
if (final.status !== 'verified') throw new Error(`Real verification ended as ${final.status}. Inspect job ${final.id}.`);
if (final.repairs < 1) throw new Error('The deliberate fault was not repaired. Do not claim the repair demonstration passed.');
await request(`/operator/revisions/${final.currentRevisionId}/publish`, {});
console.log('Published verified revision locally:', final.currentRevisionId);
console.log('Checking a fresh public player browser without supplying the answer.');
const directory = resolve(process.env.DATA_DIR || './data', 'public-player-evidence', final.id);
const publicRun = await runKane({ url: origin, directory, name: `escapeproof-public-${final.id.slice(0, 8)}`, objective: 'Use only visible player UI. Do not inspect JavaScript, source, storage, network, hidden APIs or the operator workshop. Do not use hints. Begin expedition. Inspect and read the notebook. Infer the four-digit combination from the visible clue. Close the notebook. Inspect the drawer, enter the inferred combination and unlock it. Collect the key. Close the drawer. Inspect the door, use the key and escape. Verify the heading You escaped is visible.', onEvent: event => { if (event.remark) console.log('[public player]', event.remark); } });
const report = { generatedRevision: generated.id, faultyRevision: faulty.id, jobId: final.id, repairedRevision: final.currentRevisionId, repairs: final.repairs, verified: final.status, publishedLocally: true, publicPlayer: { outcome: publicRun.outcome, summary: publicRun.summary, artifacts: publicRun.artifacts, testUrl: publicRun.testUrl } };
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'acceptance.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (publicRun.outcome !== 'passed') process.exitCode = 1;
