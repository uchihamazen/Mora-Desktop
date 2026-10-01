export function setupBrowser(api,addCapture) {
  const $=id=>document.getElementById(id);
  if(!api.browserCommand){$('browser-button').disabled=true;return;}
  let state={open:false},capturing=false,resizeFrame,expanded=false;
  function expand(value){expanded=value;document.body.classList.toggle('browser-expanded',expanded);$('browser-expand').textContent=expanded ? 'Back to chat' : 'Expand';$('browser-expand').setAttribute('aria-label',expanded ? 'Back to chat' : 'Expand browser');$('browser-expand').setAttribute('aria-pressed',String(expanded));bounds();}
  function bounds() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame=requestAnimationFrame(()=>{
      if(!state.open)return;
      const rect=$('browser-viewport').getBoundingClientRect();
      api.browserCommand('bounds',{x:rect.x,y:rect.y,width:rect.width,height:rect.height}).catch(showError);
    });
  }
  function showError(error){$('browser-error').textContent=error.message || String(error);$('browser-error').hidden=false;}
  function update(next) {
    state=next;$('browser-panel').hidden=!state.open;document.body.classList.toggle('browser-open',state.open);
    if(!state.open && expanded)expand(false);
    for(const mode of ['desktop','mobile']){const button=$(`browser-${mode}`);button.setAttribute('aria-pressed',String((state.deviceMode || 'desktop')===mode));button.disabled=state.loading || state.deviceReady===false;}
    $('browser-size').textContent=state.deviceMode==='mobile' ? '390px' : '1280px+';
    $('browser-button').setAttribute('aria-pressed',String(state.open));
    if(document.activeElement!==$('browser-url'))$('browser-url').value=state.url || '';
    $('browser-title').textContent=state.loading ? 'Loading…' : state.title || 'Open a page to annotate its design';
    $('browser-back').disabled=!state.canBack;$('browser-forward').disabled=!state.canForward;
    $('browser-reload').disabled=!state.url;
    for(const id of ['browser-annotate','browser-region'])$(id).disabled=state.loading || !/^https?:/.test(state.url || '');
    $('browser-cancel').disabled=!state.annotating && !state.selection;
    $('browser-selection').textContent=state.selection ? `${state.selection.mode==='region' ? 'Region · ' : ''}${state.selection.selector}` : state.annotating ? 'Select on the page. Escape cancels.' : 'Choose an element or drag a region.';
    $('browser-add').disabled=capturing || !state.selection || state.loading;
    $('browser-error').textContent=state.error || '';$('browser-error').hidden=!state.error;
    if(state.open)bounds();
  }
  async function command(action,payload) {
    try {const next=await api.browserCommand(action,payload);if(next?.open!==undefined)update(next);return next;}
    catch(error){showError(error);}
  }
  $('browser-button').addEventListener('click',()=>command(state.open ? 'close' : 'open'));
  $('browser-close').addEventListener('click',()=>command('close'));
  $('browser-expand').addEventListener('click',()=>expand(!expanded));
  for(const mode of ['desktop','mobile'])$(`browser-${mode}`).addEventListener('click',()=>command('device',{mode}));
  $('browser-address').addEventListener('submit',event=>{event.preventDefault();command('navigate',{url:$('browser-url').value});});
  for(const action of ['back','forward','reload'])$(`browser-${action}`).addEventListener('click',()=>command(action));
  $('browser-annotate').addEventListener('click',()=>command('annotate',{mode:'element'}));
  $('browser-region').addEventListener('click',()=>command('annotate',{mode:'region'}));
  $('browser-cancel').addEventListener('click',()=>command('cancel'));
  $('browser-add').addEventListener('click',async()=>{
    if(capturing)return;capturing=true;$('browser-add').disabled=true;
    try {const capture=await api.browserCommand('capture');if(expanded)expand(false);addCapture(capture);$('prompt').focus();}
    catch(error){showError(error);}finally{capturing=false;$('browser-add').disabled=!state.selection;}
  });
  new ResizeObserver(bounds).observe($('browser-viewport'));
  window.addEventListener('resize',bounds);
  api.onEvent(event=>{if(event.type==='browser')update(event.state);});
  api.browserCommand('state').then(update).catch(showError);
}
