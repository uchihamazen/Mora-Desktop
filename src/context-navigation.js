import {open,lstat,opendir} from 'node:fs/promises';
import {projectFile} from './project.js';
import {checkpointSource} from './checkpoints.js';

const FILE_BYTES=16384,CONTEXT_BYTES=49152,EXCERPT_BYTES=1024;
const excluded=new Set(['.mora','.muse','.codex','.agents','.ssh','.aws','.azure','.config','.git','node_modules','dist','build','artifacts','.next','.nuxt','.output','.cache','cache','caches','tmp','temp','workplans','memories','sessions','user-data','coverage','test-results','playwright-report','.venv','venv','__pycache__','secrets','credentials']);
const binary=/\.(?:png|jpe?g|gif|webp|ico|pdf|mp[34]|mov|avi|webm|wav|ogg|zip|7z|gz|tar|db|sqlite\d?|woff2?|ttf|eot|wasm|bin)$/i;
function eligible(name){
  const parts=name.split('/'),leaf=parts.at(-1);
  return checkpointSource(name)&&!parts.some(part=>excluded.has(part.toLowerCase()))&&!binary.test(leaf)&&
    !/(?:^|[._-])(?:secrets?|credentials?|tokens?)(?:[._-]|$)/i.test(leaf)&&!/^auth\.(?:json|ya?ml|toml|ini|txt)$/i.test(leaf)&&
    !/^service[-_]account\.(?:json|ya?ml)$/i.test(leaf)&&
    !['.envrc','.npmrc','.netrc','.pypirc','id_rsa','id_ed25519','preferences.json','conversations.json','conversations.backup.json'].includes(leaf.toLowerCase());
}
function clip(text,bytes){
  const buffer=Buffer.from(text);if(buffer.length<=bytes)return text;
  return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,Math.max(0,bytes)),{stream:true});
}
function cancelled(signal){signal?.throwIfAborted();}
function reference(value){
  if(!value||!['file','folder'].includes(value.kind)||typeof value.path!=='string'||value.path.length>1024)throw Error('Choose an explicit file or folder reference.');
  let name=value.path.replaceAll('\\','/');
  if(name==='.'&&value.kind==='folder')name='';
  while(name.startsWith('./'))name=name.slice(2);
  if(!name&&value.kind==='file'||!eligible(name))throw Error('This context path is unavailable: secrets, generated files and binary files cannot be attached.');
  return {kind:value.kind,path:name};
}
async function fileText(root,name,signal){
  cancelled(signal);const filename=await projectFile(root,name),before=await lstat(filename);
  if(!before.isFile())throw Error('Choose a text file for file context.');
  let handle;
  try{
    handle=await open(filename,'r');await projectFile(root,name);const info=await handle.stat();
    if(!info.isFile()||info.dev!==before.dev||info.ino!==before.ino)throw Error('Context file changed. Attach it again.');
    const buffer=Buffer.alloc(FILE_BYTES+1);let length=0;
    while(length<buffer.length){cancelled(signal);const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
    cancelled(signal);await projectFile(root,name);
    const truncated=length>FILE_BYTES;
    const data=buffer.subarray(0,Math.min(length,FILE_BYTES));if(data.includes(0))throw Error('Choose a text file; binary context is unavailable.');
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data,{stream:truncated});}catch{throw Error('Context must be valid UTF-8 text.');}
    return {text,truncated};
  }finally{await handle?.close();}
}
async function folderEntries(root,name,signal){
  const entries=[];let visited=0,truncated=false;
  async function walk(folder,depth){
    cancelled(signal);const directory=await projectFile(root,folder);if(!(await lstat(directory)).isDirectory())throw Error('Choose a folder for folder context.');
    const stream=await opendir(directory);
    for await(const item of stream){
      cancelled(signal);if(++visited>1000||entries.length>=200){truncated=true;break;}
      const child=[folder,item.name].filter(Boolean).join('/');if(!eligible(child)||item.isSymbolicLink())continue;
      if(item.isFile())entries.push(child);
      else if(item.isDirectory()){if(depth>=4)truncated=true;else await walk(child,depth+1);}
      if(truncated&&(visited>1000||entries.length>=200))break;
    }
  }
  await walk(name,0);return {entries:entries.sort(),truncated};
}

export async function resolveProjectContext(root,references,{signal}={}){
  cancelled(signal);if(!Array.isArray(references)||references.length>10)throw Error('Attach at most 10 context references.');
  const requested=references.map(reference),entries=[];let text='',truncated=false;
  for(const value of requested){
    cancelled(signal);await projectFile(root,value.path);
    const entry={...value,...await(value.kind==='file'?fileText(root,value.path,signal):folderEntries(root,value.path,signal))};
    const label=`@${value.kind} ${value.path||'.'}`,remaining=CONTEXT_BYTES-Buffer.byteLength(text)-Buffer.byteLength(label)-16;
    if(remaining<0){truncated=true;break;}
    if(entry.kind==='file'){
      const shortened=clip(entry.text,remaining);entry.truncated ||=shortened!==entry.text;entry.text=shortened;
    }else{
      let bytes=0;const listed=[];
      for(const item of entry.entries){const next=Buffer.byteLength(item)+(listed.length?1:0);if(bytes+next>remaining){entry.truncated=true;break;}listed.push(item);bytes+=next;}
      entry.entries=listed;
    }
    text+=label+(entry.truncated?' [truncated]':'')+'\n'+(entry.kind==='file'?entry.text:entry.entries.join('\n'))+'\n\n';entries.push(entry);truncated ||=entry.truncated;
    if(Buffer.byteLength(text)>=CONTEXT_BYTES){truncated ||=entries.length<requested.length;break;}
  }
  cancelled(signal);return {entries,text,bytes:Buffer.byteLength(text),truncated};
}

function searchOptions(query,{limit=50,signal}={}){
  cancelled(signal);if(typeof query!=='string'||query.length>256)throw Error('Keep the search query within 256 characters.');
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Choose a search result limit from 1 to 100.');
  return {query:query.trim().toLowerCase(),limit,signal};
}
function excerpt(text,index){
  let start=Math.max(0,index-120);if(start&&/[\uDC00-\uDFFF]/.test(text[start]))start--;
  return clip((start?'…':'')+text.slice(start),EXCERPT_BYTES);
}
const strings=(value,keys)=>keys.map(key=>value?.[key]).filter(value=>typeof value==='string'&&value).join('\n');
export function searchChatHistory(items,query,options={}){
  const settings=searchOptions(query,options),results=[];let total=0;
  if(!Array.isArray(items))throw Error('Choose a conversation history to search.');
  if(!settings.query)return {results,total,truncated:false};
  for(let index=0;index<items.length;index++){
    cancelled(settings.signal);const item=items[index];if(!item||item.retracted)continue;
    const text=strings(item,['text','description','commandText','visibleOutput','failureReason']),offset=text.toLowerCase().indexOf(settings.query);if(offset<0)continue;
    total++;if(results.length<settings.limit)results.push({itemId:item.itemId,turnId:item.turnId,kind:item.kind,index,excerpt:excerpt(text,offset)});
  }
  return {results,total,truncated:total>results.length};
}
export function searchProjectLogs(logs,query,options={}){
  const settings=searchOptions(query,options),results=[];let total=0;
  if(!settings.query)return {results,total,truncated:false};
  const sources=[{source:'run',record:logs?.run},...(logs?.tests?.results||[]).map((record,index)=>({source:record.script||`check-${index+1}`,record}))];
  for(const {source,record} of sources){
    const text=strings(record,['output','message']).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');let line=0;
    for(const value of text.split(/\r?\n/)){
      cancelled(settings.signal);line++;const offset=value.toLowerCase().indexOf(settings.query);if(offset<0)continue;
      total++;if(results.length<settings.limit)results.push({source,line,status:record.status,excerpt:excerpt(value,offset)});
    }
  }
  return {results,total,truncated:total>results.length};
}

export function buildHandoff({items=[],pendingQueue=[],activeRequest,lastOutcome,moraMode,project,checks}={}){
  const lines=['Handoff — recorded context'],sourceItemIds=[];let truncated=false;
  const section=(title,rows,bytes)=>{
    const full=rows.join('\n'),short=clip(full,bytes-16);truncated ||=short!==full;
    lines.push('\n'+title,short+(short!==full?'\n[truncated]':''));
  };
  if(project)section('Project:',[String(project)],512);
  const decisions=[];
  for(const item of items){
    if(item.retracted||!['userMessage','agentMessage'].includes(item.kind)||typeof item.text!=='string')continue;
    for(const line of item.text.split(/\r?\n/))if(/^\s*(?:[-*]\s*)?(?:Decision|Decided|Selected|قرار|القرار)\s*:/i.test(line))decisions.push({item,line});
  }
  const decisionRows=[];
  for(const {item,line} of decisions.slice(-8)){decisionRows.push(`[${item.itemId}] ${line}`);sourceItemIds.push(item.itemId);}
  section('Recorded decisions (conversation statements):',decisionRows.length?decisionRows:['No recorded decisions.'],3072);
  const request=items.findLast(item=>!item.retracted&&item.kind==='userMessage'&&item.text);
  if(request){section(`Latest request [${request.itemId}]:`,[request.text],2048);sourceItemIds.push(request.itemId);}
  const pending=[];
  if(activeRequest)pending.push(`Active request (${activeRequest.phase||'saved'}): ${activeRequest.text||'(image attachment)'}`);
  for(const queued of pendingQueue.slice(0,10))pending.push(`Queued: ${queued.text||'(image attachment)'}`);truncated ||=pendingQueue.length>10;
  const tasks=moraMode?.tasks||[],unfinished=tasks.filter(task=>task.status!=='success');truncated ||=unfinished.length>20;
  const requests=(moraMode?.requests||[]).filter(request=>['pending','running','interrupted','error'].includes(request.status));truncated ||=requests.length>20;for(const request of requests.slice(0,20))pending.push(`Mora request (${request.status}): ${request.text||'(saved request)'}`);
  for(const task of unfinished.slice(0,20))pending.push(`Task ${task.title||task.id}: ${task.status||'unknown'}${task.detail?' — '+task.detail:''}`);
  section('Pending work:',pending.length?pending:['No recorded pending work.'],4096);
  if(lastOutcome)section('Last recorded request outcome:',[`${lastOutcome.status||'unknown'}${lastOutcome.message?' — '+lastOutcome.message:''}`],512);
  const verification=[];
  if(checks){
    verification.push(`Project checks: ${checks.status||'Not checked'}${checks.previousStatus?' (previously '+checks.previousStatus+')':''}`);
    const records=checks.results||[];truncated ||=records.length>20;
    for(const check of records.slice(0,20))verification.push(`${check.script||check.name||'Check'}: ${check.status||'Not checked'}`);
    if(checks.preview)verification.push('Browser preview: '+(checks.preview.status||'Not checked'));
  }
  truncated ||=tasks.length>20;
  for(const task of tasks.slice(-20))if(task.result){
    verification.push(`Task ${task.title||task.id}: ${task.status||'unknown'}`);const records=task.result.checks||[];truncated ||=records.length>20;
    for(const check of records.slice(0,20))verification.push(`${check.name||'Check'}: ${check.passed===true?'passed':check.passed===false?'failed':'Not checked'}`);
    verification.push('Browser: '+(task.result.browser||'Not checked'));
  }
  section('Recorded verification (historical; rerun after source changes):',verification.length?verification:['Not checked — no verification records supplied.'],4096);
  const full=lines.join('\n'),text=clip(full,16384);return {text,truncated:truncated||text!==full,sourceItemIds:[...new Set(sourceItemIds)]};
}
