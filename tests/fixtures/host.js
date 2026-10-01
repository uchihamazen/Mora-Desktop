import { createInterface } from 'node:readline';
let session = { sessionId: '018f1234-1234-7123-8123-123456789abc', workspaceRoot: 'C:/test', name: 'Saved chat' };
const write = value => process.stdout.write(JSON.stringify(value) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const { id, method, params = {} } = message;
  const reply = result => write({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') return reply({ serverInfo: { name: 'fixture', version: '1' }, grantedCapabilities: [] });
  if (method === 'timeout') return;
  if (method === 'crash') return process.exit(3);
  if (method === 'badFrame') return process.stdout.write('not-json\n');
  if (method === 'failure') return write({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Rejected by host' } });
  if (method === 'fragment') {
    reply({ accepted: true });
    const bytes = Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'item/delta', params: { delta: 'أهلاً يا باشا', itemId: 'i1', sessionId: session.sessionId, viewCursor: 'c1' } }) + '\n');
    const first = bytes.indexOf(Buffer.from('أ')) + 1;
    process.stdout.write(bytes.subarray(0, first));
    return setTimeout(() => process.stdout.write(bytes.subarray(first)), 5);
  }
  if (method === 'approval') {
    write({ jsonrpc: '2.0', id: 'approval-request', method: 'approval/request', params: { sessionId: session.sessionId, approvalId: 'a1', currentRequirementId: { approvalId: 'a1', sourceIndex: 2 }, availableChoices: [{ id: 'allow', label: 'Allow' }] } });
    return reply({ sent: true });
  }
  if (method === 'session/start') { session = { ...session, ...params }; return reply({ session, viewCursor: 'c0' }); }
  if (method === 'session/resume') return reply({ session, viewCursor: 'c2', history: { mode: 'inline', items: [{ itemId: 'saved', kind: 'agentMessage', status: 'completed', revision: 1, text: 'saved reply' }], snapshot: null }, pendingRequests: [] });
  reply({ method, params });
});
