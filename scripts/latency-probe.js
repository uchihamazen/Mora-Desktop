import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverMuse, uuid7 } from '../src/msp.js';
import { ExecRunner } from '../src/runtime.js';

const workspace = await mkdtemp(path.join(tmpdir(), 'muse-desktop-latency-'));
const promptFile = path.join(workspace, 'prompt.txt');
await writeFile(promptFile, 'Reply with one short sentence without using tools.');
const runner = new ExecRunner();
const started = performance.now(), events = [];
let firstDelta, lastDelta, terminal;
runner.on('record', record => {
  const ms = Math.round(performance.now() - started);
  const p = record.payload || {};
  events.push({ ms, type: record.payload_type, kind: p.kind, event: p.event?.kind, task: p.event?.task_kind, taskId: p.task_id, operation: p.event?.operation, status: p.event?.status });
  if (p.kind === 'run_output_delta') { firstDelta ??= ms; lastDelta = ms; }
  else {
    console.log(ms, record.payload_type || p.kind, p.event?.kind || '', p.event?.task_kind || '', p.task_id || '', p.event?.operation || '', p.event?.status || '');
    if (p.kind === 'run_terminal') { terminal = ms; console.log('TERMINAL', p.terminal); }
  }
});
const limit = setTimeout(() => { console.log('PROBE TIMEOUT'); runner.stop(); }, 120000);
try {
  const result = await runner.run({ executable: await discoverMuse(), workspace, sessionId: uuid7(), promptFile,
    modelId: 'muse-spark-1.3-contributor', reasoningEffort: process.argv[2] || 'max', executionMode: 'readonly' });
  const summary = { firstDelta, lastDelta, terminal, closed: Math.round(performance.now() - started), code: result.code, stopped: result.stopped };
  console.log('TIMING', JSON.stringify(summary));
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/latency-probe.json', JSON.stringify({summary, events}, null, 2));
} finally { clearTimeout(limit); }
