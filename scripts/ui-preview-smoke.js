import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createPreviewServer} from './ui-preview.js';
const require=createRequire(import.meta.url),{chromium}=require('./runtime-packages.cjs').runtimeRequire('playwright');
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#model option').waitFor({state:'attached'});
  assert.match(await page.locator('#ui-preview-label').textContent(),/Sample data/);
  assert.equal(await page.locator('#browser-panel').isVisible(),true);
  assert.equal(await page.locator('#model').inputValue(),'preview-model');
  await page.locator('#effort').selectOption('high');assert.equal((await page.evaluate(()=>window.muse.getState())).reasoningEffort,'high');
  await page.locator('#prompt').fill('Make the layout clearer');await page.locator('#send-button').click();
  await page.getByText('Sample response only. To change Mora, send your browser annotations to Codex.',{exact:true}).waitFor();
  await assert.rejects(page.evaluate(()=>window.muse.projectCommand('run')),/UI preview only/);
  assert.deepEqual(errors,[]);await mkdir('artifacts/ui-preview-proof',{recursive:true});await page.screenshot({path:'artifacts/ui-preview-proof/workspace.png'});
  console.log('PASS: actual renderer, sample-data label, reasoning selection, sample chat and unavailable engine operations; no page errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
