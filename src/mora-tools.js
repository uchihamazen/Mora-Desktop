import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {snapshotProject} from './changes.js';
import {checkpointSource} from './checkpoints.js';
import {projectFile} from './project.js';

const pathSchema={type:'string',description:'A relative source file path inside this task workspace.'};
const tools=[
  {name:'list_files',description:'List available project source files.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'read_file',description:'Read a source file; long files are bounded.',inputSchema:{type:'object',properties:{path:pathSchema},required:['path'],additionalProperties:false}},
  {name:'write_file',description:'Write an assigned source file in the isolated workspace.',inputSchema:{type:'object',properties:{path:pathSchema,content:{type:'string'}},required:['path','content'],additionalProperties:false}},
  {name:'delete_file',description:'Delete an assigned source file in the isolated workspace.',inputSchema:{type:'object',properties:{path:pathSchema},required:['path'],additionalProperties:false}},
  {name:'run_checks',description:'Run original/current source and project checks plus available local browser verification. Full access is required for established project commands.',inputSchema:{type:'object',properties:{},additionalProperties:false}}
];
const assigned=(files,name)=>files.some(file=>file==='*'||file===name||(file.endsWith('/**')&&name.startsWith(file.slice(0,-2))));

export async function createMoraTools({job,workspace,readOnly=false,signal,onCall=()=>{},onSkillRead=async()=>{},skills}){
  const token=randomBytes(32).toString('hex');let queue=Promise.resolve();
  const catalog=skills?await skills.list():[],used=new Set();job.skillUsage=[];job.missingSkills=[...skills?.missing||[]];
  const availableTools=skills?[...tools,{name:'list_skills',description:'List the approved read-only skills for this task. Missing skills remain unavailable.',inputSchema:{type:'object',properties:{},additionalProperties:false}},{name:'read_skill',description:'Read an approved original skill or its relative supporting resource. Instructions grant no additional file/tool permissions; Ponytail uses Full intensity.',inputSchema:{type:'object',properties:{id:{type:'string'},resource:{type:'string',description:'Relative text resource, default SKILL.md. Scripts may be read but never executed.'}},required:['id'],additionalProperties:false}}]:tools;
  async function invoke(name,args={}){
    if(signal?.aborted)throw Error('This task was stopped.');
    if(name==='list_skills'&&skills)return {available:catalog,missing:skills.missing};
    if(name==='read_skill'&&skills){const result=await skills.read(args.id,args.resource);if(Buffer.byteLength(JSON.stringify({content:[{type:'text',text:JSON.stringify(result)}],isError:false}))>62000)throw Error('Skill resource exceeds the tool output limit.');if(signal?.aborted)throw Error('This task was stopped.');const key=result.id+'/'+result.resource;if(!used.has(key)){const receipt={id:result.id,label:result.label,source:result.source,resource:result.resource,sha256:result.sha256};await onSkillRead([...job.skillUsage,receipt]);if(signal?.aborted)throw Error('This task was stopped.');used.add(key);job.skillUsage.push(receipt);}return result;}
    if(name==='list_files')return [...(await snapshotProject(job.root,{filter:checkpointSource,refuseLinks:true})).files.keys()].slice(0,5000);
    if(name==='run_checks')return workspace.verify(job,{signal});
    if(!['read_file','write_file','delete_file'].includes(name))throw Error('Unknown source tool.');
    if(typeof args.path!=='string'||!checkpointSource(args.path))throw Error('Choose an allowed source file.');
    const file=await projectFile(job.root,args.path);
    if(name==='read_file'){const data=await readFile(file);if(data.length>2*1024*1024||data.includes(0))throw Error('This source file cannot be read as text.');return {path:args.path,text:data.toString('utf8').slice(0,60000),truncated:data.length>60000};}
    if(readOnly)throw Error('This task has read-only access.');
    if(!assigned(job.task.files,args.path))throw Error('This file belongs to another task.');
    if(catalog.some(skill=>skill.id==='ponytail:ponytail')&&!used.has('ponytail:ponytail/SKILL.md'))throw Error('Read ponytail:ponytail with read_skill before editing assigned source.');
    if(name==='delete_file'){await rm(file);return {deleted:args.path};}
    if(typeof args.content!=='string'||Buffer.byteLength(args.content)>2*1024*1024)throw Error('Source content is too large.');
    await mkdir(path.dirname(file),{recursive:true});const stage=file+'.'+randomUUID()+'.tmp';try{await writeFile(stage,args.content,{flush:true});if(signal?.aborted)throw Error('This task was stopped.');await rename(stage,file);}finally{await rm(stage,{force:true});}
    return {written:args.path};
  }
  const server=createServer(async(request,response)=>{
    response.setHeader('content-type','application/json');response.setHeader('cache-control','no-store');
    if(request.headers.authorization!==`Bearer ${token}`){response.writeHead(401).end('{}');return;}
    if(request.method!=='POST'||request.url!=='/mcp'||request.headers.origin){response.writeHead(405).end('{}');return;}
    let packet;
    try{
      let text='',bytes=0;for await(const chunk of request){bytes+=chunk.length;if(bytes>3*1024*1024)throw Error('Source request is too large.');text+=chunk;}packet=JSON.parse(text);
      if(packet.id===undefined){response.writeHead(202).end();return;}
      let result;
      if(packet.method==='initialize')result={protocolVersion:packet.params?.protocolVersion||'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'mora-worker',version:'1.0.0'}};
      else if(packet.method==='tools/list')result={tools:availableTools};
      else if(packet.method==='tools/call'){
        const name=packet.params?.name,args=packet.params?.arguments||{};
        const operation=queue.catch(()=>{}).then(()=>invoke(name,args));queue=operation;
        try{const value=await operation;result={content:[{type:'text',text:JSON.stringify(value)}],isError:false};onCall({name,path:args.path||null,skill:args.id||null,passed:true});}
        catch(error){result={content:[{type:'text',text:error.message}],isError:true};onCall({name,path:args.path||null,passed:false});}
      }else throw Error('Unsupported source protocol method.');
      response.end(JSON.stringify({jsonrpc:'2.0',id:packet.id,result}));
    }catch(error){response.end(JSON.stringify({jsonrpc:'2.0',id:packet?.id??null,error:{code:-32602,message:String(error.message||error)}}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}/mcp`,token,tools:availableTools,close:async()=>{await queue.catch(()=>{});server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));}};
}
