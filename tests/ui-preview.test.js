import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const preview=await import('../scripts/ui-preview.js').catch(()=>({}));
test('local UI preview serves the actual renderer with a sample-data bridge and rejects writes/private files',async()=>{
  assert.equal(typeof preview.createPreviewServer,'function');
  const server=preview.createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const html=await (await fetch(base)).text();assert.match(html,/preview-bridge\.js/);assert.match(html,/src="renderer\.js"/);
    const policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
    assert.match(policy,/style-src 'self' 'unsafe-inline'/,'The local workbench must allow injected annotation styles');
    assert.match(policy,/script-src 'self';/,'Annotation support must not allow inline scripts');
    const directIndex=await (await fetch(base+'/index.html')).text();assert.match(directIndex,/style-src 'self' 'unsafe-inline';/,'Direct index navigation must support annotations too');
    const desktop=await readFile(new URL('../src/index.html',import.meta.url),'utf8');assert.match(desktop,/style-src 'self';/);assert.doesNotMatch(desktop,/unsafe-inline/,'The packaged desktop policy stays strict');
    assert.equal((await fetch(base+'/renderer.js')).status,200);
    assert.equal((await fetch(base+'/AGENTS.md')).status,404);
    assert.equal((await fetch(base+'/..%2fAGENTS.md')).status,403);
    assert.equal((await fetch(base,{method:'POST',body:'change files'})).status,405);
    const bridge=await (await fetch(base+'/preview-bridge.js')).text();assert.match(bridge,/Sample data/);assert.doesNotMatch(bridge,/ipcRenderer|child_process|readFile|execFile/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
