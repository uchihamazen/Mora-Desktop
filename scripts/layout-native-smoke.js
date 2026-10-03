import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchDesktop,clickControl} from './electron-ui.js';
const profile=await mkdtemp(path.join(tmpdir(),'mora-layout-'));
const output=path.resolve(process.env.MORA_LAYOUT_PROOF_OUTPUT||'artifacts/layout-proof');
const env={...process.env,MUSE_DESKTOP_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
let app,page;
async function until(predicate){const end=Date.now()+45000;while(Date.now()<end){const state=await page.evaluate(()=>window.muse.getState());if(predicate(state))return state;await new Promise(r=>setTimeout(r,100));}throw Error('Desktop state did not settle');}
async function nativeView(){return app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0],view=window.contentView.children.find(child=>child.webContents&&child.webContents!==window.webContents);return {visible:view.getVisible(),bounds:view.getBounds()};});}
try{
  app=await launchDesktop(process.argv[2],env);await app.firstWindow();page=app.windows().find(p=>p.url().endsWith('/index.html'));
  await until(state=>state.connection==='ready'&&!state.loading);
  const created=await page.evaluate(parent=>window.muse.createProject({parent,name:'Counter app',starter:'static'}),profile),root=created.projectPath;
  await page.evaluate(async()=>{const state=await window.muse.getState();await window.muse.chatMetadata(state.sessionId,'rename','Plan the first version');});
  for(const title of ['Fix the mobile layout','Make the counter easier to use'])await page.evaluate(async({root,title})=>{const state=await window.muse.newChat(root);await window.muse.chatMetadata(state.sessionId,'rename',title);},{root,title});
  const modelState=await page.evaluate(()=>window.muse.getState()),efforts=modelState.models.find(model=>model.modelId===modelState.modelId).variants;
  assert.equal(await page.locator('#speed').count(),0);assert.deepEqual(await page.locator('#effort option').evaluateAll(options=>options.map(option=>option.value)),efforts);
  const effort=efforts.includes('high')?'high':efforts[0];await page.locator('#effort').selectOption(effort);await until(state=>state.reasoningEffort===effort);
  await page.evaluate(()=>window.muse.setOptions({executionMode:'full'}));await page.locator('#run-project').click();
  const state=await until(s=>s.projectWork?.run.status==='ready'),url=state.projectWork.run.url;
  const end=Date.now()+15000;let web;
  while(Date.now()<end){web=app.windows().find(p=>p.url()===url);if(web&&!await page.evaluate(async()=> (await window.muse.browserCommand('state')).loading))break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(web,'The preview must be a real native page');
  await app.evaluate(({BrowserWindow,screen,app})=>{const area=screen.getPrimaryDisplay().workArea,window=BrowserWindow.getAllWindows()[0];window.setBounds({x:area.x+20,y:area.y+20,width:Math.min(1440,area.width-40),height:Math.min(1024,area.height-40)});window.show();window.focus();app.focus({steal:true});});
  await page.waitForTimeout(300);
  const size=(await nativeView()).bounds;
  const point=await web.locator('#add').evaluate((button,width)=>{const r=button.getBoundingClientRect(),scale=width/innerWidth;button.addEventListener('click',event=>window.trustedCounterClick=event.isTrusted,{once:true});return{x:Math.round((r.x+r.width/2)*scale),y:Math.round((r.y+r.height/2)*scale)};},size.width);
  await app.evaluate(({webContents},{url,point})=>{const web=webContents.getAllWebContents().find(w=>w.getURL()===url);for(const type of ['mouseMove','mouseDown','mouseUp'])web.sendInputEvent({type,...point,button:'left',clickCount:1});},{url,point});
  await web.waitForFunction(()=>document.querySelector('#count').textContent==='1');assert.equal(await web.evaluate(()=>window.trustedCounterClick),true);
  // Sample conversation text is display-only; native commands below use real state.
  const sample={...await page.evaluate(()=>window.muse.getState()),items:[{itemId:'layout-user',kind:'userMessage',text:'Make the counter easier to read on smaller screens.'},{itemId:'layout-answer',kind:'agentMessage',status:'completed',text:'The counter is larger and the buttons are easier to use. Try it in the preview.'},{itemId:'layout-review',kind:'fileChanges',files:[{path:'styles.css',added:12,removed:2,patch:'@@ Sample visual review @@\n-old\n+new'},{path:'index.html',added:18,removed:4,patch:'@@ Sample visual review @@\n-old\n+new'}],added:30,removed:6}],lastOutcome:null};
  await app.evaluate(({BrowserWindow},sample)=>BrowserWindow.getAllWindows()[0].webContents.send('muse:event',{type:'state',state:sample}),sample);
  await page.locator('.message.assistant').waitFor();
  await mkdir(output,{recursive:true});
  // Capture owned Electron surfaces even when the Windows desktop is locked.
  const surfaces=await app.evaluate(async({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0],view=window.contentView.children.find(child=>child.webContents&&child.webContents!==window.webContents);return {shell:(await window.capturePage()).toPNG().toString('base64'),preview:(await view.webContents.capturePage()).toPNG().toString('base64'),bounds:view.getBounds(),contentBounds:window.getContentBounds()};});
  for(const name of ['shell','preview'])await writeFile(path.join(output,'native-'+name+'.png'),Buffer.from(surfaces[name],'base64'));
  await writeFile(path.join(output,'native-bounds.json'),JSON.stringify({bounds:surfaces.bounds,contentBounds:surfaces.contentBounds},null,2));
  const screenshot=path.join(output,'native-shell.png');
  await page.locator('#preview-menu > summary').click();await page.waitForTimeout(100);assert.equal((await nativeView()).visible,false,'The menu must remain above the native page');
  await writeFile(path.join(output,'native-menu.png'),Buffer.from(await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64')),'base64'));
  await page.keyboard.press('Control+k');await page.getByLabel('Search quick actions',{exact:true}).fill('Toggle navigation');await page.keyboard.press('Enter');
  await page.locator('.quick-dialog').waitFor({state:'hidden'});assert.equal(await page.locator('#preview-menu').getAttribute('open'),null);await page.waitForTimeout(100);assert.equal((await nativeView()).visible,true,'The native page should return after the menu and dialog close');
  await page.keyboard.press('Control+b');
  await clickControl(page,'browser-before');await page.waitForFunction(()=>!document.querySelector('#browser-after').disabled);
  await clickControl(page,'browser-after');await page.locator('.comparison-viewer').waitFor();assert.equal((await nativeView()).visible,false);await page.getByRole('button',{name:'Close comparison',exact:true}).click();
  await page.locator('.comparison-viewer').waitFor({state:'detached'});await page.waitForTimeout(100);assert.equal((await nativeView()).visible,true);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1080,760));await page.waitForTimeout(200);
  await clickControl(page,'stop-project');await until(s=>s.projectWork.run.status==='stopped');
  await page.locator('#workspace-menu > summary').click();assert.equal(await page.locator('#run-project').isVisible(),true);await page.keyboard.press('Escape');
  await app.close();app=null;
  const legacyPreferences=JSON.parse(await readFile(path.join(profile,'preferences.json'),'utf8'));legacyPreferences.speedPreset='quick';await writeFile(path.join(profile,'preferences.json'),JSON.stringify(legacyPreferences));
  app=await launchDesktop(process.argv[2],env);await app.firstWindow();page=app.windows().find(p=>p.url().endsWith('/index.html'));
  await until(state=>state.connection==='ready'&&!state.loading);assert.equal((await page.evaluate(()=>window.muse.getState())).reasoningEffort,effort);assert.equal(await page.locator('#effort').inputValue(),effort);
  await writeFile(path.join(output,'native-result.json'),JSON.stringify({profile,screenshot,nativePreview:path.join(output,'native-preview.png'),reasoningEffort:effort,effortPersistence:true,trustedCounterClick:true,menuOcclusion:true,keyboardDialog:true,comparison:true,minimumStoppedHeader:true,visualConversation:'display-only fixture',version:await app.evaluate(({app})=>app.getVersion())},null,2));
  console.log('PASS native layout: direct reasoning levels and restart persistence, real counter pointer, menus, keyboard dialog, comparison, 1080px stopped header. '+screenshot);
}finally{await app?.close();}
