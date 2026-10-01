import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../src/projects.js').catch(() => ({}));

test('sidebar groups legacy chats by full Windows path and keeps general chats separate', () => {
  assert.equal(typeof api.groupConversations, 'function');
  const sessions = [
    {sessionId:'general',projectPath:null,workspace:'C:/profile/general-chat'},
    {sessionId:'a',workspace:'C:\\Muse'},
    {sessionId:'b',projectPath:'c:/muse/',workspace:'c:/muse/'},
    {sessionId:'other',workspace:'D:/Muse'},
  ];
  const groups = api.groupConversations(sessions, ['C:\\Muse','E:/Empty']);
  assert.deepEqual(groups.map(g => g.sessions.map(s => s.sessionId)), [['general'],['a','b'],[],['other']]);
  assert.equal(groups[1].projectPath,'C:\\Muse');
  assert.equal(groups[3].projectPath,'D:/Muse');
});
