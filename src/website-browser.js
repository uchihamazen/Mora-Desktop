import {chromium} from 'playwright';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {authorizeStep,allowedNavigation,allowedResource,redactObservation,redactText} from './website-policy.js';

const selector='button,input:not([type=hidden]),textarea,select,a[href],[role=button],[role=checkbox],[role=tab],[contenteditable=true]';
function describe(element) {
  const labels=element.labels?[...element.labels].map(e=>{const copy=e.cloneNode(true);for(const field of copy.querySelectorAll('input,select,textarea,button'))field.remove();return copy.textContent;}).join(' '):'';
  const labelled=(element.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>element.ownerDocument.getElementById(id)?.innerText||'').join(' ');
  const name=(element.getAttribute('aria-label')||labelled||labels||element.innerText||element.getAttribute('placeholder')||element.getAttribute('title')||element.name||element.tagName).trim().slice(0,180);
  const type=element.getAttribute('type')||'',tag=element.tagName.toLowerCase();
  const sensitive=type==='password'||type==='email'||type==='tel'||/password|secret|token|card|address|email|phone|otp|one.time|verification|credit/i.test([name,element.name,element.autocomplete].join(' '));
  return {name,tag,type,role:element.getAttribute('role')||'',value:sensitive?'[redacted]':String(element.value??'').slice(0,1000),sensitive,href:element.href||'',formAction:element.form?.action||'',disabled:!!element.disabled||element.getAttribute('aria-disabled')==='true',checked:element.checked??element.getAttribute('aria-checked'),options:tag==='select'?[...element.options].slice(0,40).map(o=>({label:o.label,value:o.value,disabled:o.disabled})):undefined};
}
export class WebsiteBrowser {
  constructor({directory,executablePath,headless=false,onClose=()=>{}}) {Object.assign(this,{directory,executablePath,headless,onClose});this.closed=false;this.manual=true;this.blocked=new Set();this.handles=new Map();}
  async open(scope,{storageState}={}) {
    this.scope=scope;this.policy={scope,version:1,grants:[]};await mkdir(this.directory,{recursive:true});
    this.browser=await chromium.launch({headless:this.headless,executablePath:this.executablePath||chromium.executablePath(),downloadsPath:this.directory});
    if(this.closed){await this.browser.close();throw Error('Website browser was stopped.');}
    this.context=await this.browser.newContext({viewport:scope.viewport==='mobile'?{width:390,height:844}:{width:1280,height:800},acceptDownloads:false,serviceWorkers:'block',...(storageState?{storageState}:{})});
    this.context.setDefaultTimeout(8000);this.context.setDefaultNavigationTimeout(15000);
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
      this.page=page;
      page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));
      page.on('download',download=>download.cancel().catch(()=>{}));
      page.on('close',()=>{if(this.page===page){this.page=this.context.pages().at(-1);if(!this.page&&!this.closed)this.onClose();}});
    });
    this.browser.on('disconnected',()=>{if(!this.closed)this.onClose();});
    this.page=await this.context.newPage();await this.page.goto(scope.entryUrl,{waitUntil:'domcontentloaded'});
  }
  grant(fingerprint){this.policy.grants.push(fingerprint);}
  invalidate(){this.observation=null;this.policy.version++;this.policy.grants=[];}
  async observe() {
    if(this.closed||!this.page)throw Error('Open a website browser first.');
    await this.page.waitForLoadState('domcontentloaded').catch(()=>{});
    if(!allowedNavigation(this.scope,this.page.url()))throw Error('The current browser page is outside the selected scope. Return to an allowed page.');
    for(const handle of this.handles.values())await handle.element.dispose().catch(()=>{});this.handles.clear();
    const id=randomUUID(),controls=[],text=[];
    for(const frame of this.page.frames()) {
      if(!allowedNavigation(this.scope,frame.url()))continue;
      text.push(await frame.locator('body').innerText({timeout:2500}).catch(()=>''));
      const elements=await frame.locator(selector).elementHandles();
      for(const element of elements) {
        if(controls.length>=150||!await element.isVisible().catch(()=>false)){await element.dispose();continue;}
        const info=await element.evaluate(describe).catch(()=>null);if(!info){await element.dispose();continue;}
        const ref=`e${controls.length+1}`;controls.push({id:ref,...info});this.handles.set(ref,{element,signature:JSON.stringify(info)});
      }
    }
    this.observation={id,url:this.page.url(),title:await this.page.title(),roleId:this.scope.roleId,controls,visibleText:text.join('\n').slice(0,16000),blockedOrigins:[...this.blocked],pageState:'observed'};
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
      if(target&&(JSON.stringify(await target.element.evaluate(describe))!==target.signature))return {status:'blocked',reason:'The control changed after observation. Observe it again.'};
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
      if(['value','visible','checked','disabled'].includes(step.check)&&!target)throw Error('This check needs a current observed control.');
      if(step.check==='text')actual=(await this.page.locator('body').innerText()).includes(step.expected);
      if(step.check==='url')actual=this.page.url();
      if(step.check==='value')actual=await target.element.inputValue();
      if(step.check==='visible')actual=!!target&&await target.element.isVisible();
      if(step.check==='checked')actual=await target.element.isChecked();
      if(step.check==='disabled')actual=await target.element.isDisabled();
      if(step.check==='count')actual=await this.page.getByText(String(step.value),{exact:true}).count();
      const expected=step.check==='text'?true:step.expected;
      if(actual===expected)return {status:'passed',actual:redactText(actual),screenshot:await this.capture()};
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<deadline);
    return {status:'failed',actual:redactText(actual),screenshot:await this.capture()};
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
  async close(){if(this.closed)return;this.closed=true;this.manual=true;this.invalidate();await this.browser?.close();}
}
