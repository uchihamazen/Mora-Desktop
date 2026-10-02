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

test('library search preserves project grouping and stable pin order without changing saved sessions',()=>{
  const sessions=[{sessionId:'a',workspace:'C:/Muse',title:'First'},{sessionId:'b',workspace:'C:/Muse',title:'Build',pinned:true},{sessionId:'c',workspace:'C:/Muse',title:'Old',archived:true},{sessionId:'g',workspace:'private',projectPath:null,title:'Question'}];
  const snapshot=JSON.stringify(sessions);
  assert.deepEqual(api.conversationGroups(sessions,['C:/Muse','D:/Empty'],{query:'mUSE'}).flatMap(g=>g.sessions.map(s=>s.sessionId)),['b','a']);
  assert.deepEqual(api.conversationGroups(sessions,[],{query:'old',archived:true}).flatMap(g=>g.sessions.map(s=>s.sessionId)),['c']);
  assert.equal(api.conversationGroups(sessions,['D:/Empty'],{query:'Empty'}).length,1);
  assert.equal(api.conversationGroups(sessions,[],{query:'not found'}).length,0);
  assert.equal(JSON.stringify(sessions),snapshot);
});

test('chat organization preserves identity and blocks archiving the working chat',()=>{
  const session={sessionId:'a',workspace:'C:/Muse',title:'New conversation',hasMessages:true};
  const state={sessions:[session],sessionId:'a',busy:true,items:[{text:'Keep'}],pendingQueue:[{text:'Keep too'}]};
  assert.throws(()=>api.changeConversation(state,'a','archive'),/running/i);
  api.changeConversation(state,'a','rename','  My chat  ');
  api.changeConversation(state,'a','pin');
  assert.equal(session.title,'My chat');assert.equal(session.customTitle,true);assert.equal(session.pinned,true);
  state.busy=false;api.changeConversation(state,'a','archive');assert.equal(session.archived,true);
  api.changeConversation(state,'a','restore');assert.equal(session.archived,false);
  assert.equal(state.sessions.length,1);assert.equal(state.sessionId,'a');assert.equal(state.pendingQueue[0].text,'Keep too');
  assert.throws(()=>api.changeConversation(state,'a','rename',' '),/title/i);
  assert.throws(()=>api.changeConversation(state,'missing','pin'),/conversation/i);
});
