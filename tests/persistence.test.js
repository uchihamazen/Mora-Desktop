import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConversations, saveConversations, profilePath } from '../src/persistence.js';

const chat = {sessionId:'saved-chat',workspace:'C:/Project',title:'Keep me'};
async function fixture(fn) {
 const directory=await mkdtemp(path.join(tmpdir(),'muse-persistence-test-'));
 try {await fn(directory);} finally {await rm(directory,{recursive:true,force:true});}
}
test('normal launches share a profile; tests explicitly use a separate directory',()=>{
 assert.equal(profilePath('C:/Roaming',{}),path.join('C:/Roaming','Muse Desktop'));
 assert.equal(profilePath('C:/Roaming',{MUSE_DESKTOP_TEST_USER_DATA:path.resolve('test-profile')}),path.resolve('test-profile'));
 assert.throws(()=>profilePath('C:/Roaming',{MUSE_DESKTOP_TEST_USER_DATA:'relative'}),/absolute/i);
});
test('migrates legacy chats without losing order or the selected conversation',()=>fixture(async directory=>{
 const legacy={sessions:[chat],lastSessionId:chat.sessionId};
 const loaded=await loadConversations(directory,legacy);
 assert.deepEqual(loaded,legacy);
 await saveConversations(directory,loaded);
 assert.deepEqual(await loadConversations(directory,{}),legacy);
}));
test('replacing settings with an old test snapshot cannot hide saved chats',()=>fixture(async directory=>{
 const saved={sessions:[chat],lastSessionId:chat.sessionId};
 await saveConversations(directory,saved);
 assert.deepEqual(await loadConversations(directory,{sessions:[],lastSessionId:null}),saved);
}));
test('corrupt or missing primary index restores the latest complete backup',()=>fixture(async directory=>{
 const saved={sessions:[chat],lastSessionId:chat.sessionId};
 await saveConversations(directory,saved);
 await writeFile(path.join(directory,'conversations.json'),'{');
 assert.deepEqual(await loadConversations(directory,{}),saved);
 await rm(path.join(directory,'conversations.json'));
 assert.deepEqual(await loadConversations(directory,{}),saved);
}));
test('an interruption between index writes keeps the newly saved conversation',()=>fixture(async directory=>{
 await saveConversations(directory,{sessions:[],lastSessionId:null});
 const newest={sessions:[chat],lastSessionId:chat.sessionId};
 await writeFile(path.join(directory,'conversations.backup.json'),JSON.stringify(newest));
 assert.deepEqual(await loadConversations(directory,{}),newest);
}));
test('explicit deletion updates both copies and never resurrects the deleted chat',()=>fixture(async directory=>{
 await saveConversations(directory,{sessions:[chat],lastSessionId:chat.sessionId});
 const deleted={sessions:[],lastSessionId:null};
 await saveConversations(directory,deleted);
 await writeFile(path.join(directory,'conversations.json'),'broken');
 assert.deepEqual(await loadConversations(directory,{sessions:[chat]}),deleted);
 assert.deepEqual(JSON.parse(await readFile(path.join(directory,'conversations.backup.json'),'utf8')),deleted);
}));
test('unrecoverable existing index reports an error instead of silently resetting history',()=>fixture(async directory=>{
 await writeFile(path.join(directory,'conversations.json'),'broken');
 await assert.rejects(loadConversations(directory,{}),/conversation/i);
}));

test('projects and explicit general chat identity survive settings reset and primary index damage',()=>fixture(async directory=>{
 const saved={projects:['C:/Project','D:/Empty'],sessions:[chat,{sessionId:'general',projectPath:null,workspace:'C:/Profile/general-chat',title:'General'}],lastSessionId:'general'};
 await saveConversations(directory,saved);
 await writeFile(path.join(directory,'conversations.json'),'broken');
 assert.deepEqual(await loadConversations(directory,{sessions:[],projects:[]}),saved);
}));

test('chat organization survives restart and corrupt primary index; malformed flags cannot hide legacy chats',()=>fixture(async directory=>{
 const organized={...chat,customTitle:true,pinned:true,archived:true};
 await saveConversations(directory,{sessions:[organized],lastSessionId:chat.sessionId});
 await writeFile(path.join(directory,'conversations.json'),'{');
 assert.deepEqual((await loadConversations(directory,{})).sessions,[organized]);
 await writeFile(path.join(directory,'conversations.backup.json'),JSON.stringify({sessions:[{...chat,pinned:'false',archived:'true',customTitle:7}],lastSessionId:null}));
 assert.deepEqual((await loadConversations(directory,{})).sessions,[{...chat,pinned:false,archived:false,customTitle:false}]);
}));
