import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/browser-tabs.js').catch(()=>({}));
test('saved tabs bound history and retain only safe web locations, titles and selection',()=>{
 const saved=api.browserTabs({activeId:'a',tabs:[{id:'a',url:'https://example.com',title:'Page',history:{index:1,entries:[{url:'file:///private',title:'Secret'},{url:'https://example.com',title:'Page',pageState:'private form values'}]}},{id:'b',url:'javascript:alert(1)'}]});
 assert.equal(saved.activeId,'a');assert.equal(saved.tabs[0].url,'https://example.com/');assert.equal(saved.tabs[1].url,'');
 assert.deepEqual(saved.tabs[0].history,{index:0,entries:[{url:'https://example.com/',title:'Page'}]});assert.equal(JSON.stringify(saved).includes('private'),false);
 assert.equal(api.browserTabs({tabs:new Array(20).fill({id:'same',url:'https://example.com'})}).tabs.length,1);
 assert.equal(api.browserTabs({tabs:null}).tabs.length,1);
});
