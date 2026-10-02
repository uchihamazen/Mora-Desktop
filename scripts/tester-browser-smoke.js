import {createRequire} from 'node:module';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url),folder=await mkdtemp(path.join(tmpdir(),'mora-browser-check-'));
const fixture=String.raw`
import {app} from 'electron';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
app.setPath('userData',process.env.MORA_TEST_PROFILE);
app.whenReady().then(async()=>{
let browser,server;
try {
 const {TesterBrowser}=await import(pathToFileURL(process.env.MORA_BROWSER_SOURCE));
 server=createServer((req,res)=>{if(req.url==='/api/answer'){res.setHeader('Content-Type','application/json');res.end('{"secret":"answer"}');return;}res.setHeader('Content-Type','text/html');res.end('<title>Browser fixture</title><label>Search<input aria-label="Search"></label><button onclick="document.querySelector(\'output\').textContent=\'Saved\'">Save</button><output>Waiting</output><a href="/next">Next page</a>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 browser=new TesterBrowser(url,process.env.MORA_TEST_PROFILE);await browser.open();
 for(const size of [[1280,800],[640,640],[1000,700]]){
  browser.window.setContentSize(...size);await browser.snapshot();
  await browser.perform({action:'type',target:'Search',text:'abc'});
  assert.equal((await browser.perform({action:'assert',target:'Search',check:'value',expected:'abc'})).passed,true);
  await browser.perform({action:'type',target:'Search',text:''});
  assert.equal((await browser.perform({action:'assert',target:'Search',check:'value',expected:''})).passed,true);
 }
 await browser.script("document.body.insertAdjacentHTML('beforeend','<button role=checkbox aria-checked=true aria-disabled=true aria-label=Updates>Updates</button>')");
 await browser.script("document.body.insertAdjacentHTML('beforeend','<select aria-label=Size><option>Small</option><option disabled>Unavailable</option><option selected>Medium</option><option>Large</option></select>')");
 await browser.perform({action:'select',target:'Size',text:'Large'});assert.equal((await browser.perform({action:'assert',target:'Size',check:'value',expected:'Large'})).passed,true);
 await browser.perform({action:'press',text:'ArrowUp'});assert.equal((await browser.perform({action:'assert',target:'Size',check:'value',expected:'Medium'})).passed,true);
 assert.equal((await browser.perform({action:'assert',target:'Updates',check:'checked',expected:'true'})).passed,true);
 assert.equal((await browser.perform({action:'assert',target:'Updates',check:'disabled',expected:'true'})).passed,true);
 await assert.rejects(browser.perform({action:'assert',target:'Updates',check:'checked',expected:'',present:false}),/expected.*true.*false/i);
 await assert.rejects(browser.perform({action:'assert',target:'Updates',check:'disabled',expected:'disabled'}),/expected.*true.*false/i);
 await assert.rejects(browser.perform({action:'assert',target:'Updates',check:'visible',expected:''}),/expected.*true.*false/i);
 await browser.script("document.querySelector('[aria-label=Updates]').setAttribute('aria-checked','false')");
 assert.equal((await browser.perform({action:'assert',target:'Updates',check:'checked',expected:'false'})).passed,true);
 await assert.rejects(browser.perform({action:'click',target:'Updates'}),/disabled/i);
 await browser.perform({action:'click',target:'Save'});assert.equal((await browser.perform({action:'assert',check:'text',expected:'Saved',present:true})).passed,true);
 assert.equal((await browser.perform({action:'assert',check:'text',expected:'Wrong',present:true})).passed,false);
 await browser.perform({action:'click',target:'Next page'});assert.ok((await browser.snapshot()).url.endsWith('/next'));
 await assert.rejects(browser.perform({action:'navigate',text:'https://example.com'}),/scope|local|allowed/i);
 await assert.rejects(browser.perform({action:'navigate',text:url+'/api/answer'}),/document|HTML|navigation|ERR_BLOCKED/i);
 await browser.reset();assert.ok((await browser.snapshot()).text.includes('Waiting'));
 await browser.close();await assert.rejects(browser.perform({action:'click',target:'Save'}),/closed|stopped/i);
 console.log('PASS dedicated browser: real input at three sizes, clear fields, navigation, assertions, scope and stop');
}catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));app.exit(process.exitCode||0);}
});
`;
await writeFile(path.join(folder,'package.json'),JSON.stringify({type:'module',main:'main.mjs'}));await writeFile(path.join(folder,'main.mjs'),fixture);await mkdir(path.join(folder,'profile'));
const env={...process.env,MORA_TEST_PROFILE:path.join(folder,'profile'),MORA_BROWSER_SOURCE:path.resolve('src/tester-browser.js')};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[folder],{env,windowsHide:true,stdio:'inherit'});
let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},45000);process.exitCode=await new Promise(resolve=>child.once('close',code=>resolve(timedOut?1:code??1)));clearTimeout(timer);
