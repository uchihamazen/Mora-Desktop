import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readCachedHistory} from '../src/runtime.js';
const id='01a0f131-3a2c-77a4-ac04-20b4e618f44a';
function frame(event) {const text=Buffer.from(JSON.stringify(event));const length=Buffer.alloc(4);length.writeUInt32LE(text.length);return Buffer.concat([length,text]);}
test('missing-log recovery reads cached messages for this chat and respects revisions',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'muse-cache-test-'));
 try {
  const directory=path.join(home,'sessions','.msp-view-v1',id);await mkdir(directory,{recursive:true});
  const event=(item,sessionId=id)=>({method:'item/completed',params:{sessionId,item}});
  const rows=[event({itemId:'user',kind:'userMessage',revision:1,text:'أهلاً'}),event({itemId:'reply',kind:'agentMessage',revision:1,text:'partial'}),event({itemId:'reply',kind:'agentMessage',revision:2,text:'Saved answer'}),event({itemId:'other',kind:'agentMessage',revision:1,text:'wrong chat'},'other-id'),event({itemId:'tool',kind:'toolCall',revision:1})];
  await writeFile(path.join(directory,'journal-00000000.bin'),Buffer.concat([Buffer.from([0,255,10,123]),...rows.map(frame),Buffer.from('{"unfinished') ]));
  const items=await readCachedHistory(id,home);
  assert.deepEqual(items.map(i=>i.text),['أهلاً','Saved answer']);
  await assert.rejects(readCachedHistory('../bad',home),/session ID/);
 } finally {await rm(home,{recursive:true,force:true});}
});
