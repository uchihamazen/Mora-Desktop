import {summarizeUsage} from './usage.js';
import {previewOccluded} from './menu-ui.js';

export function setupUsage(api){
  const button=document.getElementById('usage-button'),popover=document.getElementById('usage-popover'),body=document.getElementById('usage-body'),summary=document.getElementById('usage-summary');
  if(!api.usageCommand){button.hidden=true;return;}
  let data,error='',loading=false;
  const node=(tag,text,className)=>{const item=document.createElement(tag);item.textContent=text;if(className)item.className=className;return item;};
  function render(){
    body.replaceChildren();
    if(loading)body.append(node('p','Checking usage…','usage-status'));
    if(error)body.append(node('p',error,'usage-error'));
    if(data)for(const [label,block] of [[data.windowLabel,data.window],['Weekly',data.weekly]]){
      const row=node('div','','usage-row'),head=node('div','','usage-head');head.append(node('strong',label),node('small',block?`${block.remaining}% left · resets in ${block.resetsIn}`:'Unavailable'));row.append(head);
      if(block){const track=node('div','','usage-track'),fill=node('span','','usage-fill');fill.style.width=`${block.barPercent}%`;track.append(fill);row.append(track);}body.append(row);
    }
    if(data?.overQuota)body.append(node('p','Over quota: wait for the reset.','usage-error'));
    const meta=node('div','','usage-meta');meta.append(node('small',data?`${error?'Last successful check':'Updated'} ${new Date(data.observedAtMs).toLocaleTimeString()} · plan ${data.tier||'unknown'}`:'Each check sends one small model request.'));
    const refresh=node('button',data||error?'Refresh':'Check now');refresh.id='usage-refresh';refresh.disabled=loading;refresh.addEventListener('click',check);meta.append(refresh);body.append(meta);
    summary.textContent=data?`${error?'Stale · ':''}${data.window?.remaining??'–'}% · ${data.weekly?.remaining??'–'}%`:error?'Unavailable':'Not checked';
  }
  async function check(){
    if(loading)return;loading=true;error='';render();
    try{data=summarizeUsage(await api.usageCommand());}catch(e){error=(e.message||String(e)).replace(/^Error invoking remote method '[^']+': Error: /,'');}
    finally{loading=false;render();}
  }
  popover.addEventListener('toggle',event=>{
    const open=event.newState==='open';button.setAttribute('aria-expanded',String(open));
    api.browserCommand?.('occlude',{hidden:previewOccluded()}).catch(()=>{});
    if(open){const rect=button.getBoundingClientRect();popover.style.left=`${Math.min(rect.left,Math.max(8,innerWidth-360))}px`;popover.style.bottom=`${innerHeight-rect.top+8}px`;if(!data&&!error&&!loading)check();}
  });
  render();
}
