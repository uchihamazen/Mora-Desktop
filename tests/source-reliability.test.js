import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AccountLogin} from '../src/account.js';
import {loadConversations,saveConversations} from '../src/persistence.js';
import {loadWork,saveWork} from '../src/work.js';
import {MspClient} from '../src/msp.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t) {
  const directory=await fs.mkdtemp(path.join(tmpdir(),'mora-source-reliability-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;
}
function loginClient() {
  const client=new EventEmitter();client.closes=0;client.connected=true;
  client.connect=async()=>{};client.close=async()=>{client.closes++;};
  client.request=async()=>({verificationUrl:'https://auth.meta.com/device',userCode:'FIXTURE-CODE'});
  return client;
}

test('dropped sign-in clears its code; retry ignores a late grant from the old host',async t=>{
  const first=loginClient(),second=loginClient(),states=[],opened=[];
  const clients=[first,second],login=new AccountLogin(state=>states.push(state),{clientFactory:()=>clients.shift(),openExternal:async url=>opened.push(url)});
  t.after(()=>login.cancel());
  await login.start({});assert.equal(states.at(-1).userCode,'FIXTURE-CODE');
  first.emit('disconnected','token=private network failure');await tick();
  assert.equal(states.at(-1).status,'required');assert.equal(states.at(-1).userCode,undefined);assert.equal(first.closes,1);
  await login.start({});first.emit('notification','account/loginCompleted',{outcome:'granted'});await tick();
  assert.equal(states.at(-1).status,'pending');assert.equal(second.closes,0);
  second.emit('notification','account/loginCompleted',{outcome:'granted'});await tick();
  assert.equal(states.at(-1).status,'signedIn');assert.equal(second.closes,1);assert.equal(opened.length,2);
  assert.doesNotMatch(JSON.stringify(states),/private/);
});

test('cancelling a pending login request blocks its late code and browser launch',async t=>{
  const client=loginClient();let release,requested,opens=0,last;
  const waiting=new Promise(resolve=>requested=resolve);
  client.request=async method=>{if(method==='account/loginCancel')return {};requested();return new Promise(resolve=>release=resolve);};
  const login=new AccountLogin(state=>last=state,{clientFactory:()=>client,openExternal:async()=>opens++});
  t.after(()=>login.cancel());const started=login.start({});await waiting;await login.cancel();
  release({verificationUrl:'https://auth.meta.com/device',userCode:'LATE-CODE'});await started;
  client.emit('notification','account/loginCompleted',{outcome:'granted'});await tick();
  assert.equal(last.status,'required');assert.equal(last.userCode,undefined);assert.equal(opens,0);assert.equal(client.closes,1);
});

test('login request and browser failures close the host without exposing provider details',async t=>{
  for(const failure of ['request','browser']) {
    const client=loginClient();let last;
    if(failure==='request')client.request=async()=>{throw Error('token=private connection reset');};
    const login=new AccountLogin(state=>last=state,{clientFactory:()=>client,openExternal:async()=>{throw Error('secret browser failure');}});
    t.after(()=>login.cancel());await login.start({});
    assert.equal(last.status,'required');assert.equal(last.userCode,undefined);assert.equal(client.closes,1);assert.doesNotMatch(JSON.stringify(last),/private|secret/);
  }
});

// Replace only the built-in write during a single isolated save. Partial temporary
// bytes model a full disk without filling the machine's real filesystem.
async function diskFullOnWrite(writeNumber,save) {
  const original=fs.writeFile;let writes=0;
  fs.writeFile=async(filename,data,...options)=>{
    if(++writes!==writeNumber)return original(filename,data,...options);
    await original(filename,String(data).slice(0,12));throw Object.assign(Error('Fixture disk is full.'),{code:'ENOSPC'});
  };
  syncBuiltinESMExports();
  try{await assert.rejects(save(),{code:'ENOSPC'});assert.equal(writes,writeNumber);}
  finally{fs.writeFile=original;syncBuiltinESMExports();}
}

test('full-disk conversation saves recover the last complete commit and can be retried',async t=>{
  for(const writeNumber of [1,2]) {
    const directory=await fixture(t),old={sessions:[{sessionId:'old',workspace:directory,title:'Keep'}],lastSessionId:'old'},next={sessions:[{sessionId:'new',workspace:directory,title:'Newest'}],lastSessionId:'new'};
    await saveConversations(directory,old);await diskFullOnWrite(writeNumber,()=>saveConversations(directory,next));
    assert.deepEqual(await loadConversations(directory,{}),writeNumber===1?old:next);
    await saveConversations(directory,next);assert.deepEqual(await loadConversations(directory,{}),next);
    assert.equal((await fs.readdir(directory)).some(name=>name.endsWith('.tmp')),false);
  }
});

test('full-disk work saves retain drafts and pause recovered requests without replay',async t=>{
  for(const writeNumber of [1,2]) {
    const directory=await fixture(t),old={draft:{text:'Keep draft',images:[]},pendingQueue:[{queueId:'old-q',text:'Keep queued',images:[]}]},next={draft:{text:'Newest draft',images:[]},pendingQueue:[{queueId:'new-q',text:'Newest queued',images:[]}],activeRequest:{text:'Admitted once',images:[],phase:'admitted',turnId:'turn'}};
    await saveWork(directory,'chat',old);await diskFullOnWrite(writeNumber,()=>saveWork(directory,'chat',next));
    const recovered=await loadWork(directory,'chat');
    assert.equal(recovered.draft.text,(writeNumber===1?old:next).draft.text);assert.equal(recovered.pendingQueue[0].queueId,writeNumber===1?'old-q':'new-q');assert.equal(recovered.queuePaused,true);
    assert.equal(recovered.activeRequest?.turnId,writeNumber===1?undefined:'turn');
    await saveWork(directory,'chat',next);assert.equal((await loadWork(directory,'chat')).draft.text,next.draft.text);
    assert.equal((await fs.readdir(path.join(directory,'work'))).some(name=>name.endsWith('.tmp')),false);
  }
});

test('an interrupted primary rename leaves the committed backup readable after restart',async t=>{
  const directory=await fixture(t),old={sessions:[],lastSessionId:null},next={sessions:[{sessionId:'saved',workspace:directory,title:'Saved before interruption'}],lastSessionId:'saved'};
  await saveConversations(directory,old);const original=fs.rename;
  fs.rename=async(from,to)=>{if(to===path.join(directory,'conversations.json'))throw Object.assign(Error('Interrupted save.'),{code:'EIO'});return original(from,to);};syncBuiltinESMExports();
  try{await assert.rejects(saveConversations(directory,next),{code:'EIO'});}
  finally{fs.rename=original;syncBuiltinESMExports();}
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'conversations.json'),'utf8')),old);
  assert.deepEqual(await loadConversations(directory,{}),next);
  await saveConversations(directory,next);assert.equal((await fs.readdir(directory)).some(name=>name.endsWith('.tmp')),false);
});

test('a crashed protocol host can reconnect without reviving pending old requests',async t=>{
  const client=new MspClient(),options={executable:process.execPath,args:[fileURLToPath(new URL('./fixtures/host.js',import.meta.url))],workspace:process.cwd(),timeoutMs:5000};
  t.after(()=>client.close());await client.connect(options);
  const pending=assert.rejects(client.request('timeout'),/exited|closed|disconnect/i);
  await assert.rejects(client.request('crash'),/exited|closed|disconnect/i);await pending;
  await client.connect(options);assert.equal((await client.request('healthy',{afterCrash:true})).params.afterCrash,true);
  await client.close();await assert.rejects(client.request('healthy'),/disconnected/i);
});
