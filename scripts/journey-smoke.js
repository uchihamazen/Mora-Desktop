import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
import {uuid7} from '../src/msp.js';
const require=createRequire(import.meta.url),{chromium}=require('./runtime-packages.cjs').runtimeRequire('playwright');
const supplied=process.argv.slice(2).find(arg=>!arg.startsWith('--')),executable=supplied?path.resolve(supplied):require('electron');
const packaged=!!supplied,send=process.argv.includes('--send'),missing=process.argv.includes('--missing-engine'),legacy=process.argv.includes('--legacy-profile');
const base=path.resolve('artifacts/build-temp');await mkdir(base,{recursive:true});
const profile=await mkdtemp(path.join(base,'journey-profile-')),parent=await mkdtemp(path.join(base,'journey-project-'));
const env={...process.env,MUSE_DESKTOP_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
if(legacy){const workspace=path.join(parent,'Earlier project'),sessionId=uuid7();await mkdir(workspace);await writeFile(path.join(profile,'preferences.json'),JSON.stringify({workspace,projectPath:workspace,lastSessionId:sessionId,executionMode:'readonly',sessions:[{sessionId,title:'Saved earlier chat',workspace,hasMessages:false,createdAt:new Date().toISOString()}]}));}
if(missing)await writeFile(path.join(profile,'preferences.json'),JSON.stringify({executable:path.join(parent,'absent-muse.exe'),projectPath:null}));
let app,cdp,debugEndpoint;
async function untilState(page,predicate,timeout=45000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const state=await page.evaluate(()=>window.muse.getState());if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Desktop state did not settle in time.');}
async function launch() {
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  // Launch normally: Electron's inspector bootstrap can postpone ESM readiness.
  const child=spawn(executable,[...(packaged?[]:['.']),`--remote-debugging-port=${port}`],{cwd:process.cwd(),env,windowsHide:true,stdio:'ignore'});
  let browser,page;
  const ended=once(child,'close');
  app={process:()=>child,close:async()=>{
    if(child.exitCode===null){await page?.evaluate(()=>window.close()).catch(()=>{});await Promise.race([ended,new Promise(resolve=>setTimeout(resolve,3000))]);}
    if(child.exitCode===null){spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await ended;}
    await browser?.close().catch(()=>{});
  }};
  const endpoint=debugEndpoint=`http://127.0.0.1:${port}`,deadline=Date.now()+30000;
  while(true){
    try{if((await fetch(endpoint+'/json/version')).ok)break;}catch{}
    if(child.exitCode!==null || Date.now()>deadline)throw new Error('Desktop did not open its test connection.');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  // CDP attaches every view. Initialize the otherwise dormant preview first,
  // so its empty target cannot hold Playwright's initial context discovery.
  let target;
  while(!(target=(await (await fetch(endpoint+'/json/list')).json()).find(item=>item.url.endsWith('/index.html')))){
    if(Date.now()>deadline)throw new Error('Desktop window did not load.');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Preview initialization timed out.')),10000);
      socket.addEventListener('message',event=>{
        const message=JSON.parse(event.data);if(message.id!==1)return;clearTimeout(timer);
        if(message.error || message.result.exceptionDetails)reject(new Error('Preview initialization failed.'));else resolve();
      });
      socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:"window.muse.browserCommand('open').then(()=>window.muse.browserCommand('close'))",awaitPromise:true}}));
    });
  } finally {socket.close();}
  browser=await chromium.connectOverCDP(endpoint);cdp=browser;
  page=browser.contexts()[0].pages().find(candidate=>candidate.url()===target.url);
  if(!page)throw new Error('Desktop window was not available to the test.');return page;
}
try {
 let page=await launch();if(missing){await untilState(page,s=>s.account?.status==='missing');assert.equal(await page.locator('#onboarding').isVisible(),true);assert.equal(await page.locator('#onboarding-action').textContent(),'Get Muse Code');assert.equal(await page.locator('#send-button').isDisabled(),true);const created=await page.evaluate(parent=>window.muse.createProject({parent,name:'Offline starter',starter:true}),parent);assert.ok(created.projectPath);console.log('PASS native first run: missing engine guidance, disabled sending and safe project creation');}else{await page.waitForFunction(()=>document.querySelector('#connection-badge').textContent==='Connected');
 if(legacy)assert.ok((await page.evaluate(()=>window.muse.getState())).sessions.some(session=>session.title==='Saved earlier chat'));
 const account=(await page.evaluate(()=>window.muse.getState())).account;
 assert.ok(['signedIn','apiKey','ready'].includes(account.status),'Existing Muse sign-in should be retained');
 const created=await page.evaluate(parent=>window.muse.createProject({parent,name:'Working app',starter:true}),parent),root=created.projectPath;
 await writeFile(path.join(root,'dirty.txt'),'original dirty work');
 let checkpoint;
 if(send){
  await page.evaluate(()=>window.muse.setOptions({executionMode:'full',speedPreset:'quick'}));
  await page.evaluate(()=>window.muse.sendMessage({text:"Change only the starter index.html heading to Built with Muse. Preserve the counter, all other files and dirty.txt. Do not install packages or start servers.",images:[]}));
  await untilState(page,s=>!s.busy,240000);
  const state=await page.evaluate(()=>window.muse.getState());assert.equal(state.lastOutcome.status,'finished');assert.match(await readFile(path.join(root,'index.html'),'utf8'),/Built with Muse/);
  checkpoint=(await page.evaluate(()=>window.muse.checkpointCommand('list'))).find(item=>item.label==='Before Muse request');assert.ok(checkpoint);
 }else{
  checkpoint=await page.evaluate(()=>window.muse.checkpointCommand('create',{label:'Before edit'}));
  const file=path.join(root,'index.html');await writeFile(file,(await readFile(file,'utf8')).replace('Something good starts here.','Built with Muse'));
 }
 await page.locator('#run-project').click();await page.waitForFunction(()=>document.querySelector('#stop-project').hidden===false,{},{timeout:45000});
 await untilState(page,s=>s.projectWork.run.status==='ready');
 let work=(await page.evaluate(()=>window.muse.getState())).projectWork;
 let target;for(let i=0;i<100;i++){target=(await(await fetch(debugEndpoint+'/json/list')).json()).find(candidate=>candidate.url===work.run.url);if(target)break;await new Promise(resolve=>setTimeout(resolve,100));}
 if(!target)console.log({run:work.run,preview:(await page.evaluate(()=>window.muse.browserCommand('state'))),targets:(await(await fetch(debugEndpoint+'/json/list')).json()).map(item=>({type:item.type,url:item.url}))});
 assert.ok(target,'Local preview opened');
 const socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');let requestId=20;
 const evaluate=expression=>new Promise((resolve,reject)=>{const id=requestId++,timer=setTimeout(()=>{socket.removeEventListener('message',receive);reject(Error('Preview evaluation timed out'));},10000);const receive=({data})=>{const message=JSON.parse(data);if(message.id!==id)return;clearTimeout(timer);socket.removeEventListener('message',receive);if(message.error || message.result.exceptionDetails)reject(Error('Preview evaluation failed'));else resolve(message.result.result.value);};socket.addEventListener('message',receive);socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});
 try{
 assert.equal(await evaluate("!!document.querySelector('#add')"),true);await evaluate("document.querySelector('#add').click()");assert.equal(await evaluate("document.querySelector('#count').textContent"),'1');
 await new Promise(resolve=>setTimeout(resolve,400));await page.evaluate(()=>window.muse.browserCommand('annotate',{mode:'element'}));await new Promise(resolve=>setTimeout(resolve,100));
 await evaluate("(()=>{const button=document.querySelector('#add'),r=button.getBoundingClientRect();for(const type of ['pointerdown','pointerup'])button.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,button:0,clientX:r.x+5,clientY:r.y+5}));})()");
 await page.locator('#browser-add').waitFor();await page.waitForFunction(()=>!document.querySelector('#browser-add').disabled);await page.locator('#browser-add').click();await page.locator('#attachments img').waitFor();assert.equal(await page.locator('#attachments img').count(),1);
 }finally{socket.close();}
 await page.locator('#test-project').click();await untilState(page,s=>s.projectWork.tests.status==='passed' && !s.projectOperation,60000);
 work=(await page.evaluate(()=>window.muse.getState())).projectWork;assert.deepEqual(work.tests.results.map(item=>item.script),['check','build','test']);assert.equal(work.tests.preview.status,'passed');assert.equal(work.tests.interactions,'not checked');
 const index=path.join(root,'index.html'),valid=await readFile(index,'utf8');await writeFile(index,valid.replace('</body>','<script>console.error("fixture browser error")</script></body>'));
 await page.evaluate(()=>window.muse.projectCommand('test'));await untilState(page,s=>s.projectWork.tests.status==='failed',60000);assert.equal((await page.evaluate(()=>window.muse.getState())).projectWork.tests.preview.status,'failed');await writeFile(index,valid);

 await assert.rejects(page.evaluate(id=>window.muse.checkpointCommand('preview',{id}),checkpoint.id),/Stop Run/);
 await page.locator('#stop-project').click();await untilState(page,s=>s.projectWork.run.status==='stopped');
 await writeFile(path.join(root,'dirty.txt'),'later unrelated work');
 const restore=await page.evaluate(id=>window.muse.checkpointCommand('preview',{id}),checkpoint.id);assert.deepEqual(restore.changes.map(item=>item.path),send?['index.html']:['dirty.txt','index.html']);
 await page.evaluate(restore=>window.muse.checkpointCommand('restore',{token:restore.token,paths:['index.html']}),restore);
 assert.match(await readFile(path.join(root,'index.html'),'utf8'),/Something good starts here/);assert.equal(await readFile(path.join(root,'dirty.txt'),'utf8'),'later unrelated work');
 await page.evaluate(()=>window.muse.projectCommand('run'));await untilState(page,s=>s.projectWork.run.status==='ready');
 const url=(await page.evaluate(()=>window.muse.getState())).projectWork.run.url;
 const exited=once(app.process(),'exit');await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${app.process().pid}).CloseMainWindow()`],{windowsHide:true});await exited;await app.close();app=null;
 await assert.rejects(fetch(url));page=await launch();await untilState(page,s=>s.projectPath!==null);
 assert.ok((await page.evaluate(()=>window.muse.checkpointCommand('list'))).some(item=>item.id===checkpoint.id));assert.equal((await page.evaluate(()=>window.muse.getState())).projectWork.run.status,'stopped');
 let tester;
 if(process.argv.includes('--tester')){
  const counter=path.join(root,'src','app.js');await writeFile(counter,(await readFile(counter,'utf8')).replace('return value+1;','return value;'));
  await page.evaluate(()=>window.muse.setOptions({executionMode:'full'}));await page.evaluate(()=>window.muse.projectCommand('run'));await untilState(page,s=>s.projectWork.run.status==='ready');
  await page.evaluate(()=>window.muse.testerCommand('start',{request:'Test exactly ONE short case: the Add one button must increase the visible counter from 0 to 1 after one click. Assert this result. Do not retry clicks.'}));
  await untilState(page,s=>!s.testerActive,240000);const result=(await page.evaluate(()=>window.muse.getState())).tester;
  assert.equal(result.issues.length,1,JSON.stringify(result));assert.equal(result.issues[0].status,'confirmed');
  await page.evaluate(id=>window.muse.testerCommand('solve',{id,issues:['BUG-001']}),result.id);await untilState(page,s=>!s.testerActive,480000);
  const solved=(await page.evaluate(()=>window.muse.getState())).tester;assert.equal(solved.solver.status,'verified',JSON.stringify(solved.solver));assert.equal(solved.issues[0].status,'fixed');
  await page.locator('#ai-tester').click();await page.screenshot({path:'artifacts/mora-tester-native.png'});await page.keyboard.press('Escape');await page.locator('.tester-dialog').waitFor({state:'detached'});
  await page.evaluate(()=>window.muse.projectCommand('stop'));const preview=await page.evaluate(id=>window.muse.checkpointCommand('preview',{id}),solved.solver.checkpoint);assert.ok(preview.changes.some(c=>c.path==='src/app.js'));await page.evaluate(p=>window.muse.checkpointCommand('restore',{token:p.token,paths:['src/app.js']}),preview);assert.match(await readFile(counter,'utf8'),/return value;/);assert.equal(await readFile(path.join(root,'dirty.txt'),'utf8'),'later unrelated work');
  await app.close();app=null;page=await launch();await untilState(page,s=>s.projectPath!==null);const saved=await page.evaluate(()=>window.muse.testerCommand('list'));assert.ok(saved.some(r=>r.id===result.id&&r.status==='stale'&&r.issues[0].status==='fixed'));
  tester={report:result.id,confirmed:true,nativeRepair:true,originalReplay:true,checks:solved.solver.checks.status,recovery:true,restart:true};console.log('PASS native AI Tester: confirmed failure, native repair, original assertion, configured checks, source restore and saved report after restart');
 }
 const report={version:JSON.parse(await readFile('package.json','utf8')).version,packaged,legacyProfile:legacy,realMuseEdit:send,account:account.status,starter:true,run:true,counterInteraction:true,annotation:true,checks:work.tests.results.map(({script,status,code})=>({script,status,code})),pageLoad:work.tests.preview.status,pageLoadFailure:true,unrelatedDirtyWorkPreserved:true,checkpointRestore:true,restart:true,ownedProcessCleanup:true,tester};
 await writeFile('artifacts/journey-report.json',JSON.stringify(report,null,2));console.log('PASS native journey: existing sign-in, create, '+(send?'Muse edit, ':'')+'Run, preview interaction, annotation, Test, safe restore and restart');
}}finally{await app?.close();}
