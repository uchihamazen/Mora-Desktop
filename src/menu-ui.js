export function previewOccluded() {
  return !!document.querySelector('[data-workspace-menu][open],dialog[open],[popover]:popover-open,.changes-panel,.browser-resizing');
}

// Details menus retain the original controls and their command guards.
export function setupWorkspaceMenus(api) {
  const menus=[...document.querySelectorAll('[data-workspace-menu]')];
  const trigger=menu=>menu.querySelector('summary');
  function updatePreview(){api.browserCommand?.('occlude',{hidden:previewOccluded()}).catch(()=>{});}
  function close(menu,restore=false){for(const popup of menu.querySelectorAll('[popover]:popover-open'))popup.hidePopover();menu.open=false;if(restore)trigger(menu).focus();}
  for(const menu of menus){
    trigger(menu).setAttribute('aria-expanded','false');
    menu.addEventListener('toggle',()=>{
      trigger(menu).setAttribute('aria-expanded',String(menu.open));
      if(menu.open){for(const other of menus)if(other!==menu)close(other);}else close(menu);
      updatePreview();
    });
    menu.addEventListener('click',event=>{
      if(!event.target.closest('.menu-content button') || event.target.closest('.select-trigger'))return;
      const restore=menu.contains(document.activeElement);close(menu,restore);updatePreview();
    });
    menu.addEventListener('change',()=>{close(menu,true);updatePreview();});
    menu.addEventListener('focusout',event=>{if(!menu.contains(event.relatedTarget)){close(menu);updatePreview();}});
  }
  document.addEventListener('pointerdown',event=>{for(const menu of menus)if(menu.open&&!menu.contains(event.target))close(menu);});
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.key!=='Escape'||document.querySelector('dialog[open]'))return;
    const menu=menus.find(value=>value.open);if(menu){event.preventDefault();close(menu,true);updatePreview();}
  });
}

export function focusMenuControl(control) {
  (control.closest('[data-workspace-menu]')?.querySelector('summary') || control).focus();
}

// Keep native option values and change handlers behind a shared styled picker.
export function setupSelectMenus(api) {
  const records=new Map();let serial=0;
  const descriptions={readonly:'Inspect files without making changes.',full:'Allow file edits and commands.'};
  function occlude(){api.browserCommand?.('occlude',{hidden:previewOccluded()}).catch(()=>{});}
  function sync(record){
    const {select,trigger,menu}=record;
    trigger.hidden=select.hidden;trigger.disabled=select.disabled;trigger.title=select.title;
    trigger.firstChild.textContent=select.selectedOptions[0]?.textContent || 'Choose';
    const options=[...select.options],signature=JSON.stringify(options.map(option=>[option.value,option.textContent,option.disabled]));
    if(record.signature!==signature){
      record.signature=signature;menu.querySelectorAll('button').forEach(button=>button.remove());
      for(const option of options){
        const button=document.createElement('button');button.type='button';button.dataset.value=option.value;button.setAttribute('role','menuitemradio');
        const symbol=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href',select.id==='execution-mode'?(option.value==='full'?'#i-terminal':'#i-copy'):'#i-settings');symbol.setAttribute('aria-hidden','true');symbol.append(use);
        const text=document.createElement('span'),title=document.createElement('strong');title.textContent=option.textContent;text.append(title);
        const description=select.id==='execution-mode'?descriptions[option.value]:select.id==='model'?option.value:'';
        if(description){const detail=document.createElement('small');detail.textContent=description;text.append(detail);}
        const check=document.createElement('span');check.className='mode-check';check.setAttribute('aria-hidden','true');check.textContent='✓';button.append(symbol,text,check);menu.append(button);
        button.addEventListener('click',()=>{if(select.disabled||option.disabled)return;select.value=option.value;menu.hidePopover();trigger.focus();select.dispatchEvent(new Event('change',{bubbles:true}));sync(record);});
      }
    }
    for(const [index,button] of [...menu.querySelectorAll('button')].entries()){button.disabled=select.disabled||options[index].disabled;button.setAttribute('aria-checked',String(options[index].selected));}
    if((select.hidden||select.disabled)&&menu.matches(':popover-open'))menu.hidePopover();
  }
  function scan(){
    for(const [select,record] of records)if(!select.isConnected){record.observer.disconnect();record.trigger.remove();record.menu.remove();records.delete(select);}
    for(const select of document.querySelectorAll('select')){
      if(records.has(select))continue;
      const label=select.getAttribute('aria-label') || select.labels?.[0]?.textContent.trim() || 'Choose';
      const trigger=document.createElement('button');trigger.type='button';trigger.className='select-trigger';trigger.id=(select.id || 'select-'+(++serial))+'-trigger';trigger.setAttribute('aria-label',label);trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');
      const title=document.createElement('span'),arrow=document.createElement('span');arrow.textContent='⌄';arrow.setAttribute('aria-hidden','true');trigger.append(title,arrow);
      const menu=document.createElement('div');menu.id=(select.id || trigger.id)+'-menu';menu.className='select-menu';menu.setAttribute('popover','auto');menu.setAttribute('role','menu');menu.setAttribute('aria-label',label+' options');trigger.setAttribute('aria-controls',menu.id);
      trigger.setAttribute('popovertarget',menu.id);
      const heading=document.createElement('div');heading.className='mode-menu-heading';heading.textContent=label;menu.append(heading);
      select.classList.add('mode-native');select.tabIndex=-1;select.setAttribute('aria-hidden','true');select.before(trigger);(select.closest('dialog,[data-workspace-menu]') || document.body).append(menu);
      const record={select,trigger,menu};records.set(select,record);
      record.observer=new MutationObserver(()=>sync(record));record.observer.observe(select,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','hidden','title','selected']});
      select.addEventListener('change',()=>sync(record));
      trigger.addEventListener('click',event=>{
        event.preventDefault();
        if(menu.matches(':popover-open')){menu.hidePopover();return;}sync(record);if(select.disabled)return;
        const rect=trigger.getBoundingClientRect(),up=rect.top>innerHeight/2;
        menu.style.left=Math.max(8,Math.min(rect.right-300,innerWidth-308))+'px';menu.style.top=up?'auto':rect.bottom+8+'px';menu.style.bottom=up?innerHeight-rect.top+8+'px':'auto';menu.style.maxHeight=Math.max(60,(up?rect.top:innerHeight-rect.bottom)-24)+'px';
        menu.showPopover();(menu.querySelector('[aria-checked=true]:not(:disabled)') || menu.querySelector('button:not(:disabled)'))?.focus();
      });
      menu.addEventListener('keydown',event=>{
        const choices=[...menu.querySelectorAll('button:not(:disabled)')],index=choices.indexOf(document.activeElement);
        if(choices.length&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();choices[event.key==='Home'?0:event.key==='End'?choices.length-1:(index+(event.key==='ArrowUp'?-1:1)+choices.length)%choices.length].focus();}
        if(event.key==='Escape'){event.preventDefault();menu.hidePopover();trigger.focus();}
      });
      menu.addEventListener('toggle',()=>{trigger.setAttribute('aria-expanded',String(menu.matches(':popover-open')));occlude();});
      sync(record);
    }
  }
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('resize',()=>{for(const {menu} of records.values())menu.hidePopover();});
  scan();return ()=>{scan();for(const record of records.values())sync(record);};
}
