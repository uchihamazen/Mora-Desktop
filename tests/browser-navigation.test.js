import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {browserURL} from '../src/annotations.js';

const source=await readFile(new URL('../src/browser.js',import.meta.url),'utf8');
const context=vm.createContext({browserURL,clearInterval:()=>{},setInterval:()=>({unref(){}}),selectOnPage:function selection(){}});
vm.runInContext(source.replace(/^import .*;\r?$/gm,'').replace('export class DesktopBrowser','class DesktopBrowser')+'\nglobalThis.DesktopBrowser=DesktopBrowser;',context);
function browser(loadURL){return Object.assign(Object.create(context.DesktopBrowser.prototype),{state:{open:true},initialize:async()=>{},cancel:async()=>{},layout:async()=>{},view:{webContents:{loadURL}}});}

test('automatic preview and explicit preview share an in-flight navigation',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),loads=[];
  const page=browser(async url=>{loads.push(url);await gate;});
  const first=page.navigate('http://127.0.0.1:4173'),second=page.navigate('http://127.0.0.1:4173/');
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(loads,['http://127.0.0.1:4173/']);
  release();assert.equal(await first,page.state);assert.equal(await second,page.state);assert.equal(page.navigation,null);
  await page.navigate('http://127.0.0.1:4173/');assert.equal(loads.length,2,'A later explicit preview can reload the page');
});
test('failed preview navigation is visible and can be retried',async()=>{
  let calls=0;const page=browser(async()=>{if(++calls===1)throw Error('Connection refused');});
  await assert.rejects(page.navigate('http://127.0.0.1:4173'),/Connection refused/);
  assert.equal(page.navigation,null);await page.navigate('http://127.0.0.1:4173');assert.equal(calls,2);
  await assert.rejects(page.navigate('file:///private.txt'),/HTTP|https|web address/i);
});
test('annotation becomes ready only after its page listeners are installed',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),page=browser(async()=>{});
  Object.assign(page,{epoch:0,script:async()=>gate,publish:()=>{}});page.state.url='http://127.0.0.1:4173';
  const starting=page.annotate('region');assert.equal(page.state.annotating,false);
  release();await starting;assert.equal(page.state.annotating,true);
});
test('a cancelled annotation installation cannot become ready later',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),page=browser(async()=>{});
  Object.assign(page,{epoch:0,script:async()=>gate,publish:()=>{}});page.state.url='http://127.0.0.1:4173';
  const starting=page.annotate('element');page.clearSelection();release();await starting;
  assert.equal(page.state.annotating,false);
});
