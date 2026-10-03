export function previewOccluded() {
  return !!document.querySelector('[data-workspace-menu][open],dialog[open],[popover]:popover-open,.changes-panel,.browser-resizing');
}

// Details menus retain the original controls and their command guards.
export function setupWorkspaceMenus(api) {
  const menus=[...document.querySelectorAll('[data-workspace-menu]')];
  const trigger=menu=>menu.querySelector('summary');
  function updatePreview(){api.browserCommand?.('occlude',{hidden:previewOccluded()}).catch(()=>{});}
  function close(menu,restore=false){menu.open=false;if(restore)trigger(menu).focus();}
  for(const menu of menus){
    trigger(menu).setAttribute('aria-expanded','false');
    menu.addEventListener('toggle',()=>{
      trigger(menu).setAttribute('aria-expanded',String(menu.open));
      if(menu.open)for(const other of menus)if(other!==menu)close(other);
      updatePreview();
    });
    menu.addEventListener('click',event=>{
      if(!event.target.closest('.menu-content button'))return;
      const restore=menu.contains(document.activeElement);close(menu,restore);updatePreview();
    });
    menu.addEventListener('change',()=>{close(menu,true);updatePreview();});
    menu.addEventListener('focusout',event=>{if(!menu.contains(event.relatedTarget)){close(menu);updatePreview();}});
  }
  document.addEventListener('pointerdown',event=>{for(const menu of menus)if(menu.open&&!menu.contains(event.target))close(menu);});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||document.querySelector('dialog[open]'))return;
    const menu=menus.find(value=>value.open);if(menu){event.preventDefault();close(menu,true);updatePreview();}
  });
}

export function focusMenuControl(control) {
  (control.closest('[data-workspace-menu]')?.querySelector('summary') || control).focus();
}
