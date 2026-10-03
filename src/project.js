import {lstat,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function projectFile(root,name='') {
  if(typeof root!=='string' || !path.isAbsolute(root) || typeof name!=='string' || /[\x00-\x1f:"<>|?*]/.test(name) || path.isAbsolute(name) || name.split(/[\\/]/).some(part=>part==='..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw new Error('Invalid project path.');
  const absolute=path.resolve(root,name),base=path.resolve(root);
  if(absolute!==base && !absolute.startsWith(base+path.sep))throw new Error('File is outside this project.');
  let current=path.parse(absolute).root;
  for(const part of absolute.slice(current.length).split(path.sep)) {
    current=path.join(current,part);
    try {if((await lstat(current)).isSymbolicLink())throw new Error('Linked project paths cannot be changed safely.');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return absolute;
}
export async function createProject(parent,name,{starter=true}={}) {
  if(![true,false,'static'].includes(starter))throw new Error('Choose a Node starter, plain website or empty project.');
  if(typeof name!=='string' || !/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,63}$/u.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name))throw new Error('Use a project name with letters, numbers, spaces, hyphens or underscores.');
  const root=await projectFile(parent,name);
  if(!(await lstat(parent)).isDirectory())throw new Error('Choose a parent folder.');
  try {await mkdir(root);}catch(error){if(error.code==='EEXIST')throw new Error('A folder with this name already exists. Open it or choose another name.');throw error;}
  if(starter)for(const name of starter==='static'?['gitignore.txt','index.html','src/app.js']:['package.json','gitignore.txt','index.html','server.js','build.js','src/app.js','tests/app.test.js']) {
    const target=path.join(root,name==='gitignore.txt'?'.gitignore':name);
    await mkdir(path.dirname(target),{recursive:true});
    await writeFile(target,await readFile(fileURLToPath(new URL(`./starter/${name}`,import.meta.url))),{flag:'wx'});
  }
  return root;
}
export async function projectScripts(root) {
  const filename=await projectFile(root,'package.json');let text;
  try {text=await readFile(filename,'utf8');}catch(error){
    if(error.code!=='ENOENT')throw error;
    try{if((await lstat(await projectFile(root,'index.html'))).isFile())return {start:'static',checks:[],scripts:{},manager:'static',flowScript:null};}catch(missing){if(missing.code!=='ENOENT')throw missing;}
    return {start:null,checks:[],scripts:{},manager:'npm'};
  }
  if(text.length>512000)throw new Error('Project package.json is too large.');
  const pkg=JSON.parse(text),scripts={};
  for(const [name,value] of Object.entries(pkg.scripts || {}))if(/^[a-zA-Z0-9_:-]{1,80}$/.test(name) && typeof value==='string' && value.trim() && value.length<=8000)scripts[name]=value;
  const flowScript=scripts['test:flows']?'test:flows':scripts['test:e2e']?'test:e2e':null;
  const checks=[scripts.typecheck?'typecheck':scripts.check?'check':null,scripts.build?'build':null,scripts.test?'test':null,flowScript].filter(Boolean);
  const manager=/^(npm|pnpm|yarn)@/.exec(pkg.packageManager || '')?.[1] || 'npm';
  return {start:['dev','start','serve'].find(name=>scripts[name]) || null,checks,scripts,manager,flowScript};
}
