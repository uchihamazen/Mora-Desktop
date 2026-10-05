import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MoraNative,runMoraWorker} from '../src/mora-native.js';
import {TesterNative} from '../src/tester-native.js';
import {ExecRunner} from '../src/runtime.js';

test('close waits for initialization and removes a credential created after shutdown began',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'mora-native-close-')),credential=path.join(directory,'auth.json'),model=new MoraNative('unused');let release,closed=false;model.initializing=(async()=>{await new Promise(resolve=>release=resolve);await writeFile(credential,'test credential');})();model.native={close:async()=>{await rm(credential,{force:true});closed=true;}};const closing=model.close();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(closed,false);release();await closing;assert.equal(closed,true);await assert.rejects(readFile(credential),{code:'ENOENT'});
});

test('abort while initialization is pending cleans up before the decision exits',async()=>{
 const model=new MoraNative('unused'),controller=new AbortController();let release,closed=false;model.initialize=async()=>{model.initializing=new Promise(resolve=>release=resolve);model.native={close:async()=>closed=true};await model.initializing;};const deciding=model.decide({messages:[],tools:[],signal:controller.signal});controller.abort();release();await assert.rejects(deciding,/stopped/);assert.equal(closed,true);
});

test('a cancelled worker never starts native initialization or creates its runtime',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'mora-native-prestop-')),controller=new AbortController();controller.abort();
 await assert.rejects(runMoraWorker({executable:'unavailable-engine',options:{},job:{directory},signal:controller.signal}),/Task stopped/);await assert.rejects(readFile(path.join(directory,'native','auth.json')),{code:'ENOENT'});
});

test('cancellation after setup cannot start a late provider request',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'mora-native-late-stop-')),root=path.join(directory,'source');await mkdir(root);const controller=new AbortController();let calls=0;
 t.mock.method(TesterNative.prototype,'initialize',async function(){this.directory=path.join(directory,'fake-native');this.environment={};await mkdir(path.join(this.directory,'config','muse'),{recursive:true});await writeFile(path.join(this.directory,'config','muse','settings.json'),JSON.stringify({presets:{'mora-observer':{run:{}}}}));});
 t.mock.method(ExecRunner.prototype,'run',async()=>{calls++;return {code:0,stopped:true};});
 await assert.rejects(runMoraWorker({executable:'unused',options:{executionMode:'full'},job:{directory,root,task:{files:['*']}},workspace:{},messages:[],signal:controller.signal,progress:()=>controller.abort()}),/Task stopped/);assert.equal(calls,0);
});
