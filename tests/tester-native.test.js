import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {TesterNative,createWebsiteObserver} from '../src/tester-native.js';
test('website observer exposes no repair method or project initialization arguments',async()=>{
 const calls=[],native={initialize:async(...args)=>calls.push(args),decide:async()=>({action:'finish'}),stop:async()=>{},close:async()=>{}};
 const observer=createWebsiteObserver('unused',{native});
 assert.deepEqual(Object.keys(observer).sort(),['close','decide','initialize','stop']);
 await observer.initialize({project:'private',repair:true});assert.deepEqual(calls,[[]]);
 assert.equal(observer.repair,undefined);
});
for(const mode of ['decide','repair'])test(`stop during ${mode} preparation prevents native launch`,async()=>{
 const native=new TesterNative('unused');native.workspace=await mkdtemp(path.join(tmpdir(),'mora-native-stop-'));native.schemaFile=path.join(native.workspace,'schema.json');
 let calls=0;native.runner.run=async()=>{calls++;return {code:1};};native.runner.stop=async()=>{};
 const pending=(mode==='decide'?native.decide('test'):native.repair(native.workspace,'test')).catch(e=>e);await native.stop();await pending;assert.equal(calls,0);
});
test('repairs use fresh native sessions and retain their isolated runtime storage',async()=>{
 const native=new TesterNative('unused');native.workspace=await mkdtemp(path.join(tmpdir(),'mora-native-repair-'));native.environment={XDG_DATA_HOME:path.join(native.workspace,'data')};const calls=[];
 native.runner.run=async options=>{calls.push(options);return {code:0,terminal:{terminal:'completed'}};};native.runner.stop=async()=>{};
 await native.repair(native.workspace,'first repair');await native.repair(native.workspace,'second repair');
 for(const call of calls){assert.match(call.sessionId||'',/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.equal(call.extraArgs.includes('--no-session-log'),false);assert.equal(call.environment.XDG_DATA_HOME,native.environment.XDG_DATA_HOME);}
 assert.notEqual(calls[0].sessionId,calls[1].sessionId);
});
test('decision timeout is classified and cancels only that decision without losing later usability',async()=>{
 const native=new TesterNative('unused',{decisionTimeoutMs:5});native.workspace=await mkdtemp(path.join(tmpdir(),'mora-native-timeout-'));native.schemaFile=path.join(native.workspace,'schema.json');let calls=0,stops=0;
 native.runner.run=async()=>{if(++calls===1)await new Promise(resolve=>setTimeout(resolve,20));return {code:0,terminal:{terminal:'completed',text:JSON.stringify({action:'finish'})}};};native.runner.stop=async()=>{stops++;};
 await assert.rejects(native.decide('first'),error=>error.code==='MORA_DECISION_TIMEOUT');assert.equal(stops,1);
 assert.equal((await native.decide('second')).action,'finish');assert.equal(native.stopped,false);
});
