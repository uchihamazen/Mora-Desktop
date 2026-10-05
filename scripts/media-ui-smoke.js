import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {createPreviewServer} from './ui-preview.js';
import {validateDraft} from '../src/work.js';
import {validateImages} from '../src/images.js';

// Supply finite local clips; binary media and screenshots stay outside source.
const clips=await Promise.all(process.argv.slice(2).map(async file=>{const data=await readFile(file);return {name:path.basename(file),mediaType:file.endsWith('.webm')?'video/webm':'video/mp4',base64Data:data.toString('base64'),size:data.length};}));
assert.ok(clips.length>=2,'Supply a local finite WebM and MP4 fixture.');
const output=process.env.MORA_MEDIA_EVIDENCE;if(output)await mkdir(output,{recursive:true});
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.exposeFunction('checkMediaDraft',value=>validateDraft(value));
 await page.addInitScript(()=>{
  window.mediaProbe={held:null,hold:false,created:0,revoked:0,loaded:0};
  const current=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
  Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{...current,set(value){if(mediaProbe.hold){mediaProbe.held={element:this,value};return;}current.set.call(this,value);}});
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL;URL.createObjectURL=blob=>{mediaProbe.created++;return create.call(URL,blob);};URL.revokeObjectURL=url=>{mediaProbe.revoked++;return revoke.call(URL,url);};
  const load=HTMLMediaElement.prototype.load;HTMLMediaElement.prototype.load=function(){mediaProbe.loaded++;return load.call(this);};
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#prompt').waitFor();
 await page.evaluate(()=>{window.mediaProbe.sent=[];window.mediaProbe.saved=[];const save=window.muse.saveDraft;window.muse.saveDraft=async value=>{await window.checkMediaDraft(value);await save(value);mediaProbe.saved.push(structuredClone(value));};window.muse.sendMessage=async value=>{mediaProbe.sent.push(value);return {accepted:true};};});
 const reset=async id=>{await page.evaluate(async id=>{mediaProbe.hold=false;mediaProbe.held=null;await muse.setOptions({sessionId:id,items:[],draft:{text:'',images:[]},moraMode:{enabled:false,tasks:[],requests:[],replying:false},loading:false,busy:false,pendingQueue:[]});},id);};
 const idle=async()=>{await page.waitForFunction(()=>document.getElementById('media-status').hidden||document.getElementById('media-status').textContent.includes('Turn off'));};
 const picker=async files=>{await page.evaluate(files=>{window.muse.pickImages=async()=>files;},files);await page.locator('#attach-button').click();await idle();};
 const paste=async files=>{await page.evaluate(files=>{const data=new DataTransfer();for(const file of files){const bytes=Uint8Array.from(atob(file.base64Data),char=>char.charCodeAt(0));data.items.add(new File([bytes],file.name,{type:file.mediaType}));}document.getElementById('prompt').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},files);await idle();};
 const drop=async files=>{await page.evaluate(files=>{const data=new DataTransfer();for(const file of files)data.items.add(new File([Uint8Array.from(atob(file.base64Data),char=>char.charCodeAt(0))],file.name,{type:file.mediaType}));document.getElementById('composer').dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));},files);await idle();};
 const snapshot=async()=>{await page.evaluate(()=>window.flushMoraDraft());return page.evaluate(()=>mediaProbe.saved.at(-1));};
 const png={name:'picture.png',mediaType:'image/png',base64Data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',size:68};
 await reset('media-A');await page.locator('#prompt').fill('Check this clip');
 await picker([png,clips.find(clip=>clip.mediaType==='video/webm')]);
 assert.equal(await page.locator('.video-frame').count(),8);assert.equal(await page.locator('.attachment').count(),9);
 const saved=validateDraft(await snapshot());assert.equal(saved.images[1].sourceVideo,'movie.webm');assert.ok(saved.images[8].frameTime>saved.images[1].frameTime);
 validateImages(saved.images);
 const dimensions=await page.locator('.video-frame img').evaluateAll(images=>images.map(image=>[image.naturalWidth,image.naturalHeight]));assert.ok(dimensions.every(([w,h])=>w>0&&h>0&&w<=1280&&h<=1280));
 if(output)await page.screenshot({path:path.join(output,'video-frames.png')});
 await page.evaluate(()=>muse.setOptions({moraMode:{enabled:true,tasks:[],requests:[],replying:false}}));assert.ok(await page.locator('#send-button').isDisabled());assert.match(await page.locator('#media-status').innerText(),/Turn off Mora Mode/);
 await page.evaluate(()=>muse.setOptions({moraMode:{enabled:false,tasks:[],requests:[],replying:false}}));
 await page.locator('#send-button').click();await page.waitForFunction(()=>mediaProbe.sent.length===1);
 const sent=await page.evaluate(()=>mediaProbe.sent[0]);assert.equal(sent.images.length,9);assert.match(sent.text,/Video movie.webm: image 2 at [\d.]+s/);assert.match(sent.text,/original video and audio are not included/);validateImages(sent.images);
 results.push('Finite WebM picker: eight decoded JPEGs, timestamps, normal send and explicit Mora Mode draft preservation');
 await reset('media-B');await paste([clips.find(clip=>clip.mediaType==='video/mp4')]);assert.equal(await page.locator('.video-frame').count(),8);results.push('Finite MP4 paste decoded eight real JPEGs');
 await reset('media-C');await drop([{...clips.find(clip=>clip.mediaType==='video/webm'),mediaType:''}]);assert.equal(await page.locator('.video-frame').count(),8);results.push('File drop recognizes video extension with missing MIME type');
 const restored=validateDraft(await snapshot());await reset('media-D');await page.evaluate(draft=>muse.setOptions({sessionId:'media-C',draft}),restored);assert.equal(await page.locator('.video-frame').count(),8);assert.equal((await snapshot()).images[7].frameTime,restored.images[7].frameTime);results.push('Reopened draft retains frame ownership and times');
 await reset('race-A');await page.evaluate(files=>{mediaProbe.hold=true;window.muse.pickImages=async()=>files;},[clips[0]]);await page.locator('#attach-button').click();await page.waitForFunction(()=>!!mediaProbe.held);
 assert.ok(await page.locator('#send-button').isDisabled());await page.evaluate(()=>muse.setOptions({sessionId:'race-B',draft:{text:'Keep B',images:[]}}));await idle();
 assert.equal(await page.locator('.attachment').count(),0);assert.equal(await page.locator('#prompt').inputValue(),'Keep B');
 await reset('race-A');assert.equal(await page.locator('.attachment').count(),0);results.push('Switching chats during native video seek cancels and cannot leak frames into A or B');
 await page.evaluate(()=>{window.muse.pickImages=()=>new Promise(resolve=>mediaProbe.releasePicker=resolve);});await page.locator('#attach-button').click();await page.waitForFunction(()=>!!mediaProbe.releasePicker);
 await page.evaluate(async files=>{await muse.setOptions({sessionId:'picker-B',draft:{text:'Keep picker B',images:[]}});mediaProbe.releasePicker(files);},[clips[0]]);await idle();assert.equal(await page.locator('.attachment').count(),0);assert.equal(await page.locator('#prompt').inputValue(),'Keep picker B');results.push('Delayed picker result discarded after chat switch');
 await reset('limits');await picker([png]);
 await picker([{...clips[0],size:100*1024*1024+1}]);assert.match(await page.locator('#error-text').textContent(),/100 MB/);assert.equal(await page.locator('.attachment').count(),1);
 await picker([png,{name:'bad.mp4',mediaType:'video/mp4',base64Data:'AAAA',size:3}]);assert.match(await page.locator('#error-text').textContent(),/decoded|track|duration/);assert.equal(await page.locator('.attachment').count(),1);results.push('Oversize/unsupported clip fails without partially altering existing draft');
 for(const add of [paste,drop]){
  await add([{name:'download.png',mediaType:'image/png',base64Data:'bm90IGFuIGltYWdl',size:12}]);assert.match(await page.locator('#error-text').textContent(),/Image format does not match/);assert.equal(await page.locator('.attachment').count(),1);assert.equal((await snapshot()).images.length,1);
 }
 await picker([clips[0],{name:'download.png',mediaType:'image/png',base64Data:'bm90IGFuIGltYWdl',size:12}]);assert.equal(await page.locator('.attachment').count(),1);assert.equal((await snapshot()).images.length,1);results.push('Invalid pasted/dropped images and mixed clip/image batches preserve the valid saved draft');
 await page.evaluate(()=>{mediaProbe.hold=true;});await page.evaluate(files=>{muse.pickImages=async()=>files;},[clips[0]]);await page.locator('#attach-button').click();await page.waitForFunction(()=>!!mediaProbe.held);await page.locator('#media-status button').click();await idle();assert.equal(await page.locator('.attachment').count(),1);
 const cleanup=await page.evaluate(()=>({created:mediaProbe.created,revoked:mediaProbe.revoked}));assert.equal(cleanup.created,cleanup.revoked);results.push('Cancellation and success both release every media object URL');
 await page.evaluate(()=>{mediaProbe.usageCalls=0;muse.usageCommand=async()=>{mediaProbe.usageCalls++;return {tier:'sample',window:{usedPercent:20,resetsAtMs:Date.now()+3600000,windowDurationMins:120},weekly:null,observedAtMs:Date.now()};};});
 await page.locator('#usage-button').click();await page.getByText('2-hour window',{exact:true}).waitFor();assert.match(await page.locator('#usage-body').innerText(),/80% left/);assert.match(await page.locator('#usage-body').innerText(),/Weekly\s+Unavailable/);assert.equal(await page.locator('.usage-fill').first().evaluate(el=>el.style.width),'80%');
 if(output)await page.screenshot({path:path.join(output,'usage-panel.png')});
 await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('usage-button').getAttribute('aria-expanded')==='false');await page.locator('#usage-button').click();assert.equal(await page.evaluate(()=>mediaProbe.usageCalls),1);
 await page.evaluate(()=>{muse.usageCommand=async()=>{throw Error('Usage request failed (429).');};});await page.locator('#usage-refresh').click();await page.getByText('Usage request failed (429).',{exact:true}).waitFor();assert.match(await page.locator('#usage-summary').innerText(),/Stale/);
 await page.setViewportSize({width:920,height:720});await page.keyboard.press('Escape');await page.locator('#usage-button').click();const rect=await page.locator('#usage-popover').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=920&&rect.y>=0);if(output)await page.screenshot({path:path.join(output,'usage-compact.png')});results.push('Usage: real window label, missing weekly quota, Escape/reopen, no automatic polling, stale failed refresh and compact layout');
 assert.deepEqual(errors,[]);if(output)await writeFile(path.join(output,'media-ui-results.json'),JSON.stringify({passed:true,results,cleanup,dimensions},null,2));
 console.log('PASS media UI: '+results.join('; '));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
