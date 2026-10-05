import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MoraWorkspace,validateMoraTask} from '../src/mora-workspace.js';
import {createMoraTools} from '../src/mora-tools.js';

async function fixture(readOnly=false,options={}){
  const profile=await mkdtemp(path.join(tmpdir(),'mora-tools-')),project=path.join(profile,'project');await mkdir(project);await writeFile(path.join(project,'a.js'),'export const value=1;');await writeFile(path.join(project,'b.js'),'export const other=2;');
  const workspace=new MoraWorkspace(profile,project),job=await workspace.prepare('job','run',validateMoraTask(JSON.stringify({title:'A',objective:'x',files:['a.js']})));
  const gateway=await createMoraTools({job,workspace,readOnly,...options});
  const call=async(name,args)=>{const response=await fetch(gateway.url,{method:'POST',headers:{authorization:'Bearer '+gateway.token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});return (await response.json()).result;};
  return {gateway,call,job,project};
}
test('MCP tools enforce assigned writes, project boundaries and original-source isolation',async t=>{
  const {gateway,call,job,project}=await fixture();t.after(()=>gateway.close());
  assert.equal((await fetch(gateway.url,{method:'POST',body:'{}'})).status,401);
  assert.equal((await call('write_file',{path:'../escape',content:'x'})).isError,true);
  assert.equal((await call('write_file',{path:'b.js',content:'x'})).isError,true);
  assert.equal((await call('write_file',{path:'a.js',content:'export const value=3;'})).isError,false);
  assert.match(await readFile(path.join(job.root,'a.js'),'utf8'),/=3/);assert.match(await readFile(path.join(project,'a.js'),'utf8'),/=1/);
  assert.equal((await call('run_checks',{})).isError,false);
});

test('listing skills grants no write permission; actual Ponytail reads are hashed once and keep source guards',async t=>{
  const skill={id:'ponytail:ponytail',label:'Ponytail · Full',source:'ponytail@1.0.0',resource:'SKILL.md',content:'Original instructions',sha256:'a'.repeat(64)},skills={missing:['superpowers:executing-plans'],list:async()=>[skill],read:async id=>{if(id!==skill.id)throw Error('Unavailable skill');return skill;}};
  const {gateway,call,job}=await fixture(false,{skills});t.after(()=>gateway.close());
  assert.equal((await call('list_skills',{})).isError,false);assert.deepEqual(job.skillUsage,[]);
  assert.equal((await call('write_file',{path:'a.js',content:'changed'})).isError,true);assert.equal((await call('delete_file',{path:'a.js'})).isError,true);
  assert.equal((await call('read_skill',{id:'superpowers:brainstorming'})).isError,true);assert.deepEqual(job.skillUsage,[]);
  assert.equal((await call('read_skill',{id:skill.id})).isError,false);await call('read_skill',{id:skill.id});assert.equal(job.skillUsage.length,1);assert.equal(job.skillUsage[0].sha256,skill.sha256);assert.equal(job.skillUsage[0].content,undefined);
  assert.equal((await call('write_file',{path:'../library/SKILL.md',content:'changed'})).isError,true);assert.equal((await call('write_file',{path:'b.js',content:'changed'})).isError,true);assert.equal((await call('write_file',{path:'a.js',content:'export const value=3;'})).isError,false);
});

test('cancellation during a skill read grants no late receipt or editing permission',async t=>{
  const abort=new AbortController(),skills={missing:[],list:async()=>[{id:'ponytail:ponytail'}],read:async()=>{abort.abort();return {id:'ponytail:ponytail',resource:'SKILL.md'};}};
  const {gateway,call,job}=await fixture(false,{skills,signal:abort.signal});t.after(()=>gateway.close());assert.equal((await call('read_skill',{id:'ponytail:ponytail'})).isError,true);assert.deepEqual(job.skillUsage,[]);assert.equal((await call('delete_file',{path:'a.js'})).isError,true);
});

test('oversized delivered skill output cannot record a read or unlock source edits',async t=>{
 const skills={missing:[],list:async()=>[{id:'ponytail:ponytail'}],read:async()=>({id:'ponytail:ponytail',resource:'SKILL.md',content:'x'.repeat(65000),sha256:'a'.repeat(64)})};const {gateway,call,job}=await fixture(false,{skills});t.after(()=>gateway.close());assert.equal((await call('read_skill',{id:'ponytail:ponytail'})).isError,true);assert.deepEqual(job.skillUsage,[]);assert.equal((await call('write_file',{path:'a.js',content:'changed'})).isError,true);
});
test('read-only worker cannot write or delete even when a model requests it',async t=>{
  const {gateway,call}=await fixture(true);t.after(()=>gateway.close());
  assert.equal((await call('read_file',{path:'a.js'})).isError,false);
  assert.equal((await call('write_file',{path:'a.js',content:'changed'})).isError,true);
  assert.equal((await call('delete_file',{path:'a.js'})).isError,true);
});
