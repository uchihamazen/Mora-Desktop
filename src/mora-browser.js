import {mkdir,access,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {serveStatic} from './static-server.cjs';
import {projectScripts} from './project.js';
import {ProjectRunner,scriptCommand} from './project-work.js';
import {verificationCopy,checkEnvironment,checkTemporary,sourceDigest,commandConfigurationChanged} from './mora-checks.js';

function httpEntry(files,command){
 const queue=[...files.keys()].filter(name=>/\.(?:[cm]?[jt]sx?|py)$/i.test(name)&&command.replaceAll('\\','/').includes(name)),seen=new Set();
 while(queue.length){
  const name=queue.pop();if(seen.has(name))continue;seen.add(name);const data=files.get(name);if(!data||data.length>512000)continue;const source=data.toString();
  if(/(?:\bcreateServer\s*\(|\b(?:express|fastify|Flask|FastAPI)\s*\(|\b(?:app|server)\.listen\s*\()/.test(source))return true;
  for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)){
   const imported=path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1]));
   const target=['','.js','.mjs','.cjs','.ts','.tsx','/index.js','/index.ts'].map(extension=>imported+extension).find(file=>files.has(file));if(target)queue.push(target);
  }
 }
 return false;
}
// Keep the original web-app requirement even if a worker removes its identifying files.
export function browserRequired(baseline,candidate,built=false){
 if(built)return true;
 for(const files of [baseline,candidate]){
  if([...files.keys()].some(name=>/^index\.html?$/i.test(name)))return true;
  let pkg;try{pkg=JSON.parse(files.get('package.json')?.toString()||'{}');}catch{continue;}
  const command=['dev','start','serve'].map(name=>pkg.scripts?.[name]).find(value=>typeof value==='string'&&value.trim());if(!command)continue;
  if(/(?:^|[\s;&|/\\])(?:vite(?:press)?|next|nuxt|nuxi|astro|react-scripts|vue-cli-service|webpack-dev-server|http-server|serve|ng\s+serve)(?:\s|$)/i.test(command))return true;
  if(!/[;&|]/.test(command)&&/(?:^|\s)(?:tsup|tsc|rollup|esbuild|babel|swc)(?:\s|$)/i.test(command))continue;
  const packages={...pkg.dependencies,...pkg.devDependencies};
  if(['next','nuxt','astro','vite','react','react-dom','vue','svelte','preact','solid-js','@sveltejs/kit','@angular/core','@vue/cli-service','react-scripts','express','fastify','koa','hono'].some(name=>Object.hasOwn(packages,name)))return true;
  if([...files.keys()].some(name=>/\.(?:jsx|tsx|vue|svelte)$|(?:^|\/)(?:vite|next|nuxt|astro|svelte)\.config\.[^/]+$|(?:^|\/)angular\.json$/i.test(name)))return true;
  if(httpEntry(files,command))return true;
 }
 return false;
}

export function browserPlan(data){
 if(!data)return null;let value;try{value=JSON.parse(data.toString());}catch{throw Error('Invalid .mora/verification.json.');}
 const plan=value.browser;if(!plan)return null;
 if(!plan||typeof plan!=='object'||!Array.isArray(plan.steps)||!plan.steps.length||plan.steps.length>20||JSON.stringify(plan).length>32000)throw Error('Browser verification needs 1–20 bounded steps.');
 const location=plan.path||'/';if(typeof location!=='string'||!location.startsWith('/')||location.startsWith('//')||/[\\\x00-\x1f]/.test(location))throw Error('Browser verification requires a local path.');
 for(const step of plan.steps){
  if(!step||!['click','fill','select','press','assert'].includes(step.action)||!((typeof step.role==='string'&&typeof step.name==='string'&&step.name.trim())||(typeof step.label==='string'&&step.label.trim()))||[step.role,step.name,step.label,step.value,step.expected].some(v=>v!==undefined&&(typeof v!=='string'||v.length>2000)))throw Error('Browser steps need a semantic role/name or label and bounded text.');
  if(step.action==='assert'&&(!['text','value','visible','checked'].includes(step.check)||typeof step.expected!=='string'||['visible','checked'].includes(step.check)&&!['true','false'].includes(step.expected)))throw Error('Browser assertions need text, value, visible or checked expectations.');
  if(['fill','select','press'].includes(step.action)&&typeof step.value!=='string')throw Error('This browser action needs a value.');
  if(step.action==='press'&&!['Enter','Tab','Escape','ArrowDown','ArrowUp','Space'].includes(step.value))throw Error('Unsupported verification key.');
 }
 if(!plan.steps.some(step=>step.action==='assert'))throw Error('A browser workflow needs an outcome assertion.');
 return {path:location,steps:plan.steps};
}
async function assertion(locator,step,timeout){
 const deadline=Date.now()+timeout;let actual,error;
 do{
  try{
   if(step.check==='visible')actual=String(await locator.isVisible());
   else if(step.check==='checked')actual=String(await locator.isChecked({timeout:Math.min(timeout,500)}));
   else if(step.check==='value')actual=await locator.inputValue({timeout:Math.min(timeout,500)});
   else actual=(await locator.innerText({timeout:Math.min(timeout,500)})).trim();
   if(actual===step.expected)return {passed:true,actual};
  }catch(cause){error=cause.message;}
  await new Promise(resolve=>setTimeout(resolve,50));
 }while(Date.now()<deadline);
 return {passed:false,actual,error};
}
export async function browserChecks(workspace,job,files,{signal}={}){
 const raw=job.baseline.get('.mora/verification.json');let plan;
 try{plan=browserPlan(raw);}catch(error){return {name:'Browser verification plan',passed:false,output:error.message,status:'failed',summary:'Failed',kind:'workflow'};}
 if(files.get('.mora/verification.json')?.toString()!==raw?.toString())return {name:'Browser verification plan',passed:false,output:'The worker changed browser requirements. Review this configuration separately.',status:'failed',summary:'Failed',kind:'workflow'};
 if(commandConfigurationChanged(job,files))return {name:'Browser preview configuration',passed:false,output:'The worker changed project commands. Preview execution refused.',status:'failed',summary:'Failed',kind:'none'};
 let built=null;if(job.buildPassed&&job.checkRoot)try{await access(path.join(job.checkRoot,'dist','index.html'));built=path.join(job.checkRoot,'dist');}catch{}
 if(!plan&&!job.browserRequired&&!browserRequired(job.baseline,files,!!built))return {status:'not checked',summary:'Not checked',kind:'none',reason:'No supported browser app or baseline browser workflow.'};
 const root=built?job.checkRoot:await verificationCopy(workspace,job,files),directory=path.join(job.directory,'browser-'+path.basename(root)),temporary=await checkTemporary();await mkdir(directory,{recursive:true});
 const result={name:'Browser '+(plan?'workflow':'smoke'),kind:plan?'workflow':'smoke',status:'failed',passed:false,summary:'Failed',steps:[],output:''},errors=[],blocked=[];
 let server,runner,browser,context,page,tracing=false,cancelled=false;
 const stop=()=>{cancelled=true;context?.close().catch(()=>{});runner?.stopRun().catch(()=>{});};signal?.addEventListener('abort',stop,{once:true});
 const timer=setTimeout(stop,workspace.browserTimeoutMs||45000);
 const before=await sourceDigest(root);
 try{
  if(signal?.aborted)throw Error('Task verification stopped.');
  const config=await projectScripts(root);let url;
  if(built){server=await serveStatic(built);url=`http://127.0.0.1:${server.address().port}/`;}
  else if(config.start&&config.start!=='static'){
   if(!job.projectCommands)throw Error('Starting this project preview requires Full access.');
   runner=new ProjectRunner(()=>{},{command:async(...args)=>{const settings=await scriptCommand(...args);settings.env=checkEnvironment(temporary);return settings;},startupMs:15000});await runner.run(root);
   while(runner.state.run.status==='starting'&&!cancelled)await new Promise(resolve=>setTimeout(resolve,50));
   if(runner.state.run.status!=='ready')throw Error(runner.state.run.message);url=runner.state.run.url;
  }else{server=await serveStatic(root);url=`http://127.0.0.1:${server.address().port}/`;}
  if(cancelled||signal?.aborted)throw Error('Browser verification stopped.');
  const options={headless:true,...workspace.browserOptions};
  try{browser=await chromium.launch(options);}catch(error){if(options.channel||options.executablePath)throw error;browser=await chromium.launch({...options,channel:'msedge'});}
  context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block',acceptDownloads:false});context.setDefaultTimeout(workspace.browserAssertionMs||2500);
  const origin=new URL(url).origin,allowed=value=>{try{return new URL(value).origin===origin;}catch{return false;}};
  await context.route('**/*',async route=>{
   const request=route.request();if(!allowed(request.url())){blocked.push(request.url().slice(0,500));return route.abort();}
   let response;
   try{
    response=await route.fetch({maxRedirects:0,timeout:10000});const location=response.headers().location;
    // Redirected requests bypass Playwright routing; refuse them instead of losing origin or URL semantics.
    if([301,302,303,307,308].includes(response.status())&&location){const target=new URL(location,request.url()).href;if(!allowed(target))blocked.push(target.slice(0,500));throw Error('Preview redirects are unsupported. Configure the canonical page path or remove the redirect.');}
    await route.fulfill({response});
   }catch(error){errors.push('Preview request failed: '+error.message.slice(0,500));await route.abort().catch(()=>{});}finally{await response?.dispose();}
  });
  await context.routeWebSocket('**/*',socket=>{const target=socket.url().replace(/^ws:/,'http:').replace(/^wss:/,'https:');if(!allowed(target)){blocked.push(socket.url().slice(0,500));socket.close();}else socket.connectToServer();});
  await context.tracing.start({screenshots:true,snapshots:true,sources:false});tracing=true;
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message.slice(0,1000)));page.on('console',message=>{if(message.type()==='error')errors.push(message.text().slice(0,1000));});page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));page.on('download',download=>download.cancel().catch(()=>{}));context.on('page',popup=>{if(popup!==page)popup.close().catch(()=>{});});
  const response=await page.goto(new URL(plan?.path||'/',url).href,{waitUntil:'load',timeout:15000});if(!response?.ok())throw Error('The local preview did not load successfully.');
  await page.locator('body').waitFor({state:'visible'});
  for(const step of plan?.steps||[]){
   if(cancelled||signal?.aborted)throw Error('Task verification stopped.');
   const locator=step.label?page.getByLabel(step.label,{exact:true}):page.getByRole(step.role,{name:step.name,exact:true});let outcome;
   if(step.action==='click')await locator.click();else if(step.action==='fill')await locator.fill(step.value);else if(step.action==='select')await locator.selectOption({label:step.value});else if(step.action==='press')await locator.press(step.value);
   else{outcome=await assertion(locator,step,workspace.browserAssertionMs||2500);if(!outcome.passed){result.steps.push({step,...outcome});throw Error('Browser outcome failed: '+(step.name||step.label));}}
   result.steps.push({step,passed:true,...outcome});
  }
  await page.screenshot({path:path.join(directory,'screen.png'),fullPage:true,timeout:5000});result.screenshot=path.join(directory,'screen.png');
  if(!allowed(page.url())||blocked.length)throw Error('Browser dependencies or navigation left the owned local preview.');
  if(errors.length)throw Error('Browser runtime errors: '+errors.join('\n'));
  if(cancelled||signal?.aborted)throw Error('Browser verification stopped.');
  result.passed=true;result.status='passed';result.summary=plan?'Workflow passed':'Smoke passed';result.output=plan?'All configured browser assertions passed.':'Local page loaded without observed runtime errors. Interactions were not checked.';
 }catch(error){if(signal?.aborted)throw Error('Task verification stopped.');result.output=error.message;result.reason=error.message;}
 finally{
  clearTimeout(timer);signal?.removeEventListener('abort',stop);
  if(page&&!page.isClosed()&&!result.screenshot)try{result.screenshot=path.join(directory,'screen.png');await page.screenshot({path:result.screenshot,timeout:3000});}catch{delete result.screenshot;}
  if(tracing&&context)try{if(!result.passed){result.trace=path.join(directory,'trace.zip');await context.tracing.stop({path:result.trace});}else await context.tracing.stop();}catch{delete result.trace;}
  await browser?.close();await runner?.shutdown();if(server)await new Promise(resolve=>server.close(resolve));
  if(await sourceDigest(root)!==before){result.passed=false;result.status='failed';result.summary='Failed';result.output+='\nSource changed while preview ran. Delivery refused.';}
  await rm(path.join(root,'node_modules'),{recursive:true,force:true});
  await rm(temporary,{recursive:true,force:true});
 }
 result.errors=errors;result.blocked=blocked;return result;
}
