import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/setup.js').catch(()=>({}));
test('a plain website needs the bundled runtime and no package manager',async()=>{
 const checks=await api.inspectSetup({root:'C:/Plain',connection:'ready',account:{status:'signedIn'}},{findMuse:async()=> 'engine.exe',run:async()=>{throw Error('Not installed');},readScripts:async()=>({start:'static',checks:[],manager:'static'}),packageSettings:()=>{throw Error('Do not probe a package manager');}});
 assert.equal(checks.find(x=>x.id==='node').status,'ready');assert.match(checks.find(x=>x.id==='node').detail,/bundled|own runtime/i);assert.equal(checks.find(x=>x.id==='manager'),undefined);assert.match(checks.find(x=>x.id==='commands').detail,/plain website/i);
});
test('setup reports actual tool availability, configured commands and account readiness',async()=>{
 assert.equal(typeof api.inspectSetup,'function');
 const calls=[];const checks=await api.inspectSetup({root:'C:/Project',account:{status:'signedIn'},connection:'ready'}, {run:async(file,args)=>{calls.push([file,args]);if(file==='git')throw Error('not found');return {stdout:file==='node'?'v24.1.0':'11.0.0'};},findMuse:async()=> 'C:/Muse.exe',readScripts:async()=>({manager:'npm',start:'dev',checks:['test','test:flows']}),packageSettings:async()=>({file:'npm',args:['--version']})});
 assert.equal(checks.find(x=>x.id==='node').status,'ready');assert.equal(checks.find(x=>x.id==='git').status,'missing');assert.equal(checks.find(x=>x.id==='account').status,'ready');
 assert.match(checks.find(x=>x.id==='commands').detail,/dev.*test.*test:flows/);
 assert.ok(calls.every(([,args])=>args.includes('--version') || args[0]?.includes('.cmd')));
});
test('setup failures remain actionable without implying sign-in or installing anything',async()=>{
 assert.equal(typeof api.inspectSetup,'function');
 const checks=await api.inspectSetup({root:null,account:{status:'unknown'},connection:'disconnected'}, {run:async()=>{throw Error('not found');},findMuse:async()=>{throw Error('missing');}});
 assert.equal(checks.find(x=>x.id==='muse').status,'missing');assert.equal(checks.find(x=>x.id==='account').status,'unknown');assert.equal(checks.some(x=>x.id==='commands'),false);
});
