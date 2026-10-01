import { groupConversations } from './projects.js';
import { setupBrowser } from './browser-ui.js';
import {stitchImageParts} from './images.js';

const $ = id => document.getElementById(id);
const api = window.muse;
const collapsedProjects = new Set();
const dismissedErrors = new Set();
let state = { items: [], sessions: [], models: [], busy: false, connection: 'connecting' };
let attachments = [], sending = false, lastSignature = '', startedAt = 0;
let stitchConfigured=false,stitchChanging=false;
function refreshStitch(){if(!api.stitchCommand)return;for(const name of ['connect','test','disconnect'])$(`stitch-${name}`).disabled=stitchChanging || state.busy || state.loading || (name==='test' && !stitchConfigured && !$('stitch-key').value.trim()) || (name==='disconnect' && !stitchConfigured);}
async function stitchAction(name,payload) {
  if(stitchChanging)return;stitchChanging=true;refreshStitch();
  if(name!=='open')$('stitch-status').textContent=name==='connect' || name==='test' ? 'Checking Stitch account and tools…' : 'Updating Stitch connection…';
  try{
    const result=await api.stitchCommand(name,payload);if(!result)return;
    stitchConfigured=result.configured;
    $('stitch-status').textContent=result.keyOnly ? `Key verified · ${result.tools.length} MCP tools · press Connect to use this key` : result.verified ? `Connected · ${result.tools.length} MCP tools · ${result.projectCount} projects` : stitchConfigured ? 'Configured · available on the next request. Test to verify access.' : 'Not connected';
    if(name==='connect' || name==='disconnect')$('stitch-key').value='';
  }catch(error){$('stitch-status').textContent=(error.message || String(error)).replace(/^Error invoking remote method '[^']+': Error: /,'');}
  finally{stitchChanging=false;refreshStitch();}
}
let openReviewId = null, selectedReviewPath = null, openReviewSignature = '';
const icon = name => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg; };
const textNode = (tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
function error(error) { $('error-text').textContent = (error?.message || String(error)).replace(/^Error invoking remote method '[^']+': Error: /, ''); $('error-banner').hidden = false; }
const errorKey = message => JSON.stringify([state.sessionId, message]);
async function action(fn) { try { const result = await fn(); if (result?.connection) update(result); return result; } catch (e) { error(e); } }

function showImage(source,alt) {
  document.querySelector('.image-viewer')?.close();
  const viewer=textNode('dialog','','image-viewer'),image=document.createElement('img'),close=textNode('button','×','image-viewer-close');
  image.alt=alt;image.referrerPolicy='no-referrer';image.src=source;close.setAttribute('aria-label','Close image');close.addEventListener('click',()=>viewer.close());
  viewer.append(close,image);viewer.addEventListener('click',event=>{if(event.target===viewer)viewer.close();});
  viewer.addEventListener('close',()=>{viewer.remove();api.browserCommand?.('occlude',{hidden:!!document.querySelector('.changes-panel, .image-viewer[open]')}).catch(()=>{});});
  document.body.append(viewer);api.browserCommand?.('occlude',{hidden:true}).catch(()=>{});viewer.showModal();close.focus();
}
function renderImage(parent,url,alt) {
  const figure=textNode('figure','','stitch-image'),view=textNode('button','','image-preview-button'),image=document.createElement('img');
  image.alt=alt;image.referrerPolicy='no-referrer';view.setAttribute('aria-label',`Enlarge ${alt}`);view.addEventListener('click',()=>showImage(url,alt));
  const caption=textNode('figcaption',alt),copy=textNode('button','Copy image link','image-copy-link');copy.addEventListener('click',()=>action(()=>api.copyText(url)));
  image.addEventListener('error',()=>{view.hidden=true;caption.textContent=`${alt} · Preview unavailable. Copy the image link to open it.`;});
  image.src=url;view.append(image);figure.append(view,caption,copy);parent.append(figure);
}
function renderText(parent, text,streaming=false) {
  const parts = String(text || '').split(/(```[\s\S]*?(?:```|$)|`[^`\n]+`|<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>])(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^'">])*(?:>|$))/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('```')) {
      const newline = part.indexOf('\n');
      const language = newline >= 0 ? part.slice(3,newline).trim() : '';
      const end = part.length>3 && part.endsWith('```') ? -3 : undefined;
      const value = newline >= 0 ? part.slice(newline + 1, end) : part.slice(3,end);
      const pre = document.createElement('pre'); const header = textNode('div', '', 'code-header'); header.append(textNode('span', language || 'Code'));
      const copy = textNode('button', 'Copy'); copy.prepend(icon('copy')); copy.addEventListener('click', () => action(async () => { await api.copyText(value); copy.lastChild.textContent = 'Copied'; })); header.append(copy); pre.append(header, textNode('code', value)); parent.append(pre);
    } else if(part.startsWith('`'))parent.append(textNode('code',part.slice(1,-1)));
    else if(part.startsWith('<') && /^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s|\/?>)/.test(part)){const p=textNode('p',part);p.dir='auto';parent.append(p);}
    else for(const entry of stitchImageParts(part,streaming)){
      if(entry.type==='image')renderImage(parent,entry.url,entry.alt);
      else{const p=textNode('p',entry.text);p.dir='auto';parent.append(p);}
    }
  }
}
function changeCounts(parent, added, removed) {
  parent.append(textNode('span', `+${added}`, 'change-added'), textNode('span', `-${removed}`, 'change-removed'));
}
function closeChanges() { const panel=document.querySelector('.changes-panel');panel?.remove();if(panel)api.browserCommand?.('occlude',{hidden:!!document.querySelector('.image-viewer[open]')}).catch(()=>{});openReviewId = null; selectedReviewPath = null; openReviewSignature = ''; }
function showChanges(item, refresh = false) {
  if (!refresh) { closeChanges(); openReviewId = item.itemId; }
  if (!refresh) api.browserCommand?.('occlude',{hidden:true}).catch(()=>{});
  openReviewSignature = JSON.stringify(item);
  const panel = document.querySelector('.changes-panel') || textNode('aside', '', 'changes-panel');
  const scroll = panel.querySelector('.changes-preview')?.scrollTop || 0;
  const horizontalScroll = panel.querySelector('.changes-preview')?.scrollLeft || 0;
  const listScroll = panel.querySelector('.changes-files')?.scrollTop || 0;
  const focus = panel.contains(document.activeElement) ? document.activeElement : null;
  const focusPath = focus?.dataset.path;
  panel.replaceChildren(); panel.setAttribute('aria-label', 'File changes');
  const header = textNode('div', '', 'changes-header');
  header.append(textNode('strong', `${item.files.length} ${item.files.length === 1 ? 'file' : 'files'} changed`));
  changeCounts(header, item.added, item.removed);
  if (item.live) header.append(textNode('span', 'Live', 'change-live'));
  const close = textNode('button', '×', 'changes-close'); close.setAttribute('aria-label', 'Close file changes'); close.addEventListener('click', closeChanges); header.append(close); panel.append(header);
  if (item.partial) panel.append(textNode('p', 'Partial review: large, unreadable or excluded files may be missing.', 'changes-note'));
  const list = textNode('div', '', 'changes-files'), preview = textNode('div', '', 'changes-preview');
  function select(file, button) {
    selectedReviewPath = file.path;
    list.querySelectorAll('button').forEach(node => { node.classList.toggle('selected', node === button); node.setAttribute('aria-pressed', String(node === button)); });
    preview.replaceChildren(textNode('div', file.path, 'diff-filename'));
    const pre = textNode('pre', '', 'diff-code');
    for (const line of (file.patch || 'No text lines changed.').split('\n')) pre.append(textNode('div', line || ' ', `diff-line${line.startsWith('+') ? ' added' : line.startsWith('-') ? ' removed' : line.startsWith('@@') ? ' hunk' : ''}`));
    preview.append(pre);
  }
  for (const file of item.files) {
    const button = textNode('button', '', 'changes-file'); button.append(textNode('span', file.path, 'changes-path'));
    button.dataset.path = file.path;
    if (file.binary) button.append(textNode('span', 'Binary', 'changes-note')); else changeCounts(button, file.added, file.removed);
    button.addEventListener('click', () => select(file, button)); list.append(button);
  }
  panel.append(list, preview); document.body.append(panel);
  const selected = item.files.findIndex(file => file.path === selectedReviewPath);
  if (item.files.length) select(item.files[Math.max(0,selected)], list.children[Math.max(0,selected)]);
  preview.scrollTop = scroll; preview.scrollLeft = horizontalScroll; list.scrollTop = listScroll;
  if (!refresh || focus) (focusPath ? [...list.children].find(button=>button.dataset.path===focusPath) || close : close).focus({preventScroll:true});
}
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !document.querySelector('.image-viewer[open]')) closeChanges(); });
function renderMessages() {
  const signature = JSON.stringify([state.items, state.pendingQueue]);
  if (signature === lastSignature) return;
  lastSignature = signature;
  if (openReviewId) {
    const review = state.items.find(item => item.itemId === openReviewId);
    if (!review) closeChanges(); else if (JSON.stringify(review) !== openReviewSignature) showChanges(review, true);
  }
  const area = $('scroll-area'); const nearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 130;
  const opened = new Set([...document.querySelectorAll('.tool-card[open]')].map(el => el.dataset.id));
  const known = new Set([...document.querySelectorAll('.tool-card')].map(el => el.dataset.id));
  $('messages').replaceChildren();
  for (const item of state.items) {
    if (item.retracted) continue;
    if (item.kind === 'fileChanges') {
      const row = textNode('div', '', 'change-row');
      const button = textNode('button', '', 'change-badge');
      button.append(textNode('span', `${item.files.length} ${item.files.length === 1 ? 'file' : 'files'} changed${item.partial ? ' · partial' : ''}`));
      changeCounts(button, item.added, item.removed);
      if (item.live) button.append(textNode('span', 'Live', 'change-live'));
      button.title = 'Review file changes'; button.addEventListener('click', () => showChanges(item));
      row.append(button); $('messages').append(row); continue;
    }
    if (item.kind === 'activity') {
      const step = textNode('div', item.text, 'activity-step'); step.dir = 'auto'; $('messages').append(step); continue;
    }
    if (item.kind === 'toolCall' || item.kind === 'userShell') {
      const details = document.createElement('details'); details.className = 'tool-card'; details.dataset.id = item.itemId; details.open = opened.has(item.itemId) || (!known.has(item.itemId) && item.status === 'inProgress');
      const summary = document.createElement('summary'); summary.append(icon('terminal'), textNode('span', item.description || item.tool || item.commandText || 'Project operation'), textNode('span', item.status === 'inProgress' ? 'Running' : item.status || 'Completed', 'tool-status'));
      details.append(summary); details.append(textNode('pre', [item.commandText && `Command:\n${item.commandText}`, item.args && `Arguments:\n${item.args}`, item.visibleOutput && `Output:\n${item.visibleOutput}`, Number.isInteger(item.exitCode) && `Exit code: ${item.exitCode}`, item.failureReason].filter(value => typeof value === 'string' && value).join('\n\n') || 'Muse is carrying out this operation.'));
      $('messages').append(details); continue;
    }
    if (item.kind !== 'agentMessage' && item.kind !== 'userMessage') continue;
    const user = item.kind === 'userMessage'; const article = document.createElement('article'); article.className = `message ${user ? 'user' : 'assistant'}`;
    const avatar = textNode('div', user ? 'Y' : '', 'avatar');
    if (!user) { const logo = document.createElement('img'); logo.src = 'assets/meta-symbol.svg'; logo.alt = 'Meta'; avatar.append(logo); }
    article.append(avatar);
    const content = textNode('div', '', 'message-content'); content.append(textNode('div', user ? 'You' : 'Muse', 'message-label'));
    if (item.images?.length) { const imgs = textNode('div', '', 'message-images'); for (const image of item.images) { const img = document.createElement('img'); img.src = `data:${image.mediaType};base64,${image.base64Data}`; img.alt = 'Attached image'; imgs.append(img); } content.append(imgs); }
    const body = textNode('div', '', 'message-body'); renderText(body, item.displayText || item.text || '',item.status==='inProgress'); content.append(body); article.append(content); $('messages').append(article);
  }
  for (const entry of state.pendingQueue || []) {
    const article = document.createElement('article'); article.className = 'message user queued';
    article.append(textNode('div', 'Y', 'avatar'));
    const content = textNode('div', '', 'message-content');
    const label = textNode('div', 'You', 'message-label'); label.append(textNode('span', 'Queued', 'queue-badge')); content.append(label);
    if (entry.images?.length) { const imgs = textNode('div', '', 'message-images'); for (const image of entry.images) { const img = document.createElement('img'); img.src = `data:${image.mediaType};base64,${image.base64Data}`; img.alt = 'Attached image'; imgs.append(img); } content.append(imgs); }
    const queuedBody = textNode('div', '', 'message-body'); renderText(queuedBody, entry.text || ''); content.append(queuedBody); article.append(content); $('messages').append(article);
  }
  if (nearBottom) requestAnimationFrame(() => { area.scrollTop = area.scrollHeight; });
}
function fillSelect(node, options, value) {
  const signature = JSON.stringify(options);
  if (node.dataset.options !== signature) { node.replaceChildren(...options.map(option => { const el = document.createElement('option'); el.value = option.value; el.textContent = option.label; return el; })); node.dataset.options = signature; }
  node.value = value;
}
function update(next) {
  if (next.sessionId === state.sessionId && state.error && state.error !== next.error) dismissedErrors.delete(errorKey(state.error));
  if (next.sessionId !== state.sessionId) closeChanges();
  if (next.sessionId !== state.sessionId || (state.error && !next.error)) $('error-banner').hidden = true;
  const wasBusy = state.busy; state = next;
  const general = state.projectPath === null;
  $('project-name').textContent = general ? 'General chat' : (state.workspace || '').split(/[\\/]/).filter(Boolean).at(-1) || 'Your project';
  $('project-path').textContent = general ? 'No project attached' : state.workspace || 'Select a folder';
  $('workspace-button').title = general ? 'Start a chat in a project folder' : 'Choose a project folder';
  $('workspace-label').textContent = general ? 'GENERAL CHAT' : 'PROJECT WORKSPACE';
  const ready = state.connection === 'ready';
  $('connection-badge').className = `connection-badge ${state.connection}`; $('connection-badge').textContent = ready ? 'Connected' : state.connection === 'connecting' ? 'Connecting' : 'Disconnected';
  $('connection-dot').className = `connection-dot ${state.connection}`; $('engine-label').textContent = ready ? `Muse Code ${state.engineVersion || ''}` : 'Muse disconnected'; $('engine-detail').textContent = ready ? 'Runs on your installed engine' : 'Reconnect in Engine settings';
  if (state.error && !dismissedErrors.has(errorKey(state.error))) error(state.error);
  $('welcome').hidden = !!state.items?.length || state.busy;
  $('working').hidden = !state.busy && !state.loading; $('working-label').textContent = state.loading ? 'Opening conversation…' : state.stopping ? 'Stopping Muse…' : state.finishing ? 'Reply ready · finishing final checks' : state.activity || 'Muse is working on it';
  if (state.busy && !wasBusy) { startedAt = Date.now(); $('elapsed').textContent = '0s'; }
  $('send-button').hidden = false; $('stop-button').hidden = !state.busy; $('stop-button').disabled = state.stopping;
  for (const id of ['new-chat','add-project','workspace-button','model','effort','execution-mode','choose-muse','reconnect']) $(id).disabled = state.busy || state.loading || sending;
  $('attach-button').disabled = state.loading || sending;
  $('prompt').disabled = state.loading || sending;
  $('prompt').placeholder = state.busy && state.finishing ? 'Write your next message while Muse finishes…' : state.busy ? 'Queue a follow-up while Muse works…' : general ? 'Ask Muse anything, or attach an image…' : 'Ask Muse to build, fix, or explain…';
  $('composer').classList.toggle('full-mode', !general && state.executionMode === 'full');
  $('execution-mode').hidden = general;
  for (const [id,title,detail,prompt] of general ? [
    ['explore-suggestion','Ask anything','Ideas, questions, and advice','Help me think through a question.'],
    ['explain-suggestion','Explain a topic','Make something easier to understand','Explain a topic to me in simple terms.'],
  ] : [
    ['explore-suggestion','Explore my project','Get the lay of the land','Explore this project and explain its structure. Do not modify anything.'],
    ['explain-suggestion','Find a bug','Make the next fix clearer','Inspect this project for a concrete bug. Explain what you find before making changes.'],
  ]) { const button=$(id); button.querySelector('strong').textContent=title; button.querySelector('small').textContent=detail; button.dataset.prompt=prompt; }
  fillSelect($('model'), (state.models || []).map(model => ({ value: model.modelId, label: model.displayLabel || model.modelId })), state.modelId);
  const model = state.models?.find(model => model.modelId === state.modelId);
  fillSelect($('effort'), (Array.isArray(model?.variants) ? model.variants : ['max']).map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) })), state.reasoningEffort);
  $('execution-mode').value = state.executionMode || 'readonly';
  // Preserve a user's toggle even when its native event is still queued during a stream update.
  for (const details of $('sessions').querySelectorAll('.project-group')) {
    if (details.open) collapsedProjects.delete(details.dataset.projectPath);
    else collapsedProjects.add(details.dataset.projectPath);
  }
  $('sessions').replaceChildren(); $('general-sessions').replaceChildren();
  for (const group of groupConversations(state.sessions || [], state.projects || [])) {
    let container = $('general-sessions');
    if (group.projectPath !== null) {
      const name = group.projectPath.split(/[\\/]/).filter(Boolean).at(-1) || group.projectPath;
      const details = textNode('details', '', 'project-group'); details.open = !collapsedProjects.has(group.projectPath); details.dataset.projectPath = group.projectPath;
      const summary = document.createElement('summary'); summary.title = group.projectPath;
      summary.append(icon('folder'), textNode('span', name, 'project-title'));
      const add = textNode('button', '', 'project-new-chat'); add.append(icon('plus')); add.setAttribute('aria-label', `New chat in ${name}`); add.title = `New chat in ${group.projectPath}`;
      add.disabled = state.busy || state.loading || sending;
      add.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); action(() => api.newChat(group.projectPath)); });
      summary.append(add); container = textNode('div', '', 'project-chats'); details.append(summary,container); $('sessions').append(details);
    }
    for (const session of group.sessions) {
    const row = textNode('div', '', `session-row${session.sessionId === state.sessionId ? ' active' : ''}`);
    row.dataset.sessionId = session.sessionId;
    const button = textNode('button', '', 'session-button');
    button.append(icon('chat'), textNode('span', session.title || 'New conversation'));
    button.title = `${session.title}\n${group.projectPath || 'General chat'}`;
    button.disabled = state.busy || state.loading || sending;
    button.addEventListener('click', () => action(() => api.resumeChat(session.sessionId)));
    const activeBusy = session.sessionId === state.sessionId && state.busy;
    const del = textNode('button', '', 'session-delete-icon');
    del.append(icon('x'));
    del.setAttribute('aria-label', `Delete ${session.title || 'conversation'}`);
    del.disabled = state.loading || sending || activeBusy;
    del.title = activeBusy ? 'Stop the request before deleting this chat' : 'Delete this conversation';
    del.addEventListener('click', event => {
      event.stopPropagation();
      if (!del.dataset.confirm) { del.dataset.confirm = '1'; del.classList.add('confirm'); return; }
      action(() => api.deleteChat(session.sessionId));
    });
    row.append(button, del);
    container.append(row);
    }
    if (!group.sessions.length) container.append(textNode('div', group.projectPath === null ? 'Ask anything with New conversation.' : 'Start a chat with +', 'empty-history'));
  }
  if (!$('sessions').children.length) $('sessions').append(textNode('div', 'Add a folder to start a project.', 'empty-history'));
  renderMessages(); refreshSend();refreshStitch();
}
function refreshSend() { $('send-button').disabled = sending || state.loading || state.historyMissing || state.connection !== 'ready' || (!$('prompt').value.trim() && !attachments.length); }
function renderAttachments() {
  $('attachments').replaceChildren(); $('attachments').hidden = !attachments.length;
  for (const [index,image] of attachments.entries()) {
    const box = textNode('div', '', 'attachment'); const img = document.createElement('img'); img.src = `data:${image.mediaType};base64,${image.base64Data}`; img.alt = image.name || 'Attached image';
    const remove = textNode('button', '×'); remove.setAttribute('aria-label', 'Remove image'); remove.addEventListener('click', () => { attachments.splice(index,1); renderAttachments(); }); box.append(img,remove);
    if(image.contextText){box.classList.add('browser-attachment');const context=textNode('details','','attachment-context');context.append(textNode('summary',image.name || 'Browser annotation'),textNode('pre',image.contextText));box.append(context);}
    $('attachments').append(box);
  } refreshSend();
}
function addImages(images) {
  const next = [...attachments,...images];
  let total = 0;
  for (const image of next) { const bytes = image.base64Data.length * 3/4 - (image.base64Data.endsWith('==') ? 2 : image.base64Data.endsWith('=') ? 1 : 0); if (bytes > 10*1024*1024) throw new Error('Each image must be 10 MB or smaller.'); total += bytes; }
  if (next.length > 20 || total > 20*1024*1024) throw new Error('Attach up to 20 MB of images per message.');
  attachments = next; renderAttachments();
}
async function pickImages() { await action(async () => addImages(await api.pickImages())); }
async function send() {
  if (sending || $('send-button').disabled) return;
  sending = true; refreshSend();
  try {
    const text=[$('prompt').value,...attachments.map(image=>image.contextText).filter(Boolean)].filter(Boolean).join('\n\n');
    await api.sendMessage({ text, images: attachments.map(({ mediaType, base64Data }) => ({ mediaType, base64Data })) });
    $('prompt').value = ''; $('prompt').style.height = ''; attachments = []; renderAttachments(); $('error-banner').hidden = true;
  } catch (e) { error(e); }
  finally { sending = false; update(await api.getState()); if (!state.busy) $('prompt').focus(); }
}
$('prompt').addEventListener('input', () => { $('prompt').style.height = 'auto'; $('prompt').style.height = `${Math.min(200,Math.max(79,$('prompt').scrollHeight))}px`; refreshSend(); });
$('prompt').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); } });
$('prompt').addEventListener('paste', event => {
  const files = [...event.clipboardData.items].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile());
  if (!files.length) return; event.preventDefault();
  action(async () => { const images = []; for (const file of files) { if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Use a PNG, JPEG, or WebP image.'); if (file.size > 10*1024*1024) throw new Error('Each image must be 10 MB or smaller.'); const url = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); images.push({ mediaType: file.type, base64Data: url.split(',')[1], name: file.name }); } addImages(images); });
});
$('send-button').addEventListener('click', send);
$('stop-button').addEventListener('click', () => action(() => api.stopTurn()));
$('attach-button').addEventListener('click', pickImages); $('image-suggestion').addEventListener('click', pickImages);
$('new-chat').addEventListener('click', () => action(async () => { await api.newChat(null); $('prompt').focus(); return api.getState(); }));
$('add-project').addEventListener('click', () => action(() => api.chooseWorkspace()));
$('workspace-button').addEventListener('click', () => action(() => api.chooseWorkspace()));
$('model').addEventListener('change', () => action(() => api.setOptions({ modelId: $('model').value })));
$('effort').addEventListener('change', () => action(() => api.setOptions({ reasoningEffort: $('effort').value })));
$('execution-mode').addEventListener('change', () => action(() => api.setOptions({ executionMode: $('execution-mode').value })));
$('settings-button').addEventListener('click', () => { $('settings-panel').hidden = !$('settings-panel').hidden; });
if(api.stitchCommand){
  $('stitch-key').addEventListener('input',refreshStitch);
  $('stitch-connect').addEventListener('click',()=>stitchAction('connect',{apiKey:$('stitch-key').value}));
  $('stitch-test').addEventListener('click',()=>stitchAction('test',{apiKey:$('stitch-key').value}));
  for(const name of ['disconnect','open'])$(`stitch-${name}`).addEventListener('click',()=>stitchAction(name));
  stitchAction('state');
}else $('stitch-settings').hidden=true;
$('choose-muse').addEventListener('click', () => action(() => api.chooseMuse())); $('reconnect').addEventListener('click', () => action(() => api.connect()));
$('dismiss-error').addEventListener('click', () => { dismissedErrors.add(errorKey($('error-text').textContent)); $('error-banner').hidden = true; });
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { $('prompt').value = button.dataset.prompt; $('prompt').dispatchEvent(new Event('input')); $('prompt').focus(); }));
document.addEventListener('keydown', event => { if (event.ctrlKey && event.key.toLowerCase() === 'n') { event.preventDefault(); if (!state.busy && !state.loading) action(() => api.newChat(null)); } });
setInterval(() => { if (state.busy && startedAt) { const seconds = Math.floor((Date.now()-startedAt)/1000); $('elapsed').textContent = seconds >= 60 ? `${Math.floor(seconds/60)}m ${seconds%60}s` : `${seconds}s`; } },1000);
api.onEvent(event => { if (event.type === 'state') update(event.state); });
setupBrowser(api,capture=>{addImages([capture]);$('prompt').focus();});
update(await api.getState()); $('prompt').focus();
