import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/context-navigation.js';
test('handoff retains queued and interrupted coordinator requests before workers exist',()=>{const result=api.buildHandoff({moraMode:{requests:[{status:'pending',text:'Implement checkout'},{status:'interrupted',text:'Review receipt'},{status:'success',text:'Already delivered'}],tasks:[]}});assert.match(result.text,/Implement checkout/);assert.match(result.text,/Review receipt/);assert.doesNotMatch(result.text,/Already delivered|No recorded pending work/);});
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readHistory,sessionLogPath} from '../src/runtime.js';
import {HistoryWindow} from '../src/history-window.js';

async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'mora-context-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}

test('explicit file and folder context includes Unicode source, excludes generated and secret paths',()=>fixture(async root=>{
  assert.equal(typeof api.resolveProjectContext,'function');
  await mkdir(path.join(root,'src'));await mkdir(path.join(root,'src','node_modules'));
  await writeFile(path.join(root,'src','واجهة.js'),'// القرار: واجهة عربية\nexport const café = true;');
  await writeFile(path.join(root,'src','.env.local'),'SECRET');await writeFile(path.join(root,'src','auth.json'),'SECRET');
  await writeFile(path.join(root,'src','node_modules','private.js'),'SECRET');
  const result=await api.resolveProjectContext(root,[{kind:'file',path:'src/واجهة.js'},{kind:'folder',path:'src'}]);
  assert.equal(result.entries[0].text,'// القرار: واجهة عربية\nexport const café = true;');
  assert.deepEqual(result.entries[1].entries,['src/واجهة.js']);
  assert.match(result.text,/@file src\/واجهة.js/);assert.match(result.text,/@folder src/);assert.doesNotMatch(result.text,/SECRET|auth\.json|\.env|node_modules/);
  assert.equal(result.bytes,Buffer.byteLength(result.text));
}));

test('context refuses traversal, absolute paths, device paths, secret variants and generated descendants',()=>fixture(async root=>{
  assert.equal(typeof api.resolveProjectContext,'function');
  await mkdir(path.join(root,'config'));await mkdir(path.join(root,'src'));
  for(const name of ['.envrc','config/prod.secrets.yml','config/service-account.json'])await writeFile(path.join(root,name),'SECRET');
  for(const name of ['../outside.txt','src/../../outside','src\\..\\outside','/tmp/outside','C:\\outside','\\\\host\\share','file:///outside','src/app.js:secret','src/a.','src/CON','src/secret.key','.env.example','.envrc','.ssh/config','config/credentials.json','config/secrets.yaml','config/prod.secrets.yml','config/token.txt','config/service-account.json','build/app.js','src/dist/app.js','src/.cache/a','workplans/private.md']){
    await assert.rejects(api.resolveProjectContext(root,[{kind:'file',path:name}]),/path|context|unavailable|secret|generated/i,name);
  }
  await assert.rejects(api.resolveProjectContext(root,[{kind:'execute',path:'src'}]),/reference|kind/i);
  await assert.rejects(api.resolveProjectContext(root,Array.from({length:11},()=>({kind:'file',path:'x.js'}))),/10|many|limit/i);
}));

test('context refuses linked files and folders rather than following outside the project',()=>fixture(async root=>{
  assert.equal(typeof api.resolveProjectContext,'function');
  const outside=await mkdtemp(path.join(tmpdir(),'mora-context-outside-'));
  try{
    await writeFile(path.join(outside,'private.js'),'PRIVATE');await symlink(outside,path.join(root,'linked'),'junction');
    await assert.rejects(api.resolveProjectContext(root,[{kind:'file',path:'linked/private.js'}]),/linked|symbolic/i);
    await assert.rejects(api.resolveProjectContext(root,[{kind:'folder',path:'linked'}]),/linked|symbolic/i);
    const result=await api.resolveProjectContext(root,[{kind:'folder',path:''}]);assert.doesNotMatch(result.text,/PRIVATE|linked/);
  }finally{await rm(outside,{recursive:true,force:true});}
}));

test('UTF-8 snippets and combined payloads are bounded; binary, invalid UTF-8 and cancelled reads are refused',()=>fixture(async root=>{
  assert.equal(typeof api.resolveProjectContext,'function');
  await writeFile(path.join(root,'large.js'),'😀مرحبا'.repeat(5000));
  const one=await api.resolveProjectContext(root,[{kind:'file',path:'large.js'}]);
  assert.ok(Buffer.byteLength(one.entries[0].text)<=16384);assert.equal(one.entries[0].truncated,true);assert.doesNotMatch(one.entries[0].text,/\uFFFD/);
  assert.ok(/truncated/i.test(one.text),'clipped context text must identify truncation');
  for(let i=0;i<5;i++)await writeFile(path.join(root,`file-${i}.js`),'x'.repeat(18000));
  const many=await api.resolveProjectContext(root,Array.from({length:5},(_,i)=>({kind:'file',path:`file-${i}.js`})));
  assert.ok(many.bytes<=49152);assert.equal(many.truncated,true);
  await writeFile(path.join(root,'binary.dat'),Buffer.from([97,0,98]));await writeFile(path.join(root,'invalid.js'),Buffer.from([0xff,0xfe]));
  await assert.rejects(api.resolveProjectContext(root,[{kind:'file',path:'binary.dat'}]),/text|binary/i);
  await assert.rejects(api.resolveProjectContext(root,[{kind:'file',path:'invalid.js'}]),/UTF|text/i);
  const abort=new AbortController();abort.abort();await assert.rejects(api.resolveProjectContext(root,[{kind:'file',path:'large.js'}],{signal:abort.signal}),{name:'AbortError'});
}));

test('folder listings stop at fixed entry caps and retain no file bodies',()=>fixture(async root=>{
  assert.equal(typeof api.resolveProjectContext,'function');
  await mkdir(path.join(root,'folder'));
  await Promise.all(Array.from({length:210},(_,i)=>writeFile(path.join(root,'folder',`file-${String(i).padStart(3,'0')}.js`),'DO_NOT_READ_BODY')));
  const result=await api.resolveProjectContext(root,[{kind:'folder',path:'folder'}]);
  assert.equal(result.entries[0].entries.length,200);assert.equal(result.entries[0].truncated,true);assert.equal(result.truncated,true);assert.doesNotMatch(result.text,/DO_NOT_READ_BODY/);
}));

test('chat search reaches full persisted history, uses literal Unicode queries, hides retractions and bounds results',()=>{
  assert.equal(typeof api.searchChatHistory,'function');
  const items=Array.from({length:5000},(_,i)=>({itemId:'item-'+i,turnId:'turn-'+i,kind:'userMessage',text:i===0?'قرار العربية: café [a-z]':`row ${i}`}));
  items.push({itemId:'hidden',kind:'agentMessage',text:'قرار العربية',retracted:true});
  const hit=api.searchChatHistory(items,'قرار العربية');assert.equal(hit.total,1);assert.equal(hit.results[0].itemId,'item-0');assert.equal(hit.results[0].index,0);
  assert.equal(api.searchChatHistory(items,'[a-z]').total,1);assert.equal(api.searchChatHistory(items,'CAFÉ').total,1);
  const many=api.searchChatHistory(items,'row',{limit:3});assert.equal(many.results.length,3);assert.equal(many.total,4999);assert.equal(many.truncated,true);
  assert.ok(many.results.every(item=>Buffer.byteLength(item.excerpt)<=1024));
  assert.deepEqual(api.searchChatHistory(items,'  ').results,[]);assert.throws(()=>api.searchChatHistory(items,'x'.repeat(257)),/query|256|long/i);
  const abort=new AbortController();abort.abort();assert.throws(()=>api.searchChatHistory(items,'row',{signal:abort.signal}),{name:'AbortError'});
  assert.equal(items.length,5001);
});

test('project log search names actual sources and bounds excerpts rather than executing commands',()=>{
  assert.equal(typeof api.searchProjectLogs,'function');
  const logs={run:{status:'failed',output:'\u001b[31mERROR startup\u001b[0m\nready'},tests:{status:'stale',results:[{script:'test',status:'failed',output:'first\nخطأ العربية\n'+('x'.repeat(10000)+' ERROR end')}]}};
  const result=api.searchProjectLogs(logs,'error',{limit:1});assert.equal(result.total,2);assert.equal(result.results[0].source,'run');assert.equal(result.results[0].line,1);assert.doesNotMatch(result.results[0].excerpt,/\u001b/);assert.equal(result.truncated,true);
  assert.equal(api.searchProjectLogs(logs,'خطأ').results[0].source,'test');
  const last=api.searchProjectLogs(logs,'ERROR end').results[0];assert.ok(Buffer.byteLength(last.excerpt)<=1024);assert.match(last.excerpt,/ERROR end/);
});

test('saved native history remains searchable when its matching message is outside the rendered window',()=>fixture(async root=>{
  const sessionId='019baf42-1100-7000-8000-000000000001',filename=sessionLogPath(sessionId,root);
  await mkdir(path.dirname(filename),{recursive:true});
  const records=Array.from({length:301},(_,i)=>({id:'record-'+i,payload:{kind:'run',run_id:'turn-'+i,event:{kind:'started',prompt:i===0?'Earlier delivery decision':'Recent request '+i}}}));
  await writeFile(filename,records.map(record=>JSON.stringify(record)).join('\n'));
  const items=await readHistory(sessionId,root),rendered=new HistoryWindow().project({sessionId,items});
  assert.equal(rendered.items.length,200);assert.equal(rendered.items.some(item=>item.text==='Earlier delivery decision'),false);
  const result=api.searchChatHistory(items,'Earlier delivery');assert.equal(result.total,1);assert.equal(result.results[0].itemId,'user-turn-0');
}));

test('handoff reports sourced decisions, durable pending work and actual historical checks without inventing success',()=>{
  assert.equal(typeof api.buildHandoff,'function');
  const result=api.buildHandoff({project:'Shop',items:[
    {itemId:'u1',kind:'userMessage',text:'Decision: Keep the Arabic layout.'},
    {itemId:'a1',kind:'agentMessage',text:'Everything passed!'},
    {itemId:'a2',kind:'agentMessage',text:'Decided: Use native date inputs.'},
    {itemId:'hidden',kind:'userMessage',text:'Decision: delete all data.',retracted:true}
  ],pendingQueue:[{queueId:'queue1',text:'Add delivery fees'}],activeRequest:{text:'Fix checkout',phase:'admitted'},
  checks:{status:'stale',previousStatus:'passed',results:[{script:'test',status:'passed'}]},
  moraMode:{tasks:[{id:'task1',title:'Checkout',status:'error',detail:'Browser failed',result:{checks:[{name:'Original tests',passed:true}],browser:'Failed'}}]}});
  assert.match(result.text,/Keep the Arabic layout/);assert.match(result.text,/Use native date inputs/);assert.match(result.text,/Add delivery fees/);assert.match(result.text,/Fix checkout/);
  assert.match(result.text,/stale/i);assert.match(result.text,/Browser failed|Browser: Failed/);assert.doesNotMatch(result.text,/Everything passed!|delete all data|all checks passed/i);
  assert.ok(result.sourceItemIds.includes('u1'));assert.ok(result.sourceItemIds.includes('a2'));
  const empty=api.buildHandoff({});assert.match(empty.text,/No recorded decisions/i);assert.match(empty.text,/Not checked/i);assert.ok(Buffer.byteLength(empty.text)<=16384);
  const huge=api.buildHandoff({items:[{itemId:'u',kind:'userMessage',text:'Decision: '+('😀'.repeat(10000))}],pendingQueue:Array.from({length:20},()=>({text:'x'.repeat(10000)}))});
  assert.ok(Buffer.byteLength(huge.text)<=16384);assert.equal(huge.truncated,true);assert.doesNotMatch(huge.text,/\uFFFD/);
  assert.ok(/Not checked/.test(huge.text),'large pending work must preserve verification status');assert.ok(/Recorded verification/.test(huge.text));
});
