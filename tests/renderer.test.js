import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../src/state.js').catch(() => ({}));
const state = () => { assert.equal(typeof api.createState, 'function'); return api.createState(); };
test('staleItemDoesNotCorruptCompletion', () => {
  const s = state();
  api.applyEvent(s, 'item/started', { item: { itemId: 'a', kind: 'agentMessage', revision: 1, status: 'inProgress', text: '' } });
  api.applyEvent(s, 'item/delta', { itemId: 'a', delta: 'Hello', viewCursor: 'c1' });
  api.applyEvent(s, 'item/completed', { item: { itemId: 'a', kind: 'agentMessage', revision: 2, status: 'completed', text: 'Hello world' } });
  api.applyEvent(s, 'item/delta', { itemId: 'a', delta: 'duplicate', viewCursor: 'c2' });
  api.applyEvent(s, 'item/updated', { item: { itemId: 'a', kind: 'agentMessage', revision: 1, status: 'inProgress', text: 'old' } });
  assert.equal(s.items.length, 1); assert.equal(s.items[0].text, 'Hello world');
});
test('gapRestoresHistory', () => { const s = state(); api.applyEvent(s, 'view/gap', { after: 'opaque-a', next: 'opaque-b' }); assert.equal(s.needsRecovery, true); });
test('pendingRequestsSurviveResume', () => {
  const s = state(); const p = { approvalId: 'a1', currentRequirementId: { approvalId: 'a1', sourceIndex: 2 }, availableChoices: [{ choiceId: 'allow', label: 'Allow' }] };
  api.applyEvent(s, 'approval/request', p); api.applyEvent(s, 'approval/requested', p);
  assert.equal(s.pendingApprovals.length, 1); assert.equal(s.pendingApprovals[0].currentRequirementId.sourceIndex, 2);
  api.applyEvent(s, 'approval/resolved', { approvalId: 'a1' }); assert.equal(s.pendingApprovals.length, 0);
});
test('stopWaitsForCompletion', () => {
  const s = state(); api.applyEvent(s, 'turn/started', { turnId: 'r' }); assert.equal(s.busy, true);
  api.applyEvent(s, 'stop/requested', {}); assert.equal(s.busy, true);
  api.applyEvent(s, 'turn/completed', { turnId: 'r' }); assert.equal(s.busy, false);
});
test('disconnectClearsBusyWithoutReplaying', () => { const s = state(); s.busy = true; api.applyEvent(s, 'host/disconnected', { message: 'Host exited' }); assert.equal(s.busy, false); assert.equal(s.error, 'Host exited'); });
test('busyBlocksSessionSwitch', () => { assert.equal(typeof api.assertIdle, 'function'); assert.throws(() => api.assertIdle({ busy: true }), /running|stop/i); api.assertIdle({ busy: false }); });
