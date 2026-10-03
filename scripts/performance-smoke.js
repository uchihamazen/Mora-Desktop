import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {snapshotProject,compareProject} from '../src/changes.js';

const require=createRequire(import.meta.url);
const {chromium}=require('./runtime-packages.cjs').runtimeRequire('playwright');
const baseline=process.argv[2] ? await readFile(process.argv[2],'utf8') : null;
const historyRows=Number(process.env.MORA_PERF_ROWS || 50);
const server=createServer(async(req,res)=>{
  const route=new URL(req.url,'http://localhost');
  const file=route.pathname==='/' ? 'index.html' : route.pathname.slice(1);
  if(!/^(index\.html|[a-z-]+\.(js|css)|assets\/mora-mark\.svg)$/.test(file)){res.writeHead(404).end();return;}
  try {
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');
    res.end(file==='renderer.js' && route.searchParams.has('baseline') ? baseline : await readFile(path.join('src',file)));
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
const fixture=await mkdtemp(path.join(tmpdir(),'mora-performance-'));
async function measure(useBaseline=false) {
  const page=await browser.newPage();
  await page.addInitScript(({historyRows})=>{
    const items=Array.from({length:historyRows},(_,i)=>({itemId:'history-'+i,kind:'agentMessage',status:'completed',text:'Saved reply '+i}));
    items.push({itemId:'tool',kind:'toolCall',status:'completed',visibleOutput:'Tool output\n'.repeat(10000)});
    items.push({itemId:'stream',kind:'agentMessage',status:'inProgress',text:'Starting'});
    const sessions=Array.from({length:20},(_,i)=>({sessionId:'chat-'+i,title:'Chat '+i,projectPath:null,workspace:'C:\\Fixture'}));
    let callback;
    const state={sessionId:'chat-0',items,sessions,projects:[],draft:{text:'',images:[]},models:[],connection:'ready',busy:true,pendingQueue:[],projectPath:null};
    window.fixture={state,emit:text=>{items.at(-1).text=text;callback({type:'state',state});}};
    window.muse={getState:async()=>state,onEvent:cb=>{callback=cb;},copyText:async()=>{}};
  },{historyRows});
  // Choose the renderer before the module request; both versions use the same fixture.
  if(useBaseline)await page.route('**/renderer.js',route=>route.fulfill({contentType:'application/javascript',body:baseline}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(count=>document.querySelectorAll('#messages > *').length===count,useBaseline?historyRows+2:Math.min(200,historyRows+2));
  const result=await page.evaluate(async(historyRows)=>{
    let rowInsertions=0,sidebarInsertions=0;
    const rowObserver=new MutationObserver(records=>{for(const record of records)rowInsertions+=record.addedNodes.length;});
    const sidebarObserver=new MutationObserver(records=>{for(const record of records)sidebarInsertions+=record.addedNodes.length;});
    rowObserver.observe(document.querySelector('#messages'),{childList:true});
    for(const id of ['sessions','general-sessions'])sidebarObserver.observe(document.getElementById(id),{childList:true});
    const saved=document.querySelector('#messages').firstElementChild;
    const start=performance.now();
    for(let i=0;i<100;i++){window.fixture.emit('Streamed reply '+i);await Promise.resolve();}
    const elapsedMs=Math.round((performance.now()-start)*100)/100;
    const collapsedOutputBytes=[...document.querySelectorAll('.tool-card:not([open]) pre')].reduce((sum,node)=>sum+node.textContent.length,0);
    rowObserver.disconnect();sidebarObserver.disconnect();
    return {updates:100,historyRows,rowInsertions,sidebarInsertions,collapsedOutputBytes,savedRowRetained:saved===document.querySelector('#messages').firstElementChild,elapsedMs};
  },historyRows);
  await page.close();return result;
}
try {
  const before=baseline ? await measure(true) : undefined;
  const after=await measure();
  assert.equal(after.rowInsertions,0);assert.equal(after.sidebarInsertions,0);
  assert.equal(after.collapsedOutputBytes,0);assert.equal(after.savedRowRetained,true);
  for(let i=0;i<100;i++)await writeFile(path.join(fixture,`${i}.txt`),'Before\n');
  const original=await snapshotProject(fixture);
  await writeFile(path.join(fixture,'3.txt'),'Changed\n');
  const incremental=await snapshotProject(fixture,{previous:original,dirtyPaths:new Set(['3.txt'])});
  await writeFile(path.join(fixture,'7.txt'),'Missed event\n');
  const final=await compareProject(fixture,original);
  assert.equal(incremental.readCount,1);assert.deepEqual(final.files.map(file=>file.path),['3.txt','7.txt']);
  const report={fixtureOnly:true,renderer:{before,after},snapshots:{fullReads:original.readCount,incrementalReads:incremental.readCount,finalReconciliationFiles:final.files.length}};
  await mkdir('artifacts',{recursive:true});await writeFile('artifacts/performance-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  console.log('PASS performance fixtures: stable rows/sidebar, lazy output, changed-path reads and final reconciliation');
} finally {
  await browser.close();await new Promise(resolve=>server.close(resolve));
  if(path.dirname(fixture)===path.resolve(tmpdir()) && path.basename(fixture).startsWith('mora-performance-'))await rm(fixture,{recursive:true,force:true});
}
