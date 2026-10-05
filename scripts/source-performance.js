import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {HistoryWindow} from '../src/history-window.js';
import {MspClient} from '../src/msp.js';

const reportIndex=process.argv.indexOf('--report');
if(reportIndex!==-1 && !process.argv[reportIndex+1])throw Error('Provide a report filename after --report.');
const bounds={projectionMedianMs:1000,projectionP95Ms:3000,snapshotFraction:0.05,shutdownMs:10000};
const report={fixtureOnly:true,node:process.version,platform:process.platform,bounds,history:[]};
for(const rows of [10000,50000]) {
  const text='Retained history payload. '.repeat(80);
  const items=Array.from({length:rows},(_,index)=>({itemId:'item-'+index,turnId:'turn-'+Math.floor(index/20),kind:index%4?'agentMessage':'toolCall',status:'completed',text,description:'Operation '+index,visibleOutput:text}));
  const state={sessionId:'large-history',items,lastOutcome:{turnId:items.at(-1).turnId},draft:{text:'Keep draft',images:[]},pendingQueue:[{queueId:'pending',text:'Keep queued',images:[]}]};
  const fullBytes=Buffer.byteLength(JSON.stringify(state)),view=new HistoryWindow(),samples=[];
  let snapshotBytes,snapshot;
  for(let iteration=0;iteration<23;iteration++) {
    const start=performance.now();snapshot=view.project(state);snapshotBytes=Buffer.byteLength(JSON.stringify(snapshot));
    if(iteration>=3)samples.push(performance.now()-start);
  }
  assert.equal(snapshot.items.length,200);assert.equal(snapshot.historyCount,rows);
  assert.equal(snapshot.draft,state.draft);assert.equal(snapshot.pendingQueue,state.pendingQueue);
  assert.equal(snapshot.lastOutcomeOperations.length,5);assert.equal(snapshot.lastOutcomeOperations.some(item=>item.visibleOutput),false);
  assert.ok(snapshotBytes/fullBytes<bounds.snapshotFraction,'Live snapshots must omit the old transcript payload');
  samples.sort((a,b)=>a-b);const medianMs=samples[10],p95Ms=samples[18];
  assert.ok(medianMs<bounds.projectionMedianMs,`${rows} history rows: median projection exceeded ${bounds.projectionMedianMs}ms`);
  assert.ok(p95Ms<bounds.projectionP95Ms,`${rows} history rows: p95 projection exceeded ${bounds.projectionP95Ms}ms`);
  assert.equal(view.older(state,state.sessionId).items.length,400);
  assert.equal(view.project({...state,sessionId:'next-chat',items:[]}).items.length,0);assert.equal(view.limit,200);
  report.history.push({rows,updates:samples.length,fullBytes,snapshotBytes,reductionPercent:Math.round((1-snapshotBytes/fullBytes)*10000)/100,medianMs:Math.round(medianMs*100)/100,p95Ms:Math.round(p95Ms*100)/100,initialRows:200,olderRows:400,chatSwitchResetsWindow:true});
}

const directory=await mkdtemp(path.join(tmpdir(),'mora-source-performance-')),client=new MspClient();
try {
  await client.connect({executable:process.execPath,args:[fileURLToPath(new URL('../tests/fixtures/host.js',import.meta.url))],workspace:directory,timeoutMs:60000});
  const processId=client.child.pid;
  const requests=Array.from({length:250},()=>client.request('timeout').then(()=>({resolved:true}),error=>({error:error.message})));
  const start=performance.now();await client.close();const outcomes=await Promise.all(requests),elapsedMs=performance.now()-start;
  assert.equal(outcomes.length,250);assert.ok(outcomes.every(outcome=>/closed|exited|disconnected/i.test(outcome.error)));
  assert.equal(client.pending.size,0);assert.equal(client.child,null);assert.throws(()=>process.kill(processId,0));
  await assert.rejects(client.request('healthy'),/disconnected/i);
  assert.ok(elapsedMs<bounds.shutdownMs,`Protocol cleanup exceeded ${bounds.shutdownMs}ms`);
  report.cleanup={pendingRequests:requests.length,rejectedRequests:outcomes.length,pendingAfterClose:client.pending.size,hostStopped:true,elapsedMs:Math.round(elapsedMs*100)/100};
} finally {
  await client.close();await rm(directory,{recursive:true,force:true});
}
await assert.rejects(access(directory),{code:'ENOENT'});report.cleanup.fixtureRemoved=true;
if(reportIndex!==-1){const filename=path.resolve(process.argv[reportIndex+1]);await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
console.log('PASS large-history snapshots, generous timing bounds, chat-window reset and 250-request host cleanup');
