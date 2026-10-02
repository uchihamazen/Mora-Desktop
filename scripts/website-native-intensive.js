import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {WebsiteRun,websiteDecisionSchema} from '../src/website-run.js';
import {WebsiteBrowser} from '../src/website-browser.js';
import {WebsiteReports} from '../src/website-tester.js';
import {createWebsiteObserver} from '../src/tester-native.js';
import {discoverMuse} from '../src/msp.js';
import {startWebsiteFixture} from '../tests/fixtures/website-tester/site.js';

const root=path.resolve('artifacts/build-temp');await mkdir(root,{recursive:true});const executable=await discoverMuse();const receipts=[];
const request='On this page, test only Quantity and Search using the visible rules. Run their normal checks first. For the timing case, enter Tea then Coffee consecutively without waiting in between, then verify the displayed completion status and latest search result. Do not open Details or Settings. Finish after these checks.';
for(const faulty of [false,true]) {
 const fixture=await startWebsiteFixture({faulty}),store=new WebsiteReports(await mkdtemp(path.join(root,'website-native-intensive-'))),approved=new Set();let last='';
 const run=new WebsiteRun({store,makeBrowser:(directory,onClose)=>new WebsiteBrowser({directory,onClose,headless:true}),makeModel:()=>createWebsiteObserver(executable,{schema:websiteDecisionSchema}),onChange:report=>{
   const progress=JSON.stringify([report.status,report.metrics?.actions,report.cases?.map(c=>[c.title,c.status])]);if(progress!==last){last=progress;console.log(`${faulty?'faulty':'healthy'}: ${report.status}; ${report.metrics?.actions||0} operations; ${(report.cases||[]).map(c=>c.title+': '+c.status).join(' | ')}`);}
   if(report.pending&&!approved.has(report.pending.id)){approved.add(report.pending.id);setImmediate(()=>run.approve(report.pending.id,true).catch(()=>{}));}
 }});
 try {
  await run.open({url:fixture.url,request,options:{mode:'workflow',maxActions:70,maxDecisions:20,maxMs:300000}});
  await run.start();await run.completion;
  const report=run.report;await writeFile(`artifacts/website-native-intensive-${faulty?'faulty':'healthy'}.json`,JSON.stringify(report,null,2));
  const functional=report.findings.filter(f=>f.kind==='functional'),reproduced=functional.filter(f=>f.status==='reproduced finding');
  const receipt={faulty,request,options:report.options,status:report.status,cases:report.cases.map(c=>({title:c.title,family:c.family,status:c.status})),functionalFindings:functional.length,reproduced:reproduced.length,accessibility:report.findings.filter(f=>f.kind==='accessibility').length,metrics:report.metrics};receipts.push(receipt);
  assert.equal(report.status,'done',report.message);assert.ok(report.metrics.checked>0);
  if(!faulty)assert.equal(functional.length,0,'Healthy fixture must not produce functional findings');
  else {assert.ok(reproduced.some(f=>f.expected==='Total: 20'&&f.actual==='Total: 22'),'The incorrect total must be reproduced');assert.ok(reproduced.some(f=>f.expected==='Coffee'&&f.actual==='Tea'),'The stale search result must be reproduced');}
  console.log(`PASS native ${faulty?'faulty':'healthy'}: ${report.metrics.checked} assertions, ${reproduced.length} reproduced findings, ${report.metrics.decisions} native decisions`);
 }finally{await run.stop();await fixture.close();await writeFile('artifacts/website-native-intensive-summary.json',JSON.stringify(receipts,null,2));}
}
