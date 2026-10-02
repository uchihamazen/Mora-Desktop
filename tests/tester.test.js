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

test('interrupted reproduction resumes its original assertion without asking the model to invent a new case',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mora-replay-test-')),store=new api.TesterReports(root),report=await store.create({project:root,url:'http://localhost:3456',request:'Adding changes count to 1',revision:'r1'});
 const action={action:'assert',check:'text',expected:'1',present:true};report.status='reproducing';report.cases=[{id:'CASE-001',title:'Count',expected:'1',status:'suspected',steps:[{action,result:{passed:false}}]}];await store.save(report);let replays=0;
 const run=new controller.TesterRun({store,revision:async()=> 'r1',makeModel:()=>({initialize:async()=>{},assessExpected:async()=>({supported:true,basis:'Adding changes count to 1'}),decide:async()=>({action:'finish'}),close:async()=>{}}),makeBrowser:()=>({open:async()=>{},reset:async()=>{},snapshot:async()=>({}),perform:async actual=>{assert.deepEqual(actual,action);replays++;return {passed:false};},close:async()=>{}})});
 const loaded=await store.load(report.id);await run.start(loaded);assert.equal(replays,1);assert.equal(loaded.issues.length,1);assert.equal(loaded.cases[0].steps[0].action.expected,'1');
});

test('a reproducible assertion with an unsupported expectation never becomes solver eligible',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mora-ground-test-')),store=new api.TesterReports(root),report=await store.create({project:root,url:'http://localhost:3456',request:'Search existing products',revision:'r1'});
 report.cases=[{id:'CASE-001',title:'Search pen',expected:'Pen exists',status:'suspected',steps:[{action:{action:'assert',check:'text',expected:'Pen'},result:{passed:false}}]}];
 const run=new controller.TesterRun({store,revision:async()=> 'r1',makeModel:()=>({initialize:async()=>{},assessExpected:async()=>({supported:false,basis:'No requirement or setup says a Pen exists'}),decide:async()=>({action:'finish'}),close:async()=>{}}),makeBrowser:()=>({open:async()=>{},reset:async()=>{},snapshot:async()=>({}),perform:async()=>({passed:false}),close:async()=>{}})});
 await run.start(report);assert.equal(report.cases[0].status,'unsupported expectation');assert.equal(report.issues.length,0);assert.match(report.cases[0].grounding.basis,/No requirement/);
});

test('saved repair results become historical when restored source no longer matches their verified revision',async()=>{
 assert.equal(typeof api.reportForRevision,'function');const report={status:'completed',revision:'before',cases:[],issues:[{id:'BUG-001',status:'fixed'}],solver:{status:'verified',revision:'after'}};
 const historical=api.reportForRevision(report,'before');assert.equal(historical.status,'stale');assert.equal(historical.issues[0].status,'fixed');assert.equal(report.status,'completed');
 assert.equal(api.reportForRevision(report,'after').status,'completed');
});

for(const passed of [true,false])test(`a fully ${passed?'passed':'confirmed'} plan finishes without another model decision`,async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mora-finish-test-')),store=new api.TesterReports(root),report=await store.create({project:root,url:'http://localhost:3456',request:'Counter must show 1',revision:'r1'});
 const decisions=[{action:'plan',cases:[{title:'Counter',expected:'Shows 1'}]},{action:'begin',caseId:'CASE-001'},{action:'assert',check:'text',expected:'1'},...(passed?[{action:'finish_case',caseId:'CASE-001',text:'passed'}]:[])];
 const expectedCalls=decisions.length;let calls=0;
 const run=new controller.TesterRun({store,maxDecisions:8,revision:async()=> 'r1',makeModel:()=>({initialize:async()=>{},decide:async()=>{calls++;return decisions.shift()||{action:'begin',caseId:'CASE-001'};},assessExpected:async()=>({supported:true,basis:'User requires 1'}),close:async()=>{}}),makeBrowser:()=>({open:async()=>{},reset:async()=>{},snapshot:async()=>({}),perform:async()=>({passed}),close:async()=>{}})});
 await run.start(report);assert.equal(report.status,'completed');assert.equal(calls,expectedCalls);assert.equal(report.cases[0].status,passed?'passed':'confirmed');assert.equal(report.issues.length,passed?0:1);
});
