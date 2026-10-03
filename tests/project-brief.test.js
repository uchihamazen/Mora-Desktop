import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
const api=await import('../src/project-brief.js').catch(()=>({}));
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'mora-brief-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
test('a shared project brief persists and concurrent stale saves preserve the newer text',()=>fixture(async root=>{
 assert.equal(typeof api.readProjectBrief,'function');
 const empty=await api.readProjectBrief(root);assert.equal(empty.text,'');assert.equal(empty.revision,null);
 const saved=await api.saveProjectBrief(root,{text:'# Goal\nBuild a shop\n',revision:empty.revision});
 assert.equal((await api.readProjectBrief(root)).text,saved.text);
 const outcomes=await Promise.allSettled([api.saveProjectBrief(root,{text:'First edit',revision:saved.revision}),api.saveProjectBrief(root,{text:'Stale second edit',revision:saved.revision})]);
 assert.equal(outcomes[0].status,'fulfilled');assert.equal(outcomes[1].status,'rejected');assert.match(outcomes[1].reason.message,/changed|reload/i);
 assert.equal(await readFile(path.join(root,'.mora','project-brief.md'),'utf8'),'First edit');
}));
test('briefs reject oversized files and linked storage without changing external files',()=>fixture(async root=>{
 assert.equal(typeof api.readProjectBrief,'function');
 await assert.rejects(api.saveProjectBrief(root,{text:'x'.repeat(24001),revision:null}),/24000|large/i);
 await mkdir(path.join(root,'.mora'));await writeFile(path.join(root,'.mora','project-brief.md'),'x'.repeat(24001));
 await assert.rejects(api.readProjectBrief(root),/large/i);
 await rm(path.join(root,'.mora'),{recursive:true});await mkdir(path.join(root,'outside'));await symlink(path.join(root,'outside'),path.join(root,'.mora'),'junction');
 await assert.rejects(api.readProjectBrief(root),/linked/i);
 await assert.rejects(api.saveProjectBrief(root,{text:'Do not write',revision:null}),/linked/i);
}));
