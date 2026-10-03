import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {mkdtemp,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import { EventEmitter } from 'node:events';
import { createState, assertIdle, applyEvent } from '../src/state.js';
import { validateImages } from '../src/images.js';
import {HistoryWindow} from '../src/history-window.js';
import {accountState,AccountLogin} from '../src/account.js';
import * as projectsApi from '../src/projects.js';

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
  const mkdirCalls = [];
  const writes = [];
  const context = vm.createContext({
    path, Buffer, setTimeout, clearTimeout, HistoryWindow,
    ExecRunner: Runner, accountState,AccountLogin,
    Checkpoints:class {async create(){return {id:"checkpoint"};}async seal(){}},
    createState, assertIdle, applyEvent, validateImages,
    projectPathFor: projectsApi.projectPathFor, groupConversations: projectsApi.groupConversations, projectKey: projectsApi.projectKey,
    applyExecRecord: () => {}, applyNativeRecord: () => {},
    snapshotProject: async () => ({}), compareProject: async () => ({ files: [], added: 0, removed: 0 }),
    loadChangeSummaries: async () => [], saveChangeSummary: async () => {}, deleteChangeSummaries: async () => {},
    uuid7: () => 'new-session',
    MspClient: class { async connect() { return {}; } async request() { return {}; } async close() {} },
    discoverMuse: async () => 'C:/muse.exe',
    discoverContextPerformanceArgs:async()=>[],
    resolveSessionLogPath: (sessionId, museHome) => path.join(museHome || 'C:/muse', sessionId, 'session.jsonl'),
    app: { getPath: () => 'C:/temp' },
    mkdir: async (...args) => { mkdirCalls.push(args); },
    mkdtemp: async () => 'C:/temp/muse-desktop-input-test',
    writeFile: async (_file, text) => { writes.push(text); },
    rename: async () => {},
    saveConversations: async () => {},
    loadWork: async () => ({pendingQueue:[],activeRequest:null}),
    deleteWork: async () => {},
    rm: async (...args) => { rmCalls.push(args); },
    readHistory: async () => [],
    handle: (name, fn) => { handlers[name] = fn; },
    ...overrides,
  });
  const body = source.slice(source.indexOf('const directory ='), source.indexOf('\nfunction handle('))
    .replace(/^const directory =[^\n]+/, 'const directory = "C:/Projects/example/src";');
  vm.runInContext(body + '\nglobalThis.subject = {state, runner, removeProject: (typeof removeProject !== "undefined" ? removeProject : undefined), setMuseHome: v => { museHome = v; }};', context);
  const subject = context.subject;
  subject.state.connection = 'ready';
  return { ...subject, rmCalls, mkdirCalls, writes, handlers };
}

test('removeProjectRemovesItsChatsAndKeepsTheFolder', async () => {
  const h = harness();
  assert.equal(typeof h.removeProject, 'function');
  h.setMuseHome('C:/muse-data');
  h.state.sessionId = 'keep-active';
  h.state.projectPath = 'C:/Keep';
  h.state.workspace = 'C:/Keep';
  h.state.sessions = [
    { sessionId: 'keep-active', title: 'Keep', projectPath: 'C:/Keep', workspace: 'C:/Keep' },
    { sessionId: 'old-1', title: 'Old 1', projectPath: 'C:/Old', workspace: 'C:/Old' },
    { sessionId: 'old-2', title: 'Old 2', projectPath: 'C:/Old', workspace: 'C:/Old' },
  ];
  h.state.projects = ['C:/Keep', 'C:/Old'];
  const result = await h.removeProject('C:/Old');
  assert.deepEqual(result.sessions.map(s => s.sessionId), ['keep-active']);
  assert.deepEqual(result.projects, ['C:/Keep']);
  assert.equal(result.sessionId, 'keep-active');
  assert.equal(result.projectPath, 'C:/Keep');
  assert.equal(h.rmCalls.length, 4);
  assert.deepEqual(h.rmCalls.map(([target]) => target).sort(), [path.join('C:/muse-data', 'old-1'), path.join('C:/muse-data', 'old-2'),path.join('C:/muse-data','sessions','.msp-view-v1','old-1'),path.join('C:/muse-data','sessions','.msp-view-v1','old-2')].sort());
  assert.ok(h.rmCalls.every(([target]) => !target.toLowerCase().includes('c:/old')), 'The project folder itself must never be deleted');
  assert.equal(h.mkdirCalls.length, 0);
  assert.equal(JSON.parse(h.writes.at(-1)).sessions.length, 1);
});

test('removeProjectMatchesWindowsPathsCaseInsensitively', async () => {
  const h = harness();
  h.setMuseHome('C:/muse-data');
  h.state.sessions = [{ sessionId: 'old-1', title: 'Old', projectPath: 'C:/Old', workspace: 'C:/Old' }];
  h.state.projects = ['C:/Old'];
  await h.removeProject('c:\\old\\');
  assert.deepEqual(h.state.sessions, []);
  assert.deepEqual(h.state.projects, []);
});

test('removeEmptyProjectKeepsChats', async () => {
  const h = harness();
  h.setMuseHome('C:/muse-data');
  h.state.sessionId = 'keep-active';
  h.state.sessions = [{ sessionId: 'keep-active', title: 'Keep', projectPath: 'C:/Keep', workspace: 'C:/Keep' }];
  h.state.projects = ['C:/Keep', 'C:/Empty'];
  await h.removeProject('C:/Empty');
  assert.deepEqual(h.state.sessions.map(s => s.sessionId), ['keep-active']);
  assert.deepEqual(h.state.projects, ['C:/Keep']);
  assert.equal(h.rmCalls.length, 0);
});

test('removeActiveProjectClearsTheOpenConversationAndSwitchesToGeneral', async () => {
  const h = harness();
  h.setMuseHome('C:/muse-data');
  h.state.sessionId = 'old-1';
  h.state.projectPath = 'C:/Old';
  h.state.workspace = 'C:/Old';
  h.state.items = [{ itemId: 'a', text: 'open' }];
  h.state.sessions = [
    { sessionId: 'old-1', title: 'Old', projectPath: 'C:/Old', workspace: 'C:/Old' },
    { sessionId: 'keep', title: 'Keep', projectPath: 'C:/Keep', workspace: 'C:/Keep' },
  ];
  h.state.projects = ['C:/Old', 'C:/Keep'];
  await h.removeProject('C:/Old');
  assert.deepEqual(h.state.sessions.map(s => s.sessionId), ['keep']);
  assert.deepEqual(h.state.projects, ['C:/Keep']);
  assert.equal(h.state.sessionId, null);
  assert.deepEqual(h.state.items, []);
  assert.equal(h.state.projectPath, null);
  assert.equal(h.state.workspace, path.join('C:/temp', 'general-chat'));
  assert.equal(h.mkdirCalls.length, 1);
  assert.equal(h.rmCalls.length, 2);
});

test('project removal waits for running or loading work', async () => {
  const h = harness();
  h.setMuseHome('C:/muse-data');
  h.state.sessionId = 'active-id';
  h.state.projectPath = 'C:/Active';
  h.state.busy = true;
  h.state.sessions = [
    { sessionId: 'active-id', title: 'Active', projectPath: 'C:/Active', workspace: 'C:/Active' },
    { sessionId: 'old-id', title: 'Old', projectPath: 'C:/Old', workspace: 'C:/Old' },
  ];
  h.state.projects = ['C:/Active', 'C:/Old'];
  await assert.rejects(h.removeProject('C:/Active'), /running|stop/i);
  assert.equal(h.state.sessions.length, 2);
  await assert.rejects(h.removeProject('C:/Old'), /running|stop/i);
  assert.equal(h.state.sessions.length,2);
  h.state.busy = false;
  h.state.loading = true;
  await assert.rejects(h.removeProject('C:/Active'), /loading/i);
});

test('project removal protects saved queues and interrupted requests',async()=>{
  for(const work of [{pendingQueue:[{queueId:'q'}]},{activeRequest:{turnId:'interrupted'}}]){
    const h=harness({loadWork:async()=>work});h.state.sessions=[{sessionId:'old',projectPath:'C:/Old',workspace:'C:/Old'}];h.state.projects=['C:/Old'];
    await assert.rejects(h.removeProject('C:/Old'),/pending|queued|resolve/i);assert.equal(h.rmCalls.length,0);assert.equal(h.state.sessions.length,1);
  }
});
test('failed library persistence preserves project and performs no history deletion',async()=>{
  const h=harness({saveConversations:async()=>{throw Error('disk full');}});h.state.sessions=[{sessionId:'old',projectPath:'C:/Old',workspace:'C:/Old'}];h.state.projects=['C:/Old'];
  await assert.rejects(h.removeProject('C:/Old'),/disk full/);assert.deepEqual(h.state.projects,['C:/Old']);assert.equal(h.state.sessions.length,1);assert.equal(h.rmCalls.length,0);
});

test('removeUnknownProjectThrows', async () => {
  const h = harness();
  h.state.sessions = [{ sessionId: 'active-id', title: 'Active', workspace: 'C:/A' }];
  h.state.projects = ['C:/A'];
  await assert.rejects(h.removeProject('C:/Missing'), /not in Mora Desktop/);
  await assert.rejects(h.removeProject(''), /choose a project/i);
});
test('removal deletes cached native message journals as well as source logs',async t=>{
  const temp=await mkdtemp(path.join(tmpdir(),'mora-remove-history-')),home=path.join(temp,'muse'),root=path.join(temp,'project'),cache=path.join(home,'sessions','.msp-view-v1','old');
  t.after(()=>rm(temp,{recursive:true,force:true}));
  for(const directory of [root,path.join(home,'old'),cache])await mkdir(directory,{recursive:true});
  await writeFile(path.join(root,'keep.js'),'project source');await writeFile(path.join(home,'old','session.jsonl'),'native source log');await writeFile(path.join(cache,'journal-00000001.bin'),'cached user/assistant text');
  const h=harness({rm});h.setMuseHome(home);h.state.projects=[root];h.state.sessions=[{sessionId:'old',projectPath:root,workspace:root}];
  await h.removeProject(root);
  await assert.rejects(stat(path.join(home,'old')),{code:'ENOENT'});await assert.rejects(stat(cache),{code:'ENOENT'});assert.equal(await readFile(path.join(root,'keep.js'),'utf8'),'project source');
});
