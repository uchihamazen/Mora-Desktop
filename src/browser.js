import {WebContentsView} from 'electron';
import {browserURL,clipRectangle,annotationContext,selectOnPage} from './annotations.js';

export class DesktopBrowser {
  constructor(window) {
    this.window=window;this.state={open:false,url:'',title:'',loading:false,error:'',selection:null,annotating:false,deviceMode:'desktop',deviceReady:false};this.epoch=0;
    this.view=new WebContentsView({webPreferences:{partition:'persist:muse-browser',nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
    window.contentView.addChildView(this.view);this.view.setVisible(false);
    const web=this.view.webContents;
    web.session.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
    web.session.setPermissionCheckHandler(()=>false);
    web.session.on('will-download',event=>event.preventDefault());
    web.setWindowOpenHandler(({url})=>{try{this.navigate(url).catch(()=>{});}catch{}return{action:'deny'};});
    for(const name of ['will-navigate','will-redirect','will-frame-navigate']) web.on(name,(event,url)=>{
      try{browserURL(url || event.url);}catch{event.preventDefault();}
    });
    web.on('did-start-navigation',(_event,_url,inPlace,isMainFrame)=>{
      if(!isMainFrame)return;
      if(inPlace)this.cancel().catch(()=>{});
      else{
        this.pageReady=false;this.clearSelection();const viewport=this.viewport();
        // A new renderer boots at the native bounds before receiving emulation.
        // Hide the full logical viewport during load, then fit it into the panel.
        if(viewport){this.view.setVisible(false);this.view.setBounds({...viewport.rect,width:viewport.width,height:viewport.height});}
      }
      this.state.error='';this.publish();
    });
    web.on('did-finish-load',()=>{this.pageReady=true;});
    web.on('did-start-loading',()=>{this.state.loading=true;this.publish();});
    web.on('did-stop-loading',()=>{this.state.loading=false;this.layout().catch(()=>{}).finally(()=>{if(!web.isDestroyed())this.view.setVisible(this.state.open && !this.occluded);});this.publish();});
    web.on('did-navigate',()=>this.publish());web.on('did-navigate-in-page',(_event,_url,isMainFrame)=>{if(isMainFrame)this.cancel().catch(()=>{});this.publish();});
    web.on('page-title-updated',()=>this.publish());
    web.on('did-fail-load',(_event,code,description,_url,isMainFrame)=>{if(isMainFrame && code!==-3){this.state.error=description;this.publish();}});
    web.on('render-process-gone',()=>{this.pageReady=false;this.clearSelection();this.state.error='Page stopped responding. Reload to try again.';this.publish();});
    window.on('closed',()=>{clearInterval(this.timer);if(!web.isDestroyed())web.close();});
  }
  async initialize(){this.ready ??= this.view.webContents.loadURL('about:blank');await this.ready;}
  async checkPage(url) {
    const target=browserURL(url),parsed=new URL(target);
    if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))return {status:'not checked',message:'Run a local app before checking page loading.'};
    const web=this.view.webContents,errors=[];
    const receive=(event,level,message)=>{const detail=event.details || event;if(detail?.level==='error' || detail?.level===3 || level===3)errors.push(String(detail?.message || message || 'Browser error').slice(0,1000));};
    web.on('console-message',receive);let timer;
    try {
      await this.command('open');
      await Promise.race([this.navigate(target),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Page load timed out.')),15000);})]);
      await new Promise(resolve=>setTimeout(resolve,300));
      if(errors.length || this.state.error || !this.pageReady)throw new Error(errors.slice(0,5).join('\n') || this.state.error || 'Page did not finish loading.');
      return {status:'passed',message:'Local page loaded without reported console errors. Interaction behavior was not checked.'};
    }catch(error){return {status:'failed',message:error.message};}
    finally{clearTimeout(timer);web.off('console-message',receive);}
  }
  publish() {
    if(this.window.isDestroyed() || this.view.webContents.isDestroyed())return;
    const web=this.view.webContents;
    Object.assign(this.state,{deviceReady:!!this.pageReady,url:web.getURL()==='about:blank' ? '' : web.getURL(),title:web.getTitle(),canBack:web.navigationHistory.canGoBack(),canForward:web.navigationHistory.canGoForward()});
    this.window.webContents.send('muse:event',{type:'browser',state:this.state});
  }
  script(code) {return this.view.webContents.executeJavaScriptInIsolatedWorld(117,[{code}]);}
  viewport() {
    if(!this.bounds)return null;
    const rect={...this.bounds},zoom=this.window.webContents.getZoomFactor();
    if(this.state.deviceMode==='mobile'){const width=Math.min(rect.width,Math.round(390*zoom));rect.x+=Math.round((rect.width-width)/2);rect.width=width;}
    const width=this.state.deviceMode==='mobile' ? 390 : Math.max(1280,Math.round(rect.width/zoom)),scale=rect.width/width;
    return {rect,width,scale,height:Math.max(1,Math.round(rect.height/scale))};
  }
  async layout() {
    const viewport=this.viewport();if(!viewport)return;
    const {rect,width,height,scale}=viewport;
    if(this.state.loading)return;
    this.view.setBounds(rect);
    if(!this.pageReady)return;
    await this.ready;
    const web=this.view.webContents;
    if(!web.debugger.isAttached())web.debugger.attach('1.3');
    await web.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false,scale});
  }
  clearSelection() {this.epoch++;clearInterval(this.timer);this.timer=null;this.annotationToken=null;this.state.selection=null;this.state.annotating=false;}
  async cancel() {const token=this.annotationToken;this.clearSelection();if(token!=null)await this.script(`(${selectOnPage.toString()})('cancel',${token})`).catch(()=>{});this.publish();}
  async navigate(url) {
    const target=browserURL(url);await this.initialize();await this.cancel();await this.layout();
    await this.view.webContents.loadURL(target);return this.state;
  }
  async annotate(mode) {
    if(!['element','region'].includes(mode) || this.state.loading || !this.state.open || !/^https?:/.test(this.state.url))throw new Error('Open a web page before annotating.');
    this.clearSelection();const epoch=this.epoch;this.annotationToken=epoch;this.state.annotating=true;
    await this.script(`(${selectOnPage.toString()})(${JSON.stringify(mode)},${epoch})`);
    if(this.epoch!==epoch)return this.state;
    let reading=false,last='';
    this.timer=setInterval(async()=>{
      if(reading)return;reading=true;
      try {
        const snapshot=await this.script('globalThis.__museAnnotation?.read() || {selection:null,active:false}');
        if(this.epoch!==epoch)return;
        const signature=JSON.stringify(snapshot);
        if(signature!==last){last=signature;this.state.selection=snapshot.selection;this.state.annotating=snapshot.active;this.publish();}
        if(!snapshot.selection && !snapshot.active){clearInterval(this.timer);this.timer=null;this.annotationToken=null;}
      }catch{}finally{reading=false;}
    },150);this.timer.unref();this.publish();return this.state;
  }
  async capture(note) {
    const epoch=this.epoch,url=this.view.webContents.getURL();
    const snapshot=await this.script('globalThis.__museAnnotation?.read(true)'), selected=snapshot?.selection;
    if(!selected || !this.state.open)throw new Error('Select an element or region first.');
    selected.viewport=snapshot.viewport;selected.rect=clipRectangle(selected.rect,snapshot.viewport.width,snapshot.viewport.height);
    selected.url=url;selected.title=this.view.webContents.getTitle();
    const contextText=annotationContext(selected,note);
    // CDP's clip uses device-independent pixels, while selection bounds use CSS pixels.
    const zoom=this.view.webContents.getZoomFactor(),clip={x:(selected.rect.x+snapshot.scroll.x)*zoom,y:(selected.rect.y+snapshot.scroll.y)*zoom,width:selected.rect.width*zoom,height:selected.rect.height*zoom,scale:1/zoom};
    const screenshot=await this.view.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:false});
    const latest=await this.script('globalThis.__museAnnotation?.read(true)'), stillSelected=latest?.selection;
    if(this.epoch!==epoch || url!==this.view.webContents.getURL() || !stillSelected || stillSelected.html!==selected.html || JSON.stringify(latest.scroll)!==JSON.stringify(snapshot.scroll) || JSON.stringify(latest.viewport)!==JSON.stringify(snapshot.viewport) || JSON.stringify(clipRectangle(stillSelected.rect,latest.viewport.width,latest.viewport.height))!==JSON.stringify(selected.rect))throw new Error('The page changed. Select it again before adding it to chat.');
    const png=Buffer.from(screenshot.data,'base64');if(!png.length || png.length>10*1024*1024)throw new Error('Screenshot is too large. Select a smaller area and try again.');
    await this.cancel();
    return {mediaType:'image/png',base64Data:png.toString('base64'),name:`Browser: ${selected.title || selected.selector}`.slice(0,200),contextText,sourceUrl:url,note:''};
  }
  async captureComparison() {
    if(!this.state.open || !this.pageReady || this.state.loading || !/^https?:/.test(this.state.url))throw new Error('Open a loaded preview before capturing.');
    await this.cancel();await this.layout();
    const epoch=this.epoch,url=this.view.webContents.getURL();
    const geometry=await this.script('({width:innerWidth,height:innerHeight,x:scrollX,y:scrollY})');
    const source={url,device:this.state.deviceMode,...geometry};
    const screenshot=await this.view.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    const latest=await this.script('({width:innerWidth,height:innerHeight,x:scrollX,y:scrollY})');
    if(epoch!==this.epoch || url!==this.view.webContents.getURL() || JSON.stringify(geometry)!==JSON.stringify(latest))throw new Error('The preview changed during capture. Try again.');
    const png=Buffer.from(screenshot.data,'base64');if(!png.length || png.length>10*1024*1024)throw new Error('Preview screenshot is too large.');
    return {mediaType:'image/png',base64Data:screenshot.data,source,capturedAt:new Date().toISOString()};
  }
  async compare(action) {
    if(action==='compare-before') {
      this.comparisonBefore=await this.captureComparison();this.state.hasComparisonBefore=true;this.publish();return this.state;
    }
    if(!this.comparisonBefore)throw new Error('Capture before again to start a comparison.');
    const after=await this.captureComparison(),before=this.comparisonBefore;
    if(JSON.stringify(before.source)!==JSON.stringify(after.source))throw new Error('The address, device, viewport or scroll position changed. Capture before again.');
    return {before,after};
  }
  async command(action,payload={}) {
    switch(action) {
      case 'state':return this.state;
      case 'open':await this.initialize();this.state.open=true;this.window.setMinimumSize(1080,620);{const [w,h]=this.window.getSize();if(w<1080)this.window.setSize(1080,h);}this.view.setVisible(!this.occluded);this.publish();break;
      case 'occlude':this.occluded=payload.hidden===true;this.view.setVisible(this.state.open && !this.occluded);break;
      case 'close':await this.cancel();this.state.open=false;this.view.setVisible(false);this.window.setMinimumSize(860,620);this.publish();break;
      case 'bounds':{
        const [w,h]=this.window.getContentSize(),zoom=this.window.webContents.getZoomFactor(),rect={};
        for(const field of ['x','y','width','height']){if(!Number.isFinite(payload[field]))throw new Error('Invalid browser rectangle.');rect[field]=payload[field]*zoom;}
        const next=clipRectangle(rect,w,h);
        if(JSON.stringify(next)!==JSON.stringify(this.bounds)){this.bounds=next;await this.cancel();await this.layout();}break;
      }
      case 'device':if(!['desktop','mobile'].includes(payload.mode))throw new Error('Choose Desktop or Mobile.');if(this.state.loading || !this.pageReady)throw new Error('Wait for the page to load before changing its viewport. Reload if the page stopped.');if(payload.mode!==this.state.deviceMode){this.state.deviceMode=payload.mode;await this.cancel();await this.layout();this.publish();}break;
      case 'navigate':return this.navigate(payload.url);
      case 'back':case 'forward':await this.cancel();if(action==='back' && this.view.webContents.navigationHistory.canGoBack())this.view.webContents.navigationHistory.goBack();if(action==='forward' && this.view.webContents.navigationHistory.canGoForward())this.view.webContents.navigationHistory.goForward();break;
      case 'reload':await this.cancel();this.view.webContents.reload();break;
      case 'annotate':return this.annotate(payload.mode);
      case 'cancel':await this.cancel();break;
      case 'capture':return this.capture(payload.note);
      case 'compare-before':case 'compare-after':return this.compare(action);
      default:throw new Error('Unknown browser action.');
    }
    return this.state;
  }
}
