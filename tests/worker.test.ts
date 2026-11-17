import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyKane } from '../server/kane.ts';
import { objective, shouldRepair } from '../server/worker.ts';
import { handcrafted } from '../server/room.ts';
test('incomplete results, auth, upload and timeouts never cause puzzle repairs', () => {
  const passed = [{ type: 'run_end', status: 'passed' }];
  assert.equal(classifyKane(0, passed, ''), 'passed');
  assert.equal(classifyKane(1, [], 'Not authenticated'), 'infrastructure-error');
  assert.equal(classifyKane(1, passed, 'Upload failed'), 'infrastructure-error');
  assert.equal(classifyKane(3, [], ''), 'infrastructure-error');
  assert.equal(classifyKane(0, [], ''), 'infrastructure-error');
  const failure = [{ status: 'failed', remark: 'assert: missing notebook clue' }, { type: 'run_end', status: 'failed' }];
  assert.equal(classifyKane(1, failure, ''), 'product-failure');
  assert.equal(classifyKane(1, failure, 'network error'), 'infrastructure-error');
  assert.equal(classifyKane(1, [{ type: 'run_end', status: 'failed' }], ''), 'infrastructure-error');
  assert.equal(classifyKane(1, [{ status: 'failed', remark: 'Click drawer failed' }, { type: 'run_end', status: 'failed' }], ''), 'infrastructure-error');
  assert.equal(classifyKane(1, [...failure, { type: 'error', message: 'Not authenticated' }], ''), 'infrastructure-error');
});
test('repair budget stops at two and requires both product evidence and AI credentials', () => {
  assert.equal(shouldRepair('product-failure', 0, true), true);
  assert.equal(shouldRepair('product-failure', 1, true), true);
  assert.equal(shouldRepair('product-failure', 2, true), false);
  assert.equal(shouldRepair('infrastructure-error', 0, true), false);
  assert.equal(shouldRepair('product-failure', 0, false), false);
});
test('clue check is independent of the intended solution and does not receive answers', () => {
  assert.ok(!objective('clues', handcrafted).includes(handcrafted.drawer.code));
  assert.ok(objective('solution', handcrafted).includes(handcrafted.drawer.code));
});
