import {mkdtemp,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchDesktop} from './electron-ui.js';
import {saveWork} from '../src/work.js';

const profile=await mkdtemp(path.join(tmpdir(),'mora-features-')),output=path.resolve('artifacts/features-proof');
const env={...process.env,MUSE_DESKTOP_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
let desktop,page;
try{
  desktop=await launchDesktop(undefined,env);await desktop.firstWindow();page=desktop.windows().find(page=>page.url().endsWith('/index.html'));
  await page.waitForFunction(async()=>{const state=await window.muse.getState();return state.connection==='ready'&&!state.loading;},null,{timeout:45000});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  // All Trello traffic is replaced inside this isolated process. No provider request occurs.
  await desktop.evaluate(({Menu})=>{
    globalThis.trelloFixtureCalls=[];
    globalThis.fetch=async url=>{
      const pathname=new URL(url).pathname;globalThis.trelloFixtureCalls.push(pathname);
      const value=pathname.endsWith('/members/me')?{username:'fixture-user'}:pathname.endsWith('/lists')?[{name:'To do'},{name:'Done'}]:{name:'Fixture board',url:'https://trello.com/b/abc12345/fixture'};
      return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
    };
    const build=Menu.buildFromTemplate;
    Menu.buildFromTemplate=template=>{const menu=build.call(Menu,template);globalThis.nativeFeatureMenu=menu;globalThis.nativeFeatureRoles=template.map(item=>item.role||item.label||item.type);return menu;};
  });
  await page.locator('#settings-button').click();await page.getByRole('dialog',{name:'Settings',exact:true}).waitFor();
  assert.equal(await page.locator('#trello-connect').isDisabled(),true);
  await page.locator('#trello-key').fill('k'.repeat(32));await page.locator('#trello-token').fill('t'.repeat(64));await page.locator('#trello-board').fill('https://trello.com/b/abc12345/fixture');
  await page.locator('#trello-test').click();await page.locator('#trello-status').filter({hasText:'press Connect to save'}).waitFor();
  await assert.rejects(readFile(path.join(profile,'trello.json')),{code:'ENOENT'});
  await page.locator('#trello-connect').click();await page.locator('#trello-status').filter({hasText:'Board verified'}).waitFor();
  assert.equal(await page.locator('#trello-key').inputValue(),'');assert.equal(await page.locator('#trello-token').inputValue(),'');
  assert.equal(JSON.parse(await readFile(path.join(profile,'trello.json'),'utf8')).board,'abc12345');
  const status=await page.evaluate(()=>window.muse.trelloCommand('state'));assert.equal(status.boardName,'Fixture board');assert.doesNotMatch(JSON.stringify(status),/kkkkkkkk|tttttttt/);
  await page.locator('#trello-test').click();await page.locator('#trello-status').filter({hasText:'Board verified'}).waitFor();
  assert.equal((await desktop.evaluate(()=>globalThis.trelloFixtureCalls)).length,9);
  await mkdir(output,{recursive:true});await writeFile(path.join(output,'settings.png'),Buffer.from(await desktop.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64')),'base64'));
  for(const name of ['trello.json','trello.backup.json','trello.json.tmp','trello.backup.json.tmp'])await writeFile(path.join(profile,name),'{');
  await page.locator('#trello-disconnect').click();await page.locator('#trello-status').filter({hasText:'Not connected'}).waitFor();assert.equal((await page.evaluate(()=>window.muse.trelloCommand('state'))).configured,false);
  for(const name of ['trello.json','trello.backup.json','trello.json.tmp','trello.backup.json.tmp'])await assert.rejects(readFile(path.join(profile,name)),{code:'ENOENT'});
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  const created=await page.evaluate(parent=>window.muse.createProject({parent,name:'Ported project',starter:'static'}),profile),root=created.projectPath,firstId=created.sessionId;
  await page.getByRole('button',{name:'Rename New conversation',exact:true}).click();await page.getByLabel('Rename chat',{exact:true}).fill('Inline native rename');await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Options for Inline native rename',exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.muse.getState())).sessions.find(chat=>chat.sessionId===firstId).customTitle,true);
  await page.getByRole('button',{name:'Rename Inline native rename',exact:true}).click();await page.getByLabel('Rename chat',{exact:true}).fill('Cancelled');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Options for Inline native rename',exact:true}).waitFor();
  const kept=await page.evaluate(parent=>window.muse.createProject({parent,name:'Kept project',starter:false}),profile);
  await page.evaluate(id=>window.muse.chatMetadata(id,'archive'),firstId);
  const current=await page.evaluate(root=>window.muse.newChat(root),root),currentId=current.sessionId;
  await saveWork(profile,firstId,{draft:{text:'fixture draft',images:[]},pendingQueue:[{queueId:'fixture-q',text:'pending',images:[]}],activeRequest:null});
  await assert.rejects(page.evaluate(root=>window.muse.removeProject(root),root),/queued or pending/);
  assert.equal((await page.evaluate(()=>window.muse.getState())).projects.includes(root),true);
  await saveWork(profile,firstId,{draft:{text:'fixture draft',images:[]},pendingQueue:[],activeRequest:null});
  await page.getByRole('button',{name:'Remove project Ported project',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await page.evaluate(()=>window.muse.getState())).projects.includes(root),true);
  await page.getByRole('button',{name:'Remove project Ported project',exact:true}).click();await page.getByRole('button',{name:'Remove project',exact:true}).click();await page.locator('.project-remove-dialog').waitFor({state:'hidden'});
  const removed=await page.evaluate(()=>window.muse.getState());assert.equal(removed.projectPath,null);assert.equal(removed.sessionId,null);assert.equal(removed.sessions.some(chat=>[firstId,currentId].includes(chat.sessionId)),false);assert.ok(removed.sessions.some(chat=>chat.sessionId===kept.sessionId));assert.equal((await stat(root)).isDirectory(),true);await readFile(path.join(root,'index.html'));
  await page.locator('#prompt').fill('Right click editing fixture');await page.locator('#prompt').click({button:'right'});
  const deadline=Date.now()+5000;let roles;
  while(Date.now()<deadline){roles=await desktop.evaluate(()=>globalThis.nativeFeatureRoles);if(roles)break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.ok(roles?.includes('paste'));assert.ok(roles?.includes('selectAll'));await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'result.json'),JSON.stringify({version:await desktop.evaluate(({app})=>app.getVersion()),inlineRename:true,projectRemoval:true,archivedChatRemoval:true,queuedWorkProtection:true,sourceFolderPreserved:true,nativeContextMenuRoles:roles,trello:'mocked provider; real IPC, profile persistence and corrupt Disconnect',noProviderRequests:true,noExecutableBuild:true},null,2));
  console.log('PASS: native source-mode inline rename/cancel, project confirmation/removal/queue guards and preserved source, right-click editing menu, Trello real IPC/persistence with mocked provider and corrupt-settings recovery.');
}finally{await desktop?.close();}
