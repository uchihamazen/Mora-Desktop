import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createProject,projectFile,projectScripts} from '../src/project.js';

test('new starter is runnable without installing dependencies and never replaces an existing project',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mora-project-'));
  try {
    const created=await createProject(root,'First app');
    const pkg=JSON.parse(await readFile(path.join(created,'package.json'),'utf8'));
    assert.ok(pkg.scripts.dev);assert.ok(pkg.scripts.build);assert.ok(pkg.scripts.test);assert.equal(pkg.dependencies,undefined);
    await writeFile(path.join(created,'keep.txt'),'existing work');
    await assert.rejects(createProject(root,'First app'),/exists/i);
    assert.equal(await readFile(path.join(created,'keep.txt'),'utf8'),'existing work');
    for(const name of ['../escape','CON','a/b','name.','bad&command'])await assert.rejects(createProject(root,name));
    const scripts=await projectScripts(created);assert.equal(scripts.start,'dev');assert.deepEqual(scripts.checks,['check','build','test']);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('project files reject traversal, alternate streams and linked parents',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mora-paths-'));
  try {
    await mkdir(path.join(root,'source'));await mkdir(path.join(root,'outside'));
    await symlink(path.join(root,'outside'),path.join(root,'source','linked'),'junction');
    for(const file of ['../outside/a.js','a.txt:secret','linked/a.js','C:/other.js'])await assert.rejects(projectFile(path.join(root,'source'),file));
    assert.equal(await projectFile(path.join(root,'source'),'new/file.js'),path.join(root,'source','new','file.js'));
  } finally {await rm(root,{recursive:true,force:true});}
});
