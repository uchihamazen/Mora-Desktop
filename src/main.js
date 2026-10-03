import { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell, Menu } from 'electron';
import { readFile, writeFile, mkdir, rename, stat, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MspClient, discoverMuse, uuid7 } from './msp.js';
import { ExecRunner, readHistory, readCachedHistory, applyExecRecord, applyNativeRecord, resolveSessionLogPath } from './runtime.js';
import { validateImages } from './images.js';
import { createState, assertIdle, applyEvent } from './state.js';
import { snapshotProject, compareProject, watchProjectChanges, saveChangeSummary, loadChangeSummaries, deleteChangeSummaries } from './changes.js';
import { profilePath, loadConversations, saveConversations } from './persistence.js';
import {loadWork, saveWork, deleteWork, validateDraft} from './work.js';
import {effortForPreset} from './speed.js';
import {accountState,AccountLogin} from './account.js';
import {createProject} from './project.js';
import {Checkpoints} from './checkpoints.js';
import {ProjectRunner} from './project-work.js';
import { projectPathFor, groupConversations, projectKey } from './projects.js';
import { contextMenuTemplate } from './context-menu.js';
import { DesktopBrowser } from './browser.js';
import {checkStitch,configureStitch,readStitchSettings,stitchStatus} from './stitch.js';
import {checkTrello,configureTrello,readTrelloSettings,trelloStatus} from './trello.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
let window, prefsPath, museHome, executable, connectionAttempt, quitting = false;
const runner = new ExecRunner();
const state = { ...createState(), connection: 'connecting', workspace: '', projectPath: null, projects: [], modelId: 'muse-spark-1.3-contributor', reasoningEffort: 'max', executionMode: 'readonly', models: [], sessions: [], sessionId: null, engineVersion: '', transport: 'exec' };
let preferences = {};
let projectRunner, desktopBrowser, drainCompletion, projectOperation=false, projectCancelled=false, repairInProgress=false;
const checkpointStores=new Map();
function checkpointStore() {
  if(!state.projectPath)throw new Error('Open a project before saving checkpoints.');
  if(!checkpointStores.has(state.projectPath))checkpointStores.set(state.projectPath,new Checkpoints(app.getPath('userData'),state.projectPath));
  return checkpointStores.get(state.projectPath);
}
function assertProjectStopped() {if(projectOperation || repairInProgress || projectRunner?.active || projectRunner?.runChild)throw new Error('Stop Run and Test before switching projects or restoring files.');}
async function checkpointCommand(action,payload={}) {
  const store=checkpointStore();
  if(action==='list')return store.list();
  assertIdle(state);assertProjectStopped();
  projectOperation=true;state.projectOperation=true;publish();
  try {
    if(action==='create')return await store.create(payload.label);
    if(action==='preview')return await store.preview(payload.id);
    if(action==='restore')return await store.restore(payload);
    if(action==='delete')return await store.delete(payload.id);
    throw new Error('Unknown checkpoint action.');
  }finally{projectOperation=false;state.projectOperation=false;publish();}
}
async function projectCommand(action) {
  if(action==='stop'){projectCancelled=true;await projectRunner.stopRun();return state.projectWork;}
  if(action==='stop-tests'){projectCancelled=true;await projectRunner.stopTests();return state.projectWork;}
  if(action==='fix')return repairFailures();
  assertIdle(state);
  if(projectOperation || repairInProgress || projectRunner.active)throw new Error('Wait for the project command to finish.');
  if(!state.projectPath)throw new Error('Open a project first.');
  if(!['run','restart','test'].includes(action))throw new Error('Unknown project action.');
  if(action==='run' && projectRunner.runChild)throw new Error('Your app is already running. Use Restart.');
  projectOperation=true;projectCancelled=false;state.projectOperation=true;publish();let checkpoint;
  try {
    if(action==='restart')await projectRunner.stopRun();
    checkpoint=await checkpointStore().create(action==='test'?'Before Test':'Before Run',{manual:action!=='test'});
    if(projectCancelled)throw new Error('Project command stopped before execution.');
    if(action==='test')await projectRunner.test(state.projectPath,{previewCheck:projectRunner.state.run.status==='ready'?()=>desktopBrowser.checkPage(projectRunner.state.run.url):undefined});
    else await projectRunner.run(state.projectPath);
    return state.projectWork;
  }finally{if(checkpoint)await checkpointStore().seal(checkpoint.id).catch(report);projectOperation=false;state.projectOperation=false;publish();}
}
async function repairFailures() {
  assertIdle(state);if(projectOperation || repairInProgress)throw new Error('Wait for the current project command.');
  if(state.executionMode!=='full' || !state.projectPath)throw new Error('Choose Full access before asking Muse to fix project files.');
  const tests=projectRunner.state.tests;if(tests.status!=='failed' || projectRunner.state.root!==state.projectPath)throw new Error('Run Test and review the failures first.');
  const evidence=tests.results.filter(item=>item.status==='failed').map(item=>`${item.script}: ${item.message}\n${item.output.slice(-4000)}`).join('\n\n');
  const text=`Fix the specific failures below in this project with the smallest necessary change. Preserve unrelated work. Do not weaken or delete tests to obtain a pass. The desktop will run the configured checks once after this request.\n\n${evidence}\nPage load: ${tests.preview?.message || 'not checked'}`;
  repairInProgress=true;state.projectRepair=true;state.queuePaused=true;publish();
  try {
    await persistWork();await sendMessage({text,images:[]},{repair:true});await drainCompletion;
    if(state.lastOutcome?.status==='finished'){repairInProgress=false;await projectCommand('test');}
    return state.projectWork;
  }finally{repairInProgress=false;state.projectRepair=false;publish();}
}
const login=new AccountLogin(value=>{state.account=value;publish();if(value.status!=='pending' && window && !window.isDestroyed())connect().catch(report);},{openExternal:url=>shell.openExternal(url)});
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
let trelloChanging=false;
async function trelloCommand(action,payload={}) {
  const filename=path.join(app.getPath('userData'),'trello.json');
  if(action==='state'){const saved=await readTrelloSettings(filename);return {...trelloStatus(saved),configPath:filename};}
  if(!['connect','test','disconnect'].includes(action))throw new Error('Unknown Trello action.');
  assertIdle(state);if(trelloChanging)throw new Error('A Trello connection check is already running.');trelloChanging=true;
  try{
    if(action==='disconnect')return await configureTrello(filename,null);
    const saved=await readTrelloSettings(filename);
    const provided=typeof payload?.apiKey==='string' && !!payload.apiKey.trim() && typeof payload?.token==='string' && !!payload.token.trim();
    const creds=action==='connect' || provided ? {apiKey:payload?.apiKey,token:payload?.token,board:payload?.board} : {apiKey:saved?.apiKey,token:saved?.token,board:saved?.board};
    const verified=await checkTrello(creds);
    if(action==='connect')await configureTrello(filename,{...creds,...verified});
    return {...trelloStatus({...creds,...verified}),verified:true,keyOnly:action==='test' && provided,...verified};
  }finally{trelloChanging=false;}
}
let updateTimer, saveQueue = Promise.resolve();
let queueOperation = Promise.resolve(), queueReservation = 0;
function publish() {
  if (!updateTimer) updateTimer = setTimeout(() => { updateTimer = null; if (window && !window.isDestroyed()) window.webContents.send('muse:event', { type: 'state', state }); }, 30);
}
function report(error) { state.error = error.message || String(error); publish(); }
function save() {
  preferences = { ...preferences, workspace: state.workspace, projectPath: state.projectPath, projects: state.projects, modelId: state.modelId, reasoningEffort: state.reasoningEffort, speedPreset: state.speedPreset || 'custom', executionMode: state.executionMode, lastSessionId: state.sessionId, sessions: state.sessions };
  const snapshot = JSON.stringify(preferences, null, 2);
  const temp = `${prefsPath}.tmp`;
  const operation = saveQueue.then(async () => { await saveConversations(app.getPath('userData'), JSON.parse(snapshot)); await writeFile(temp, snapshot); await rename(temp, prefsPath); });
  saveQueue = operation.catch(() => {});
  return operation;
}
function currentSession() { return state.sessions.find(session => session.sessionId === state.sessionId); }
function persistWork() {
  if(state.workUnavailable) return Promise.reject(new Error('Restore the saved work backup before sending.'));
  return saveWork(app.getPath('userData'),state.sessionId || 'new',state);
}
async function restoreWork(sessionId) {
  try {
    Object.assign(state,await loadWork(app.getPath('userData'),sessionId));
    if(state.activeRequest) state.lastOutcome = {status:'interrupted',turnId:state.activeRequest.turnId,message:'The previous request was interrupted. Review the saved conversation before sending again.'};
  } catch(error) { state.workUnavailable = true; report(error); }
}
async function saveDraft({sessionId = null,...value}) {
  if(sessionId !== null && !state.sessions.some(session=>session.sessionId===sessionId)) throw new Error('This conversation is not in Mora Desktop.');
  const draft = validateDraft(value);
  const owner = sessionId || 'new';
  if(owner === (state.sessionId || 'new')) { state.draft = draft; await persistWork(); }
  else { const work = await loadWork(app.getPath('userData'),owner); work.draft = draft; await saveWork(app.getPath('userData'),owner,work); }
}
async function attachChangeSummaries(items, sessionId) {
  for (const summary of await loadChangeSummaries(app.getPath('userData'), sessionId)) {
    if (items.some(item => item.itemId === summary.itemId)) continue;
    const index = items.findLastIndex(item => item.turnId === summary.turnId);
    if (index !== -1) items.splice(index + 1, 0, summary);
  }
  return items;
}
async function connect() {
  if (connectionAttempt) return connectionAttempt;
  connectionAttempt = connectEngine().finally(() => { connectionAttempt = null; });
  return connectionAttempt;
}
function reconcileModel() {
  if (!state.models.some(model => model.modelId === state.modelId)) state.modelId = state.models.find(model => model.isDefault)?.modelId || state.models[0]?.modelId || state.modelId;
  const model = state.models.find(model => model.modelId === state.modelId);
  if(['quick','balanced','thorough'].includes(state.speedPreset) && model?.variants?.length) state.reasoningEffort = effortForPreset(model,state.speedPreset);
  if (model?.variants?.length && !model.variants.includes(state.reasoningEffort)) state.reasoningEffort = model.variants.includes(model.defaultReasoningEffort) ? model.defaultReasoningEffort : model.variants[0];
}
async function connectEngine() {
  assertIdle(state);
  const previousHome = museHome;
  state.connection = 'connecting'; if (!state.historyMissing && !state.workUnavailable) state.error = ''; publish();
  const client = new MspClient();
  try {
    state.account={status:'checking',message:'Checking Muse account…'};
    try {executable=await discoverMuse(preferences.executable);}
    catch(error){state.account={status:'missing',message:'Install Muse Code or choose its executable.'};throw error;}
    const metadata = await client.connect({ executable, workspace: state.workspace, experimentalApi:true });
    const accountTimeout=client.timeoutMs;client.timeoutMs=3000;
    try {state.account=accountState(await client.request('account/read'));}
    catch {state.account=accountState(null);}
    finally {client.timeoutMs=accountTimeout;}
    museHome = metadata.museHome; preferences.museHome = museHome; state.engineVersion = metadata.serverInfo.version;
    const catalog = await client.request('model/list');
    if (!Array.isArray(catalog?.models) || !catalog.models.length || catalog.models.some(model => typeof model?.modelId !== 'string' || !model.modelId || (model.variants !== undefined && (!Array.isArray(model.variants) || model.variants.some(value => typeof value !== 'string' || !value))))) throw new Error('Muse returned an invalid model catalog. Reconnect to try discovery again.');
    state.models = catalog.models;
    reconcileModel();
    if (museHome !== previousHome && state.sessionId) await resumeChat(state.sessionId);
    reconcileModel();
    await save();
    state.connection = 'ready';
  } catch (error) { state.connection = 'disconnected'; report(error); }
  finally { await client.close(); publish(); }
  return state;
}
async function newChat(projectPath = state.projectPath) {
  assertIdle(state);
  assertProjectStopped();
  state.loading = true; publish();
  try {
  if (projectPath !== null && (typeof projectPath !== 'string' || !path.isAbsolute(projectPath))) throw new Error('Choose an absolute project path.');
  const workspace = projectPath || path.join(app.getPath('userData'), 'general-chat');
  if (projectPath === null) await mkdir(workspace, {recursive:true});
  else if (!(await stat(workspace)).isDirectory()) throw new Error('Choose a project directory.');
  if(!state.workUnavailable) await persistWork();
  state.projectPath = projectPath; state.workspace = workspace;
  state.sessionId = uuid7(); Object.assign(state, createState());
  state.loading = true;
  state.sessions.unshift({ sessionId: state.sessionId, title: 'New conversation', hasMessages: false, projectPath, workspace: state.workspace, modelId: state.modelId, reasoningEffort: state.reasoningEffort, createdAt: new Date().toISOString() });
  state.projects = groupConversations(state.sessions, state.projects).slice(1).map(group => group.projectPath);
  await restoreWork(state.sessionId);
  await save(); return state;
  } finally { state.loading = false; publish(); }
}
async function resumeChat(sessionId) {
  assertIdle(state);
  assertProjectStopped();
  const session = state.sessions.find(item => item.sessionId === sessionId);
  if (!session) throw new Error('This conversation is not in Mora Desktop.');
  state.loading = true; publish();
  try {
  if(!state.workUnavailable) await persistWork();
  Object.assign(state, createState(), { loading: true, sessionId, projectPath: projectPathFor(session), workspace: session.workspace, modelId: session.modelId || state.modelId, reasoningEffort: session.reasoningEffort || state.reasoningEffort });
  publish();
  let nativeHistoryMissing = false;
  try { state.items = await readHistory(sessionId, museHome); await attachChangeSummaries(state.items, sessionId); }
  catch (error) {
    if (error.code !== 'ENOENT') report(error);
    else {
      nativeHistoryMissing = true;
      try { state.items = await readCachedHistory(sessionId, museHome); await attachChangeSummaries(state.items, sessionId); }
      catch (cacheError) { if (cacheError.code !== 'ENOENT') report(cacheError); }
      state.historyMissing = session.hasMessages !== false || state.items.length > 0;
      if (state.historyMissing) state.error = state.items.length ? 'Saved messages recovered from Muse cache. The original engine log is missing: restore it from a backup or antivirus quarantine to continue this conversation, or start a new chat.' : 'The original conversation log is missing. Restore it from a backup or antivirus quarantine, or start a new chat.';
    }
  }
  await restoreWork(sessionId);
  if(nativeHistoryMissing && state.activeRequest?.phase==='admitted'){state.historyMissing=true;state.error='The original engine log is missing for an accepted request. Restore it from a backup or start a new chat.';}
  reconcileModel();
  await save(); return state;
  } finally { state.loading = false; publish(); }
}
async function removeNativeHistory(sessionId) {
  const directory = path.dirname(path.resolve(resolveSessionLogPath(sessionId, museHome)));
  const relative = path.relative(path.resolve(museHome), directory);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('History directory is outside Muse storage.');
  await rm(directory, { recursive: true, force: true });
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
  await deleteWork(app.getPath('userData'),sessionId).catch(report);
  if (museHome) {
    try { await removeNativeHistory(sessionId); }
    catch (error) { state.error = `Chat removed from the list, but its history file could not be deleted: ${error.message}`; }
  }
  publish();
  return state;
}
async function renameChat(sessionId, title) {
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('Choose a conversation to rename.');
  const session = state.sessions.find(item => item.sessionId === sessionId);
  if (!session) throw new Error('This conversation is not in Mora Desktop.');
  if (state.loading) throw new Error('A conversation is loading. Wait before renaming.');
  if (typeof title !== 'string' || !title.trim()) throw new Error('Write a chat name.');
  if (title.trim().length > 80) throw new Error('Keep the chat name to 80 characters.');
  session.title = title.trim();
  await save();
  publish();
  return state;
}
async function removeProject(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath) throw new Error('Choose a project to remove.');
  const key = projectKey(projectPath);
  const group = groupConversations(state.sessions, state.projects).slice(1).find(candidate => candidate.projectPath !== null && projectKey(candidate.projectPath) === key);
  if (!group) throw new Error('This project is not in Mora Desktop.');
  const removedIds = group.sessions.map(session => session.sessionId);
  const activeRemoved = removedIds.includes(state.sessionId) || (state.projectPath !== null && projectKey(state.projectPath) === key);
  if (state.loading) throw new Error('A conversation is loading. Wait before removing this project.');
  if (state.busy && activeRemoved) throw new Error('A request is running. Stop it before removing this project.');
  if (activeRemoved) assertProjectStopped();
  state.sessions = state.sessions.filter(session => !removedIds.includes(session.sessionId));
  state.projects = state.projects.filter(candidate => projectKey(candidate) !== key);
  if (activeRemoved) {
    Object.assign(state, createState(), { sessionId: null });
    state.projectPath = null;
    state.workspace = path.join(app.getPath('userData'), 'general-chat');
    await mkdir(state.workspace, { recursive: true });
  }
  await save();
  for (const sessionId of removedIds) {
    await deleteChangeSummaries(app.getPath('userData'), sessionId).catch(report);
    await deleteWork(app.getPath('userData'), sessionId).catch(report);
    if (museHome) {
      try { await removeNativeHistory(sessionId); }
      catch (error) { state.error = `Project removed from the list, but a history file could not be deleted: ${error.message}`; }
    }
  }
  publish();
  return state;
}

function consume(record) {
  applyExecRecord(state, record); publish();
}

async function sendMessage({ text, images = [] } = {},{repair=false}={}) {
  if(projectOperation || (repairInProgress && !repair))throw new Error('Wait for project checks or repair to finish. Your draft is saved.');
  if(['required','pending'].includes(state.account?.status))throw new Error('Complete Muse sign-in before sending. Your draft is saved.');
  if(state.workUnavailable) throw new Error('Restore the saved work backup before sending.');
  if (state.historyMissing) throw new Error('Restore this conversation\'s original engine log or start a new chat before sending.');
  if (state.loading) throw new Error('A conversation is loading. Wait before switching or sending.');
  if (state.connection !== 'ready') throw new Error('Connect to Muse before sending a message.');
  if (typeof text !== 'string' || text.length > 200000) throw new Error('Message is too long.');
  const validated = validateImages(images);
  if (!text.trim() && !validated.length) throw new Error('Write a message or attach an image.');
  if (state.busy) {
    if (state.pendingQueue.length + queueReservation >= 10) throw new Error('The send queue is full (10 messages). Wait for the current request to finish.');
    const entry = { queueId: uuid7(), text, images: validated, queuedAt: new Date().toISOString() };
    state.pendingQueue.push(entry);
    try { await persistWork(); } catch(error) { state.pendingQueue = state.pendingQueue.filter(item=>item!==entry); throw error; }
    publish();
    return { queued: true };
  }
  if (!state.sessionId) {
    const draft = state.draft;
    await newChat(); state.draft = draft;
  }
  return startDrain({text,images:validated});
}
function queueCommand(action, payload = {}) {
  const operation=queueOperation.catch(()=>{}).then(()=>editQueue(action,payload));queueOperation=operation;return operation;
}
async function editQueue(action, payload) {
  if(state.workUnavailable) throw new Error('Restore the saved work backup before changing the queue.');
  const previous=state.pendingQueue.slice();
  queueReservation=action==='clear'?previous.length:action==='remove'?1:0;
  try {
  if(action==='resume') {
    if(projectOperation || repairInProgress)throw new Error('Wait for project checks or repair before resuming the queue.');
    if(state.connection!=='ready' || state.historyMissing || state.loading || state.stopping) throw new Error('Reconnect and wait for the current request before resuming.');
    state.queuePaused = false; await persistWork();
    if(!state.busy && state.pendingQueue.length) {
      const next = state.pendingQueue.shift(); return startDrain(next);
    }
  } else if(action==='pause') state.queuePaused = true;
  else if(action==='clear') state.pendingQueue = [];
  else if(action==='remove' || action==='edit') {
    const index = state.pendingQueue.findIndex(entry=>entry.queueId===payload.queueId);
    if(index<0) throw new Error('This request is no longer queued.');
    if(action==='remove') state.pendingQueue.splice(index,1);
    else {
      if(typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length>200000) throw new Error('Write a message of at most 200,000 characters.');
      state.pendingQueue[index] = {...state.pendingQueue[index],text:payload.text};
    }
  } else throw new Error('Unknown queue action.');
  await persistWork(); publish(); return state;
  } catch(error) {
    const added=state.pendingQueue.filter(entry=>!previous.some(saved=>saved.queueId===entry.queueId));
    state.pendingQueue=[...previous,...added];state.queuePaused=true;publish();throw error;
  } finally {queueReservation=0;}
}
function startDrain(request) {
  state.busy = true; state.finishing = false; state.activity = 'Starting Muse'; state.error = ''; state.stopping = false; state.activeTurnId = uuid7(); publish();
  let acceptResolve, acceptReject;
  const accepted = new Promise((resolve, reject) => { acceptResolve = resolve; acceptReject = reject; });
  const drain = (async () => {
    try {
      let next = request;
      let first = true;
      while (next) {
        let result;
        try {
          state.activeTurnId = uuid7();
          state.activeRequest = {...next,turnId:state.activeTurnId,phase:'preparing'};
          await persistWork();
          result = await executeTurn(next.text, next.images, { onAccept: () => { if (first) acceptResolve({ accepted: true }); } });
        } catch (error) {
          state.queuePaused = true;
          state.lastOutcome = {status:state.stopping?'interrupted':'failed',turnId:state.activeTurnId,message:error.message};
          await persistWork().catch(report);
          if (first) acceptReject(error); else report(error);
          break;
        }
        first = false;
        state.activeRequest = null;
        if (result.stopped || result.failed) state.queuePaused = true;
        await persistWork();
        await queueOperation.catch(()=>{});
        if(state.queuePaused || state.stopping) break;
        next = state.pendingQueue.shift() || null;
        if (next) publish();
      }
    } finally {
      state.busy = false; state.finishing = false; state.activity = ''; state.activeTurnId = null; state.outputStream = null; state.stopping = false; publish();
    }
  })();
  drainCompletion=drain;
  drain.catch(report);
  return accepted;
}

async function executeTurn(text, validated, hooks) {
  let temp, before, reviewWatcher, checkpoint;
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
    session.modelId = state.modelId; session.reasoningEffort = state.reasoningEffort;
    await save();
    if (state.stopping) throw new Error('Stopped before execution.');
    if (executionMode === 'full') {
      state.activity = 'Saving checkpoint'; publish();
      checkpoint=await checkpointStore().create('Before Muse request',{manual:false});
      try { before = await snapshotProject(state.workspace); } catch { /* Chat remains available if the project cannot be inspected. */ }
    }
    if (state.stopping) throw new Error('Stopped before execution.');
    let admitted = false, outcome = null, failure = null, admissionWrite = Promise.resolve();
    await new Promise(resolveGate => {
      const receive = record => {
        if (!admitted && record.payload?.kind === 'command_accepted') {
          admitted = true; state.activeTurnId = record.payload.command_id || record.causation_id;
          session.hasMessages = true; save().catch(report);
          applyEvent(state, 'item/completed', { item: { itemId: `user-${state.activeTurnId}`, kind: 'userMessage', revision: 1, status: 'completed', text, images: validated } });
          if (before) reviewWatcher = watchProjectChanges(state.workspace, before, changes => updateReview(changes, true));
          state.activeRequest = {...state.activeRequest,phase:'admitted',turnId:state.activeTurnId};
          admissionWrite = persistWork().then(()=>hooks.onAccept()).catch(error=>{report(error); hooks.onAccept(); state.queuePaused = true;});
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
          if (result.stopped || result.code !== 0 || result.error || !result.terminal || result.terminal.terminal !== 'completed') {
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
          await admissionWrite;
          if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
          publish();
          resolveGate();
        });
    });
    if (failure && !admitted) throw failure;
    if (!admitted) throw new Error(outcome?.stderr || 'Muse did not accept this message.');
    const failed = !!failure || !outcome || outcome.code !== 0 || !!outcome.error || outcome.terminal?.terminal !== 'completed';
    state.lastOutcome = {status:outcome?.stopped?'interrupted':failed?'failed':'finished',turnId:state.activeTurnId,message:outcome?.stopped?'Stopped. Review completed changes before continuing.':failed?'Muse did not complete this request.':'Muse finished this request.'};
    return { stopped: !!outcome?.stopped, failed, admitted };
  } catch (error) { if (temp && !runner.child) await rm(temp, { recursive: true, force: true }).catch(() => {}); throw error; }
  finally {if(checkpoint)await checkpointStore().seal(checkpoint.id).catch(error=>{state.queuePaused=true;report(new Error(`Checkpoint needs review: ${error.message}`));});}
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
  for (const key of ['workspace','modelId','reasoningEffort','executionMode','speedPreset']) if (typeof preferences[key] === 'string') state[key] = preferences[key];
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
  window.webContents.on('context-menu', (event, params) => {
    event.preventDefault();
    const template = contextMenuTemplate(params, {
      replace: suggestion => window.webContents.replaceMisspelling(suggestion),
      addToDictionary: word => window.webContents.session.addWordToSpellCheckerDictionary(word),
    });
    if (template.length) Menu.buildFromTemplate(template).popup({ window });
  });
  window.once('ready-to-show', () => window.show());
  let closing = false;
  window.on('close', event => {
    event.preventDefault();if(closing)return;closing=true;projectCancelled=true;
    window.webContents.executeJavaScript('window.flushMoraDraft?.()').then(async()=>{
      if(state.busy)state.queuePaused=true;
      if(!state.workUnavailable)await persistWork();
      await saveQueue;
      await projectRunner.shutdown();await runner.stop();
      while(projectOperation || repairInProgress || state.busy)await new Promise(resolve=>setTimeout(resolve,30));
      window.destroy();
    }).catch(error=>{closing=false;report(new Error(`Could not save pending work: ${error.message}`));});
  });
  const browser = new DesktopBrowser(window);
  desktopBrowser=browser;
  let openedRunURL;
  projectRunner=new ProjectRunner(work=>{
    state.projectWork=work;publish();
    if(work.run.status!=='ready')openedRunURL=null;
    if(work.run.status==='ready' && openedRunURL!==work.run.url){openedRunURL=work.run.url;browser.command('open').then(()=>browser.navigate(work.run.url)).catch(report);}
  });
  state.projectWork=projectRunner.state;
  handle('project-work',projectCommand);
  handle('browser', (action, payload) => browser.command(action, payload));
  handle('stitch', stitchCommand);
  handle('trello', trelloCommand);
  handle('get-state', () => state);
  handle('checkpoints',checkpointCommand);
  handle('account',async action=>{
    assertIdle(state);
    if(action==='install'){await shell.openExternal('https://dev.meta.ai/');return state.account;}
    if(action==='refresh')return connect();
    if(action==='cancel'){await login.cancel();return state.account;}
    if(action!=='login')throw new Error('Unknown account action.');
    if(state.connection==='connecting')throw new Error('Wait for Muse to finish connecting.');
    const target=await discoverMuse(preferences.executable);
    await login.start({executable:target,workspace:state.workspace});return state.account;
  });
  handle('project-parent',async()=>{assertIdle(state);const result=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory'],title:'Choose where to create your project'});return result.canceled?null:result.filePaths[0];});
  handle('create-project',async payload=>{assertIdle(state);const folder=await createProject(payload?.parent,payload?.name,{starter:payload?.starter!==false});return newChat(folder);});
  handle('connect', connect);
  handle('new-chat', newChat);
  handle('resume-chat', resumeChat);
  handle('delete-chat', deleteChat);
  handle('remove-project', removeProject);
  handle('rename-chat', renameChat);
  handle('send', sendMessage);
  handle('stop', async () => { state.queuePaused = true; applyEvent(state, 'stop/requested', {}); publish(); try { await persistWork(); } finally { await runner.stop(); } });
  handle('queue', queueCommand);
  handle('save-draft', saveDraft);
  handle('choose-workspace', async () => { assertIdle(state); const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'], defaultPath: state.projectPath || app.getPath('documents') }); if (!result.canceled) await newChat(result.filePaths[0]); return state; });
  handle('choose-muse', async () => { assertIdle(state); const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Muse executable', extensions: ['exe'] }] }); if (!result.canceled) { preferences.executable = await discoverMuse(result.filePaths[0]); await save(); await connect(); } return state; });
  handle('set-options', async options => {
    assertIdle(state);
    if (!options || typeof options !== 'object') throw new Error('Invalid options.');
    if (options.modelId !== undefined) { if (!state.models.some(m => m.modelId === options.modelId)) throw new Error('Choose an available Muse model.'); state.modelId = options.modelId; }
    const model = state.models.find(m => m.modelId === state.modelId);
    if (options.reasoningEffort !== undefined) { if (!Array.isArray(model?.variants) || !model.variants.includes(options.reasoningEffort)) throw new Error('Choose a supported reasoning effort.'); state.reasoningEffort = options.reasoningEffort; }
    if(options.reasoningEffort !== undefined) state.speedPreset = 'custom';
    if(options.speedPreset !== undefined) {
      if(!['custom','quick','balanced','thorough'].includes(options.speedPreset))throw new Error('Choose Quick, Balanced, Thorough, or Custom.');
      state.speedPreset = options.speedPreset;
    }
    reconcileModel();
    if (options.executionMode !== undefined) { if (!['readonly','full'].includes(options.executionMode)) throw new Error('Invalid execution mode.'); state.executionMode = options.executionMode; }
    await save(); publish(); return state;
  });
  handle('pick-images', async () => { const result = await dialog.showOpenDialog(window, { properties: ['openFile','multiSelections'], filters: [{ name: 'Images', extensions: ['png','jpg','jpeg','webp'] }] }); if (result.canceled) return []; const images = []; for (const filename of result.filePaths) { if ((await stat(filename)).size > 10*1024*1024) throw new Error('Each image must be 10 MB or smaller.'); const ext = path.extname(filename).toLowerCase(); images.push({ mediaType: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg', base64Data: (await readFile(filename)).toString('base64'), name: path.basename(filename) }); } validateImages(images); return images; });
  handle('copy-text', text => { if (typeof text !== 'string' || text.length > 1000000) throw new Error('Invalid text.'); clipboard.writeText(text); });
  handle('open-link', url => { const target = new URL(url); if(!['http:','https:'].includes(target.protocol) || target.username || target.password) throw new Error('Use an HTTP or HTTPS link.'); return shell.openExternal(target.href); });
  await restoreWork('new');
  await window.loadFile(path.join(directory, 'index.html'));
  // Loading saved work can postpone the first paint of a hidden native view.
  if(!window.isVisible()) window.show();
  if (preferences.lastSessionId && state.sessions.some(s => s.sessionId === preferences.lastSessionId)) await resumeChat(preferences.lastSessionId).catch(report);
  else publish();
  await connect();
  app.on('before-quit', event => { if (!quitting && runner.child) { event.preventDefault(); quitting = true; runner.stop().finally(() => app.quit()); } });
  app.on('window-all-closed', () => {Promise.allSettled([login.cancel(),projectRunner.shutdown(),runner.stop()]).then(()=>app.quit());});
  }).catch(error => { dialog.showErrorBox('Mora Desktop could not start', error.message); app.quit(); });
}
