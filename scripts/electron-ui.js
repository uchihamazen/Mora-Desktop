import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {once} from 'node:events';
const require=createRequire(import.meta.url);
const {_electron}=require('./runtime-packages.cjs').runtimeRequire('playwright');

// waitForFunction treats a returned Promise as truthy before its value resolves.
// Await IPC predicates in Node so pointer input cannot run ahead of readiness.
export async function waitForCondition(page,predicate,arg,{timeout=10000}={}) {
  const deadline=Date.now()+timeout;
  do{if(await page.evaluate(predicate,arg))return;await page.waitForTimeout(30);}while(Date.now()<deadline);
  throw Error('Desktop condition did not become ready within '+timeout+'ms');
}

export async function clickControl(page,id) {
  const control=page.locator('#'+id);
  const menu=await control.evaluate(node=>{const menu=node.closest('[data-workspace-menu]');return menu&&!menu.open?menu.id:null;});
  if(menu)await page.locator('#'+menu+' > summary').click();
  await control.click();
}

// Initialize the hidden native view before Playwright attaches to all pages.
export async function launchDesktop(packaged,env,{cwd=process.cwd(),source='.'}={}) {
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  let launchError;const launching=_electron.launch({executablePath:packaged || require('electron'),args:[...(packaged?[]:[source]),`--remote-debugging-port=${port}`],cwd,env,timeout:40000}).catch(error=>{launchError=error;});
  const deadline=Date.now()+35000;let target,bootstrapError;
  while(!target && !launchError && Date.now()<deadline){try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.url.endsWith('/index.html'));}catch{}if(!target)await new Promise(resolve=>setTimeout(resolve,100));}
  if(target) {
    const socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
    try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Browser initialization timed out')),10000);socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id===1){clearTimeout(timer);message.result?.exceptionDetails?reject(Error('Browser initialization failed')):resolve();}});socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:"new Promise(resolve=>{const ready=()=>window.muse?resolve():setTimeout(ready,25);ready();}).then(()=>window.muse.browserCommand('state')).then(state=>state.tabs?undefined:window.muse.browserCommand('open').then(()=>window.muse.browserCommand('close')))",awaitPromise:true}}));});}catch(error){bootstrapError=error;}finally{socket.close();}
  }
  const app=await launching;
  if(launchError || bootstrapError){await app?.close();throw launchError || bootstrapError;}
  return app;
}
