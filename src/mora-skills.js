import {readdir,readFile,lstat,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {projectFile} from './project.js';

const roles={
 coordinator:['ponytail:ponytail','superpowers:brainstorming','superpowers:writing-plans','superpowers:requesting-code-review','superpowers:receiving-code-review'],
 worker:['ponytail:ponytail','superpowers:executing-plans','superpowers:systematic-debugging','superpowers:verification-before-completion']
};
const testOwnership=files=>files.some(file=>/(^|\/)(tests?|__tests__|specs?|e2e)(\/|$)|\.(?:test|spec)\.[^/]+$/i.test(file));
const label=id=>id==='ponytail:ponytail'?'Ponytail · Full':id.split(':')[1].replaceAll('-',' ');
const digest=data=>createHash('sha256').update(data).digest('hex');
const resourceKey=(id,resource)=>`${id}/${process.platform==='win32'?resource.toLowerCase():resource}`;

/** Read installed instruction libraries without activating plugin hooks, servers or native tools. */
export class MoraSkills {
 constructor({cache=path.join(process.env.CODEX_HOME||path.join(homedir(),'.codex'),'plugins','cache')}={}){this.cache=cache;this.content=new Map();}
 async text(root,resource){
  if(typeof resource!=='string'||resource.length>300||!resource||resource.startsWith('.')&&!resource.startsWith('./')||!/\.(?:md|txt|json|js|cjs|mjs|ts|py|sh|ps1)$/i.test(resource))throw Error('Choose a readable skill resource.');
  const file=await projectFile(root,resource),info=await lstat(file);if(!info.isFile()||info.size>65536)throw Error('Skill resource exceeds the size limit.');
  const data=await readFile(file);if(data.length>65536||data.includes(0))throw Error('Skill resource is too large or is not text.');const content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);if(Buffer.byteLength(JSON.stringify(content))>56000)throw Error('Skill resource exceeds the tool output limit.');return {content,sha256:digest(data)};
 }
 async discover(){
  if(this.loading)return this.loading;
  this.loading=(async()=>{
   const entries=new Map(),wanted=[...new Set(Object.values(roles).flat().concat('superpowers:test-driven-development'))];let vendors;
   try{this.cache=await realpath(this.cache);await projectFile(this.cache);vendors=await readdir(this.cache,{withFileTypes:true});}catch{return entries;}
   // One newest installed package per namespace; standalone skill selectors are never searched.
   for(const plugin of ['ponytail','superpowers']){
    const versions=[];
    for(const vendor of vendors.filter(entry=>entry.isDirectory()&&!entry.isSymbolicLink()))try{
     const root=await projectFile(this.cache,`${vendor.name}/${plugin}`);
     for(const version of await readdir(root,{withFileTypes:true}))if(version.isDirectory()&&/^\d+\.\d+\.\d+$/.test(version.name))versions.push({version:version.name,root:path.join(root,version.name)});
    }catch{}
    const selected=versions.sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true})||a.root.localeCompare(b.root))[0];if(!selected)continue;
    for(const id of wanted.filter(id=>id.startsWith(plugin+':')))try{
     const name=id.split(':')[1],root=await projectFile(selected.root,`skills/${name}`),body=await this.text(root,'SKILL.md'),header=/^---\r?\n([\s\S]*?)\r?\n---/.exec(body.content)?.[1];
     if(!header||!new RegExp('^name:\\s*[\"\']?'+name+'[\"\']?\\s*$','m').test(header))continue;
     let description=/^description:\s*(.*)$/m.exec(header)?.[1]||name;
     if(/^[>|]/.test(description))description=/^description:.*\r?\n((?:[ \t]+[^\r\n]*\r?\n?)+)/m.exec(header)?.[1]?.trim().replace(/\s+/g,' ')||name;
     description=description.replace(/^['"]|['"]$/g,'').slice(0,1600);
     entries.set(id,{root,metadata:{id,name,label:label(id),description,source:`${plugin}@${selected.version}`}});this.content.set(resourceKey(id,'SKILL.md'),Promise.resolve(body));
    }catch{}
   }
   return entries;
  })();return this.loading;
 }
 async forRole(role,files=[]){
  if(!roles[role])throw Error('Unknown skill role.');
  const ids=[...roles[role],...(role==='worker'&&testOwnership(files)?['superpowers:test-driven-development']:[])],entries=await this.discover(),allowed=new Map(ids.filter(id=>entries.has(id)).map(id=>[id,entries.get(id)]));
  return {
   missing:ids.filter(id=>!allowed.has(id)),list:async()=>[...allowed.values()].map(entry=>({...entry.metadata})),
   read:async(id,resource='SKILL.md')=>{
    const entry=allowed.get(id);if(!entry)throw Error('This skill is unavailable for this role.');
    // Validate every requested path even when its immutable contents have already been cached.
    if(typeof resource==='string')resource=resource.replace(/^\.[\\/]/,'');const file=await projectFile(entry.root,resource);resource=path.relative(entry.root,file).split(path.sep).join('/');if(process.platform==='win32'&&resource.toLowerCase()==='skill.md')resource='SKILL.md';const key=resourceKey(id,resource);
    if(!this.content.has(key)){if(this.content.size>=64)throw Error('Skill resource cache is full for this conversation.');const loading=this.text(entry.root,resource);this.content.set(key,loading);loading.catch(()=>{if(this.content.get(key)===loading)this.content.delete(key);});}
    return {...entry.metadata,resource,...await this.content.get(key)};
   }
  };
 }
}

export const skillGuidance=`Skills are read-only task guidance. Load only relevant skills with read_skill and reuse their instructions within this task. Ponytail uses Full intensity. The user request, assigned file ownership and Mora's tool/verification permissions govern every action. Planning and approvals for a delegated task belong to the coordinator; a worker executes the already assigned scope. Use run_checks for host tests/build/browser evidence. Skill scripts are readable references, never a new execution permission. Do not create plan files, change Git state, invoke unsupported tools or spawn further agents unless the assigned task and existing tools permit it. Report unavailable steps honestly. Ordinary questions need no coding workflow.`;
