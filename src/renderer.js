import {setupLibrary} from './library-ui.js';
import {setupConversationFind} from './find-ui.js';
import {setupQuickActions} from './quick-actions.js';
import { setupBrowser } from './browser-ui.js';
import {stitchImageParts,validateImages} from './images.js';
import {validateMediaSelection,extractVideoFrames,videoContext} from './video-frames.js';
import {setupUsage} from './usage-ui.js';
import {setupContextNavigation} from './context-ui.js';
import {idleReason} from './action-status.js';
import {markdownBlocks, inlineParts} from './markdown.js';
import {setupProjects} from './project-ui.js';
import {setupProjectWork} from './work-ui.js';
import {setupTester} from './tester-ui.js';
import {setupWebsiteTester} from './website-ui.js';
import {setupReadiness} from './setup-ui.js';
import {setupMoraMode} from './mora-ui.js';
import {setupWorkspaceMenus,setupSelectMenus,previewOccluded} from './menu-ui.js';

const $ = id => document.getElementById(id);
const api = window.muse;
const completionSound=new Audio('assets/completion.wav');completionSound.preload='auto';completionSound.volume=0.6;
let sidebarCollapsed=false;
try {sidebarCollapsed=localStorage.getItem('mora.sidebarCollapsed')==='true';}catch{}
function setSidebar(collapsed) {
  const sidebar=$('navigation-sidebar'),toggle=$('sidebar-toggle'),restoreFocus=collapsed&&sidebar.contains(document.activeElement);
  sidebarCollapsed=collapsed;sidebar.hidden=collapsed;document.body.classList.toggle('sidebar-collapsed',collapsed);
  toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',collapsed?'Show navigation':'Hide navigation');toggle.title=(collapsed?'Show':'Hide')+' navigation (Ctrl+B)';
  if(restoreFocus)toggle.focus();
  try {localStorage.setItem('mora.sidebarCollapsed',String(collapsed));}catch{}
}
setSidebar(sidebarCollapsed);
$('sidebar-toggle').addEventListener('click',()=>setSidebar(!sidebarCollapsed));
$('sidebar-collapse').addEventListener('click',()=>setSidebar(true));
const dismissedErrors = new Set();
let state = { items: [], sessions: [], models: [], busy: false, connection: 'connecting' };
let projectFailureNotice='';
let attachments = [], sending = false, lastSignature = '', startedAt = 0,browserUI,mediaOperation;
let draftOwner, draftGeneration=0, draftTimer, draftWrites=Promise.resolve();
let updateProjects,updateProjectWork,updateTester,updateWebsiteTester,updateReadiness;
const updateMoraMode=setupMoraMode(api,error);
const messageRows=new Map();
let visibleHistory=200,historyOwner;
const older=document.createElement('button');older.id='load-older';older.className='load-older';older.hidden=true;$('messages').before(older);
older.addEventListener('click',async()=>{const owner=state.sessionId,area=$('scroll-area'),anchor=$('messages').firstElementChild,top=anchor?.getBoundingClientRect().top;older.disabled=true;try{if(api.loadOlderMessages){const next=await api.loadOlderMessages(owner);if(state.sessionId!==owner)return;update(next);}else{visibleHistory+=200;renderMessages();conversationFind.update(state.sessionId);}requestAnimationFrame(()=>{if(state.sessionId===owner&&anchor?.isConnected)area.scrollTop+=anchor.getBoundingClientRect().top-top;});}catch(e){if(state.sessionId===owner)error(e);}finally{older.disabled=false;}});
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
let openReviewId = null, selectedReviewPath = null, openReviewSignature = '',externalReview=null,externalReviewGeneration=0,reviewSelectionGeneration=0;
const icon = name => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg; };
const textNode = (tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
const latest=textNode('button','Back to latest messages','load-older');latest.id='back-to-latest';latest.hidden=true;older.after(latest);latest.addEventListener('click',()=>action(async()=>api.contextCommand('jump',{sessionId:state.sessionId,itemId:'latest'})));
setupUsage(api);
const mediaStatus=textNode('div','','media-status');mediaStatus.id='media-status';mediaStatus.hidden=true;mediaStatus.setAttribute('role','status');$('attachments').after(mediaStatus);
const liveReview=textNode('button','','live-review');liveReview.id='live-review';liveReview.hidden=true;liveReview.setAttribute('aria-label','Review live file changes');$('composer').before(liveReview);
let trelloConfigured=false,trelloChanging=false;
const trello=textNode('section','');trello.id='trello-settings';trello.append(textNode('strong','Trello board'),Object.assign(textNode('p','Checking connection…'),{id:'trello-status'}));trello.querySelector('p').setAttribute('role','status');
for(const [name,label,placeholder] of [['key','API key','Paste your Trello API key'],['token','Token','Paste your Trello token'],['board','Board link or ID','https://trello.com/b/…']]){
  const input=document.createElement('input');input.id='trello-'+name;input.type=name==='board'?'text':'password';input.autocomplete='off';input.spellcheck=false;input.maxLength=name==='board'?2048:256;input.placeholder=placeholder;
  const caption=textNode('label',label);caption.htmlFor=input.id;trello.append(caption,input);input.addEventListener('input',refreshTrello);
}
const trelloButtons=textNode('div','','trello-buttons');
for(const name of ['connect','test','disconnect']){const button=textNode('button',name[0].toUpperCase()+name.slice(1));button.id='trello-'+name;button.addEventListener('click',()=>trelloAction(name,{apiKey:$('trello-key').value,token:$('trello-token').value,board:$('trello-board').value}));trelloButtons.append(button);}
trello.append(trelloButtons,textNode('small','Your API key and token are encrypted locally using Windows credential protection. This connection only checks board access; it does not edit cards or give the AI access to Trello.'));$('stitch-settings').after(trello);
function refreshTrello(){
  if(!api.trelloCommand)return;
  const fields=['key','token','board'].map(name=>$('trello-'+name).value.trim()),provided=fields.some(Boolean),complete=fields.every(Boolean),blocked=trelloChanging||state.busy||state.loading||state.projectOperation||state.projectRepair||state.testerActive||state.websiteActive||['starting','ready'].includes(state.projectWork?.run?.status);
  for(const name of ['connect','test','disconnect'])$('trello-'+name).disabled=!!(blocked||(name==='connect'&&!complete)||(name==='test'&&!(provided?complete:trelloConfigured)));
  for(const name of ['key','token','board'])$('trello-'+name).disabled=!!trelloChanging;
}
async function trelloAction(name,payload){
  if(trelloChanging)return;trelloChanging=true;refreshTrello();$('trello-status').textContent=name==='connect'||name==='test'?'Checking Trello board access…':'Updating Trello connection…';
  try{
    const result=await api.trelloCommand(name,payload);
    if(name!=='test')trelloConfigured=result.configured;
    $('trello-status').textContent=result.keyOnly?`Credentials verified · ${result.boardName} · press Connect to save`:result.verified?`Board verified · ${result.boardName} · ${result.listCount} lists`:result.configured?`Saved connection · ${result.boardName || 'Trello board'} · Test to verify access`:'Not connected';
    if(name==='connect'||name==='disconnect')for(const name of ['key','token','board'])$('trello-'+name).value='';
  }catch(error){$('trello-status').textContent=(error.message||String(error)).replace(/^Error invoking remote method '[^']+': Error: /,'');}
  finally{trelloChanging=false;refreshTrello();}
}
function error(error) { $('error-text').textContent = (error?.message || String(error)).replace(/^Error invoking remote method '[^']+': Error: /, ''); $('error-banner').hidden = false; refreshRecovery(); }
const errorKey = message => JSON.stringify([state.sessionId, message]);
async function action(fn, {flush=true}={}) { try { if(flush && !state.workUnavailable)await flushDraft(); const result = await fn(); if (result?.connection) update(result); return result; } catch (e) { error(e); } }
const recovery=textNode('div','','recovery-actions');$('error-banner').append(recovery);
for(const [id,label,run] of [
  ['reconnect','Reconnect engine',()=>action(()=>api.connect())],
  ['signin','Sign in to Muse',()=>action(()=>api.accountCommand('login'))],
  ['setup','Check setup',()=>$('welcome-setup').click()],
  ['results','Show run / test results',()=>{if($('project-results').hidden)$('project-output').click();$('project-output').focus();}],
  ['new-chat','Start a new chat',()=>action(()=>api.newChat(state.projectPath))],
]){const button=textNode('button',label);button.id='recovery-'+id;button.addEventListener('click',run);recovery.append(button);}
function refreshRecovery(){
  const work=state.projectWork?.root===state.projectPath?state.projectWork:null;
  const available={reconnect:state.connection==='disconnected'&&api.connect,signin:state.account?.status==='required'&&api.accountCommand,setup:api.inspectSetup,results:work&&(work.run?.status==='failed'||work.tests?.status==='failed'),'new-chat':state.historyMissing&&api.newChat};
  const busy=state.busy||state.loading||state.projectOperation||state.projectRepair||state.testerActive||state.websiteActive||state.connection==='connecting';
  for(const [id,show] of Object.entries(available)){const button=$('recovery-'+id);button.hidden=!show;button.disabled=!!busy;}
}

function showImage(source,alt) {
  document.querySelector('.image-viewer')?.close();
  const viewer=textNode('dialog','','image-viewer'),image=document.createElement('img'),close=textNode('button','×','image-viewer-close');
  image.alt=alt;image.referrerPolicy='no-referrer';image.src=source;close.setAttribute('aria-label','Close image');close.addEventListener('click',()=>viewer.close());
  viewer.append(close,image);viewer.addEventListener('click',event=>{if(event.target===viewer)viewer.close();});
  viewer.addEventListener('close',()=>{viewer.remove();api.browserCommand?.('occlude',{hidden:previewOccluded()}).catch(()=>{});});
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
function closeChanges() { reviewSelectionGeneration++;externalReviewGeneration++;const panel=document.querySelector('.changes-panel');panel?.remove();if(panel)api.browserCommand?.('occlude',{hidden:previewOccluded()}).catch(()=>{});openReviewId = null; selectedReviewPath = null; openReviewSignature = '';externalReview=null; }
function showChanges(item, refresh = false) {
  if (!refresh) { closeChanges(); openReviewId = item.itemId;if(item.itemId.startsWith('checkpoint-review-'))externalReview={item,sessionId:state.sessionId}; }
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
  if(item.checkpointId)panel.append(textNode('p','Changes are already in your project. Keep records your review; Reject saves recovery before restoring.', 'changes-note'));
  const list = textNode('div', '', 'changes-files'), preview = textNode('div', '', 'changes-preview');
  reviewSelectionGeneration++;
  async function select(file, button) {
    const generation=++reviewSelectionGeneration,owner=state.sessionId,fileButton=button;
    selectedReviewPath = file.path;
    list.querySelectorAll('button').forEach(node => { node.classList.toggle('selected', node === button); node.setAttribute('aria-pressed', String(node === button)); });
    preview.replaceChildren(textNode('div', file.path, 'diff-filename'));
    const pre = textNode('pre', '', 'diff-code');
    for (const line of (file.patch || 'No text lines changed.').split('\n')) pre.append(textNode('div', line || ' ', `diff-line${line.startsWith('+') ? ' added' : line.startsWith('-') ? ' removed' : line.startsWith('@@') ? ' hunk' : ''}`));
    preview.append(pre);
    if(item.checkpointId && api.checkpointCommand && !item.live){
      const controls=textNode('div','','review-controls'),notice=textNode('p','Loading review…','changes-note');preview.append(controls,notice);
      try{
        const review=await api.checkpointCommand('review',{id:item.checkpointId,path:file.path});
        if(generation!==reviewSelectionGeneration||owner!==state.sessionId||!panel.isConnected)return;
        notice.textContent=review.stale?'Newer manual edits exist. They are preserved; use checkpoint review for recovery.':review.unchanged?'This file matches the original checkpoint.':review.decision||'Review this file or one change below.';
        if(review.hunks.length)pre.replaceChildren(...review.hunks.flatMap(hunk=>hunk.patch.split('\n').map(line=>textNode('div',line||' ',`diff-line${line.startsWith('+')?' added':line.startsWith('-')?' removed':line.startsWith('@@')?' hunk':''}`))));
        const blocked=state.busy||state.loading||state.projectOperation||state.projectRepair||state.testerActive||state.websiteActive;
        const decideButton=(label,action,hunkId)=>{
          const button=textNode('button',label);button.type='button';button.disabled=!!(review.stale||review.unchanged||blocked||(action==='reject'&&['starting','ready'].includes(state.projectWork?.run?.status)));button.title=review.stale?'Newer edits prevent this review action.':blocked?'Finish or stop current work before reviewing.':button.disabled?'Stop Run before rejecting changes.':label;
          button.addEventListener('click',async()=>{for(const control of controls.querySelectorAll('button'))control.disabled=true;try{const result=await api.checkpointCommand('decision',{id:item.checkpointId,token:review.token,action,hunkId});if(owner!==state.sessionId||generation!==reviewSelectionGeneration||!panel.isConnected)return;notice.textContent=result.decision+(result.recovery?' · recovery checkpoint saved':'');await select(file,fileButton);if(generation+1===reviewSelectionGeneration)fileButton.focus({preventScroll:true});}catch(cause){if(owner===state.sessionId&&generation===reviewSelectionGeneration&&panel.isConnected){error(cause);notice.textContent=cause.message;fileButton.focus({preventScroll:true});}}});return button;
        };
        controls.append(decideButton('Keep file','keep'),decideButton('Reject file','reject'));
        for(const hunk of review.hunks){const row=textNode('div','','review-hunk');row.append(textNode('span',hunk.label),decideButton(`Keep change ${hunk.id+1}`,'keep',hunk.id),decideButton(`Reject change ${hunk.id+1}`,'reject',hunk.id));controls.append(row);}
      }catch(cause){if(generation===reviewSelectionGeneration&&owner===state.sessionId)notice.textContent=cause.message;}
    }
  }
  for (const file of item.files) {
    const button = textNode('button', '', 'changes-file'); button.append(textNode('span', file.path, 'changes-path'));
    button.dataset.path = file.path;
    if (file.binary) button.append(textNode('span', 'Binary', 'changes-note')); else changeCounts(button, file.added, file.removed);if(file.reviewDecision)button.append(textNode('span',file.reviewDecision,'changes-note'));
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
  const live=state.busy&&(state.items||[]).find(item=>item.kind==='fileChanges'&&item.live&&item.files?.length);
  liveReview.hidden=!live;liveReview.replaceChildren();
  if(live){liveReview.append(textNode('strong',live.files.length+' '+(live.files.length===1?'file':'files')+' changed'+(live.partial?' · partial':'')));changeCounts(liveReview,live.added,live.removed);liveReview.append(textNode('span','Live','change-live'));liveReview.onclick=()=>showChanges(live);}else liveReview.onclick=null;
  if (openReviewId) {
    const review=state.items.find(item=>item.itemId===openReviewId) || (state.lastOutcomeReview?.itemId===openReviewId&&state.lastOutcomeReview) || (externalReview?.sessionId===state.sessionId&&externalReview.item);
    if(!review)closeChanges();else if(JSON.stringify(review)!==openReviewSignature)showChanges(review,true);
  }
  const area=$('scroll-area'),nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<130;
  if(historyOwner!==state.sessionId){historyOwner=state.sessionId;visibleHistory=200;}
  if(Number.isInteger(state.historyWindowSize))visibleHistory=state.historyWindowSize;
  const history=(state.items || []).filter(item=>!item.retracted&&item!==live);
  const historyCount=state.historyCount??history.length;
  const before=state.historyWindowBefore??Math.max(0,historyCount-visibleHistory);older.hidden=!before;older.textContent=`Load older messages (${before} remaining)`;latest.hidden=!state.historyWindowAfter;
  const rows=[...history.slice(-visibleHistory),...(state.pendingQueue || []).map(entry=>({...entry,itemId:'queue-'+entry.queueId,kind:'queued'}))];
  if(state.lastOutcome && !state.busy)rows.push({...state.lastOutcome,itemId:'outcome-'+state.lastOutcome.turnId,kind:'outcome',previewReady:state.projectWork?.root===state.projectPath&&state.projectWork?.run?.status==='ready',tools:state.lastOutcomeOperations??(state.items || []).filter(item=>item.turnId===state.lastOutcome.turnId && (item.kind==='toolCall' || item.kind==='userShell')),review:state.lastOutcomeReview??(state.items || []).find(item=>item.turnId===state.lastOutcome.turnId && item.kind==='fileChanges'),activeRequest:state.activeRequest});
  const seen=new Set();let position=0,queuePosition=0;
  for(const item of rows) {
    if(!['fileChanges','activity','toolCall','userShell','agentMessage','userMessage','queued','outcome'].includes(item.kind))continue;
    const key=item.itemId,signature=JSON.stringify({...item,images:undefined,queuePaused:item.kind==='queued'?state.queuePaused:undefined});
    let record=messageRows.get(key);
    const sameImages=record && (record.images || []).length===(item.images || []).length && (item.images || []).every((image,index)=>image.mediaType===record.images[index].mediaType && image.base64Data===record.images[index].base64Data);
    if(!record){record={node:document.createElement('div')};messageRows.set(key,record);}
    const node=record.node;node.currentItem=item;node.dataset.messageId=item.itemId;
    if(record.signature!==signature || !sameImages) {
      const sameKind=record.kind===item.kind;record.signature=signature;record.kind=item.kind;
      if(item.kind==='toolCall' || item.kind==='userShell') {
        node.className='timeline-operation';
        if(!sameKind){node.replaceChildren();const details=document.createElement('details');details.className='tool-card';details.dataset.id=key;details.open=item.status==='inProgress';const summary=document.createElement('summary');summary.append(icon('terminal'),textNode('span',''),textNode('span','','tool-status'));details.append(summary);node.append(details);details.addEventListener('toggle',()=>renderToolOutput(node));}
        const summary=node.querySelector('summary');summary.children[1].textContent=item.description || item.tool || item.commandText || 'Project operation';summary.children[2].textContent=item.status==='inProgress'?'Running':item.status || 'Completed';renderToolOutput(node);
      }else if(item.kind==='queued') {
        node.className='message user queued';node.setAttribute('role','group');node.setAttribute('aria-label',state.queuePaused?'Paused queued message':'Queued message');
        if(!sameKind){
          node.replaceChildren();const line=textNode('div','','queue-row'),mark=icon('queue'),badge=textNode('span','','queue-badge'),body=textNode('div','','message-body'),images=textNode('button','','queue-images'),actions=textNode('div','','queue-actions');
          mark.classList.add('queue-mark');images.addEventListener('click',()=>editQueued(node));
          const edit=textNode('button','Edit','queue-edit-button'),remove=textNode('button','','queue-remove');edit.title='Edit this queued message';remove.append(icon('trash'));remove.setAttribute('aria-label','Remove');remove.title='Remove queued message';
          edit.addEventListener('click',()=>editQueued(node));remove.addEventListener('click',()=>action(()=>api.queueCommand('remove',{queueId:node.currentItem.queueId})));
          actions.append(edit,remove);line.append(mark,badge,body,images,actions);node.append(line);
        }
        node.querySelector('.queue-badge').textContent=state.queuePaused?'Paused':'Queued';node.classList.toggle('paused',!!state.queuePaused);
        const body=node.querySelector('.message-body');body.textContent=item.displayText || item.text || '';body.dir='auto';body.title=body.textContent;
        const count=item.images?.length || 0,images=node.querySelector('.queue-images');images.hidden=!count;images.textContent=count+' '+(count===1?'image':'images');images.setAttribute('aria-label','View '+count+' queued '+(count===1?'image':'images'));
      }else if(item.kind==='agentMessage' || item.kind==='userMessage') {
        const user=item.kind!=='agentMessage';node.className='message '+(user?'user':'assistant');
        if(!sameKind){node.replaceChildren();const avatar=textNode('div',user?'Y':'','avatar');if(!user){const logo=document.createElement('img');logo.src='assets/mora-mark.svg';logo.alt='Mora';avatar.append(logo);}const content=textNode('div','','message-content');content.append(textNode('div',user?'You':'Mora','message-label'),textNode('div','','message-images'),textNode('div','','message-body'));node.append(avatar,content);}
        if(!sameImages){const imgs=node.querySelector('.message-images');imgs.replaceChildren();for(const image of item.images || []){const img=document.createElement('img');img.src='data:'+image.mediaType+';base64,'+image.base64Data;img.alt='Attached image';imgs.append(img);}}
        if(!user)node.querySelector('.message-label').textContent=item.status==='completed'?'Completed':item.status==='inProgress'?'Working':'Mora';
        node.setAttribute('aria-label',user?'Your message':'Mora reply');
        renderText(node.querySelector('.message-body'),item.displayText || item.text || '',item.status==='inProgress');
      }else {
        node.replaceChildren();
        if(item.kind==='fileChanges') {
          node.className='change-row';const button=textNode('button','','change-badge');button.append(textNode('strong',(item.files.length===1?'Edited '+item.files[0].path:item.files.length+' files changed')+(item.partial?' · partial':'')));changeCounts(button,item.added,item.removed);if(item.live)button.append(textNode('span','Live','change-live'));button.append(textNode('span','Review changes','change-review-label'));button.title='Review file changes';button.addEventListener('click',()=>showChanges(node.currentItem));node.append(button);
        }else if(item.kind==='activity'){node.className='activity-step';node.dir='auto';node.textContent=item.text;}
        else {
          node.className='completion-card '+item.status;node.append(textNode('strong',item.status==='finished'?'Request finished':item.status==='interrupted'?'Request interrupted':'Request failed'),textNode('p',item.message));
          if(item.review)node.append(textNode('p',item.review.files.length+' files changed · +'+item.review.added+' / -'+item.review.removed+(item.review.partial?' · partial review':'')));
          if(item.tools.length){const details=document.createElement('details');details.append(textNode('summary','Show '+item.tools.length+' operation outcomes'));details.addEventListener('toggle',()=>{details.querySelectorAll('p').forEach(row=>row.remove());if(details.open)for(const tool of node.currentItem.tools)details.append(textNode('p',(tool.commandText || tool.description || tool.tool || 'Operation')+' · '+(tool.status || 'unknown')+(Number.isInteger(tool.exitCode)?' · exit '+tool.exitCode:'')));});node.append(details);}
          if(item.activeRequest){const details=document.createElement('details');details.append(textNode('summary',item.activeRequest.phase==='admitted'?'Saved request · review before continuing':'Unsubmitted request'),textNode('p',item.activeRequest.text));node.append(details);if(item.activeRequest.phase==='preparing'){const recover=textNode('button','Recover as draft');recover.addEventListener('click',()=>{if($('prompt').value || attachments.length){error('Keep or clear the current draft first.');return;}$('prompt').value=item.activeRequest.text;attachments=item.activeRequest.images || [];renderAttachments();scheduleDraft();});node.append(recover);}}
          const controls=textNode('div','','request-actions');
          if(item.status!=='finished'){const continuing=textNode('button','Continue in chat');continuing.title='Keep your draft and write the next step';continuing.addEventListener('click',()=>$('prompt').focus());controls.append(continuing);}
          if(state.projectPath&&item.status==='finished'){const preview=textNode('button',item.previewReady?'Open preview':'Run / open preview');preview.addEventListener('click',()=>action(()=>api.projectCommand(state.projectWork?.root===state.projectPath && state.projectWork.run.status==='ready'?'preview':'run')));if(item.previewReady){const card=textNode('div','','timeline-preview-card');card.append(textNode('strong','Web preview'),preview);node.append(card);}else controls.append(preview);}
          if(state.projectPath&&item.checkpointId){const undo=textNode('button','Undo this request');undo.title='Review source files to restore; stops the running preview first';undo.addEventListener('click',()=>action(()=>updateProjectWork.reviewCheckpoint(node.currentItem.checkpointId)));controls.append(undo);}
          if(controls.children.length)node.append(controls);
        }
      }
      record.images=item.images;
    }
    for(const button of node.querySelectorAll('.request-actions button,.timeline-preview-card button'))button.disabled=!!(state.busy || state.loading || state.projectOperation || state.projectRepair || state.testerActive || state.websiteActive);
    const parent=$(item.kind==='queued'?'queue-messages':'messages'),index=item.kind==='queued'?queuePosition++:position++;
    if(parent.children[index]!==node)parent.insertBefore(node,parent.children[index] || null);
    seen.add(key);
  }
  for(const [key,record] of messageRows)if(!seen.has(key)){record.node.remove();messageRows.delete(key);}
  const queue=$('queue-controls');queue.hidden=$('queue-dock').hidden=!(state.pendingQueue || []).length;if(queue.hidden)$('queue-menu').open=false;
  $('queue-status').textContent=(state.pendingQueue || []).length+' pending · '+(state.queuePaused?'paused':'runs in order');$('queue-toggle').textContent=state.queuePaused?'Resume queue':'Pause queue';$('queue-toggle').disabled=state.loading || state.stopping || state.connection!=='ready' || state.historyMissing || state.workUnavailable;
  if(nearBottom && !conversationFind.isOpen())requestAnimationFrame(()=>{area.scrollTop=area.scrollHeight;});
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
  const form=textNode('div','','queue-edit'),input=document.createElement('textarea');input.value=node.currentItem.text;input.dir='auto';input.setAttribute('aria-label','Edit queued message');const save=textNode('button','Save queued message'),cancel=textNode('button','Cancel edit');
  const close=()=>{form.remove();node.querySelector('.queue-edit-button').focus();};
  save.addEventListener('click',()=>action(async()=>{await api.queueCommand('edit',{queueId:node.currentItem.queueId,text:input.value});update(await api.getState());close();}));cancel.addEventListener('click',close);form.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
  const images=textNode('div','','message-images');for(const image of node.currentItem.images || []){const view=textNode('button','','image-preview-button'),img=document.createElement('img');img.src='data:'+image.mediaType+';base64,'+image.base64Data;img.alt='Queued image';view.setAttribute('aria-label','Enlarge queued image');view.append(img);view.addEventListener('click',()=>showImage(img.src,img.alt));images.append(view);}
  form.append(input,images,save,cancel);node.append(form);input.focus();
}
function fillSelect(node, options, value) {
  const signature = JSON.stringify(options);
  if (node.dataset.options !== signature) { node.replaceChildren(...options.map(option => { const el = document.createElement('option'); el.value = option.value; el.textContent = option.label; return el; })); node.dataset.options = signature; }
  node.value = value;
}
function update(next) {
  if(mediaOperation && (next.loading||next.workUnavailable||next.sessionId!==state.sessionId))cancelMedia();
  if (next.sessionId === state.sessionId && state.error && state.error !== next.error) dismissedErrors.delete(errorKey(state.error));
  if (next.sessionId !== state.sessionId) closeChanges();
  if (next.sessionId !== state.sessionId || (state.error && !next.error)) $('error-banner').hidden = true;
  const wasBusy = state.busy,previousFailureKey=errorKey(projectFailureNotice); state = next;
  updateProjects?.(state);
  updateProjectWork?.(state);
  updateTester?.(state);
  updateWebsiteTester?.(state);
  updateReadiness?.(state);
  updateMoraMode(state);
  updateContext?.(state);
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
  if(!state.loading && draftOwner!==state.sessionId){draftOwner=state.sessionId;draftGeneration++;const draft=state.draft || {text:'',images:[]};$('prompt').value=draft.text;attachments=draft.images || [];renderAttachments(false);}
  const general = state.projectPath === null;
  $('project-name').textContent = general ? 'General chat' : (state.workspace || '').split(/[\\/]/).filter(Boolean).at(-1) || 'Your project';
  $('project-path').textContent = general ? 'No project attached' : state.workspace || 'Select a folder';
  $('workspace-button').title = general ? 'Start a chat in a project folder' : state.workspace+'\nChoose a project folder';
  $('workspace-label').textContent = general ? 'GENERAL CHAT' : 'PROJECT WORKSPACE';
  const ready = state.connection === 'ready';
  $('connection-badge').className = `connection-badge ${state.connection}`; $('connection-badge').textContent = ready ? 'Connected' : state.connection === 'connecting' ? 'Connecting' : 'Disconnected';
  $('connection-dot').className = `connection-dot ${state.connection}`; $('engine-label').textContent = ready ? 'Muse connected' : state.connection==='connecting'?'Connecting to Muse':'Muse disconnected'; $('engine-detail').textContent = ready ? 'Runs on your installed engine' : 'Reconnect in Settings';
  const work=state.projectWork?.root===state.projectPath?state.projectWork:null;
  const failure=work?.run?.status==='failed'?work.run.message||'Your app could not start. Show results for details.':work?.tests?.status==='failed'?work.tests.message||'Project checks failed. Show results for details.':'';
  if(projectFailureNotice!==failure){dismissedErrors.delete(previousFailureKey);if($('error-text').textContent===projectFailureNotice)$('error-banner').hidden=true;projectFailureNotice=failure;}
  const notice=state.error||failure;if(notice&&!dismissedErrors.has(errorKey(notice)))error(notice);
  refreshRecovery();refreshTrello();
  $('welcome').hidden = !!state.items?.length || state.busy;
  $('working').hidden = !state.busy && !state.loading; $('working-label').textContent = state.loading ? 'Opening conversation…' : state.stopping ? 'Stopping Muse…' : state.finishing ? 'Reply ready · finishing final checks' : state.activity || 'Muse is working on it';
  if (state.busy && !wasBusy) { startedAt = Date.now(); $('elapsed').textContent = '0s'; }
  $('send-button').hidden = false; $('stop-button').hidden = !state.busy; $('stop-button').disabled = state.stopping;
  const idle=idleReason(state);for (const id of ['new-chat','add-project','workspace-button','model','effort','execution-mode','choose-muse','reconnect']) {const control=$(id);control.disabled=!!(idle||sending||state.connection==='connecting');control.dataset.defaultTitle??=control.title;control.title=idle||(sending?'Wait for this message to be saved.':state.connection==='connecting'?'Wait for Muse to connect.':control.dataset.defaultTitle);}
  $('attach-button').disabled = state.loading || sending || !!mediaOperation || state.workUnavailable;
  $('prompt').disabled = state.loading || sending || state.workUnavailable;
  $('prompt').placeholder = state.busy && state.finishing ? 'Write your next message while Muse finishes…' : state.busy ? 'Queue a follow-up while Muse works…' : general ? 'Ask Muse anything, or attach an image…' : 'Describe what you want to change…';
  $('composer').classList.toggle('full-mode', !general && state.executionMode === 'full');
  $('execution-mode').hidden = general;
  for (const [id,title,detail,prompt] of general ? [
    ['explore-suggestion','Ask anything','Ideas, questions, and advice','Help me think through a question.'],
    ['explain-suggestion','Explain a topic','Make something easier to understand','Explain a topic to me in simple terms.'],
  ] : [
    ['explore-suggestion','Explore my project','Get the lay of the land','Explore this project and explain its structure. Do not modify anything.'],
    ['explain-suggestion','Find a bug','Make the next fix clearer','Inspect this project for a concrete bug. Explain what you find before making changes.'],
  ]) { const button=$(id); button.querySelector('strong').textContent=title; button.querySelector('small').textContent=detail; button.dataset.prompt=prompt; }
  fillSelect($('model'), (state.models || []).map(model => ({ value: model.modelId, label: model.displayLabel && model.displayLabel !== model.modelId ? model.displayLabel : model.modelId.replace(/[-_]/g,' ').replace(/\b[a-z]/g,letter=>letter.toUpperCase()) })), state.modelId);
  $('model').title=state.modelId || '';
  const model = state.models?.find(model => model.modelId === state.modelId);
  const efforts=Array.isArray(model?.variants)?model.variants:[];
  fillSelect($('effort'), efforts.length?efforts.map(value => ({ value, label:value==='xhigh'?'Extra high':value[0].toUpperCase()+value.slice(1) })):[{value:'',label:'Not available'}], efforts.length?state.reasoningEffort:'');
  $('effort').disabled=!!idle || sending || !efforts.length || state.connection!=='ready';
  $('execution-mode').value = state.executionMode || 'readonly';syncSelectMenus();
  $('completion-sound').checked=state.completionSound!==false;
  updateLibrary(state,sending);updateQuickActions();
  renderMessages(); conversationFind.update(state.sessionId);refreshSend();refreshStitch();
}
function refreshSend() { $('send-button').disabled = sending || !!mediaOperation || (state.moraMode?.enabled&&!!attachments.length) || state.loading || state.testerActive || state.websiteActive || state.projectOperation || state.projectRepair || state.historyMissing || state.workUnavailable || ['required','pending'].includes(state.account?.status) || state.connection !== 'ready' || (!$('prompt').value.trim() && !attachments.length);const count=attachments.filter(image=>image.annotationRef).length;$('browser-send-notes').hidden=!count;$('browser-send-notes').textContent=`Send notes (${count})`;$('browser-send-notes').disabled=$('send-button').disabled;browserUI?.setSending(sending);for(const button of $('attachments').querySelectorAll('button'))button.disabled=sending;
  $('attach-button').disabled=state.loading||sending||!!mediaOperation||state.workUnavailable;
  mediaStatus.replaceChildren();mediaStatus.hidden=!mediaOperation&&!(state.moraMode?.enabled&&attachments.length);
  if(mediaOperation){mediaStatus.append(textNode('span','Preparing attachments…'));const cancel=textNode('button','Cancel');cancel.addEventListener('click',cancelMedia);mediaStatus.append(cancel);}
  else if(!mediaStatus.hidden)mediaStatus.textContent='Turn off Mora Mode to send images or video frames. Your draft is saved.';
}
function renderAttachments(persist=true) {
  $('attachments').replaceChildren(); $('attachments').hidden = !attachments.length;
  for (const [index,image] of attachments.entries()) {
    const box = textNode('div', '', 'attachment'); const img = document.createElement('img'); img.src = `data:${image.mediaType};base64,${image.base64Data}`; img.alt = image.name || 'Attached image';
    const remove = textNode('button', '×'); remove.setAttribute('aria-label', 'Remove image'); remove.addEventListener('click', () => { attachments.splice(index,1); renderAttachments(); }); box.append(img,remove);
    if(image.sourceVideo){box.classList.add('video-frame');box.title=`${image.sourceVideo} · ${image.frameTime}s`;box.append(textNode('small',`${image.frameTime}s`));}
    if(image.annotationRef){box.classList.add('saved-annotation');const number=attachments.slice(0,index+1).filter(item=>item.annotationRef).length;const edit=textNode('button',`Note ${number}: ${image.note}`,'saved-note-edit');edit.title=image.note;edit.setAttribute('aria-label',`Edit note ${number}`);edit.addEventListener('click',()=>action(()=>api.browserCommand('note-edit',{id:image.annotationRef.id})));box.append(edit);}
    else if(image.contextText){box.classList.add('browser-attachment');box.append(textNode('strong',`Selection ${index+1}`),textNode('small',image.sourceUrl || '', 'annotation-source'));const note=document.createElement('textarea');note.value=image.note || '';note.maxLength=10000;note.placeholder='What should change here?';note.setAttribute('aria-label',`Note for selection ${index+1}`);note.addEventListener('input',()=>{image.note=note.value;scheduleDraft();});box.append(note);const context=textNode('details','','attachment-context');context.append(textNode('summary',image.name || 'Browser annotation'),textNode('pre',image.contextText));box.append(context);}
    $('attachments').append(box);
  } refreshSend();if(persist)scheduleDraft();
}
function addImages(images) {
  const next = [...attachments,...images];
  validateImages(next);
  attachments = next; renderAttachments();
}
function imageBudget(){return {imageCount:attachments.length,imageBytes:attachments.reduce((sum,image)=>sum+image.base64Data.length*3/4-(image.base64Data.endsWith('==')?2:image.base64Data.endsWith('=')?1:0),0)};}
function cancelMedia(){mediaOperation?.controller.abort();mediaOperation=null;refreshSend();}
function readFileData(file,signal){return new Promise((resolve,reject)=>{
  const reader=new FileReader(),abort=()=>reader.abort(),cleanup=()=>signal.removeEventListener('abort',abort);
  reader.onload=()=>{cleanup();resolve(String(reader.result).split(',',2)[1]);};reader.onerror=()=>{cleanup();reject(Error(`Could not read ${file.name}.`));};reader.onabort=()=>{cleanup();reject(new DOMException('Attachment cancelled','AbortError'));};
  if(signal.aborted){reject(signal.reason);return;}signal.addEventListener('abort',abort,{once:true});reader.readAsDataURL(file);
});}
async function attachMedia(getFiles){
  if(mediaOperation||sending||state.loading||state.workUnavailable)return;
  const operation={owner:state.sessionId,controller:new AbortController()};mediaOperation=operation;refreshSend();
  try{
    await flushDraft();operation.controller.signal.throwIfAborted();
    const files=await getFiles();operation.controller.signal.throwIfAborted();
    const selected=validateMediaSelection(files,imageBudget()),images=[];
    for(const file of selected){
      operation.controller.signal.throwIfAborted();
      if(file.mediaType.startsWith('video/'))images.push(...await extractVideoFrames(file,{signal:operation.controller.signal}));
      else images.push({mediaType:file.mediaType,base64Data:file.base64Data||await readFileData(file.file,operation.controller.signal),name:file.name});
    }
    operation.controller.signal.throwIfAborted();if(operation.owner!==state.sessionId)return;
    addImages(images);await flushDraft();
  }catch(e){if(!operation.controller.signal.aborted&&operation.owner===state.sessionId)error(e);}
  finally{if(mediaOperation===operation){mediaOperation=null;refreshSend();}}
}
function pickImages(){return attachMedia(async()=>{const files=await api.pickImages(imageBudget());return files.map(file=>({...file,size:file.size??file.base64Data.length*3/4-(file.base64Data.endsWith('==')?2:file.base64Data.endsWith('=')?1:0)}));});}
function attachFiles(files){return attachMedia(async()=>files.map(file=>({file,mediaType:file.type,name:file.name,size:file.size})));}
window.addEventListener('pagehide',cancelMedia);
function scheduleDraft() {clearTimeout(draftTimer);draftTimer=setTimeout(()=>flushDraft().catch(error),200);}
function flushDraft() {
  clearTimeout(draftTimer);if(!api.saveDraft || state.workUnavailable || draftOwner===undefined)return Promise.resolve();
  const snapshot={sessionId:draftOwner || null,text:$('prompt').value,images:attachments.map(image=>({...image}))};
  const operation=draftWrites.catch(()=>{}).then(()=>api.saveDraft(snapshot));draftWrites=operation;return operation;
}
window.flushMoraDraft = flushDraft;
async function send() {
  if (sending || $('send-button').disabled) return;
  let acceptedOwner;
  const owner=draftOwner,generation=draftGeneration,sentImages=attachments.map(image=>({...image})),sentPrompt=$('prompt').value,sameOwner=()=>owner===draftOwner&&owner===state.sessionId&&generation===draftGeneration,ownsDraft=()=>sameOwner()||owner===null&&acceptedOwner!==undefined&&acceptedOwner===state.sessionId&&draftOwner===state.sessionId&&draftGeneration===generation+1;
  sending = true; refreshSend();
  try {
    await flushDraft();
    if(!sameOwner()||state.loading)return;
    let noteNumber=0;const text=[sentPrompt,...sentImages.map((image,index)=>image.contextText ? `${image.annotationRef?`Note ${++noteNumber}`:`Selection ${index+1}`}${image.note ? ` — requested change: ${image.note}` : ''}\n${image.contextText}` : '').filter(Boolean),videoContext(sentImages)].filter(Boolean).join('\n\n');
    const accepted=await api.sendMessage({sessionId:owner??null,text,images:sentImages.map(({ mediaType, base64Data }) => ({ mediaType, base64Data }))});
    acceptedOwner=accepted?.sessionId;if(!ownsDraft())return;
    if($('prompt').value===sentPrompt){$('prompt').value = ''; $('prompt').style.height = '';}
    attachments=attachments.filter(image=>!sentImages.some(sent=>['mediaType','base64Data','contextText','note'].every(key=>sent[key]===image[key]) && sent.annotationRef?.id===image.annotationRef?.id));renderAttachments(false);await flushDraft();if(ownsDraft())$('error-banner').hidden=true;
  } catch (e) { if(ownsDraft())error(e); }
  finally { sending = false; update(await api.getState()); if (ownsDraft()&&!state.busy) $('prompt').focus(); }
}
$('prompt').addEventListener('input', () => { const prompt=$('prompt'),minimum=parseFloat(getComputedStyle(prompt).minHeight);prompt.style.height='auto';prompt.style.height=`${Math.min(200,Math.max(minimum,prompt.scrollHeight))}px`; refreshSend();scheduleDraft(); });
$('prompt').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); } });
$('prompt').addEventListener('paste', event => {
  const files = [...event.clipboardData.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
  if (!files.length) return; event.preventDefault();
  attachFiles(files);
});
document.addEventListener('dragover',event=>event.preventDefault());document.addEventListener('drop',event=>event.preventDefault());
$('composer').addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files')){event.preventDefault();$('composer').classList.add('dragging');}});
$('composer').addEventListener('dragleave',()=>$('composer').classList.remove('dragging'));
$('composer').addEventListener('drop',event=>{event.preventDefault();$('composer').classList.remove('dragging');attachFiles([...(event.dataTransfer?.files||[])]);});
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
$('execution-mode').addEventListener('change', () => action(() => api.setOptions({ executionMode: $('execution-mode').value })));


function openSettings(){
  setSidebar(false);
  const panel=$('settings-panel');if(panel.open)return;
  panel.showModal();$('settings-close').focus();
  api.browserCommand?.('occlude',{hidden:true}).catch(()=>{});
}
$('settings-button').addEventListener('click',openSettings);
$('settings-close').addEventListener('click',()=>$('settings-panel').close());
$('settings-panel').addEventListener('click',event=>{
  if(event.target!==$('settings-panel'))return;
  const rect=event.target.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.target.close();
});
$('settings-panel').addEventListener('close',()=>{
  api.browserCommand?.('occlude',{hidden:previewOccluded()}).catch(()=>{});
  if(!document.querySelector('dialog[open]'))$('settings-button').focus();
});
for(const [id,name] of [['sign-in','login'],['cancel-sign-in','cancel'],['refresh-account','refresh'],['install-muse','install']])$(id).addEventListener('click',()=>action(()=>api.accountCommand(name)));
if(api.stitchCommand){
  $('stitch-key').addEventListener('input',refreshStitch);
  $('stitch-connect').addEventListener('click',()=>stitchAction('connect',{apiKey:$('stitch-key').value}));
  $('stitch-test').addEventListener('click',()=>stitchAction('test',{apiKey:$('stitch-key').value}));
  for(const name of ['disconnect','open'])$(`stitch-${name}`).addEventListener('click',()=>stitchAction(name));
  stitchAction('state');
}else $('stitch-settings').hidden=true;
if(api.trelloCommand)trelloAction('state');else trello.hidden=true;
$('choose-muse').addEventListener('click', () => action(() => api.chooseMuse())); $('reconnect').addEventListener('click', () => action(() => api.connect()));
$('dismiss-error').addEventListener('click', () => { dismissedErrors.add(errorKey($('error-text').textContent)); $('error-banner').hidden = true; });
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { $('prompt').value = button.dataset.prompt; $('prompt').dispatchEvent(new Event('input')); $('prompt').focus(); }));
setInterval(() => { if (state.busy && startedAt) { const seconds = Math.floor((Date.now()-startedAt)/1000); $('elapsed').textContent = seconds >= 60 ? `${Math.floor(seconds/60)}m ${seconds%60}s` : `${seconds}s`; } },1000);
api.onEvent(event => { if (event.type === 'state') update(event.state);else if(event.type==='annotation-saved' && event.sessionId===(draftOwner||null)){attachments=event.images;renderAttachments(false);}else if(event.type==='completion-sound'){completionSound.currentTime=0;completionSound.play().catch(()=>{});} });
browserUI=setupBrowser(api,capture=>{addImages([capture]);$('prompt').focus();},{flushDraft,send});
const updateLibrary=setupLibrary(api,action);
const conversationFind=setupConversationFind(api,update);
const updateContext=setupContextNavigation(api,{update,error,flushDraft:()=>flushDraft()});
document.addEventListener('mora-review-checkpoint',event=>action(()=>updateProjectWork.reviewCheckpoint(event.detail)));
document.addEventListener('mora-review-files',async event=>{const owner=state.sessionId,generation=++externalReviewGeneration;try{const item=await api.checkpointCommand('review-files',{id:event.detail});if(owner===state.sessionId&&generation===externalReviewGeneration)showChanges(item);}catch(cause){if(owner===state.sessionId&&generation===externalReviewGeneration)error(cause);}});
const updateQuickActions=setupQuickActions(api,{find:conversationFind,sidebar:setSidebar});
$('completion-sound').addEventListener('change',()=>action(()=>api.completionSoundOptions($('completion-sound').checked),{flush:false}));
updateProjects=setupProjects(api,action);
updateProjectWork=setupProjectWork(api,action);
updateTester=setupTester(api,error);
updateWebsiteTester=setupWebsiteTester(api,error);
updateReadiness=setupReadiness(api,error,openSettings);
setupWorkspaceMenus(api);
const syncSelectMenus=setupSelectMenus(api);
$('onboarding-action').addEventListener('click',()=>{openSettings();if(state.account?.status==='pending')return;action(()=>api.accountCommand(state.account?.status==='missing'?'install':state.account?.status==='required'?'login':'refresh'));});
update(await api.getState()); $('prompt').focus();
