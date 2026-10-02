import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {WebsiteRun,websiteDecisionSchema} from '../src/website-run.js';
import {WebsiteBrowser} from '../src/website-browser.js';
import {WebsiteReports} from '../src/website-tester.js';
import {createWebsiteObserver} from '../src/tester-native.js';
import {discoverMuse} from '../src/msp.js';
import {startAcceptanceFixture,acceptanceOracles,scoreAcceptance} from '../tests/fixtures/website-tester/acceptance.js';

const root=path.resolve('artifacts/website-acceptance',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(root,{recursive:true});
const executablePath=path.resolve('artifacts/website-browser/chrome.exe'),modelId='muse-spark-1.3-contributor',reasoningEffort='minimal';
const options={mode:'site',maxActions:120,maxDecisions:30,maxMs:240000,accessibility:true,replay:true};
const request='Discover and test this team shop and its settings, task forms and navigation. Use the visible rules. Cover normal flows first, then applicable empty, invalid, boundary, Arabic, persistence, ownership and rapid-input cases. Record verified outcomes, reproduce failures, and report anything not tested.';
const summary={createdAt:new Date().toISOString(),modelId,reasoningEffort,options,request,oracleProof:[],trials:[],gate:'not evaluated',limitations:['Controlled local fixtures; no proof of arbitrary live-site reliability.','Ownership uses a supplied Alex session, not a cross-account authentication audit.']};
const persist=()=>writeFile(path.join(root,'summary.json'),JSON.stringify(summary,null,2));
async function verifyOracles(fixture,faulty){
 const browser=await chromium.launch({headless:true,executablePath});
 try{const page=await browser.newPage(),values={};await page.goto(fixture.url);
  await page.getByRole('button',{name:'Add Tea',exact:true}).click();values.cart=await page.getByLabel('Cart count').innerText();
  await page.getByLabel('Quantity',{exact:true}).fill('2');values.quantity=await page.getByLabel('Order total').innerText();
  await page.getByLabel('Search',{exact:true}).fill('Tea');await page.getByLabel('Search',{exact:true}).fill('Coffee');await page.waitForFunction(()=>document.querySelector('#status').textContent==='Search ready');values.search=await page.getByLabel('Search results').innerText();
  await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByLabel('Team name').fill('Alpha');await page.getByRole('button',{name:'Save settings',exact:true}).click();values.settings=await page.getByLabel('Save status').innerText();await page.getByLabel('Updates',{exact:true}).check();await page.reload();values.persistence=await page.getByLabel('Updates',{exact:true}).isChecked();
  await page.getByRole('link',{name:'Tasks',exact:true}).click();values.ownership=await page.getByRole('button',{name:'Complete Sam task',exact:true}).isDisabled();await page.getByLabel('New task').fill('Review');await page.getByRole('button',{name:'Add task',exact:true}).click();values.tasks=await page.getByLabel('Task count').innerText();await page.getByRole('button',{name:'Show tools',exact:true}).click();await page.getByRole('link',{name:'Help',exact:true}).click();values['dynamic-navigation']=await page.getByRole('heading',{name:'Task help',exact:true}).count()? 'Task help':false;
  for(const oracle of acceptanceOracles)assert.deepEqual(values[oracle.id],faulty?oracle.faulty:oracle.expected,oracle.id);return {faulty,passed:true,values};
 }finally{await browser.close();}
}
try{
 for(const faulty of [false,true]){const fixture=await startAcceptanceFixture({faulty});try{summary.oracleProof.push(await verifyOracles(fixture,faulty));await persist();}finally{await fixture.close();}}
 if(process.argv.includes('--oracles-only')){console.log('PASS independent healthy/faulty browser oracles:',root);}
 else {
  const executable=await discoverMuse();
  for(let trial=1;trial<=3;trial++)for(const faulty of [false,true]){
   const label=`${faulty?'faulty':'healthy'}-${trial}`,fixture=await startAcceptanceFixture({faulty}),store=new WebsiteReports(path.join(root,label)),approved=new Set();let last='';
   const run=new WebsiteRun({store,makeBrowser:(directory,onClose)=>new WebsiteBrowser({directory,onClose,headless:true,executablePath}),makeModel:()=>createWebsiteObserver(executable,{schema:websiteDecisionSchema,modelId,reasoningEffort}),onChange:report=>{
    const progress=`${label}: ${report.status}; ${report.metrics?.actions||0} actions; ${report.findings?.filter(f=>f.kind==='functional').length||0} findings`;if(progress!==last){last=progress;console.log(progress);}
    // This harness authorizes only its own ephemeral local fixture, never a supplied URL.
    if(report.pending&&!approved.has(report.pending.id)){approved.add(report.pending.id);setImmediate(()=>run.approve(report.pending.id,true).catch(()=>{}));}
   }});
   try{await run.open({url:fixture.url,roleId:'Alex',request,options});await run.start();await run.completion;await writeFile(path.join(root,label,'report.json'),JSON.stringify(run.report,null,2));summary.trials.push({trial,faulty,label,...scoreAcceptance(run.report,faulty)});}
   catch(error){summary.trials.push({trial,faulty,label,error:error.message});}
   finally{await run.stop().catch(()=>{});await fixture.close();await persist();}
   console.log('RESULT',JSON.stringify(summary.trials.at(-1)));
  }
  summary.gate=summary.trials.length===6&&summary.trials.every(t=>!t.error&&!t.misses.length&&(t.faulty||t.functionalFindings===0))?'passed':'experimental: reliability gate not met';await persist();console.log(summary.gate,root);
 }
}catch(error){summary.error=error.message;await persist();throw error;}
