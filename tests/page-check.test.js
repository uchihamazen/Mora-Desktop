import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {browserURL} from '../src/annotations.js';
const source=await readFile(new URL('../src/browser.js',import.meta.url),'utf8'),context=vm.createContext({browserURL,URL,setTimeout,clearTimeout});
vm.runInContext(source.slice(source.indexOf('export class')).replace('export class','class')+'\nglobalThis.Subject=DesktopBrowser;',context);
test('page-load checks fail on current Electron console-error events',async()=>{
 const browser=Object.create(context.Subject.prototype),web=new EventEmitter();browser.view={webContents:web};browser.pageReady=true;browser.state={error:''};browser.command=async()=>{};browser.navigate=async()=>{web.emit('console-message',{level:'error',message:'App exception'});};
 const result=await browser.checkPage('http://localhost:1234');assert.equal(result.status,'failed');assert.match(result.message,/App exception/);assert.equal(web.listenerCount('console-message'),0);
});
