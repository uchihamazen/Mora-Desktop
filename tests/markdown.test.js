import test from 'node:test';
import assert from 'node:assert/strict';
import {markdownBlocks, inlineParts, safeLink} from '../src/markdown.js';

test('Markdown retains structured headings, lists, tables and incomplete streaming code',()=>{
  const blocks = markdownBlocks('# Result\n\n- One\n- Two\n\n| File | Result |\n| --- | --- |\n| app.js | Pass |\n\n```js\nconst x = 1;\n');
  assert.equal(blocks[0].type,'heading'); assert.equal(blocks[1].type,'list');
  assert.deepEqual(blocks[2].rows,[['app.js','Pass']]);
  assert.equal(blocks[3].text,'const x = 1;\n');
});
test('raw HTML and code stay literal, while unsafe links never become clickable',()=>{
  const parts = inlineParts('<img src=x onerror=alert(1)> **bold** `![x](https://example.com)` [bad](javascript:alert(1)) [ok](https://example.com)');
  assert.equal(parts[0].text,'<img src=x onerror=alert(1)>');
  assert.ok(parts.some(part=>part.type==='strong' && part.text==='bold'));
  assert.ok(parts.some(part=>part.type==='code' && part.text.startsWith('![x]')));
  assert.ok(!parts.some(part=>part.type==='link' && part.url.startsWith('javascript')));
  assert.ok(parts.some(part=>part.type==='link' && part.url==='https://example.com/'));
  for(const value of ['file:///x','data:text/html,x','javascript:x','https://user:password@example.com'])assert.equal(safeLink(value),null);
});
