import {BrowserWindow,session} from 'electron';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {testerURL} from './tester.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function pageState() {
  const name=el=>(el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')?.split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ')||el.labels?.[0]?.textContent||el.innerText||el.getAttribute('placeholder')||el.getAttribute('title')||'').trim().slice(0,180);
  const nodes=[...document.querySelectorAll('button,input:not([type=hidden]),textarea,select,a,[role=button],[role=checkbox],[contenteditable=true]')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width&&r.height&&s.display!=='none'&&s.visibility!=='hidden';});
  const counts=new Map();
  const controls=nodes.map((el,index)=>{const label=name(el),tag=el.tagName.toLowerCase(),key=tag+'\0'+label,occurrence=counts.get(key)||0;counts.set(key,occurrence+1);const aria=el.getAttribute('aria-checked'),checked=typeof el.checked==='boolean'?el.checked:aria==='mixed'?'mixed':aria==='true';return {ref:`e${index+1}`,target:{name:label,tag,occurrence},name:label,tag,type:el.type||'',value:el.type==='password'?undefined:el.value,checked,disabled:el.matches(':disabled')||!!el.closest('[aria-disabled="true"]'),options:el.tagName==='SELECT'?[...el.options].map(o=>({label:o.label,value:o.value})):undefined};});
  globalThis.__moraTester={nodes,controls};
  return {url:location.href,title:document.title,text:document.body.innerText.slice(0,10000),controls,viewport:{width:innerWidth,height:innerHeight}};
}
function findControl(target) {
  const state=globalThis.__moraTester;if(!state)throw Error('Take a fresh observation before acting.');
  let indexes;
  if(typeof target==='object')indexes=state.controls.flatMap((c,i)=>c.target.name===target.name&&c.target.tag===target.tag&&c.target.occurrence===target.occurrence?[i]:[]);
  else indexes=state.controls.flatMap((c,i)=>c.ref===target||c.name===target?[i]:[]);
  if(!indexes.length)throw Error('Control is missing.');
  if(indexes.length!==1)throw Error('Control is ambiguous. Use a fresh element reference.');
  const index=indexes[0],el=state.nodes[index];if(!el?.isConnected)throw Error('Control changed. Take a fresh observation.');
  return {el,descriptor:state.controls[index].target,control:state.controls[index]};
}
export class TesterBrowser {
  constructor(url,directory,{onClose=()=>{}}={}){this.url=testerURL(url);this.origin=new URL(this.url).origin;this.directory=directory;this.onClose=onClose;this.diagnostics=[];this.captureId=0;}
  allowed(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&url.origin===this.origin&&!url.username&&!url.password;}catch{return false;}}
  ensure(){if(this.closed||!this.window||this.window.isDestroyed())throw Error('Testing browser is closed or stopped.');}
  async open() {
    this.partition=session.fromPartition(`mora-tester-${randomUUID()}`);
    this.partition.setPermissionRequestHandler((_web,_permission,reply)=>reply(false));this.partition.setPermissionCheckHandler(()=>false);
    this.partition.on('will-download',event=>event.preventDefault());
    this.partition.webRequest.onBeforeRequest((details,reply)=>reply({cancel:details.url!=='about:blank'&&!this.allowed(details.url)}));
    this.partition.webRequest.onHeadersReceived((details,reply)=>{
      const type=Object.entries(details.responseHeaders||{}).find(([key])=>key.toLowerCase()==='content-type')?.[1]?.join(';')||'';
      reply({cancel:['mainFrame','subFrame'].includes(details.resourceType)&&details.statusCode<300&&!/text\/html|application\/xhtml\+xml/i.test(type)});
    });
    this.window=new BrowserWindow({width:1280,height:840,minWidth:420,minHeight:500,title:'Mora · AI Tester',autoHideMenuBar:true,webPreferences:{session:this.partition,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
    const web=this.window.webContents;web.setZoomFactor(1);web.setWindowOpenHandler(()=>({action:'deny'}));
    for(const event of ['will-navigate','will-redirect','will-frame-navigate'])web.on(event,(e,url)=>{if(!this.allowed(url||e.url))e.preventDefault();});
    web.on('console-message',event=>{const d=event.details||event;if(d.level==='error')this.diagnostics.push(String(d.message).slice(0,1000));if(this.diagnostics.length>20)this.diagnostics.shift();});
    this.window.on('closed',()=>{if(!this.closed){this.closed=true;this.onClose();}});
    await this.navigate(this.url);
  }
  script(code){this.ensure();return this.window.webContents.executeJavaScriptInIsolatedWorld(119,[{code}]);}
  async snapshot(){this.ensure();if(!this.allowed(this.window.webContents.getURL()))throw Error('Testing browser left its allowed scope.');return {...await this.script(`(${pageState.toString()})()`),diagnostics:this.diagnostics};}
  async navigate(url){this.ensure();if(!this.allowed(url))throw Error('Navigation is outside the allowed local app scope.');await this.window.webContents.loadURL(url);await pause(100);return this.snapshot();}
  async reset(){this.ensure();await this.partition.clearStorageData();this.diagnostics=[];await this.navigate(this.url);}
  async resolve(target,prepare=false){
    await this.snapshot();
    return this.script(`(()=>{const {el,descriptor,control}=(${findControl.toString()})(${JSON.stringify(target)});${prepare?'el.scrollIntoView({block:"center",inline:"center"});':''}const r=el.getBoundingClientRect();return {target:descriptor,x:r.x+r.width/2,y:r.y+r.height/2,disabled:control.disabled,value:el.value,checked:control.checked,tag:el.tagName,type:el.type,visible:!!r.width&&!!r.height};})()`);
  }
  async click(target){
    const web=this.window.webContents;this.window.show();web.focus();
    await pause(75);
    const control=await this.resolve(target,true);if(control.disabled)throw Error('Control is disabled; assert its state instead of clicking.');
    await this.script(`(()=>{const {el}=(${findControl.toString()})(${JSON.stringify(control.target)});globalThis.__moraPointer=false;document.addEventListener('pointerdown',e=>{globalThis.__moraPointer=e.isTrusted&&e.composedPath().includes(el);},{capture:true,once:true});})()`);
    const position={x:Math.round(control.x),y:Math.round(control.y)};
    web.sendInputEvent({type:'mouseMove',...position});web.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...position});web.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...position});
    await pause(100);
    // A completed navigation replaces the isolated world; otherwise verify the actual target.
    if(await this.script('globalThis.__moraPointer===false'))throw Error('Pointer did not reach the intended control.');
    return control.target;
  }
  async capture(){this.ensure();await mkdir(this.directory,{recursive:true});const name=`screen-${randomUUID()}.png`,file=path.join(this.directory,name);await writeFile(file,(await this.window.webContents.capturePage()).toPNG());return {file,name};}
  async perform(action) {
    this.ensure();if(!action||typeof action!=='object')throw Error('Invalid browser action.');
    const web=this.window.webContents;let target;
    if(action.action==='navigate')await this.navigate(new URL(action.text,this.url).href);
    else if(action.action==='reload'){await this.navigate(web.getURL());}
    else if(action.action==='click')target=await this.click(action.target);
    else if(action.action==='type'){
      if(typeof action.text!=='string'||action.text.length>3000)throw Error('Typing is limited to 3000 characters.');
      target=await this.click(action.target);
      const focused=await this.script(`(()=>{const {el}=(${findControl.toString()})(${JSON.stringify(target)});return document.activeElement===el&&(['INPUT','TEXTAREA'].includes(el.tagName)||el.isContentEditable);})()`);
      if(!focused)throw Error('The intended field did not receive keyboard focus.');
      web.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['control']});web.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['control']});
      web.sendInputEvent({type:'keyDown',keyCode:'Backspace'});web.sendInputEvent({type:'keyUp',keyCode:'Backspace'});if(action.text)await web.insertText(action.text);
    }else if(action.action==='press'){
      if(!['Tab','Enter','Escape','Backspace','Delete','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Space'].includes(action.text))throw Error('Unsupported browser key.');
      const keyCode=action.text.replace(/^Arrow/,'');web.focus();web.sendInputEvent({type:'keyDown',keyCode});web.sendInputEvent({type:'keyUp',keyCode});
    }else if(action.action==='select'){
      target=await this.click(action.target);const option=await this.script(`(()=>{const {el}=(${findControl.toString()})(${JSON.stringify(target)});if(el.tagName!=='SELECT')throw Error('Choose a select control.');return [...el.options].filter(o=>!o.disabled&&!o.closest('optgroup[disabled]')).findIndex(o=>o.value===${JSON.stringify(action.text)}||o.label===${JSON.stringify(action.text)});})()`);
      if(option<0)throw Error('Option was not found.');web.sendInputEvent({type:'keyDown',keyCode:'Home'});web.sendInputEvent({type:'keyUp',keyCode:'Home'});
      for(let i=0;i<option;i++){web.sendInputEvent({type:'keyDown',keyCode:'Down'});web.sendInputEvent({type:'keyUp',keyCode:'Down'});}
      web.sendInputEvent({type:'keyDown',keyCode:'Enter'});web.sendInputEvent({type:'keyUp',keyCode:'Enter'});
    }else if(action.action==='scroll'){
      const delta=Number(action.text);if(!Number.isFinite(delta)||Math.abs(delta)>2000)throw Error('Scroll is limited to 2000 pixels.');web.sendInputEvent({type:'mouseWheel',x:100,y:100,deltaY:delta,deltaX:0});
    }else if(action.action==='screenshot')return {screenshot:await this.capture()};
    else if(action.action==='assert')return this.assert(action);
    else throw Error('Unsupported browser action.');
    await pause(150);return {ok:true,...(target?{target}:{}),snapshot:await this.snapshot()};
  }
  async assert(action){
    const expected=String(action.expected??action.text??'');
    if(['checked','disabled','visible'].includes(action.check)&&!['true','false',...(action.check==='checked'?['mixed']:[])].includes(expected))throw Error('Expected state must be true or false (checked also allows mixed).');
    let actual,target,passed=false;const deadline=Date.now()+1800;
    do {
      const state=await this.snapshot();
      if(action.check==='url'){actual=state.url;passed=actual===new URL(expected,this.url).href;}
      else if(action.check==='count'){actual=state.controls.filter(c=>c.name===action.target).length;passed=actual===Number(expected);}
      else if(['value','checked','disabled','visible'].includes(action.check)){
        try{const control=await this.resolve(action.target);target=control.target;actual=control[action.check];passed=String(actual)===expected;}catch(error){if(action.check!=='visible'||!error.message.includes('Control is missing.'))throw error;actual=false;passed=expected==='false';}
      }else {actual=state.text;passed=actual.includes(expected)===(action.present!==false);if(!expected)throw Error('Specify nonempty expected text.');}
      if(passed)break;await pause(150);
    }while(Date.now()<deadline&&!this.closed);
    return {passed,actual,...(target?{target}:{}),expected:String(action.expected??action.text??''),screenshot:await this.capture()};
  }
  async close(){if(this.closed)return;this.closed=true;if(this.window&&!this.window.isDestroyed())this.window.destroy();}
}
