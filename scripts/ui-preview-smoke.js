import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createPreviewServer} from './ui-preview.js';
const require=createRequire(import.meta.url),{chromium}=require('./runtime-packages.cjs').runtimeRequire('playwright');
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#model option').waitFor({state:'attached'});
  assert.match(await page.locator('#ui-preview-label').textContent(),/Sample data/);
  assert.equal(await page.locator('#browser-panel').isVisible(),true);
  assert.equal(await page.locator('#model').inputValue(),'preview-model');
  await page.locator('#effort').selectOption('high');assert.equal((await page.evaluate(()=>window.muse.getState())).reasoningEffort,'high');
  await page.locator('#prompt').fill('Make the layout clearer');await page.locator('#send-button').click();
  await page.getByText('Sample response only. To change Mora, send your browser annotations to Codex.',{exact:true}).waitFor();
  await assert.rejects(page.evaluate(()=>window.muse.projectCommand('run')),/UI preview only/);
  // Codex's page overlay uses an injected style inside a shadow root. A strict
  // style-src leaves an unstyled, centered browser-default popover in its place.
  await page.evaluate(()=>{const host=document.createElement('div');host.id='annotation-style-proof';document.documentElement.append(host);const root=host.attachShadow({mode:'open'}),style=document.createElement('style'),popover=document.createElement('div');style.textContent='[popover]{box-sizing:border-box;position:fixed;inset:auto;top:80px;left:400px;margin:0;width:320px;height:180px;background:rgb(23,27,34);color:white;border:0;padding:12px}textarea{width:100%;height:90px;color:white;background:#10141b}button{background:#1678e7;color:white}';popover.setAttribute('popover','manual');popover.innerHTML='<textarea aria-label="Annotation regression note"></textarea><button>Save note</button>';popover.querySelector('button').onclick=()=>{host.dataset.note=popover.querySelector('textarea').value;popover.hidePopover();};root.append(style,popover);popover.showPopover();});
  const popup=page.locator('#annotation-style-proof [popover]');
  assert.equal(await popup.evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(23, 27, 34)','Injected annotation UI must be styled rather than a white browser-default box');
  const popupBounds=await popup.boundingBox();assert.equal(popupBounds.width,320);assert.equal(popupBounds.x,400);assert.equal(popupBounds.y,80);
  await mkdir('artifacts/ui-preview-proof',{recursive:true});await page.screenshot({path:'artifacts/ui-preview-proof/annotation-overlay.png'});
  await page.getByRole('textbox',{name:'Annotation regression note'}).fill('Make this clearer');await page.getByRole('button',{name:'Save note',exact:true}).click();assert.equal(await page.locator('#annotation-style-proof').getAttribute('data-note'),'Make this clearer');assert.equal(await popup.isVisible(),false);await page.locator('#annotation-style-proof').evaluate(node=>node.remove());
  assert.deepEqual(errors,[]);await page.screenshot({path:'artifacts/ui-preview-proof/workspace.png'});
  console.log('PASS: actual renderer, sample-data label, reasoning selection, sample chat, unavailable engine operations and styled shadow-root annotation popup with note save; no page or console errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
