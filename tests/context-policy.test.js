import test from 'node:test';
import assert from 'node:assert/strict';
const {contextPerformanceArgs,discoverContextPerformanceArgs}=await import('../src/context-policy.js').catch(()=>({}));
test('supported native compaction/output flags apply only to each run, preserving model and engine strategy',()=>{
  assert.equal(typeof contextPerformanceArgs,'function');
  const args=contextPerformanceArgs('--context-compaction-soft-threshold <FRAC>\n--context-compaction-hard-threshold <FRAC>\n--max-tool-output-bytes <N>');
  assert.deepEqual(args,['--context-compaction-soft-threshold','0.75','--context-compaction-hard-threshold','0.90','--max-tool-output-bytes','65536']);
  assert.equal(args.some(arg=>/model|reasoning|strategy|session/.test(arg)),false);
});
test('older engines keep their defaults; a partial threshold pair is never applied',()=>{
  assert.equal(typeof contextPerformanceArgs,'function');
  assert.deepEqual(contextPerformanceArgs('Old exec help'),[]);assert.deepEqual(contextPerformanceArgs('--context-compaction-soft-threshold'),[]);
  assert.deepEqual(contextPerformanceArgs('--max-tool-output-bytes <N>'),['--max-tool-output-bytes','65536']);
});
test('capability discovery is read-only, bounded and falls back safely on unavailable help',async()=>{
  const seen=[];assert.deepEqual(await discoverContextPerformanceArgs('fixture.exe',{run:async(file,args,options)=>{seen.push({file,args,options});return {stdout:'--max-tool-output-bytes <N>'};}}),['--max-tool-output-bytes','65536']);
  assert.deepEqual(seen[0].args,['exec','--help']);assert.equal(seen[0].options.timeout,5000);assert.equal(seen[0].options.windowsHide,true);
  assert.deepEqual(await discoverContextPerformanceArgs('old.exe',{run:async()=>{throw Error('Unsupported help');}}),[]);
});
