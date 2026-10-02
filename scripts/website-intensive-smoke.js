import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {WebsiteRun} from '../src/website-run.js';
import {WebsiteBrowser} from '../src/website-browser.js';
import {WebsiteReports} from '../src/website-tester.js';
import {startWebsiteFixture} from '../tests/fixtures/website-tester/site.js';

const root=path.resolve('artifacts/build-temp');await mkdir(root,{recursive:true});const receipts=[];
for(const faulty of [false,true]) {
 const fixture=await startWebsiteFixture({faulty}),store=new WebsiteReports(await mkdtemp(path.join(root,'website-intensive-')));
 const request='Changing quantity to 2 shows Total: 20. Latest search wins after Search ready appears.';
 const cases=[{title:'Quantity total',feature:'Quantity',family:'normal',basisSource:'user',basisQuote:'Changing quantity to 2 shows Total: 20.',precondition:'',steps:[{action:'type',target:'Quantity',value:'2'},{action:'assert',target:'Order total',check:'textValue',expected:'Total: 20'}],reset:[]},{title:'Latest search wins',feature:'Search',family:'timing',basisSource:'user',basisQuote:'Latest search wins after Search ready appears.',precondition:'',steps:[{action:'type',target:'Search',value:'Tea'},{action:'type',target:'Search',value:'Coffee'},{action:'assert',target:'Search status',check:'textValue',expected:'Search ready'},{action:'assert',target:'Search results',check:'textValue',expected:'Coffee'}],reset:[]}];
 let planned=false,permissions=0;const approved=new Set();
 const model={initialize:async()=>{},decide:async prompt=>prompt.startsWith('Review only')?{action:'review',supported:true,note:'The original assertion follows the cited user rule.'}:!planned?(planned=true,{action:'plan',cases}):{action:'finish'},stop:async()=>{},close:async()=>{}};
 const run=new WebsiteRun({store,makeBrowser:(directory,onClose)=>new WebsiteBrowser({directory,onClose,headless:true,executablePath:process.argv[2]}),makeModel:()=>model,onChange:report=>{if(report.pending&&!approved.has(report.pending.id)){approved.add(report.pending.id);permissions++;setImmediate(()=>run.approve(report.pending.id,true).catch(()=>{}));}}});
 try {
  await run.open({url:fixture.url,request,options:{mode:'workflow',maxActions:80}});await run.start();await run.completion;
  assert.equal(run.report.status,'done',run.report.message);
  const functional=run.report.findings.filter(f=>f.kind==='functional');assert.equal(functional.length,faulty?2:0,JSON.stringify(run.report.cases.map(c=>({title:c.title,status:c.status,reason:c.reason}))));
  assert.ok(run.report.cases.filter(c=>['Quantity total','Latest search wins'].includes(c.title)).every(c=>c.status===(faulty?'reproduced finding':'passed')));
  assert.equal(run.report.findings.some(f=>f.ruleId==='label'),faulty);assert.ok(run.report.discovery.transitions.length>0);
  const saved=await store.load(run.report.id);assert.equal(saved.cases.length,run.report.cases.length);assert.equal(saved.findings.length,run.report.findings.length);
  receipts.push({faulty,passed:true,permissions,states:run.report.discovery.states.length,transitions:run.report.discovery.transitions.length,cases:run.report.cases.map(c=>({title:c.title,status:c.status})),findings:run.report.findings.map(f=>({kind:f.kind,status:f.status,ruleId:f.ruleId})),metrics:run.report.metrics});
  console.log(`PASS ${faulty?'faulty':'healthy'} intensive workflow: ${run.report.cases.length} cases, ${functional.length} functional findings, ${permissions} exact case approvals, replay/reset and axe verified`);
 }finally{await run.stop();await fixture.close();}
}
await writeFile('artifacts/website-intensive-smoke.json',JSON.stringify(receipts,null,2));
