// A test-only local process exercises cancellation; it does not emulate browser success.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runKane } from '../server/kane.ts';

test('adapter cancels and reaps a real child process before returning infrastructure failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'escapeproof-process-test-'));
  const previous = process.env.KANE_BIN;
  try {
    const fixture = join(dir, 'runner');
    writeFileSync(fixture, '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"test-process",pid:process.pid}));\nsetInterval(()=>{},1000);\n', { mode: 0o700 });
    process.env.KANE_BIN = fixture;
    const controller = new AbortController(); let pid = 0;
    const result = await runKane({ url: 'http://test.invalid', objective: 'TEST ONLY: cancellation', directory: join(dir, 'output'), name: 'test-only-cancellation', signal: controller.signal, onEvent: event => { pid = Number(event.pid); controller.abort(); } });
    assert.ok(pid > 0); assert.equal(result.exitCode, 3); assert.equal(result.outcome, 'infrastructure-error');
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally {
    if (previous === undefined) delete process.env.KANE_BIN; else process.env.KANE_BIN = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
