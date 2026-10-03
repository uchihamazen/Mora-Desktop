import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {uuid7} from '../src/msp.js';
import {launchDesktop} from './electron-ui.js';
const require=createRequire(import.meta.url);
const {_electron}=require('./runtime-packages.cjs').runtimeRequire('playwright');
const profile=await mkdtemp(path.join(tmpdir(),'muse-projects-profile-'));
const first=path.join(profile,'Alpha','Muse'),second=path.join(profile,'Beta','Muse');
await mkdir(first,{recursive:true});await mkdir(second,{recursive:true});
const legacyId=uuid7(),otherId=uuid7();
await writeFile(path.join(profile,'preferences.json'),JSON.stringify({workspace:first,executionMode:'full',reasoningEffort:'minimal',lastSessionId:legacyId,sessions:[
 {sessionId:legacyId,title:'Legacy project chat',hasMessages:false,workspace:first},
 {sessionId:otherId,title:'Another project chat',hasMessages:false,workspace:second},
]}));
const packaged=process.argv.slice(2).find(arg=>!arg.startsWith('--'));
const env={...process.env,MUSE_DESKTOP_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
let app,page;
async function waitState(predicate, timeout=120000) {
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline) {const current=await state();if(predicate(current))return current;await new Promise(resolve=>setTimeout(resolve,100));}
 throw new Error('Timed out waiting for project/general chat state.');
}
async function launch() {
 app=await launchDesktop(packaged,env);
 await app.firstWindow();
 const rendererDeadline=Date.now()+15000;
 while(Date.now()<rendererDeadline){page=app.windows().find(window=>/index\.html(?:$|[?#])/.test(window.url()));if(page)break;await new Promise(resolve=>setTimeout(resolve,100));}
 if(!page)throw new Error('Mora renderer did not open.');
 await waitState(s=>s.connection==='ready'&&!s.loading,45000);
}
async function state(){return page.evaluate(()=>window.muse.getState());}
try {
 await launch();
 assert.equal(await page.locator('.project-group').count(),2);
 assert.equal((await state()).sessions.length,2);
 await page.locator('#prompt').fill('Keep this draft');
 await page.evaluate(()=>window.muse.completionSoundOptions(false));
 const remembered=await app.evaluate(({BrowserWindow,screen})=>{const window=BrowserWindow.getAllWindows()[0],area=screen.getPrimaryDisplay().workArea;window.unmaximize();window.setBounds({x:area.x+20,y:area.y+20,width:Math.min(1130,area.width-40),height:Math.min(740,area.height-40)});return window.getNormalBounds();});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].maximize());
 await page.evaluate(async id=>{
  await window.flushMoraDraft();
  await window.muse.chatMetadata(id,'rename','Organized chat');
  await window.muse.chatMetadata(id,'pin');
  await window.muse.chatMetadata(id,'archive');
 },legacyId);
 assert.equal((await state()).sessionId,legacyId);
 await app.close();app=null;
 await writeFile(path.join(profile,'conversations.json'),'{broken');
 await launch();
 const archived=(await state()).sessions.find(s=>s.sessionId===legacyId);
 assert.equal(archived.title,'Organized chat');assert.equal(archived.pinned,true);assert.equal(archived.archived,true);
 assert.equal((await state()).draft.text,'Keep this draft');
 assert.equal((await state()).completionSound,false);
 assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNormalBounds()),remembered);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized()),true);
 assert.equal(await page.locator('#library-archived').getAttribute('aria-pressed'),'true');
 await page.evaluate(id=>window.muse.chatMetadata(id,'restore'),legacyId);
 assert.equal((await state()).sessions.filter(s=>s.sessionId===legacyId).length,1);
 await page.locator('#new-chat').click();
 await waitState(s=>!s.loading&&s.projectPath===null&&s.sessionId);
 const generalId=(await state()).sessionId;
 assert.equal((await state()).workspace,path.join(profile,'general-chat'));
 await page.locator('#general-sessions .session-row').waitFor();
 assert.equal(await page.locator('#general-sessions .session-row').count(),1);
 assert.equal(await page.locator('#execution-mode').isVisible(),false);
 if(process.argv.includes('--send')) {
  await page.locator('#prompt').fill('What is 2 + 2? Reply with the number only, without tools.');
  await page.locator('#prompt').press('Enter');
  const answer=await waitState(s=>!s.busy&&s.items.some(i=>i.kind==='agentMessage'&&i.text));assert.equal(answer.error,'');
  assert.match(answer.items.filter(i=>i.kind==='agentMessage').map(i=>i.text).join('\n'),/4/);
  await page.evaluate(id=>window.muse.resumeChat(id),legacyId);
  await page.evaluate(id=>window.muse.resumeChat(id),generalId);
  const reopened=await state();assert.equal(reopened.historyMissing,false);assert.equal(reopened.error,'');
  await page.locator('#prompt').fill('Add 1 to your previous answer. Reply with the number only, without tools.');
  await page.locator('#send-button').click();
  const continued=await waitState(s=>!s.busy&&s.items.filter(i=>i.kind==='agentMessage'&&i.text).length>=2);
  assert.equal(continued.error,'');assert.equal(continued.sessionId,generalId);
  assert.match(continued.items.filter(i=>i.kind==='agentMessage').at(-1).text,/5/);
 }
 await page.evaluate(folder=>window.muse.newChat(folder),first);
 assert.equal((await state()).projectPath,first);
 assert.equal((await state()).executionMode,'full');
 await page.evaluate(id=>window.muse.resumeChat(id),generalId);
 await app.close();app=null;
 // Registry survives older preferences overwriting settings.
 await writeFile(path.join(profile,'preferences.json'),JSON.stringify({executionMode:'full',sessions:[],lastSessionId:null}));
 await launch();
 const restored=await state();assert.equal(restored.sessionId,generalId);assert.equal(restored.projectPath,null);
 assert.equal(restored.workspace,path.join(profile,'general-chat'));assert.equal(restored.sessions.length,4);
 assert.equal(await page.locator('.project-group').count(),2);
 if(process.argv.includes('--send')) {
  assert.equal(restored.historyMissing,false);assert.equal(restored.error,'');
  assert.equal(restored.items.filter(i=>i.kind==='agentMessage'&&i.text).length,2);
  assert.match(restored.items.filter(i=>i.kind==='agentMessage').at(-1).text,/5/);
  await page.locator('#prompt').fill('Ready for a third message');
  assert.equal(await page.locator('#send-button').isEnabled(),true);
  await page.locator('#prompt').fill('');
 }
 const saved=JSON.parse(await readFile(path.join(profile,'conversations.backup.json'),'utf8'));
 assert.equal(saved.sessions.find(s=>s.sessionId===generalId).projectPath,null);
 await page.screenshot({path:'artifacts/muse-projects-installed.png'});
 console.log(`PASS project grouping, legacy IDs, separate general workspace, retained Full access for projects, restart after settings reset${process.argv.includes('--send')?', two answers in same general context and sending remains enabled':''}`);
} finally {await app?.close();}
