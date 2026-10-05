import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {MoraMode} from '../src/mora-mode.js';
import {browserPlan} from '../src/mora-browser.js';
import {gradeWorkload} from './fixtures/mora-workloads/grader.js';
import {firstObservedFailure} from '../scripts/mora-workload-benchmark.js';

const shop=fileURLToPath(new URL('./fixtures/mora-workloads/shop/',import.meta.url));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){const deadline=Date.now()+20000;while(Date.now()<deadline){if(await predicate())return;await pause(15);}throw Error('Workload state did not settle.');}
const description=(key,files,dependsOn=[])=>JSON.stringify({key,title:key,objective:'Preserve existing app behavior and implement the assigned source update.',files,dependsOn});
async function start(mode,key,files,dependsOn=[]){const thread=await mode.backend.createThread();return mode.backend.createRun(thread.thread_id,{assistant_id:'mora-worker',input:{messages:[{role:'user',content:description(key,files,dependsOn)}]}});}
function run(mode,job){return mode.backend.run(mode.backend.thread(job.thread_id),job.run_id);}
async function fixture(t,options={}){
  const root=await mkdtemp(path.join(tmpdir(),'mora-workload-')),profile=path.join(root,'profile'),project=path.join(root,'project');
  await cp(shop,project,{recursive:true});await mkdir(profile);
  // The lifecycle suite isolates controller/source behavior; browser outcomes have a separate native grader.
  for(const name of ['index.html','app.js','server.js','.mora'])await rm(path.join(project,name),{recursive:true,force:true});
  await writeFile(path.join(project,'package.json'),JSON.stringify({private:true,type:'module',scripts:{test:'node --test tests/original.test.js'}}));
  const mode=new MoraMode({profile,project,sessionId:'workload-chat',options:{executionMode:'full'},...options});await mode.open();
  t.after(async()=>{await mode.close();await until(()=>mode.backend.active.size===0);await rm(root,{recursive:true,force:true});});return mode;
}

test('benchmark failure receipts choose earliest observed event across concurrent workers',()=>{
  const lateCheck={name:'sibling source failure',elapsedMs:800},earlyWorker={name:'provider failure',elapsedMs:300},unmeasured={name:'final outcome'};
  assert.equal(firstObservedFailure([lateCheck,unmeasured,earlyWorker]),earlyWorker);assert.equal(firstObservedFailure([]),null);
});

test('external workload grader rejects baseline capability gaps while baseline app still works',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'mora-grader-'));t.after(()=>rm(root,{recursive:true,force:true}));await cp(shop,root,{recursive:true});
  assert.equal(browserPlan(await readFile(path.join(root,'.mora/verification.json'))).steps.length,3);
  const grade=await gradeWorkload(root);assert.equal(grade.passed,false);assert.equal(grade.checks.length,5);assert.ok(grade.checks.every(check=>!check.passed));
  const {checkout}=await import(pathToFileURL(path.join(root,'checkout.js')));assert.equal(checkout([{price:60,quantity:1}],'Cairo').total,95);
});

test('three occupied workers allow durable fourth admission and a completed chat answer before delivery',async t=>{
  const gates=new Map(),observed=[];let active=0,peak=0;
  const mode=await fixture(t,{decide:async()=>({message:'The cart and delivery workers are still running.',tool_calls:[]}),execute:async context=>{
    active++;peak=Math.max(peak,active);observed.push(context.job.task.key);await new Promise(resolve=>gates.set(context.job.task.key,resolve));
    try{const file=context.job.task.files[0];await writeFile(path.join(context.job.root,file),(await readFile(path.join(context.job.root,file),'utf8'))+`\n// ${context.job.task.key} verified\n`);await context.workspace.verify(context.job,{signal:context.signal});return {job:context.job,text:'Source updated'};}finally{active--;}
  }});await mode.enable(true);
  const original=await readFile(path.join(mode.project,'tests/original.test.js'),'utf8');
  const jobs=[];for(const [key,file] of [['catalog','catalog.js'],['basket','basket.js'],['delivery','delivery.js']])jobs.push(await start(mode,key,[file]));
  await until(()=>gates.size===3);const queued=await start(mode,'checkout',['checkout.js']);assert.equal(run(mode,queued).status,'pending');
  const saved=JSON.parse(await readFile(path.join(mode.backend.directory,'tasks.json'),'utf8'));assert.equal(saved.threads[queued.thread_id].currentRunId,queued.run_id);
  await mode.send('Which workers are running?');await until(()=>mode.state.requests[0].status==='success'&&!mode.replying);
  assert.ok(mode.state.items.some(item=>item.text==='The cart and delivery workers are still running.'));assert.equal(observed.includes('checkout'),false);assert.equal(mode.backend.active.size,3);
  gates.get('basket')();await until(()=>gates.has('checkout'));for(const key of ['catalog','delivery','checkout'])gates.get(key)();
  await until(()=>[...jobs,queued].every(job=>run(mode,job).status==='success'));assert.equal(peak,3);
  for(const [key,file] of [['catalog','catalog.js'],['basket','basket.js'],['delivery','delivery.js'],['checkout','checkout.js']])assert.match(await readFile(path.join(mode.project,file),'utf8'),new RegExp(`${key} verified`));
  assert.equal(await readFile(path.join(mode.project,'tests/original.test.js'),'utf8'),original);
});

test('dependent checkout starts only after source integration and observes the integrated contract',async t=>{
  let release;const observed=[];
  const mode=await fixture(t,{execute:async context=>{
    const key=context.job.task.key;observed.push({key,basket:await readFile(path.join(context.job.root,'basket.js'),'utf8')});
    if(key==='basket-contract')await new Promise(resolve=>release=resolve);
    const file=context.job.task.files[0];await writeFile(path.join(context.job.root,file),(await readFile(path.join(context.job.root,file),'utf8'))+`\n// ${key} integrated\n`);
    await context.workspace.verify(context.job,{signal:context.signal});return {job:context.job,text:'Checked'};
  }});
  const first=await start(mode,'basket-contract',['basket.js']);await until(()=>release);
  const second=await start(mode,'checkout-adapter',['checkout.js'],['basket-contract']);assert.equal(run(mode,second).status,'pending');assert.equal(observed.length,1);
  release();await until(()=>run(mode,second).status==='success');assert.equal(run(mode,first).status,'success');assert.match(observed[1].basket,/basket-contract integrated/);
});

test('steering supersedes a late verified candidate and cancellation preserves a sibling worker',async t=>{
  const contexts=new Map(),gates=new Map();
  const mode=await fixture(t,{execute:async context=>{contexts.set(context.runId,context);await new Promise(resolve=>gates.set(context.runId,resolve));const file=context.job.task.files[0];await writeFile(path.join(context.job.root,file),(await readFile(path.join(context.job.root,file),'utf8'))+`\n// ${context.messages.at(-1).content.includes('Use updated')?'updated':'obsolete'}\n`);await context.workspace.verify(context.job);return {job:context.job,text:'Verified candidate'};}});
  const old=await start(mode,'catalog-update',['catalog.js']),sibling=await start(mode,'basket-sibling',['basket.js']);await until(()=>gates.has(old.run_id)&&gates.has(sibling.run_id));
  await mode.command('steer',{id:old.thread_id,message:'Use updated catalog requirements; preserve all original behavior.'});
  const replacement=mode.backend.thread(old.thread_id).currentRunId;assert.notEqual(replacement,old.run_id);assert.equal(contexts.get(old.run_id).signal.aborted,true);
  await until(()=>gates.has(replacement));gates.get(old.run_id)();gates.get(replacement)();await until(()=>mode.backend.run(mode.backend.thread(old.thread_id),replacement).status==='success');
  const catalog=await readFile(path.join(mode.project,'catalog.js'),'utf8');assert.match(catalog,/updated/);assert.doesNotMatch(catalog,/obsolete/);
  await mode.command('cancel',{id:sibling.thread_id});assert.equal(run(mode,sibling).status,'cancelled');gates.get(sibling.run_id)();await until(()=>mode.backend.active.size===0);
  assert.doesNotMatch(await readFile(path.join(mode.project,'basket.js'),'utf8'),/obsolete/);assert.equal(run(mode,old).status,'interrupted');
});

test('worker provider failure blocks its dependency while chat requests survive coordinator failure and explicit retry',async t=>{
  let failQuestion=true;const started=[];
  const mode=await fixture(t,{execute:async context=>{started.push(context.job.task.key);if(context.job.task.key==='unavailable-provider')throw Error('Provider unavailable before edits');throw Error('Blocked dependency unexpectedly executed');},decide:async()=>{if(failQuestion)throw Error('Coordinator provider temporarily unavailable');return {message:'Your saved worker failure is visible; no changes were applied.',tool_calls:[]};}});await mode.enable(true);
  const first=await start(mode,'unavailable-provider',['basket.js']);await until(()=>run(mode,first).status==='error');const second=await start(mode,'blocked-checkout',['checkout.js'],['unavailable-provider']);
  await mode.send('Did my changes apply?');await until(()=>!mode.replying&&mode.state.requests[0].status==='error');const id=mode.state.requests[0].id;assert.equal(run(mode,second).status,'pending');assert.deepEqual(started,['unavailable-provider']);
  const saved=JSON.parse(await readFile(path.join(mode.directory,'conversation.json'),'utf8'));assert.equal(saved.requests[0].text,'Did my changes apply?');failQuestion=false;await mode.command('resume-request',{id});await until(()=>!mode.replying&&mode.state.requests[0].status==='success');
  assert.equal(mode.state.requests.length,1);assert.equal(mode.snapshot().tasks.length,2);assert.equal(mode.state.items.filter(item=>item.itemId==='mora-reply-'+id).length,1);
  await mode.command('cancel',{id:second.thread_id});
});

test('restart retains three active and one dependent task without replaying or applying late results',async t=>{
  const gates=[];const mode=await fixture(t,{execute:async context=>{await new Promise(resolve=>{gates.push(resolve);context.signal.addEventListener('abort',resolve,{once:true});});await writeFile(path.join(context.job.root,context.job.task.files[0]),'export const stale = true;');return {job:context.job,text:'Late'};}});
  const jobs=[];for(const [key,file] of [['catalog','catalog.js'],['basket','basket.js'],['delivery','delivery.js']])jobs.push(await start(mode,key,[file]));await until(()=>gates.length===3);await start(mode,'dependent-checkout',['checkout.js'],['basket']);await mode.close();for(const release of gates)release();await until(()=>mode.backend.active.size===0);
  let executions=0;const recovered=new MoraMode({profile:mode.profile,project:mode.project,sessionId:mode.sessionId,execute:async()=>{executions++;throw Error('Unexpected replay');}});await recovered.open();
  assert.equal(recovered.snapshot().tasks.length,4);assert.ok(recovered.snapshot().tasks.every(task=>task.status==='interrupted'));assert.equal(executions,0);assert.equal(recovered.backend.active.size,0);assert.match(await readFile(path.join(mode.project,'catalog.js'),'utf8'),/searchProducts/);await recovered.close();
});
