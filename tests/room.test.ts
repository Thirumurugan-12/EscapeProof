import test from 'node:test';
import assert from 'node:assert/strict';
import { act, assertSafeRepair, handcrafted, initialState, publicView, validateRoom } from '../server/room.ts';

test('the real game path requires clue, correct code, collected key, and escape action', () => {
  let state = initialState();
  state = act(handcrafted, state, { type: 'collect' }).state; assert.equal(state.hasKey, false);
  state = act(handcrafted, state, { type: 'escape' }).state; assert.equal(state.escaped, false);
  state = act(handcrafted, state, { type: 'unlock', code: handcrafted.drawer.code }).state; assert.equal(state.drawerOpen, false);
  state = act(handcrafted, state, { type: 'inspect', target: 'notebook' }).state;
  state = act(handcrafted, state, { type: 'unlock', code: '0000' }).state; assert.equal(state.drawerOpen, false);
  state = act(handcrafted, state, { type: 'unlock', code: handcrafted.drawer.code }).state; assert.equal(state.drawerOpen, true);
  state = act(handcrafted, state, { type: 'escape' }).state; assert.equal(state.escaped, false);
  state = act(handcrafted, state, { type: 'collect' }).state; assert.equal(state.hasKey, true);
  state = act(handcrafted, state, { type: 'escape' }).state; assert.equal(state.escaped, true); assert.ok(state.escapedAt);
});
test('hints are progressive and bounded; player actions do not mutate original state', () => {
  const original = initialState(); let state = original;
  for (let i = 0; i < 5; i++) state = act(handcrafted, state, { type: 'hint' }).state;
  assert.equal(original.hintsUsed, 0); assert.equal(state.hintsUsed, 3);
});
test('public room does not expose private answers or unrevealed clues', () => {
  const view = publicView(handcrafted, initialState(), { id: 'test', source: 'handcrafted', published: false, verified: false });
  const json = JSON.stringify(view);
  assert.ok(!json.includes(handcrafted.drawer.code)); assert.ok(!json.includes('intendedSolution')); assert.ok(!json.includes('dependencies')); assert.equal(view.notebook, null); assert.equal(view.hints.length, 0);
});
test('validation rejects duplicate/missing nodes, unknown references, cycles, and unreachable keys', () => {
  assert.doesNotThrow(() => validateRoom(handcrafted));
  const missing = structuredClone(handcrafted); missing.dependencies[3].id = 'key'; assert.throws(() => validateRoom(missing), /exactly once/);
  const cycle = structuredClone(handcrafted); cycle.dependencies[0].requires = ['door']; assert.throws(() => validateRoom(cycle), /Circular/);
  const reference = structuredClone(handcrafted) as unknown as { key: { container: string } }; reference.key.container = 'absent'; assert.throws(() => validateRoom(reference));
  const unreachable = structuredClone(handcrafted); unreachable.key.container = 'door'; assert.throws(() => validateRoom(unreachable), /reachable/);
  const bypass = structuredClone(handcrafted); bypass.dependencies[3].requires = []; assert.throws(() => validateRoom(bypass), /prerequisites/);
});
test('faulty missing clue remains structurally valid so browser verification can detect it', () => {
  const faulty = structuredClone(handcrafted); faulty.notebook.clue = ''; assert.doesNotThrow(() => validateRoom(faulty));
  assert.doesNotThrow(() => assertSafeRepair(faulty, handcrafted));
  const bypass = structuredClone(handcrafted); bypass.drawer.code = '1111'; assert.throws(() => assertSafeRepair(faulty, bypass), /protected/);
  const raw = structuredClone(handcrafted); raw.notebook.clue = `The code is ${raw.drawer.code}`; assert.throws(() => assertSafeRepair(faulty, raw), /raw combination/);
});
