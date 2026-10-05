import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Checkpoints} from '../src/checkpoints.js';
import {sourceHunks,rejectHunk} from '../src/review-controls.js';
async function fixture(t) {const root=await mkdtemp(path.join(tmpdir(),'mora-review-')),project=path.join(root,'project');await mkdir(project);t.after(()=>rm(root,{recursive:true,force:true}));return {root,project,store:new Checkpoints(path.join(root,'profile'),project)};}
test('reject a file with recovery, keep decision and refuse newer manual edits',async t=>{
  const {project,store}=await fixture(t),file=path.join(project,'a.js');await writeFile(file,'before\n');const checkpoint=await store.create('request',{manual:false});await writeFile(file,'after\n');await store.seal(checkpoint.id);
  let review=await store.review(checkpoint.id,'a.js');await store.decideReview({token:review.token,action:'keep'});assert.equal((await store.review(checkpoint.id,'a.js')).decision,'Kept');
  review=await store.review(checkpoint.id,'a.js');await writeFile(file,'manual\n');await assert.rejects(store.decideReview({token:review.token,action:'reject'}),/newer edits/);assert.equal(await readFile(file,'utf8'),'manual\n');assert.equal((await store.review(checkpoint.id,'a.js')).stale,true);
  await writeFile(file,'after\n');review=await store.review(checkpoint.id,'a.js');const result=await store.decideReview({token:review.token,action:'reject'});assert.equal(await readFile(file,'utf8'),'before\n');assert.ok(result.recovery);assert.equal((await store.load(result.recovery)).files['a.js'],Buffer.from('after\n').toString('base64'));
});
test('reject one separate hunk and preserve CRLF and a missing final newline',async t=>{
  const {project}=await fixture(t),before=Buffer.from('old\r\n'+Array.from({length:12},(_,i)=>`line ${i}\r\n`).join('')+'tail'),after=Buffer.from('new\r\n'+Array.from({length:12},(_,i)=>`line ${i}\r\n`).join('')+'changed');
  const hunks=await sourceHunks(project,'a.txt',before,after);assert.equal(hunks.length,2);const rejected=rejectHunk(after,hunks[0]);assert.equal(rejected.toString(),'old\r\n'+Array.from({length:12},(_,i)=>`line ${i}\r\n`).join('')+'changed');
  assert.equal(rejectHunk(rejected,hunks[1]).toString(),before.toString());
});
test('hunk rejection and deletion/new file reviews are guarded by the whole file revision',async t=>{
  const {project,store}=await fixture(t);const checkpoint=await store.create('request',{manual:false});await writeFile(path.join(project,'new.txt'),'hello');await store.seal(checkpoint.id);
  const review=await store.review(checkpoint.id,'new.txt');await store.decideReview({token:review.token,action:'reject'});await assert.rejects(readFile(path.join(project,'new.txt')),{code:'ENOENT'});
  await assert.rejects(store.review(checkpoint.id,'../outside'),/source file|outside/);
});
test('concurrent review decisions retain both file decisions in the checkpoint',async t=>{
  const {project,store}=await fixture(t);for(const name of ['a.txt','b.txt'])await writeFile(path.join(project,name),'old');const checkpoint=await store.create('request',{manual:false});for(const name of ['a.txt','b.txt'])await writeFile(path.join(project,name),'new');await store.seal(checkpoint.id);
  const a=await store.review(checkpoint.id,'a.txt'),b=await store.review(checkpoint.id,'b.txt');await Promise.all([store.decideReview({token:a.token,action:'keep'}),store.decideReview({token:b.token,action:'keep'})]);assert.deepEqual((await store.load(checkpoint.id)).review,{'a.txt':'Kept','b.txt':'Kept'});
});
