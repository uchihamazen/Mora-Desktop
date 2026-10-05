import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {launchDesktop,waitForCondition,clickControl} from './electron-ui.js';

const profile=await mkdtemp(path.join(tmpdir(),'mora-source-browser-')),held=new Set();
await writeFile(path.join(profile,'preferences.json'),JSON.stringify({workspace:profile,museHome:path.join(profile,'history'),executable:path.join(profile,'missing-engine.exe'),projectPath:null}));
const server=createServer((request,response)=>{
  if(request.url==='/drop'){request.socket.destroy();return;}
  if(request.url==='/pending'){held.add(response);response.on('close',()=>held.delete(response));return;}
  response.setHeader('Content-Type','text/html');
  response.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Recovery fixture</title><h1 id="ready">Local recovery fixture</h1>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`,env={...process.env,MUSE_DESKTOP_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
let desktop,page,desktopPid;
try {
  desktop=await launchDesktop(undefined,env);desktopPid=desktop.process().pid;
  page=desktop.windows().find(candidate=>candidate.url().endsWith('/index.html'));assert.ok(page);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await waitForCondition(page,async()=>{const state=await window.muse.getState();return state.connection==='disconnected'&&!state.loading;});
  await page.locator('#prompt').fill('Preserve this draft through browser failures');await page.evaluate(()=>window.flushMoraDraft());
  await page.locator('#browser-button').click();
  await assert.rejects(page.evaluate(url=>window.muse.browserCommand('navigate',{url}),url+'/drop'),/ERR_|failed/i);
  await waitForCondition(page,async()=>{const state=await window.muse.browserCommand('state');return !state.loading&&!!state.error;});
  assert.equal(await page.locator('#browser-error').isVisible(),true);
  const navigate=target=>page.evaluate(url=>window.muse.browserCommand('navigate',{url}),target);
  await navigate(url);await waitForCondition(page,async()=>{const state=await window.muse.browserCommand('state');return state.deviceReady&&!state.loading&&!state.error;});
  assert.equal(await page.locator('#prompt').inputValue(),'Preserve this draft through browser failures');
  await page.evaluate(url=>{window.pendingNavigation=window.muse.browserCommand('navigate',{url}).then(()=>({completed:true}),error=>({error:error.message}));},url+'/pending');
  await waitForCondition(page,async()=>(await window.muse.browserCommand('state')).loading);
  await navigate(url+'/after-cancel');const cancelled=await page.evaluate(()=>window.pendingNavigation);
  assert.match(cancelled.error,/ERR_ABORTED|abort|failed/i);
  await waitForCondition(page,async()=>{const state=await window.muse.browserCommand('state');return state.url.endsWith('/after-cancel')&&!state.loading&&!state.error;});
  assert.equal(await page.locator('#browser-error').isVisible(),false);
  await desktop.evaluate(({webContents},url)=>webContents.getAllWebContents().find(web=>web.getURL().startsWith(url)).forcefullyCrashRenderer(),url);
  await page.locator('#browser-error').filter({hasText:'Page stopped responding'}).waitFor();
  assert.equal(page.isClosed(),false);assert.equal(await page.locator('#prompt').inputValue(),'Preserve this draft through browser failures');
  await page.locator('#browser-reload').click();
  await waitForCondition(page,async()=>{const state=await window.muse.browserCommand('state');return state.deviceReady&&!state.loading&&!state.error;});
  assert.equal(await desktop.evaluate(({webContents},url)=>webContents.getAllWebContents().find(web=>web.getURL().startsWith(url)).executeJavaScript('!!document.getElementById("ready")'),url),true);
  await clickControl(page,'browser-close');assert.equal(await page.locator('#browser-panel').isVisible(),false);
  await page.locator('#browser-button').click();
  await page.evaluate(url=>{window.shutdownNavigation=window.muse.browserCommand('navigate',{url}).catch(()=>{});},url+'/pending');
  await waitForCondition(page,async()=>(await window.muse.browserCommand('state')).loading);
  assert.deepEqual(errors,[]);
} finally {
  try{await desktop?.close();}
  finally {
    for(const response of held)response.destroy();server.closeAllConnections();
    try{await new Promise(resolve=>server.close(resolve));}
    finally{await rm(profile,{recursive:true,force:true});}
  }
}
assert.throws(()=>process.kill(desktopPid,0));await assert.rejects(access(profile),{code:'ENOENT'});
console.log('PASS native source browser: network retry, navigation cancellation, renderer-crash reload, draft retention and shutdown cleanup; isolated profile, no engine or provider requests');
