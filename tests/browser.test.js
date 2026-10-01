import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/annotations.js').catch(()=>({}));
test('browser URLs support development servers and reject non-web or credential-bearing URLs',()=>{
  assert.equal(typeof api.browserURL,'function');
  assert.equal(api.browserURL('localhost:3000/design'),'http://localhost:3000/design');
  assert.equal(api.browserURL('example.com'),'https://example.com/');
  for(const url of ['file:///C:/secret','javascript:alert(1)','data:text/html,x','https://user:secret@example.com','ftp://example.com']) assert.throws(()=>api.browserURL(url));
});
test('browser rectangles are finite and constrained to the visible viewport',()=>{
  assert.equal(typeof api.clipRectangle,'function');
  assert.deepEqual(api.clipRectangle({x:-20,y:10,width:150,height:400},200,100),{x:0,y:10,width:130,height:90});
  assert.throws(()=>api.clipRectangle({x:NaN,y:0,width:20,height:20},100,100));
  assert.throws(()=>api.clipRectangle({x:500,y:0,width:20,height:20},100,100));
});
test('browser evidence is bounded, includes the note and remains attached to its source',()=>{
  assert.equal(typeof api.annotationContext,'function');
  const text=api.annotationContext({url:'http://localhost:3000/',title:'Design',selector:'#card',html:'<h1>Heading</h1>',rect:{x:1,y:2,width:3,height:4},styles:{color:'rgb(1, 2, 3)'},mode:'element'},'كبر العنوان');
  assert.match(text,/كبر العنوان/);assert.match(text,/#card/);assert.match(text,/<h1>Heading<\/h1>/);assert.match(text,/page evidence/i);
  assert.match(text,/Screenshot: cropped to this selection's visible area/);
  assert.throws(()=>api.annotationContext({html:'x'.repeat(24001)},''));
});
