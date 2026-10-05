import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MoraSkills} from '../src/mora-skills.js';
import {createHash} from 'node:crypto';

async function fixture(){const cache=await mkdtemp(path.join(tmpdir(),'mora-skill-library-'));for(const [plugin,version,names] of [['ponytail','1.0.0',['ponytail']],['superpowers','6.4.2',['brainstorming','writing-plans','executing-plans','systematic-debugging','verification-before-completion','test-driven-development','requesting-code-review','receiving-code-review']]])for(const name of names){const root=path.join(cache,'trusted',plugin,version,'skills',name);await mkdir(root,{recursive:true});await writeFile(path.join(root,'SKILL.md'),`---\nname: ${name}\ndescription: Guidance for ${name}\n---\nOriginal ${name} instructions.`);}return {cache,library:new MoraSkills({cache})};}

test('role libraries expose only selected namespaced skills and TDD requires test ownership',async()=>{
 const {library}=await fixture(),coordinator=await library.forRole('coordinator'),worker=await library.forRole('worker',['app.js']);assert.ok((await coordinator.list()).some(skill=>skill.id==='superpowers:brainstorming'));assert.ok(!(await worker.list()).some(skill=>skill.id==='superpowers:brainstorming'));assert.ok(!(await worker.list()).some(skill=>skill.id==='superpowers:test-driven-development'));await assert.rejects(worker.read('superpowers:brainstorming'),/unavailable/);
 const testing=await library.forRole('worker',['tests/**']);assert.ok((await testing.list()).some(skill=>skill.id==='superpowers:test-driven-development'));assert.ok((await worker.list()).some(skill=>skill.id==='ponytail:ponytail'));
});

test('original skill bytes are cached once and resources cannot escape the selected skill',async()=>{
 const {library,cache}=await fixture(),worker=await library.forRole('worker',['app.js']),first=await worker.read('ponytail:ponytail');await writeFile(path.join(cache,'trusted/ponytail/1.0.0/skills/ponytail/SKILL.md'),'changed after discovery');assert.deepEqual(await worker.read('ponytail:ponytail'),first);assert.deepEqual(await worker.read('ponytail:ponytail','./SKILL.md'),first);assert.match(first.content,/Original ponytail instructions/);assert.match(first.sha256,/^[a-f0-9]{64}$/);
 await assert.rejects(worker.read('ponytail:ponytail','../other/SKILL.md'),/path|resource/i);await assert.rejects(worker.read('ponytail:ponytail',path.join(cache,'outside.txt')),/path|resource/i);
 const root=path.join(cache,'trusted/ponytail/1.0.0/skills/ponytail'),outside=path.join(cache,'outside');await mkdir(outside);await writeFile(path.join(outside,'private.md'),'private');await symlink(outside,path.join(root,'linked'),process.platform==='win32'?'junction':'dir');await assert.rejects(worker.read('ponytail:ponytail','linked/private.md'),/link/i);await writeFile(path.join(root,'huge.md'),'x'.repeat(70000));await assert.rejects(worker.read('ponytail:ponytail','huge.md'),/large|limit/i);
 if(process.platform==='win32')assert.deepEqual(await worker.read('ponytail:ponytail','skill.md'),first);
 await writeFile(path.join(root,'invalid.md'),Buffer.from([0xff]));await assert.rejects(worker.read('ponytail:ponytail','invalid.md'),/encoded|encoding|valid/i);await writeFile(path.join(root,'encoded.md'),'\u0001'.repeat(10000));await assert.rejects(worker.read('ponytail:ponytail','encoded.md'),/output limit/i);assert.equal(createHash('sha256').update(first.content).digest('hex'),first.sha256);
});

test('supporting resource reads are bounded across a conversation',async()=>{
 const {library,cache}=await fixture(),worker=await library.forRole('worker'),root=path.join(cache,'trusted/ponytail/1.0.0/skills/ponytail');let refused=false;for(let index=0;index<70;index++){const name=`reference-${index}.md`;await writeFile(path.join(root,name),'Small reference');try{await worker.read('ponytail:ponytail',name);}catch(error){assert.match(error.message,/cache is full/);refused=true;break;}}assert.equal(refused,true);assert.ok(library.content.size<=64);
});

test('an installed cache reached through a home junction is discovered without accepting links inside skills',async()=>{
 const {cache}=await fixture(),parent=await mkdtemp(path.join(tmpdir(),'mora-skill-home-')),linked=path.join(parent,'cache');await symlink(cache,linked,process.platform==='win32'?'junction':'dir');const worker=await new MoraSkills({cache:linked}).forRole('worker');assert.equal(worker.missing.length,0);assert.match((await worker.read('ponytail:ponytail')).content,/Original/);
});

test('latest installed version wins without loading duplicate selectors and missing libraries stay explicit',async()=>{
 const {cache}=await fixture(),root=path.join(cache,'trusted/ponytail/1.2.0/skills/ponytail');await mkdir(root,{recursive:true});await writeFile(path.join(root,'SKILL.md'),'---\nname: ponytail\ndescription: Latest\n---\nNewest original content');const library=new MoraSkills({cache}),worker=await library.forRole('worker',['app.js']);assert.equal((await worker.list()).filter(skill=>skill.id==='ponytail:ponytail').length,1);assert.match((await worker.read('ponytail:ponytail')).content,/Newest/);await assert.rejects(worker.read('superpowers:using-superpowers'),/unavailable/);
 const missing=await new MoraSkills({cache:path.join(cache,'missing')}).forRole('worker',['app.js']);assert.deepEqual(await missing.list(),[]);assert.ok(missing.missing.includes('ponytail:ponytail'));
});
