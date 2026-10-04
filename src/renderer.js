import { groupConversations } from './projects.js';
import { setupBrowser } from './browser-ui.js';
import {stitchImageParts} from './images.js';
import {videoFileError, frameTimes, VIDEO_LIMITS} from './video-frames.js';
import {summarizeUsage} from './usage.js';
import {markdownBlocks, inlineParts} from './markdown.js';
import {setupProjects} from './project-ui.js';
import {setupProjectWork} from './work-ui.js';

const $ = id => document.getElementById(id);
const api = window.muse;
const collapsedProjects = new Set();
const dismissedErrors = new Set();
let state = { items: [], sessions: [], models: [], busy: false, connection: 'connecting' };
let attachments = [], sending = false, extracting = false, lastSignature = '', startedAt = 0;
let sidebarSignature='', draftOwner, draftTimer, draftWrites=Promise.resolve();
let updateProjects,updateProjectWork;
const messageRows=new Map();
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
let trelloConfigured=false,trelloChanging=false;
function refreshTrello(){if(!api.trelloCommand)return;for(const name of ['connect','test','disconnect'])$(`trello-${name}`).disabled=trelloChanging || state.busy || state.loading || (name==='test' && !trelloConfigured && (!$('trello-key').value.trim() || !$('trello-token').value.trim())) || (name==='disconnect' && !trelloConfigured);}
async function trelloAction(name,payload) {
  if(trelloChanging)return;trelloChanging=true;refreshTrello();
  $('trello-status').textContent='Checking Trello board access…';
  try{
    const result=await api.trelloCommand(name,payload);if(!result)return;
    trelloConfigured=result.configured;
    $('trello-status').textContent=result.configured ? `Connected · ${result.boardName} · ${result.listCount} lists${result.keyOnly ? ' · press Connect to save' : ''}` : 'Not connected';
    if(name==='connect'){$('trello-key').value='';$('trello-token').value='';}
    if(name==='disconnect'){$('trello-key').value='';$('trello-token').value='';$('trello-board').value='';}
  }catch(error){$('trello-status').textContent=(error.message || String(error)).replace(/^Error invoking remote method '[^']+': Error: /,'');}
  finally{trelloChanging=false;refreshTrello();}
}
let openReviewId = null, selectedReviewPath = null, openReviewSignature = '', liveReviewSignature;
const icon = name => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg; };
const textNode = (tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
function error(error) { $('error-text').textContent = (error?.message || String(error)).replace(/^Error invoking remote method '[^']+': Error: /, ''); $('error-banner').hidden = false; }
const errorKey = message => JSON.stringify([state.sessionId, message]);
async function action(fn, {flush=true}={}) { try { if(flush && !state.workUnavailable)await flushDraft(); const result = await fn(); if (result?.connection) update(result); return result; } catch (e) { error(e); } }

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
  figure.dataset.url=url;image.alt=alt;image.referrerPolicy='no-referrer';view.setAttribute('aria-label',`Enlarge ${alt}`);view.addEventListener('click',()=>showImage(url,alt));
  const caption=textNode('figcaption',alt),copy=textNode('button','Copy image link','image-copy-link');copy.addEventListener('click',()=>action(()=>api.copyText(url)));
  image.addEventListener('error',()=>{view.hidden=true;caption.textContent=`${alt} · Preview unavailable. Copy the image link to open it.`;});
  image.src=url;view.append(image);figure.append(view,caption,copy);parent.append(figure);
}
function renderText(parent, text, streaming=false) {
  const previews=new Map([...parent.querySelectorAll('.stitch-image')].map(node=>[node.dataset.url,node]));
  parent.replaceChildren();
  function inline(node,value) {
    for(const token of inlineParts(value)) {
      if(token.type==='code' || token.type==='strong' || token.type==='em') {node.append(textNode(token.type,token.text));continue;}
      if(token.type==='literal'){node.append(document.createTextNode(token.text));continue;}
      const parts=stitchImageParts(token.type==='image' ? token.text : token.type==='link' ? token.url : token.text,streaming);
      if(parts.some(part=>part.type==='image')) {
        for(const part of parts)if(part.type==='image') {
          const retained=previews.get(part.url);if(retained){node.append(retained);previews.delete(part.url);}else renderImage(node,part.url,token.alt || part.alt);
        }else node.append(document.createTextNode(part.text));
      }else if(token.type==='link') {
        const link=textNode('a',token.text);link.href=token.url;link.rel='noreferrer noopener';link.addEventListener('click',event=>{event.preventDefault();action(()=>api.openLink?.(token.url));});node.append(link);
      }else node.append(document.createTextNode(token.text));
    }
  }
  for(const block of markdownBlocks(text)) {
    if(block.type==='code') {
      const pre=document.createElement('pre'),header=textNode('div','','code-header');header.append(textNode('span',block.language || 'Code'));
      const copy=textNode('button','Copy');copy.prepend(icon('copy'));copy.addEventListener('click',()=>action(async()=>{await api.copyText(block.text);copy.lastChild.textContent='Copied';}));header.append(copy);pre.append(header,textNode('code',block.text));parent.append(pre);
    }else if(block.type==='list') {
      const list=document.createElement(block.ordered?'ol':'ul');for(const value of block.items){const item=document.createElement('li');inline(item,value);list.append(item);}parent.append(list);
    }else if(block.type==='table') {
      const wrapper=textNode('div','','markdown-table'),table=document.createElement('table');
      for(const [index,cells] of [block.header,...block.rows].entries()){const row=document.createElement('tr');for(const value of cells){const cell=document.createElement(index?'td':'th');inline(cell,value);row.append(cell);}table.append(row);}wrapper.append(table);parent.append(wrapper);
    }else {
      const node=document.createElement(block.type==='heading'?'h'+block.level:block.type==='quote'?'blockquote':'p');node.dir='auto';inline(node,block.text);parent.append(node);
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
  if (openReviewId) {
    const review=state.items.find(item=>item.itemId===openReviewId);
    if(!review)closeChanges();else if(JSON.stringify(review)!==openReviewSignature)showChanges(review,true);
  }
  const area=$('scroll-area'),nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<130;
  const rows=[...(state.items || []).filter(item=>!item.retracted),...(state.pendingQueue || []).map(entry=>({...entry,itemId:'queue-'+entry.queueId,kind:'queued'}))];
  if(state.lastOutcome && !state.busy)rows.push({...state.lastOutcome,itemId:'outcome-'+state.lastOutcome.turnId,kind:'outcome',tools:(state.items || []).filter(item=>item.turnId===state.lastOutcome.turnId && (item.kind==='toolCall' || item.kind==='userShell')),review:(state.items || []).find(item=>item.turnId===state.lastOutcome.turnId && item.kind==='fileChanges'),activeRequest:state.activeRequest});
  const seen=new Set();let position=0;
  for(const item of rows) {
    if(!['fileChanges','activity','toolCall','userShell','agentMessage','userMessage','queued','outcome'].includes(item.kind))continue;
    if(item.kind==='fileChanges'&&item.live)continue;
    const key=item.itemId,signature=JSON.stringify({...item,images:undefined,queuePaused:item.kind==='queued'?state.queuePaused:undefined});
    let record=messageRows.get(key);
    const sameImages=record && (record.images || []).length===(item.images || []).length && (item.images || []).every((image,index)=>image.mediaType===record.images[index].mediaType && image.base64Data===record.images[index].base64Data);
    if(!record){record={node:document.createElement('div')};messageRows.set(key,record);}
    const node=record.node;node.currentItem=item;
    if(record.signature!==signature || !sameImages) {
      const sameKind=record.kind===item.kind;record.signature=signature;record.kind=item.kind;
      if(item.kind==='toolCall' || item.kind==='userShell') {
        if(!sameKind){node.replaceChildren();const details=document.createElement('details');details.className='tool-card';details.dataset.id=key;details.open=item.status==='inProgress';const summary=document.createElement('summary');summary.append(icon('terminal'),textNode('span',''),textNode('span','','tool-status'));details.append(summary);node.append(details);details.addEventListener('toggle',()=>renderToolOutput(node));}
        const summary=node.querySelector('summary');summary.children[1].textContent=item.description || item.tool || item.commandText || 'Project operation';summary.children[2].textContent=item.status==='inProgress'?'Running':item.status || 'Completed';renderToolOutput(node);
      }else if(item.kind==='agentMessage' || item.kind==='userMessage' || item.kind==='queued') {
        const user=item.kind!=='agentMessage';node.className='message '+(user?'user':'assistant')+(item.kind==='queued'?' queued':'');
        if(!sameKind){node.replaceChildren();const avatar=textNode('div',user?'Y':'','avatar');if(!user){const logo=document.createElement('img');logo.src='assets/mora-mark.svg';logo.alt='Mora';avatar.append(logo);}const content=textNode('div','','message-content');content.append(textNode('div',user?'You':'Muse','message-label'),textNode('div','','message-images'),textNode('div','','message-body'));node.append(avatar,content);}
        if(!sameImages){const imgs=node.querySelector('.message-images');imgs.replaceChildren();for(const image of item.images || []){const img=document.createElement('img');img.src='data:'+image.mediaType+';base64,'+image.base64Data;img.alt='Attached image';imgs.append(img);}}
        renderText(node.querySelector('.message-body'),item.displayText || item.text || '',item.status==='inProgress');
        if(item.kind==='queued') {
          const label=node.querySelector('.message-label');label.replaceChildren(document.createTextNode('You'),textNode('span',state.queuePaused?'Paused':'Queued','queue-badge'));
          node.querySelector('.queue-actions')?.remove();const actions=textNode('div','','queue-actions');
          for(const name of ['Edit','Remove']){const button=textNode('button',name);button.addEventListener('click',()=>name==='Remove'?action(()=>api.queueCommand('remove',{queueId:item.queueId})):editQueued(node));actions.append(button);}node.querySelector('.message-content').append(actions);
        }
      }else {
        node.replaceChildren();
        if(item.kind==='fileChanges') {
          node.className='change-row';const button=textNode('button','','change-badge');button.append(textNode('span',item.files.length+' '+(item.files.length===1?'file':'files')+' changed'+(item.partial?' · partial':'')));changeCounts(button,item.added,item.removed);if(item.live)button.append(textNode('span','Live','change-live'));button.title='Review file changes';button.addEventListener('click',()=>showChanges(node.currentItem));node.append(button);
        }else if(item.kind==='activity'){node.className='activity-step';node.dir='auto';node.textContent=item.text;}
        else {
          node.className='completion-card '+item.status;node.append(textNode('strong',item.status==='finished'?'Request finished':item.status==='interrupted'?'Request interrupted':'Request failed'),textNode('p',item.message));
          if(item.review)node.append(textNode('p',item.review.files.length+' files changed · +'+item.review.added+' / -'+item.review.removed+(item.review.partial?' · partial review':'')));
          if(item.tools.length){const details=document.createElement('details');details.append(textNode('summary','Show '+item.tools.length+' operation outcomes'));for(const tool of item.tools)details.append(textNode('p',(tool.commandText || tool.description || tool.tool || 'Operation')+' · '+(tool.status || 'unknown')+(Number.isInteger(tool.exitCode)?' · exit '+tool.exitCode:'')));node.append(details);}
          if(item.activeRequest){const details=document.createElement('details');details.append(textNode('summary',item.activeRequest.phase==='admitted'?'Saved request · review before continuing':'Unsubmitted request'),textNode('p',item.activeRequest.text));node.append(details);if(item.activeRequest.phase==='preparing'){const recover=textNode('button','Recover as draft');recover.addEventListener('click',()=>{if($('prompt').value || attachments.length){error('Keep or clear the current draft first.');return;}$('prompt').value=item.activeRequest.text;attachments=item.activeRequest.images || [];renderAttachments();scheduleDraft();});node.append(recover);}}
        }
      }
      record.images=item.images;
    }
    if($('messages').children[position]!==node)$('messages').insertBefore(node,$('messages').children[position] || null);
    seen.add(key);position++;
  }
  for(const [key,record] of messageRows)if(!seen.has(key)){record.node.remove();messageRows.delete(key);}
  const queue=$('queue-controls');queue.hidden=!(state.pendingQueue || []).length;$('queue-status').textContent=(state.pendingQueue || []).length+' pending · '+(state.queuePaused?'paused':'runs in order');$('queue-toggle').textContent=state.queuePaused?'Resume queue':'Pause queue';$('queue-toggle').disabled=state.loading || state.stopping || state.connection!=='ready' || state.historyMissing || state.workUnavailable;
  if(nearBottom)requestAnimationFrame(()=>{area.scrollTop=area.scrollHeight;});
  const liveItem=(state.items||[]).find(item=>item.kind==='fileChanges'&&item.live);
  const dockSignature=liveItem?JSON.stringify(liveItem):'';
  if(dockSignature!==liveReviewSignature){liveReviewSignature=dockSignature;const dock=$('live-review');dock.replaceChildren();if(liveItem){dock.hidden=false;dock.append(textNode('span',liveItem.files.length+' '+(liveItem.files.length===1?'file':'files')+' changed'+(liveItem.partial?' · partial':'')));changeCounts(dock,liveItem.added,liveItem.removed);dock.append(textNode('span','Live','change-live'));dock.title='Review file changes';dock.onclick=()=>showChanges(liveItem);}else dock.hidden=true;}
}
function renderToolOutput(node) {
  const details=node.querySelector('details'),item=node.currentItem;
  if(!details.open){details.querySelector('pre')?.remove();return;}
  let pre=details.querySelector('pre');if(!pre){pre=document.createElement('pre');details.append(pre);}
  const output=[item.commandText && 'Command:\n'+item.commandText,item.args && 'Arguments:\n'+item.args,item.visibleOutput && 'Output:\n'+item.visibleOutput,Number.isInteger(item.exitCode) && 'Exit code: '+item.exitCode,item.failureReason].filter(value=>typeof value==='string' && value).join('\n\n') || 'Muse is carrying out this operation.';
  if(pre.textContent!==output)pre.textContent=output;
}
function editQueued(node) {
  if(node.querySelector('textarea'))return;
  const form=textNode('div','','queue-edit'),input=document.createElement('textarea');input.value=node.currentItem.text;input.setAttribute('aria-label','Edit queued message');const save=textNode('button','Save queued message'),cancel=textNode('button','Cancel edit');save.addEventListener('click',()=>action(async()=>{await api.queueCommand('edit',{queueId:node.currentItem.queueId,text:input.value});form.remove();update(await api.getState());}));cancel.addEventListener('click',()=>form.remove());form.append(input,save,cancel);node.append(form);input.focus();
}
function fillSelect(node, options, value) {
  const signature = JSON.stringify(options);
  if (node.dataset.options !== signature) { node.replaceChildren(...options.map(option => { const el = document.createElement('option'); el.value = option.value; el.textContent = option.label; return el; })); node.dataset.options = signature; }
  node.value = value;
}
function startRename(row, button, session) {
  if (row.querySelector('.session-rename-input')) return;
  button.hidden = true;
  const input = document.createElement('input');
  input.className = 'session-rename-input'; input.value = session.title || ''; input.maxLength = 80; input.setAttribute('aria-label', 'Chat name');
  let done = false;
  const finish = save => {
    if (done) return; done = true;
    const title = input.value.trim();
    input.remove(); button.hidden = false;
    if (save && title && title !== (session.title || '')) action(() => api.renameChat(session.sessionId, title));
  };
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); finish(true); } else if (event.key === 'Escape') { event.preventDefault(); finish(false); } });
  input.addEventListener('blur', () => finish(true));
  row.prepend(input); input.focus(); input.select();
}
function update(next) {
  if (next.sessionId === state.sessionId && state.error && state.error !== next.error) dismissedErrors.delete(errorKey(state.error));
  if (next.sessionId !== state.sessionId) closeChanges();
  if (next.sessionId !== state.sessionId || (state.error && !next.error)) $('error-banner').hidden = true;
  const wasBusy = state.busy; state = next;
  updateProjects?.(state);
  updateProjectWork?.(state);
  const account=state.account || {status:'unknown',message:'Uses your existing Muse login.'};
  $('account-settings').hidden=!api.accountCommand;
  $('account-status').textContent=account.message;
  $('login-code').hidden=!account.userCode;$('login-code').textContent=account.userCode || '';
  $('sign-in').hidden=['signedIn','apiKey','ready','pending','missing'].includes(account.status);
  $('sign-in').disabled=state.busy || state.loading || state.connection==='connecting';
  $('cancel-sign-in').hidden=account.status!=='pending';
  $('refresh-account').disabled=state.busy || state.loading || state.connection==='connecting' || account.status==='pending';
  $('install-muse').hidden=account.status!=='missing';
  $('onboarding').hidden=!api.accountCommand || !['required','pending','missing','unknown'].includes(account.status);
  $('onboarding-status').textContent=account.message;
  $('onboarding-action').textContent=account.status==='missing'?'Get Muse Code':account.status==='pending'?'View sign-in code':account.status==='unknown'?'Check account':'Sign in to Muse';
  $('onboarding-action').disabled=state.busy || state.loading || state.connection==='connecting';
  if(!state.loading && draftOwner!==state.sessionId){draftOwner=state.sessionId;const draft=state.draft || {text:'',images:[]};$('prompt').value=draft.text;attachments=draft.images || [];renderAttachments(false);}
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
  for (const id of ['new-chat','add-project','workspace-button','model','effort','execution-mode','choose-muse','reconnect']) $(id).disabled = state.busy || state.loading || sending || state.connection==='connecting';
  $('attach-button').disabled = state.loading || sending || extracting || state.workUnavailable;
  $('prompt').disabled = state.loading || sending || state.workUnavailable;
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
  $('speed').value = state.speedPreset || 'custom'; $('speed').disabled = state.busy || state.loading || sending || !model?.variants?.length || state.connection!=='ready';
  // Preserve a user's toggle even when its native event is still queued during a stream update.
  for (const details of $('sessions').querySelectorAll('.project-group')) {
    if (details.open) collapsedProjects.delete(details.dataset.projectPath);
    else collapsedProjects.add(details.dataset.projectPath);
  }
  const nextSidebarSignature=JSON.stringify([state.sessions,state.projects,state.sessionId,!!state.busy,!!state.loading,sending]);
  if(nextSidebarSignature!==sidebarSignature){sidebarSignature=nextSidebarSignature;
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
      const remove = textNode('button', '', 'project-remove'); remove.append(icon('x')); remove.setAttribute('aria-label', `Remove ${name}`); remove.title = `Remove ${group.projectPath} from Mora Desktop (keeps the folder)`;
      const projectBusy = state.busy && (group.sessions.some(session => session.sessionId === state.sessionId) || state.projectPath === group.projectPath);
      remove.disabled = state.loading || sending || projectBusy;
      if (projectBusy) remove.title = 'Stop the request before removing this project';
      remove.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        if (!remove.dataset.confirm) { remove.dataset.confirm = '1'; remove.classList.add('confirm'); return; }
        action(() => api.removeProject(group.projectPath));
      });
      summary.append(add, remove); container = textNode('div', '', 'project-chats'); details.append(summary,container); $('sessions').append(details);
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
    const edit = textNode('button', '', 'session-edit-icon');
    edit.append(icon('edit'));
    edit.setAttribute('aria-label', `Rename ${session.title || 'conversation'}`);
    edit.disabled = state.loading || sending;
    edit.title = 'Rename this conversation';
    edit.addEventListener('click', event => { event.stopPropagation(); startRename(row, button, session); });
    row.append(button, edit, del);
    container.append(row);
    }
    if (!group.sessions.length) container.append(textNode('div', group.projectPath === null ? 'Ask anything with New conversation.' : 'Start a chat with +', 'empty-history'));
  }
  if (!$('sessions').children.length) $('sessions').append(textNode('div', 'Add a folder to start a project.', 'empty-history'));
  }
  renderMessages(); refreshSend();refreshStitch();refreshTrello();
}
function refreshSend() { $('send-button').disabled = sending || extracting || state.loading || state.projectOperation || state.projectRepair || state.historyMissing || state.workUnavailable || ['required','pending'].includes(state.account?.status) || state.connection !== 'ready' || (!$('prompt').value.trim() && !attachments.length); }
function renderAttachments(persist=true) {
  $('attachments').replaceChildren(); $('attachments').hidden = !attachments.length;
  for (const [index,image] of attachments.entries()) {
    const box = textNode('div', '', 'attachment'); const img = document.createElement('img'); img.src = `data:${image.mediaType};base64,${image.base64Data}`; img.alt = image.name || 'Attached image';
    const remove = textNode('button', '×'); remove.setAttribute('aria-label', 'Remove image'); remove.addEventListener('click', () => { attachments.splice(index,1); renderAttachments(); }); box.append(img,remove);if(image.sourceVideo)box.title=image.name;
    if(image.contextText){box.classList.add('browser-attachment');box.append(textNode('strong',`Selection ${index+1}`),textNode('small',image.sourceUrl || '', 'annotation-source'));const note=document.createElement('textarea');note.value=image.note || '';note.maxLength=10000;note.placeholder='What should change here?';note.setAttribute('aria-label',`Note for selection ${index+1}`);note.addEventListener('input',()=>{image.note=note.value;scheduleDraft();});box.append(note);const context=textNode('details','','attachment-context');context.append(textNode('summary',image.name || 'Browser annotation'),textNode('pre',image.contextText));box.append(context);}
    $('attachments').append(box);
  } refreshSend();if(persist)scheduleDraft();
}
function addImages(images) {
  const next = [...attachments,...images];
  let total = 0;
  for (const image of next) { const bytes = image.base64Data.length * 3/4 - (image.base64Data.endsWith('==') ? 2 : image.base64Data.endsWith('=') ? 1 : 0); if (bytes > 10*1024*1024) throw new Error('Each image must be 10 MB or smaller.'); total += bytes; }
  if (next.length > 20 || total > 20*1024*1024) throw new Error('Attach up to 20 MB of images per message.');
  attachments = next; renderAttachments();
}
async function pickImages() { await action(async () => { const picked = await api.pickImages(); addImages(picked.filter(item => !String(item.mediaType).startsWith('video/'))); for (const video of picked.filter(item => String(item.mediaType).startsWith('video/'))) await attachVideo(video); }); }
function readFileData(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',', 2)[1]); reader.onerror = () => reject(new Error(`Could not read ${file.name}.`)); reader.readAsDataURL(file); }); }
async function attachFiles(files) {
  const images = [];
  for (const file of files.filter(file => file.type.startsWith('image/'))) {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Use a PNG, JPEG, or WebP image.');
    if (file.size > 10*1024*1024) throw new Error('Each image must be 10 MB or smaller.');
    images.push({ mediaType: file.type, base64Data: await readFileData(file), name: file.name });
  }
  addImages(images);
  for (const file of files.filter(file => file.type.startsWith('video/'))) await attachVideo({ mediaType: file.type, name: file.name, size: file.size, file });
}
async function attachVideo(video) {
  if (extracting) throw new Error('Wait for the current video to finish extracting.');
  const early = videoFileError({ mediaType: video.mediaType, size: video.size });
  if (early) throw new Error(early);
  extracting = true; refreshSend();
  try { addImages(await extractVideoFrames(video)); }
  finally { extracting = false; refreshSend(); }
}
function extractVideoFrames(video) {
  return new Promise((resolve, reject) => {
    let objectUrl = null;
    const cleanup = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; };
    const fail = message => { clearTimeout(timer); cleanup(); reject(new Error(message)); };
    try {
      objectUrl = video.file ? URL.createObjectURL(video.file) : URL.createObjectURL(new Blob([Uint8Array.from(atob(video.base64Data), ch => ch.charCodeAt(0))], { type: video.mediaType }));
    } catch { fail('This video could not be read.'); return; }
    const el = document.createElement('video');
    el.muted = true; el.preload = 'auto'; el.src = objectUrl;
    const timer = setTimeout(() => fail('This video could not be read.'), 30000);
    el.addEventListener('error', () => fail('This video could not be read.'), { once: true });
    el.addEventListener('loadedmetadata', async () => {
      try {
        const problem = videoFileError({ mediaType: video.mediaType, size: video.size, durationSeconds: el.duration });
        if (problem) { fail(problem); return; }
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, VIDEO_LIMITS.FRAME_MAX_DIM / Math.max(el.videoWidth, el.videoHeight));
        canvas.width = Math.max(2, Math.round(el.videoWidth * scale)); canvas.height = Math.max(2, Math.round(el.videoHeight * scale));
        const context = canvas.getContext('2d');
        const frames = [];
        let lastTarget = null;
        for (const [frameIndex, time] of frameTimes(el.duration).entries()) {
          const target = Math.min(time, Math.max(0, el.duration - 0.05));
          if (lastTarget === null ? el.currentTime !== target : target !== lastTarget) {
            await new Promise((seekOk, seekFail) => {
              const seekTimer = setTimeout(() => seekFail(new Error('This video could not be read.')), 10000);
              el.addEventListener('seeked', () => { clearTimeout(seekTimer); seekOk(); }, { once: true });
              el.currentTime = target;
            });
          }
          lastTarget = target;
          context.drawImage(el, 0, 0, canvas.width, canvas.height);
          frames.push({ mediaType: 'image/jpeg', base64Data: canvas.toDataURL('image/jpeg', VIDEO_LIMITS.FRAME_QUALITY).split(',', 2)[1], name: `${video.name} · frame ${frameIndex + 1}/${VIDEO_LIMITS.MAX_FRAMES}`, sourceVideo: video.name, frameIndex, frameTime: Math.round(time * 10) / 10 });
        }
        clearTimeout(timer); cleanup();
        resolve(frames);
      } catch (error) { fail(error.message); }
    }, { once: true });
  });
}
function scheduleDraft() {clearTimeout(draftTimer);draftTimer=setTimeout(()=>flushDraft().catch(error),200);}
function flushDraft() {
  clearTimeout(draftTimer);if(!api.saveDraft || state.workUnavailable || draftOwner===undefined)return Promise.resolve();
  const snapshot={sessionId:draftOwner || null,text:$('prompt').value,images:attachments.map(image=>({...image}))};
  const operation=draftWrites.catch(()=>{}).then(()=>api.saveDraft(snapshot));draftWrites=operation;return operation;
}
window.flushMoraDraft = flushDraft;
async function send() {
  if (sending || $('send-button').disabled) return;
  sending = true; refreshSend();
  try {
    await flushDraft();
    const clips=[...new Set(attachments.filter(image=>image.sourceVideo).map(image=>image.sourceVideo))];
    const text=[$('prompt').value,...attachments.map((image,index)=>image.contextText ? `Selection ${index+1}${image.note ? ` — requested change: ${image.note}` : ''}\n${image.contextText}` : '').filter(Boolean),...clips.map(name=>{const frames=attachments.filter(image=>image.sourceVideo===name);return `Video ${name} · ${frames.length} frame${frames.length===1?'':'s'} in time order`;})].filter(Boolean).join('\n\n');
    await api.sendMessage({ text, images: attachments.map(({ mediaType, base64Data }) => ({ mediaType, base64Data })) });
    $('prompt').value = ''; $('prompt').style.height = ''; attachments = []; renderAttachments(false); await flushDraft(); $('error-banner').hidden = true;
  } catch (e) { error(e); }
  finally { sending = false; update(await api.getState()); if (!state.busy) $('prompt').focus(); }
}
$('prompt').addEventListener('input', () => { $('prompt').style.height = 'auto'; $('prompt').style.height = `${Math.min(200,Math.max(79,$('prompt').scrollHeight))}px`; refreshSend();scheduleDraft(); });
$('prompt').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); } });
$('prompt').addEventListener('paste', event => {
  const files = [...event.clipboardData.items].filter(item => item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/'))).map(item => item.getAsFile());
  if (!files.length) return; event.preventDefault();
  action(async () => { await attachFiles(files); });
});
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
$('composer').addEventListener('dragover', event => { if (![...(event.dataTransfer?.types || [])].includes('Files')) return; event.preventDefault(); $('composer').classList.add('dragging'); });
$('composer').addEventListener('dragleave', () => $('composer').classList.remove('dragging'));
$('composer').addEventListener('drop', event => {
  event.preventDefault(); $('composer').classList.remove('dragging');
  const files = [...(event.dataTransfer?.files || [])].filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
  if (!files.length) return;
  action(async () => { await attachFiles(files); });
});
$('send-button').addEventListener('click', send);
$('queue-toggle').addEventListener('click',()=>action(()=>api.queueCommand(state.queuePaused?'resume':'pause')));
$('queue-clear').addEventListener('click',()=>action(()=>api.queueCommand('clear')));
$('stop-button').addEventListener('click', () => action(() => api.stopTurn(),{flush:false}));
$('attach-button').addEventListener('click', pickImages); $('image-suggestion').addEventListener('click', pickImages);
$('new-chat').addEventListener('click', () => action(async () => { await api.newChat(null); $('prompt').focus(); return api.getState(); }));
$('add-project').addEventListener('click', () => action(() => api.chooseWorkspace()));
$('workspace-button').addEventListener('click', () => action(() => api.chooseWorkspace()));
$('model').addEventListener('change', () => action(() => api.setOptions({ modelId: $('model').value })));
$('effort').addEventListener('change', () => action(() => api.setOptions({ reasoningEffort: $('effort').value })));
$('speed').addEventListener('change', () => action(() => api.setOptions({ speedPreset: $('speed').value })));
$('execution-mode').addEventListener('change', () => action(() => api.setOptions({ executionMode: $('execution-mode').value })));
$('settings-button').addEventListener('click', () => { $('settings-panel').hidden = !$('settings-panel').hidden; });
let usageData=null,usageError='',usageLoading=false;
function usageRow(label,block){
  const row=textNode('div','','usage-row');
  const head=textNode('div','','usage-head');
  head.append(textNode('strong',label),textNode('small',`${block.remaining}% left · resets in ${block.resetsIn}`));
  const track=textNode('div','','usage-track');
  const fill=document.createElement('span');fill.className='usage-fill'+(block.usedPercent>100?' over':'');fill.style.width=`${block.barPercent}%`;
  track.append(fill);row.append(head,track);return row;
}
function renderUsage(){
  const body=$('usage-body');body.innerHTML='';
  if(usageLoading){body.append(textNode('div','Checking usage… (one tiny request)','usage-status'));return;}
  if(usageError){body.append(textNode('div',usageError.replace(/^Error invoking remote method '[^']+': Error: /,''),'usage-error'));}
  else if(!usageData){body.append(textNode('div','No data yet.','usage-status'));}
  else{
    body.append(usageRow('5-hour window',usageData.window),usageRow('Weekly',usageData.weekly));
    if(usageData.overQuota)body.append(textNode('div','Over quota: wait for the reset.','usage-error'));
  }
  const meta=textNode('div','','usage-meta');
  const stamp=usageData?`Updated ${new Date(usageData.observedAtMs).toLocaleTimeString()} · plan ${usageData.tier || 'unknown'}`:'Each refresh spends one tiny request';
  meta.append(textNode('small',stamp));
  const refresh=textNode('button',usageData||usageError?'Refresh':'Check now');refresh.id='usage-refresh';
  refresh.addEventListener('click',event=>{event.stopPropagation();refreshUsage();});
  meta.append(refresh);body.append(meta);
}
function updateUsageSummary(){
  $('usage-summary').textContent=usageData?`5h ${usageData.window.remaining}% · wk ${usageData.weekly.remaining}%`:'–';
}
async function refreshUsage(){
  if(usageLoading)return;usageLoading=true;usageError='';renderUsage();
  try{usageData=summarizeUsage(await api.usageCommand());}
  catch(error){usageError=error?.message||String(error);}
  usageLoading=false;renderUsage();updateUsageSummary();
}
function setUsageOpen(open){
  $('usage-popover').hidden=!open;$('usage-button').setAttribute('aria-expanded',String(open));
  if(open&&!usageData&&!usageError&&!usageLoading)refreshUsage();
}
$('usage-button').addEventListener('click',event=>{event.stopPropagation();setUsageOpen($('usage-popover').hidden);});
document.addEventListener('click',event=>{if(!$('usage-popover').hidden&&!event.target.closest('#usage-popover,#usage-button'))setUsageOpen(false);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('usage-popover').hidden)setUsageOpen(false);});
renderUsage();
for(const [id,name] of [['sign-in','login'],['cancel-sign-in','cancel'],['refresh-account','refresh'],['install-muse','install']])$(id).addEventListener('click',()=>action(()=>api.accountCommand(name)));
if(api.stitchCommand){
  $('stitch-key').addEventListener('input',refreshStitch);
  $('stitch-connect').addEventListener('click',()=>stitchAction('connect',{apiKey:$('stitch-key').value}));
  $('stitch-test').addEventListener('click',()=>stitchAction('test',{apiKey:$('stitch-key').value}));
  for(const name of ['disconnect','open'])$(`stitch-${name}`).addEventListener('click',()=>stitchAction(name));
  stitchAction('state');
}else $('stitch-settings').hidden=true;
if(api.trelloCommand){
  for(const id of ['key','token','board'])$(`trello-${id}`).addEventListener('input',refreshTrello);
  $('trello-connect').addEventListener('click',()=>trelloAction('connect',{apiKey:$('trello-key').value,token:$('trello-token').value,board:$('trello-board').value}));
  $('trello-test').addEventListener('click',()=>trelloAction('test',{apiKey:$('trello-key').value,token:$('trello-token').value,board:$('trello-board').value}));
  $('trello-disconnect').addEventListener('click',()=>trelloAction('disconnect'));
  trelloAction('state');
}else $('trello-settings').hidden=true;
$('choose-muse').addEventListener('click', () => action(() => api.chooseMuse())); $('reconnect').addEventListener('click', () => action(() => api.connect()));
$('dismiss-error').addEventListener('click', () => { dismissedErrors.add(errorKey($('error-text').textContent)); $('error-banner').hidden = true; });
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { $('prompt').value = button.dataset.prompt; $('prompt').dispatchEvent(new Event('input')); $('prompt').focus(); }));
document.addEventListener('keydown', event => { if (event.ctrlKey && event.key.toLowerCase() === 'n') { event.preventDefault(); if (!state.busy && !state.loading) action(() => api.newChat(null)); } });
setInterval(() => { if (state.busy && startedAt) { const seconds = Math.floor((Date.now()-startedAt)/1000); $('elapsed').textContent = seconds >= 60 ? `${Math.floor(seconds/60)}m ${seconds%60}s` : `${seconds}s`; } },1000);
api.onEvent(event => { if (event.type === 'state') update(event.state); });
setupBrowser(api,capture=>{addImages([capture]);$('prompt').focus();});
updateProjects=setupProjects(api,action);
updateProjectWork=setupProjectWork(api,action);
$('onboarding-action').addEventListener('click',()=>{$('settings-panel').hidden=false;if(state.account?.status==='pending')return;action(()=>api.accountCommand(state.account?.status==='missing'?'install':state.account?.status==='required'?'login':'refresh'));});
update(await api.getState()); $('prompt').focus();
