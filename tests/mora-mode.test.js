import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MoraMode} from '../src/mora-mode.js';
import {MoraSkills} from '../src/mora-skills.js';

const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Timed out');};
async function fixture(t,options={}){const profile=await mkdtemp(path.join(tmpdir(),'mora-mode-')),project=path.join(profile,'project');await mkdir(project);await writeFile(path.join(project,'a.js'),'export const a=1;');await writeFile(path.join(project,'b.js'),'export const b=1;');const mode=new MoraMode({profile,project,sessionId:'test-chat',options:{executionMode:'full'},...options});await mode.open();t.after(()=>mode.close());return mode;}
const task=(files,key,dependsOn=[])=>JSON.stringify({title:key,objective:'Implement the requested change',files,key,dependsOn});
const start=(mode,description)=>mode.backend.createThread().then(thread=>mode.backend.createRun(thread.thread_id,{assistant_id:'mora-worker',input:{messages:[{role:'user',content:description}]}}));

test('failed backend persistence still closes the native coordinator and marks requests interrupted',async()=>{
 const mode=await fixture({after:()=>{}});let nativeClosed=false;mode.state.requests=[{id:'pending',status:'pending'}];
 const close=mode.backend.close.bind(mode.backend);mode.backend.close=async()=>{await close();throw Object.assign(Error('Task storage is full.'),{code:'ENOSPC'});};
 mode.native={close:async()=>{nativeClosed=true;}};
 await assert.rejects(mode.close(),{code:'ENOSPC'});assert.equal(nativeClosed,true);assert.equal(mode.state.requests[0].status,'interrupted');
});

test('observed browser capability persists and every later worker receives the required check',async t=>{
 const mode=await fixture(t);await mode.requireBrowser();await mode.close();let observed;const recovered=new MoraMode({profile:mode.profile,project:mode.project,sessionId:mode.sessionId,options:{executionMode:'readonly'},execute:async({job})=>{observed=job.browserRequired;return {job,text:'Inspected'};}});await recovered.open();t.after(()=>recovered.close());await start(recovered,task(['a.js'],'browser-required'));await wait(()=>recovered.snapshot().tasks[0]?.status==='success');assert.equal(observed,true);
});

test('a preview observed during an active worker cannot bypass browser verification',async t=>{
 let prepared,release;const started=new Promise(resolve=>prepared=resolve),continueWork=new Promise(resolve=>release=resolve);
 const mode=await fixture(t,{execute:async({job})=>{prepared();await continueWork;await writeFile(path.join(job.root,'a.js'),'export const a=2;');await mode.workspace.verify(job);return {job,text:'Ready'};}});
 await start(mode,task(['a.js'],'late-browser'));await started;await mode.requireBrowser();release();await wait(()=>['success','error'].includes(mode.snapshot().tasks[0]?.status));
 assert.equal(mode.snapshot().tasks[0].status,'error');assert.equal(mode.snapshot().tasks[0].result.browser,'Failed');assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=1;');
});

test('a preview observed after source verification forces browser checks before applying',async t=>{
 let prepared,release;const checked=new Promise(resolve=>prepared=resolve),continueWork=new Promise(resolve=>release=resolve);
 const mode=await fixture(t,{execute:async({job})=>{await writeFile(path.join(job.root,'a.js'),'export const a=2;');await mode.workspace.verify(job);assert.equal(job.verified.browser,'Not checked');prepared();await continueWork;return {job,text:'Ready'};}});
 await start(mode,task(['a.js'],'browser-after-checks'));await checked;await mode.requireBrowser();release();await wait(()=>['success','error'].includes(mode.snapshot().tasks[0]?.status));
 assert.equal(mode.snapshot().tasks[0].status,'error');assert.equal(mode.snapshot().tasks[0].result.browser,'Failed');assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=1;');
});

test('a preview observed during integration rolls back changes before completing',async t=>{
 const mode=await fixture(t,{execute:async({job})=>{await writeFile(path.join(job.root,'a.js'),'export const a=2;');await mode.workspace.verify(job);return {job,text:'Ready'};}});
 const integrate=mode.workspace.integrate.bind(mode.workspace);mode.workspace.integrate=async(...args)=>{const result=await integrate(...args);await mode.requireBrowser();return result;};
 await start(mode,task(['a.js'],'browser-during-apply'));await wait(()=>['success','error'].includes(mode.snapshot().tasks[0]?.status));
 assert.equal(mode.snapshot().tasks[0].status,'error');assert.match(mode.snapshot().tasks[0].detail,/Browser testing became required/);assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=1;');
});

test('missing skill libraries are visible and native fallback receipts survive reopening',async t=>{
 const cache=path.join(await mkdtemp(path.join(tmpdir(),'mora-missing-skills-')),'absent'),skillLibrary=new MoraSkills({cache});const mode=await fixture(t,{skillLibrary,execute:async({job})=>{await writeFile(path.join(job.root,'a.js'),'export const a=2;');await mode.workspace.verify(job);return {job,text:'Native fallback'};}});assert.ok(mode.snapshot().skills.missing.includes('ponytail:ponytail'));assert.deepEqual(mode.snapshot().skills.available,[]);const run=await start(mode,task(['a.js'],'fallback'));await wait(()=>mode.backend.run(mode.backend.thread(run.thread_id),run.run_id).status==='success');assert.ok(mode.snapshot().tasks[0].result.missingSkills.includes('ponytail:ponytail'));assert.deepEqual(mode.snapshot().tasks[0].result.skills,[]);await mode.close();const recovered=new MoraMode({profile:mode.profile,project:mode.project,sessionId:mode.sessionId,skillLibrary});await recovered.open();t.after(()=>recovered.close());assert.ok(recovered.snapshot().tasks[0].result.missingSkills.includes('ponytail:ponytail'));
});

test('read-only skill receipts retain hashes without instruction bodies',async t=>{
 const receipt={id:'ponytail:ponytail',label:'Ponytail · Full',source:'ponytail@1.0.0',resource:'SKILL.md',sha256:'a'.repeat(64)},mode=await fixture(t,{options:{executionMode:'readonly'},execute:async({job})=>{job.skillUsage=[receipt];return {job,text:'Reviewed source'};}});const run=await start(mode,task(['a.js'],'review'));await wait(()=>mode.backend.run(mode.backend.thread(run.thread_id),run.run_id).status==='success');assert.deepEqual(mode.snapshot().tasks[0].result.skills,[receipt]);assert.equal(mode.snapshot().tasks[0].result.skills[0].content,undefined);
});

test('skill reads survive cancellation and pre-check errors without claiming verification',async t=>{
 const receipt={id:'ponytail:ponytail',label:'Ponytail · Full',source:'ponytail@1.0.0',resource:'SKILL.md',sha256:'a'.repeat(64)};let fail=false;
 const mode=await fixture(t,{execute:async({job,onSkillRead,signal})=>{job.skillUsage=[receipt];await onSkillRead(job.skillUsage);if(fail)throw Error('Provider failed before checks');if(!signal.aborted)await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {job,text:'Stopped'};}});const first=await start(mode,task(['a.js'],'cancelled'));await wait(()=>mode.snapshot().tasks[0]?.result?.skills.length);await mode.command('cancel',{id:first.thread_id});assert.deepEqual(mode.snapshot().tasks[0].result.skills,[receipt]);assert.equal(mode.snapshot().tasks[0].result.browser,'Not checked');fail=true;await start(mode,task(['b.js'],'failed'));await wait(()=>mode.snapshot().tasks[1]?.status==='error');assert.deepEqual(mode.snapshot().tasks[1].result.skills,[receipt]);assert.deepEqual(mode.snapshot().tasks[1].result.checks,[]);await mode.close();const recovered=new MoraMode({profile:mode.profile,project:mode.project,sessionId:mode.sessionId});await recovered.open();t.after(()=>recovered.close());assert.deepEqual(recovered.snapshot().tasks[0].result.skills,[receipt]);assert.deepEqual(recovered.snapshot().tasks[1].result.skills,[receipt]);assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=1;');
});

test('coordinator stores actual skill hashes per request without copying instruction bodies',async t=>{
 const entry={id:'superpowers:writing-plans',label:'writing plans',source:'superpowers@6.4.2',resource:'SKILL.md',sha256:'b'.repeat(64),content:'Original guidance'},skillLibrary={forRole:async()=>({missing:[],list:async()=>[entry],read:async()=>entry})};const mode=await fixture(t,{skillLibrary,decide:async({messages})=>messages.at(-1).role==='tool'?{message:'Planned',tool_calls:[]}:{message:'',tool_calls:[{name:'read_skill',arguments:JSON.stringify({id:entry.id})}]}});await mode.enable(true);await mode.send('Plan a source change');await wait(()=>!mode.replying);const [read]=mode.state.requests[0].skills;assert.equal(read.sha256,entry.sha256);assert.equal(read.content,undefined);assert.equal(mode.snapshot().tasks.length,0);await mode.close();const recovered=new MoraMode({profile:mode.profile,project:mode.project,sessionId:mode.sessionId,skillLibrary});await recovered.open();t.after(()=>recovered.close());assert.equal(recovered.state.requests[0].skills[0].sha256,entry.sha256);
});

test('chat stays independent of workers; actual middleware starts tasks, saved messages survive restart',async t=>{
  let release;const mode=await fixture(t,{execute:({job})=>new Promise(resolve=>release=async()=>{await writeFile(path.join(job.root,'a.js'),'export const a=2;');await mode.workspace.verify(job);resolve({job,text:'Implemented'});}),decide:async({messages})=>messages.at(-1).role==='tool'||messages.at(-1).content==='What is 2+2?'?{message:'4',tool_calls:[]}:{message:'',tool_calls:[{name:'start_async_task',arguments:JSON.stringify({agentName:'coder',description:task(['a.js'],'first')})}]}});
  await mode.enable(true);assert.deepEqual(await mode.send('Implement first'),{accepted:true,moraMode:true});await wait(()=>!mode.replying&&mode.snapshot().tasks.length===1&&release);await mode.send('What is 2+2?');await wait(()=>!mode.replying);assert.equal(mode.snapshot().tasks[0].status,'running');assert.equal(mode.state.items.at(-1).text,'4');await release();await wait(()=>mode.snapshot().tasks[0].status==='success');await wait(()=>mode.state.items.some(item=>item.text.includes('changes applied')));assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=2;');await mode.close();
  const recovered=new MoraMode({profile:mode.profile,project:mode.project,sessionId:mode.sessionId});await recovered.open();t.after(()=>recovered.close());assert.equal(recovered.state.enabled,true);assert.ok(recovered.state.items.some(item=>item.text==='What is 2+2?'));assert.equal(recovered.snapshot().tasks[0].receipt,'Applied');
});

test('overlapping ownership is refused; dependencies release only after verified integration',async t=>{
  const releases=new Map();const mode=await fixture(t,{execute:({job})=>new Promise(resolve=>releases.set(job.task.key,async()=>{await writeFile(path.join(job.root,'a.js'),`export const a=${job.task.key==='first'?2:3};`);await mode.workspace.verify(job);resolve({job,text:'Done'});} ))});
  const first=await start(mode,task(['a.js'],'first'));await wait(()=>releases.has('first'));await assert.rejects(start(mode,task(['a.js'],'conflict')),/owns/);const second=await start(mode,task(['a.js'],'second',['first']));await new Promise(resolve=>setTimeout(resolve,100));assert.equal(mode.backend.run(mode.backend.thread(second.thread_id),second.run_id).status,'pending');await releases.get('first')();await wait(()=>releases.has('second'));await releases.get('second')();await wait(()=>mode.backend.run(mode.backend.thread(second.thread_id),second.run_id).status==='success');assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=3;');await assert.rejects(mode.command('cancel',{id:'another-chat'}),/not found/);assert.ok(first.run_id);
});

test('cancel and restart pause accepted jobs and stale results never apply',async t=>{
  let late;const mode=await fixture(t,{execute:({job})=>new Promise(resolve=>late=async()=>{await writeFile(path.join(job.root,'a.js'),'export const a=9;');await mode.workspace.verify(job);resolve({job,text:'Late'});})});await mode.enable(true);const run=await start(mode,task(['a.js'],'first'));await wait(()=>late);await mode.command('cancel',{id:run.thread_id});await late();await new Promise(resolve=>setTimeout(resolve,80));assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=1;');await mode.command('resume',{id:run.thread_id});await mode.close();const recovered=new MoraMode({profile:mode.profile,project:mode.project,sessionId:mode.sessionId,execute:()=>{throw Error('Must not replay');}});await recovered.open();t.after(()=>recovered.close());assert.equal(recovered.snapshot().tasks[0].status,'interrupted');assert.equal(recovered.backend.active.size,0);
});

test('early queued follow-ups see completed replies without delivering future messages prematurely',async t=>{
  let release,first=true;const observed=[];const mode=await fixture(t,{decide:async({messages})=>{observed.push(messages);if(first){first=false;await new Promise(resolve=>release=resolve);return {message:'First reply completed',tool_calls:[]};}return {message:'Second reply completed',tool_calls:[]};}});await mode.enable(true);await mode.send('First request');await wait(()=>release);await mode.send('Second request');release();await wait(()=>!mode.replying);assert.equal(observed[0].some(message=>message.content==='Second request'),false);assert.ok(observed[1].some(message=>message.content==='First reply completed'));assert.equal(mode.state.requests.filter(row=>row.status==='success').length,2);
});
test('read-only analysis can finish without edits while a misbehaving worker cannot integrate',async t=>{
  let change=false;const mode=await fixture(t,{options:{executionMode:'readonly'},execute:async({job})=>{if(change)await writeFile(path.join(job.root,'a.js'),'export const a=9;');return {job,text:'Analysis only'};}});const first=await start(mode,task(['a.js'],'analysis'));await wait(()=>mode.backend.run(mode.backend.thread(first.thread_id),first.run_id).status==='success');assert.equal(mode.snapshot().tasks[0].receipt,'Done');await wait(()=>mode.state.items.some(item=>item.text.includes('No automated source checks')));change=true;const second=await start(mode,task(['a.js'],'unexpected'));await wait(()=>mode.backend.run(mode.backend.thread(second.thread_id),second.run_id).status==='error');assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=1;');
});
test('recovering a failed acknowledgement uses request-owned tasks without repeating completed work',async t=>{
 let executions=0;const mode=await fixture(t,{execute:async({job})=>{executions++;await writeFile(path.join(job.root,'a.js'),'export const a=2;');await mode.workspace.verify(job);return {job,text:'Completed'};},decide:async({messages})=>{if(messages.at(-1).role==='tool'){await wait(()=>mode.snapshot().tasks.some(task=>task.status==='success'));throw Error('Acknowledgement provider failure');}return {message:'',tool_calls:[{name:'start_async_task',arguments:JSON.stringify({agentName:'coder',description:task(['a.js'],'once')})}]};}});await mode.enable(true);await mode.send('Implement once');await wait(()=>!mode.replying);assert.equal(mode.state.requests[0].status,'error');assert.equal(executions,1);await mode.command('resume-request',{id:mode.state.requests[0].id});assert.equal(mode.state.requests[0].status,'success');assert.equal(executions,1);assert.equal(mode.snapshot().tasks.length,1);assert.equal(mode.state.items.filter(item=>item.itemId.startsWith('mora-reply-')).length,1);
});
test('concurrent desktop shutdown paths both await mode cleanup',async t=>{
 const mode=await fixture(t);let release,cleaned=false;mode.native={close:async()=>{await new Promise(resolve=>release=resolve);cleaned=true;}};const first=mode.close(),second=mode.close();assert.equal(first,second);await wait(()=>release);let returned=false;second.then(()=>returned=true);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(returned,false);release();await first;assert.equal(cleaned,true);
});
test('failed verification results retain review evidence without applying source',async t=>{
 const mode=await fixture(t,{execute:async({job,workspace})=>{await writeFile(path.join(job.root,'a.js'),'export const a=;');await workspace.verify(job);return {job,text:'Candidate'};}});const run=await start(mode,task(['a.js'],'invalid'));await wait(()=>mode.snapshot().tasks[0]?.status==='error');const result=mode.snapshot().tasks[0].result;assert.ok(result.checks.some(check=>!check.passed));assert.deepEqual(result.files,[]);assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=1;');assert.ok(run.run_id);
});
