import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const api=await import('../src/project-export.js').catch(()=>({}));
const exec=promisify(execFile);
async function entries(file){
 const code="Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:MORA_TEST_ZIP); try { @($z.Entries | ForEach-Object { $r=[IO.StreamReader]::new($_.Open()); try { @{name=$_.FullName;data=$r.ReadToEnd()} } finally { $r.Dispose() } }) | ConvertTo-Json -Compress } finally { $z.Dispose() }";
 return JSON.parse((await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,env:{...process.env,MORA_TEST_ZIP:file}})).stdout);
}
test('project export contains runnable source and instructions, excluding known secrets and local tooling',async()=>{
 const parent=await mkdtemp(path.join(tmpdir(),'mora-export-'));
 try{
  const root=path.join(parent,'App');await mkdir(root);await writeFile(path.join(root,'index.html'),'<h1>Shared app</h1>');
  for(const folder of ['node_modules','.git','.mora','.codex']){await mkdir(path.join(root,folder));await writeFile(path.join(root,folder,'private.txt'),'PRIVATE');}
  for(const name of ['.env','auth.json','AGENTS.md','AGENTS.override.md','old.zip'])await writeFile(path.join(root,name),'PRIVATE');
  const zip=path.join(parent,'App.zip');assert.equal(typeof api.exportProject,'function');const result=await api.exportProject(root,zip);
  const values=await entries(zip);assert.deepEqual(values.map(v=>v.name).sort(),['App/MORA-RUN-INSTRUCTIONS.txt','App/index.html']);
  assert.equal(values.find(v=>v.name.endsWith('index.html')).data,'<h1>Shared app</h1>');assert.match(values.find(v=>v.name.endsWith('.txt')).data,/Run my app/);assert.equal(result.fileCount,1);
  assert.equal(await readFile(path.join(root,'index.html'),'utf8'),'<h1>Shared app</h1>');assert.equal(result.sha256.length,64);
 }finally{await rm(parent,{recursive:true,force:true});}
});
test('incomplete or linked source refuses export and preserves an existing destination',async()=>{
 const parent=await mkdtemp(path.join(tmpdir(),'mora-export-refuse-'));
 try{
  const root=path.join(parent,'App');await mkdir(root);const zip=path.join(parent,'keep.zip');await writeFile(zip,'KEEP');
  await writeFile(path.join(root,'too-large.js'),Buffer.alloc(2*1024*1024+1));await assert.rejects(api.exportProject(root,zip),/complete|large|limits/i);assert.equal(await readFile(zip,'utf8'),'KEEP');
  await rm(path.join(root,'too-large.js'));const outside=path.join(parent,'outside');await mkdir(outside);await writeFile(path.join(outside,'outside.txt'),'OUTSIDE');await symlink(outside,path.join(root,'linked'),'junction');await assert.rejects(api.exportProject(root,zip),/complete|link|limits/i);assert.equal(await readFile(zip,'utf8'),'KEEP');
 }finally{await rm(parent,{recursive:true,force:true});}
});

test('generated export instructions cannot collide with existing source names on Windows',async()=>{
 const parent=await mkdtemp(path.join(tmpdir(),'mora-export-names-'));
 try{
  const root=path.join(parent,'App');await mkdir(root);await writeFile(path.join(root,'index.html'),'<h1>App</h1>');await writeFile(path.join(root,'mora-run-instructions.txt'),'USER SOURCE');await mkdir(path.join(root,'mora-run-instructions-2.txt'));await writeFile(path.join(root,'mora-run-instructions-2.txt','user.js'),'USER DIRECTORY');
  const zip=path.join(parent,'app.zip');await api.exportProject(root,zip);const values=await entries(zip),names=values.map(v=>v.name.toLowerCase());assert.equal(new Set(names).size,names.length,'ZIP paths must be unique on Windows');assert.equal(values.find(v=>v.name.endsWith('mora-run-instructions.txt')).data,'USER SOURCE');assert.ok(values.some(v=>v.name.endsWith('MORA-RUN-INSTRUCTIONS-3.txt')));
 }finally{await rm(parent,{recursive:true,force:true});}
});
