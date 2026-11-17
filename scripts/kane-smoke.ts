import 'dotenv/config';
import { resolve } from 'node:path';
import { runKane } from '../server/kane.ts';
const result = await runKane({ url: process.env.APP_ORIGIN || 'http://127.0.0.1:5173', objective: 'Verify the page shows the EscapeProof brand and a Begin expedition button.', directory: resolve(process.env.DATA_DIR || 'data', 'smoke-evidence'), name: 'escapeproof-smoke', onEvent: event => { if (event.remark) console.log(event.remark); } });
console.log(JSON.stringify({ outcome: result.outcome, exitCode: result.exitCode, summary: result.summary, artifacts: result.artifacts }, null, 2));
process.exitCode = result.outcome === 'passed' ? 0 : 1;
