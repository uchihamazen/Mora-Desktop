import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {uuid7} from '../src/msp.js';
import {launchDesktop,clickControl} from './electron-ui.js';
const profile=await mkdtemp(path.join(tmpdir(),'mora-workspace-')),a=uuid7(),b=uuid7();let hits=0;
const server=createServer(async(req,res)=>{hits++;if(req.url==='/slow')await new Promise(resolve=>setTimeout(resolve,700));res.setHeader('Content-Type','text/html');res.end(`<!doctype html><title>${req.url}</title><h1>${req.url}</h1><label>Page input <input id="input"></label><a href="/two">Second page</a>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
await writeFile(path.join(profile,'preferences.json'),JSON.stringify({lastSessionId:a,sessions:[{sessionId:a,projectPath:null,workspace:path.join(profile,'general-chat'),hasMessages:false,title:'First chat'},{sessionId:b,projectPath:null,workspace:path.join(profile,'general-chat'),hasMessages:false,title:'Second chat'}]}));
const env={...process.env,MUSE_DESKTOP_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;let app,page;
const command=(name,payload)=>page.evaluate(([name,payload])=>window.muse.browserCommand(name,payload),[name,payload]);
async function waitFor(predicate){const deadline=Date.now()+45000;while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Timed out waiting for workspace state.');}
async function launch(){app=await launchDesktop(process.argv[2],env);page=app.context().pages().find(page=>page.url().endsWith('/index.html'));}
async function waitReady(){await waitFor(async()=>{const state=await page.evaluate(()=>window.muse.getState());return state.sessionId && !state.loading && state.connection!=='connecting';});}
async function webPage(url){const deadline=Date.now()+10000;while(Date.now()<deadline){const web=app.context().pages().find(candidate=>candidate.url()===url);if(web)return web;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Native page not found: '+url);}
try {
 await launch();assert.equal((await page.evaluate(()=>window.muse.getState())).sessionId,a,'The saved chat must own the browser before startup controls become available');await command('open');await waitReady();assert.equal((await command('state')).open,true,'Startup reconciliation must keep the opened browser');await command('navigate',{url:origin+'/one'});const first=await webPage(origin+'/one');
 await first.evaluate(()=>{localStorage.setItem('chat-proof','first');document.cookie='chat-proof=first';});
 await page.evaluate(id=>window.muse.resumeChat(id),a);assert.equal((await command('state')).open,true,'Refreshing the same chat must keep its browser');assert.equal((await command('state')).url,origin+'/one');
 await command('navigate',{url:origin+'/two'});let current=await command('state');assert.equal(current.history.entries.length,2);
 await command('history-go',{index:0});await waitFor(async()=>{const state=await command('state');return state.url===origin+'/one' && !state.loading;});
 const firstTab=current.activeTabId;await command('tab-new');const secondTab=(await command('state')).activeTabId;await command('navigate',{url:origin+'/two'});
 await command('tab-select',{id:firstTab});assert.equal((await command('state')).url,origin+'/one');assert.equal((await command('state')).tabs.length,2);
 await page.evaluate(id=>window.muse.resumeChat(id),b);assert.equal((await command('state')).open,false);assert.equal((await command('state')).tabs.length,1);
 await command('open');await command('navigate',{url:origin+'/one'});const other=await webPage(origin+'/one');assert.equal(await other.evaluate(()=>localStorage.getItem('chat-proof')),null);assert.equal(await other.evaluate(()=>document.cookie),'');
 await page.evaluate(id=>window.muse.resumeChat(id),a);await command('open');assert.equal((await command('state')).tabs.length,2);assert.equal((await command('state')).activeTabId,firstTab);
 const restored=await webPage(origin+'/one');assert.equal(await restored.evaluate(()=>localStorage.getItem('chat-proof')),'first');
 await command('tab-new');const racing=(await command('state')).activeTabId;await command('tab-select',{id:firstTab});
 const raced=await page.evaluate(async id=>{await Promise.allSettled([window.muse.browserCommand('tab-select',{id}),window.muse.browserCommand('tab-close',{id})]);return window.muse.browserCommand('state');},racing);
 assert.equal(raced.tabs.some(tab=>tab.id===racing),false);assert.ok(raced.tabs.some(tab=>tab.id===raced.activeTabId));
 // Native focus must survive a sidebar rebuild; its Ctrl+F must not open Mora find.
 await page.locator('.session-options').first().focus();await app.evaluate(({BrowserWindow},url)=>{const window=BrowserWindow.getAllWindows()[0];window.contentView.children.find(view=>view.webContents?.getURL()===url).webContents.focus();},origin+'/one');
 await page.evaluate(id=>window.muse.chatMetadata(id,'rename','First renamed'),a);await page.waitForTimeout(80);
 assert.equal(await app.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows()[0].contentView.children.find(view=>view.webContents?.getURL()===url).webContents.isFocused(),origin+'/one'),true);
 await restored.keyboard.press('Control+f');assert.equal(await page.locator('#conversation-find').isVisible(),false);
 await command('tab-select',{id:secondTab});await command('close');const beforeRestartHits=hits;await app.close();app=null;await launch();await waitReady();assert.equal(hits,beforeRestartHits,'Startup must not navigate remembered pages');
 await command('open');current=await command('state');assert.equal(current.tabs.length,2);assert.equal(current.activeTabId,secondTab);assert.equal(current.url,origin+'/two');
 await page.getByRole('button',{name:'Close tab /one',exact:true}).focus();await page.keyboard.press('Enter');await waitFor(async()=>(await command('state')).tabs.length===1);assert.equal(await page.evaluate(()=>document.activeElement?.dataset.tabId),secondTab);
 for(let i=1;i<8;i++)await command('tab-new');await assert.rejects(()=>command('tab-new'),/8 per chat/);
 await page.locator('#browser-expand').click();await page.locator('#browser-url').focus();await page.keyboard.press('Control+f');assert.equal(await page.locator('#conversation-find').isVisible(),true);await page.keyboard.press('Escape');
 await page.locator('#browser-expand').click();await page.locator('#browser-url').focus();await page.keyboard.press('Control+Shift+f');assert.equal(await page.locator('#library-search').isVisible(),true);assert.equal(await page.locator('#library-search').evaluate(node=>node===document.activeElement),true);
 await clickControl(page,'quick-actions');assert.equal(await page.getByRole('dialog',{name:'Quick actions and shortcuts'}).isVisible(),true);await page.keyboard.press('Escape');
 await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/workspace-tabs.png'});
 await app.close();app=null;
 const saved=JSON.parse(await readFile(path.join(profile,'conversations.backup.json'),'utf8'));assert.equal(saved.sessions.find(session=>session.sessionId===b).browser.tabs[0].url,origin+'/one');assert.equal(JSON.stringify(saved).includes('pageState'),false);
 console.log('PASS workspace: tabs/history/restart, no startup navigation, per-chat storage, native shortcut/focus, tab limit and quick actions');
} finally {await app?.close();await new Promise(resolve=>server.close(resolve));}
