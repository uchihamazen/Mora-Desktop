import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MspClient, discoverMuse, uuid7 } from '../src/msp.js';
import { ExecRunner, readHistory } from '../src/runtime.js';

const executable = await discoverMuse();
const workspace = await mkdtemp(path.join(tmpdir(), 'muse-desktop-smoke-'));
const sessionId = uuid7();
const catalog = new MspClient();
const metadata = await catalog.connect({ executable, workspace });
assert.equal(metadata.serverInfo.name, 'muse');
const models = await catalog.request('model/list');
assert.ok(models.models.some(model => model.modelId === 'muse-spark-1.3-contributor'));
await catalog.close();
console.log('PASS real handshake and model catalog');

const runner = new ExecRunner();
const records = [];
runner.on('record', record => records.push(record));
async function submit(text, images = [], mode = 'readonly') {
  const promptFile = path.join(workspace, 'prompt.txt');
  await writeFile(promptFile, text);
  const deadline = setTimeout(() => { console.log('Stopping timed-out smoke request'); runner.stop(); }, 90000);
  try {
    const result = await runner.run({ executable, workspace, sessionId, promptFile, modelId: 'muse-spark-1.3-contributor', reasoningEffort: 'minimal', executionMode: mode, images });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.terminal?.terminal, 'completed', JSON.stringify(result));
    return result.terminal.text;
  } finally { clearTimeout(deadline); }
}

const answer = await submit('Remember this exact token: DESKTOP_MEMORY_4729. Reply with only this token.');
assert.match(answer, /DESKTOP_MEMORY_4729/);
console.log('PASS real text reply');
const memory = await submit('What exact token did I ask you to remember? Reply only with the token.');
assert.match(memory, /DESKTOP_MEMORY_4729/);
assert.ok((await readHistory(sessionId, metadata.museHome)).length >= 4);
console.log('PASS real multi-turn memory and engine-owned history');

if (process.argv.includes('--full')) {
  const imagePath = path.join(workspace, 'red.png');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { PNG } = require('./runtime-packages.cjs').runtimeRequire('pngjs');
  const png = new PNG({ width: 512, height: 512 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 255; png.data[i + 1] = 0; png.data[i + 2] = 0; png.data[i + 3] = 255; }
  await writeFile(imagePath, PNG.sync.write(png));
  const vision = await submit('What is the dominant color in the attached image? Answer with one English word.', [imagePath]);
  if (/red/i.test(vision)) console.log('PASS real image understanding');
  else { console.log('FAIL real image color understanding:', vision); process.exitCode = 1; }
  const work = await submit('Inside this temporary workspace only, create muse-proof.txt containing exactly FILE_OK. Then use a shell command to read that file and print FILE_OK. Do both operations; do not only describe them. Do not change any other project. Reply briefly with the result.', [], 'full');
  assert.equal((await readFile(path.join(workspace, 'muse-proof.txt'), 'utf8')).trim(), 'FILE_OK');
  const hasTool = records.some(record => record.payload?.kind === 'task_lifecycle' && ['completed','side_effect_intent'].includes(record.payload.event?.kind));
  assert.ok(hasTool); console.log('PASS real file creation and tool execution:', work.slice(0,200));
}
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/smoke-records.json', JSON.stringify(records, null, 2));
console.log('Event types:', [...new Set(records.map(record => record.payload_type))].filter(Boolean));
console.log('Workspace:', workspace, 'Session:', sessionId);
