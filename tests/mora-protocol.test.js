import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client} from '@langchain/langgraph-sdk';
import {MoraProtocol} from '../src/mora-protocol.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
async function until(predicate){for(let i=0;i<150;i++){if(await predicate())return;await tick();}throw Error('Lifecycle did not settle.');}
async function fixture(execute,options={}){
  const directory=await mkdtemp(path.join(tmpdir(),'mora-protocol-'));
  const backend=new MoraProtocol({directory,execute,...options});await backend.open();
  const client=new Client({apiUrl:backend.url,defaultHeaders:{authorization:`Bearer ${backend.token}`}});
  return {backend,client,directory};
}

test('shutdown waits for worker credential and gateway cleanup before resolving',async()=>{
 let entered,release;const started=new Promise(resolve=>entered=resolve),cleanup=new Promise(resolve=>release=resolve);let gatewayOpen=true;
 const {backend,client,directory}=await fixture(async({signal})=>{
  const credential=path.join(directory,'dummy-auth.json');await writeFile(credential,'test-only');entered();
  await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
  await cleanup;await rm(credential);gatewayOpen=false;return {text:'stopped'};
 });
 const thread=await client.threads.create();await client.runs.create(thread.thread_id,'mora-worker',{input:{messages:[{role:'user',content:'work'}]}});await started;
 let resolved=false;const closing=backend.close().then(()=>{resolved=true;});
 await tick();const premature=resolved;release();await closing;
 assert.equal(premature,false);assert.equal(backend.active.size,0);assert.equal(gatewayOpen,false);await assert.rejects(access(path.join(directory,'dummy-auth.json')));
});

test('shutdown still closes the server and waits for cleanup when saving fails',async()=>{
 let entered,release;const started=new Promise(resolve=>entered=resolve),cleanup=new Promise(resolve=>release=resolve);
 const {backend,client,directory}=await fixture(async({signal})=>{
  const credential=path.join(directory,'dummy-auth.json');await writeFile(credential,'test-only');entered();
  await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));await cleanup;await rm(credential);return {text:'stopped'};
 });
 const thread=await client.threads.create();await client.runs.create(thread.thread_id,'mora-worker',{input:{messages:[{role:'user',content:'work'}]}});await started;
 backend.save=async()=>{throw Object.assign(Error('Task storage is full.'),{code:'ENOSPC'});};
 let settled=false;const closing=backend.close().then(()=>null,error=>error).finally(()=>{settled=true;});
 await tick();const premature=settled;release();const error=await closing;
 // Complete cleanup even with the unfixed implementation, so a failing assertion cannot leave a worker behind.
 if(backend.server.listening)await new Promise(resolve=>backend.server.close(resolve));await Promise.allSettled([...backend.active.values()].map(controller=>controller.done));
 assert.equal(premature,false);assert.equal(error.code,'ENOSPC');assert.equal(backend.active.size,0);assert.equal(backend.server.listening,false);await assert.rejects(access(path.join(directory,'dummy-auth.json')));
});

test('official SDK starts immediately, checks results and preserves durable thread identity',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve),events=[];
  const {backend,client,directory}=await fixture(async({messages})=>{await gate;return {text:messages.at(-1).content+' done'};});t.after(()=>backend.close());
  backend.on('change',value=>events.push(value));
  const thread=await client.threads.create();
  const run=await client.runs.create(thread.thread_id,'mora-worker',{input:{messages:[{role:'user',content:'First'}]}});
  assert.equal(run.thread_id,thread.thread_id);assert.notEqual(run.status,'success');
  assert.equal((await client.runs.get(thread.thread_id,run.run_id)).status,'running');
  const saved=JSON.parse(await readFile(path.join(directory,'tasks.json'),'utf8'));
  assert.equal(saved.threads[thread.thread_id].runs[run.run_id].status,'running');
  release();await until(async()=> (await client.runs.get(thread.thread_id,run.run_id)).status==='success');
  assert.equal((await client.threads.getState(thread.thread_id)).values.messages.at(-1).content,'First done');
  assert.ok(events.some(event=>event.type==='completed'));
});

test('updates interrupt old runs; cancelled and late results never become successful output',async t=>{
  const releases=new Map(),started=[];
  const {backend,client}=await fixture(async({runId,messages,signal})=>{started.push({runId,messages,signal});return new Promise(resolve=>releases.set(runId,resolve));});t.after(()=>backend.close());
  const thread=await client.threads.create();
  const first=await client.runs.create(thread.thread_id,'mora-worker',{input:{messages:[{role:'user',content:'Original'}]}});
  await until(()=>releases.has(first.run_id));
  const second=await client.runs.create(thread.thread_id,'mora-worker',{input:{messages:[{role:'user',content:'Correction'}]},multitaskStrategy:'interrupt'});
  assert.equal(second.thread_id,first.thread_id);assert.notEqual(second.run_id,first.run_id);
  assert.equal((await client.runs.get(thread.thread_id,first.run_id)).status,'interrupted');
  assert.equal(started[0].signal.aborted,true);
  releases.get(first.run_id)({text:'Obsolete result'});await until(()=>releases.has(second.run_id));
  assert.deepEqual(started[1].messages.map(m=>m.content),['Original','Correction']);
  await client.runs.cancel(thread.thread_id,second.run_id);
  assert.equal((await client.runs.get(thread.thread_id,second.run_id)).status,'cancelled');
  releases.get(second.run_id)({text:'Cancelled result'});await tick();
  assert.equal((await client.threads.getState(thread.thread_id)).values.messages.some(m=>/result/.test(m.content)),false);
});

test('pool is bounded and restart preserves tasks without executing them again',async t=>{
  let active=0,peak=0,release;const gate=new Promise(resolve=>release=resolve);
  const {backend,client,directory}=await fixture(async({signal})=>{active++;peak=Math.max(peak,active);signal.addEventListener('abort',()=>release(),{once:true});await gate;active--;return {text:'done'};},{maxWorkers:3});
  t.after(()=>backend.close());
  const jobs=[];for(let i=0;i<4;i++){const thread=await client.threads.create();jobs.push(await client.runs.create(thread.thread_id,'mora-worker',{input:{messages:[{role:'user',content:`Task ${i}`}]}}));}
  assert.equal(peak,3);assert.equal((await client.runs.get(jobs[3].thread_id,jobs[3].run_id)).status,'pending');
  await backend.close();const closedBytes=await readFile(path.join(directory,'tasks.json'),'utf8');release();await until(()=>backend.active.size===0);
  assert.equal(await readFile(path.join(directory,'tasks.json'),'utf8'),closedBytes,'Late stopped workers cannot rewrite task storage');
  let restarted=0;const restored=new MoraProtocol({directory,execute:async()=>{restarted++;return {text:'unexpected'};}});await restored.open();t.after(()=>restored.close());
  assert.equal(restored.snapshot().threads.length,4);assert.equal(restarted,0);
  assert.ok(restored.snapshot().threads.every(thread=>Object.values(thread.runs).every(run=>['interrupted','cancelled'].includes(run.status))));
});

test('protocol refuses unauthenticated, malformed and foreign-task requests',async t=>{
  const {backend,client}=await fixture(async()=>({text:'ok'}));t.after(()=>backend.close());
  assert.equal((await fetch(backend.url+'/threads',{method:'POST',body:'{}'})).status,401);
  const headers={authorization:`Bearer ${backend.token}`,'content-type':'application/json'};
  assert.equal((await fetch(backend.url+'/threads',{method:'POST',headers,body:'{broken'})).status,400);
  await assert.rejects(client.runs.create('../outside','mora-worker',{input:{messages:[]}}));
  assert.equal((await fetch(backend.url+'/threads/00000000-0000-0000-0000-000000000000/state',{headers})).status,404);
});
test('integration rollback covers cancellation before commit and failed result persistence',async t=>{
 for(const fault of ['cancel','save']){
  let applied=false,release,entered;const waiting=new Promise(resolve=>entered=resolve);
  const {backend,client}=await fixture(async()=>({text:'ready'}),{complete:async(result,{onRollback})=>{applied=true;onRollback(async()=>applied=false);entered();if(fault==='cancel')await new Promise(resolve=>release=resolve);return result;}});t.after(()=>backend.close());
  if(fault==='save'){const original=backend.save.bind(backend);let failed=false;backend.save=async()=>{if(!failed&&Object.values(backend.state.threads).some(thread=>thread.runs[thread.currentRunId]?.status==='success')){failed=true;throw Error('Result storage failed');}return original();};}
  const thread=await client.threads.create(),run=await client.runs.create(thread.thread_id,'mora-worker',{input:{messages:[{role:'user',content:'work'}]}});await waiting;
  if(fault==='cancel'){const cancelling=client.runs.cancel(thread.thread_id,run.run_id);await until(()=>backend.active.get(run.run_id)?.signal.aborted);release();await cancelling;}
  await until(()=>backend.run(backend.thread(thread.thread_id),run.run_id).status===(fault==='cancel'?'cancelled':'error'));assert.equal(applied,false);
 }
});

test('cancelling committed work retains success and never reports discarded edits',async t=>{
 const {backend,client}=await fixture(async()=>({text:'committed'}));t.after(()=>backend.close());const events=[];backend.on('change',event=>events.push(event.type));const thread=await client.threads.create(),run=await client.runs.create(thread.thread_id,'mora-worker',{input:{messages:[{role:'user',content:'work'}]}});await until(()=>backend.run(backend.thread(thread.thread_id),run.run_id).status==='success');await client.runs.cancel(thread.thread_id,run.run_id);assert.equal(backend.run(backend.thread(thread.thread_id),run.run_id).status,'success');assert.equal(events.includes('cancelled'),false);
});
