import {readFile,writeFile,mkdir,rename,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const STITCH_URL='https://stitch.googleapis.com/mcp';
const object=value=>value && typeof value==='object' && !Array.isArray(value);
function keyValue(key) {
  if(typeof key!=='string' || !/^[A-Za-z0-9._-]{8,512}$/.test(key.trim()))throw new Error('Enter the Stitch API key from your account settings.');
  return key.trim();
}
export async function readStitchSettings(filename) {
  let raw;
  try{raw=await readFile(filename,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  let config;
  try{config=raw===undefined ? {schema_version:1} : JSON.parse(raw);}catch{throw new Error('Muse settings are unreadable. Fix the existing settings file before connecting Stitch.');}
  if(!object(config) || config.schema_version!==1)throw new Error('Muse settings must use schema_version 1.');
  if(config.mcpServers!==undefined && config.mcp_servers!==undefined)throw new Error('Ambiguous Muse MCP settings: both mcpServers and mcp_servers exist.');
  const root=config.mcp_servers!==undefined ? 'mcp_servers' : 'mcpServers';
  if(config[root]!==undefined && !object(config[root]))throw new Error('Muse MCP settings must be an object.');
  return {raw,config,root,server:config[root]?.stitch};
}
export function stitchStatus(server) {
  return {configured:!!(server && server.url===STITCH_URL && server.enabled!==false && server.headers?.['X-Goog-Api-Key']),endpoint:STITCH_URL};
}
export async function configureStitch(filename,key) {
  if(key!==null)key=keyValue(key);
  const {raw,config,root}=await readStitchSettings(filename);
  config[root] ||= {};
  if(key===null)delete config[root].stitch;
  else config[root].stitch={type:'streamable-http',url:STITCH_URL,headers:{'X-Goog-Api-Key':key},required:false,startup_timeout_sec:15,tool_timeout_sec:300};
  await mkdir(path.dirname(filename),{recursive:true});
  const suffix=`${Date.now()}-${randomUUID()}`,temp=`${filename}.${suffix}.tmp`,backupPath=raw===undefined ? null : `${filename}.before-stitch-${suffix}.backup`;
  try{
    await writeFile(temp,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
    const latest=await readFile(filename,'utf8').catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
    if(latest!==raw)throw new Error('Muse settings changed while connecting. Try again.');
    if(backupPath)await copyFile(filename,backupPath);
    await rename(temp,filename);
  }finally{await rm(temp,{force:true}).catch(()=>{});}
  return {...stitchStatus(config[root].stitch),backupPath};
}
async function reply(response,id) {
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
  const events=(response.headers.get('content-type') || '').includes('text/event-stream');
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      size+=value.length;if(size>2*1024*1024)throw new Error('Stitch returned too much connection data.');text+=decoder.decode(value,{stream:true});
      if(events){
        const frames=text.replaceAll('\r\n','\n').split('\n\n');text=frames.pop();
        for(const frame of frames){const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(data){const result=JSON.parse(data);if(result.id===id)return result;}}
      }
    }
    if(!events)return JSON.parse(text);
    throw new Error('Stitch did not return the requested connection result.');
  }finally{await reader.cancel().catch(()=>{});}
}
export async function checkStitch(key,fetch=globalThis.fetch) {
  key=keyValue(key);let id=0,session;const signal=AbortSignal.timeout(30000);
  async function rpc(method,params,notification=false) {
    const requestId=notification ? undefined : ++id;
    const response=await fetch(STITCH_URL,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','X-Goog-Api-Key':key,...(session ? {'Mcp-Session-Id':session} : {})},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal,redirect:'error'});
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw new Error(response.status===401 || response.status===403 ? 'Stitch rejected this key or account access. Check your Stitch API key and permissions.' : `Stitch connection failed (HTTP ${response.status}). Try again later.`);}
    session=response.headers.get('mcp-session-id') || session;
    if(notification){await response.body?.cancel().catch(()=>{});return;}
    const result=await reply(response,requestId);
    if(result.id!==requestId || result.error || !result.result || result.result.isError)throw new Error('Stitch could not verify this account. Check the key, service quota and account access.');
    return result.result;
  }
  try{
    await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'muse-desktop',version:'0.1.0'}});
    await rpc('notifications/initialized',{},true);
    const catalog=await rpc('tools/list',{}),tools=(catalog.tools || []).map(tool=>tool.name).filter(name=>typeof name==='string');
    if(!['generate_screen_from_text','edit_screens','list_projects'].every(name=>tools.includes(name)))throw new Error('Stitch did not expose the expected design tools.');
    const listing=await rpc('tools/call',{name:'list_projects',arguments:{}});
    let data=listing.structuredContent;
    if(!data){const text=listing.content?.find(item=>item.type==='text')?.text;try{data=JSON.parse(text);}catch{throw new Error('Stitch returned an unreadable project listing.');}}
    return {tools,projectCount:Array.isArray(data?.projects) ? data.projects.length : 0};
  }catch(error){if(error.name==='TimeoutError' || error.name==='AbortError')throw new Error('Stitch connection timed out. Try again.');if(error.message.includes(key))throw new Error('Stitch connection failed. Check your key and try again.');throw error;}
}
