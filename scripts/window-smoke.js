import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {_electron}=require('./runtime-packages.cjs').runtimeRequire('playwright');
const executable=process.argv[2] || require('electron');
const args=process.argv[2] ? [] : ['.'];
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
env.MUSE_DESKTOP_TEST_USER_DATA=await mkdtemp(path.join(tmpdir(),'muse-window-profile-'));
const app=await _electron.launch({executablePath:executable,args,cwd:process.cwd(),env});
try {
  const page=await app.firstWindow();
  await page.locator('#connection-badge').filter({hasText:'Connected'}).waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  const second=spawn(executable,args,{cwd:process.cwd(),env,windowsHide:true,stdio:'ignore'});
  const ended=once(second,'close');
  const deadline=Date.now()+5000;
  let visible=false;
  while(Date.now()<deadline) {
    visible=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible());
    if(visible)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(visible,true,'Opening Muse again must show its hidden existing window');
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
  await ended;
  console.log('PASS desktop launch: reopening shows the existing hidden window without creating another instance');
} finally {await app.close();}
