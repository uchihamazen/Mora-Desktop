import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {WebsiteBrowser} from '../src/website-browser.js';
import {normalizeWebsiteScope} from '../src/website-policy.js';
import {startWebsiteFixture} from '../tests/fixtures/website-tester/site.js';
const root=path.resolve('artifacts/build-temp');await mkdir(root,{recursive:true});const fixture=await startWebsiteFixture(),browser=new WebsiteBrowser({directory:await mkdtemp(path.join(root,'website-teaching-')),headless:true});
const events=[];const until=async predicate=>{const end=Date.now()+4000;while(!predicate()){assert.ok(Date.now()<end,'Teaching event timed out');await new Promise(r=>setTimeout(r,30));}};
try{
 await browser.open(normalizeWebsiteScope({url:fixture.url}));await browser.beginTeaching('pick',e=>events.push(e));
 await browser.page.getByLabel('Quantity',{exact:true}).click();await until(()=>events.length>0);assert.equal(events[0].action,'pick');assert.equal(events[0].targetLabel,'Quantity');assert.equal(await browser.page.getByLabel('Quantity',{exact:true}).inputValue(),'1');
 await browser.stopTeaching();events.length=0;await browser.beginTeaching('record',e=>events.push(e));
 await browser.page.getByLabel('Search',{exact:true}).fill('Tea');await until(()=>events.some(e=>e.action==='type'));await browser.page.getByRole('link',{name:'Settings',exact:true}).click();await browser.page.getByLabel('Updates',{exact:true}).check();await until(()=>events.some(e=>e.targetLabel==='Updates'));
 await browser.stopTeaching({drain:true});assert.ok(events.some(e=>e.targetLabel==='Settings'));assert.ok(events.every(e=>!e.error),JSON.stringify(events));
 await browser.page.setContent('<label>Password<input type="password"></label>');events.length=0;await browser.beginTeaching('record',e=>events.push(e));await browser.page.getByLabel('Password').fill('never-store-this');await new Promise(r=>setTimeout(r,200));assert.equal(JSON.stringify(events).includes('never-store-this'),false);
 await browser.stopTeaching();await browser.page.getByLabel('Password').fill('after-stop');await new Promise(r=>setTimeout(r,100));assert.equal(events.length,0);
 await browser.page.setContent('<form><label>Choose me<input id="pick"></label></form>');events.length=0;await browser.beginTeaching('pick',e=>events.push(e));await browser.page.getByLabel('Choose me').focus();await browser.page.keyboard.press('Enter');await until(()=>events.some(e=>e.action==='pick'));assert.equal(events[0].targetLabel,'Choose me');
 await browser.stopTeaching();await browser.page.setContent('<form onsubmit="event.preventDefault()"><label>Notes<input></label><button>Save</button></form>');events.length=0;await browser.page.getByLabel('Notes').focus();await browser.beginTeaching('record',e=>events.push(e));await browser.page.keyboard.press('Enter');await browser.stopTeaching({drain:true});const enterEvents=events.filter(e=>!e.error);const singleEnter=enterEvents.length===1&&enterEvents[0].action==='press';
 events.length=0;await browser.beginTeaching('record',e=>events.push(e));await browser.page.getByLabel('Notes').pressSequentially('x'.repeat(105));await browser.page.getByRole('button',{name:'Save',exact:true}).click();await browser.stopTeaching({drain:true});const overflow=events.some(e=>e.error&&/limit|incomplete/i.test(e.error));assert.ok(singleEnter&&overflow,JSON.stringify({enterEvents,overflow}));
 console.log('PASS browser teaching: selection prevents activation; recording spans navigation; private inputs and stopped events excluded');
}finally{await browser.close();await fixture.close();}
