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
    rm: async () => {},
    readHistory: async () => [],
    handle: (name, fn) => { handlers[name] = fn; },
    ...overrides,
  });
  const body = source.slice(source.indexOf('const directory ='), source.indexOf('\nfunction handle('))
    .replace(/^const directory =[^\n]+/, 'const directory = "C:/Projects/example/src";');
  vm.runInContext(body + '\nglobalThis.subject = {state, runner, renameChat: (typeof renameChat !== "undefined" ? renameChat : undefined)};', context);
  const subject = context.subject;
  subject.state.connection = 'ready';
  return { ...subject, writes, handlers };
}

test('renameChatUpdatesTitleAndPersists', async () => {
  const h = harness();
  assert.equal(typeof h.renameChat, 'function');
  h.state.sessions = [
    { sessionId: 'a', title: 'Old name', workspace: 'C:/A' },
    { sessionId: 'b', title: 'Other', workspace: 'C:/A' },
  ];
  const result = await h.renameChat('a', '  New name  ');
  assert.equal(result.sessions[0].title, 'New name');
  assert.equal(result.sessions[1].title, 'Other');
  assert.equal(JSON.parse(h.writes.at(-1)).sessions[0].title, 'New name');
});

test('renameChatValidation', async () => {
  const h = harness();
  h.state.sessions = [{ sessionId: 'a', title: 'Old', workspace: 'C:/A' }];
  await assert.rejects(h.renameChat('missing', 'Name'), /not in Mora Desktop/);
  await assert.rejects(h.renameChat('', 'Name'), /choose a conversation/i);
  await assert.rejects(h.renameChat('a', '   '), /chat name/i);
  await assert.rejects(h.renameChat('a', 'x'.repeat(81)), /80 characters/);
  assert.equal(h.state.sessions[0].title, 'Old');
});

test('renameBlockedWhileLoadingButAllowedWhileBusy', async () => {
  const h = harness();
  h.state.sessions = [{ sessionId: 'a', title: 'Old', workspace: 'C:/A' }];
  h.state.loading = true;
  await assert.rejects(h.renameChat('a', 'Name'), /loading/i);
  h.state.loading = false;
  h.state.busy = true;
  await h.renameChat('a', 'Renamed while busy');
  assert.equal(h.state.sessions[0].title, 'Renamed while busy');
});
