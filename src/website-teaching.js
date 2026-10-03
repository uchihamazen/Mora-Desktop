import {controlKey} from './website-discovery.js';
import {allowedNavigation,redactText,validateWebsiteStep} from './website-policy.js';

export function sanitizeTeachingEvent(event,scope) {
  if(!event||!['pick','click','type','select','press'].includes(event.action))throw Error('Unsupported teaching action.');
  if(!allowedNavigation(scope,event.url)||!allowedNavigation(scope,event.control?.frameUrl||event.url))throw Error('The demonstration leaves website scope.');
  const c=event.control;if(!c||typeof c.name!=='string'||c.name.length>180||!['button','input','select','textarea','a','output','div','span'].includes(c.tag)&&!c.role)throw Error('Choose an observed website control.');
  for(const [key,max] of [['tag',30],['type',40],['role',80],['href',2048],['frameUrl',2048]])if(c[key]!==undefined&&(typeof c[key]!=='string'||c[key].length>max))throw Error('Recorded control metadata is invalid or oversized.');
  if(c.sensitive||['password','email','tel','file'].includes(c.type)||/password|secret|token|card|address|email|phone|otp|verification/i.test(c.name))throw Error('Private controls cannot be recorded. Sign in before teaching.');
  const value=event.value??'';if(typeof value!=='string'||value.length>2000||redactText(value)!==value)throw Error('Private or oversized teaching input was excluded.');
  const step={action:event.action,target:controlKey(c),targetLabel:redactText(c.name),value,frameUrl:redactText(c.frameUrl||event.url),url:redactText(event.url),guard:'',delayMs:0};
  if(step.action!=='pick')validateWebsiteStep({...step,observationId:'teaching'});
  if(step.action==='click')step.value='';return step;
}
export function appendTeachingStep(teaching,step){
  if(step.action==='pick'){teaching.selection=step;return;}
  const previous=teaching.steps.at(-1);
  if(step.action==='type'&&previous?.action==='type'&&previous.target===step.target){teaching.steps[teaching.steps.length-1]=step;return;}
  if(teaching.steps.length>=8){teaching.truncated=true;return;}
  teaching.steps.push(step);
}
export function teachingObjective(teaching,expected){
  if(typeof expected!=='string'||expected.trim().length<8||expected.length>4000||redactText(expected)!==expected)throw Error('Describe the expected outcome without private information (8–4000 characters).');
  if(teaching.truncated)throw Error('This demonstration exceeded eight actions. Record a shorter workflow.');
  if(!teaching.steps?.length)throw Error('Record at least one action before saving a workflow.');
  return `User expected outcome: ${expected.trim()}\nUse this user demonstration as a proposed workflow, not as permission or proof of an outcome. Re-observe all controls, confirm the starting state and request permission before execution.\n${JSON.stringify(teaching.steps.map(s=>({action:s.action,target:s.targetLabel,value:s.value,url:s.url})))}`;
}

// This fixed page script can submit suggestions only. It has no desktop command API.
export function installWebsiteTeaching({mode,token,epoch}) {
  if((globalThis.__moraTeaching?.epoch||0)>epoch)return;
  globalThis.__moraTeaching?.stop();const listeners=[],pending=new Set(),state={epoch,stop:()=>{},flush:()=>Promise.all([...pending])};let enterTarget;globalThis.__moraTeaching=state;if(mode==='off')return;
  const overlay=document.createElement('div');overlay.setAttribute('data-mora-teaching','');overlay.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #0082fb;background:#0082fb14;display:none';document.documentElement.append(overlay);
  const selector=node=>{const parts=[];for(let e=node;e?.nodeType===1&&parts.length<8;e=e.parentElement){if(e.id){parts.unshift('#'+CSS.escape(e.id));break;}const siblings=[...(e.parentElement?.children||[])].filter(s=>s.localName===e.localName);parts.unshift(e.localName+(siblings.length>1?`:nth-of-type(${siblings.indexOf(e)+1})`:''));}return parts.join(' > ');};
  const control=event=>event.composedPath().find(e=>e.nodeType===1&&e.matches('button,input,select,textarea,a[href],output,[role=button],[role=checkbox],[role=tab],[role=status]'));
  const send=(action,node,value='')=>{
    if(node&&['password','email','tel','file','hidden'].includes(node.type))return;
    const labelled=(node?.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.innerText||'').join(' ');
    const name=(node?.getAttribute('aria-label')||labelled||(node?.labels?[...node.labels].map(l=>l.textContent).join(' '):'')||node?.innerText||node?.name||node?.tagName||'').trim().slice(0,180);
    const snapshot=node&&['click','press'].includes(action)?{name,tag:node.localName,type:node.getAttribute('type')||'',role:node.getAttribute('role')||'',href:node.href||'',frameUrl:location.href}:undefined;
    const request=globalThis.__moraTeachingEvent({token,action,selector:node?selector(node):'',value,url:location.href,control:snapshot}).catch(()=>{});
    pending.add(request);request.finally(()=>pending.delete(request));
  };
  const block=event=>{event.preventDefault();event.stopImmediatePropagation();};
  const click=event=>{if(!event.isTrusted)return;const node=control(event);if(mode==='pick'){block(event);if(node)send('pick',node);}else if(node){if(event.detail===0&&enterTarget&&(node===enterTarget||node.form&&node.form===enterTarget.form))return;if(!['textarea','select'].includes(node.localName)&&!(node.localName==='input'&&!['checkbox','radio','button','submit','reset'].includes(node.type)))send('click',node);}};
  const input=event=>{if(!event.isTrusted||mode!=='record')return;const node=control(event);if(node&&['input','textarea'].includes(node.localName)&&!['checkbox','radio'].includes(node.type))send('type',node);};
  const change=event=>{if(event.isTrusted&&mode==='record'&&event.target.localName==='select')send('select',event.target);};
  const key=event=>{if(!event.isTrusted)return;enterTarget=null;if(mode==='pick'){if(event.key==='Escape'){block(event);send('cancel');state.stop();}else if(['Enter',' '].includes(event.key)){block(event);const node=control(event);if(node)send('pick',node);}}else if(event.key==='Enter'){enterTarget=control(event);send('press',enterTarget,'Enter');}};
  const move=event=>{if(mode!=='pick')return;const node=control(event);if(node){const r=node.getBoundingClientRect();Object.assign(overlay.style,{display:'block',left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});}};
  for(const [name,fn] of [['click',click],['input',input],['change',change],['keydown',key],['keyup',e=>{if(e.key==='Enter')enterTarget=null;}],['pointermove',move],['pointerdown',e=>{enterTarget=null;if(mode==='pick')block(e);}]] ){document.addEventListener(name,fn,true);listeners.push([name,fn]);}
  state.stop=()=>{for(const [name,fn] of listeners)document.removeEventListener(name,fn,true);overlay.remove();};
}
