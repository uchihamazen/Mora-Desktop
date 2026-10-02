import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {TesterReports,projectRevision} from '../src/tester.js';
import {Checkpoints} from '../src/checkpoints.js';
const {TesterSolver}=await import('../src/tester-solver.js').catch(()=>({}));
async function fixture({reproduces=true,weaken=false}={}){
  const root=await mkdtemp(path.join(tmpdir(),'mora-solver-')),profile=await mkdtemp(path.join(tmpdir(),'mora-solver-profile-'));
  await writeFile(path.join(root,'app.js'),'broken');await writeFile(path.join(root,'app.test.js'),'unchanged assertion');
  const store=new TesterReports(profile),report=await store.create({project:root,url:'http://localhost:3500',request:'Add works',revision:await projectRevision(root)});
  report.status='completed';report.cases=[{id:'CASE-001',title:'Add',expected:'Added',status:'confirmed',steps:[{action:{action:'assert',check:'text',expected:'Added'},result:{passed:false}}]}];report.issues=[{id:'BUG-001',caseId:'CASE-001',status:'confirmed',revision:report.revision}];await store.save(report);
  let edits=0;
  const options={store,checkpoints:new Checkpoints(profile,root),makeBrowser:()=>({open:async()=>{},reset:async()=>{},close:async()=>{},perform:async()=>({passed:!reproduces||(await readFile(path.join(root,'app.js'),'utf8'))==='fixed'})}),makeRepair:()=>({initialize:async()=>{},repair:async()=>{edits++;await writeFile(path.join(root,weaken?'app.test.js':'app.js'),weaken?'weakened':'fixed');},close:async()=>{}}),restart:async()=>{},checks:async()=>({status:'passed'}),stopChecks:async()=>{}};
  return {root,report,options,edits:()=>edits};
}
test('solver reproduces, checkpoints, replays unchanged assertions and keeps a recoverable fix',async()=>{
  assert.equal(typeof TesterSolver,'function');const f=await fixture(),run=new TesterSolver(f.options);await run.start(f.report,['BUG-001']);
  assert.equal(f.report.issues[0].status,'fixed');assert.equal(f.report.solver.status,'verified');assert.equal(f.report.cases[0].steps[0].action.expected,'Added');
  const cp=await f.options.checkpoints.load(f.report.solver.checkpoint);assert.equal(Buffer.from(cp.files['app.js'],'base64').toString(),'broken');assert.equal(cp.sealed,true);
});
test('unreproduced findings and stale source cannot trigger edits',async()=>{
  assert.equal(typeof TesterSolver,'function');const f=await fixture({reproduces:false});await new TesterSolver(f.options).start(f.report,['BUG-001']);assert.equal(f.edits(),0);assert.equal(f.report.issues[0].status,'not reproduced');
  const g=await fixture();await writeFile(path.join(g.root,'app.js'),'other edit');await assert.rejects(new TesterSolver(g.options).start(g.report,['BUG-001']),/changed|stale/i);assert.equal(g.edits(),0);
});
test('changing the original tests never produces a verified repair',async()=>{
  assert.equal(typeof TesterSolver,'function');const f=await fixture({weaken:true});await new TesterSolver(f.options).start(f.report,['BUG-001']);assert.equal(f.report.solver.status,'unverified');assert.notEqual(f.report.issues[0].status,'fixed');assert.match(f.report.solver.message,/tests|requirements/i);
});
