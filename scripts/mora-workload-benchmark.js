import {cp,mkdir,mkdtemp,readFile,writeFile,appendFile,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {MoraMode} from '../src/mora-mode.js';
import {runMoraWorker} from '../src/mora-native.js';
import {ProjectRunner} from '../src/project-work.js';
import {browserPlan} from '../src/mora-browser.js';
import {gradeWorkload} from '../tests/fixtures/mora-workloads/grader.js';

const exec=promisify(execFile),source=fileURLToPath(new URL('../tests/fixtures/mora-workloads/shop/',import.meta.url));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,25));
const hash=value=>createHash('sha256').update(value).digest('hex');
const stamp=()=>new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const terminal=new Set(['success','error','cancelled','interrupted']);
export function firstObservedFailure(failures){return [...failures].sort((left,right)=>(Number.isFinite(left.elapsedMs)?left.elapsedMs:Infinity)-(Number.isFinite(right.elapsedMs)?right.elapsedMs:Infinity))[0]||null;}
async function until(predicate,timeout=12*60*1000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await predicate())return;await pause();}throw Error('Workload deadline exceeded.');}

export const workloadTasks=[
  {key:'catalog',title:'Catalog search and filters',files:['catalog.js'],objective:'Extend searchProducts(query="", options={}) without changing products or input arrays. Fold case and combining accents, split whitespace query into tokens, require every token to match the combined product name and category. Keep Arabic names searchable. Compose optional category (exact case-insensitive), inStock (stock>0), minPrice and maxPrice inclusive filters. Empty query still lists all matching products. Preserve original regressions.'},
  {key:'basket',title:'Cart validation and coupons',files:['basket.js'],objective:'Extend basketSummary(lines, options={}) to validate every price is a finite nonnegative number and every quantity an integer from 1 through 99; invalid inputs must throw. Return count, subtotal, discount and total. Round monetary values to cents. A trimmed case-insensitive SAVE10 coupon applies ten percent to subtotal>=100; unknown coupons or smaller baskets discount zero. Preserve valid original totals and original tests. For subtotal101.05 the discount is10.11.'},
  {key:'delivery',title:'Egypt delivery quotes',files:['delivery.js'],objective:'Extend deliveryEstimate(zone, options={subtotal:0,express:false}). Trim and fold case of zone. Cairo standard fee35/days2; Alexandria45/days3; unknown65/days5. Standard delivery is free when subtotal>=500. Express always uses the regional base fee plus30, and days one less, at least1; even subtotal500 does not make express free. Reject negative/nonfinite subtotal. Preserve original outputs when no options are supplied.'}
];

async function originalTests(project){try{const result=await exec(process.execPath,['--test','tests/original.test.js'],{cwd:project,timeout:30000,maxBuffer:1024*1024,windowsHide:true});return {passed:true,output:result.stdout};}catch(error){return {passed:false,output:String(error.stdout||error.stderr||error.message)};}}
async function identities(project){return Object.fromEntries(await Promise.all(['package.json','tests/original.test.js','.mora/verification.json'].map(async file=>[file,hash(await readFile(path.join(project,file)))])));}

// Journals remain in private evidence. Counts describe observed native events, not token estimates.
async function nativeCounts(directory){
  const model=new Set(),tool=new Set(),fallbackModels=new Set();let journals=0,invalidRecords=0;
  function inspect(record){
    for(const child of record.children||[])if(child.record_json)try{inspect(JSON.parse(child.record_json));}catch{invalidRecords++;}
    const p=record.payload||{},e=p.event||{};
    if(['task_lifecycle','task'].includes(p.kind)&&e.kind==='proposed'){
      const key=p.task_id||e.task_id||record.id;
      if(e.task_kind==='model.meta.response')model.add(key);
      if(e.task_kind?.startsWith('tool.'))tool.add(key);
    }
  }
  async function visit(folder){
    for(const entry of await readdir(folder,{withFileTypes:true}).catch(()=>[])){
      const file=path.join(folder,entry.name);
      if(entry.isDirectory())await visit(file);
      else if(entry.name.endsWith('.jsonl')){journals++;for(const line of (await readFile(file,'utf8')).split(/\r?\n/))if(line.trim())try{inspect(JSON.parse(line));}catch{invalidRecords++;}}
      else if(entry.name.endsWith('.log'))for(const line of (await readFile(file,'utf8')).split(/\r?\n/))if(line.includes('event="task.lifecycle"')&&line.includes('task_kind="model.meta.response"')&&line.includes('state="proposed"')){const id=/task_id=("?)([0-9a-f-]+)\1/.exec(line)?.[2];if(id)fallbackModels.add(JSON.stringify([file,id]));}
    }
  }
  await visit(directory);let fallback=0;for(const key of fallbackModels){const [,id]=JSON.parse(key);if(!model.has(id))fallback++;}const count=model.size+fallback;return {modelCalls:count||null,nativeToolCalls:tool.size||null,journals,invalidRecords,modelCallBasis:count?'Unique model.meta.response proposal IDs from session JSONL plus bootstrap logs for unjournalled calls; provider internal HTTP retries are not additional model steps.':'No model proposal records were available; count is unknown.'};
}

export async function browserGrade(project,directory){
  const {chromium}=await import('playwright'),runner=new ProjectRunner(()=>{});let browser,context;const checks=[],errors=[];
  try{
    await runner.run(project);await until(()=>runner.state.run.status!=='starting',40000);if(runner.state.run.status!=='ready')throw Error(runner.state.run.message);
    browser=await chromium.launch({channel:'msedge',headless:true});context=await browser.newContext();await context.tracing.start({screenshots:true,snapshots:true,sources:true});const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(runner.state.run.url);
    await page.getByRole('button',{name:'Add Café coffee',exact:true}).click();await until(async()=>await page.getByRole('status',{name:'Total',exact:true}).textContent()==='EGP 155.00',5000);checks.push({name:'existing add-to-cart workflow',passed:true});
    await page.getByLabel('Coupon',{exact:true}).fill('SAVE10');await until(async()=>await page.getByRole('status',{name:'Total',exact:true}).textContent()==='EGP 143.00',5000);checks.push({name:'new coupon affects rendered checkout total',passed:true});
    await page.getByLabel('Delivery area').selectOption({label:'Alexandria'});await until(async()=>await page.getByRole('status',{name:'Total',exact:true}).textContent()==='EGP 153.00',5000);checks.push({name:'new delivery region affects rendered checkout total',passed:true});
    await page.getByLabel('Search products',{exact:true}).fill('cafe drinks');await until(async()=>await page.getByRole('button',{name:'Add Café coffee',exact:true}).count()===1&&await page.getByRole('button',{name:'Add Ceramic mug',exact:true}).count()===0,5000);checks.push({name:'new token/accent search renders matching products',passed:true});
    if(errors.length)throw Error(errors.join('\n'));await page.screenshot({path:path.join(directory,'final-browser.png'),fullPage:true});await context.tracing.stop();return {passed:true,checks,errors};
  }catch(error){checks.push({name:'browser outcome',passed:false,error:error.message});if(context){await context.pages()[0]?.screenshot({path:path.join(directory,'first-browser-failure.png'),fullPage:true}).catch(()=>{});await context.tracing.stop({path:path.join(directory,'first-browser-failure.zip')}).catch(()=>{});}return {passed:false,checks,errors};}
  finally{await browser?.close();await runner.shutdown();}
}

export async function runNativeTrial(directory,{kind,repeat,executable,modelId='muse-spark-1.3-contributor',reasoningEffort='minimal',deadlineMs=4*60*1000}={}){
  await mkdir(directory,{recursive:true});const project=path.join(directory,'project'),profile=path.join(directory,'profile');await cp(source,project,{recursive:true});await mkdir(profile);
  const expectedIdentity=await identities(project),began=Date.now(),tools=[],events=[],workerFailures=[],workers=[],checkFailures=[];let mode,deadline,attempt=0;
  const report={kind,repeat,execution:'native-muse-workers',modelId,reasoningEffort,startedAt:new Date().toISOString(),directory,project,baseline:await originalTests(project),deliveryMs:null,admissionMs:[],question:null,external:null,browser:null,firstFailure:null,finalFailure:null,success:false};
  const log=async event=>{events.push(event);await appendFile(path.join(directory,'events.jsonl'),JSON.stringify(event)+'\n');};
  try{
    if(!report.baseline.passed)throw Error('Fixture baseline regressions failed before the native trial.');browserPlan(await readFile(path.join(project,'.mora/verification.json')));
    mode=new MoraMode({profile,project,sessionId:'benchmark',executable,options:{executionMode:'full',modelId,reasoningEffort},execute:async context=>{
      const started=Date.now(),worker={runId:context.runId,threadId:context.threadId,key:context.job.task.key,startedAt:new Date().toISOString(),jobDirectory:context.job.directory};workers.push(worker);
      try{const result=await runMoraWorker({...context,executable,options:context.options,messages:context.messages.slice(1),onCall:call=>{tools.push({...call,key:worker.key,runId:context.runId,elapsedMs:Date.now()-began});}});worker.passed=true;return result;}
      catch(error){worker.passed=false;worker.error=error.message;workerFailures.push({key:worker.key,error:error.message,elapsedMs:Date.now()-began});throw error;}
      finally{worker.durationMs=Date.now()-started;await log({type:'worker-finished',...worker});}
    }});await mode.open();await mode.enable(true);mode.workspace.checkTimeoutMs=30000;mode.workspace.browserTimeoutMs=30000;mode.backend.on('change',event=>{log({...event,elapsedMs:Date.now()-began}).catch(()=>{});});
    const verify=mode.workspace.verify.bind(mode.workspace);mode.workspace.verify=async(job,settings)=>{const number=++attempt;try{const result=await verify(job,settings);const receipt={attempt:number,key:job.task.key,runId:job.runId,elapsedMs:Date.now()-began,...result};await writeFile(path.join(directory,`check-attempt-${number}.json`),JSON.stringify(receipt,null,2));if(!result.passed)checkFailures.push(receipt);return result;}catch(error){const failure={attempt:number,key:job.task.key,runId:job.runId,elapsedMs:Date.now()-began,error:error.message};checkFailures.push(failure);await writeFile(path.join(directory,`check-attempt-${number}.json`),JSON.stringify(failure,null,2));throw error;}};
    deadline=setTimeout(()=>{report.executionTimeout=true;mode.command('stop').catch(()=>{});},deadlineMs);
    async function admit(task){const start=Date.now(),thread=await mode.backend.createThread();const run=await mode.backend.createRun(thread.thread_id,{assistant_id:'mora-worker',input:{messages:[{role:'user',content:JSON.stringify({...task,dependsOn:task.dependsOn||[]})}]}});report.admissionMs.push({key:task.key,ms:Date.now()-start});return run;}
    let jobs;
    if(kind==='single')jobs=[await admit({key:'combined',title:'Complete the three MiniShop improvements',files:workloadTasks.flatMap(task=>task.files),objective:workloadTasks.map(task=>`${task.title}: ${task.objective}`).join('\n\n')})];
    else {jobs=[];for(const task of workloadTasks)jobs.push(await admit(task));}
    if(kind==='dependent')jobs.push(await admit({key:'checkout',title:'Integrate the checkout receipt',files:['checkout.js'],dependsOn:['basket','delivery'],objective:'After the basket and delivery source contracts are verified and integrated, preserve checkout(lines,zone,options) returning items,subtotal,discount,shipping,total,days. Coupon applies before the free-shipping threshold. Express uses its paid fee. Add exported checkoutReceipt(lines,zone,options={}) consuming checkout output, returning exactly six newline-separated lines: Items: N; Subtotal: EGP X.XX; Discount: EGP X.XX; Delivery: EGP X.XX; Total: EGP X.XX; ETA: N days. Replace the semicolon separators in this description with actual newlines. Use two decimal places for every monetary field. Invalid cart quantities propagate as errors. Preserve original regressions and UI behavior.'}));
    await until(()=>mode.backend.active.size>0,10000);const questionStarted=Date.now();await mode.send('Question only: how many independent coding workers can Mora Mode run at once? Answer briefly without starting or changing any tasks.');const question=mode.state.requests.at(-1);report.question={admissionMs:Date.now()-questionStarted,askedAtMs:questionStarted-began,workersActiveAtAdmission:mode.backend.active.size,requestId:question.id};
    const response=until(()=>['success','error','interrupted'].includes(question.status)&&!mode.replying,150000).then(()=>{const text=mode.state.items.find(item=>item.itemId==='mora-reply-'+question.id)?.text;report.question={...report.question,status:question.status,responseMs:Date.now()-questionStarted,workersActiveAtResponse:mode.backend.active.size,text,passed:question.status==='success'&&/\b(?:3|three)\b/i.test(text||'')};}).catch(error=>{report.question={...report.question,status:'error',passed:false,error:error.message};});
    await until(()=>jobs.every(job=>terminal.has(mode.backend.run(mode.backend.thread(job.thread_id),job.run_id).status)),deadlineMs+30000);report.deliveryMs=Date.now()-began;
    await response;
    report.tasks=mode.snapshot().tasks;report.originalRegressions=await originalTests(project);report.definitionIntegrity=JSON.stringify(await identities(project))===JSON.stringify(expectedIdentity);report.external=await gradeWorkload(project,{dependent:kind==='dependent'});report.browser=await browserGrade(project,directory);
    report.success=report.tasks.length===jobs.length&&report.tasks.every(task=>task.status==='success')&&report.originalRegressions.passed&&report.definitionIntegrity&&report.external.passed&&report.browser.passed&&report.question.passed;
    const outcomeChecks=[{name:'expected task count',passed:report.tasks.length===jobs.length},{name:'original regression suite',passed:report.originalRegressions.passed},{name:'original test/check/browser definitions unchanged',passed:report.definitionIntegrity},{name:'native question answered correctly',passed:report.question.passed},...report.external.checks,...report.browser.checks];
    const recordedFailures=[...checkFailures,...workerFailures,...events.filter(event=>event.type==='error')],outcomeFailures=outcomeChecks.filter(check=>!check.passed).map(check=>({...check,type:'final-outcome',elapsedMs:Date.now()-began}));report.firstFailure=firstObservedFailure([...recordedFailures,...outcomeFailures]);report.finalFailure=report.success?null:outcomeFailures.at(-1)||firstObservedFailure(recordedFailures)||{error:'A native task did not reach successful verified integration.'};
  }catch(error){const final={error:error.message,elapsedMs:Date.now()-began};report.firstFailure=firstObservedFailure([...checkFailures,...workerFailures,...events.filter(event=>event.type==='error'),final]);report.finalFailure=final;}
  finally{clearTimeout(deadline);await mode?.command('stop').catch(()=>{});await mode?.close().catch(()=>{});if(mode)await until(()=>mode.backend.active.size===0,30000).catch(error=>{report.finalFailure={error:error.message};});report.finishedAt=new Date().toISOString();report.totalMs=Date.now()-began;report.executionTimeout=!!report.executionTimeout||/Check timed out|Startup timed out/.test(JSON.stringify(checkFailures));report.toolCalls=tools;report.observedToolCalls=tools.length;report.workers=workers;report.nativeCounts=await nativeCounts(profile);await writeFile(path.join(directory,'trial.json'),JSON.stringify(report,null,2));await writeFile(path.join(directory,'first-failure.json'),JSON.stringify(report.firstFailure,null,2));await writeFile(path.join(directory,'final-failure.json'),JSON.stringify(report.finalFailure,null,2));}
  return report;
}

async function main(){
  const args=process.argv.slice(2),value=flag=>{const index=args.indexOf(flag);return index<0?undefined:args[index+1];};
  if(args.includes('--help')){console.log('node scripts/mora-workload-benchmark.js [--native --executable ABSOLUTE_MUSE_EXE] [--output ABSOLUTE_DIRECTORY] [--repeats 2] [--cases single,parallel,dependent] [--model MODEL]');return;}
  const requested=value('--output');if(requested&&!path.isAbsolute(requested))throw Error('--output must be an absolute evidence directory.');
  const output=requested?path.join(requested,stamp()):await mkdtemp(path.join(tmpdir(),'mora-workload-evidence-'));await mkdir(output,{recursive:true});
  if(!args.includes('--native')){
    const project=path.join(output,'baseline');await cp(source,project,{recursive:true});const baseline=await originalTests(project),capability=await gradeWorkload(project);let regression;
    try{const result=await exec(process.execPath,['--test','--test-concurrency=1',fileURLToPath(new URL('../tests/mora-workloads.test.js',import.meta.url))],{timeout:180000,maxBuffer:4*1024*1024,windowsHide:true});regression={passed:true,output:result.stdout};}catch(error){regression={passed:false,output:String(error.stdout||error.stderr||error.message)};}
    const report={execution:'offline-injected-controller-regressions',baseline,baselineCapability:capability,regression,nativeTrialsRun:0,speedClaim:null};await writeFile(path.join(output,'offline.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,baselinePassed:baseline.passed,regressionsPassed:regression.passed,nativeTrialsRun:0}));if(!baseline.passed||!regression.passed)process.exitCode=1;return;
  }
  const executable=value('--executable');if(!executable||!path.isAbsolute(executable))throw Error('Native trials require --executable with an absolute installed Muse executable path.');
  const repeats=Number(value('--repeats')||2),cases=(value('--cases')||'single,parallel,dependent').split(',');if(!Number.isInteger(repeats)||repeats<1||repeats>10||cases.some(kind=>!['single','parallel','dependent'].includes(kind)))throw Error('Invalid repeats or cases.');
  const reports=[];
  // Alternate workload types each repetition to avoid comparing a cold run against only warm runs.
  trials: for(let repeat=1;repeat<=repeats;repeat++)for(const kind of cases){const report=await runNativeTrial(path.join(output,`${kind}-${repeat}`),{kind,repeat,executable,modelId:value('--model')||'muse-spark-1.3-contributor',reasoningEffort:value('--reasoning')||'minimal'});reports.push(report);console.log(JSON.stringify({kind,repeat,success:report.success,deliveryMs:report.deliveryMs,totalMs:report.totalMs,firstFailure:report.firstFailure}));if(report.executionTimeout)break trials;}
  const median=values=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b),middle=(sorted.length-1)/2;return sorted.length?(sorted[Math.floor(middle)]+sorted[Math.ceil(middle)])/2:null;};
  const summary={execution:'native-muse-workers',output,requestedTrials:repeats*cases.length,trials:reports.length,stoppedAfterExecutionTimeout:reports.some(report=>report.executionTimeout),passed:reports.filter(report=>report.success).length,groups:Object.fromEntries(cases.map(kind=>{const selected=reports.filter(report=>report.kind===kind);return [kind,{trials:selected.length,passed:selected.filter(report=>report.success).length,medianDeliveryMs:median(selected.filter(report=>report.success).map(report=>report.deliveryMs)),medianResponseMs:median(selected.map(report=>report.question?.responseMs)),failures:selected.filter(report=>!report.success).map(report=>({repeat:report.repeat,firstFailure:report.firstFailure,finalFailure:report.finalFailure}))}];})),limitations:['Small fixture workload; results do not establish general speed or reliability.','Direct deterministic task admission isolates worker scheduling; the question uses the native coordinator.','No provider-failure, cancellation or restart injection in native coding comparison; those are deterministic regression checks.']};
  await writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));if(summary.passed!==summary.trials||summary.trials!==summary.requestedTrials||summary.stoppedAfterExecutionTimeout)process.exitCode=1;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(error.message);process.exitCode=1;});
