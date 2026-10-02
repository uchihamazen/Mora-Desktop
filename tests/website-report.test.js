import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WebsiteReports} from '../src/website-tester.js';
const api=await import('../src/website-report.js').catch(()=>({}));
const report=()=>({id:'12345678-1234-1234-1234-123456789012',createdAt:'2026-10-02',scope:{entryUrl:'https://example.com/',roleId:'guest',navigationOrigins:['https://example.com'],resourceOrigins:['https://example.com'],includePaths:[],excludePaths:[]},request:'Check cart',status:'done',options:{mode:'page'},steps:[{id:'s1',action:{action:'assert',check:'textValue',expected:'Ready',basis:'Expected Ready'},result:{status:'failed',actual:'Waiting'}}],cases:[{id:'c1',title:'Cart',featureId:'key1',status:'observed failure',steps:[{action:'assert'}],executions:[{steps:[{action:{action:'assert'},result:{status:'failed'}}]}]}],findings:[{id:'f1',caseId:'c1',title:'Cart is waiting',kind:'functional',confidence:'observed',severity:'unrated',expected:'Ready',actual:'Waiting',basis:'Expected Ready'}],gaps:['Payment not tested'],discovery:{states:[{id:'a'}],features:[{id:'f1',key:'key1'},{id:'f2',key:'key2'}],transitions:[{targetKey:'key1'}]},accessibility:[{incomplete:[{id:'contrast',help:'Manual review'}],violations:[],passedRules:1}]});

test('coverage separates discovered, exercised, asserted and unfinished behavior',()=>{
 const r=report(),summary=api.websiteCoverage(r);assert.equal(summary.controls,2);assert.equal(summary.exercised,1);assert.equal(summary.checked,1);assert.equal(summary.assertions.failed,1);assert.equal(summary.unchecked,1);
});

test('coverage never transfers assertions between roles or different pages',()=>{
 const r=report();r.discovery.features=[{id:'f1',key:'key1',url:'https://example.com/',roleId:'guest'},{id:'f2',key:'key1',url:'https://example.com/',roleId:'admin'}];r.cases[0].start={url:'https://example.com/',roleId:'guest'};
 assert.equal(api.websiteCoverage(r).checked,1);
});
test('HTML and JSON exports escape page content and omit private runtime fields',()=>{
 const r=report();r.request='<script>alert(1)</script> private@example.com';r.auth={token:'never-export'};r.findings[0].actual='<img src=x onerror=alert(1)> Bearer secret';r.steps[0].result.screenshot={name:'../private.png'};
 const html=api.buildWebsiteExport(r,{format:'html'});assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('private@example.com'));assert.ok(!html.includes('never-export'));assert.ok(html.includes('Payment not tested'));assert.ok(html.includes('Manual review'));
 const json=JSON.parse(api.buildWebsiteExport(r,{format:'json'}));assert.equal('auth' in json,false);assert.equal(JSON.stringify(json).includes('../private.png'),false);assert.equal(json.findings[0].confidence,'observed');assert.equal(json.findings[0].severity,'unrated');
 assert.throws(()=>api.buildWebsiteExport(r,{format:'exe'}),/format/i);
});
test('export embeds only supplied valid PNG evidence and keeps unresolved work',()=>{
 const r=report(),name='screen-1234abcd.png';r.steps[0].result.screenshot={name};r.cases.push({id:'c2',title:'Interrupted replay',status:'not tested'});
 const html=api.buildWebsiteExport(r,{format:'html',evidence:{[name]:'iVBORw0KGgo='}});assert.ok(html.includes('data:image/png;base64,iVBORw0KGgo='));assert.ok(html.includes('Interrupted replay'));
 assert.throws(()=>api.buildWebsiteExport(r,{format:'html',evidence:{[name]:'\" onerror=alert(1)'}}),/evidence/i);
});
test('exports retain the verified starting checklist and reset recipe used for reproduction',()=>{
 const r=report();r.cases[0].start={url:'https://example.com',roleId:'guest',conditionId:'conditions'};r.cases[0].startChecks=[{action:'assert',target:'Search',check:'value',expected:''}];r.cases[0].reset=[{action:'click',target:'Reset'}];r.cases[0].executions[0].startConditionId='conditions';
 const exported=JSON.parse(api.buildWebsiteExport(r,{format:'json'}));assert.equal(exported.cases[0].startChecks[0].check,'value');assert.equal(exported.cases[0].reset[0].target,'Reset');assert.equal(exported.cases[0].executions[0].startConditionId,'conditions');
 assert.match(api.buildWebsiteExport(r),/Required starting conditions/);
});
test('restart recovers pending case/replay uncertainty from a valid backup',async()=>{
 const store=new WebsiteReports(await mkdtemp(path.join(tmpdir(),'website-report-'))),r=await store.create({url:'https://example.com'});
 r.status='awaiting permission';r.pending={id:'expired'};r.steps=[{id:'s1',caseId:'c1',action:{action:'click'},status:'pending'}];r.cases=[{id:'c1',status:'running',executions:[{replay:true,steps:[{action:{action:'assert'},status:'pending'}]}]}];await store.save(r);await writeFile(store.filename(r.id),'broken');
 const loaded=await store.load(r.id);assert.equal(loaded.status,'paused');assert.equal(loaded.pending,undefined);assert.equal(loaded.cases[0].status,'not tested');assert.equal(loaded.steps[0].result.status,'uncertain');assert.equal(loaded.cases[0].executions[0].steps[0].result.status,'uncertain');
 assert.equal(await readFile(store.filename(r.id),'utf8'),'broken','Reading recovery does not overwrite original evidence');
});
test('store rejects UTF-8 byte oversize and evidence traversal',async()=>{
 const store=new WebsiteReports(await mkdtemp(path.join(tmpdir(),'website-report-'))),r=await store.create({url:'https://example.com'});r.gaps=['ش'.repeat(2200000)];await assert.rejects(store.save(r),/size/i);await assert.rejects(store.evidence(r.id,'../auth.json'),/evidence/i);
});
