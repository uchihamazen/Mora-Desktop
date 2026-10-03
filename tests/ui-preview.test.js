import test from 'node:test';
import assert from 'node:assert/strict';
const preview=await import('../scripts/ui-preview.js').catch(()=>({}));
test('local UI preview serves the actual renderer with a sample-data bridge and rejects writes/private files',async()=>{
  assert.equal(typeof preview.createPreviewServer,'function');
  const server=preview.createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const html=await (await fetch(base)).text();assert.match(html,/preview-bridge\.js/);assert.match(html,/src="renderer\.js"/);
    assert.equal((await fetch(base+'/renderer.js')).status,200);
    assert.equal((await fetch(base+'/AGENTS.md')).status,404);
    assert.equal((await fetch(base+'/..%2fAGENTS.md')).status,403);
    assert.equal((await fetch(base,{method:'POST',body:'change files'})).status,405);
    const bridge=await (await fetch(base+'/preview-bridge.js')).text();assert.match(bridge,/Sample data/);assert.doesNotMatch(bridge,/ipcRenderer|child_process|readFile|execFile/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
