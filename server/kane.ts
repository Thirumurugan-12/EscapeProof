import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, readdir, copyFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

export interface KaneResult {
  outcome: 'passed' | 'product-failure' | 'infrastructure-error'; exitCode: number | null;
  summary: string; events: Record<string, unknown>[]; artifacts: string[]; testUrl: string | null;
}
export function kaneBinary() {
  const configured = process.env.KANE_BIN;
  if (configured && configured !== 'kane-cli') return configured;
  if (existsSync('.tools/bin/kane-cli')) return resolve('.tools/bin/kane-cli');
  return existsSync('.tools/kane/node_modules/.bin/kane-cli') ? resolve('.tools/kane/node_modules/.bin/kane-cli') : 'kane-cli';
}
export function classifyKane(exitCode: number | null, events: Record<string, unknown>[], stderr: string): KaneResult['outcome'] {
  const end = events.findLast(e => e.type === 'run_end');
  if (exitCode === 0 && end?.status === 'passed') return 'passed';
  if (exitCode === 2 || exitCode === 3 || !end || /not authenticated|unauthori[sz]ed|upload fail|network error|chrome.*(fail|not found)|ENOTFOUND|ECONNREFUSED|timed? ?out/i.test(stderr + JSON.stringify(events))) return 'infrastructure-error';
  // A failed objective alone is insufficient evidence of a product bug.
  // Only repair a confirmed bug or an explicit failed UI assertion.
  if (exitCode === 1 && end.status === 'failed' && (end.result_code === 740 || events.some(e => e.status === 'failed' && /\b(assert(?:ion)?|checkpoint)\b/i.test(String(e.remark))))) return 'product-failure';
  return 'infrastructure-error';
}
export async function runKane(options: { url: string; objective: string; directory: string; name: string; signal?: AbortSignal; onEvent?: (event: Record<string, unknown>) => void }): Promise<KaneResult> {
  await mkdir(options.directory, { recursive: true });
  const profile = await mkdtemp(join(tmpdir(), 'escapeproof-chrome-'));
  const timeout = Math.max(15, Math.min(600, Number(process.env.KANE_TIMEOUT_SECONDS) || 180));
  const args = ['run', options.objective, '--url', options.url, '--agent', '--headless', '--timeout', String(timeout), '--max-steps', String(Math.max(5, Math.min(80, Number(process.env.KANE_MAX_STEPS) || 35))), '--chrome-profile', profile, '--name', options.name, '--assertion-failure-mode', 'stop', '--final-validation', 'on'];
  const env = { ...process.env };
  if (!env.KANE_CLI_CHROME_PATH && existsSync('.tools/chrome-linux64/chrome')) env.KANE_CLI_CHROME_PATH = resolve('.tools/chrome-linux64/chrome');
  const events: Record<string, unknown>[] = [], artifacts: string[] = [];
  let stderr = '', spawnError = '';
  const exitCode = await new Promise<number | null>(done => {
    const child = spawn(kaneBinary(), args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let settled = false;
    const finish = (code: number | null) => { if (!settled) { settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); done(code); } };
    let stopped = false;
    const stop = (reason: string) => {
      if (settled || stopped) return;
      stopped = true;
      try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already exited */ }
      stderr += `\n${reason}`;
    };
    const cancel = () => stop('Worker canceled during shutdown.');
    const timer = setTimeout(() => stop('Worker timeout.'), (timeout + 15) * 1000);
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    child.on('error', error => { spawnError = error.message; finish(2); });
    createInterface({ input: child.stdout }).on('line', line => {
      if (line.length > 100000) return;
      try {
        const event = JSON.parse(line);
        if (event && typeof event === 'object' && !Array.isArray(event) && events.length < 1500) { events.push(event); options.onEvent?.(event); }
      } catch { /* non-JSON output is not a result */ }
    });
    child.stderr.on('data', chunk => { if (stderr.length < 50000) stderr += String(chunk); });
    child.on('close', code => finish(stopped ? 3 : code));
  });
  const end = events.findLast(e => e.type === 'run_end');
  if (typeof end?.session_dir === 'string') {
    // Only copy sealed evidence packs, never arbitrary paths supplied by event data.
    const evidence = join(end.session_dir, 'evidence');
    try {
      for (const name of await readdir(evidence)) {
        if (/^[\w.-]+\.evidence$/.test(name)) { await copyFile(join(evidence, name), join(options.directory, name)); artifacts.push(name); }
      }
    } catch { /* absence of an artifact is surfaced as absence */ }
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(options.directory, 'events.ndjson'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  await writeFile(join(options.directory, 'stderr.txt'), stderr + spawnError);
  artifacts.push('events.ndjson', 'stderr.txt');
  await rm(profile, { recursive: true, force: true });
  const outcome = classifyKane(exitCode, events, stderr);
  return { outcome, exitCode, summary: String(end?.summary || spawnError || stderr.trim() || 'Kane did not return a complete result.').slice(0, 3000), events, artifacts, testUrl: typeof end?.test_url === 'string' && /^https:\/\/(test-manager\.)?(lambdatest|testmuai)\.com\//.test(end.test_url) ? end.test_url : null };
}
