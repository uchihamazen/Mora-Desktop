import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDraft} from '../src/work.js';
import {changeAnnotation} from '../src/annotation-notes.js';
const ref={id:'note-1',tabId:'tab-1',documentId:'doc-1',mode:'element',rect:{x:10,y:20,width:30,height:40},viewport:{width:1280,height:720}};
const capture={mediaType:'image/png',base64Data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',contextText:'Untrusted page evidence',sourceUrl:'http://localhost/',note:'Make this clearer',annotationRef:ref};
test('saved annotation identity and note survive draft validation, edits and deletion',()=>{
  const draft=changeAnnotation({text:'Keep my prompt',images:[]},{action:'save',capture});
  assert.deepEqual(validateDraft(draft).images[0].annotationRef,ref);
  const edited=changeAnnotation(draft,{action:'save',capture:{...capture,note:'Use larger text'}});
  assert.equal(edited.images.length,1);assert.equal(edited.images[0].note,'Use larger text');assert.equal(edited.text,'Keep my prompt');
  assert.deepEqual(changeAnnotation(edited,{action:'delete',id:ref.id}),{text:'Keep my prompt',images:[]});
});
test('annotation metadata is bounded and invalid saves leave the original draft unchanged',()=>{
  const draft={text:'Still here',images:[capture]};
  assert.throws(()=>changeAnnotation(draft,{action:'save',capture:{...capture,note:' '.repeat(4001)}}),/note/i);
  assert.throws(()=>validateDraft({text:'',images:[{...capture,annotationRef:{...ref,rect:{...ref.rect,x:NaN}}}]}),/annotation/i);
  assert.throws(()=>changeAnnotation(draft,{action:'delete',id:'missing'}),/saved note/i);
  assert.equal(draft.images[0].note,'Make this clearer');
});
