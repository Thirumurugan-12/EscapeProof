// Test-only HTTP responses prove routing and validation, not live Muse inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiReady, author, museModel } from '../server/ai.ts';
import { handcrafted } from '../server/room.ts';

test('Muse uses Meta auth/endpoint, structured room output, and protected repair validation', async () => {
  const oldKey = process.env.MODEL_API_KEY, oldModel = process.env.MUSE_MODEL;
  try {
    delete process.env.MODEL_API_KEY; delete process.env.MUSE_MODEL;
    assert.equal(aiReady(), false); assert.equal(museModel(), 'muse-spark-1.3');
    await assert.rejects(author('A workshop'), /MODEL_API_KEY/);
    process.env.MODEL_API_KEY = 'test-only-meta-key'; process.env.MUSE_MODEL = 'muse-spark-1.3';
    assert.equal(aiReady(), true);
    let calls = 0; let responseRoom = structuredClone(handcrafted);
    const mockFetch: typeof globalThis.fetch = async (input, init) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://api.meta.ai'); assert.equal(url.pathname, '/v1/responses');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-only-meta-key');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'muse-spark-1.3'); assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.strict, true);
      if (calls === 2) assert.ok(body.input[1].content.includes('TEST ONLY: missing clue evidence'));
      return new Response(JSON.stringify({ id: 'test-response', object: 'response', status: 'completed', model: body.model, output: [{ id: 'test-message', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ explanation: 'Test-only author response.', room: responseRoom }), annotations: [] }] }] }), { headers: { 'Content-Type': 'application/json' } });
    };
    const generated = await author('A clockwork workshop', undefined, { fetch: mockFetch }); assert.deepEqual(generated.room, handcrafted);
    const faulty = structuredClone(handcrafted); faulty.notebook.clue = '';
    const repaired = await author('', { room: faulty, evidence: 'TEST ONLY: missing clue evidence' }, { fetch: mockFetch }); assert.equal(repaired.room.notebook.clue, handcrafted.notebook.clue);
    responseRoom.drawer.code = '1111';
    await assert.rejects(author('', { room: faulty, evidence: 'Test evidence' }, { fetch: mockFetch }), /protected/);
    assert.equal(calls, 3);
  } finally {
    if (oldKey === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.MUSE_MODEL; else process.env.MUSE_MODEL = oldModel;
  }
});
