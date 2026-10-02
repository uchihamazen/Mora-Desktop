import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {WebsiteBrowser} from '../src/website-browser.js';
import {normalizeWebsiteScope,stepFingerprint} from '../src/website-policy.js';

const root=path.resolve('artifacts/build-temp');await mkdir(root,{recursive:true});
const directory=await mkdtemp(path.join(root,'website-browser-'));
let mutations=0,externalHits=0;
const other=createServer((req,res)=>{externalHits++;res.end('External page');});await new Promise(r=>other.listen(0,'127.0.0.1',r));const external=`http://127.0.0.1:${other.address().port}`;
const server=createServer((req,res)=>{
 if(req.url==='/redirect'){res.writeHead(302,{Location:external});return res.end();}
 if(req.url==='/change'){mutations++;return res.end('Changed');}
 res.setHeader('Content-Type','text/html');
 if(req.url==='/frame')return res.end('<label>Frame search<input></label><button onclick="this.textContent=\'Frame done\'">Frame action</button>');
 res.end(`<title>Website fixture</title><label>Search<input id="q"></label><label>Password<input type="password" value="never-show"></label><label>Size<select><option>Small</option><option>Large</option></select></label><button onclick="document.querySelector('output').textContent='Saved'">Save</button><output>Waiting</output><a href="/change">Delete account</a><a href="/redirect">Redirect</a><button onclick="window.open('/frame')">Open popup</button><iframe title="Nested" src="/frame"></iframe><script>setTimeout(()=>{let b=document.createElement('button');b.textContent='Delayed';document.body.append(b)},150)</script>`);
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`,scope=normalizeWebsiteScope({url});
const browser=new WebsiteBrowser({directory,executablePath:process.argv[2],headless:true});
try {
 await browser.open(scope);browser.manual=false;browser.page.on('pageerror',e=>console.log('Fixture page error:',e.message));
 async function action(name,target,value,check,expected){const obs=await browser.observe();const control=obs.controls.find(c=>c.name===target);const step={action:name,observationId:obs.id,target:control?.id||'',value,check,expected,basis:'The fixture specification requires this result.'};browser.grant(stepFingerprint(step,browser.observation,browser.policy.version));const result=await browser.perform(step);if(result.status==='blocked')console.log(name,target,result.reason);return result;}
 let obs=await browser.observe();assert.equal(JSON.stringify(obs).includes('never-show'),false);
 const link=obs.controls.find(c=>c.name==='Delete account');
 assert.equal((await browser.perform({action:'click',target:link.id,observationId:obs.id})).status,'pending');assert.equal(mutations,0);
 assert.equal((await action('type','Search','abc')).status,'ok');
 assert.equal((await action('assert','Search',undefined,'value','abc')).status,'passed');
 assert.equal((await action('select','Size','Large')).status,'ok');
 assert.equal((await action('click','Save')).status,'ok');
 assert.equal((await action('assert','',undefined,'text','Saved')).status,'passed');
 assert.equal((await action('assert','',undefined,'text','Impossible result')).status,'failed');
 assert.equal((await action('click','Frame action')).status,'ok');
 assert.equal((await action('click','Open popup')).status,'ok');
 assert.equal((await browser.observe()).url,url+'/frame');
 await browser.page.goto(url);await browser.observe();
 await action('click','Redirect');assert.equal(externalHits,0,'out-of-scope redirect must never reach target');
 await browser.page.goto(url);obs=await browser.observe();const old={action:'click',target:obs.controls.find(c=>c.name==='Save').id,observationId:obs.id};await browser.observe();assert.equal((await browser.perform(old)).status,'blocked');
 const image=await browser.capture();assert.match(image.name,/^screen-/);
 await browser.page.setContent('<p>Search ready is the completion message.</p><output aria-label="Search status">Searching</output>');
 assert.equal((await action('assert','Search status',undefined,'text','Search ready')).status,'failed','Instructions outside the target cannot satisfy a readiness check');
 await browser.page.setContent('<label>Background search<input></label><iframe src="/frame"></iframe><dialog><button>Cancel</button></dialog><script>document.querySelector("dialog").showModal()</script>');
 assert.equal((await action('type','Background search','Tea')).status,'blocked','A modal prevents background input even when fill reports success');
 await browser.page.frameLocator('iframe').getByLabel('Frame search').waitFor();
 assert.equal((await action('type','Frame search','Tea')).status,'blocked','A parent modal also prevents input in background frames');
 await browser.page.setContent('<button disabled onclick="window.mutated=true">Waiting save</button>');
 obs=await browser.observe();const waiting={action:'click',target:obs.controls[0].id,observationId:obs.id};browser.grant(stepFingerprint(waiting,browser.observation,browser.policy.version));
 const pending=browser.perform(waiting);await new Promise(r=>setTimeout(r,100));await browser.takeOver();
 assert.equal(browser.closed,true,'Take over must cancel an already-waiting browser action');
 assert.notEqual((await pending).status,'ok');
 await browser.close();assert.equal(browser.browser.isConnected(),false);
 console.log('PASS website browser: typed checks, frame/popup, denied mutation, blocked redirect, redaction, evidence and owned cleanup');
}finally{await browser.close();await new Promise(r=>server.close(r));await new Promise(r=>other.close(r));}
