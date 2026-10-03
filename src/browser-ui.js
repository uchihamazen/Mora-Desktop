import {previewOccluded} from './menu-ui.js';
export function setupBrowser(api,addCapture) {
  const $=id=>document.getElementById(id);
  if(!api.browserCommand){$('browser-button').disabled=true;return;}
  let state={open:false},capturing=false,resizeFrame,expanded=false;
  const divider=$('browser-resizer');let preferredWidth=null,drag=null;
  try {const saved=Number(localStorage.getItem('mora.browserWidth'));if(Number.isFinite(saved)&&saved>=390)preferredWidth=saved;}catch{}
  function fitWidth(){
    divider.hidden=!state.open||expanded;if(!state.open||expanded)return;
    const available=document.documentElement.clientWidth-$('navigation-sidebar').getBoundingClientRect().width-8,max=Math.max(390,available-400);
    const width=Math.round(Math.max(390,Math.min(max,preferredWidth??Math.min(innerWidth*.38,620))));
    $('browser-panel').style.setProperty('--browser-width',width+'px');divider.setAttribute('aria-valuemax',String(Math.floor(max)));divider.setAttribute('aria-valuenow',String(width));divider.setAttribute('aria-valuetext',width+' pixels');
    return width;
  }
  function saveWidth(){try{if(preferredWidth===null)localStorage.removeItem('mora.browserWidth');else localStorage.setItem('mora.browserWidth',String(preferredWidth));}catch{}}
  function finishResize(commit){
    if(!drag)return;const previous=drag;drag=null;
    if(!commit)preferredWidth=previous.preferred;else preferredWidth=fitWidth();
    if(divider.hasPointerCapture(previous.id))divider.releasePointerCapture(previous.id);
    document.body.classList.remove('browser-resizing');fitWidth();bounds();if(commit)saveWidth();
    api.browserCommand('occlude',{hidden:previewOccluded()}).catch(showError);
  }
  divider.addEventListener('pointerdown',event=>{
    if(event.button!==0||drag||!state.open||expanded)return;event.preventDefault();divider.focus({preventScroll:true});
    drag={id:event.pointerId,x:event.clientX,width:fitWidth(),preferred:preferredWidth};divider.setPointerCapture(event.pointerId);document.body.classList.add('browser-resizing');
    // Native web contents sit above the DOM; hide them briefly so dragging across
    // the preview cannot steal the pointer from the divider.
    api.browserCommand('occlude',{hidden:true}).catch(showError);
  });
  divider.addEventListener('pointermove',event=>{if(drag?.id!==event.pointerId)return;preferredWidth=drag.width+drag.x-event.clientX;preferredWidth=fitWidth();bounds();});
  divider.addEventListener('pointerup',()=>finishResize(true));
  for(const event of ['pointercancel','lostpointercapture'])divider.addEventListener(event,()=>finishResize(false));
  window.addEventListener('blur',()=>finishResize(false));
  document.addEventListener('keydown',event=>{if(drag&&event.key==='Escape'){event.preventDefault();finishResize(false);}});
  divider.addEventListener('keydown',event=>{
    if(drag||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
    const width=fitWidth();preferredWidth=event.key==='Home'?390:event.key==='End'?Number(divider.getAttribute('aria-valuemax')):width+(event.key==='ArrowLeft'?1:-1)*(event.shiftKey?80:20);preferredWidth=fitWidth();saveWidth();bounds();
  });
  divider.addEventListener('dblclick',()=>{preferredWidth=null;saveWidth();fitWidth();bounds();});
  function expand(value){finishResize(false);expanded=value;document.body.classList.toggle('browser-expanded',expanded);$('browser-expand').textContent=expanded ? 'Back to chat' : 'Expand';$('browser-expand').setAttribute('aria-label',expanded ? 'Back to chat' : 'Expand browser');$('browser-expand').setAttribute('aria-pressed',String(expanded));fitWidth();bounds();}
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
    if(!state.open)finishResize(false);fitWidth();
    if(!state.open && expanded)expand(false);
    for(const mode of ['desktop','mobile']){const button=$(`browser-${mode}`);button.setAttribute('aria-pressed',String((state.deviceMode || 'desktop')===mode));button.disabled=state.loading || state.deviceReady===false;}
    $('browser-size').textContent=state.deviceMode==='mobile' ? '390px' : '1280px+';
    $('browser-button').setAttribute('aria-pressed',String(state.open));
    if(document.activeElement!==$('browser-url'))$('browser-url').value=state.url || '';
    $('browser-title').textContent=state.loading ? 'Loading…' : state.title || 'Open a page to annotate its design';
    const tabSignature=JSON.stringify([state.tabs,state.activeTabId]);
    if($('browser-tabs').dataset.signature!==tabSignature){const focused=document.activeElement?.dataset.tabId,focusedAction=document.activeElement?.dataset.tabAction;$('browser-tabs').dataset.signature=tabSignature;$('browser-tabs').replaceChildren();for(const tab of state.tabs || []){const row=document.createElement('span'),button=document.createElement('button'),close=document.createElement('button');button.textContent=tab.title || tab.url || 'New tab';button.title=tab.url || 'New tab';button.dataset.tabId=tab.id;button.setAttribute('aria-pressed',String(tab.id===state.activeTabId));button.addEventListener('click',()=>command('tab-select',{id:tab.id}));close.textContent='×';close.dataset.tabId=tab.id;close.dataset.tabAction='close';close.setAttribute('aria-label',`Close tab ${tab.title || tab.url || 'New tab'}`);close.addEventListener('click',()=>command('tab-close',{id:tab.id}));row.append(button,close);$('browser-tabs').append(row);}if(focused && document.hasFocus())([...$('browser-tabs').querySelectorAll('button')].find(button=>button.dataset.tabId===focused && button.dataset.tabAction===focusedAction) || [...$('browser-tabs').querySelectorAll('button')].find(button=>button.dataset.tabId===state.activeTabId && !button.dataset.tabAction) || $('browser-new-tab')).focus({preventScroll:true});}
    $('browser-new-tab').disabled=(state.tabs || []).length>=8;
    const tabsFocused=$('browser-tabs').contains(document.activeElement);
    $('browser-tabs-bar').hidden=(state.tabs || []).length<2;
    if($('browser-tabs-bar').hidden&&tabsFocused)$('browser-url').focus({preventScroll:true});
    const history=$('browser-history'),entries=state.history?.entries || [],historySignature=JSON.stringify(entries);if(history.dataset.signature!==historySignature){history.dataset.signature=historySignature;history.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose a visited page';history.append(placeholder);entries.forEach((entry,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=entry.title || entry.url;option.title=entry.url;history.append(option);});}history.value='';history.disabled=state.loading || !entries.length;
    $('browser-back').disabled=!state.canBack;$('browser-forward').disabled=!state.canForward;
    $('browser-reload').disabled=!state.url;
    for(const id of ['browser-annotate','browser-region'])$(id).disabled=state.loading || !/^https?:/.test(state.url || '');
    $('browser-cancel').disabled=!state.annotating && !state.selection;
    $('browser-selection').textContent=state.selection ? `${state.selection.mode==='region' ? 'Region · ' : ''}${state.selection.selector}` : state.annotating ? 'Select on the page. Escape cancels.' : 'Select part of the preview to describe a change.';
    $('browser-add').hidden=!state.selection;
    $('browser-add').disabled=capturing || !state.selection || state.loading;
    $('browser-before').disabled=capturing || state.loading || !state.deviceReady || !/^https?:/.test(state.url || '');
    $('browser-after').disabled=$('browser-before').disabled || !state.hasComparisonBefore;
    $('browser-error').textContent=state.error || '';$('browser-error').hidden=!state.error;
    if(state.open)bounds();
  }
  async function command(action,payload) {
    try {const next=await api.browserCommand(action,payload);if(next?.open!==undefined)update(next);return next;}
    catch(error){showError(error);}
  }
  $('browser-button').addEventListener('click',()=>command(state.open ? 'close' : 'open'));
  $('browser-close').addEventListener('click',()=>command('close'));
  $('browser-new-tab').addEventListener('click',()=>command('tab-new'));
  $('browser-history').addEventListener('change',()=>{if($('browser-history').value!=='')command('history-go',{index:Number($('browser-history').value)});});
  $('browser-expand').addEventListener('click',()=>expand(!expanded));
  for(const mode of ['desktop','mobile'])$(`browser-${mode}`).addEventListener('click',()=>command('device',{mode}));
  $('browser-address').addEventListener('submit',event=>{event.preventDefault();command('navigate',{url:$('browser-url').value});});
  for(const action of ['back','forward','reload'])$(`browser-${action}`).addEventListener('click',()=>command(action));
  $('browser-annotate').addEventListener('click',()=>command('annotate',{mode:'element'}));
  $('browser-region').addEventListener('click',()=>command('annotate',{mode:'region'}));
  $('browser-cancel').addEventListener('click',()=>command('cancel'));
  $('browser-before').addEventListener('click',()=>command('compare-before'));
  $('browser-after').addEventListener('click',async()=>{
    if(capturing)return;capturing=true;$('browser-after').disabled=true;
    try {
      const comparison=await api.browserCommand('compare-after'),viewer=document.createElement('dialog');viewer.className='comparison-viewer image-viewer';
      const heading=document.createElement('h2');heading.textContent='Visual comparison';
      const note=document.createElement('p');note.textContent='This shows the captured appearance. It does not verify functionality or tests.';
      const close=document.createElement('button');close.textContent='Close comparison';close.className='image-viewer-close';close.setAttribute('aria-label','Close comparison');close.addEventListener('click',()=>viewer.close());
      viewer.append(close,heading,note);const grid=document.createElement('div');grid.className='comparison-grid';
      for(const [label,capture] of [['Before',comparison.before],['After',comparison.after]]){const figure=document.createElement('figure'),caption=document.createElement('figcaption'),image=document.createElement('img');caption.textContent=label+' · '+new Date(capture.capturedAt).toLocaleTimeString()+' · '+capture.source.device+' · '+capture.source.url;image.alt=label+' preview';image.src='data:'+capture.mediaType+';base64,'+capture.base64Data;figure.append(caption,image);grid.append(figure);}viewer.append(grid);
      viewer.addEventListener('close',()=>{viewer.remove();api.browserCommand('occlude',{hidden:previewOccluded()}).catch(showError);});
      document.body.append(viewer);await api.browserCommand('occlude',{hidden:true});viewer.showModal();close.focus();
    }catch(error){showError(error);}finally{capturing=false;$('browser-after').disabled=!state.hasComparisonBefore;}
  });
  $('browser-add').addEventListener('click',async()=>{
    if(capturing)return;capturing=true;$('browser-add').disabled=true;
    try {const capture=await api.browserCommand('capture');if(expanded)expand(false);addCapture(capture);$('prompt').focus();}
    catch(error){showError(error);}finally{capturing=false;$('browser-add').disabled=!state.selection;}
  });
  new ResizeObserver(bounds).observe($('browser-viewport'));
  const layoutObserver=new ResizeObserver(()=>{fitWidth();bounds();});layoutObserver.observe(document.body);layoutObserver.observe($('navigation-sidebar'));
  window.addEventListener('resize',bounds);
  api.onEvent(event=>{if(event.type==='browser')update(event.state);});
  api.browserCommand('state').then(update).catch(showError);
}
