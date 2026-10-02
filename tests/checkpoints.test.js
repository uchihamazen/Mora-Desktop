import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Checkpoints} from '../src/checkpoints.js';

async function fixture(fn) {
  const temp=await mkdtemp(path.join(tmpdir(),'mora-checkpoint-')),root=path.join(temp,'project'),profile=path.join(temp,'profile');
  await mkdir(root);try{await fn(root,profile);}finally{await rm(temp,{recursive:true,force:true});}
}
test('a checkpoint preserves dirty originals, additions and deletions across restart',()=>fixture(async(root,profile)=>{
  await writeFile(path.join(root,'dirty.txt'),'uncommitted original');await writeFile(path.join(root,'deleted.txt'),'keep this');
  const store=new Checkpoints(profile,root);const checkpoint=await store.create('Before request',{manual:false});
  await writeFile(path.join(root,'dirty.txt'),'AI edit');await writeFile(path.join(root,'new.txt'),'AI addition');await rm(path.join(root,'deleted.txt'));await store.seal(checkpoint.id);
  const restarted=new Checkpoints(profile,root),preview=await restarted.preview(checkpoint.id);
  assert.deepEqual(preview.changes.map(file=>file.path),['deleted.txt','dirty.txt','new.txt']);assert.equal(preview.changes.some(file=>file.conflict),false);
  await restarted.restore({token:preview.token,paths:preview.changes.map(file=>file.path)});
  assert.equal(await readFile(path.join(root,'dirty.txt'),'utf8'),'uncommitted original');assert.equal(await readFile(path.join(root,'deleted.txt'),'utf8'),'keep this');await assert.rejects(readFile(path.join(root,'new.txt')));
}));
test('later edits require explicit selection and acknowledgement; stale previews never write',()=>fixture(async(root,profile)=>{
  await writeFile(path.join(root,'app.js'),'before');await writeFile(path.join(root,'other.js'),'untouched');const store=new Checkpoints(profile,root);
  const cp=await store.create('Before request',{manual:false});await writeFile(path.join(root,'app.js'),'AI edit');await store.seal(cp.id);
  await writeFile(path.join(root,'app.js'),'later user work');await writeFile(path.join(root,'other.js'),'unrelated user work');
  const first=await store.preview(cp.id);assert.equal(first.changes[0].conflict,true);assert.equal(first.changes.length,1);
  await assert.rejects(store.restore({token:first.token,paths:['app.js']}),/newer/i);
  await writeFile(path.join(root,'app.js'),'even newer work');await assert.rejects(store.restore({token:first.token,paths:['app.js'],allowConflicts:true}),/changed/i);
  const next=await store.preview(cp.id);await store.restore({token:next.token,paths:['app.js'],allowConflicts:true});
  assert.equal(await readFile(path.join(root,'other.js'),'utf8'),'unrelated user work');
}));
test('secret/generated files are excluded and unsafe/incomplete snapshots cannot protect edits',()=>fixture(async(root,profile)=>{
  await mkdir(path.join(root,'dist'));await writeFile(path.join(root,'dist','output.js'),'generated');await writeFile(path.join(root,'.env'),'private');await writeFile(path.join(root,'app.js'),'source');
  const store=new Checkpoints(profile,root),cp=await store.create('Snapshot');assert.equal(cp.fileCount,1);
  await writeFile(path.join(root,'large.js'),Buffer.alloc(2*1024*1024+1));await assert.rejects(store.create('Incomplete'),/complete/i);await rm(path.join(root,'large.js'));
  await mkdir(path.join(root,'outside'));await symlink(path.join(root,'outside'),path.join(root,'linked'),'junction');await assert.rejects(store.create('Linked'),/complete|linked/i);
}));
test('partial restore failures retain a recovery checkpoint and never erase unaffected files',()=>fixture(async(root,profile)=>{
  for(const name of ['a.js','b.js'])await writeFile(path.join(root,name),'before');
  const store=new Checkpoints(profile,root),cp=await store.create('Before request',{manual:false});for(const name of ['a.js','b.js'])await writeFile(path.join(root,name),'after');await store.seal(cp.id);
  const preview=await store.preview(cp.id);const failing=new Checkpoints(profile,root,{write:async(file,data)=>{if(file.endsWith('b.js'))throw new Error('file locked');await writeFile(file,data);}});
  const other=await failing.preview(cp.id);await assert.rejects(failing.restore({token:other.token,paths:preview.changes.map(file=>file.path)}),/recovery checkpoint/i);
  assert.ok((await store.list()).some(item=>item.label.startsWith('Before restore')));
  assert.equal(await readFile(path.join(root,'b.js'),'utf8'),'after');
}));

test('ignore changes never hide later content or invalidate restore hashes',()=>fixture(async(root,profile)=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');await promisify(execFile)('git',['init',root],{windowsHide:true});
 await writeFile(path.join(root,'a.txt'),'before');const store=new Checkpoints(profile,root),cp=await store.create('Before',{manual:false});
 await rm(path.join(root,'a.txt'));await writeFile(path.join(root,'.gitignore'),'a.txt');await store.seal(cp.id);await writeFile(path.join(root,'a.txt'),'later ignored work');
 let preview=await store.preview(cp.id);assert.equal(preview.changes.find(x=>x.path==='a.txt').conflict,true);
 await writeFile(path.join(root,'a.txt'),'newer ignored work');await assert.rejects(store.restore({token:preview.token,paths:['a.txt'],allowConflicts:true}),/changed/i);
 preview=await store.preview(cp.id);const result=await store.restore({token:preview.token,paths:['a.txt'],allowConflicts:true});
 const recovery=await store.preview(result.recovery);await store.restore({token:recovery.token,paths:['a.txt'],allowConflicts:true});assert.equal(await readFile(path.join(root,'a.txt'),'utf8'),'newer ignored work');
}));
test('edits made while saving recovery or between selected writes survive',()=>fixture(async(root,profile)=>{
 for(const file of ['a.js','b.js'])await writeFile(path.join(root,file),'before');const original=new Checkpoints(profile,root),cp=await original.create('Before',{manual:false});
 for(const file of ['a.js','b.js'])await writeFile(path.join(root,file),'after');await original.seal(cp.id);
 const saving=new Checkpoints(profile,root),create=saving.create.bind(saving);saving.create=async(...args)=>{const result=await create(...args);await writeFile(path.join(root,'b.js'),'edit during recovery');return result;};
 let preview=await saving.preview(cp.id);await assert.rejects(saving.restore({token:preview.token,paths:['a.js','b.js']}),/changed|recovery/i);assert.equal(await readFile(path.join(root,'b.js'),'utf8'),'edit during recovery');
 await writeFile(path.join(root,'b.js'),'after');const writing=new Checkpoints(profile,root,{write:async(file,data)=>{await writeFile(file,data);if(file.endsWith('a.js'))await writeFile(path.join(root,'b.js'),'edit between writes');}});
 preview=await writing.preview(cp.id);await assert.rejects(writing.restore({token:preview.token,paths:['a.js','b.js']}),/changed|recovery/i);assert.equal(await readFile(path.join(root,'b.js'),'utf8'),'edit between writes');
}));
