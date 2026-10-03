import {open,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {projectFile} from './project.js';

const name='.mora/project-brief.md',writes=new Map();
const revision=text=>createHash('sha256').update(text).digest('hex');
export async function readProjectBrief(root) {
  const file=await projectFile(root,name);let handle;
  try {
    handle=await open(file,'r');const buffer=Buffer.alloc(96001);let length=0;
    while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
    const text=buffer.subarray(0,length).toString('utf8');
    if(length>96000 || text.length>24000)throw Error('Project brief is too large. Keep it within 24000 characters.');
    return {text,revision:revision(text)};
  }catch(error){if(error.code==='ENOENT')return {text:'',revision:null};throw error;}
  finally{await handle?.close();}
}
export function saveProjectBrief(root,value) {
  const operation=(writes.get(root)||Promise.resolve()).catch(()=>{}).then(async()=>{
    if(typeof value?.text!=='string' || value.text.length>24000)throw Error('Keep the project brief within 24000 characters.');
    const file=await projectFile(root,name),temp=`${file}.${randomUUID()}.tmp`;
    if((await readProjectBrief(root)).revision!==value.revision)throw Error('The project brief changed. Reload it before saving; your text is still in the editor.');
    await mkdir(path.dirname(file),{recursive:true});
    try {
      await projectFile(root,name);await writeFile(temp,value.text,{flag:'wx',flush:true});
      if((await readProjectBrief(root)).revision!==value.revision)throw Error('The project brief changed. Reload before saving.');
      await projectFile(root,name);await rename(temp,file);return {text:value.text,revision:revision(value.text)};
    }finally{await rm(temp,{force:true});}
  });
  writes.set(root,operation);operation.finally(()=>{if(writes.get(root)===operation)writes.delete(root);}).catch(()=>{});return operation;
}
