import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {WebsiteReports} from '../src/website-tester.js';
const api=await import('../src/website-run.js').catch(()=>({}));
async function setup(decisions){
 const store=new WebsiteReports(await mkdtemp(path.join(tmpdir(),'website-run-'))),performed=[];
 const browser={closed:false,manual:true,scope:null,policy:{version:1,grants:[]},async open(scope){this.scope=scope;this.policy.scope=scope;},async observe(){return this.observation={id:'o',url:this.scope.entryUrl,visibleText:'Ready',controls:[{id:'e1',name:'Save',type:'button'}]};},grant(fp){this.policy.grants.push(fp);},async perform(step){performed.push(step);return {status:step.action==='assert'?'passed':'ok'};},async takeOver(){this.manual=true;},async close(){this.closed=true;}};
 const observer={initialize:async()=>{},decide:async()=>decisions.shift()||{action:'finish',note:'done'},stop:async()=>{},close:async()=>{}};
 const run=new api.WebsiteRun({store,makeBrowser:()=>browser,makeModel:()=>observer,onChange:()=>{}});await run.open({url:'https://site.example',request:'Saving shows Ready'});return {run,browser,performed};
}
test('website run completes checks without project source and clicks are not passes',async()=>{
 const {run,performed}=await setup([{action:'assert',observationId:'o',target:'',value:'',check:'text',expected:'Ready',basis:'User expects Ready',note:''},{action:'finish',note:'done'}]);
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
