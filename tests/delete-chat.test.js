import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createState, assertIdle, applyEvent } from '../src/state.js';
import { validateImages } from '../src/images.js';
import {accountState,AccountLogin} from '../src/account.js';

// Execute the real main-process orchestration with controlled filesystem I/O.
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
function harness(overrides = {}) {
  class Runner extends EventEmitter {
    child = null;
    async run() { return { code: 0, terminal: { terminal: 'completed' } }; }
    async stop() {}
  }
  const handlers = {};
  const rmCalls = [];
  const writes = [];
  const context = vm.createContext({
    path, Buffer, setTimeout, clearTimeout,
    ExecRunner: Runner, accountState,AccountLogin,
    Checkpoints:class {async create(){return {id:"checkpoint"};}async seal(){}},
    createState, assertIdle, applyEvent, validateImages,
    applyExecRecord: () => {}, applyNativeRecord: () => {},
    snapshotProject: async () => ({}), compareProject: async () => ({ files: [], added: 0, removed: 0 }),
    loadChangeSummaries: async () => [], saveChangeSummary: async () => {}, deleteChangeSummaries: async () => {},
    uuid7: () => 'new-session',
    MspClient: class { async connect() { return {}; } async request() { return {}; } async close() {} },
    discoverMuse: async () => 'C:/muse.exe',
    resolveSessionLogPath: (sessionId, museHome) => path.join(museHome || 'C:/muse', sessionId, 'session.jsonl'),
    app: { getPath: () => 'C:/temp' },
    mkdtemp: async () => 'C:/temp/muse-desktop-input-test',
    writeFile: async (_file, text) => { writes.push(text); },
    rename: async () => {},
    saveConversations: async () => {},
    deleteWork: async () => {},
    rm: async (...args) => { rmCalls.push(args); },
    readHistory: async () => [],
    handle: (name, fn) => { handlers[name] = fn; },
    ...overrides,
  });
  const body = source.slice(source.indexOf('const directory ='), source.indexOf('\nfunction handle('))
    .replace(/^const directory =[^\n]+/, 'const directory = "C:/Projects/example/src";');
  vm.runInContext(body + '\nglobalThis.subject = {state, runner, sendMessage, resumeChat, newChat, save, deleteChat: (typeof deleteChat !== "undefined" ? deleteChat : undefined), setMuseHome: v => { museHome = v; }};', context);
  const subject = context.subject;
  subject.state.connection = 'ready';
  return { ...subject, rmCalls, writes, handlers };
}

test('native history removal refuses a directory outside Muse storage',async()=>{
  const h=harness({resolveSessionLogPath:()=> 'C:/unrelated/session.jsonl'});
  h.setMuseHome('C:/muse-data');
  h.state.sessions=[{sessionId:'old',title:'Old',workspace:'C:/A'}];
  await h.deleteChat('old');
  assert.equal(h.rmCalls.length,0);
  assert.match(h.state.error,/outside Muse storage/);
});

test('deleteInactiveChatRemovesItAndItsHistoryFolder', async () => {
  const h = harness();
  assert.equal(typeof h.deleteChat, 'function');
  h.setMuseHome('C:/muse-data');
  h.state.sessionId = 'active-id';
  h.state.items = [{ itemId: 'a', text: 'keep' }];
  h.state.sessions = [
    { sessionId: 'active-id', title: 'Active', workspace: 'C:/A' },
    { sessionId: 'old-id', title: 'Old', workspace: 'C:/A' },
  ];
  const result = await h.deleteChat('old-id');
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sessionId, 'active-id');
  assert.equal(result.sessionId, 'active-id');
  assert.equal(result.items[0].text, 'keep');
  assert.equal(h.rmCalls.length, 2);
  assert.equal(h.rmCalls[0][0], path.join('C:/muse-data', 'old-id'));
  assert.equal(h.rmCalls[1][0],path.join('C:/muse-data','sessions','.msp-view-v1','old-id'));
  assert.equal(h.rmCalls[0][1].recursive, true);
  assert.equal(h.rmCalls[0][1].force, true);
  assert.equal(JSON.parse(h.writes.at(-1)).sessions.length, 1);
});

test('deleteActiveChatClearsTheOpenConversation', async () => {
  const h = harness();
  h.setMuseHome('C:/muse-data');
  h.state.sessionId = 'active-id';
  h.state.items = [{ itemId: 'a', text: 'open' }];
  h.state.sessions = [
    { sessionId: 'active-id', title: 'Active', workspace: 'C:/A' },
    { sessionId: 'other-id', title: 'Other', workspace: 'C:/A' },
  ];
  await h.deleteChat('active-id');
  assert.equal(h.state.sessions.length, 1);
  assert.equal(h.state.sessions[0].sessionId, 'other-id');
  assert.equal(h.state.sessionId, null);
  assert.deepEqual(h.state.items, []);
  assert.equal(h.rmCalls.length, 2);
  assert.equal(h.rmCalls[0][0], path.join('C:/muse-data', 'active-id'));
});

test('deleteActiveWhileBusyOrLoadingIsBlockedButInactiveIsAllowed', async () => {
  const h = harness();
  h.setMuseHome('C:/muse-data');
  h.state.sessionId = 'active-id';
  h.state.busy = true;
  h.state.sessions = [
    { sessionId: 'active-id', title: 'Active', workspace: 'C:/A' },
    { sessionId: 'old-id', title: 'Old', workspace: 'C:/A' },
  ];
  await assert.rejects(h.deleteChat('active-id'), /running|stop/i);
  assert.equal(h.state.sessions.length, 2);
  await h.deleteChat('old-id');
  assert.equal(h.state.sessions.length, 1);
  h.state.busy = false;
  h.state.loading = true;
  await assert.rejects(h.deleteChat('active-id'), /loading/i);
});

test('deleteMissingChatThrows', async () => {
  const h = harness();
  h.state.sessions = [{ sessionId: 'active-id', title: 'Active', workspace: 'C:/A' }];
  await assert.rejects(h.deleteChat('nope'), /not in Mora Desktop/);
  await assert.rejects(h.deleteChat(''), /choose a conversation/i);
});

test('nativeHistoryFailureStillRemovesChatFromList', async () => {
  const h = harness({ rm: async () => { throw new Error('locked'); } });
  h.setMuseHome('C:/muse-data');
  h.state.sessionId = 'active-id';
  h.state.sessions = [{ sessionId: 'active-id', title: 'Active', workspace: 'C:/A' }];
  await h.deleteChat('active-id');
  assert.equal(h.state.sessions.length, 0);
  assert.equal(h.state.sessionId, null);
  assert.match(h.state.error, /could not be deleted/);
});
