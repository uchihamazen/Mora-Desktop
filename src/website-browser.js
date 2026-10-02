import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {authorizeStep,allowedNavigation,allowedResource,redactObservation,redactText} from './website-policy.js';
import {controlKey} from './website-discovery.js';
import {summarizeAccessibility} from './website-findings.js';
import {installWebsiteTeaching,sanitizeTeachingEvent} from './website-teaching.js';

const selector='button,input:not([type=hidden]),textarea,select,a[href],[role=button],[role=checkbox],[role=tab],[contenteditable=true],output,[role=status]';
function blockedByModal(element){const doc=element.ownerDocument,modal=[...doc.querySelectorAll('dialog:modal,[role=dialog][aria-modal=true]')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').at(-1);return !!element.closest('[inert]')||!!modal&&!modal.contains(element);}
async function blockedFrame(frame){
  for(let child=frame;child?.parentFrame();child=child.parentFrame()){
    const element=await child.frameElement();try{if(await element.evaluate(blockedByModal))return true;}finally{await element.dispose();}
  }
  return false;
}
function describe(element) {
  const labels=element.labels?[...element.labels].map(e=>{const copy=e.cloneNode(true);for(const field of copy.querySelectorAll('input,select,textarea,button'))field.remove();return copy.textContent;}).join(' '):'';
  const labelled=(element.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>element.ownerDocument.getElementById(id)?.innerText||'').join(' ');
  const name=(element.getAttribute('aria-label')||labelled||labels||element.innerText||element.getAttribute('placeholder')||element.getAttribute('title')||element.name||element.tagName).trim().slice(0,180);
  const type=element.getAttribute('type')||'',tag=element.tagName.toLowerCase();
  const sensitive=type==='password'||type==='email'||type==='tel'||/password|secret|token|card|address|email|phone|otp|one.time|verification|credit/i.test([name,element.name,element.autocomplete].join(' '));
  return {name,tag,type,role:element.getAttribute('role')||'',value:sensitive?'[redacted]':String(element.value??'').slice(0,1000),sensitive,href:element.href||'',formAction:element.form?.action||'',disabled:!!element.disabled||element.getAttribute('aria-disabled')==='true',checked:element.checked??element.getAttribute('aria-checked'),expanded:element.getAttribute('aria-expanded'),selected:element.getAttribute('aria-selected'),constraints:{willValidate:element.willValidate??false,valueAttribute:type==='number'?element.getAttribute('value')??'':'',required:!!element.required,min:element.getAttribute('min')??'',max:element.getAttribute('max')??'',step:element.getAttribute('step')??'',maxLength:element.maxLength>=0?element.maxLength:null,pattern:element.getAttribute('pattern')??''},options:tag==='select'?[...element.options].slice(0,40).map(o=>({label:o.label,value:o.value,disabled:o.disabled})):undefined};
}
function describeState(){
  const visible=e=>!!(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';
  const name=e=>e.getAttribute('aria-label')||e.getAttribute('role')||e.tagName.toLowerCase();
  return {dialogs:[...document.querySelectorAll('dialog[open],[role=dialog]')].filter(visible).map(name).slice(0,10),regions:[...document.querySelectorAll('output,[role=status],[aria-live],table,ul,ol')].filter(visible).slice(0,30).map(e=>({name:name(e),text:e.innerText.slice(0,500)})),unsupported:[...document.querySelectorAll('canvas,[draggable=true],input[type=file]')].filter(visible).map(e=>`${e.tagName.toLowerCase()} interaction is not supported.`)};
}
export class WebsiteBrowser {
  constructor({directory,executablePath,headless=false,onClose=()=>{}}) {Object.assign(this,{directory,executablePath,headless,onClose});this.closed=false;this.manual=true;this.blocked=new Set();this.handles=new Map();}
  async open(scope,{storageState}={}) {
    this.scope=scope;this.policy={scope,version:1,grants:[]};await mkdir(this.directory,{recursive:true});
    this.browser=await chromium.launch({headless:this.headless,executablePath:this.executablePath||chromium.executablePath(),downloadsPath:this.directory});
    if(this.closed){await this.browser.close();throw Error('Website browser was stopped.');}
    this.context=await this.browser.newContext({viewport:scope.viewport==='mobile'?{width:390,height:844}:{width:1280,height:800},acceptDownloads:false,serviceWorkers:'block',...(storageState?{storageState}:{})});
    this.context.setDefaultTimeout(8000);this.context.setDefaultNavigationTimeout(15000);
    this.teachingQueue=Promise.resolve();this.teachingEpoch=0;
    await this.context.exposeBinding('__moraTeachingEvent',(source,payload)=>{
      const session=this.teaching;if(!session||!this.manual||source.page!==this.page||payload?.token!==session.token||!allowedNavigation(this.scope,source.frame.url()))return;
      if(session.received++>=100){if(!session.overflow){session.overflow=true;this.teachingQueue=this.teachingQueue.then(async()=>{if(this.teaching===session&&!this.closed)await session.onEvent({error:'Recording input-event limit reached; this demonstration is incomplete. Record a shorter workflow or paste longer text.'});}).catch(()=>{});}return this.teachingQueue;}
      this.teachingQueue=this.teachingQueue.then(async()=>{
        if(this.teaching!==session||this.closed)return;
        try{
          if(payload.action==='cancel'){await session.onEvent({cancelled:true});return;}
          if(!['pick','click','type','select','press'].includes(payload.action)||typeof payload.selector!=='string'||payload.selector.length>512)throw Error('Invalid recording event.');
          // A navigation may already have replaced the DOM. Click snapshots contain
          // no input values and remain untrusted proposals requiring user review.
          if(['click','press'].includes(payload.action)){const event=sanitizeTeachingEvent({action:payload.action,url:payload.url,control:payload.control,value:payload.action==='press'?payload.value:''},this.scope);if(this.teaching===session)await session.onEvent(event);return;}
          const matches=await source.frame.locator('css='+payload.selector).elementHandles();
          try{
            if(matches.length!==1)throw Error('A recorded control changed before it could be verified. Record that action again.');
            const element=matches[0],control={...await element.evaluate(describe),frameUrl:source.frame.url()};
            const value=payload.action==='type'?control.value:payload.action==='select'?await element.evaluate(e=>e.selectedOptions[0]?.label||''):payload.action==='press'?payload.value:'';
            const event=sanitizeTeachingEvent({action:payload.action,url:source.page.url(),control,value},this.scope);
            if(this.teaching===session)await session.onEvent(event);
          }finally{for(const element of matches)await element.dispose().catch(()=>{});}
        }catch(error){if(this.teaching===session)await session.onEvent({error:redactText(error.message)});}
      }).catch(()=>{});
      return this.teachingQueue;
    });
    await this.context.route('**/*',async route=>{
      const request=route.request(),url=request.url();
      const allowed=request.isNavigationRequest()?allowedNavigation(this.scope,url):allowedResource(this.scope,url);
      if(!allowed){this.blocked.add(redactText(new URL(url).origin));return route.abort('blockedbyclient');}
      try {
        // Resolve document redirects one response at a time. route.continue()
        // does not reapply interception to every redirected URL.
        if(request.isNavigationRequest()) {
          const response=await route.fetch({maxRedirects:0,timeout:15000});
          const location=response.headers().location;
          if(location&&!allowedNavigation(this.scope,new URL(location,url).href)){this.blocked.add(redactText(new URL(location,url).origin));await response.dispose();return route.abort('blockedbyclient');}
          await route.fulfill({response});await response.dispose();
        } else await route.continue();
      }catch{await route.abort().catch(()=>{});}
    });
    this.context.on('page',page=>{
      if(!this.scanning)this.page=page;
      page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));
      page.on('download',download=>download.cancel().catch(()=>{}));
      page.on('framenavigated',frame=>this.enableTeaching(frame).catch(()=>{}));
      page.on('close',()=>{if(this.page===page){this.page=this.context.pages().at(-1);if(!this.page&&!this.closed)this.onClose();}});
    });
    this.browser.on('disconnected',()=>{if(!this.closed)this.onClose();});
    this.page=await this.context.newPage();await this.page.goto(scope.entryUrl,{waitUntil:'domcontentloaded'});
  }
  grant(fingerprint){this.policy.grants.push(fingerprint);}
  async enableTeaching(frame){
    const session=this.teaching;if(!session||this.closed||!this.manual||!allowedNavigation(this.scope,frame.url()))return;
    await frame.waitForLoadState('domcontentloaded');if(this.teaching!==session)return;
    await frame.evaluate(installWebsiteTeaching,{mode:session.mode,token:session.token,epoch:session.epoch});
  }
  async beginTeaching(mode,onEvent){
    if(!['pick','record'].includes(mode)||this.closed||!this.manual)throw Error('Take over the website before selecting or recording.');
    await this.stopTeaching();this.teaching={mode,onEvent,token:randomUUID(),epoch:++this.teachingEpoch,received:0};
    await Promise.all(this.page.frames().map(frame=>this.enableTeaching(frame)));await this.page.bringToFront();
  }
  async stopTeaching({drain=false}={}){
    if(drain)await this.teachingQueue;this.teaching=null;const epoch=++this.teachingEpoch;
    await Promise.all((this.context?.pages()||[]).flatMap(page=>page.frames().map(frame=>frame.evaluate(installWebsiteTeaching,{mode:'off',epoch}).catch(()=>{}))));
  }
  invalidate(){this.observation=null;this.policy.version++;this.policy.grants=[];}
  async observe() {
    if(this.closed||!this.page)throw Error('Open a website browser first.');
    await this.page.waitForLoadState('domcontentloaded').catch(()=>{});
    if(!allowedNavigation(this.scope,this.page.url()))throw Error('The current browser page is outside the selected scope. Return to an allowed page.');
    for(const handle of this.handles.values())await handle.element.dispose().catch(()=>{});this.handles.clear();
    const id=randomUUID(),controls=[],text=[],dialogs=[],regions=[],unsupported=[];
    for(const frame of this.page.frames()) {
      if(!allowedNavigation(this.scope,frame.url()))continue;
      const frameInert=await blockedFrame(frame);
      text.push(await frame.locator('body').innerText({timeout:2500}).catch(()=>''));
      const state=await frame.evaluate(describeState).catch(()=>({dialogs:[],regions:[],unsupported:['A frame could not be observed.']}));dialogs.push(...state.dialogs);regions.push(...state.regions);unsupported.push(...state.unsupported);
      const elements=await frame.locator(selector).elementHandles();
      for(const element of elements) {
        if(controls.length>=150||!await element.isVisible().catch(()=>false)){await element.dispose();continue;}
        const info=await element.evaluate(describe).catch(()=>null);if(!info){await element.dispose();continue;}
        info.inert=frameInert||await element.evaluate(blockedByModal);
        const ref=`e${controls.length+1}`,control={id:ref,...info,frameUrl:frame.url()};control.key=controlKey(control);controls.push(control);this.handles.set(ref,{element,signature:JSON.stringify(info)});
      }
    }
    if(controls.length>=150)unsupported.push('The observation control limit was reached.');
    this.observation={id,url:this.page.url(),title:await this.page.title(),roleId:this.scope.roleId,controls,visibleText:text.join('\n').slice(0,16000),dialogs,regions,unsupported,blockedOrigins:[...this.blocked],pageState:'observed'};
    return redactObservation(this.observation);
  }
  async perform(step) {
    if(this.closed||this.manual)return {status:'blocked',reason:'Automation is paused. Start a check after manual interaction.'};
    if(!this.observation)return {status:'blocked',reason:'Observe the page before acting.'};
    const permission=authorizeStep(step,this.observation,this.policy);
    if(permission.decision!=='allow')return {status:permission.decision==='pending'?'pending':'blocked',reason:permission.reason,fingerprint:permission.fingerprint};
    if(this.page.url()!==this.observation.url)return {status:'blocked',reason:'The browser navigated. Observe the new page before acting.'};
    const target=this.handles.get(step.target);
    this.inFlight=true;
    try {
      if(target){const current=await target.element.evaluate(describe),previous=JSON.parse(target.signature);current.inert=await blockedFrame(await target.element.ownerFrame())||await target.element.evaluate(blockedByModal);if(current.inert&&['click','type','select'].includes(step.action))return {status:'blocked',reason:'The control is inactive behind a modal or inert container.'};const changed=step.action==='assert'?current.sensitive||['name','tag','type','role'].some(key=>current[key]!==previous[key]):JSON.stringify(current)!==target.signature;if(changed)return {status:'blocked',reason:'The control changed after observation. Observe it again.'};}
      if(permission.fingerprint)this.policy.grants=this.policy.grants.filter(value=>value!==permission.fingerprint);
      if(step.action==='assert')return await this.check(step,target);
      if(step.action==='screenshot')return {status:'ok',screenshot:await this.capture()};
      if(step.action==='click'){const popup=this.page.waitForEvent('popup',{timeout:750}).catch(()=>null);await target.element.click();const opened=await popup;if(opened){this.page=opened;await opened.waitForLoadState('domcontentloaded');}}
      if(step.action==='type')await target.element.fill(String(step.value??''));
      if(step.action==='select')await target.element.selectOption({label:String(step.value)});
      if(step.action==='press')await this.page.keyboard.press(step.value);
      if(step.action==='navigate')await this.page.goto(step.value,{waitUntil:'domcontentloaded'});
      if(step.action==='reload')await this.page.reload({waitUntil:'domcontentloaded'});
      if(step.action==='scroll')await this.page.mouse.wheel(0,Math.max(-2000,Math.min(2000,Number(step.value)||600)));
      return {status:'ok'};
    }catch(error){return {status:'blocked',reason:redactText(error.message).slice(0,500)};}
    finally{this.inFlight=false;}
  }
  async check(step,target) {
    const deadline=Date.now()+4000;let actual;
    do {
      if(this.closed||this.manual)throw Error('Website check was stopped.');
      if(['value','textValue','visible','checked','disabled','validity'].includes(step.check)&&!target)throw Error('This check needs a current observed control.');
      if(step.check==='text')actual=(await (target?.element||this.page.locator('body')).innerText()).includes(step.expected);
      if(step.check==='url')actual=this.page.url();
      if(step.check==='value')actual=await target.element.inputValue();
      if(step.check==='textValue')actual=await target.element.innerText();
      if(step.check==='visible')actual=!!target&&await target.element.isVisible();
      if(step.check==='checked')actual=await target.element.isChecked();
      if(step.check==='disabled')actual=await target.element.isDisabled();
      if(step.check==='validity')actual=await target.element.evaluate(e=>e.validity?e.validity.valid:null);
      if(step.check==='count')actual=await this.page.getByText(String(step.value),{exact:true}).count();
      const expected=step.check==='text'?true:step.expected;
      if(actual===expected)return {status:'passed',actual:typeof actual==='string'?redactText(actual):actual,screenshot:await this.capture()};
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<deadline);
    return {status:'failed',actual:typeof actual==='string'?redactText(actual):actual,screenshot:await this.capture()};
  }
  async accessibility() {
    if(this.closed||this.manual||!allowedNavigation(this.scope,this.page.url()))return {status:'blocked',reason:'Observe an allowed website before accessibility checks.'};
    const page=this.page;this.inFlight=true;this.scanning=true;let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;this.close().catch(()=>{});},20000);
    try {
      const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
      if(this.closed||this.manual)throw Error('Accessibility scan was interrupted.');
      this.page=page;return {status:'completed',...summarizeAccessibility(scan),screenshot:await this.capture()};
    }catch(error){return {status:'blocked',reason:timedOut?'Accessibility scan timed out. The owned browser was closed.':redactText(error.message).slice(0,500)};}
    finally{clearTimeout(timer);this.scanning=false;this.inFlight=false;if(!page.isClosed())this.page=page;}
  }
  async capture() {
    const name=`screen-${randomUUID()}.png`,mask=[];
    for(const frame of this.page.frames())mask.push(frame.locator('input,textarea,select,[contenteditable=true],[data-private]'));
    await this.page.screenshot({path:path.join(this.directory,name),mask,timeout:5000});return {name};
  }
  async storageState(){return this.context.storageState();}
  async takeOver(){
    this.manual=true;this.invalidate();
    // Playwright's pending input actions cannot be individually cancelled.
    // Closing our browser prevents an auto-waiting click from firing later.
    if(this.inFlight){await this.close();return;}
    await this.page?.bringToFront();
  }
  async close(){if(this.closed)return;this.closed=true;this.manual=true;this.teaching=null;this.invalidate();await this.browser?.close();}
}
