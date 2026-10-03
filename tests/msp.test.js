import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const api = await import('../src/msp.js').catch(() => ({}));
const host = fileURLToPath(new URL('./fixtures/host.js', import.meta.url));
async function connect(t) {
  assert.equal(typeof api.MspClient, 'function', 'MspClient is implemented');
  const client = new api.MspClient();
  t.after(() => client.close());
  // Process startup on Windows has a separate budget from protocol timeout checks.
  await client.connect({ executable: process.execPath, args: [host], workspace: process.cwd(), timeoutMs: 5000 });
  client.timeoutMs=300;
  return client;
}
test('uuid7MatchesWireContract', () => {
  assert.equal(typeof api.uuid7, 'function');
  const ids = Array.from({ length: 100 }, () => api.uuid7());
  ids.forEach(id => assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
  assert.equal(new Set(ids).size, 100);
});
test('fragmentedArabicFrames', async t => {
  const client = await connect(t);
  const notification = once(client, 'notification');
  await client.request('fragment', {});
  const [method, params] = await notification;
  assert.equal(method, 'item/delta');
  assert.equal(params.delta, 'أهلاً يا باشا');
});
test('requestErrorAndTimeout', async t => {
  const client = await connect(t);
  await assert.rejects(client.request('failure', {}), /Rejected by host/);
  await assert.rejects(client.request('timeout', {}), /timed out/i);
  assert.equal((await client.request('healthy', {})).method, 'healthy');
});
test('hostExitRejectsPending', async t => {
  const client = await connect(t);
  const pending = client.request('timeout', {});
  const pendingResult = assert.rejects(pending, /exited|closed|disconnect/i);
  await assert.rejects(client.request('crash', {}), /exited|closed|disconnect/i);
  await pendingResult;
  assert.equal(client.connected, false);
});
test('shutdownStopsHost', async t => {
  const client = await connect(t);
  const processId = client.child.pid;
  await client.close();
  assert.equal(client.connected, false);
  assert.throws(() => process.kill(processId, 0));
});
test('serverRequestsKeepTokens', async t => {
  const client = await connect(t);
  const incoming = once(client, 'serverRequest');
  await client.request('approval', {});
  const [method, params, id] = await incoming;
  assert.equal(method, 'approval/request');
  assert.deepEqual(params.currentRequirementId, { approvalId: 'a1', sourceIndex: 2 });
  assert.equal(id, 'approval-request');
});
test('sessionStartAndResumeKeepHistory', async t => {
  const client = await connect(t);
  const start = await client.request('session/start', { commandId: api.uuid7(), workspaceRoot: 'C:/test' });
  const resumed = await client.request('session/resume', { commandId: api.uuid7(), sessionId: start.session.sessionId });
  assert.equal(resumed.history.items[0].text, 'saved reply');
});
test('malformedFramesRejectPending', async t => {
  const client = await connect(t);
  await assert.rejects(client.request('badFrame', {}), /invalid|malformed|JSON/i);
});
