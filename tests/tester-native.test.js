import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {TesterNative} from '../src/tester-native.js';
for(const mode of ['decide','repair'])test(`stop during ${mode} preparation prevents native launch`,async()=>{
 const native=new TesterNative('unused');native.workspace=await mkdtemp(path.join(tmpdir(),'mora-native-stop-'));native.schemaFile=path.join(native.workspace,'schema.json');
 let calls=0;native.runner.run=async()=>{calls++;return {code:1};};native.runner.stop=async()=>{};
 const pending=(mode==='decide'?native.decide('test'):native.repair(native.workspace,'test')).catch(e=>e);await native.stop();await pending;assert.equal(calls,0);
});
