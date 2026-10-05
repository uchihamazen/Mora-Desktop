import {mkdir,mkdtemp,writeFile,symlink,rm,readdir,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {snapshotProject} from './changes.js';
import {checkpointSource} from './checkpoints.js';
import {projectFile,projectScripts} from './project.js';
import {ProjectRunner,scriptCommand} from './project-work.js';

export async function sourceDigest(root){
 const snapshot=await snapshotProject(root,{filter:checkpointSource,refuseLinks:true});if(snapshot.partial)throw Error('Verification source is incomplete.');
 return filesDigest(snapshot.files);
}
export const filesDigest=files=>createHash('sha256').update(JSON.stringify([...files].sort(([a],[b])=>a.localeCompare(b)).map(([name,data])=>[name,createHash('sha256').update(data).digest('hex')]))).digest('hex');
// Keep Windows package-manager home/cache paths short, even when the isolated project path is long.
export const checkTemporary=()=>mkdtemp(path.join(tmpdir(),'mora-check-'));
export const noTestsExecuted=output=>/(?:#|ℹ) tests 0\b|no test(?: files?| suites?| cases?)?s? (?:found|collected)|collected 0 items/i.test(output);
export function commandConfigurationChanged(job,candidate){
 try{const original=JSON.parse(job.baseline.get('package.json')?.toString()||'{}'),current=JSON.parse(candidate.get('package.json')?.toString()||'{}'),canonical=scripts=>JSON.stringify(Object.entries(scripts||{}).sort(([a],[b])=>a.localeCompare(b)));return canonical(original.scripts)!==canonical(current.scripts)||original.packageManager!==current.packageManager;}catch{return true;}
}
export function checkEnvironment(temporary){
 const env={};for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','ComSpec','COMSPEC','PATHEXT','WINDIR','NUMBER_OF_PROCESSORS'])if(process.env[key])env[key]=process.env[key];
 return {...env,CI:'true',BROWSER:'none',FORCE_COLOR:'0',TEMP:temporary,TMP:temporary,TMPDIR:temporary,HOME:temporary,USERPROFILE:temporary,APPDATA:temporary,LOCALAPPDATA:temporary,XDG_CONFIG_HOME:temporary,XDG_DATA_HOME:temporary,XDG_STATE_HOME:temporary,npm_config_cache:path.join(temporary,'npm-cache')};
}
export async function verificationCopy(workspace,job,files){
 // Package-manager processes cannot start from very deep Windows task paths.
 const root=path.join(workspace.profile,'checks-'+randomUUID().slice(0,8));await mkdir(root);(job.checkCopies||=[]).push(root);
 for(const [name,data] of files){const target=await projectFile(root,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data);}
 // Only host-owned check copies reuse installed dependencies. Worker source tools cannot reach this link.
 try{
  const installed=path.join(workspace.project,'node_modules'),entries=await readdir(installed,{withFileTypes:true}),modules=path.join(root,'node_modules');await mkdir(modules);
  for(const entry of entries){if(['.cache','.vite','.vite-temp'].includes(entry.name))continue;const source=path.join(installed,entry.name),target=path.join(modules,entry.name);if(entry.name==='.bin'||entry.isFile())await cp(source,target,{recursive:true});else await symlink(source,target,process.platform==='win32'?'junction':'dir');}
 }catch(error){if(error.code!=='ENOENT')throw error;}
 return root;
}
function originalInputs(job,candidate,scripts){
 const files=new Map(candidate),commands=Object.values(scripts).join('\n').replaceAll('\\','/');
 const protectedInput=name=>name==='package.json'||name==='.mora/verification.json'||/(^|\/)(tests?|__tests__|__snapshots__|specs?|e2e|fixtures?|scripts|checks)(\/|$)|(?:test|spec|config)\.[^.]+$|(^|\/)(?:test_.*\.py|.*_test\.py|tsconfig[^/]*\.json|.*lock[^/]*)$/i.test(name)||commands.includes(name);
 for(const name of files.keys())if(protectedInput(name)&&!job.baseline.has(name))files.delete(name);
 for(const [name,data] of job.baseline)if(protectedInput(name))files.set(name,data);
 return files;
}
async function commandCheck(root,settings,{signal,timeoutMs=120000}={}){
 if(signal?.aborted)throw Error('Task verification stopped.');
 const runner=new ProjectRunner(()=>{});let output='',timedOut=false;
 const child=runner.launch(root,settings,text=>{output=(output+text).slice(-12000);}),stop=()=>runner.terminate(child).catch(()=>{});
 signal?.addEventListener('abort',stop,{once:true});const timer=setTimeout(()=>{timedOut=true;stop();},timeoutMs);
 try{if(signal?.aborted)stop();const result=await runner.children.get(child);if(signal?.aborted)throw Error('Task verification stopped.');return {passed:!timedOut&&!result.error&&result.code===0,output:output+(timedOut?'\nCheck timed out.':result.error?'\n'+result.error:''),code:result.code};}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);await runner.terminate(child);}
}
export async function projectChecks(workspace,job,candidate,{signal}={}){
 let baseline;try{baseline=JSON.parse(job.baseline.get('package.json')?.toString()||'{}');}catch{return [{name:'Project check configuration',passed:false,output:'Original package.json is invalid.'}];}
 const scripts=baseline.scripts||{},names=[scripts.typecheck?'typecheck':scripts.check?'check':null,scripts.build?'build':null,scripts.test?'test':null,scripts['test:flows']?'test:flows':scripts['test:e2e']?'test:e2e':null].filter(Boolean);
 const python=[...job.baseline.keys()].filter(name=>/(^|\/)(test_[^/]+|[^/]+_test)\.py$/.test(name));
 const checks=[];
 if(commandConfigurationChanged(job,candidate))return [{name:'Established project commands',passed:false,output:'The worker changed project commands. Review this configuration separately.'}];
 if(!names.length&&!python.length)return checks;
 if(!job.projectCommands&&names.length===1&&names[0]==='test'&&/^node(?:\.exe)?\s+--test\s*$/.test(scripts.test)&&[...job.baseline.keys()].some(name=>/\.(?:test|spec)\.[cm]?js$/i.test(name)))return [];
 if(!job.projectCommands)return [{name:'Project-native checks',passed:false,output:'Project-native checks need Full access. Changes remain isolated.'}];
 const original=originalInputs(job,candidate,scripts),sameInputs=original.size===candidate.size&&[...original].every(([name,data])=>candidate.get(name)?.equals(data));
 for(const [phase,files] of sameInputs?[['Original/current',candidate]]:[['Original',original],['Current',candidate]]){
  const frozen=new Map(files);if(job.baseline.has('package.json')){const manifest=JSON.parse(files.get('package.json')?.toString()||'{}');frozen.set('package.json',Buffer.from(JSON.stringify({...manifest,scripts,packageManager:baseline.packageManager})));}
  const root=await verificationCopy(workspace,job,frozen),temporary=await checkTemporary();
  const currentPhase=phase!=='Original';if(currentPhase)job.checkRoot=root;
  try{
   const config=await projectScripts(root);
   for(const name of names){
    const before=await sourceDigest(root);let result;
    try{const settings=await scriptCommand(root,config.manager,name);settings.env=checkEnvironment(temporary);result=await commandCheck(root,settings,{signal,timeoutMs:workspace.checkTimeoutMs});}catch(error){if(signal?.aborted)throw error;result={passed:false,output:error.message};}
    if(await sourceDigest(root)!==before){result.passed=false;result.output+='\nSource changed while checks ran. Delivery refused.';}
    if(name.startsWith('test')&&result.passed&&noTestsExecuted(result.output)){result.passed=false;result.output+='\nNo tests executed. Delivery refused.';}
    checks.push({name:`${phase} project: ${name}`,...result});
    if(currentPhase&&name==='build')job.buildPassed=result.passed;
    if(!result.passed)break;
   }
   if(!names.length&&python.length){
    const before=await sourceDigest(root),directory=python.every(name=>name.startsWith('tests/'))?'tests':'.';let result;
    try{result=await commandCheck(root,{file:'python',args:['-B','-m','unittest','discover','-s',directory],env:checkEnvironment(temporary)},{signal,timeoutMs:workspace.checkTimeoutMs});if(result.passed&&!/Ran [1-9]\d* tests?\b/.test(result.output)){result.passed=false;result.output+='\nNo unittest cases executed. Configure the project test command.';}}catch(error){if(signal?.aborted)throw error;result={passed:false,output:'Python checks unavailable: '+error.message};}
    if(await sourceDigest(root)!==before){result.passed=false;result.output+='\nSource changed while checks ran. Delivery refused.';}checks.push({name:`${phase} Python unittest`,...result});
   }
  }finally{await rm(path.join(root,'node_modules'),{recursive:true,force:true});await rm(temporary,{recursive:true,force:true});}
 }
 return checks;
}
