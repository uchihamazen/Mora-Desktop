import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {assertIdle} from '../src/state.js';
const api=await import('../src/tester.js').catch(()=>({}));
const controller=await import('../src/tester-run.js').catch(()=>({}));
test('tester work prevents project and conversation mutations until it stops',()=>{
  assert.throws(()=>assertIdle({testerActive:true}),/tester|testing/i);
  assert.doesNotThrow(()=>assertIdle({testerActive:false}));
});

test('tester commands preserve ordinary chat and require an explicit solver selection',()=>{
  assert.equal(typeof api.parseTesterCommand,'function');
  assert.equal(api.parseTesterCommand('Explain /tester report'),null);
  assert.deepEqual(api.parseTesterCommand('/tester report Check the cart'),{mode:'report',request:'Check the cart'});
  assert.deepEqual(api.parseTesterCommand('/tester solver BUG-001 Keep design'),{mode:'solver',request:'BUG-001 Keep design'});
  assert.throws(()=>api.parseTesterCommand('/tester solver'),/select|specify/i);
});

test('tester scope rejects remote sites, credentials and unsafe schemes',()=>{
  assert.equal(typeof api.testerURL,'function');
  assert.equal(api.testerURL('http://localhost:3456/cart'),'http://localhost:3456/cart');
  for(const value of ['https://example.com','file:///etc/passwd','http://user:pass@localhost:3456','javascript:alert(1)'])assert.throws(()=>api.testerURL(value));
});

test('report recovery preserves completed cases and pauses an interrupted case without replay',async()=>{
  assert.equal(typeof api.TesterReports,'function');
  const root=await mkdtemp(path.join(tmpdir(),'mora-report-test-')),store=new api.TesterReports(root);
  const report=await store.create({project:root,url:'http://localhost:3456',request:'Test cart',revision:'before'});
  report.status='running';report.cases=[{id:'CASE-001',status:'passed',title:'Valid cart'},{id:'CASE-002',status:'running',title:'Invalid cart'}];
  await store.save(report);const reloaded=await new api.TesterReports(root).load(report.id);
  assert.equal(reloaded.status,'paused');assert.equal(reloaded.cases[0].status,'passed');assert.equal(reloaded.cases[1].status,'not tested');
  assert.throws(()=>store.filename('../outside'),/report/i);
});

test('a passed case requires a recorded successful assertion, failed control is blocked',()=>{
  assert.equal(typeof api.caseOutcome,'function');
  assert.equal(api.caseOutcome({steps:[]},'passed').status,'not tested');
  assert.equal(api.caseOutcome({steps:[{action:{action:'click'},result:{error:'target missing'}}]},'failed').status,'blocked');
  assert.equal(api.caseOutcome({steps:[{action:{action:'assert'},result:{passed:true}}]},'passed').status,'passed');
  assert.equal(api.caseOutcome({steps:[{action:{action:'assert'},result:{passed:false}}]},'passed').status,'suspected');
});

test('confirmation requires replay of the same failed assertion and a matching project revision',()=>{
  assert.equal(typeof api.confirmCase,'function');
  const item={steps:[{action:{action:'assert',text:'Cart (1)',present:true},result:{passed:false}}]};
  assert.equal(api.confirmCase(item,[{action:{action:'assert',text:'Cart (0)',present:true},result:{passed:false}}],'x','x'),'suspected');
  assert.equal(api.confirmCase(item,item.steps,'x','y'),'stale');
  assert.equal(api.confirmCase(item,item.steps,'x','x'),'confirmed');
  assert.equal(api.confirmCase(item,[{...item.steps[0],result:{passed:true}}],'x','x'),'not reproduced');
});

test('report saves are atomic and leave no partial readable report when inputs are invalid',async()=>{
  assert.equal(typeof api.TesterReports,'function');
  const root=await mkdtemp(path.join(tmpdir(),'mora-report-test-')),store=new api.TesterReports(root);
  const report=await store.create({project:root,url:'http://localhost:3456',request:'Test',revision:'r1'});
  const before=await readFile(store.filename(report.id),'utf8');
  await assert.rejects(store.save({...report,id:'../../escape'}),/report/i);
  assert.equal(await readFile(store.filename(report.id),'utf8'),before);
  await writeFile(store.filename(report.id),'broken');
  const recovered=await store.load(report.id);assert.equal(recovered.id,report.id);
});

test('report runner persists a plan and never passes cases the model did not execute',async()=>{
  assert.equal(typeof controller.TesterRun,'function');
  const root=await mkdtemp(path.join(tmpdir(),'mora-run-test-')),store=new api.TesterReports(root),report=await store.create({project:root,url:'http://localhost:3456',request:'Test',revision:'r1'});
  const decisions=[{action:'plan',cases:[{title:'Valid cart',expected:'Cart increments'},{title:'Invalid quantity',expected:'Reject zero'}]},{action:'finish',note:'Budget ended'}];
  const run=new controller.TesterRun({store,revision:async()=> 'r1',makeModel:()=>({initialize:async()=>{},decide:async()=>decisions.shift(),stop:async()=>{},close:async()=>{}}),makeBrowser:()=>({open:async()=>{},snapshot:async()=>({text:'Cart'}),close:async()=>{}})});
  await run.start(report);const saved=await store.load(report.id);
  assert.deepEqual(saved.cases.map(c=>c.status),['not tested','not tested']);assert.equal(saved.issues.length,0);assert.equal(saved.status,'completed');
});

test('stop while awaiting a model decision prevents the later action from being executed',async()=>{
  assert.equal(typeof controller.TesterRun,'function');
  const root=await mkdtemp(path.join(tmpdir(),'mora-stop-test-')),store=new api.TesterReports(root),report=await store.create({project:root,url:'http://localhost:3456',request:'Test',revision:'r1'});
  let release,started;const waiting=new Promise(resolve=>started=resolve),decision=new Promise(resolve=>release=resolve);let clicks=0;
  const run=new controller.TesterRun({store,revision:async()=> 'r1',makeModel:()=>({initialize:async()=>{},decide:async()=>{started();return decision;},stop:async()=>release({action:'click',target:'Submit'}),close:async()=>{}}),makeBrowser:()=>({open:async()=>{},snapshot:async()=>({text:'Page'}),perform:async()=>{clicks++;return {ok:true};},close:async()=>{}})});
  const work=run.start(report);await waiting;await run.stop();await work;
  assert.equal(clicks,0);assert.equal((await store.load(report.id)).status,'paused');
});

test('a changed project blocks report resume before browser actions or native work',async()=>{
  assert.equal(typeof controller.TesterRun,'function');
  const root=await mkdtemp(path.join(tmpdir(),'mora-stale-test-')),store=new api.TesterReports(root),report=await store.create({project:root,url:'http://localhost:3456',request:'Test',revision:'r1'});
  const run=new controller.TesterRun({store,revision:async()=> 'r2',makeModel:()=>{throw Error('Must not launch');},makeBrowser:()=>{throw Error('Must not launch');}});
  await assert.rejects(run.start(report),/changed|revision/i);assert.equal((await store.load(report.id)).cases.length,0);
});

test('repeated plans cannot duplicate cases or bypass the decision budget',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mora-plan-test-')),store=new api.TesterReports(root),report=await store.create({project:root,url:'http://localhost:3456',request:'Test',revision:'r1'});
  let decisions=0;
  const run=new controller.TesterRun({store,maxDecisions:3,revision:async()=> 'r1',makeModel:()=>({initialize:async()=>{},decide:async()=>{if(++decisions>4)throw Error('Unbounded loop');return {action:'plan',cases:[{title:'Cart',expected:'Adds product'}]};},close:async()=>{}}),makeBrowser:()=>({open:async()=>{},snapshot:async()=>({}),close:async()=>{}})});
  await run.start(report);assert.equal(report.cases.length,1);assert.equal(decisions,3);assert.equal(report.status,'paused');
});

test('a source change during execution invalidates the finished report',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mora-change-test-')),store=new api.TesterReports(root),report=await store.create({project:root,url:'http://localhost:3456',request:'Test',revision:'r1'});
  let reads=0;
  const run=new controller.TesterRun({store,revision:async()=> ++reads===1?'r1':'r2',makeModel:()=>({initialize:async()=>{},decide:async()=>({action:'finish'}),close:async()=>{}}),makeBrowser:()=>({open:async()=>{},snapshot:async()=>({}),close:async()=>{}})});
  await run.start(report);assert.equal(report.status,'stale');
});
