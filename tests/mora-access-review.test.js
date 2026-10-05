import test from 'node:test';
import assert from 'node:assert/strict';

test('sensitive source review applies across languages while small ordinary edits stay lightweight',()=>{
  const change=name=>[{path:name,before:Buffer.from('old'),after:Buffer.from('new')}];
  for(const name of ['src/auth.ts','src/permissions.tsx','src/security.py','src/credentials.go','src/access-control.rs','src/access_control.rb','config/auth.json','src/auth/login.ts','server/security/check.rs','package.json'])assert.equal(needsIndependentReview(change(name)),true,name);
  for(const name of ['src/counter.ts','src/catalog.py','docs/guide.md'])assert.equal(needsIndependentReview(change(name)),false,name);
});
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MoraMode} from '../src/mora-mode.js';
import {parseIndependentReview,needsIndependentReview} from '../src/independent-review.js';
const wait=async predicate=>{for(let i=0;i<500;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Task did not settle.');};
async function fixture(t,extra={}){const profile=await mkdtemp(path.join(tmpdir(),'mora-access-')),project=path.join(profile,'project');await mkdir(project);for(const name of ['a','b','c'])await writeFile(path.join(project,name+'.js'),`export const ${name}=1;`);const mode=new MoraMode({profile,project,sessionId:'access-chat',options:{executionMode:'project'},...extra});await mode.open();t.after(async()=>{await mode.close();await rm(profile,{recursive:true,force:true});});return mode;}
const start=async(mode,files=['a.js'])=>{const thread=await mode.backend.createThread();return mode.backend.createRun(thread.thread_id,{assistant_id:'mora-worker',input:{messages:[{role:'user',content:JSON.stringify({title:'Requested edit',objective:'Update assigned source',files})}]}});};
test('scoped source task edits assigned copy, verifies and integrates without granting commands',async t=>{
  let commandPermission;const mode=await fixture(t,{execute:async({job,workspace})=>{commandPermission=job.projectCommands;await writeFile(path.join(job.root,'a.js'),'export const a=2;');await workspace.verify(job);return {job,text:'Updated'};}});await start(mode);await wait(()=>mode.snapshot().tasks[0]?.status==='success');assert.equal(commandPermission,false);assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=2;');
});
test('project script permission is explicit and belongs to exactly one resumed task run',async t=>{
  const permissions=[];const mode=await fixture(t,{execute:async({job,workspace})=>{permissions.push(job.projectCommands);await writeFile(path.join(job.root,'a.js'),'export const a=2;');await workspace.verify(job);return {job,text:'Candidate'};}});
  await mkdir(path.join(mode.project,'tests'));await writeFile(path.join(mode.project,'tests/a.test.js'),"import test from 'node:test';import assert from 'node:assert/strict';import {a} from '../a.js';test('export is numeric',()=>assert.equal(typeof a,'number'));");await writeFile(path.join(mode.project,'package.json'),JSON.stringify({type:'module',scripts:{test:'node --test tests/a.test.js'}}));
  const first=await start(mode);await wait(()=>mode.snapshot().tasks[0]?.status==='error');assert.equal(mode.snapshot().tasks[0].result.permissionRequired,true);assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=1;');
  await mode.command('approve-checks',{id:first.thread_id});await wait(()=>mode.snapshot().tasks[0]?.status==='success');assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=2;');
  await mode.command('resume',{id:first.thread_id});await wait(()=>mode.snapshot().tasks[0]?.status==='error');assert.deepEqual(permissions,[false,true,false]);
});
test('independent findings block larger candidate delivery and preserve current project',async t=>{
  let reviewed=false;const mode=await fixture(t,{review:async()=>{reviewed=true;return JSON.stringify({approved:false,findings:['Missing cancellation handling']});},execute:async({job,workspace})=>{for(const name of ['a','b','c'])await writeFile(path.join(job.root,name+'.js'),`export const ${name}=2;`);await workspace.verify(job);return {job,text:'Candidate'};}});await start(mode,['a.js','b.js','c.js']);await wait(()=>mode.snapshot().tasks[0]?.status==='error');assert.equal(reviewed,true);assert.equal(mode.snapshot().tasks[0].result.review.approved,false);assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=1;');
});
test('cancellation remains responsive during independent review and prevents apply',async t=>{
  let entered=false;const mode=await fixture(t,{review:async({signal})=>{entered=true;await new Promise((resolve,reject)=>{if(signal.aborted)reject(Error('Stopped'));else signal.addEventListener('abort',()=>reject(Error('Stopped')),{once:true});});},execute:async({job,workspace})=>{for(const name of ['a','b','c'])await writeFile(path.join(job.root,name+'.js'),`export const ${name}=2;`);await workspace.verify(job);return {job,text:'Candidate'};}});const run=await start(mode,['a.js','b.js','c.js']);await wait(()=>entered);await mode.command('cancel',{id:run.thread_id});await wait(()=>mode.snapshot().tasks[0]?.status==='cancelled');assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=1;');
});
test('review decisions fail closed on malformed or contradictory results',()=>{
  for(const text of ['Looks good','{}','{"approved":true,"findings":["Bug"]}','{"approved":false,"findings":[]}'])assert.throws(()=>parseIndependentReview(text),/review/i);
  assert.equal(parseIndependentReview('{"approved":true,"findings":[]}').approved,true);assert.equal(needsIndependentReview([{path:'permissions.js'}]),true);assert.equal(needsIndependentReview([{path:'small.txt',before:Buffer.from('a'),after:Buffer.from('b')}]),false);
});
test('project input changes during final integration make independent review stale',async t=>{
  const mode=await fixture(t,{review:async()=>'{"approved":true,"findings":[]}',execute:async({job,workspace})=>{for(const name of ['a','b','c'])await writeFile(path.join(job.root,name+'.js'),`export const ${name}=2;`);await workspace.verify(job);return {job,text:'Candidate'};}});
  await writeFile(path.join(mode.project,'unowned.js'),'export const value=1;');const integrate=mode.workspace.integrate.bind(mode.workspace);mode.workspace.integrate=async(job,context)=>{await writeFile(path.join(mode.project,'unowned.js'),'export const value=2;');return integrate(job,context);};await start(mode,['a.js','b.js','c.js']);await wait(()=>mode.snapshot().tasks[0]?.status==='error');assert.match(mode.snapshot().tasks[0].detail,/review.*stale|stale.*review/i);assert.equal(await readFile(path.join(mode.project,'a.js'),'utf8'),'export const a=1;');
});
test('mandatory review refuses lossy non-UTF-8 diffs before asking a reviewer',async t=>{
  let reviewed=false;const mode=await fixture(t,{review:async()=>{reviewed=true;return '{"approved":true,"findings":[]}';}}),job=await mode.workspace.prepare('encoding-task','encoding-run',{title:'Encoding edit',objective:'Update source',files:['a.js','b.js','c.js']});
  for(const name of ['a.js','b.js','c.js']){job.baseline.set(name,Buffer.from([0xff,10]));await writeFile(path.join(job.root,name),Buffer.from([0xfe,10]));}
  await assert.rejects(mode.reviewCandidate({job},{current:()=>true}),/valid UTF-8/);assert.equal(reviewed,false);
});
