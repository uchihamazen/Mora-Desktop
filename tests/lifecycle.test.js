import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createState, assertIdle, applyEvent } from '../src/state.js';
import { validateImages } from '../src/images.js';
import { snapshotProject, compareProject } from '../src/changes.js';
import * as changesApi from '../src/changes.js';
import { projectPathFor, groupConversations } from '../src/projects.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// Execute the real main-process orchestration with controlled filesystem/engine I/O.
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
function harness(overrides = {}) {
  class Runner extends EventEmitter {
    child = null; spawned = 0;
    async run() {
      this.spawned++;
      this.emit('record', { payload: { kind: 'command_accepted', command_id: 'run' } });
      return { code: 0, terminal: { terminal: 'completed' } };
    }
    async stop() {}
  }
  const handlers = {};
  const context = vm.createContext({
    path, Buffer, setTimeout, clearTimeout, ExecRunner: Runner,
    createState, assertIdle, applyEvent, validateImages, projectPathFor, groupConversations, applyExecRecord: () => {},
    uuid7: () => 'session', app: { getPath: () => 'C:/temp' },
    mkdir: async () => {}, stat: async () => ({isDirectory:()=>true}),
    mkdtemp: async () => 'C:/temp/muse-desktop-input-test',
    writeFile: async () => {}, rename: async () => {}, rm: async () => {},
    saveConversations: async () => {},
    readHistory: async () => [], handle: (name, fn) => { handlers[name] = fn; },
    readCachedHistory: async () => [],
    snapshotProject: async () => ({}), compareProject: async () => ({ files: [], added: 0, removed: 0 }),
    watchProjectChanges: () => ({ close: async () => {} }),
    loadChangeSummaries: async () => [], saveChangeSummary: async () => {}, deleteChangeSummaries: async () => {},
    ...overrides,
  });
  const body = source.slice(source.indexOf('const directory ='), source.indexOf('\nfunction handle('))
    .replace(/^const directory =[^\n]+/, 'const directory = "C:/Projects/example/src";');
  vm.runInContext(body + '\n' + source.split('\n').find(line => line.includes("handle('stop',")) +
    '\nglobalThis.subject = {state, runner, sendMessage, resumeChat, newChat, save, connect};', context);
  const subject = context.subject;
  subject.state.connection = 'ready';
  subject.state.sessionId = 'session';
  subject.state.projectPath = 'C:/test';
  subject.state.sessions = [{ sessionId: 'session', title: 'Test', workspace: 'C:/test' }];
  return { ...subject, stop: handlers.stop };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('file edits update one live review before the engine finishes and stop watching afterwards', async () => {
  assert.equal(typeof changesApi.watchProjectChanges, 'function');
  const workspace = await mkdtemp(path.join(tmpdir(), 'muse-live-review-'));
  let release, subject;
  const gate = new Promise(resolve => { release = resolve; });
  const summaries = [];
  try {
    await writeFile(path.join(workspace, 'file.txt'), 'old\n');
    class LiveRunner extends EventEmitter {
      async run() {
        this.emit('record', {payload:{kind:'command_accepted',command_id:'live-run'}});
        return gate;
      }
    }
    subject = harness({ ExecRunner:LiveRunner, snapshotProject, compareProject,
      watchProjectChanges:changesApi.watchProjectChanges,
      saveChangeSummary:async (_dir,_id,item) => summaries.push(item),
      readHistory:async () => [{itemId:'reply',turnId:'live-run',kind:'agentMessage',text:'done'}],
    });
    subject.state.workspace = workspace; subject.state.executionMode = 'full';
    await subject.sendMessage({text:'edit'});
    const until = async predicate => {
      const deadline = Date.now()+5000;
      while (!predicate() && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
      assert.ok(predicate(), 'live review did not update');
    };
    const review = () => subject.state.items.find(item=>item.kind==='fileChanges');
    await writeFile(path.join(workspace,'file.txt'),'new\n');
    await until(()=>review()?.files[0]?.patch.includes('+new'));
    assert.equal(subject.state.busy,true); assert.equal(review().live,true);
    await writeFile(path.join(workspace,'file.txt'),'new\nextra\n');
    await until(()=>review()?.added===2);
    assert.equal(subject.state.items.filter(item=>item.kind==='fileChanges').length,1);
    await writeFile(path.join(workspace,'file.txt'),'old\n');
    await until(()=>!review());
    await writeFile(path.join(workspace,'file.txt'),'final\n');
    await until(()=>review()?.files[0]?.patch.includes('+final'));
    release({code:0,terminal:{terminal:'completed'}});
    await until(()=>!subject.state.busy);
    assert.equal(review().live,false); assert.equal(summaries.length,1);
    await writeFile(path.join(workspace,'file.txt'),'outside turn\n');
    await new Promise(resolve=>setTimeout(resolve,600));
    assert.match(review().files[0].patch,/\+final/);
  } finally {
    release({code:1,stopped:true});
    if (subject) await waitForIdle(subject);
    await rm(workspace,{recursive:true,force:true});
  }
});

test('general chat runs outside the current project and resumes as general after project switching', async () => {
  const runs=[];
  const subject=harness({ExecRunner:class extends EventEmitter {
    async run(options) {runs.push(options);this.emit('record',{payload:{kind:'command_accepted',command_id:'r'}});return {code:0,terminal:{terminal:'completed'}};}
  }});
  subject.state.workspace='C:/Projects/example'; subject.state.executionMode='full';
  await subject.newChat(null);
  assert.equal(subject.state.projectPath,null);
  assert.equal(subject.state.sessions[0].projectPath,null);
  await subject.sendMessage({text:'Explain photosynthesis'});
  while(subject.state.busy) await tick();
  assert.equal(runs[0].workspace,path.join('C:/temp','general-chat'));
  assert.equal(runs[0].executionMode,'readonly');
  subject.state.workspace='D:/Another'; subject.state.projectPath='D:/Another';
  await subject.resumeChat('session');
  assert.equal(subject.state.projectPath,null);
  assert.equal(subject.state.workspace,path.join('C:/temp','general-chat'));
});

test('new project chats use their chosen directory and reject invalid project paths before changing selection',async()=>{
  const subject=harness();
  await subject.newChat('C:/Chosen');
  assert.equal(subject.state.projectPath,'C:/Chosen');
  assert.equal(subject.state.workspace,'C:/Chosen');
  assert.equal(subject.state.sessions[0].projectPath,'C:/Chosen');
  await assert.rejects(subject.newChat('../relative'),/absolute/i);
  assert.equal(subject.state.projectPath,'C:/Chosen');
});

test('missing native log recovers display text, blocks context replacement, and retains its notice on reconnect', async () => {
  const subject = harness({
    readHistory: async () => {throw Object.assign(new Error('missing'),{code:'ENOENT'});},
    readCachedHistory: async () => [{itemId:'old',kind:'agentMessage',text:'Archived answer'}],
    discoverMuse: async () => 'C:/engine.exe',
    MspClient: class {
      async connect() {return {museHome:'C:/native',serverInfo:{version:'test'}};}
      async request() {return {models:[{modelId:'muse-spark-1.3-contributor'}]};}
      async close() {}
    },
  });
  await subject.resumeChat('session');
  assert.equal(subject.state.historyMissing,true);
  assert.equal(subject.state.items[0].text,'Archived answer');
  await assert.rejects(subject.sendMessage({text:'Continue'}),/original engine log/);
  assert.equal(subject.runner.spawned,0);
  await subject.connect(); await subject.connect();
  assert.match(subject.state.error,/recovered from Muse cache/);
  await subject.newChat();
  assert.equal(subject.state.historyMissing,false);
});

test('an unused new conversation without an engine log stays sendable',async()=>{
 const subject=harness({readHistory:async()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});}});
 await subject.newChat();
 assert.equal(subject.state.sessions[0].hasMessages,false);
 await subject.resumeChat('session');
 assert.equal(subject.state.historyMissing,false);
 assert.equal(subject.state.error,'');
});

test('a legacy chat titled New conversation still recovers and protects its missing context',async()=>{
 const subject=harness({
  readHistory:async()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});},
  readCachedHistory:async()=>[{itemId:'old',kind:'userMessage',text:'New conversation'}],
 });
 subject.state.sessions[0].title='New conversation';
 await subject.resumeChat('session');
 assert.equal(subject.state.items[0]?.text,'New conversation');
 assert.equal(subject.state.historyMissing,true);
 await assert.rejects(subject.sendMessage({text:'Continue'}),/original engine log/);
 assert.equal(subject.runner.spawned,0);
});

test('a previously attempted message is protected when both native history and cache disappear',async()=>{
 const subject=harness({readHistory:async()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});}});
 await subject.newChat();
 await subject.sendMessage({text:'New conversation'});
 while(subject.state.busy) await tick();
 assert.equal(subject.state.sessions[0].hasMessages,true);
 await subject.resumeChat('session');
 assert.equal(subject.state.historyMissing,true);
 await assert.rejects(subject.sendMessage({text:'Continue'}),/original engine log/);
 assert.equal(subject.runner.spawned,1);
});

test('connection reloads saved messages when the engine discovers another history home', async () => {
  const roots = [], writes = [];
  const subject = harness({
    discoverMuse: async () => 'C:/engine.exe',
    MspClient: class {
      async connect() { return {museHome:'C:/custom-native-home',serverInfo:{version:'test'}}; }
      async request() { return {models:[{modelId:'muse-spark-1.3-contributor'}]}; }
      async close() {}
    },
    readHistory: async (_id, home) => { roots.push(home); return [{itemId:'saved',kind:'agentMessage',text:'restored'}]; },
    writeFile: async (_file, snapshot) => {writes.push(JSON.parse(snapshot));},
  });
  await subject.connect();
  assert.deepEqual(roots,['C:/custom-native-home']);
  assert.equal(subject.state.items[0].text,'restored');
  assert.equal(writes.at(-1).museHome,'C:/custom-native-home');
});

test('changed files summary stays with its turn and survives conversation reload', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'muse-summary-test-'));
  try {
    await writeFile(path.join(workspace, 'file.txt'), 'old\n');
    const summaries = [];
    class FileRunner extends EventEmitter {
      child = null;
      async run() {
        this.emit('record', { payload: { kind: 'command_accepted', command_id: 'run' } });
        await writeFile(path.join(workspace, 'file.txt'), 'new\nextra\n');
        return { code: 0, terminal: { terminal: 'completed' } };
      }
    }
    const subject = harness({ ExecRunner: FileRunner, snapshotProject, compareProject, saveChangeSummary: async (_dir, _id, item) => summaries.push(item), loadChangeSummaries: async () => summaries, readHistory: async () => [{ itemId: 'reply', turnId: 'run', kind: 'agentMessage', text: 'done' }] });
    subject.state.workspace = workspace; subject.state.executionMode = 'full';
    subject.state.sessions[0].workspace = workspace;
    await subject.sendMessage({ text: 'Edit file' });
    const deadline = Date.now() + 5000;
    while (subject.state.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(subject.state.busy, false);
    const item = subject.state.items.find(row => row.kind === 'fileChanges');
    assert.equal(item.turnId, 'run');
    assert.equal(item.added, 2); assert.equal(item.removed, 1);
    assert.equal(summaries[0].itemId, item.itemId);
    await subject.resumeChat('session');
    assert.equal(subject.state.items.at(-1).itemId, item.itemId);
    assert.equal(subject.state.items.at(-1).files[0].path, 'file.txt');
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('stopDuringPreparationNeverLaunchesAnEngineRequest', async () => {
  let release;
  const subject = harness({ mkdtemp: () => new Promise(resolve => { release = resolve; }) });
  subject.state.executionMode = 'full';
  const pending = subject.sendMessage({ text: 'Create a file' });
  const rejected = assert.rejects(pending, /Stopped/);
  assert.equal(subject.state.busy, true);
  await subject.stop();
  assert.equal(subject.state.busy, true, 'Keep switching blocked until preparation is cleaned up');
  release('C:/temp/muse-desktop-input-test');
  await rejected;
  assert.equal(subject.runner.spawned, 0);
  assert.equal(subject.state.busy, false);
  assert.equal(subject.state.stopping, false);
});

test('review storage failure does not blank the native conversation', async () => {
  const subject = harness({ readHistory: async () => [{ itemId: 'reply', kind: 'agentMessage', text: 'keep native history' }], loadChangeSummaries: async () => { throw new Error('review storage unavailable'); } });
  await subject.resumeChat('session');
  assert.equal(subject.state.items[0].text, 'keep native history');
  assert.match(subject.state.error, /review storage unavailable/);
  assert.equal(subject.state.loading, false);
});

test('historyLoadingBlocksAnotherChatAndSendingUntilComplete', async () => {
  let release;
  const subject = harness({ readHistory: () => new Promise(resolve => { release = resolve; }) });
  subject.state.sessions = [
    { sessionId: 'A', workspace: 'C:/A' }, { sessionId: 'B', workspace: 'C:/B' },
  ];
  const first = subject.resumeChat('A');
  const second = assert.rejects(subject.resumeChat('B'), /loading|opening/i);
  const sending = assert.rejects(subject.sendMessage({ text: 'Which project?' }), /loading|opening/i);
  release([{ itemId: 'A', text: 'A history' }]);
  await Promise.all([first, second, sending]);
  assert.equal(subject.state.sessionId, 'A');
  assert.equal(subject.state.workspace, 'C:/A');
  assert.equal(subject.state.items[0].text, 'A history');
  assert.equal(subject.state.loading, false);
});

test('preferenceWritesAreSerializedAndKeepTheNewestSnapshot', async () => {
  let release, active = 0, peak = 0;
  const writes = [];
  const subject = harness({ writeFile: async (_file, text) => {
    active++; peak = Math.max(peak, active); writes.push(text);
    if (writes.length === 1) await new Promise(resolve => { release = resolve; });
    active--;
  } });
  subject.state.workspace = 'C:/A'; const first = subject.save();
  await tick();
  subject.state.workspace = 'C:/B'; const second = subject.save();
  await tick(); release();
  await Promise.all([first, second]);
  assert.equal(peak, 1);
  assert.equal(JSON.parse(writes.at(-1)).workspace, 'C:/B');
});

test('stoppedRunSettlesOnlyItsOwnRunningToolCards', async () => {
  class StoppedRunner extends EventEmitter {
    child = null;
    async run() { this.emit('record',{payload:{kind:'command_accepted',command_id:'run'}}); return {code:1,stopped:true}; }
  }
  const subject = harness({ExecRunner:StoppedRunner});
  subject.state.items = [
    {itemId:'current',turnId:'run',kind:'toolCall',status:'inProgress'},
    {itemId:'old',turnId:'old',kind:'toolCall',status:'completed'},
  ];
  await subject.sendMessage({text:'Run a command'});
  await tick();
  assert.equal(subject.state.items[0].status,'cancelled');
  assert.equal(subject.state.items[1].status,'completed');
});

const ONE_PX_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const waitForIdle = async subject => {
  const deadline = Date.now() + 5000;
  while (subject.state.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
};
function queueSubject({ history = [] } = {}) {
  let runs = 0; const prompts = []; let captured = null;
  let release;
  const gate = new Promise(resolve => { release = (result = { code: 0, terminal: { terminal: 'completed' } }) => resolve(result); });
  let first = true;
  class GatedRunner extends EventEmitter {
    child = null;
    async run() {
      runs++;
      this.emit('record', { payload: { kind: 'command_accepted', command_id: `run-${runs}` } });
      if (first) { first = false; return gate; }
      return { code: 0, terminal: { terminal: 'completed' } };
    }
    async stop() {}
  }
  const subject = harness({
    ExecRunner: GatedRunner,
    readHistory: async () => history,
    writeFile: async (file, data) => {
      const name = String(file);
      if (name.endsWith('prompt.txt')) prompts.push(String(data));
      else if (/[\\/]\d+\.(png|jpg|webp)$/.test(name)) captured = Buffer.from(data);
    },
  });
  return { subject, release, prompts, runs: () => runs, imageBytes: () => captured };
}

test('sendWhileBusyQueuesAndDrainsInOrder', async () => {
  const { subject, release, prompts } = queueSubject({ history: [{ itemId: 'reply', kind: 'agentMessage', text: 'done' }] });
  subject.state.sessions[0].title = 'New conversation';
  const first = await subject.sendMessage({ text: 'one' });
  assert.equal(first.accepted, true);
  assert.equal((await subject.sendMessage({ text: 'two' })).queued, true);
  assert.equal((await subject.sendMessage({ text: 'three' })).queued, true);
  release(); await waitForIdle(subject);
  assert.deepEqual(prompts, ['one', 'two', 'three']);
  assert.equal(subject.state.busy, false);
  assert.equal(subject.state.pendingQueue.length, 0);
  assert.equal(subject.state.sessions[0].title, 'one');
});

test('sameTickSendsKeepFifoOrder', async () => {
  const { subject } = queueSubject();
  subject.sendMessage({ text: 'gated' }); await tick();
  const [a, b] = await Promise.all([subject.sendMessage({ text: 'A' }), subject.sendMessage({ text: 'B' })]);
  assert.equal(a.queued, true); assert.equal(b.queued, true);
  assert.deepEqual(subject.state.pendingQueue.map(e => e.text), ['A', 'B']);
});

test('stopDuringDrainClearsRest', async () => {
  const { subject, release, prompts, runs } = queueSubject();
  subject.sendMessage({ text: 'gated' }); await tick();
  await subject.sendMessage({ text: 'q1' }); await subject.sendMessage({ text: 'q2' });
  await subject.stop(); release({ code: 1, stopped: true }); await waitForIdle(subject);
  assert.equal(runs(), 1);
  assert.deepEqual(prompts, ['gated']);
  assert.equal(subject.state.pendingQueue.length, 0);
  assert.equal(subject.state.busy, false);
});

test('enqueueDuringStoppingLeavesNoOrphans', async () => {
  const { subject, release, prompts } = queueSubject();
  subject.sendMessage({ text: 'gated' }); await tick();
  const stopping = subject.stop();
  assert.equal((await subject.sendMessage({ text: 'late' })).queued, true);
  await stopping; release({ code: 1, stopped: true }); await waitForIdle(subject);
  assert.deepEqual(prompts, ['gated']);
  assert.equal(subject.state.pendingQueue.length, 0);
  assert.equal(subject.state.busy, false);
});

test('queueCapRejectsEleventh', async () => {
  const { subject } = queueSubject();
  subject.sendMessage({ text: 'gated' }); await tick();
  for (let i = 0; i < 10; i++) await subject.sendMessage({ text: `q${i}` });
  await assert.rejects(subject.sendMessage({ text: 'q10' }), /queue is full \(10 messages\)/);
  assert.equal(subject.state.pendingQueue.length, 10);
});

test('invalidPayloadWhileBusyRejected', async () => {
  const { subject } = queueSubject();
  subject.sendMessage({ text: 'gated' }); await tick();
  await assert.rejects(subject.sendMessage({ text: 'x'.repeat(200001) }), /too long/);
  assert.equal(subject.state.pendingQueue.length, 0);
});

test('disconnectedSendWhileBusyRejected', async () => {
  const { subject } = queueSubject();
  subject.sendMessage({ text: 'gated' }); await tick();
  subject.state.connection = 'disconnected';
  await assert.rejects(subject.sendMessage({ text: 'q' }), /Connect/);
});

test('failedTurnStillDrainsNext', async () => {
  const { subject, release, runs } = queueSubject();
  subject.sendMessage({ text: 'bad' }); await tick();
  await subject.sendMessage({ text: 'good' });
  release({ code: 1 }); await waitForIdle(subject);
  assert.equal(runs(), 2);
  assert.match(subject.state.error, /exited \(1\)/);
  assert.equal(subject.state.busy, false);
  assert.equal(subject.state.pendingQueue.length, 0);
});

test('finishingPhaseSendQueues', async () => {
  const { subject } = queueSubject();
  subject.sendMessage({ text: 'gated' }); await tick();
  subject.state.finishing = true;
  assert.equal((await subject.sendMessage({ text: 'q' })).queued, true);
});

test('queuedImagesReachExecutedTurn', async () => {
  const { subject, release, imageBytes } = queueSubject();
  subject.sendMessage({ text: 'gated' }); await tick();
  await subject.sendMessage({ text: '', images: [{ mediaType: 'image/png', base64Data: ONE_PX_PNG }] });
  release(); await waitForIdle(subject);
  assert.deepEqual(imageBytes(), Buffer.from(ONE_PX_PNG, 'base64'));
});
