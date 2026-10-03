import {createRequire} from 'node:module';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
import {loadWork,saveWork} from '../src/work.js';
const require=createRequire(import.meta.url);
const {chromium}=require('./runtime-packages.cjs').runtimeRequire('playwright');
const executable=process.argv[2] ? path.resolve(process.argv[2]) : require('electron');
const profile=await mkdtemp(path.join(tmpdir(),'mora-work-profile-'));
const project=await mkdtemp(path.join(tmpdir(),'mora-work-project-'));
const env={...process.env,MUSE_DESKTOP_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
let app;
async function launch() {
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  // Launch normally: Electron's inspector bootstrap can postpone ESM readiness.
  const child=spawn(executable,[...(process.argv[2]?[]:['.']),`--remote-debugging-port=${port}`],{cwd:process.cwd(),env,windowsHide:true,stdio:'ignore'});
  let browser,page;
  const ended=once(child,'close');
  app={process:()=>child,close:async()=>{
    if(child.exitCode===null){await page?.evaluate(()=>window.close()).catch(()=>{});await Promise.race([ended,new Promise(resolve=>setTimeout(resolve,3000))]);}
    if(child.exitCode===null){spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await ended;}
    await browser?.close().catch(()=>{});
  }};
  const endpoint=`http://127.0.0.1:${port}`,deadline=Date.now()+30000;
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
  browser=await chromium.connectOverCDP(endpoint);
  page=browser.contexts()[0].pages().find(candidate=>candidate.url()===target.url);
  if(!page)throw new Error('Desktop window was not available to the test.');return page;
}
try {
  let page=await launch();
  await page.waitForFunction(()=>document.querySelector('#connection-badge').textContent==='Connected');
  const created=await page.evaluate(project=>window.muse.newChat(project),project);
  await page.locator(`.session-row[data-session-id="${created.sessionId}"]`).waitFor();
  const chosenEffort=await page.evaluate(async()=>{const state=await window.muse.getState(),efforts=state.models.find(model=>model.modelId===state.modelId).variants,effort=efforts.includes('low')?'low':efforts[0];await window.muse.setOptions({reasoningEffort:effort});return effort;});
  await page.evaluate(()=>{const timeout=window.setTimeout;window.setTimeout=(fn,delay,...args)=>timeout(fn,delay===200?20000:delay,...args);});
  await page.locator('#prompt').fill('Draft survives an immediate close');
  assert.equal((await loadWork(profile,created.sessionId)).draft.text,'');
  // Closing before the autosave timer fires must flush the current composer.
  const exited=once(app.process(),'exit');
  await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${app.process().pid}).CloseMainWindow()`],{windowsHide:true});
  await exited; await app.close();app=null;
  let work=await loadWork(profile,created.sessionId);
  assert.equal(work.draft.text,'Draft survives an immediate close');
  work.draft.images=[{mediaType:'image/png',base64Data:png,contextText:'Selected HTML',note:'Make this blue',sourceUrl:'http://localhost:3000'}];
  work.pendingQueue=[{queueId:'pending',text:'Saved follow-up',images:[{mediaType:'image/png',base64Data:png}]}];
  work.activeRequest={text:'Interrupted request',images:[],phase:'preparing',turnId:'interrupted'};
  await saveWork(profile,created.sessionId,work);
  page=await launch();
  await page.waitForFunction(()=>document.querySelector('#prompt').value==='Draft survives an immediate close');
  assert.equal(await page.locator('#attachments img').count(),1);
  assert.equal(await page.locator('textarea[aria-label="Note for selection 1"]').inputValue(),'Make this blue');
  assert.equal(await page.locator('.queue-badge').textContent(),'Paused');
  assert.match(await page.locator('.completion-card').textContent(),/Request interrupted/);
  const state=await page.evaluate(()=>window.muse.getState());
  assert.equal(state.busy,false);assert.equal(state.historyMissing,false);
  assert.equal(state.reasoningEffort,chosenEffort);assert.equal(await page.locator('#effort').inputValue(),chosenEffort);
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByRole('textbox',{name:'Edit queued message'}).fill('Edited follow-up');
  await page.getByRole('button',{name:'Save queued message',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.message.queued')?.textContent.includes('Edited follow-up'));
  assert.equal((await loadWork(profile,created.sessionId)).pendingQueue[0].text,'Edited follow-up');
  await page.getByRole('button',{name:'Remove',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.queue-badge').length===0);
  assert.equal((await loadWork(profile,created.sessionId)).pendingQueue.length,0);
  const prefs=JSON.parse(await readFile(path.join(profile,'preferences.json'),'utf8'));
  assert.equal(prefs.sessions.some(session=>session.draft || session.pendingQueue),false);
  console.log('PASS desktop restart: immediate-close draft, annotation/images, paused queue, interrupted receipt, edit/remove, speed preset, separate index');
} finally {await app?.close();}
