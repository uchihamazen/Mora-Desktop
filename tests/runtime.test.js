import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, appendFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const api = await import('../src/runtime.js').catch(() => ({}));
const fixture = fileURLToPath(new URL('./fixtures/exec.js', import.meta.url));

test('model steps and public narration appear during the run without duplicating streamed replies', async () => {
  const {createState} = await import('../src/state.js'); const state = createState();
  state.activeTurnId='r'; state.busy=true;
  const step = {payload:{kind:'task_lifecycle',command_id:'r',task_id:'model',event:{kind:'proposed',task_kind:'model.meta.response'}}};
  api.applyExecRecord(state,step); api.applyExecRecord(state,step);
  assert.equal(state.items.filter(item=>item.kind==='activity').length,1);
  api.applyExecRecord(state,{id:'d',payload:{kind:'run_output_delta',command_id:'r',text:'Checking files now'}});
  const narrative={payload:{kind:'run',run_id:'r',event:{kind:'assistant_message_committed',message_id:'message',text:'Checking files now'}}};
  api.applyNativeRecord(state,narrative); api.applyNativeRecord(state,narrative);
  assert.equal(state.items.filter(item=>item.kind==='agentMessage').length,1);
  api.applyNativeRecord(state,{payload:{kind:'run',run_id:'r',event:{kind:'assistant_message_committed',message_id:'next',text:'Running the check'}}});
  assert.equal(state.items.filter(item=>item.kind==='agentMessage').length,2);
});

for (const prefix of ['', 'Hello']) test(`native narration reconciles with a stream that has delivered ${prefix || 'nothing'}`, async () => {
  const {createState} = await import('../src/state.js'); const state=createState(); state.activeTurnId='r';
  if (prefix) api.applyExecRecord(state,{id:'first',payload:{kind:'run_output_delta',command_id:'r',text:prefix}});
  api.applyNativeRecord(state,{payload:{kind:'run',run_id:'r',event:{kind:'assistant_message_committed',message_id:'native',text:'Hello world'}}});
  assert.equal(state.items.filter(item=>item.kind==='agentMessage').length,1);
  api.applyExecRecord(state,{id:'rest',payload:{kind:'run_output_delta',command_id:'r',text:prefix ? ' world' : 'Hello world'}});
  api.applyExecRecord(state,{payload:{kind:'run_terminal',command_id:'r',text:'Hello world',terminal:'completed'}});
  assert.equal(state.items.filter(item=>item.kind==='agentMessage').length,1);
  assert.equal(state.items.find(item=>item.kind==='agentMessage').text,'Hello world');
});

test('successive model messages remain separate when native commits are delayed', async () => {
  const {createState} = await import('../src/state.js'); const state=createState(); state.activeTurnId='r';
  const step=id=>api.applyExecRecord(state,{payload:{kind:'task_lifecycle',command_id:'r',task_id:id,event:{kind:'proposed',task_kind:'model.meta.response'}}});
  step('model1');
  api.applyExecRecord(state,{id:'one',payload:{kind:'run_output_delta',command_id:'r',text:'Checking files now'}});
  step('model2'); step('model2');
  api.applyExecRecord(state,{id:'two',payload:{kind:'run_output_delta',command_id:'r',text:'Done'}});
  for (const [message_id,text] of [['m1','Checking files now'],['m2','Done']]) api.applyNativeRecord(state,{payload:{kind:'run',run_id:'r',event:{kind:'assistant_message_committed',message_id,text}}});
  api.applyExecRecord(state,{payload:{kind:'run_terminal',command_id:'r',terminal:'completed',text:'Done'}});
  assert.deepEqual(state.items.filter(item=>item.kind==='agentMessage').map(item=>[item.text,item.status]),[['Checking files now','completed'],['Done','completed']]);
});

test('native-first replies still show real final checks after the matching stream', async () => {
  const {createState} = await import('../src/state.js'); const state=createState(); state.activeTurnId='r'; state.busy=true;
  api.applyExecRecord(state,{payload:{kind:'task_lifecycle',command_id:'r',task_id:'model',event:{kind:'proposed',task_kind:'model.meta.response'}}});
  api.applyNativeRecord(state,{payload:{kind:'run',run_id:'r',event:{kind:'assistant_message_committed',message_id:'native',text:'Done'}}});
  api.applyExecRecord(state,{id:'delta',payload:{kind:'run_output_delta',command_id:'r',text:'Done'}});
  api.applyExecRecord(state,{payload:{kind:'task_lifecycle',command_id:'r',task_id:'verify',event:{kind:'proposed',task_kind:'reminder.agent.verify-reminder'}}});
  assert.equal(state.finishing,true); assert.equal(state.busy,true);
});
test('execKeepsSessionAndUnicodeWithoutShellInterpolation', async () => {
  assert.equal(typeof api.ExecRunner, 'function');
  const runner = new api.ExecRunner();
  const records = [];
  runner.on('record', r => records.push(r));
  const result = await runner.run({ executable: process.execPath, prefixArgs: [fixture], workspace: process.cwd(), sessionId: '018f1234-1234-7123-8123-123456789abc', promptFile: fixture, executionMode: 'readonly', modelId: 'echo', reasoningEffort: 'max', images: [] });
  assert.equal(result.terminal.text, 'أهلاً يا باشا');
  assert.equal(result.code, 0);
  assert.equal(records[0].payload.sessionId, '018f1234-1234-7123-8123-123456789abc');
  assert.equal(records[0].payload.stack, '33554432');
});
test('execStopTerminatesProcessAndDoesNotReplay', async () => {
  assert.equal(typeof api.ExecRunner, 'function');
  const runner = new api.ExecRunner();
  const running = runner.run({ executable: process.execPath, prefixArgs: [fixture, '--hang'], workspace: process.cwd(), sessionId: '018f1234-1234-7123-8123-123456789abc', promptFile: fixture, executionMode: 'readonly' });
  await new Promise(resolve => runner.once('record', resolve));
  await runner.stop();
  const result = await running;
  assert.equal(result.stopped, true);
  assert.equal(runner.child, null);
});
test('isolated native requests receive their own environment and bounded execution options',async()=>{
  const runner=new api.ExecRunner(),records=[];runner.on('record',r=>records.push(r));
  await runner.run({executable:process.execPath,prefixArgs:[fixture],workspace:process.cwd(),sessionId:'018f1234-1234-7123-8123-123456789abc',promptFile:fixture,environment:{MORA_TEST_MARKER:'isolated'},extraArgs:['--max-model-steps','4']});
  assert.equal(records[0].payload.marker,'isolated');assert.ok(records[0].payload.args.includes('--max-model-steps'));assert.equal(process.env.MORA_TEST_MARKER,undefined);
});
test('ephemeral native requests omit session identity when retained logs are disabled',async()=>{
  const runner=new api.ExecRunner(),records=[];runner.on('record',r=>records.push(r));
  await runner.run({executable:process.execPath,prefixArgs:[fixture],workspace:process.cwd(),promptFile:fixture,extraArgs:['--no-session-log']});
  assert.equal(records[0].payload.args.includes('--session-id'),false);
});
for (const executionMode of ['readonly', 'full']) test(`native ${executionMode} turns exclude foreign personal context without changing permissions`, async () => {
  const runner = new api.ExecRunner(), records = [];
  runner.on('record', record => records.push(record));
  const performanceArgs=['--context-compaction-soft-threshold','0.75','--context-compaction-hard-threshold','0.90','--max-tool-output-bytes','65536'];
  const result = await runner.run({ executable: process.execPath, prefixArgs: [fixture], workspace: process.cwd(), sessionId: '018f1234-1234-7123-8123-123456789abc', promptFile: fixture, executionMode,extraArgs:performanceArgs });
  assert.equal(result.code, 0);
  const args = records[0].payload.args;
  assert.ok(args.includes('--no-foreign-personal-context'));
  assert.deepEqual(args.slice(-performanceArgs.length),performanceArgs);
  assert.equal(args.includes('--yolo'), executionMode === 'full');
  assert.equal(args.includes('--disable-write'), executionMode === 'readonly');
  assert.equal(args.includes('--disable-shell'), executionMode === 'readonly');
});
test('nativeHistoryUnderstandsEngineLogWithoutDuplicatingTurns', () => {
  assert.equal(typeof api.historyItems, 'function');
  const records = [
    { id: 'a', payload: { kind: 'run', run_id: 'r1', event: { kind: 'started', prompt: 'السؤال' } } },
    { id: 'b', payload: { kind: 'run', run_id: 'r1', event: { kind: 'assistant_message_committed', message_id: 'm1', text: 'الإجابة' } } },
    { id: 'c', payload: { kind: 'run', run_id: 'r1', event: { kind: 'terminal', terminal: 'completed' } } }
  ];
  const items = api.historyItems([...records, records[1]]);
  assert.equal(items.length, 2);
  assert.equal(items[0].text, 'السؤال');
  assert.equal(items[1].text, 'الإجابة');
});
test('realExecDeltasAndToolResultsAreProjected', async () => {
  assert.equal(typeof api.applyExecRecord, 'function');
  const {createState} = await import('../src/state.js'); const state = createState();
  api.applyExecRecord(state, {id:'d1',payload:{kind:'run_output_delta',command_id:'r',text:'Hello'}});
  api.applyExecRecord(state, {id:'d2',payload:{kind:'run_output_delta',command_id:'r',text:' world'}});
  assert.equal(state.items[0].text,'Hello world');
  api.applyExecRecord(state, {payload:{kind:'task_lifecycle',task_id:'t',command_id:'r',event:{kind:'side_effect_intent',operation:'tool:powershell'}}});
  api.applyExecRecord(state, {payload:{kind:'task_lifecycle',task_id:'t',command_id:'r',event:{kind:'output',chunk:'FILE_OK',final_result:true}}});
  assert.equal(state.items[1].visibleOutput,'FILE_OK');
  api.applyExecRecord(state, {payload:{kind:'run_terminal',command_id:'r',text:'Final answer',terminal:'completed'}});
  assert.equal(state.items[0].text,'Final answer');
  assert.equal(state.items[0].status,'completed');
});

test('postReplyRemindersShowFinishingWithoutUnlockingTheActiveRun', async () => {
  const {createState} = await import('../src/state.js'); const state = createState();
  state.busy = true; state.activeTurnId = 'r';
  api.applyExecRecord(state, {payload:{kind:'task_lifecycle',command_id:'r',task_id:'early',event:{kind:'proposed',task_kind:'reminder.agent.skill-reminder'}}});
  assert.notEqual(state.finishing, true, 'A reminder before any answer is still working');
  api.applyExecRecord(state, {id:'delta',payload:{kind:'run_output_delta',command_id:'r',text:'تمام يا برنس'}});
  api.applyExecRecord(state, {payload:{kind:'task_lifecycle',command_id:'r',task_id:'verify',event:{kind:'proposed',task_kind:'reminder.agent.verify-reminder'}}});
  assert.equal(state.finishing, true);
  assert.equal(state.busy, true, 'The native run still owns the session');
  api.applyExecRecord(state, {payload:{kind:'task_lifecycle',command_id:'r',task_id:'model2',event:{kind:'proposed',task_kind:'model.meta.response'}}});
  assert.equal(state.finishing, false, 'A new model step resumes working');
});

test('postReplyRemindersNeverHideAnActiveProjectOperation', async () => {
  const {createState} = await import('../src/state.js'); const state = createState();
  state.busy = true; state.activeTurnId = 'r';
  api.applyExecRecord(state, {id:'delta',payload:{kind:'run_output_delta',command_id:'r',text:'Working on the file'}});
  api.applyExecRecord(state, {payload:{kind:'task_lifecycle',command_id:'r',task_id:'tool',event:{kind:'proposed',task_kind:'tool.powershell'}}});
  api.applyExecRecord(state, {payload:{kind:'task_lifecycle',command_id:'r',task_id:'verify',event:{kind:'proposed',task_kind:'reminder.agent.verify-reminder'}}});
  assert.equal(state.finishing, false);
  api.applyExecRecord(state, {payload:{kind:'task_lifecycle',command_id:'r',task_id:'tool',event:{kind:'completed'}}});
  api.applyExecRecord(state, {payload:{kind:'task_lifecycle',command_id:'r',task_id:'goal',event:{kind:'proposed',task_kind:'reminder.agent.goal-reminder'}}});
  assert.equal(state.finishing, true);
  api.applyExecRecord(state, {payload:{kind:'run_terminal',command_id:'r',terminal:'completed',text:'Done'}});
  assert.equal(state.finishing, false);
});

test('anInterruptedOlderTurnCannotMaskCurrentActivity', async () => {
  const {createState} = await import('../src/state.js'); const state = createState();
  state.busy = true; state.activeTurnId = 'new';
  state.items.push({itemId:'old-tool',turnId:'old',kind:'toolCall',tool:'powershell',status:'inProgress',description:'Old command'});
  api.applyExecRecord(state, {id:'new-delta',payload:{kind:'run_output_delta',command_id:'new',text:'Reply'}});
  api.applyExecRecord(state, {payload:{kind:'task_lifecycle',command_id:'new',task_id:'verify',event:{kind:'proposed',task_kind:'reminder.agent.verify-reminder'}}});
  assert.equal(state.finishing, true);
  api.applyExecRecord(state, {payload:{kind:'task_lifecycle',command_id:'new',task_id:'current-tool',event:{kind:'proposed',task_kind:'tool.powershell'}}});
  api.applyExecRecord(state, {payload:{kind:'task_lifecycle',command_id:'new',task_id:'current-tool',event:{kind:'completed'}}});
  assert.notEqual(state.activity, 'Old command');
});

test('nativeToolDetailsBindToTheLiveTaskWithoutDuplicatingIt', async () => {
  assert.equal(typeof api.applyNativeRecord, 'function');
  const {createState} = await import('../src/state.js'); const state = createState();
  state.activeTurnId = 'r'; state.busy = true;
  api.applyExecRecord(state, {payload:{kind:'task_lifecycle',command_id:'r',task_id:'task',event:{kind:'proposed',task_kind:'tool.powershell'}}});
  api.applyExecRecord(state, {payload:{kind:'task_lifecycle',command_id:'r',task_id:'task',event:{kind:'scheduled',idempotency_key:'tool:call1'}}});
  const detail = {payload:{kind:'run',run_id:'r',event:{kind:'assistant_tool_calls_committed',tool_calls:[{call_id:'call1',name:'powershell',args:JSON.stringify({command:'Get-Content proof.txt',description:'قراءة الملف'})}]}}};
  api.applyNativeRecord(state, detail);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].commandText, 'Get-Content proof.txt');
  assert.equal(state.items[0].description, 'قراءة الملف');
  assert.match(state.activity, /قراءة الملف/);
  api.applyNativeRecord(state, {payload:{kind:'run',run_id:'old',event:detail.payload.event}});
  assert.equal(state.items.length, 1, 'Ignore another native run');
  api.applyNativeRecord(state, {payload:{kind:'run',run_id:'r',event:{kind:'tool_result_batch_committed',results:[{tool_call_id:'call1',text:JSON.stringify({command:'Get-Content proof.txt',exit_code:0,output:'FILE_OK'})}]}}});
  assert.equal(state.items[0].visibleOutput, 'FILE_OK');
});

test('historyPreservesExactCommandsAndMergesCallAndTaskIds', () => {
  const records = [
    {payload:{kind:'run',run_id:'r',event:{kind:'assistant_tool_calls_committed',tool_calls:[{call_id:'call1',name:'powershell',args:'{"command":"Get-Content proof.txt","description":"Read proof"}'}]}}},
    {payload:{kind:'task',run_id:'r',task_id:'task',event:{kind:'proposed',task_kind:'tool.powershell'}}},
    {payload:{kind:'task',run_id:'r',task_id:'task',event:{kind:'scheduled',idempotency_key:'tool:call1'}}},
    {payload:{kind:'task',run_id:'r',task_id:'task',event:{kind:'completed'}}},
  ];
  const items = api.historyItems(records);
  assert.equal(items.length, 1);
  assert.equal(items[0].commandText, 'Get-Content proof.txt');
  assert.equal(items[0].status, 'completed');
});

test('nativeLogTailReadsOnlyNewCompleteUtf8RecordsOnce', async () => {
  assert.equal(typeof api.NativeLogTail, 'function');
  const dir = await mkdtemp(path.join(tmpdir(), 'muse-tail-test-'));
  const filename = path.join(dir,'session.jsonl'), records = [];
  const old = JSON.stringify({id:'old'})+'\n'; await writeFile(filename,old);
  const tail = new api.NativeLogTail(filename, Buffer.byteLength(old), record => records.push(record));
  try {
    const next = Buffer.from(JSON.stringify({id:'new',text:'أهلاً يا باشا'})+'\n');
    const split = next.indexOf(Buffer.from('أ'))+1;
    await appendFile(filename,next.subarray(0,split)); await tail.poll();
    assert.equal(records.length,0);
    await appendFile(filename,next.subarray(split)); await tail.poll(); await tail.poll();
    assert.equal(records.length,1); assert.equal(records[0].text,'أهلاً يا باشا');
  } finally { await tail.close(); await rm(filename); await rmdir(dir); }
});
