import {clickControl} from './electron-ui.js';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {createServer as reserve} from 'node:net';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const require=createRequire(import.meta.url),supplied=process.argv[2],exe=supplied?path.resolve(supplied):require('electron'),version=JSON.parse(await readFile('package.json','utf8')).version;
const base=path.resolve('artifacts/build-temp');await mkdir(base,{recursive:true});const profile=await mkdtemp(path.join(base,'website-journey-'));
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.setHeader('Set-Cookie','session=fixture-session; HttpOnly; SameSite=Lax');res.end('<!doctype html><html lang="en"><title>Counter check</title><main><h1>Counter check</h1><button onclick="document.querySelector(\'output\').textContent=\'Count: 1\'">Increase</button><output aria-label="Counter value">Count: 0</output></main></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
let child,browser,page;
async function launch(){
 const socket=reserve();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
 const env={...process.env,TEMP:base,TMP:base,MUSE_DESKTOP_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
 child=spawn(exe,[...(supplied?[]:['.']),`--remote-debugging-port=${port}`],{cwd:process.cwd(),env,windowsHide:true,stdio:'ignore'});
 const endpoint=`http://127.0.0.1:${port}`,until=Date.now()+40000;let target;
 while(!target){try{target=(await(await fetch(endpoint+'/json/list')).json()).find(t=>t.url.endsWith('/index.html'));}catch{}if(Date.now()>until||child.exitCode!==null)throw Error('Mora did not open for the website journey.');if(!target)await new Promise(r=>setTimeout(r,100));}
 const ws=new WebSocket(target.webSocketDebuggerUrl);await once(ws,'open');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Preview setup timed out')),10000);ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id===1){clearTimeout(timer);m.result?.exceptionDetails?reject(Error('Preview setup failed')):resolve();}});ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:"window.muse.browserCommand('open').then(()=>window.muse.browserCommand('close'))",awaitPromise:true}}));});ws.close();
 browser=await chromium.connectOverCDP(endpoint);page=browser.contexts()[0].pages().find(p=>p.url()===target.url);await page.waitForFunction(()=>document.querySelector('#connection-badge').textContent==='Connected',null,{timeout:45000});
}
async function close(){if(child?.exitCode===null){await page?.evaluate(()=>window.close()).catch(()=>{});await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,8000))]);if(child.exitCode===null){const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await once(killer,'exit');}}await browser?.close().catch(()=>{});}
try {
 await launch();assert.equal((await page.evaluate(()=>window.muse.getState())).projectPath,null);
 await clickControl(page,'website-tester');await page.getByLabel('Website URL',{exact:true}).fill(url);await page.getByLabel('Workflow and expected result',{exact:true}).fill('Click Increase exactly once. Then check that the page contains Count: 1. Finish after that check.');
 await page.getByLabel('What to test').selectOption('workflow');await page.getByRole('button',{name:'Open website',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.website-dialog [role=status]').textContent.startsWith('Ready for you'),null,{timeout:30000});
 await assert.rejects(page.evaluate(()=>window.muse.websiteTesterCommand('solve',{issues:['BUG-001']})),/unavailable|repair/i);
 await page.getByRole('tab',{name:'Setup',exact:true}).click();await page.getByText('Account, screen size and website limits',{exact:true}).click();await page.getByRole('button',{name:'Save this login',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.website-dialog [role=status]').textContent.includes('Login saved'));
 const files=await readdir(path.join(profile,'website-reports','logins'));assert.equal(files.length,1);assert.equal((await readFile(path.join(profile,'website-reports','logins',files[0]))).includes(Buffer.from('fixture-session')),false);
 await page.getByRole('button',{name:'Start checking',exact:true}).click();
 const deadline=Date.now()+240000;let result,approvals=0;
 while(Date.now()<deadline){const state=await page.evaluate(()=>window.muse.getState());result=state.website;if(result.status==='awaiting permission'){const pending=result.pending;if(pending.kind==='case'){const mutations=pending.steps.filter(s=>!['assert','screenshot'].includes(s.action));assert.equal(mutations.length,1);assert.equal(mutations[0].action,'click');assert.equal(mutations[0].targetLabel,'Increase');}else{assert.equal(pending.step.action,'click');assert.equal(pending.control,'Increase');}assert.equal(approvals,0);await page.getByRole('button',{name:pending.kind==='case'?'Allow this case':'Allow once',exact:true}).click();approvals++;}else if(['done','blocked'].includes(result.status))break;await new Promise(r=>setTimeout(r,200));}
 assert.equal(result.status,'done',result.message);assert.equal(approvals,1);assert.ok(result.steps.some(s=>s.action.action==='assert'&&s.result?.status==='passed'),'Native model must execute an assertion');assert.equal(result.findings.length,0);assert.equal('project' in result,false);
 await page.getByRole('tab',{name:'Evidence',exact:true}).click();await page.locator('#website-pane-evidence details').filter({has:page.getByRole('button',{name:'View screenshot',exact:true,includeHidden:true})}).first().locator('summary').click();await page.getByRole('button',{name:'View screenshot',exact:true}).first().click();await page.locator('.website-dialog img').waitFor();await page.screenshot({path:'artifacts/mora-website-tester.png'});
 const started=Date.now();await page.getByRole('button',{name:'Stop and close browser',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.website-dialog [role=status]').textContent.startsWith('Stopped'));const stopMs=Date.now()-started;
 const id=result.id;await close();await launch();const saved=await page.evaluate(id=>window.muse.websiteTesterCommand('load',{id}),id);assert.ok(saved.steps.some(s=>s.result?.status==='passed'));
 const resumed=await page.evaluate(id=>window.muse.websiteTesterCommand('reopen',{id}),id);assert.equal(resumed.id,id);assert.equal(resumed.status,'manual');assert.equal(resumed.steps.length,saved.steps.length);await page.evaluate(()=>window.muse.websiteTesterCommand('stop'));
 await writeFile(`artifacts/website-${supplied?'packaged':'native'}-journey-${version}.json`,JSON.stringify({passed:true,packaged:!!supplied,reportId:id,actions:result.actions,checks:result.steps.filter(s=>s.action.action==='assert').length,approvals,stopMs,restart:true,reopen:true,encryptedLogin:true,sourceIndependent:true},null,2));
 console.log(`PASS ${supplied?'packaged':'native'} website journey: no project, rejected repair, encrypted login, real native click/assertion/evidence, Stop ${stopMs}ms, report recovered after restart`);
}finally{await close();await new Promise(r=>server.close(r));}
