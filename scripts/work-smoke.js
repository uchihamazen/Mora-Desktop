import {launchDesktop} from './electron-ui.js';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {loadWork,saveWork} from '../src/work.js';
const packaged=process.argv[2];
const profile=await mkdtemp(path.join(tmpdir(),'mora-work-profile-'));
const project=await mkdtemp(path.join(tmpdir(),'mora-work-project-'));
const env={...process.env,MUSE_DESKTOP_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
let app;
async function launch() {
  app=await launchDesktop(packaged,env);
  const page=app.context().pages().find(candidate=>candidate.url().endsWith('/index.html'));
  assert.ok(page,'Desktop window is available to the restart test');
  return page;
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
  const closed=app.waitForEvent('close');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('/index.html')).close());
  await closed;app=null;
  let work=await loadWork(profile,created.sessionId);
  assert.equal(work.draft.text,'Draft survives an immediate close');
  work.draft.images=[{mediaType:'image/png',base64Data:png,contextText:'Selected HTML',note:'Make this blue',sourceUrl:'http://localhost:3000'}];
  work.pendingQueue=[{queueId:'pending',text:'Saved follow-up',images:[{mediaType:'image/png',base64Data:png}]}];
  work.activeRequest={text:'Interrupted request',images:[],phase:'preparing',turnId:'interrupted'};
  await saveWork(profile,created.sessionId,work);
  page=await launch();
  await page.waitForFunction(()=>document.querySelector('#connection-badge').textContent==='Connected');
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
  console.log('PASS desktop restart: immediate-close draft, annotation/images, paused queue, interrupted receipt, edit/remove, reasoning effort, separate index');
} finally {await app?.close();}
