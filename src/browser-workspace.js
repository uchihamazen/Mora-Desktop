import {randomUUID} from 'node:crypto';
import {DesktopBrowser} from './browser.js';
import {browserTabs} from './browser-tabs.js';
import {browserURL} from './annotations.js';

export class BrowserWorkspace {
  constructor(window,onSave){this.window=window;this.onSave=onSave;this.pages=new Map();this.selectSession(null);window.on('closed',()=>this.dispose());}
  dispose(){for(const page of this.pages.values())page.dispose();this.pages.clear();}
  selectSession(sessionId,saved){this.revision=(this.revision || 0)+1;this.dispose();this.sessionId=sessionId;this.saved=browserTabs(saved);this.open=false;this.bounds=null;this.occluded=false;this.publish();}
  active(){return this.saved.tabs.find(tab=>tab.id===this.saved.activeId);}
  snapshot(){return browserTabs(this.saved);}
  save(){this.onSave?.(this.sessionId,this.snapshot());}
  changed(id,state) {
    const tab=this.saved.tabs.find(tab=>tab.id===id),page=this.pages.get(id);if(!tab || !page)return;
    Object.assign(tab,{url:state.url,title:state.title,deviceMode:state.deviceMode,history:{entries:page.view.webContents.navigationHistory.getAllEntries(),index:page.view.webContents.navigationHistory.getActiveIndex()}});
    // Persist locations and titles only; serialized page/form state stays native.
    tab.history=browserTabs({tabs:[tab]}).tabs[0].history;this.save();if(id===this.saved.activeId)this.publish();
  }
  publish(){if(this.window.isDestroyed())return;const tab=this.active(),page=this.pages.get(tab.id);this.state={...(page?.state || {url:tab.url,title:tab.title,loading:false,deviceMode:tab.deviceMode,deviceReady:false,selection:null,annotating:false}),open:this.open,activeTabId:tab.id,tabs:this.saved.tabs.map(({id,title,url})=>({id,title,url})),history:tab.history};this.window.webContents.send('muse:event',{type:'browser',state:this.state});}
  page(){const tab=this.active();let page=this.pages.get(tab.id);if(!page){page=new DesktopBrowser(this.window,{partition:`persist:mora-browser-${this.sessionId || 'new'}`,history:tab.history,onChange:state=>this.changed(tab.id,state)});page.state.deviceMode=tab.deviceMode;this.pages.set(tab.id,page);}return page;}
  async activate(id){if(!this.saved.tabs.some(tab=>tab.id===id))throw Error('Choose an open browser tab.');const revision=++this.revision,previous=this.pages.get(this.saved.activeId);if(previous){await previous.cancel();previous.occluded=true;previous.updateVisibility();}if(revision!==this.revision)return this.state;this.saved.activeId=id;this.save();const page=this.page();page.occluded=true;await page.command('open');if(revision!==this.revision)return this.state;if(this.bounds)await page.command('bounds',this.bounds);if(revision!==this.revision)return this.state;page.occluded=this.occluded;page.updateVisibility();this.publish();return this.state;}
  async navigate(url){await this.command('open');return this.command('navigate',{url});}
  async checkPage(url){await this.command('open');return this.page().checkPage(url);}
  async command(action,payload={}) {
    if(action==='state'){this.publish();return this.state;}
    if(action==='tab-new'){if(this.saved.tabs.length>=8)throw Error('Close a tab before opening another (8 per chat).');const id=randomUUID();this.saved.tabs.push({id,url:'',title:'',deviceMode:'desktop',history:{entries:[],index:0}});this.open=true;return this.activate(id);}
    if(action==='tab-select'){this.open=true;return this.activate(payload.id);}
    if(action==='tab-close'){
      this.revision++;
      const index=this.saved.tabs.findIndex(tab=>tab.id===payload.id);if(index<0)throw Error('Choose an open browser tab.');this.pages.get(payload.id)?.dispose();this.pages.delete(payload.id);this.saved.tabs.splice(index,1);
      if(!this.saved.tabs.length){this.saved=browserTabs();await this.command('close');}else if(this.saved.activeId===payload.id){this.saved.activeId=this.saved.tabs[Math.min(index,this.saved.tabs.length-1)].id;if(this.open)await this.activate(this.saved.activeId);}this.save();this.publish();return this.state;
    }
    if(action==='open'){this.open=true;return this.activate(this.saved.activeId);}
    if(action==='close'){this.revision++;this.open=false;for(const page of this.pages.values()){page.state.open=false;page.occluded=true;await page.cancel();page.updateVisibility();}this.window.setMinimumSize(860,620);this.publish();return this.state;}
    if(action==='occlude'){this.occluded=payload.hidden===true;const page=this.pages.get(this.saved.activeId);if(page){page.occluded=this.occluded;page.updateVisibility();}return this.state;}
    if(action==='bounds')this.bounds=payload;
    const page=this.pages.get(this.saved.activeId);if(!page){if(action==='bounds')return this.state;throw Error('Open the browser first.');}
    if(action==='history-go'){const index=payload.index;if(!Number.isInteger(index) || !this.active().history.entries[index])throw Error('Choose a history entry.');const history=page.view.webContents.navigationHistory,entries=history.getAllEntries(),active=history.getActiveIndex(),start=Math.max(0,active-25),indices=[];for(let i=start;i<Math.min(entries.length,start+50);i++){try{browserURL(entries[i].url);indices.push(i);}catch{}}await page.cancel();history.goToIndex(indices[index]);this.publish();return this.state;}
    const revision=this.revision,result=await page.command(action,payload);if(revision!==this.revision && ['capture','compare-before','compare-after'].includes(action))throw Error('The browser tab changed during capture. Try again.');this.publish();return ['capture','compare-before','compare-after'].includes(action)?result:this.state;
  }
}
