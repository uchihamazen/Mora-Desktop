import { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell } from 'electron';
import { readFile, writeFile, mkdir, rename, stat, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MspClient, discoverMuse, uuid7 } from './msp.js';
import { ExecRunner, readHistory, readCachedHistory, applyExecRecord, applyNativeRecord, resolveSessionLogPath } from './runtime.js';
import { validateImages } from './images.js';
import { createState, assertIdle, applyEvent } from './state.js';
import { snapshotProject, compareProject, watchProjectChanges, saveChangeSummary, loadChangeSummaries, deleteChangeSummaries } from './changes.js';
import { profilePath, loadConversations, saveConversations } from './persistence.js';
import { projectPathFor, groupConversations } from './projects.js';
import { DesktopBrowser } from './browser.js';
import {checkStitch,configureStitch,readStitchSettings,stitchStatus} from './stitch.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
let window, prefsPath, museHome, executable, quitting = false;
const runner = new ExecRunner();
const state = { ...createState(), connection: 'connecting', workspace: '', projectPath: null, projects: [], modelId: 'muse-spark-1.3-contributor', reasoningEffort: 'max', executionMode: 'readonly', models: [], sessions: [], sessionId: null, engineVersion: '', transport: 'exec' };
let preferences = {};
let stitchChanging=false;
async function stitchCommand(action,payload={}) {
  const filename=path.resolve(process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'),'.config'),'muse','settings.json');
  if(action==='open'){await shell.openExternal('https://stitch.withgoogle.com/');return;}
  if(action==='state'){const {server}=await readStitchSettings(filename);return {...stitchStatus(server),configPath:filename};}
  if(!['connect','test','disconnect'].includes(action))throw new Error('Unknown Stitch action.');
  assertIdle(state);if(stitchChanging)throw new Error('A Stitch connection check is already running.');stitchChanging=true;
  try{
    if(action==='disconnect')return await configureStitch(filename,null);
    const provided=typeof payload?.apiKey==='string' && !!payload.apiKey.trim();
    const key=action==='connect' || provided ? payload?.apiKey : (await readStitchSettings(filename)).server?.headers?.['X-Goog-Api-Key'];
    const verified=await checkStitch(key);
    if(action==='connect')await configureStitch(filename,key);
    const {server}=await readStitchSettings(filename);
    return {...stitchStatus(server),verified:true,keyOnly:action==='test' && provided,...verified,configPath:filename};
  }finally{stitchChanging=false;}
}
let updateTimer, saveQueue = Promise.resolve();
function publish() {
  if (!updateTimer) updateTimer = setTimeout(() => { updateTimer = null; if (window && !window.isDestroyed()) window.webContents.send('muse:event', { type: 'state', state }); }, 30);
}
function report(error) { state.error = error.message || String(error); publish(); }
function save() {
  preferences = { ...preferences, workspace: state.workspace, projectPath: state.projectPath, projects: state.projects, modelId: state.modelId, reasoningEffort: state.reasoningEffort, executionMode: state.executionMode, lastSessionId: state.sessionId, sessions: state.sessions };
  const snapshot = JSON.stringify(preferences, null, 2);
  const temp = `${prefsPath}.tmp`;
  const operation = saveQueue.then(async () => { await saveConversations(app.getPath('userData'), JSON.parse(snapshot)); await writeFile(temp, snapshot); await rename(temp, prefsPath); });
  saveQueue = operation.catch(() => {});
  return operation;
}
function currentSession() { return state.sessions.find(session => session.sessionId === state.sessionId); }
async function attachChangeSummaries(items, sessionId) {
  for (const summary of await loadChangeSummaries(app.getPath('userData'), sessionId)) {
    if (items.some(item => item.itemId === summary.itemId)) continue;
    const index = items.findLastIndex(item => item.turnId === summary.turnId);
    if (index !== -1) items.splice(index + 1, 0, summary);
  }
  return items;
}
async function connect() {
  assertIdle(state);
  const previousHome = museHome;
  state.connection = 'connecting'; if (!state.historyMissing) state.error = ''; publish();
  const client = new MspClient();
  try {
    executable = await discoverMuse(preferences.executable);
    const metadata = await client.connect({ executable, workspace: state.workspace });
    museHome = metadata.museHome; preferences.museHome = museHome; state.engineVersion = metadata.serverInfo.version;
    const catalog = await client.request('model/list'); state.models = catalog.models;
    if (!state.models.some(model => model.modelId === state.modelId)) state.modelId = state.models.find(model => model.isDefault)?.modelId || state.models[0]?.modelId || state.modelId;
    if (museHome !== previousHome && state.sessionId) await resumeChat(state.sessionId);
    await save();
    state.connection = 'ready';
  } catch (error) { state.connection = 'disconnected'; report(error); }
  finally { await client.close(); publish(); }
  return state;
}
async function newChat(projectPath = state.projectPath) {
  assertIdle(state);
  state.loading = true; publish();
  try {
  if (projectPath !== null && (typeof projectPath !== 'string' || !path.isAbsolute(projectPath))) throw new Error('Choose an absolute project path.');
  const workspace = projectPath || path.join(app.getPath('userData'), 'general-chat');
  if (projectPath === null) await mkdir(workspace, {recursive:true});
  else if (!(await stat(workspace)).isDirectory()) throw new Error('Choose a project directory.');
  state.projectPath = projectPath; state.workspace = workspace;
  state.sessionId = uuid7(); Object.assign(state, createState());
  state.loading = true;
  state.sessions.unshift({ sessionId: state.sessionId, title: 'New conversation', hasMessages: false, projectPath, workspace: state.workspace, modelId: state.modelId, reasoningEffort: state.reasoningEffort, createdAt: new Date().toISOString() });
  state.projects = groupConversations(state.sessions, state.projects).slice(1).map(group => group.projectPath);
  await save(); return state;
  } finally { state.loading = false; publish(); }
}
async function resumeChat(sessionId) {
  assertIdle(state);
  const session = state.sessions.find(item => item.sessionId === sessionId);
  if (!session) throw new Error('This conversation is not in Mora Desktop.');
  Object.assign(state, createState(), { loading: true, sessionId, projectPath: projectPathFor(session), workspace: session.workspace, modelId: session.modelId || state.modelId, reasoningEffort: session.reasoningEffort || state.reasoningEffort });
  publish();
  try {
  try { state.items = await readHistory(sessionId, museHome); await attachChangeSummaries(state.items, sessionId); }
  catch (error) {
    if (error.code !== 'ENOENT') report(error);
    else {
      try { state.items = await readCachedHistory(sessionId, museHome); await attachChangeSummaries(state.items, sessionId); }
      catch (cacheError) { if (cacheError.code !== 'ENOENT') report(cacheError); }
      state.historyMissing = session.hasMessages !== false || state.items.length > 0;
      if (state.historyMissing) state.error = state.items.length ? 'Saved messages recovered from Muse cache. The original engine log is missing: restore it from a backup or antivirus quarantine to continue this conversation, or start a new chat.' : 'The original conversation log is missing. Restore it from a backup or antivirus quarantine, or start a new chat.';
    }
  }
  await save(); return state;
  } finally { state.loading = false; publish(); }
}
async function deleteChat(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('Choose a conversation to delete.');
  const index = state.sessions.findIndex(item => item.sessionId === sessionId);
  if (index === -1) throw new Error('This conversation is not in Mora Desktop.');
  if (state.loading) throw new Error('A conversation is loading. Wait before deleting.');
  if (state.busy && sessionId === state.sessionId) throw new Error('A request is running. Stop it before deleting this chat.');
  state.sessions.splice(index, 1);
  if (state.sessionId === sessionId) Object.assign(state, createState(), { sessionId: null });
  await save();
  await deleteChangeSummaries(app.getPath('userData'), sessionId).catch(report);
  if (museHome) {
    try {
      const directory = path.dirname(path.resolve(resolveSessionLogPath(sessionId, museHome)));
      const relative = path.relative(path.resolve(museHome), directory);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('History directory is outside Muse storage.');
      await rm(directory, { recursive: true, force: true });
    }
    catch (error) { state.error = `Chat removed from the list, but its history file could not be deleted: ${error.message}`; }
  }
  publish();
  return state;
}

function consume(record) {
  applyExecRecord(state, record); publish();
}

async function sendMessage({ text, images = [] } = {}) {
  if (state.historyMissing) throw new Error('Restore this conversation\'s original engine log or start a new chat before sending.');
  if (state.loading) throw new Error('A conversation is loading. Wait before switching or sending.');
  if (state.connection !== 'ready') throw new Error('Connect to Muse before sending a message.');
  if (typeof text !== 'string' || text.length > 200000) throw new Error('Message is too long.');
  const validated = validateImages(images);
  if (!text.trim() && !validated.length) throw new Error('Write a message or attach an image.');
  if (state.busy) {
    if (state.pendingQueue.length >= 10) throw new Error('The send queue is full (10 messages). Wait for the current request to finish.');
    state.pendingQueue.push({ queueId: uuid7(), text, images: validated, queuedAt: new Date().toISOString() });
    publish();
    return { queued: true };
  }
  if (!state.sessionId) await newChat();
  state.busy = true; state.finishing = false; state.activity = 'Starting Muse'; state.error = ''; state.stopping = false; state.activeTurnId = uuid7(); publish();
  let acceptResolve, acceptReject;
  const accepted = new Promise((resolve, reject) => { acceptResolve = resolve; acceptReject = reject; });
  const drain = (async () => {
    try {
      let next = { text, images: validated };
      let first = true;
      while (next) {
        let result;
        try {
          result = await executeTurn(next.text, next.images, { onAccept: () => { if (first) acceptResolve({ accepted: true }); } });
        } catch (error) {
          state.pendingQueue = [];
          if (first) acceptReject(error); else report(error);
          break;
        }
        first = false;
        if (result.stopped) { state.pendingQueue = []; break; }
        next = state.pendingQueue.shift() || null;
        if (next) publish();
      }
    } finally {
      state.busy = false; state.finishing = false; state.activity = ''; state.activeTurnId = null; state.outputStream = null; state.stopping = false; publish();
    }
  })();
  drain.catch(report);
  return accepted;
}

async function executeTurn(text, validated, hooks) {
  let temp, before, reviewWatcher;
  const updateReview = (changes, live) => {
    const itemId = `changes-${state.activeTurnId}`;
    const index = state.items.findIndex(item => item.itemId === itemId);
    const item = { itemId, turnId: state.activeTurnId, kind: 'fileChanges', live, ...changes };
    if (changes.files.length || changes.partial) {
      if (index === -1) state.items.push(item); else state.items[index] = item;
    } else if (index !== -1) state.items.splice(index, 1);
    publish(); return item;
  };
  const executionMode = state.projectPath === null ? 'readonly' : state.executionMode;
  try {
    temp = await mkdtemp(path.join(app.getPath('temp'), 'muse-desktop-input-'));
    const promptFile = path.join(temp, 'prompt.txt'); await writeFile(promptFile, text || 'Describe the attached image.');
    const imagePaths = [];
    for (const [index, image] of validated.entries()) {
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[image.mediaType];
      const imagePath = path.join(temp, `${index}.${ext}`); await writeFile(imagePath, Buffer.from(image.base64Data, 'base64')); imagePaths.push(imagePath);
    }
    const session = currentSession();
    if (session.title === 'New conversation') session.title = (text.trim() || 'Image conversation').slice(0,65);
    session.modelId = state.modelId; session.reasoningEffort = state.reasoningEffort; session.hasMessages = true;
    await save();
    if (state.stopping) throw new Error('Stopped before execution.');
    if (executionMode === 'full') {
      state.activity = 'Checking project files'; publish();
      try { before = await snapshotProject(state.workspace); } catch { /* Chat remains available if the project cannot be inspected. */ }
    }
    if (state.stopping) throw new Error('Stopped before execution.');
    let admitted = false, outcome = null, failure = null;
    await new Promise(resolveGate => {
      const receive = record => {
        if (!admitted && record.payload?.kind === 'command_accepted') {
          admitted = true; state.activeTurnId = record.payload.command_id || record.causation_id;
          applyEvent(state, 'item/completed', { item: { itemId: `user-${state.activeTurnId}`, kind: 'userMessage', revision: 1, status: 'completed', text, images: validated } });
          if (before) reviewWatcher = watchProjectChanges(state.workspace, before, changes => updateReview(changes, true));
          hooks.onAccept();
        }
        consume(record);
      };
      runner.on('record', receive);
      const receiveDetails = record => { applyNativeRecord(state, record); publish(); };
      runner.on('history-record', receiveDetails);
      runner.run({ executable, workspace: state.workspace, sessionId: state.sessionId, promptFile, images: imagePaths, executionMode, modelId: state.modelId, reasoningEffort: state.reasoningEffort, museHome })
        .then(async result => {
          outcome = result;
          await reviewWatcher?.close();
          if (result.stopped) state.error = 'Stopped. Completed file changes remain in your project.';
          else if (result.code !== 0 || result.error || !result.terminal) state.error = result.error || result.stderr || `Muse exited (${result.code}) before completing the request.`;
          if (result.stopped || result.code !== 0 || result.error || !result.terminal) {
            for (const item of state.items) if (item.turnId === state.activeTurnId && item.kind === 'toolCall' && item.status === 'inProgress') item.status = result.stopped ? 'cancelled' : 'failed';
          }
          if (!result.stopped && result.code === 0) {
            try {
              const historic = await readHistory(state.sessionId, museHome);
              // Keep just-submitted image previews while native history remains the source of text.
              for (const item of historic) { const live = state.items.find(row => row.itemId === item.itemId); if (live?.images) item.images = live.images; }
              if (historic.length) {
                const liveReview = state.items.find(item => item.itemId === `changes-${state.activeTurnId}`);
                state.items = historic; await attachChangeSummaries(state.items, state.sessionId);
                if (liveReview) state.items.push(liveReview);
              }
            } catch (error) { if (error.code !== 'ENOENT') report(error); }
          }
        })
        .catch(error => { failure = error; report(error); })
        .finally(async () => {
          await reviewWatcher?.close();
          if (before && admitted) {
            state.activity = 'Reviewing file changes'; publish();
            try {
              const changes = await compareProject(state.workspace, before);
              const item = updateReview(changes, false);
              if (changes.files.length || changes.partial) {
                await saveChangeSummary(app.getPath('userData'), state.sessionId, item);
              }
            } catch (error) {
              const item = state.items.find(item => item.itemId === `changes-${state.activeTurnId}`);
              if (item) { item.live = false; item.partial = true; }
              report(new Error(`File change review unavailable: ${error.message}`));
            }
          }
          runner.off('record', receive); runner.off('history-record', receiveDetails);
          if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
          publish();
          resolveGate();
        });
    });
    if (failure && !admitted) throw failure;
    if (!admitted) throw new Error(outcome?.stderr || 'Muse did not accept this message.');
    return { stopped: !!outcome?.stopped, admitted };
  } catch (error) { if (temp && !runner.child) await rm(temp, { recursive: true, force: true }).catch(() => {}); throw error; }
}

function handle(name, fn) {
  ipcMain.handle(`muse:${name}`, async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted request.');
    try { return await fn(...args); } catch (error) { if (!['browser','stitch'].includes(name)) report(error); throw error; }
  });
}

// Set before the instance lock: packaged/source launches share history; tests do not.
app.setPath('userData', profilePath(app.getPath('appData')));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  // Electron waits for ESM evaluation before ready: don't await ready at module scope.
  app.whenReady().then(async () => {
  prefsPath = path.join(app.getPath('userData'), 'preferences.json');
  await mkdir(app.getPath('userData'), { recursive: true });
  try { preferences = JSON.parse(await readFile(prefsPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') { await rename(prefsPath, `${prefsPath}.corrupt-${Date.now()}`).catch(() => {}); state.error = 'Settings were unreadable. A backup was kept.'; } }
  for (const key of ['workspace','modelId','reasoningEffort','executionMode']) if (typeof preferences[key] === 'string') state[key] = preferences[key];
  if (!['readonly','full'].includes(state.executionMode)) state.executionMode = 'readonly';
  const library = await loadConversations(app.getPath('userData'), preferences);
  state.sessions = library.sessions;
  state.projects = groupConversations(state.sessions, library.projects).slice(1).map(group => group.projectPath);
  preferences.lastSessionId = library.lastSessionId;
  await saveConversations(app.getPath('userData'), {...library, projects:state.projects});
  museHome = preferences.museHome || path.join(app.getPath('home'), '.local', 'share', 'muse');
  try { if (!state.workspace || !(await stat(state.workspace)).isDirectory()) throw new Error('Missing project'); }
  catch { state.workspace = ''; }
  state.projectPath = preferences.projectPath === null ? null : state.workspace || null;
  if (state.projectPath === null) {
    state.workspace = path.join(app.getPath('userData'), 'general-chat');
    await mkdir(state.workspace, {recursive:true});
  }
  window = new BrowserWindow({ width: 1230, height: 850, minWidth: 860, minHeight: 620, title: 'Mora Desktop', icon: path.join(directory, 'assets/mora-mark.ico'), backgroundColor: '#101114', autoHideMenuBar: true, show: false, webPreferences: { preload: path.join(directory, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.once('ready-to-show', () => window.show());
  const browser = new DesktopBrowser(window);
  handle('browser', (action, payload) => browser.command(action, payload));
  handle('stitch', stitchCommand);
  handle('get-state', () => state);
  handle('connect', connect);
  handle('new-chat', newChat);
  handle('resume-chat', resumeChat);
  handle('delete-chat', deleteChat);
  handle('send', sendMessage);
  handle('stop', async () => { state.pendingQueue = []; applyEvent(state, 'stop/requested', {}); publish(); await runner.stop(); });
  handle('choose-workspace', async () => { assertIdle(state); const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'], defaultPath: state.projectPath || app.getPath('documents') }); if (!result.canceled) await newChat(result.filePaths[0]); return state; });
  handle('choose-muse', async () => { assertIdle(state); const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Muse executable', extensions: ['exe'] }] }); if (!result.canceled) { preferences.executable = await discoverMuse(result.filePaths[0]); await save(); await connect(); } return state; });
  handle('set-options', async options => {
    assertIdle(state);
    if (!options || typeof options !== 'object') throw new Error('Invalid options.');
    if (options.modelId !== undefined) { if (!state.models.some(m => m.modelId === options.modelId)) throw new Error('Choose an available Muse model.'); state.modelId = options.modelId; }
    const model = state.models.find(m => m.modelId === state.modelId);
    if (options.reasoningEffort !== undefined) { if (!Array.isArray(model?.variants) || !model.variants.includes(options.reasoningEffort)) throw new Error('Choose a supported reasoning effort.'); state.reasoningEffort = options.reasoningEffort; }
    else if (Array.isArray(model?.variants) && !model.variants.includes(state.reasoningEffort)) state.reasoningEffort = model.defaultReasoningEffort || model.variants[0];
    if (options.executionMode !== undefined) { if (!['readonly','full'].includes(options.executionMode)) throw new Error('Invalid execution mode.'); state.executionMode = options.executionMode; }
    await save(); publish(); return state;
  });
  handle('pick-images', async () => { const result = await dialog.showOpenDialog(window, { properties: ['openFile','multiSelections'], filters: [{ name: 'Images', extensions: ['png','jpg','jpeg','webp'] }] }); if (result.canceled) return []; const images = []; for (const filename of result.filePaths) { if ((await stat(filename)).size > 10*1024*1024) throw new Error('Each image must be 10 MB or smaller.'); const ext = path.extname(filename).toLowerCase(); images.push({ mediaType: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg', base64Data: (await readFile(filename)).toString('base64'), name: path.basename(filename) }); } validateImages(images); return images; });
  handle('copy-text', text => { if (typeof text !== 'string' || text.length > 1000000) throw new Error('Invalid text.'); clipboard.writeText(text); });
  await window.loadFile(path.join(directory, 'index.html'));
  if (preferences.lastSessionId && state.sessions.some(s => s.sessionId === preferences.lastSessionId)) await resumeChat(preferences.lastSessionId).catch(report);
  await connect();
  app.on('before-quit', event => { if (!quitting && runner.child) { event.preventDefault(); quitting = true; runner.stop().finally(() => app.quit()); } });
  app.on('window-all-closed', () => app.quit());
  }).catch(error => { dialog.showErrorBox('Mora Desktop could not start', error.message); app.quit(); });
}
