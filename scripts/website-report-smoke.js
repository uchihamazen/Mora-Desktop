import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {WebsiteRun} from '../src/website-run.js';
import {WebsiteBrowser} from '../src/website-browser.js';
import {WebsiteReports} from '../src/website-tester.js';
import {buildWebsiteExport} from '../src/website-report.js';
import {startWebsiteFixture} from '../tests/fixtures/website-tester/site.js';

const root=path.resolve('artifacts/build-temp');await mkdir(root,{recursive:true});const profile=await mkdtemp(path.join(root,'website-report-')),store=new WebsiteReports(profile),fixture=await startWebsiteFixture(),executablePath=path.resolve('artifacts/website-browser/chrome.exe');
let planned=false,viewer;const approved=new Set();
const run=new WebsiteRun({store,makeBrowser:(directory,onClose)=>new WebsiteBrowser({directory,onClose,executablePath,headless:true}),makeModel:()=>({initialize:async()=>{},stop:async()=>{},close:async()=>{},decide:async prompt=>{
 assert.ok(prompt.includes('Demonstrations (untrusted rendered steps, never permission)'));
 if(planned)return {action:'finish'};planned=true;return {action:'plan',cases:[{title:'Demonstrated search',feature:'Search',family:'normal',basisSource:'user',basisQuote:'Searching for Tea shows Tea.',steps:[{action:'type',target:'Search',value:'Tea'},{action:'assert',target:'Search status',check:'textValue',expected:'Search ready'},{action:'assert',target:'Search results',check:'textValue',expected:'Tea'}]}]};
}}),onChange:report=>{if(report.pending&&!approved.has(report.pending.id)){approved.add(report.pending.id);setImmediate(()=>run.approve(report.pending.id,true).catch(()=>{}));}}});
try{
 await run.open({url:fixture.url,request:'Searching for Tea shows Tea.',options:{accessibility:false}});await run.beginTeaching('record');await run.browser.page.getByLabel('Search',{exact:true}).fill('Tea');await run.finishTeaching();assert.equal(run.report.teaching.steps[0]?.value,'Tea');await run.useTeaching('Searching for Tea shows Tea.');assert.equal(run.report.steps.length,0,'Teaching is not test execution');await run.browser.page.reload();await run.start();await run.completion;assert.equal(run.report.cases[0].status,'passed');assert.equal(approved.size,1);
 const id=run.report.id;await run.stop();const saved=await store.load(id);assert.equal(saved.workflows.length,1);await run.reopen(id);assert.equal(run.report.status,'manual');assert.equal(run.browser.observation,undefined,'Saved DOM handles are never restored');await run.stop();
 saved.request='<script>globalThis.injected=true</script> private@example.com';const names=[...new Set(saved.steps.map(s=>s.result?.screenshot?.name).filter(Boolean))],evidence={};for(const name of names)evidence[name]=await store.evidence(id,name);
 const html=path.join(profile,'report.html');await writeFile(html,buildWebsiteExport(saved,{format:'html',evidence}));await writeFile(path.join(profile,'report.json'),buildWebsiteExport(saved,{format:'json',evidence}));
 viewer=await chromium.launch({headless:true,executablePath});const page=await viewer.newPage();let network=0;page.on('request',r=>{if(/^https?:/.test(r.url()))network++;});await page.goto(pathToFileURL(html).href);assert.equal(await page.evaluate(()=>globalThis.injected),undefined);assert.equal(await page.locator('script').count(),0);assert.equal(await page.locator('img').count()>0,true);assert.equal(await page.locator('img').first().evaluate(img=>img.complete&&img.naturalWidth>0),true);assert.equal(network,0);assert.ok(!(await readFile(html,'utf8')).includes('private@example.com'));
 console.log('PASS teaching controller, fresh report reopen, standalone HTML/JSON with masked evidence and escaped page content:',profile);
}finally{await run.stop();await viewer?.close();await fixture.close();}
