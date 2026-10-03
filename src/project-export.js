import {mkdtemp,readFile,writeFile,rm,rename,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {snapshotProject} from './changes.js';
import {checkpointSource} from './checkpoints.js';
import {projectFile,projectScripts} from './project.js';
const exec=promisify(execFile);
export function exportSource(name){
 const parts=name.replaceAll('\\','/').split('/'),leaf=parts.at(-1).toLowerCase();
 return checkpointSource(name)&&!parts.some(part=>['.mora','.muse','.codex','.agents','.superpowers','.cursor','.vscode','.idea'].includes(part.toLowerCase()))&&
  !['agents.md','agents.override.md','claude.md','gemini.md','memory.md','preferences.json','conversations.json','conversations.backup.json'].includes(leaf)&&!/\.(zip|7z|bak|log|tmp|db|sqlite|sqlite3)$/i.test(leaf);
}
export async function exportProject(root,destination){
 if(typeof destination!=='string'||!path.isAbsolute(destination)||!destination.toLowerCase().endsWith('.zip'))throw Error('Choose a local ZIP filename.');
 await projectFile(root);const snapshot=await snapshotProject(root,{filter:exportSource,refuseLinks:true});
 if(snapshot.partial)throw Error('A complete source export could not be captured. It supports up to 5,000 files, 2 MiB per file and 32 MiB total; linked files cannot be included.');
 if(!snapshot.files.size)throw Error('This project has no eligible source to export.');
 for(const name of snapshot.files.keys())await projectFile(root,name);
 const config=await projectScripts(root),folder=path.basename(root).replace(/[^\p{L}\p{N} _-]/gu,'').trim()||'project';
 const names=new Set([...snapshot.files.keys()].map(name=>name.toLowerCase()));
 const collision=name=>names.has(name.toLowerCase())||[...names].some(file=>file.startsWith(name.toLowerCase()+'/'));
 let instructions='MORA-RUN-INSTRUCTIONS.txt';for(let i=2;collision(instructions);i++)instructions='MORA-RUN-INSTRUCTIONS-'+i+'.txt';
 const commands=config.manager==='static'?['Open this folder in Mora Desktop and choose Run my app. The plain website preview needs no Node.js or package manager installation.']:['Install Node.js and '+config.manager+' on the receiving computer.','Install the dependencies using '+config.manager+' install.',config.start?'Start: '+config.manager+' run '+config.start:'No Run script is configured. Add dev, start or serve to package.json.',...config.checks.map(script=>'Check: '+config.manager+' run '+script)];
 const note=['Exported project source','',...commands,'','Only assertions in configured test scripts are covered.','Common secret files, dependencies, generated output, runtime databases and local chat/tool data are excluded. Review your source before sharing.',''].join('\n');
 const entries=[...snapshot.files].map(([name,data])=>({name:folder+'/'+name.replaceAll('\\','/'),data:data.toString('base64')}));
 entries.push({name:folder+'/'+instructions,data:Buffer.from(note).toString('base64')});
 const directory=await mkdtemp(path.join(tmpdir(),'mora-project-export-')),temporary=destination+'.'+randomUUID()+'.tmp';
 try{
  const manifest=path.join(directory,'source.json');await writeFile(manifest,JSON.stringify(entries));
  const command=await readFile(new URL('./project-export.ps1',import.meta.url),'utf8');
  await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:60000,maxBuffer:64000,env:{...process.env,MORA_EXPORT_MANIFEST:manifest,MORA_EXPORT_DESTINATION:temporary}});
  const bytes=await readFile(temporary),sha256=createHash('sha256').update(bytes).digest('hex');await rename(temporary,destination);
  return {destination,fileCount:snapshot.files.size,bytes:(await stat(destination)).size,sha256};
 }finally{await rm(temporary,{force:true});await rm(directory,{recursive:true,force:true});}
}
