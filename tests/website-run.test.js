import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {WebsiteReports} from '../src/website-tester.js';
const api=await import('../src/website-run.js').catch(()=>({}));
async function setup(decisions){
 const store=new WebsiteReports(await mkdtemp(path.join(tmpdir(),'website-run-'))),performed=[];
 const browser={closed:false,manual:true,scope:null,policy:{version:1,grants:[]},async open(scope){this.scope=scope;this.policy.scope=scope;},async observe(){return this.observation={id:'o',url:this.scope.entryUrl,roleId:scopeRole(this),visibleText:'Ready',controls:[{id:'e1',name:'Save',tag:'button',type:'button'}]};},grant(fp){this.policy.grants.push(fp);},async perform(step){performed.push(step);return {status:step.action==='assert'?'passed':'ok'};},async takeOver(){this.manual=true;},async close(){this.closed=true;}};
 const observer={initialize:async()=>{},decide:async()=>decisions.shift()||{action:'finish',note:'done'},stop:async()=>{},close:async()=>{}};
 const run=new api.WebsiteRun({store,makeBrowser:()=>browser,makeModel:()=>observer,onChange:()=>{}});await run.open({url:'https://site.example',request:'Saving shows Ready'});return {run,browser,performed};
}
const scopeRole=browser=>browser.scope.roleId;
test('website run completes checks without project source and clicks are not passes',async()=>{
 const {run,performed}=await setup([{action:'assert',observationId:'o',target:'',value:'',check:'text',expected:'Ready',basis:'Saving shows Ready',note:''},{action:'finish',note:'done'}]);
 await run.start();await run.completion;assert.equal(run.report.status,'done');assert.equal(run.report.steps[0].result.status,'passed');assert.equal(performed.length,1);assert.equal('project' in run.report,false);
});
test('a website action waits for the exact user permission and Stop prevents late execution',async()=>{
 const {run,performed}=await setup([{action:'click',observationId:'o',target:'e1',note:''}]);await run.start();
 const until=Date.now()+1000;while(run.report.status!=='awaiting permission'&&Date.now()<until)await new Promise(r=>setTimeout(r,5));assert.equal(run.report.status,'awaiting permission');
 assert.equal(performed.length,0);const id=run.report.pending.id;await assert.rejects(run.approve('wrong',true),/permission/i);
 await run.stop();await assert.rejects(run.approve(id,true),/permission/i);assert.equal(performed.length,0);
});
test('restarting a check does not overlap a pending model decision after takeover',async()=>{
 const {run}=await setup([]);let resolve;run.makeModel=()=>({initialize:async()=>{},decide:()=>new Promise(r=>{resolve=r;}),stop:async()=>{resolve?.({action:'finish'});},close:async()=>{}});
 await run.start();const until=Date.now()+1000;while(!resolve&&Date.now()<until)await new Promise(r=>setTimeout(r,5));await run.pause();assert.equal(run.report.status,'manual');assert.equal(run.report.steps.length,0);await run.stop();
});
test('Stop during report creation prevents a later browser launch',async()=>{
 let resolve,launched=0;const report={id:'test',kind:'website',status:'ready',steps:[],scope:{}};
 const run=new api.WebsiteRun({store:{create:()=>new Promise(r=>{resolve=r;}),save:async()=>{},directory:'unused',loadLogin:async()=>{}},makeBrowser:()=>({open:async()=>{launched++;},close:async()=>{}}),makeModel:()=>{},onChange:()=>{}});
 const opening=run.open({url:'https://site.example'});await run.stop();resolve(report);await opening;assert.equal(launched,0);assert.equal(run.report.status,'stopped');
});

test('Stop leaves an in-flight mutation uncertain even if the browser returns ok',async()=>{
 const {run,browser}=await setup([{action:'click',observationId:'o',target:'e1'}]);let release;
 browser.perform=()=>new Promise(r=>{release=r;});browser.close=async()=>{browser.closed=true;release?.({status:'ok'});};
 await run.start();while(!run.report.pending)await new Promise(r=>setTimeout(r,5));await run.approve(run.report.pending.id,true);
 while(!release)await new Promise(r=>setTimeout(r,5));await run.stop();
 assert.equal(run.report.steps[0].status,'uncertain');assert.notEqual(run.report.steps[0].result?.status,'ok');assert.equal(run.report.status,'stopped');
});

const plannedCase=()=>({title:'Save shows Ready',feature:'Save',family:'normal',basisSource:'user',basisQuote:'Saving shows Ready',precondition:'Ready',steps:[{action:'click',target:'Save'},{action:'assert',check:'text',expected:'Ready'}],reset:[]});
test('one explicit case permission executes a short locally checked sequence',async()=>{
 const {run,performed}=await setup([{action:'plan',cases:[plannedCase()]},{action:'finish',note:'done'}]);let permissions=0;
 run.onChange=report=>{if(report.pending&&run.pending){permissions++;assert.equal(report.pending.kind,'case');setImmediate(()=>run.approve(report.pending.id,true));}};
 await run.start();await run.completion;assert.equal(run.report.status,'done');assert.equal(permissions,1);assert.deepEqual(performed.map(s=>s.action),['click','assert']);assert.equal(run.report.cases[0].status,'passed');
});
test('reproduction asks again and retains the original assertion from the same state',async()=>{
 const {run,browser}=await setup([{action:'plan',cases:[plannedCase()]},{action:'review',supported:true,note:'Explicit user requirement'},{action:'finish'}]);let permissions=0;
 browser.perform=async step=>({status:step.action==='assert'?'failed':'ok',actual:false});
 run.onChange=report=>{if(report.pending&&run.pending){permissions++;setImmediate(()=>run.approve(report.pending.id,true));}};
 await run.start();await run.completion;assert.equal(permissions,2);assert.equal(run.report.cases[0].status,'reproduced finding');assert.equal(run.report.findings[0].confidence,'reproduced');
});
test('atomic budgets count sequence steps and leave unexecuted assertions untested',async()=>{
 const {run,performed}=await setup([{action:'plan',cases:[plannedCase()]}]);
 run.onChange=report=>{if(report.pending&&run.pending)setImmediate(()=>run.approve(report.pending.id,true));};
 await run.start(undefined,{maxActions:1});await run.completion;assert.equal(performed.length,1);assert.equal(run.report.status,'paused');assert.notEqual(run.report.cases[0].status,'passed');assert.match(run.report.message,/action.*budget/i);
});
test('changing focus invalidates a pending case approval and its remaining steps',async()=>{
 const {run,performed}=await setup([{action:'plan',cases:[plannedCase()]},{action:'finish'}]);await run.start();
 while(!run.report.pending&&run.report.status==='running')await new Promise(r=>setTimeout(r,5));assert.ok(run.report.pending);const id=run.report.pending.id;
 await run.steer('Check another workflow.');await run.completion;await assert.rejects(run.approve(id,true),/permission/i);assert.equal(performed.length,0);assert.ok(run.report.cases.every(c=>c.status!=='queued'));
});

test('value changes reuse the plan and queued normal workflows precede more planning',async()=>{
 const {run,browser,performed}=await setup([]);let planning=0;
 const originalObserve=browser.observe.bind(browser);browser.observe=async()=>{const o=await originalObserve();o.controls[0].value=String(performed.length);o.visibleText=`Ready ${performed.length}`;return o;};
 run.makeModel=()=>({initialize:async()=>{},close:async()=>{},decide:async()=>{planning++;return planning===1?{action:'plan',cases:[plannedCase(),{...plannedCase(),title:'Second workflow',feature:'other',steps:[{action:'assert',check:'text',expected:'Ready'}]}]}:{action:'finish'};}});
 run.onChange=report=>{if(report.pending&&run.pending){assert.equal(planning,1);setImmediate(()=>run.approve(report.pending.id,true));}};
 await run.start(undefined,{accessibility:false});await run.completion;
 assert.equal(planning,2);assert.equal(run.report.cases.length,2);assert.equal(run.report.cases[0].status,'passed');
});

test('expectation review receives the original rule and assertion without the failing actual result',async()=>{
 const {run,browser}=await setup([]);let decisions=0,reviewed=false;
 browser.perform=async step=>({status:step.action==='assert'?'failed':'ok',actual:'unexpected actual marker'});
 run.makeModel=()=>({initialize:async()=>{},close:async()=>{},decide:async(prompt,options)=>{
  if(decisions++===0)return {action:'plan',cases:[plannedCase()]};
  if(prompt.startsWith('Review only')){reviewed=true;assert.match(prompt,/Saving shows Ready/);assert.doesNotMatch(prompt,/unexpected actual marker/);assert.deepEqual(options.allowedActions,['review']);return {action:'review',supported:true};}
  return {action:'finish'};
 }});
 run.onChange=report=>{if(report.pending&&run.pending)setImmediate(()=>run.approve(report.pending.id,true));};
 await run.start();await run.completion;assert.equal(reviewed,true);assert.equal(run.report.findings[0]?.confidence,'reproduced');
});

test('deeper cases are planned from the original observed baseline and restore it',async()=>{
 const {run,browser}=await setup([]);let value='0',calls=0;
 const observe=browser.observe.bind(browser);browser.observe=async()=>{const o=await observe();o.controls[0].value=value;o.visibleText='Ready '+value;return o;};
 browser.perform=async step=>{if(step.action==='click')value='1';if(step.action==='navigate')value='0';return {status:step.action==='assert'?'passed':'ok'};};
 run.makeModel=()=>({initialize:async()=>{},close:async()=>{},decide:async(prompt)=>{
  if(calls++===0)return {action:'plan',cases:[plannedCase()]};
  return {action:'plan',cases:[{...plannedCase(),title:'Deeper assertion',family:'boundary',steps:[{action:'assert',check:'text',expected:'Ready'}]}]};
 }});
 run.onChange=report=>{if(report.pending&&run.pending)setImmediate(()=>run.approve(report.pending.id,true));};
 await run.start();await run.completion;assert.equal(run.report.cases.length,2);assert.equal(run.report.cases[1].start.stateId,run.report.cases[0].start.stateId);assert.equal(run.report.cases[1].status,'passed');assert.equal(value,'0');
});

test('page mode blocks proposed navigation to another page before permission or execution',async()=>{
 const {run,performed}=await setup([{action:'navigate',observationId:'o',value:'https://site.example/settings'}]);
 run.onChange=report=>{if(report.pending&&run.pending)setImmediate(()=>run.approve(report.pending.id,true));};
 await run.start(undefined,{mode:'page'});await run.completion;assert.equal(performed.length,0);assert.equal(run.report.status,'blocked');assert.match(run.report.message,/selected page/i);
});

test('scope steering invalidates pending approvals and preserves explicit narrowed paths',async()=>{
 const {run,performed}=await setup([{action:'plan',cases:[plannedCase()]},{action:'finish'}]);await run.start();while(!run.report.pending)await new Promise(r=>setTimeout(r,5));const id=run.report.pending.id;
 run.onChange=report=>{if(report.pending&&report.pending.id!==id&&run.pending)setImmediate(()=>run.approve(report.pending.id,false));};
 await run.steer('Check only this page',{mode:'page'},{excludePaths:['/settings']});await run.completion;assert.deepEqual(run.report.scope.excludePaths,['/settings']);assert.equal(run.report.options.mode,'page');assert.equal(performed.length,0);await assert.rejects(run.approve(id,true),/permission/i);
});
test('teaching pauses automation, keeps demonstration distinct, and requires an outcome',async()=>{
 const {run,browser,performed}=await setup([]);let emit;browser.beginTeaching=async(mode,fn)=>{emit=fn;};browser.stopTeaching=async()=>{};
 await run.beginTeaching('record');await emit({action:'click',target:'save',targetLabel:'Save',value:'',url:'https://site.example/'});await run.finishTeaching();assert.equal(run.report.teaching.status,'review');assert.equal(performed.length,0);
 await assert.rejects(run.useTeaching(''),/expected/i);await run.useTeaching('Saving shows Ready');assert.equal(run.report.workflows.length,1);assert.match(run.report.request,/Saving shows Ready/);assert.equal(performed.length,0);
});
test('reopening a saved report preserves results but requires fresh browser observation',async()=>{
 const {run,browser}=await setup([]);const id=run.report.id;await run.stop();run.makeBrowser=()=>({...browser,closed:false});await run.reopen(id);assert.equal(run.report.id,id);assert.equal(run.report.status,'manual');assert.match(run.report.message,/fresh|Sign in/i);
});

test('stopping a recording cancels teaching instead of leaving an active recorder in the report',async()=>{
 const {run,browser}=await setup([]);browser.beginTeaching=async()=>{};browser.stopTeaching=async()=>{};await run.beginTeaching('record');await run.stop();assert.equal(run.report.teaching.status,'cancelled');
});

test('finishing bounded discovery identifies queued cases as not tested',async()=>{
 const {run}=await setup([]);let passes=0;const original=run.observe.bind(run);run.observe=async epoch=>{const observation=await original(epoch);if(++passes===1)run.report.cases.push({id:'leftover',status:'queued',family:'boundary'});return observation;};
 // Force the discovery repetition guard without depending on any model output.
 run.atomic=async()=>({result:{status:'ok'}});await run.start(undefined,{mode:'site',maxActions:100,accessibility:false});await run.completion;assert.equal(run.report.cases[0].status,'not tested');
});

test('Stop during recorder shutdown prevents a late Start from launching a model',async()=>{
 const {run,browser}=await setup([]);let release,models=0;browser.stopTeaching=()=>new Promise(resolve=>{release=resolve;});run.makeModel=()=>{models++;return {initialize:async()=>{},decide:async()=>({action:'finish'}),stop:async()=>{},close:async()=>{}};};
 const starting=run.start();const rejected=assert.rejects(starting,/interrupted/i);while(!release)await new Promise(r=>setTimeout(r,5));await run.stop();release();await rejected;assert.equal(run.report.status,'stopped');assert.equal(models,0);
});

test('path steering can narrow a homepage session to the current subpage',async()=>{
 const {run,browser}=await setup([]);browser.page={url:()=> 'https://site.example/settings'};run.onChange=report=>{if(report.pending&&run.pending)setImmediate(()=>run.approve(report.pending.id,false));};
 await run.steer('Check settings only',{mode:'page'},{includePaths:['/settings']});await run.completion;assert.equal(run.report.scope.entryUrl,'https://site.example/settings');assert.deepEqual(run.report.scope.includePaths,['/settings']);assert.equal(browser.policy.scope.entryUrl,run.report.scope.entryUrl);
});
