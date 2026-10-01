import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sessionLogPath,readHistory} from '../src/runtime.js';

test('local calendar and retained log discovery survive UTC midnight and a later first send',async()=>{
 const previousZone=process.env.TZ;process.env.TZ='Africa/Cairo';
 const home=await mkdtemp(path.join(tmpdir(),'muse-date-history-'));
 const hex=Date.UTC(2026,8,30,22).toString(16).padStart(12,'0');
 const id=`${hex.slice(0,8)}-${hex.slice(8)}-7000-8000-000000000000`;
 try {
  assert.equal(sessionLogPath(id,home),path.join(home,'sessions','2026','10','01',id,'session.jsonl'));
  for(const day of ['2026/09/30','2026/10/02']) {
   const filename=path.join(home,'sessions',...day.split('/'),id,'session.jsonl');
   await mkdir(path.dirname(filename),{recursive:true});
   await writeFile(filename,JSON.stringify({payload:{kind:'run',run_id:'r',event:{kind:'assistant_message_committed',text:'Retained native context'}}})+'\n');
   assert.equal((await readHistory(id,home))[0].text,'Retained native context');
   await rm(filename);
  }
  await assert.rejects(readHistory(id,home),{code:'ENOENT'});
 } finally {if(previousZone===undefined)delete process.env.TZ;else process.env.TZ=previousZone;await rm(home,{recursive:true,force:true});}
});
