import {readFile,mkdir,readdir,stat,lstat,rename,rm,open} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {snapshotProject} from './changes.js';
import {projectFile} from './project.js';

const digest=value=>value===undefined?null:createHash('sha256').update(value).digest('hex');
const excluded=new Set(['.git','.ssh','node_modules','.next','.cache','.venv','venv','__pycache__','coverage']);
const compiledOutput=/\.(?:exe|dll|pdb|msi|msix|appx|obj|o|lib|a|so|dylib|pyc|class)$/i;
function checkpointPath(name) {
  const parts=name.replaceAll('\\','/').split('/'),leaf=parts.at(-1).toLowerCase();
  return !parts.some(part=>excluded.has(part.toLowerCase())) && !['dist','build','artifacts'].includes(parts[0].toLowerCase()) &&
    !/^\.env(?:\.|$)/i.test(leaf) && !/\.(?:pem|key|pfx|p12)$/i.test(leaf) &&
    !['credentials.json','credential.json','tokens.json','auth.json','secrets.json','.npmrc','.netrc'].includes(leaf);
}
export const checkpointSource=name=>checkpointPath(name)&&!compiledOutput.test(name);
async function atomic(file,data) {
  await mkdir(path.dirname(file),{recursive:true});const temp=`${file}.${randomUUID()}.tmp`;
  try {const handle=await open(temp,'wx');try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}await rename(temp,file);}
  finally{await rm(temp,{force:true});}
}
export class Checkpoints {
  constructor(profile,root,{write=atomic}={}) {
    this.root=path.resolve(root);this.directory=path.join(profile,'checkpoints',digest(this.root));this.write=write;this.previews=new Map();
  }
  file(id) {if(!/^[0-9a-f-]{36}$/.test(id))throw new Error('Choose a valid checkpoint.');return path.join(this.directory,`${id}.json`);}
  async physical(name) {
    const file=await projectFile(this.root,name);let handle;
    try {
      const info=await lstat(file);if(!info.isFile() || info.size>2*1024*1024)throw new Error('File changed or exceeds checkpoint limits.');
      handle=await open(file,'r');const buffer=Buffer.alloc(2*1024*1024+1);let length=0;
      while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
      if(length>2*1024*1024)throw new Error('File changed or exceeds checkpoint limits.');return buffer.subarray(0,length);
    }catch(error){if(error.code==='ENOENT')return undefined;throw error;}
    finally{await handle?.close();}
  }
  async snapshot({extraPaths=[]}={}) {
    await projectFile(this.root);const snapshot=await snapshotProject(this.root,{filter:checkpointSource,refuseLinks:true});
    for(const name of snapshot.files.keys())await projectFile(this.root,name);
    for(const name of extraPaths){if(!checkpointSource(name))throw new Error('Excluded checkpoint path.');const data=await this.physical(name);if(data!==undefined)snapshot.files.set(name,data);}
    if(snapshot.files.size>5000 || [...snapshot.files.values()].reduce((total,data)=>total+data.length,0)>32*1024*1024)snapshot.partial=true;
    if(snapshot.partial)throw new Error('A complete checkpoint could not be saved. Remove linked or oversized source files before allowing changes.');
    return snapshot;
  }
  summary(value) {return {id:value.id,label:value.label,createdAt:value.createdAt,fileCount:Object.keys(value.files).length,manual:value.manual,sealed:value.sealed};}
  async load(id) {
    const file=this.file(id);if((await stat(file)).size>48*1024*1024)throw new Error('Checkpoint is too large.');
    const value=JSON.parse(await readFile(file,'utf8'));
    if(value.root!==this.root || value.id!==id || !value.files || typeof value.files!=='object')throw new Error('This checkpoint does not belong to this project.');
    return value;
  }
  async create(label,{manual=true,extraPaths=[]}={}) {
    const snapshot=await this.snapshot({extraPaths});await mkdir(this.directory,{recursive:true});let bytes=0;
    for(const name of await readdir(this.directory))if(name.endsWith('.json'))bytes+=(await stat(path.join(this.directory,name))).size;
    const value={id:randomUUID(),root:this.root,label:String(label || 'Saved checkpoint').slice(0,100),createdAt:new Date().toISOString(),manual,sealed:false,files:Object.fromEntries([...snapshot.files].map(([name,data])=>[name,data.toString('base64')]))};
    const data=JSON.stringify(value);if(bytes+Buffer.byteLength(data)>256*1024*1024)throw new Error('Checkpoint storage is full. Delete an old checkpoint before allowing changes.');
    await atomic(this.file(value.id),data);return this.summary(value);
  }
  async seal(id) {
    const value=await this.load(id),snapshot=await this.snapshot({extraPaths:await this.sourcePaths(Object.keys(value.files))});value.expected=Object.fromEntries([...snapshot.files].map(([name,data])=>[name,digest(data)]));value.sealed=true;
    await atomic(this.file(id),JSON.stringify(value));return this.summary(value);
  }
  async list() {
    try {const values=[];for(const name of await readdir(this.directory))if(/^[0-9a-f-]{36}\.json$/.test(name))values.push(this.summary(await this.load(name.slice(0,-5))));return values.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
    catch(error){if(error.code==='ENOENT')return [];throw error;}
  }
  async delete(id) {await this.load(id);await rm(this.file(id));}
  async sourcePaths(names) {
    const source=[];
    for(const name of names){
      if(!checkpointPath(name))throw Error('Checkpoint contains an excluded path.');
      await projectFile(this.root,name);
      // Older checkpoints included small compiled outputs; source recovery now leaves them alone.
      if(!compiledOutput.test(name))source.push(name);
    }
    return source;
  }
  async preview(id) {
    const value=await this.load(id),current=await this.snapshot(),before=Object.fromEntries((await this.sourcePaths(Object.keys(value.files))).map(name=>[name,digest(Buffer.from(value.files[name],'base64'))]));
    const scoped=value.sealed && !value.manual,expected=scoped?Object.fromEntries((await this.sourcePaths(Object.keys(value.expected))).map(name=>[name,value.expected[name]])):Object.fromEntries([...current.files].map(([name,data])=>[name,digest(data)]));
    if(!scoped)for(const name of Object.keys(before))expected[name]=digest(await this.physical(name));
    const changes=[];
    for(const name of [...new Set([...Object.keys(before),...Object.keys(expected)])].sort()) {
      if(!checkpointSource(name))throw new Error('Checkpoint contains an excluded path.');await projectFile(this.root,name);
      if((before[name]??null)===(expected[name]??null))continue;
      const actual=digest(await this.physical(name));if(actual===(before[name]??null))continue;
      changes.push({path:name,status:before[name]===undefined?'remove':actual===null?'restore deleted':'restore original',conflict:(!value.manual&&!value.sealed)||actual!==(expected[name]??null),hash:actual});
    }
    const token=randomUUID();this.previews.set(token,{id,changes,expires:Date.now()+10*60*1000});
    for(const [key,item] of this.previews)if(item.expires<Date.now())this.previews.delete(key);
    return {token,checkpoint:this.summary(value),changes:changes.map(({hash,...item})=>item)};
  }
  async restore({token,paths,allowConflicts=false}) {
    const preview=this.previews.get(token);if(!preview || preview.expires<Date.now())throw new Error('Restore preview expired. Preview it again.');
    if(!Array.isArray(paths) || !paths.length || new Set(paths).size!==paths.length)throw new Error('Select the files to restore.');
    const selected=paths.map(name=>{const item=preview.changes.find(item=>item.path===name);if(!item)throw new Error('File was not included in the preview.');return item;});
    if(selected.some(item=>item.conflict)&&!allowConflicts)throw new Error('Some files have newer edits. Explicitly acknowledge replacing them.');
    const unchanged=async item=>{if(digest(await this.physical(item.path))!==item.hash)throw new Error('Files changed since the preview. Preview again before restoring.');};
    for(const item of selected)await unchanged(item);
    const value=await this.load(preview.id),recovery=await this.create(`Before restore: ${value.label}`,{manual:true,extraPaths:paths});
    this.previews.delete(token);
    try {
      for(const item of selected)await unchanged(item);
      for(const item of selected) {
        await unchanged(item);
        const filename=await projectFile(this.root,item.path),data=value.files[item.path];
        if(data===undefined)await rm(filename,{force:true});
        else {await mkdir(path.dirname(filename),{recursive:true});await projectFile(this.root,item.path);await this.write(filename,Buffer.from(data,'base64'));}
      }
      await this.seal(recovery.id);return {restored:selected.length,recovery:recovery.id};
    }catch(error){await this.seal(recovery.id).catch(()=>{});throw new Error(`Restore could not finish. Recovery checkpoint ${recovery.id} preserves your earlier files. ${error.message}`);}
  }
}
