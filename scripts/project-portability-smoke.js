import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchDesktop} from './electron-ui.js';
const exec=promisify(execFile),profile=await mkdtemp(path.join(tmpdir(),'mora-portability-'));
const packaged=process.argv[2],output=path.resolve(process.env.MORA_PRODUCT_PROOF_OUTPUT||'artifacts');
const env={...process.env,MUSE_DESKTOP_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
let app,page,root;
async function state(){return page.evaluate(()=>window.muse.getState());}
async function until(predicate,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){const value=await state();if(predicate(value))return value;await new Promise(r=>setTimeout(r,100));}throw Error('Project state did not settle: '+JSON.stringify(await state()));}
async function counter(){
 const run=(await state()).projectWork.run,end=Date.now()+15000;let browser;
 do{browser=await page.evaluate(()=>window.muse.browserCommand('state'));if(browser.open&&!browser.loading&&browser.url===run.url)break;if(Date.now()>end)throw Error('Native preview did not load');await new Promise(r=>setTimeout(r,100));}while(true);
 const view=app.windows().find(p=>p.url()===run.url);assert.ok(view,'The native preview page must be available');
 const size=await app.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents?.getURL()===url).getBounds(),run.url);
 const point=await view.locator('#add').evaluate((element,width)=>{const r=element.getBoundingClientRect(),scale=width/innerWidth;element.addEventListener('click',event=>window.proofTrustedClick=event.isTrusted,{once:true});return {x:Math.round((r.x+r.width/2)*scale),y:Math.round((r.y+r.height/2)*scale)};},size.width);
 await app.evaluate(({webContents},{url,point})=>{const web=webContents.getAllWebContents().find(w=>w.getURL()===url);for(const type of ['mouseMove','mouseDown','mouseUp'])web.sendInputEvent({type,...point,button:'left',clickCount:1});},{url:run.url,point});
 await view.waitForFunction(()=>document.querySelector('#count').textContent==='1');assert.equal(await view.evaluate(()=>window.proofTrustedClick),true);return run.url;
}
try{
 app=await launchDesktop(packaged,env);await app.firstWindow();page=app.windows().find(p=>p.url().endsWith('/index.html'));await until(s=>s.connection==='ready'&&!s.loading);
 await page.locator('#create-project').click();await page.getByLabel('Project name',{exact:true}).fill('Plain site');await page.getByLabel('Project starter',{exact:true}).selectOption('static');
 await app.evaluate(({dialog},parent)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[parent]});},profile);
 await page.getByRole('button',{name:'Choose parent folder',exact:true}).click();await page.getByRole('button',{name:'Create project',exact:true}).click();await until(s=>s.projectPath);root=(await state()).projectPath;
 await page.evaluate(()=>window.muse.setOptions({executionMode:'full'}));await page.locator('#run-project').click();await until(s=>s.projectWork?.run.status==='ready');const originalURL=await counter();
 await page.locator('#welcome-setup').click();await page.getByText('Website runtime: ready',{exact:true}).waitFor();await page.getByRole('button',{name:'Close setup',exact:true}).click();
 await page.evaluate(()=>window.muse.setOptions({executionMode:'readonly'}));await writeFile(path.join(root,'.env'),'PRIVATE');await mkdir(path.join(root,'.mora'),{recursive:true});await writeFile(path.join(root,'.mora','project-brief.md'),'PRIVATE BRIEF');
 const zip=path.join(profile,'shared.zip');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},zip);
 await page.locator('#export-project').click();await page.getByRole('button',{name:'Copy checksum',exact:true}).waitFor();const checksum=(await page.locator('.export-dialog code').textContent()).replace('SHA-256: ','');assert.equal(checksum,createHash('sha256').update(await readFile(zip)).digest('hex'));
 await mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,'project-export.png')});await page.getByRole('button',{name:'Close export',exact:true}).click();
 await page.locator('#stop-project').click();await until(s=>s.projectWork.run.status==='stopped');
 const expanded=path.join(profile,'expanded');const code="Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:MORA_PROOF_ZIP,$env:MORA_PROOF_EXPANDED)";
 await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,env:{...process.env,MORA_PROOF_ZIP:zip,MORA_PROOF_EXPANDED:expanded}});
 const exported=path.join(expanded,'Plain site');for(const name of ['.env','.mora/project-brief.md','package.json'])await assert.rejects(readFile(path.join(exported,name)),/ENOENT/);assert.match(await readFile(path.join(exported,'MORA-RUN-INSTRUCTIONS.txt'),'utf8'),/Run my app/);
 await page.evaluate(folder=>window.muse.newChat(folder),exported);await page.evaluate(()=>window.muse.setOptions({executionMode:'full'}));await page.locator('#run-project').click();await until(s=>s.projectWork.run.status==='ready');const exportedURL=await counter();await page.locator('#stop-project').click();await until(s=>s.projectWork.run.status==='stopped');
 await writeFile(path.join(exported,'package.json'),JSON.stringify({scripts:{start:'node absent-server.js'}}));await page.locator('#prompt').fill('Keep my next request');await page.locator('#run-project').click();await until(s=>s.projectWork.run.status==='failed');await page.locator('#recovery-results').click();assert.equal(await page.locator('#project-results').isVisible(),true);await page.locator('#recovery-setup').click();await page.getByRole('dialog',{name:'Setup readiness',exact:true}).waitFor();await page.getByRole('button',{name:'Close setup',exact:true}).click();assert.equal(await page.locator('#prompt').inputValue(),'Keep my next request');
 await page.screenshot({path:path.join(output,'project-recovery.png')});await writeFile(path.join(output,'project-portability-native.json'),JSON.stringify({packaged:!!packaged,profile,root,zip,checksum,originalURL,exportedURL,staticNativeInteraction:true,exportReopened:true,recoveryPreservedDraft:true},null,2));
 console.log('PASS native plain website, counter interaction, source ZIP checksum/exclusions, exported preview and recovery retaining draft');
}finally{await app?.close();}
