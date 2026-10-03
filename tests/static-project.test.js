import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createProject,projectScripts} from '../src/project.js';
import {ProjectRunner} from '../src/project-work.js';

test('plain static projects run using Mora runtime, preserve edits and leave behavior coverage unknown',async()=>{
 const parent=await mkdtemp(path.join(tmpdir(),'mora-static-'));let worker;
 try{
  const root=await createProject(parent,'Plain site',{starter:'static'});
  await assert.rejects(import('node:fs/promises').then(fs=>fs.readFile(path.join(root,'package.json'))),/ENOENT/);
  assert.equal((await projectScripts(root)).manager,'static');
  worker=new ProjectRunner(()=>{},{occupied:async()=>new Set(),startupMs:5000});await worker.run(root);
  for(let i=0;i<150&&worker.state.run.status==='starting';i++)await new Promise(r=>setTimeout(r,30));
  assert.equal(worker.state.run.status,'ready',worker.state.run.message);
  const url=worker.state.run.url;assert.match(await(await fetch(url)).text(),/Something good starts here/);
  await writeFile(path.join(root,'hello.css'),'body { color: red }');assert.equal((await fetch(url+'hello.css')).headers.get('content-type'),'text/css; charset=utf-8');
  await writeFile(path.join(root,'index.html'),'<h1>Later edit</h1>');assert.match(await(await fetch(url)).text(),/Later edit/);
  await writeFile(path.join(root,'.env'),'PRIVATE');await writeFile(path.join(root,'auth.json'),'PRIVATE');
  await mkdir(path.join(root,'public','.private'),{recursive:true});await writeFile(path.join(root,'public','.private','settings.json'),'PRIVATE');assert.notEqual((await fetch(url+'public%5c.private%5csettings.json')).status,200,'Encoded Windows separators must not expose hidden folders');
  for(const file of ['.env','auth.json','../.env','%2e%2e%2f.env'])assert.notEqual((await fetch(url+file)).status,200);
  const outside=path.join(parent,'outside');await mkdir(outside);await writeFile(path.join(outside,'index.html'),'OUTSIDE');
  await symlink(outside,path.join(root,'linked'),'junction');assert.notEqual((await fetch(url+'linked/index.html')).status,200);
  await rm(path.join(root,'linked'));await worker.test(root);assert.equal(worker.state.tests.status,'not configured');assert.equal(worker.state.tests.interactions,'not checked');
  await worker.stopRun();await assert.rejects(fetch(url));
 }finally{await worker?.shutdown();await rm(parent,{recursive:true,force:true});}
});
