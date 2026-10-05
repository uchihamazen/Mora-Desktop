import {previewOccluded} from './menu-ui.js';
import {conversationGroups} from './projects.js';
import {idleReason} from './action-status.js';

export function setupLibrary(api,action) {
  const $=id=>document.getElementById(id);
  const node=(tag,text,className)=>{const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;};
  const icon=name=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS(svg.namespaceURI,'use');use.setAttribute('href',`#i-${name}`);svg.append(use);return svg;};
  const collapsed=new Set();let state={},sending=false,archived=false,signature='',previousSession,editing;
  const removal=node('dialog','','workspace-dialog project-remove-dialog'),removeHeading=node('h2','Remove project'),removeNotice=node('p',''),removeStatus=node('p',''),removeConfirm=node('button','Remove project'),removeCancel=node('button','Cancel');
  removal.setAttribute('aria-label','Remove project');removeStatus.setAttribute('role','status');removal.append(removeHeading,removeNotice,removeStatus,removeCancel,removeConfirm);document.body.append(removal);
  let removalPath,removalOpener,removing=false;
  removal.addEventListener('cancel',event=>{if(removing)event.preventDefault();});
  removal.addEventListener('close',()=>{api.browserCommand?.('occlude',{hidden:previewOccluded()}).catch(()=>{});(removalOpener?.isConnected?removalOpener:$('library-search')).focus();});
  removeCancel.addEventListener('click',()=>removal.close());
  removeConfirm.addEventListener('click',async()=>{
    if(removing)return;removing=true;removeConfirm.disabled=true;removeCancel.disabled=true;
    const result=await action(()=>api.removeProject(removalPath));
    removing=false;removeCancel.disabled=false;removeConfirm.disabled=false;
    if(result){signature='';render();removal.close();}else removeStatus.textContent=$('error-text').textContent || 'The project could not be removed.';
  });
  function confirmRemoval(group,button){
    removalPath=group.projectPath;removalOpener=button;removeStatus.textContent='';
    removeNotice.textContent=`Remove this project and all its chats, including archived chats, saved drafts and engine history from Mora? Your project folder and files stay on disk. (${group.projectPath})`;
    api.browserCommand?.('occlude',{hidden:true}).catch(()=>{});removal.showModal();removeCancel.focus();
  }
  const dialog=node('dialog','','chat-dialog'),heading=node('h2','Chat options'),label=node('label','Chat title'),title=node('input',''),notice=node('p',''),buttons=node('div','','chat-actions');
  title.id='chat-title';title.maxLength=120;label.htmlFor=title.id;notice.setAttribute('role','status');dialog.setAttribute('aria-labelledby','chat-options-heading');heading.id='chat-options-heading';dialog.append(heading,label,title,notice,buttons);document.body.append(dialog);
  let selectedId,opener,pending=false;
  const close=node('button','Close');close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{api.browserCommand?.('occlude',{hidden:previewOccluded()}).catch(()=>{});if(document.activeElement!==document.body && !dialog.contains(document.activeElement) && document.activeElement!==opener)return;const row=[...document.querySelectorAll('.session-row')].find(row=>row.dataset.sessionId===selectedId);(row?.querySelector('.session-options') || (opener?.isConnected?opener:$('library-search'))).focus();});
  function options(session,button) {
    selectedId=session.sessionId;opener=button;heading.textContent=session.title || 'New conversation';title.value=session.title || 'New conversation';notice.textContent='Archive keeps messages, drafts and queued work.';drawOptions();
    api.browserCommand?.('occlude',{hidden:true}).catch(()=>{});dialog.showModal();title.focus();title.select();
  }
  function drawOptions() {
    const focusedAction=buttons.contains(document.activeElement)?document.activeElement.dataset.action:null;
    const session=state.sessions?.find(item=>item.sessionId===selectedId);if(!session){dialog.close();return;}
    const running=selectedId===state.sessionId && (state.busy || state.projectOperation || state.projectRepair || state.testerActive || state.websiteActive || ['starting','ready'].includes(state.projectWork?.run?.status));
    buttons.replaceChildren();
    for(const [name,text] of [['rename','Save title'],['pin',session.pinned?'Unpin':'Pin'],[session.archived?'restore':'archive',session.archived?'Restore chat':'Archive chat']]) {
      const button=node('button',text);button.dataset.action=name;button.disabled=pending || state.loading || (name==='archive' && running);if(name==='archive' && running)button.title='Stop current work before archiving';
      button.addEventListener('click',async()=>{
        if(name==='rename' && !title.value.trim()){notice.textContent='Enter a chat title.';title.focus();return;}
        pending=true;drawOptions();
        const result=await action(()=>api.chatMetadata(selectedId,name,title.value));pending=false;
        if(result){if(selectedId===state.sessionId && ['archive','restore'].includes(name))archived=name==='archive';signature='';render();dialog.close();}else drawOptions();
      });buttons.append(button);
    }
    close.dataset.action='close';buttons.append(close);
    if(focusedAction){const target=[...buttons.children].find(button=>button.dataset.action===focusedAction);(target && !target.disabled?target:close).focus({preventScroll:true});}
  }
  title.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();buttons.firstElementChild.click();}});
  function render() {
    if(previousSession!==state.sessionId){previousSession=state.sessionId;const session=state.sessions?.find(item=>item.sessionId===state.sessionId);archived=session?.archived===true;}
    $('library-active').setAttribute('aria-pressed',String(!archived));$('library-archived').setAttribute('aria-pressed',String(archived));
    const query=$('library-search').value;$('library-clear').hidden=!query;
    const next=JSON.stringify([state.sessions,state.projects,state.sessionId,state.busy,state.loading,state.projectOperation,state.projectRepair,state.testerActive,state.websiteActive,state.projectWork?.run?.status,editing?.id,editing?.pending,sending,query,archived]);
    if(next===signature)return;signature=next;
    const focus=document.activeElement,focusRow=document.hasFocus()?focus.closest('.session-row'):null,focusId=focusRow?.dataset.sessionId,focusClass=focus.className,selection=focus.classList.contains('session-rename-input')?[focus.selectionStart,focus.selectionEnd]:null;
    for(const details of $('sessions').querySelectorAll('.project-group'))if(!query){if(details.open)collapsed.delete(details.dataset.projectPath);else collapsed.add(details.dataset.projectPath);}
    $('sessions').replaceChildren();$('general-sessions').replaceChildren();
    const groups=conversationGroups(state.sessions || [],state.projects || [],{query,archived});
    $('library-status').textContent=query?`${groups.reduce((count,group)=>count+group.sessions.length,0)} chats · title/project search`:archived?'Archived chats':'';
    const hasGeneral=groups.some(group=>group.projectPath===null&&group.sessions.length);
    $('general-label').hidden=!hasGeneral;$('general-sessions').hidden=!hasGeneral&&!query&&groups.some(group=>group.projectPath!==null);
    for(const group of groups) {
      let container=$('general-sessions');
      if(group.projectPath!==null) {
        const name=group.projectPath.split(/[\\/]/).filter(Boolean).at(-1) || group.projectPath;
        const details=node('details','','project-group');details.open=!!query || !collapsed.has(group.projectPath);details.dataset.projectPath=group.projectPath;
        const summary=node('summary','');summary.title=group.projectPath;summary.append(icon('folder'),node('span',name,'project-title'));
        const add=node('button','','project-new-chat');add.append(icon('plus'));add.setAttribute('aria-label',`New chat in ${name}`);add.title=idleReason(state)||`New chat in ${group.projectPath}`;add.disabled=!!idleReason(state) || sending;
        add.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();action(()=>api.newChat(group.projectPath));});
        summary.append(add);
        if(api.removeProject){const remove=node('button','','project-remove');remove.append(icon('x'));remove.setAttribute('aria-label',`Remove project ${name}`);remove.title='Remove project and its chats; keep source files';remove.disabled=!!(sending||state.busy||state.loading||state.projectOperation||state.projectRepair||state.testerActive||state.websiteActive||['starting','ready'].includes(state.projectWork?.run?.status));remove.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();confirmRemoval(group,remove);});summary.append(remove);}
        container=node('div','','project-chats');details.append(summary,container);$('sessions').append(details);
      }
      for(const session of group.sessions) {
        const text=session.title || 'New conversation',row=node('div','',`session-row${session.sessionId===state.sessionId?' active':''}`);row.dataset.sessionId=session.sessionId;
        const button=node('button','','session-button');button.append(icon('chat'),node('span',`${session.pinned?'★ ':''}${session.unread?'● ':''}${text}`));button.title=`${text}\n${group.projectPath || 'General chat'}`;if(session.sessionId===state.sessionId)button.setAttribute('aria-current','true');
        button.setAttribute('aria-label',`${session.unread?'Unread · ':''}${session.pinned?'Pinned · ':''}${text}`);button.disabled=!!idleReason(state) || sending;button.title=idleReason(state)||text;button.addEventListener('click',()=>action(()=>api.resumeChat(session.sessionId)));
        const menu=node('button','…','session-options');menu.setAttribute('aria-label',`Options for ${text}`);menu.setAttribute('aria-haspopup','dialog');menu.disabled=state.loading || sending;menu.addEventListener('click',()=>options(session,menu));
        const del=node('button','','session-delete-icon');del.append(icon('x'));del.setAttribute('aria-label',`Delete ${text}`);del.disabled=!!idleReason(state) || sending;del.title=idleReason(state)||(del.disabled?'Wait for the message to be saved.':'Delete this conversation');
        del.addEventListener('click',()=>{if(!del.dataset.confirm){del.dataset.confirm='1';del.classList.add('confirm');return;}action(()=>api.deleteChat(session.sessionId));});row.append(button);
        if(api.chatMetadata){
          const edit=node('button','✎','session-edit-icon');edit.setAttribute('aria-label',`Rename ${text}`);edit.title='Rename chat · Enter saves, Escape cancels';edit.disabled=!!(state.loading||sending||editing?.pending);
          edit.addEventListener('click',()=>{editing={id:session.sessionId,value:text,pending:false};signature='';render();const input=[...document.querySelectorAll('.session-row')].find(row=>row.dataset.sessionId===session.sessionId)?.querySelector('input');input?.focus();input?.select();});
          if(editing?.id===session.sessionId){
            button.hidden=true;edit.hidden=true;
            const input=node('input','','session-rename-input');input.setAttribute('aria-label','Rename chat');input.maxLength=120;input.value=editing.value;input.disabled=editing.pending;input.title='Enter saves · Escape cancels';
            input.addEventListener('input',()=>{editing.value=input.value;});
            input.addEventListener('keydown',async event=>{
              if(!['Enter','Escape'].includes(event.key)||event.isComposing)return;event.preventDefault();event.stopPropagation();
              if(editing.pending)return;
              if(event.key==='Enter'){editing.pending=true;render();const result=await action(()=>api.chatMetadata(session.sessionId,'rename',editing.value));if(!result){editing.pending=false;signature='';render();return;}}
              editing=null;signature='';render();[...document.querySelectorAll('.session-row')].find(row=>row.dataset.sessionId===session.sessionId)?.querySelector('.session-edit-icon')?.focus();
            });row.append(input);
          }
          row.append(edit);
        }
        row.append(menu,del);container.append(row);
      }
      if(!group.sessions.length)container.append(node('div',group.projectPath===null?'Ask anything with New conversation.':'Start a chat with +','empty-history'));
    }
    if(!groups.length)$('general-sessions').append(node('div',query?'No matching chats or projects.':archived?'No archived chats.':'No chats yet.','empty-history'));
    if(!$('sessions').children.length && !archived && !query)$('sessions').append(node('div','Add a folder to start a project.','empty-history'));
    if(focusId){const row=[...document.querySelectorAll('.session-row')].find(row=>row.dataset.sessionId===focusId),target=row?.getElementsByClassName(focusClass)[0];(target || $('library-search')).focus({preventScroll:true});if(selection&&target?.setSelectionRange)target.setSelectionRange(...selection);}
    if(dialog.open)drawOptions();
  }
  const historySearch=node('button','Search message history');historySearch.type='button';historySearch.className='library-history-search';historySearch.addEventListener('click',()=>{$('context-tools')?.click();const query=document.querySelector('.context-dialog input[type="search"]');if(query){query.value=$('library-search').value;query.dispatchEvent(new Event('input'));}});$('library-status').after(historySearch);
  $('library-search').addEventListener('input',render);$('library-clear').addEventListener('click',()=>{$('library-search').value='';render();$('library-search').focus();});
  for(const [id,value] of [['library-active',false],['library-archived',true]])$(id).addEventListener('click',()=>{archived=value;render();});
  return (next,isSending)=>{state=next;sending=isSending;render();};
}
