import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {ProjectRunner,localURL} from '../src/project-work.js';
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'mora-run-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
async function project(root,scripts,body){await writeFile(path.join(root,'package.json'),JSON.stringify({scripts}));await writeFile(path.join(root,'work.cjs'),body);}
const command=async(_root,_manager,name)=>({file:process.execPath,args:['work.cjs',name],env:process.env});
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Timed out');}
test('local preview parsing excludes external and credential-bearing URLs',()=>{
 assert.equal(localURL('ready http://localhost:4321/'),'http://localhost:4321/');assert.equal(localURL('https://evil.test/'),null);assert.equal(localURL('http://user:pass@localhost:3000'),null);
});
test('Run waits for HTTP readiness and Stop releases its own server',()=>fixture(async root=>{
 await project(root,{dev:'node work.cjs'},"require('http').createServer((q,s)=>s.end('ok')).listen(0,'127.0.0.1',function(){console.log('http://127.0.0.1:'+this.address().port)})");
 const worker=new ProjectRunner(()=>{},{command,occupied:async()=>new Set()});try{await worker.run(root);await until(()=>worker.state.run.status==='ready');assert.equal((await fetch(worker.state.run.url)).status,200);await worker.stopRun();assert.equal(worker.state.run.status,'stopped');}finally{await worker.shutdown();}
}));
test('an already occupied preview port is rejected without killing its owner',()=>fixture(async root=>{
 const server=createServer((q,s)=>s.end('other'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 await project(root,{dev:'node work.cjs'},`console.log('http://127.0.0.1:${port}');setInterval(()=>{},1000)`);
 const worker=new ProjectRunner(()=>{},{command,occupied:async()=>new Set([port])});try{await worker.run(root);await until(()=>worker.state.run.status==='failed');assert.match(worker.state.run.message,/already/i);assert.equal(await(await fetch(`http://127.0.0.1:${port}`)).text(),'other');}finally{await worker.shutdown();await new Promise(resolve=>server.close(resolve));}
}));
test('startup timeout and early exit report failure and bound logs',()=>fixture(async root=>{
 await project(root,{dev:'node work.cjs'},"console.log('x'.repeat(60000));setInterval(()=>{},1000)");const worker=new ProjectRunner(()=>{},{command,occupied:async()=>new Set(),startupMs:100});
 try{await worker.run(root);await until(()=>worker.state.run.status==='failed');assert.ok(worker.state.run.output.length<=24000);await worker.stopRun();worker.startupMs=2000;await writeFile(path.join(root,'work.cjs'),'process.exit(1)');await worker.run(root);await until(()=>worker.state.run.status==='failed');assert.match(worker.state.run.message,/exit/i);}finally{await worker.shutdown();}
}));
test('Test runs configured checks in order and retains real failure evidence',()=>fixture(async root=>{
 await project(root,{typecheck:'node work.cjs',build:'node work.cjs',test:'node work.cjs'},"console.log(process.argv[2]);process.exit(process.argv[2]==='test'?2:0)");const worker=new ProjectRunner(()=>{},{command});await worker.test(root);
 assert.deepEqual(worker.state.tests.results.map(x=>[x.script,x.status]),[['typecheck','passed'],['build','passed'],['test','failed']]);assert.equal(worker.state.tests.results[2].code,2);assert.equal(worker.state.tests.status,'failed');assert.equal(worker.state.tests.interactions,'not checked');
}));
test('missing scripts and preview coverage are reported honestly',()=>fixture(async root=>{
 await project(root,{},'');const worker=new ProjectRunner(()=>{},{command});await worker.test(root);assert.equal(worker.state.tests.status,'not configured');await assert.rejects(worker.run(root),/start|dev/i);
 await project(root,{check:'node work.cjs'},'');await worker.test(root,{previewCheck:async()=>({status:'failed',message:'Page could not load'})});assert.equal(worker.state.tests.status,'failed');assert.equal(worker.state.tests.preview.status,'failed');
}));
test('Test timeout and cancellation stop only owned work and never report pass',()=>fixture(async root=>{
 await project(root,{test:'node work.cjs'},'setInterval(()=>{},1000)');const worker=new ProjectRunner(()=>{},{command,checkMs:100});await worker.test(root);assert.equal(worker.state.tests.results[0].status,'failed');assert.match(worker.state.tests.results[0].message,/time/i);
 const other=new ProjectRunner(()=>{},{command});const pending=other.test(root);await until(()=>!!other.testChild);await other.stopTests();await pending;assert.equal(other.state.tests.status,'stopped');assert.equal(other.testChild,null);
}));

test('Stop during command or port discovery cancels a pending Run before spawn',()=>fixture(async root=>{
 await project(root,{dev:'node work.cjs'},'setInterval(()=>{},1000)');
 for(const phase of ['command','occupied']){let release,entered;const inside=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const worker=new ProjectRunner(()=>{},{command:async(...args)=>{if(phase==='command'){entered();await gate;}return command(...args);},occupied:async()=>{if(phase==='occupied'){entered();await gate;}return new Set();}});
 try{const pending=worker.run(root);await inside;await worker.stopRun();release();await pending;assert.equal(!!worker.runChild,false);assert.equal(worker.state.run.status,'stopped');}finally{release();await worker.shutdown();}
 }
}));

test('Stopped is published only after the owned server has finished closing',()=>fixture(async root=>{
 await project(root,{dev:'node work.cjs'},"require('http').createServer((q,s)=>s.end('ok')).listen(0,'127.0.0.1',function(){console.log('http://127.0.0.1:'+this.address().port)})");
 const worker=new ProjectRunner(()=>{},{command,occupied:async()=>new Set()});let release;const gate=new Promise(r=>release=r),terminate=worker.terminate.bind(worker);
 try{await worker.run(root);await until(()=>worker.state.run.status==='ready');const url=worker.state.run.url;worker.terminate=async child=>{await gate;await terminate(child);};const stopping=worker.stopRun();assert.notEqual(worker.state.run.status,'stopped');assert.equal((await fetch(url)).status,200);release();await stopping;assert.equal(worker.state.run.status,'stopped');await assert.rejects(fetch(url));}finally{release();await worker.shutdown();}
}));
