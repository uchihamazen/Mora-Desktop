import test from 'node:test';
import assert from 'node:assert/strict';
import {formatContextReference,parseContextReferences} from '../src/context-references.js';
test('file/folder references roundtrip parenthesized Unicode paths and Windows separators',()=>{
  for(const kind of ['file','folder'])for(const name of ['src/Component (copy).jsx','src/عربي.js','folder with spaces/a.js','src\\app.js'])assert.deepEqual(parseContextReferences(formatContextReference(kind,name)),[{kind,path:name}]);
  assert.deepEqual(parseContextReferences('Read @file(src/Component (copy).jsx) and @folder(src/)'),[{kind:'file',path:'src/Component (copy).jsx'},{kind:'folder',path:'src/'}]);assert.deepEqual(parseContextReferences('Email sample@example.com'),[]);
});
test('malformed references fail clearly instead of attaching another file',()=>{for(const text of ['@file(src/a.js','@folder()','@file("bad\\q")','@file("src/a.js"\n)'])assert.throws(()=>parseContextReferences(text),/reference|path/);});
