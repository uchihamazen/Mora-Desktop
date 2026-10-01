import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { uuid7 } from '../src/msp.js';
import { sessionLogPath } from '../src/runtime.js';
const require = createRequire(import.meta.url);
const { _electron } = require('./runtime-packages.cjs').runtimeRequire('playwright');
const root = path.resolve('.');
const profile = await mkdtemp(path.join(tmpdir(), 'muse-history-profile-'));
const home = path.join(profile, 'native-history');
const sessionId = uuid7();
const filename = sessionLogPath(sessionId, home);
await mkdir(path.dirname(filename), {recursive:true});
await writeFile(filename, [
 {payload:{kind:'run',run_id:'saved-turn',event:{kind:'started',prompt:'Saved message'}}},
 {payload:{kind:'run',run_id:'saved-turn',event:{kind:'assistant_message_committed',text:'SAVED_HISTORY_OK'}}},
].map(x=>JSON.stringify(x)).join('\n')+'\n');
const prefs = path.join(profile,'preferences.json');
await writeFile(prefs, JSON.stringify({workspace:root,museHome:home,executable:path.join(profile,'missing-engine.exe'),sessions:[{sessionId,title:'Saved conversation',workspace:root}],lastSessionId:sessionId}));
const env = {...process.env,MUSE_DESKTOP_TEST_USER_DATA:profile}; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv[2] && path.resolve(process.argv[2]);
const executablePath = packaged || require('electron');
async function launch(cwd) {
 const electron = await _electron.launch({executablePath,args:packaged?[]:[root],cwd,env});
 const page = await electron.firstWindow();
 await page.waitForFunction(async()=>{const s=await window.muse.getState();return s.connection==='disconnected'&&!s.loading;});
 assert.equal(await electron.evaluate(({app})=>app.getPath('userData')),profile);
 return {electron,page};
}
let launched;
try {
 launched = await launch(root);
 let state = await launched.page.evaluate(()=>window.muse.getState());
 assert.equal(state.sessionId,sessionId);
 assert.ok(state.items.some(x=>x.text==='SAVED_HISTORY_OK'));
 await launched.electron.close(); launched=null;
 // Simulate old settings restoring an empty sidebar after an upgrade/test.
 await writeFile(prefs, JSON.stringify({workspace:root,museHome:home,executable:path.join(profile,'missing-engine.exe'),sessions:[],lastSessionId:null}));
 launched = await launch(tmpdir());
 state=await launched.page.evaluate(()=>window.muse.getState());
 assert.equal(state.sessions.length,1);
 assert.equal(state.sessionId,sessionId);
 assert.ok(state.items.some(x=>x.text==='SAVED_HISTORY_OK'));
 await launched.page.locator('.message.assistant').filter({hasText:'SAVED_HISTORY_OK'}).waitFor();
 await mkdir(path.join(root,'artifacts'),{recursive:true});
 await launched.page.screenshot({path:path.join(root,'artifacts/muse-history-restored.png')});
 await launched.page.evaluate(()=>window.muse.newChat());
 await launched.page.evaluate(id=>window.muse.deleteChat(id),sessionId);
 await launched.electron.close(); launched=null;
 launched=await launch(tmpdir());
 state=await launched.page.evaluate(()=>window.muse.getState());
 assert.equal(state.sessions.some(x=>x.sessionId===sessionId),false);
 assert.equal(JSON.parse(await readFile(path.join(profile,'conversations.backup.json'),'utf8')).sessions.some(x=>x.sessionId===sessionId),false);
 console.log('PASS isolated profile: native history available offline; restart from another folder; old settings cannot hide chats; explicit deletion persists');
} finally {await launched?.electron.close();}
