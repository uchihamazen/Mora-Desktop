import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {once} from 'node:events';
const require=createRequire(import.meta.url);
const {_electron}=require('./runtime-packages.cjs').runtimeRequire('playwright');

// Initialize the hidden native view before Playwright attaches to all pages.
export async function launchDesktop(packaged,env) {
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  let launchError;const launching=_electron.launch({executablePath:packaged || require('electron'),args:[...(packaged?[]:['.']),`--remote-debugging-port=${port}`],cwd:process.cwd(),env,timeout:40000}).catch(error=>{launchError=error;});
  const deadline=Date.now()+35000;let target,bootstrapError;
  while(!target && !launchError && Date.now()<deadline){try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.url.endsWith('/index.html'));}catch{}if(!target)await new Promise(resolve=>setTimeout(resolve,100));}
  if(target) {
    const socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
    try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Browser initialization timed out')),10000);socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id===1){clearTimeout(timer);message.result?.exceptionDetails?reject(Error('Browser initialization failed')):resolve();}});socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:"window.muse.browserCommand('open').then(()=>window.muse.browserCommand('close'))",awaitPromise:true}}));});}catch(error){bootstrapError=error;}finally{socket.close();}
  }
  const app=await launching;
  if(launchError || bootstrapError){await app?.close();throw launchError || bootstrapError;}
  return app;
}
