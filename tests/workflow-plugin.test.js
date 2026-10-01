import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('workflow hook runs from a relocated plugin using Node on PATH',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'muse plugin relocated '));
  try{
    await cp(new URL('../muse-plugins/workflow-defaults/',import.meta.url),folder,{recursive:true});
    const manifest=JSON.parse(await readFile(path.join(folder,'.muse-plugin/plugin.json'),'utf8'));
    const [command,...args]=manifest.capabilities.hooks[0].command;
    assert.equal(path.isAbsolute(command),false,'Hook must not point at its author’s local runtime');
    const {stdout}=await promisify(execFile)(command,args,{cwd:folder,windowsHide:true,env:{...process.env,PATH:`${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`}});
    const result=JSON.parse(stdout).hookSpecificOutput;
    assert.equal(result.hookEventName,'SessionStart');
    for(const file of ['defaults.md','using-superpowers.md','muse-tools.md','ponytail.md'])
      assert.ok(result.additionalContext.includes(await readFile(path.join(folder,'instructions',file),'utf8')));
  }finally{await rm(folder,{recursive:true,force:true});}
});
