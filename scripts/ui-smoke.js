import { createRequire } from 'node:module';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { _electron } = require('./runtime-packages.cjs').runtimeRequire('playwright');
const packagedExecutable = process.argv.slice(2).find(argument => !argument.startsWith('--'));
const executablePath = packagedExecutable || require('electron');
await mkdir('artifacts',{recursive:true});
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
env.MUSE_DESKTOP_TEST_USER_DATA = await mkdtemp(path.join(tmpdir(), 'muse-ui-profile-'));
const electron = await _electron.launch({ executablePath, args: packagedExecutable ? [] : ['.'], cwd:process.cwd(), env, timeout:30000 });
try {
  const page = await electron.firstWindow();
  assert.equal(await page.title(), 'Mora Desktop');
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('#connection-badge')?.textContent === 'Connected', { timeout:30000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.brand-mark,.welcome-emblem,.avatar img')].every(img => img.complete && img.naturalWidth > 0));
  assert.equal(await page.evaluate(() => typeof window.muse?.sendMessage), 'function');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.locator('#prompt').fill('Hello from Mora\nMultiline input works too');
  await page.locator('#prompt').press('Shift+Enter');
  assert.match(await page.locator('#prompt').inputValue(), /Multiline input works too\n/);
  await page.locator('#prompt').fill('');
  await page.screenshot({path:'artifacts/mora-desktop-window.png'});
  if (process.argv.includes('--send')) {
    await page.locator('#effort').selectOption('minimal');
    await page.locator('#prompt').fill('Reply with exactly DESKTOP_UI_OK.');
    await page.locator('#prompt').press('Enter');
    await page.waitForFunction(()=>!document.querySelector('#stop-button')?.hidden);
    await page.locator('#prompt').fill('Reply with exactly DESKTOP_UI_QUEUED.');
    await page.locator('#prompt').press('Enter');
    await page.waitForFunction(()=>document.querySelector('#messages')?.textContent.includes('DESKTOP_UI_OK') && document.querySelector('#messages')?.textContent.includes('DESKTOP_UI_QUEUED') && document.querySelector('#stop-button')?.hidden, {timeout:120000});
    assert.equal(await page.locator('.message.user').count(),2);
    const answers=await page.locator('.message.assistant .message-body').allTextContents();
    assert.equal(answers.length,2);assert.match(answers[0],/DESKTOP_UI_OK/);assert.match(answers[1],/DESKTOP_UI_QUEUED/);
    const completed=await page.evaluate(()=>window.muse.getState());
    assert.equal(completed.lastOutcome.status,'finished');assert.equal(completed.pendingQueue.length,0);assert.equal(completed.activeRequest,null);
    const order=await page.evaluate(()=>{const t=document.querySelector('#messages')?.textContent||'';return[t.indexOf('DESKTOP_UI_OK'),t.indexOf('DESKTOP_UI_QUEUED')]});
    assert.ok(order[0]!==-1&&order[1]!==-1&&order[0]<order[1]);
    await page.screenshot({path:'artifacts/mora-desktop-reply.png'});
    console.log('PASS real Electron send, reply, and busy lifecycle');
    console.log('PASS real Electron queue: two ordered replies');
  }
  assert.deepEqual(errors,[]);
  await writeFile('artifacts/ui-report.json',JSON.stringify({preload:true,isolated:true,multiline:true,errors},null,2));
  console.log('PASS Electron window, preload, isolation and multiline input');
} finally { await electron.close(); }
