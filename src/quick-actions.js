import {focusMenuControl,previewOccluded} from './menu-ui.js';
export function setupQuickActions(api,{find,sidebar}) {
  const $=id=>document.getElementById(id),make=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
  const commands=[
    {label:'New conversation',id:'new-chat',key:'n',shortcut:'Ctrl+N'},
    {label:'Search chats and projects',run:()=>{sidebar(false);$('library-search').focus();},key:'f',shift:true,shortcut:'Ctrl+Shift+F'},
    {label:'Find in current conversation',run:()=>find.open(),key:'f',shortcut:'Ctrl+F'},
    {label:'Toggle navigation',id:'sidebar-toggle',key:'b',shortcut:'Ctrl+B'},
    {label:'Create a project',id:'create-project'}, {label:'Open a project',id:'workspace-button'},
    {label:'Run my app',id:'run-project'}, {label:'Test my app',id:'test-project'},
    {label:'Stop Muse request',id:'stop-button'}, {label:'Open or close browser',id:'browser-button'},
    {label:'Website tester',id:'website-tester'}, {label:'Project checkpoints',id:'checkpoints'},
    {label:'Engine settings',id:'settings-button'},
  ];
  const dialog=make('dialog','');dialog.className='quick-dialog';dialog.setAttribute('aria-labelledby','quick-heading');
  const heading=make('h2','Quick actions and shortcuts');heading.id='quick-heading';const input=make('input','');input.type='search';input.setAttribute('aria-label','Search quick actions');input.placeholder='Search actions…';
  const list=make('div',''),hint=make('p','Ctrl+K opens this menu. Enter selects; Tab or arrows move.'),close=make('button','Close');dialog.append(heading,input,hint,list,close);document.body.append(dialog);let returnFocus;
  function available(command){return !command.id || (!$(command.id).disabled && (!['run-project','test-project','stop-button','checkpoints'].includes(command.id) || !$(command.id).closest('[hidden]')));}
  function run(command){if(!available(command))return;dialog.close();if(document.body.classList.contains('browser-expanded') && !['browser-button','website-tester'].includes(command.id))$('browser-expand').click();command.run?command.run():$(command.id).click();}
  function draw(){const focus=document.activeElement?.dataset.command;list.replaceChildren();const query=input.value.trim().toLowerCase();for(const command of commands.filter(command=>command.label.toLowerCase().includes(query))){const button=make('button',command.label);button.dataset.command=command.label;button.disabled=!available(command);if(command.shortcut)button.append(make('kbd',command.shortcut));button.addEventListener('click',()=>run(command));list.append(button);}if(!list.children.length)list.append(make('p','No matching actions.'));if(focus){const button=[...list.children].find(node=>node.dataset.command===focus);if(button && !button.disabled)button.focus({preventScroll:true});else input.focus();}}
  function open(){if(dialog.open){input.focus();return;}returnFocus=document.activeElement;draw();api.browserCommand?.('occlude',{hidden:true}).catch(()=>{});dialog.showModal();input.focus();}
  input.addEventListener('input',draw);input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();list.querySelector('button:not(:disabled)')?.click();}});
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();dialog.close();}else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const buttons=[...list.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}});
  close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{api.browserCommand?.('occlude',{hidden:previewOccluded()}).catch(()=>{});if(document.activeElement===document.body || dialog.contains(document.activeElement)){const target=returnFocus?.isConnected && returnFocus.checkVisibility()?returnFocus:$('quick-actions');target.checkVisibility()?target.focus():focusMenuControl(target);}});
  $('quick-actions').addEventListener('click',open);
  document.addEventListener('keydown',event=>{if(!event.ctrlKey || event.altKey || event.isComposing || document.querySelector('dialog[open]'))return;const key=event.key.toLowerCase();if(key==='k' && !event.shiftKey){event.preventDefault();open();return;}const command=commands.find(command=>command.key===key && !!command.shift===event.shiftKey);if(command){event.preventDefault();run(command);}});
  return ()=>{if(dialog.open)draw();};
}
