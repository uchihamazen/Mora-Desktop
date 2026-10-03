import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {once} from 'node:events';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchDesktop,clickControl} from './electron-ui.js';
const require=createRequire(import.meta.url),profile=await mkdtemp(path.join(tmpdir(),'mora-product-loop-'));
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const packaged=process.argv.slice(2).find(arg=>!arg.startsWith('--')),send=process.argv.includes('--send');
const output=path.resolve(process.env.MORA_PRODUCT_PROOF_OUTPUT||'artifacts');
const env={...process.env,PORT:String(port),MUSE_DESKTOP_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
let app,page,project,chat;const metrics={};
async function state(){return page.evaluate(()=>window.muse.getState());}
async function until(predicate,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){const value=await state();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Product loop did not settle: '+JSON.stringify(await state()));}
async function launch(){const start=Date.now();app=await launchDesktop(packaged,env);await app.firstWindow();page=app.windows().find(p=>p.url().endsWith('/index.html'));assert.ok(page);await until(s=>s.connection==='ready'&&!s.loading);metrics[metrics.startupToConnectedMs===undefined?'startupToConnectedMs':'restartToConnectedMs']=Date.now()-start;}
try {
 await launch();const initialState=await state();assert.ok(initialState.models.find(model=>model.modelId===initialState.modelId));
 await page.locator('#welcome-setup').click();await page.getByRole('dialog',{name:'Setup readiness'}).waitFor();await page.getByText('Node.js: ready',{exact:true}).waitFor();await page.getByRole('button',{name:'Close setup'}).click();
 await page.evaluate(parent=>window.muse.createProject({parent,name:'First app',starter:true}),profile);project=(await state()).projectPath;chat=(await state()).sessionId;
 await page.evaluate(()=>window.muse.setOptions({executionMode:'full'}));
 const startSwitch=Date.now();for(let i=0;i<5;i++){await page.evaluate(folder=>window.muse.newChat(folder),project);await page.evaluate(id=>window.muse.resumeChat(id),chat);}metrics.fiveChatSwitchPairsMs=Date.now()-startSwitch;
 await clickControl(page,'project-brief');await page.getByLabel('Shared project brief',{exact:true}).fill('# Goal\nBuild the counter.\n\n# Acceptance marker\nBLUE-SHOP-42');await page.getByRole('button',{name:'Save brief',exact:true}).click();await page.getByText('Brief saved. The next request will use it.',{exact:true}).waitFor();await page.getByRole('button',{name:'Close brief'}).click();
 const pkg=JSON.parse(await readFile(path.join(project,'package.json'),'utf8'));pkg.scripts['test:flows']='node tests/flows.js';await writeFile(path.join(project,'package.json'),JSON.stringify(pkg,null,2));
 await writeFile(path.join(project,'tests','flows.js'),`import {createRequire} from 'node:module';import assert from 'node:assert/strict';const {chromium}=createRequire(import.meta.url)(${JSON.stringify(require.resolve('playwright'))});const browser=await chromium.launch({channel:'msedge',headless:true});try{const page=await browser.newPage();await page.goto('http://127.0.0.1:${port}');assert.equal(await page.locator('#count').textContent(),'0');await page.locator('#add').click();assert.equal(await page.locator('#count').textContent(),'1');console.log('PASS essential browser flow: Add one updates the counter');}finally{await browser.close();}`);
 await page.locator('#run-project').click();await until(s=>s.projectWork?.run.status==='ready');await clickControl(page,'preview-project');
 const previewDeadline=Date.now()+15000;let previewState;do{previewState=await page.evaluate(()=>window.muse.browserCommand('state'));if(previewState.open&&!previewState.loading&&previewState.url.includes(String(port)))break;if(Date.now()>previewDeadline)throw Error('Preview did not load');await new Promise(resolve=>setTimeout(resolve,100));}while(true);
 const nativeURLs=await app.evaluate(({webContents})=>webContents.getAllWebContents().map(w=>({url:w.getURL(),type:w.getType()})));
 const native=nativeURLs.find(w=>/^http:\/\/(?:localhost|127\.0\.0\.1):/.test(w.url));assert.ok(native,'Preview missing');assert.ok(native.url.includes(String(port)));
 await page.locator('#test-project').click();await until(s=>s.projectWork?.tests.status==='passed'&&!s.projectOperation);assert.equal((await state()).projectWork.tests.interactions,'passed');
 await clickControl(page,'project-output');await page.getByText(/Only assertions in this script are covered/).waitFor();
 await mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,'product-loop-checks.png')});
 const previewPNG=await app.evaluate(async({BrowserWindow},url)=>{const view=BrowserWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents?.getURL()===url);return (await view.webContents.capturePage()).toPNG().toString('base64');},native.url);await writeFile(path.join(output,'product-loop-preview.png'),Buffer.from(previewPNG,'base64'));
 const source=await readFile(path.join(project,'src','app.js'),'utf8');await writeFile(path.join(project,'src','app.js'),source.replace('return value+1','return value+2'));await page.locator('#test-project').click();await until(s=>s.projectWork?.tests.status==='failed'&&!s.projectOperation);assert.equal((await state()).projectWork.tests.interactions,'failed');
 await writeFile(path.join(project,'src','app.js'),source);await page.locator('#test-project').click();await until(s=>s.projectWork?.tests.status==='passed'&&!s.projectOperation);
 await clickControl(page,'stop-project');await until(s=>s.projectWork?.run.status==='stopped');
 if(send){await page.locator('#prompt').fill('Create only request-result.txt in the project containing the exact acceptance marker from the shared project brief. Do not change other files or run the app.');await page.locator('#send-button').click();await until(s=>s.busy);const done=await until(s=>!s.busy&&s.lastOutcome,180000);assert.equal(done.lastOutcome.status,'finished');assert.ok(done.lastOutcome.checkpointId);assert.match(await readFile(path.join(project,'request-result.txt'),'utf8'),/BLUE-SHOP-42/);
 await writeFile(path.join(project,'user-kept.txt'),'later user work');await page.getByRole('button',{name:'Undo this request',exact:true}).click();await page.getByRole('button',{name:'Restore selected files'}).click();await page.getByText(/Restored \d+ files/).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();await assert.rejects(readFile(path.join(project,'request-result.txt')),/ENOENT/);assert.equal(await readFile(path.join(project,'user-kept.txt'),'utf8'),'later user work');}
 const currentState=await state(),available=currentState.models.find(model=>model.modelId===currentState.modelId).variants,selectedEffort=available.at(-1);await page.locator('#effort').selectOption(selectedEffort);await until(s=>s.reasoningEffort===selectedEffort);await app.close();app=null;await launch();assert.equal((await state()).reasoningEffort,selectedEffort);
 await clickControl(page,'project-brief');assert.match(await page.getByLabel('Shared project brief',{exact:true}).inputValue(),/BLUE-SHOP-42/);await page.getByRole('button',{name:'Close brief'}).click();
 await new Promise(resolve=>setTimeout(resolve,1000));metrics.processSnapshot=await app.evaluate(({app})=>app.getAppMetrics().map(({type,cpu,memory})=>({type,cpuPercent:cpu.percentCPUUsage,workingSetKB:memory.workingSetSize})));
 await writeFile(path.join(output,'product-loop-native.json'),JSON.stringify({profile,project,packaged:!!packaged,realEngineEditAndUndo:send,metrics},null,2));console.log(JSON.stringify({profile,project,metrics},null,2));console.log('PASS native product loop: setup, shared brief, preview, healthy/faulty flow checks, effort persistence'+(send?', actual engine edit and selective Undo':''));
}finally{await app?.close();}
