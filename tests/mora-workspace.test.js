import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MoraWorkspace,validateMoraTask,overlappingFiles} from '../src/mora-workspace.js';

async function fixture(){const profile=await mkdtemp(path.join(tmpdir(),'mora-workspaces-')),project=path.join(profile,'project');await mkdir(project);await mkdir(path.join(project,'tests'));await writeFile(path.join(project,'a.js'),'export const value=1;\n');await writeFile(path.join(project,'b.js'),'export const other=2;\n');await writeFile(path.join(project,'tests','app.test.js'),"import test from 'node:test';import assert from 'node:assert/strict';import {value} from '../a.js';test('positive',()=>assert.ok(value>0));");await writeFile(path.join(project,'package.json'),JSON.stringify({type:'module',scripts:{test:'node --test'}}));return {profile,project,workspace:new MoraWorkspace(profile,project)};}

test('tasks validate concrete ownership, dependencies and private path boundaries',()=>{
  assert.deepEqual(validateMoraTask(JSON.stringify({title:'Fix',objective:'Change a',files:['a.js'],dependsOn:[]})).files,['a.js']);
  for(const files of [['../outside'],['.env'],['node_modules/x.js'],['C:/outside'],['src/**/bad'],[]])assert.throws(()=>validateMoraTask(JSON.stringify({title:'Fix',objective:'x',files})));
  assert.equal(overlappingFiles(['src/**'],['src/file.js']),true);assert.equal(overlappingFiles(['a.js'],['b.js']),false);assert.equal(overlappingFiles(['*'],['b.js']),true);
});

test('isolated edits cannot touch the project until checks pass; successful integration retains a checkpoint',async()=>{
  const {workspace,project}=await fixture(),job=await workspace.prepare('job','run',validateMoraTask(JSON.stringify({title:'Fix',objective:'Improve value',files:['a.js']})));
  await writeFile(path.join(job.root,'a.js'),'export const value=3;\n');assert.match(await readFile(path.join(project,'a.js'),'utf8'),/=1/);
  const verified=await workspace.verify(job);assert.equal(verified.passed,true);
  const result=await workspace.integrate(job,{current:()=>true});assert.equal(result.files.length,1);assert.ok(result.checkpointId);assert.match(await readFile(path.join(project,'a.js'),'utf8'),/=3/);
});

test('failed original tests, unowned writes and newly added user files refuse integration',async()=>{
  const {workspace,project}=await fixture(),task=validateMoraTask(JSON.stringify({title:'Fix',objective:'x',files:['a.js','new.js']}));
  let job=await workspace.prepare('job','failed',task);await writeFile(path.join(job.root,'a.js'),'export const value=-1;\n');assert.equal((await workspace.verify(job)).passed,false);await assert.rejects(workspace.integrate(job,{current:()=>true}),/checks/i);assert.match(await readFile(path.join(project,'a.js'),'utf8'),/=1/);
  job=await workspace.prepare('job','unowned',task);await writeFile(path.join(job.root,'b.js'),'export const other=99;\n');await assert.rejects(workspace.verify(job),/ownership/i);
  job=await workspace.prepare('job','added',task);await writeFile(path.join(job.root,'new.js'),'export const fresh=1;\n');await writeFile(path.join(project,'new.js'),'user content');await workspace.verify(job);await assert.rejects(workspace.integrate(job,{current:()=>true}),/changed/i);assert.equal(await readFile(path.join(project,'new.js'),'utf8'),'user content');
});

test('user edits, cancellation and changed original tests cannot produce a green delivery',async()=>{
  const {workspace,project}=await fixture(),task=validateMoraTask(JSON.stringify({title:'Fix',objective:'x',files:['a.js','tests/app.test.js']}));
  let job=await workspace.prepare('job','stale',task);await writeFile(path.join(job.root,'a.js'),'export const value=3;\n');await workspace.verify(job);await writeFile(path.join(project,'a.js'),'export const value=10;\n');await assert.rejects(workspace.integrate(job,{current:()=>true}),/changed/i);assert.match(await readFile(path.join(project,'a.js'),'utf8'),/=10/);
  job=await workspace.prepare('job','cancelled',task);await writeFile(path.join(job.root,'a.js'),'export const value=4;\n');await workspace.verify(job);await assert.rejects(workspace.integrate(job,{current:()=>false}),/superseded|stopped/i);
  job=await workspace.prepare('job','bypass',task);await writeFile(path.join(job.root,'a.js'),'export const value=-1;\n');await writeFile(path.join(job.root,'tests','app.test.js'),"import test from 'node:test';test('always green',()=>{});");assert.equal((await workspace.verify(job)).passed,false,'Original tests still run against the changed source');
});
test('integration rechecks changed inputs and refuses a now-invalid combination',async()=>{
  const profile=await mkdtemp(path.join(tmpdir(),'mora-inputs-')),project=path.join(profile,'project');await mkdir(project);await writeFile(path.join(project,'a.js'),'export const a=1;');await writeFile(path.join(project,'b.js'),'export const b=1;');await writeFile(path.join(project,'sum.test.js'),"import test from 'node:test';import assert from 'node:assert/strict';import {a} from './a.js';import {b} from './b.js';test('compatible',()=>assert.equal(a+b,3));");
  const workspace=new MoraWorkspace(profile,project),job=await workspace.prepare('task','run',{title:'Update a',files:['a.js']});await writeFile(path.join(job.root,'a.js'),'export const a=2;');assert.equal((await workspace.verify(job)).passed,true);await writeFile(path.join(project,'b.js'),'export const b=5;');await assert.rejects(workspace.integrate(job,{current:()=>true}),/newer project inputs/);assert.equal(await readFile(path.join(project,'a.js'),'utf8'),'export const a=1;');assert.equal(await readFile(path.join(project,'b.js'),'utf8'),'export const b=5;');
});
test('candidate tests cannot rewrite assigned source after original regressions passed',async()=>{
 const profile=await mkdtemp(path.join(tmpdir(),'mora-test-writes-')),project=path.join(profile,'project');await mkdir(project);await writeFile(path.join(project,'a.js'),'export const value=1;');await writeFile(path.join(project,'a.test.js'),"import test from 'node:test';import assert from 'node:assert/strict';import {value} from './a.js';test('positive',()=>assert.ok(value>0));");const workspace=new MoraWorkspace(profile,project),job=await workspace.prepare('task','run',{title:'Candidate',files:['a.js','a.test.js']});await writeFile(path.join(job.root,'a.js'),'export const value=2;');await writeFile(path.join(job.root,'a.test.js'),"import test from 'node:test';import {writeFileSync} from 'node:fs';test('tamper',()=>writeFileSync(new URL('./a.js',import.meta.url),'export const value=-1;'));");const verification=await workspace.verify(job);assert.equal(verification.passed,false);assert.match(verification.checks.find(check=>check.name==='Current tests').output,/Access to this API has been restricted|ERR_ACCESS_DENIED/);assert.equal(await readFile(path.join(job.root,'a.js'),'utf8'),'export const value=2;');await assert.rejects(workspace.integrate(job,{current:()=>true}),/checks must pass/);
});

test('cancellation during sealing rolls back edits before returning a result',async()=>{
 const profile=await mkdtemp(path.join(tmpdir(),'mora-seal-stop-')),project=path.join(profile,'project');await mkdir(project);await writeFile(path.join(project,'a.js'),'export const value=1;');const workspace=new MoraWorkspace(profile,project),job=await workspace.prepare('task','run',{title:'Candidate',files:['a.js']});await writeFile(path.join(job.root,'a.js'),'export const value=2;');await workspace.verify(job);let release,entered;const waiting=new Promise(resolve=>entered=resolve);workspace.checkpoints.seal=async()=>{entered();await new Promise(resolve=>release=resolve);};const controller=new AbortController(),applying=workspace.integrate(job,{current:()=>!controller.signal.aborted,signal:controller.signal});await waiting;controller.abort();release();await assert.rejects(applying,/stopped during integration/);assert.equal(await readFile(path.join(project,'a.js'),'utf8'),'export const value=1;');
});
test('verification also refuses source mutation by a test runner that reports success',async()=>{
 const profile=await mkdtemp(path.join(tmpdir(),'mora-runner-mutation-')),project=path.join(profile,'project');await mkdir(project);await writeFile(path.join(project,'a.js'),'export const value=1;');await writeFile(path.join(project,'a.test.js'),"import test from 'node:test';test('sample',()=>{});");const workspace=new MoraWorkspace(profile,project),job=await workspace.prepare('task','run',{title:'Candidate',files:['a.js']});await writeFile(path.join(job.root,'a.js'),'export const value=2;');const original=workspace.runNode.bind(workspace);let calls=0;workspace.runNode=async(job,args,options)=>{if(!args.includes('--test'))return original(job,args,options);if(++calls===2)await writeFile(path.join(job.root,'a.js'),'export const value=-1;');return {passed:true,output:'Runner reported success'};};const result=await workspace.verify(job);assert.equal(result.passed,false);assert.match(result.checks.find(check=>check.name==='Current tests').output,/Source changed while tests ran/);await assert.rejects(workspace.integrate(job,{current:()=>true}),/checks must pass/);assert.equal(await readFile(path.join(project,'a.js'),'utf8'),'export const value=1;');
});

test('an empty discovered Node suite cannot greenlight source changes',async()=>{
 const profile=await mkdtemp(path.join(tmpdir(),'mora-empty-node-')),project=path.join(profile,'project');await mkdir(project);await writeFile(path.join(project,'a.js'),'export const value=1;');await writeFile(path.join(project,'a.test.js'),"import {describe} from 'node:test';describe('empty',()=>{});");const workspace=new MoraWorkspace(profile,project),job=await workspace.prepare('task','run',{title:'Candidate',files:['a.js']});await writeFile(path.join(job.root,'a.js'),'export const value=2;');const result=await workspace.verify(job);assert.equal(result.passed,false);assert.ok(result.checks.filter(check=>/tests/.test(check.name)).every(check=>!check.passed&&/No tests executed/.test(check.output)));await assert.rejects(workspace.integrate(job,{current:()=>true}),/checks/i);
});
